/**
 * gpgpu-pipeline.js — PLY→纹理、BBox 归一化、Ping-pong FBO GPGPU、粒子绘制、ACES + Bloom + Afterimage
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  PARTICLE_SIM_TEXTURE_SIZE,
  createParticleSimUniforms,
  createVelocityStepMaterial,
  createPositionStepMaterial,
  getPhaseId,
  initTree,
} from './vector-fields.js';

/**
 * 解析 ASCII / binary_little_endian PLY，返回归一化到 [-1,1]³（相对 BBox 中心、半轴 max）
 */
export async function loadPLYNormalizedPositions(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return parsePLYToNormalized(buf);
}

export function parsePLYToNormalized(buffer) {
  const u8 = new Uint8Array(buffer);
  const headLen = Math.min(u8.length, 131072);
  const headStr = new TextDecoder('ascii').decode(u8.subarray(0, headLen));
  const endM = headStr.match(/end_header\s*\r?\n/);
  if (!endM || endM.index < 0) throw new Error('PLY: 无有效 header');
  const headerEnd = endM.index + endM[0].length;

  const lines = headStr
    .slice(0, endM.index)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let format = 'ascii';
  let vertexCount = 0;
  let inVertex = false;
  for (const line of lines) {
    if (line.startsWith('format ')) format = line.split(/\s+/)[1] || 'ascii';
    if (line.startsWith('element vertex ')) vertexCount = parseInt(line.split(/\s+/)[2], 10) || 0;
    if (line.startsWith('element ')) inVertex = line.startsWith('element vertex');
    if (line.startsWith('property ') && inVertex) { /* x y z order assumed */ }
  }
  if (vertexCount <= 0) throw new Error('PLY: vertex 数量为 0');

  const positions = new Float32Array(vertexCount * 3);
  let off = 0;

  if (format === 'ascii') {
    const text = new TextDecoder().decode(u8.subarray(headerEnd));
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    let li = 0;
    for (let i = 0; i < vertexCount && li < lines.length; i++) {
      const parts = lines[li++].trim().split(/\s+/);
      positions[off++] = parseFloat(parts[0]);
      positions[off++] = parseFloat(parts[1]);
      positions[off++] = parseFloat(parts[2]);
    }
  } else {
    let ptr = headerEnd;
    for (let i = 0; i < vertexCount; i++) {
      if (ptr + 12 > u8.length) break;
      const dv = new DataView(buffer, ptr, 12);
      positions[off++] = dv.getFloat32(0, true);
      positions[off++] = dv.getFloat32(4, true);
      positions[off++] = dv.getFloat32(8, true);
      ptr += 12;
    }
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) * 0.5,
    cy = (minY + maxY) * 0.5,
    cz = (minZ + maxZ) * 0.5;
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 || 1;
  const inv = 1 / ext;
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = (positions[i * 3] - cx) * inv;
    positions[i * 3 + 1] = (positions[i * 3 + 1] - cy) * inv;
    positions[i * 3 + 2] = (positions[i * 3 + 2] - cz) * inv;
  }

  return { positions, vertexCount, center: new THREE.Vector3(cx, cy, cz), halfExtent: ext };
}

/** 将 PLY 点写入 RGBA Float 位置纹理（不足重复采样，超过分层） */
export function fillPositionTextureFromPLY(initPos, ply, size, count) {
  const { positions, vertexCount } = ply;
  for (let i = 0; i < count; i++) {
    let vx, vy, vz;
    if (vertexCount <= 0) {
      const a1 = Math.random() * Math.PI * 2,
        a2 = Math.random() * Math.PI * 2;
      const r = 0.35 + 0.65 * Math.random();
      vx = Math.cos(a1) * Math.cos(a2) * r;
      vy = Math.sin(a2) * r * 0.55;
      vz = Math.sin(a1) * Math.cos(a2) * r;
    } else {
      const j = vertexCount > count ? Math.floor((i / count) * vertexCount) % vertexCount : i % vertexCount;
      vx = positions[j * 3];
      vy = positions[j * 3 + 1];
      vz = positions[j * 3 + 2];
    }
    initPos[i * 4] = vx;
    initPos[i * 4 + 1] = vy;
    initPos[i * 4 + 2] = vz;
    initPos[i * 4 + 3] = 0.55 + Math.random() * 0.45;
  }
}

export function getSimTextureSize(renderer) {
  const gl = renderer.getContext();
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  const want = PARTICLE_SIM_TEXTURE_SIZE;
  const s = Math.min(want, max, 2048);
  let p = 128;
  while (p * 2 <= s) p *= 2;
  return p;
}

export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const SIZE = getSimTextureSize(renderer);
  const COUNT = SIZE * SIZE;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08060f);
  scene.fog = new THREE.FogExp2(0x100818, 0.042);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 80);
  camera.position.set(0, 0.55, 4.1);

  const sharedUniforms = {
    uTime: { value: 0 },
    uGrowthProgress: { value: 0 },
    /** 与 AI / 手势绑定的全局进度（可同步 uGrowthProgress） */
    uProgress: { value: 0 },
  };

  const simUniforms = createParticleSimUniforms();
  const treeApi = initTree(scene, sharedUniforms, {});

  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(320 * 3);
  for (let i = 0; i < 320; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const r = 12 + Math.random() * 28;
    starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = r * Math.cos(ph) * 0.5 + 2;
    starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: 0x6a5088,
      size: 0.035,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  stars.frustumCulled = false;
  scene.add(stars);

  const mkTex = (data) => {
    const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    return t;
  };
  const mkRT = () =>
    new THREE.WebGLRenderTarget(SIZE, SIZE, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    });

  const initPos = new Float32Array(COUNT * 4);
  const initVel = new Float32Array(COUNT * 4);
  const r0 = simUniforms.uSeedRadius.value;
  for (let i = 0; i < COUNT; i++) {
    const a1 = Math.random() * Math.PI * 2,
      a2 = Math.random() * Math.PI * 2;
    const rr = r0 * (0.35 + 0.65 * Math.random());
    initPos[i * 4] = Math.cos(a1) * Math.cos(a2) * rr;
    initPos[i * 4 + 1] = Math.sin(a2) * rr * 0.55;
    initPos[i * 4 + 2] = Math.sin(a1) * Math.cos(a2) * rr;
    initPos[i * 4 + 3] = 0.55 + Math.random() * 0.45;
    initVel[i * 4 + 3] = 1;
  }

  const posRT = [mkRT(), mkRT()];
  const velRT = [mkRT(), mkRT()];
  simUniforms.tPos = { value: mkTex(initPos) };
  simUniforms.tVel = { value: mkTex(initVel) };

  const velMat = createVelocityStepMaterial(simUniforms);
  const posMat = createPositionStepMaterial(simUniforms);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadMesh = new THREE.Mesh(quadGeo, velMat);
  const simScene = new THREE.Scene();
  simScene.add(quadMesh);
  const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function gpgpuStep(dt, t) {
    simUniforms.uDelta.value = dt;
    simUniforms.uTime.value = t;
    simUniforms.uPhase.value = getPhaseId();
    simUniforms.uTypingPulse.value *= 0.91;
    simUniforms.uGrowthProgress.value = sharedUniforms.uGrowthProgress.value;
    sharedUniforms.uTime.value = t;

    quadMesh.material = velMat;
    renderer.setRenderTarget(velRT[1]);
    renderer.render(simScene, simCam);
    [velRT[0], velRT[1]] = [velRT[1], velRT[0]];
    simUniforms.tVel.value = velRT[0].texture;

    quadMesh.material = posMat;
    renderer.setRenderTarget(posRT[1]);
    renderer.render(simScene, simCam);
    [posRT[0], posRT[1]] = [posRT[1], posRT[0]];
    simUniforms.tPos.value = posRT[0].texture;

    renderer.setRenderTarget(null);
  }

  const pGeo = new THREE.BufferGeometry();
  const refs = new Float32Array(COUNT * 2);
  for (let i = 0; i < COUNT; i++) {
    refs[i * 2] = (i % SIZE + 0.5) / SIZE;
    refs[i * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE;
  }
  pGeo.setAttribute('reference', new THREE.BufferAttribute(refs, 2));

  const uHueShift = { value: 0 };
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tPos: simUniforms.tPos,
      tVel: simUniforms.tVel,
      uPointSize: { value: 2.8 },
      uTime: sharedUniforms.uTime,
      uGrowthProgress: sharedUniforms.uGrowthProgress,
      uHueShift,
    },
    vertexShader: /* glsl */ `
      uniform sampler2D tPos;
      uniform sampler2D tVel;
      uniform float uPointSize;
      uniform float uTime;
      uniform float uGrowthProgress;
      uniform float uHueShift;
      attribute vec2 reference;
      varying vec3 vColor;
      varying float vAlpha;
      vec3 toneShift(vec3 col, float shift){
        float a = shift * 6.28318;
        return clamp(col * vec3(
          0.92 + 0.16 * sin(a),
          0.92 + 0.16 * sin(a + 2.094),
          0.92 + 0.16 * sin(a + 4.189)
        ), 0.0, 1.0);
      }
      float h11(float x){ return fract(sin(x)*43758.5453); }
      void main(){
        vec4 pd = texture2D(tPos, reference);
        vec3 pos = pd.xyz;
        float life = pd.w;
        vec3 vel = texture2D(tVel, reference).xyz;
        float spd = length(vel);
        float g = clamp(uGrowthProgress, 0.0, 1.0);
        vec3 gold = vec3(1.0, 0.82, 0.38);
        vec3 cyan = vec3(0.35, 0.85, 0.95);
        vec3 pink = vec3(0.92, 0.45, 0.88);
        float w = smoothstep(0.0, 1.0, spd * 0.4) * 0.5 + pos.y * 0.08 + h11(reference.x * 57.0) * 0.15;
        vec3 base = mix(gold, cyan, smoothstep(0.0, 0.55, w));
        base = mix(base, pink, smoothstep(0.4, 1.0, w));
        base = toneShift(base, uHueShift);
        base += 0.08 * sin(uTime * 0.7 + pos.x * 2.0 + pos.z * 1.5);
        float bright = 0.35 + 0.65 * smoothstep(0.0, 0.9, g);
        vColor = base * bright * (0.85 + 0.25 * smoothstep(0.5, 4.0, spd));
        vAlpha = smoothstep(0.0, 0.12, life) * 0.94;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPointSize * (300.0 / (-mv.z + 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        if(d > 0.5) discard;
        float soft = exp(-d * 5.8);
        float rim = exp(-d * 12.0) * 0.45;
        gl_FragColor = vec4(vColor * (1.0 + rim), vAlpha * soft);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particlePoints = new THREE.Points(pGeo, particleMaterial);
  particlePoints.frustumCulled = false;
  scene.add(particlePoints);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.12, 0.62, 0.22);
  composer.addPass(bloomPass);
  const afterimagePass = new AfterimagePass(0.93);
  composer.addPass(afterimagePass);
  composer.addPass(new OutputPass());

  function onResize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    bloomPass.resolution.set(w, h);
    if (afterimagePass.uniforms?.resolution?.value) afterimagePass.uniforms.resolution.value.set(w, h);
  }
  window.addEventListener('resize', onResize);

  function applyPLYToSimulation(ply) {
    const oldTex = simUniforms.tPos.value;
    fillPositionTextureFromPLY(initPos, ply, SIZE, COUNT);
    const nt = mkTex(initPos);
    if (oldTex?.isDataTexture) oldTex.dispose();
    simUniforms.tPos.value = nt;
  }

  return {
    renderer,
    scene,
    camera,
    composer,
    SIZE,
    COUNT,
    gpgpuStep,
    simUniforms,
    sharedUniforms,
    particleMaterial,
    treeApi,
    bloomPass,
    afterimagePass,
    uHueShift,
    onResize,
    applyPLYToSimulation,
  };
}

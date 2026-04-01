/**
 * core-entry.js — 形态变换粒子系统 (星云/爱心/土星/烟花)
 * GPGPU 星座连线 + Bloom / Afterimage / ACES
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import gsap from 'gsap';

import {
  PARTICLE_SIM_TEXTURE_SIZE,
  createParticleSimUniforms,
  createVelocityStepMaterial,
  createPositionStepMaterial,
  getPhaseId,
  createConstellationLines,
  createInspirationStarSystem,
} from './particles.js';
import { initTree } from './tree.js';
import { initControls } from './controls-ui.js';

const SIZE = PARTICLE_SIM_TEXTURE_SIZE;
const COUNT = SIZE * SIZE;
const SIM_TEX_TYPE = THREE.FloatType;

function gaussRand() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/* ═══ Shape generators ═══ */

function genNebulaShape() {
  const d = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.abs(gaussRand()) * 3.2;
    d[i * 4] = Math.cos(a) * r;
    d[i * 4 + 1] = Math.sin(a) * r * 0.65;
    d[i * 4 + 2] = gaussRand() * 1.2;
    d[i * 4 + 3] = Math.random();
  }
  return d;
}

function genHeartShape() {
  const d = new Float32Array(COUNT * 4);
  const S = 0.21;
  for (let i = 0; i < COUNT; i++) {
    const t = Math.random() * Math.PI * 2;
    let x = 16 * Math.pow(Math.sin(t), 3) * S;
    let y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * S;
    x += gaussRand() * 0.2;
    y += gaussRand() * 0.2;
    const z = gaussRand() * 0.12;
    d[i * 4] = x;
    d[i * 4 + 1] = y;
    d[i * 4 + 2] = z;
    d[i * 4 + 3] = Math.random();
  }
  return d;
}

function genSaturnShape() {
  const d = new Float32Array(COUNT * 4);
  const sphereN = Math.floor(COUNT * 0.55);
  const TILT = 26 * Math.PI / 180;
  const CT = Math.cos(TILT), ST = Math.sin(TILT);
  for (let i = 0; i < COUNT; i++) {
    let x, y, z;
    if (i < sphereN) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.5 * (0.85 + 0.15 * Math.random());
      x = Math.sin(phi) * Math.cos(theta) * r;
      y = Math.cos(phi) * r * 0.88;
      z = Math.sin(phi) * Math.sin(theta) * r;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const ringR = 2.2 + Math.random() * 1.6;
      x = Math.cos(angle) * ringR;
      y = (Math.random() - 0.5) * 0.04;
      z = Math.sin(angle) * ringR;
    }
    const ry = y * CT - z * ST;
    const rz = y * ST + z * CT;
    d[i * 4] = x;
    d[i * 4 + 1] = ry;
    d[i * 4 + 2] = rz;
    d[i * 4 + 3] = Math.random();
  }
  return d;
}

function genFireworkShape() {
  const d = new Float32Array(COUNT * 4);
  const BURSTS = 7;
  const centers = [];
  for (let b = 0; b < BURSTS; b++) {
    centers.push({
      x: (Math.random() - 0.5) * 5.5,
      y: Math.random() * 3.5 - 0.8,
      z: (Math.random() - 0.5) * 2,
    });
  }
  for (let i = 0; i < COUNT; i++) {
    const c = centers[i % BURSTS];
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.pow(Math.random(), 0.6) * 1.8;
    d[i * 4] = c.x + Math.sin(phi) * Math.cos(theta) * r;
    d[i * 4 + 1] = c.y + Math.cos(phi) * r - Math.pow(r, 1.5) * 0.12;
    d[i * 4 + 2] = c.z + Math.sin(phi) * Math.sin(theta) * r * 0.5;
    d[i * 4 + 3] = Math.random();
  }
  return d;
}

/* ═══ Main ═══ */

async function main() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;

  /* ── Renderer ── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  /* ── Scene ── */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000011);

  /* ── Camera ── */
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 0, 8);

  /* ── Shared uniforms ── */
  const sharedUniforms = {
    uTime: { value: 0 },
    uGrowthProgress: { value: 0 },
  };

  /* ── Background starfield (tree.js) ── */
  const treeApi = initTree(scene, sharedUniforms);

  /* ── GPGPU setup ── */
  const simUniforms = createParticleSimUniforms();

  const mkRT = () =>
    new THREE.WebGLRenderTarget(SIZE, SIZE, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: SIM_TEX_TYPE,
      depthBuffer: false,
      stencilBuffer: false,
    });

  /* ── Generate shape data ── */
  const nebulaData = genNebulaShape();
  const heartData = genHeartShape();
  const saturnData = genSaturnShape();
  const fireworkData = genFireworkShape();

  const mkTex = (data) => {
    const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, SIM_TEX_TYPE);
    t.needsUpdate = true;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
  };

  const shapes = {
    nebula: mkTex(nebulaData),
    heart: mkTex(heartData),
    saturn: mkTex(saturnData),
    firework: mkTex(fireworkData),
  };
  let currentShapeName = 'nebula';

  /* ── Initialize GPGPU buffers from nebula shape ── */
  const initPos = new Float32Array(COUNT * 4);
  const initVel = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    initPos[i * 4] = nebulaData[i * 4] + (Math.random() - 0.5) * 0.2;
    initPos[i * 4 + 1] = nebulaData[i * 4 + 1] + (Math.random() - 0.5) * 0.2;
    initPos[i * 4 + 2] = nebulaData[i * 4 + 2] + (Math.random() - 0.5) * 0.2;
    initPos[i * 4 + 3] = 0.4 + Math.random() * 0.6;
    initVel[i * 4 + 3] = 1;
  }

  const posRT = [mkRT(), mkRT()];
  const velRT = [mkRT(), mkRT()];
  simUniforms.tPos.value = mkTex(initPos);
  simUniforms.tVel.value = mkTex(initVel);
  simUniforms.tTarget.value = shapes.nebula;

  const velMat = createVelocityStepMaterial(simUniforms);
  const posMat = createPositionStepMaterial(simUniforms);
  const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), velMat);
  const simScene = new THREE.Scene();
  simScene.add(quadMesh);
  const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  /* ── Constellation lines ── */
  const constellationSystem = createConstellationLines(scene);

  /* ── Inspiration stars ── */
  const inspirationStarSystem = createInspirationStarSystem(scene, camera, renderer.domElement);

  /* ── Read-back buffer ── */
  const readBuf = new Float32Array(COUNT * 4);
  function readParticlePositions() {
    renderer.readRenderTargetPixels(posRT[0], 0, 0, SIZE, SIZE, readBuf);
    return readBuf;
  }

  /* ── GPGPU step ── */
  function gpgpuStep(dt, t) {
    simUniforms.uDelta.value = dt;
    simUniforms.uTime.value = t;
    simUniforms.uPhase.value = getPhaseId();
    simUniforms.uTypingPulse.value *= 0.92;
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

  /* ══════════════════════════════════════════════════════
     Morphing particle render system
     ══════════════════════════════════════════════════════ */
  const morphUniforms = {
    tShapeA: { value: shapes.nebula },
    tShapeB: { value: shapes.nebula },
    uMorphProgress: { value: 0 },
    uPointSize: { value: 1.5 },
    uTime: sharedUniforms.uTime,
    uMouse: { value: new THREE.Vector2(0, 0) },
    uMouseActive: { value: 0 },
    uSpread: { value: 1.0 },
    uColor1: { value: new THREE.Color('#2266ff') },
    uColor2: { value: new THREE.Color('#9944dd') },
  };

  const pGeo = new THREE.BufferGeometry();
  // Points 在 three.js 中默认依赖 position attribute 来确定 draw count。
  // 这里只用 reference 取纹理坐标，但仍需提供一个同数量的占位 position。
  const dummyPos = new Float32Array(COUNT * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3));
  const refs = new Float32Array(COUNT * 2);
  for (let i = 0; i < COUNT; i++) {
    refs[i * 2] = (i % SIZE + 0.5) / SIZE;
    refs[i * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE;
  }
  pGeo.setAttribute('reference', new THREE.BufferAttribute(refs, 2));

  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: morphUniforms,
    vertexShader: /* glsl */ `
      uniform sampler2D tShapeA;
      uniform sampler2D tShapeB;
      uniform float uMorphProgress;
      uniform float uPointSize;
      uniform float uTime;
      uniform vec2 uMouse;
      uniform float uMouseActive;
      uniform float uSpread;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      attribute vec2 reference;
      varying vec3 vColor;
      varying float vAlpha;

      float h11(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      void main(){
        float seed = h11(reference * 57.0);

        vec4 dA = texture2D(tShapeA, reference);
        vec4 dB = texture2D(tShapeB, reference);
        float bseed = mix(dA.w, dB.w, uMorphProgress);

        vec3 pos = mix(dA.xyz, dB.xyz, uMorphProgress) * uSpread;

        if(uMouseActive > 0.01){
          vec3 mouseW = vec3(uMouse.x * 6.0, uMouse.y * 4.0, 0.0);
          vec3 toM = mouseW - pos;
          float mDist = length(toM);
          float attract = smoothstep(6.0, 0.3, mDist) * uMouseActive * 0.3;
          pos += toM * attract;
        }

        pos += vec3(
          sin(uTime * 0.3 + seed * 20.0),
          cos(uTime * 0.25 + seed * 15.0),
          sin(uTime * 0.35 + seed * 25.0)
        ) * 0.06;

        vColor = mix(uColor1, uColor2, seed);

        float bright = 1.0;
        if(bseed > 0.97) bright = 3.0;
        else if(bseed > 0.92) bright = 1.8;
        else if(bseed > 0.86) bright = 1.3;
        vColor *= bright;

        float twinkle = 0.5 + 0.5 * sin(uTime * (0.3 + seed * 1.5) + seed * 50.0);
        twinkle = twinkle * twinkle;
        vAlpha = twinkle * 0.9;

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float sz = uPointSize * (0.3 + seed * 0.7);
        if(bseed > 0.92) sz *= 2.0;
        gl_PointSize = sz * (55.0 / max(2.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float alpha = smoothstep(0.5, 0.02, d);
        if(alpha < 0.01) discard;
        gl_FragColor = vec4(vColor, alpha * vAlpha * 0.78);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const particlePoints = new THREE.Points(pGeo, particleMaterial);
  particlePoints.frustumCulled = false;
  particlePoints.renderOrder = 0;
  scene.add(particlePoints);

  /* ── Shape switching ── */
  function switchShape(name) {
    if (!shapes[name] || name === currentShapeName) return;
    morphUniforms.tShapeA.value = shapes[currentShapeName];
    morphUniforms.tShapeB.value = shapes[name];
    morphUniforms.uMorphProgress.value = 0;
    gsap.killTweensOf(morphUniforms.uMorphProgress);
    gsap.to(morphUniforms.uMorphProgress, {
      value: 1,
      duration: 2.0,
      ease: 'power2.inOut',
      onComplete() {
        morphUniforms.tShapeA.value = shapes[name];
        morphUniforms.uMorphProgress.value = 0;
        currentShapeName = name;
      },
    });
    simUniforms.tTarget.value = shapes[name];
  }

  /* ── Post-processing ── */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.3, 0.8, 0.3,
  );
  composer.addPass(bloomPass);

  const afterimagePass = new AfterimagePass(0.12);
  composer.addPass(afterimagePass);
  composer.addPass(new OutputPass());

  /* ── Camera orbit ── */
  const camRig = { breathe: 0, nudge: 0 };
  gsap.to(camRig, { breathe: 0.1, duration: 6, yoyo: true, repeat: -1, ease: 'sine.inOut' });

  function updateCamera() {
    const rad = 8 + camRig.breathe + camRig.nudge;
    camera.position.set(0, 0, rad);
    camera.lookAt(0, 0, 0);
  }

  /* ── Resize ── */
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    bloomPass.resolution.set(w, h);
  }
  window.addEventListener('resize', onResize);

  /* ── Mouse interaction ── */
  const mouseNDC = new THREE.Vector2(0, 0);
  const mouseRaycaster = new THREE.Raycaster();
  let mouseInCanvas = false;
  let targetRotationY = 0;
  let currentRotationY = 0;

  renderer.domElement.addEventListener('mousemove', (e) => {
    mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    mouseInCanvas = true;
    targetRotationY = mouseNDC.x * Math.PI * 0.12;
    morphUniforms.uMouse.value.set(mouseNDC.x, mouseNDC.y);
    treeApi.setPointer(mouseNDC.x, mouseNDC.y);
  });

  renderer.domElement.addEventListener('mouseleave', () => {
    mouseInCanvas = false;
    treeApi.setPointer(0, 0);
  });

  renderer.domElement.addEventListener('pointerdown', (e) => {
    const hitStar = inspirationStarSystem.handlePointer(e.clientX, e.clientY);
    if (!hitStar) {
      simUniforms.uClickPulse.value = 1.4;
    }
  });

  renderer.domElement.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (!touch) return;
    mouseNDC.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(touch.clientY / window.innerHeight) * 2 + 1;
    mouseInCanvas = true;
    targetRotationY = mouseNDC.x * Math.PI * 0.12;
    morphUniforms.uMouse.value.set(mouseNDC.x, mouseNDC.y);
  }, { passive: true });

  renderer.domElement.addEventListener('touchend', () => { mouseInCanvas = false; });

  function updateMouse() {
    if (mouseInCanvas) {
      morphUniforms.uMouseActive.value = THREE.MathUtils.lerp(morphUniforms.uMouseActive.value, 1.0, 0.12);
      mouseRaycaster.setFromCamera(mouseNDC, camera);
      const dir = mouseRaycaster.ray.direction;
      const orig = mouseRaycaster.ray.origin;
      const tVal = -orig.dot(dir) / dir.dot(dir);
      const closest = orig.clone().addScaledVector(dir, Math.max(0, tVal));
      simUniforms.uMouseWorld.value.copy(closest);
      simUniforms.uMouseActive.value = THREE.MathUtils.lerp(simUniforms.uMouseActive.value, 1.0, 0.12);
    } else {
      morphUniforms.uMouseActive.value *= 0.94;
      simUniforms.uMouseActive.value *= 0.94;
    }
    simUniforms.uClickPulse.value *= 0.91;
  }

  /* ── Animate ── */
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.06);
    const t = clock.elapsedTime;

    updateMouse();
    gpgpuStep(dt, t);

    currentRotationY += (targetRotationY - currentRotationY) * 0.06;
    particlePoints.rotation.y = currentRotationY;
    particlePoints.rotation.z += 0.0003;

    constellationSystem.update(t, simUniforms);
    inspirationStarSystem.update(t);
    updateCamera();
    composer.render(dt);
  }

  /* ── Intro animation ── */
  function playIntroAnimation() {
    bloomPass.strength = 2.0;
    gsap.to(bloomPass, { strength: 1.3, duration: 4.0, ease: 'power1.out' });
    const overlay = document.getElementById('intro-overlay');
    if (overlay) gsap.delayedCall(0.4, () => overlay.classList.add('fade-out'));
  }

  /* ── API for controls ── */
  const api = {
    simUniforms,
    sharedUniforms,
    particleMaterial,
    morphUniforms,
    treeApi,
    camera,
    bloomPass,
    afterimagePass,
    constellationSystem,
    inspirationStarSystem,
    readParticlePositions,
    texSize: SIZE,
    switchShape,
  };

  initControls(api, camRig);
  playIntroAnimation();
  animate();
}

main().catch(console.error);

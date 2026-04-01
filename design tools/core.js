/**
 * core.js — GPGPU 粒子、SDF 树、星空背景、ACES + Bloom + Afterimage、运镜
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import gsap from 'gsap';

import { createParticleSimUniforms, createVelocityStepMaterial, createPositionStepMaterial, getPhaseId } from './particles.js';
import { initTree } from './tree.js';
import { initControls } from './controls.js';

const SIZE = 256;
const COUNT = SIZE * SIZE;

async function main() {
  const canvas = document.getElementById('main-canvas');
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08060f);
  scene.fog = new THREE.FogExp2(0x100818, 0.042);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 80);
  camera.position.set(0, 0.55, 4.1);

  const sharedUniforms = {
    uTime: { value: 0 },
    uGrowthProgress: { value: 0 },
  };

  const simUniforms = createParticleSimUniforms();
  const treeApi = initTree(scene, sharedUniforms, {
    uTrunkThickness: simUniforms.uTrunkThickness,
    uBranchDensity: simUniforms.uBranchDensity,
    uLeafDensity: simUniforms.uLeafDensity,
    uCurvature: simUniforms.uCurvature,
    uFruitAmount: simUniforms.uFruitAmount,
  });

  /* 远景星点 */
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
  const starMat = new THREE.PointsMaterial({ color: 0x6a5088, size: 0.035, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  const mkTex = (data) => {
    const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    return t;
  };
  const mkRT = () => new THREE.WebGLRenderTarget(SIZE, SIZE, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.FloatType });

  const initPos = new Float32Array(COUNT * 4);
  const initVel = new Float32Array(COUNT * 4);
  const r0 = simUniforms.uSeedRadius.value;
  for (let i = 0; i < COUNT; i++) {
    const a1 = Math.random() * Math.PI * 2, a2 = Math.random() * Math.PI * 2;
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
      uHueShift: uHueShift,
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

  const camRig = { angle: 0, radius: 4.1, baseY: 0.55, breathe: 0, growthNudge: 0 };

  gsap.to(camRig, { angle: Math.PI * 2, duration: 56, repeat: -1, ease: 'none' });
  gsap.to(camRig, { breathe: 0.07, duration: 3.8, yoyo: true, repeat: -1, ease: 'sine.inOut' });

  function updateCamera() {
    const g = sharedUniforms.uGrowthProgress.value;
    const rad = THREE.MathUtils.lerp(4.0, 2.45, THREE.MathUtils.smoothstep(g, 0, 1)) + camRig.breathe + camRig.growthNudge;
    const yy = THREE.MathUtils.lerp(0.48, 1.25, THREE.MathUtils.smoothstep(g, 0, 1)) + camRig.breathe * 0.45;
    camera.position.set(Math.sin(camRig.angle) * rad, yy, Math.cos(camRig.angle) * rad);
    const focusY = THREE.MathUtils.lerp(0.08, 0.52, THREE.MathUtils.smoothstep(g, 0, 1));
    camera.lookAt(0, focusY, 0);
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    bloomPass.resolution.set(w, h);
    afterimagePass.uniforms.resolution?.value?.set(w, h);
  }
  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.06);
    const t = clock.elapsedTime;
    const g = sharedUniforms.uGrowthProgress.value;
    simUniforms.uSeedRadius.value = THREE.MathUtils.lerp(0.28, 1.15, THREE.MathUtils.smoothstep(g, 0, 1));
    gpgpuStep(dt, t);
    updateCamera();
    composer.render(dt);
  }

  function playIntroAnimation() {
    simUniforms.uIntroBurst.value = 1.0;
    simUniforms.uCurlStrength.value = 1.35;
    bloomPass.strength = 2.35;
    gsap.to(simUniforms.uIntroBurst, { value: 0, duration: 2.9, ease: 'power2.out' });
    gsap.to(simUniforms.uCurlStrength, { value: 0.48, duration: 3.3, ease: 'power1.out' });
    gsap.to(bloomPass, { strength: 1.12, duration: 3.6, ease: 'power1.out' });
    const overlay = document.getElementById('intro-overlay');
    if (overlay) gsap.delayedCall(1.0, () => overlay.classList.add('fade-out'));
  }

  const api = {
    simUniforms,
    sharedUniforms,
    particleMaterial,
    treeApi,
    camera,
    bloomPass,
    afterimagePass,
    uHueShift,
  };

  initControls(api, camRig);
  playIntroAnimation();
  animate();
}

main().catch(console.error);

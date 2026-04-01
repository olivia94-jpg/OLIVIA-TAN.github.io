// core-entry.js
import * as THREE3 from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import gsap3 from "gsap";

// particles.js
import * as THREE2 from "three";
import gsap from "gsap";

// tree.js
import * as THREE from "three";
function evaluateGrowth(growth) {
  const g = Math.max(0, growth);
  const gBase = THREE.MathUtils.clamp(g, 0, 1);
  const gExtra = Math.max(0, g - 1);
  const canopyH = 0.35 + gBase * 1.45 + gExtra * 0.55;
  const canopyR = 0.2 + gBase * 0.95 + gExtra * 0.35;
  return { canopyH, canopyR, gBase, gExtra };
}
function getFruitAnchorPosition(growth, seed, target = new THREE.Vector3()) {
  const { canopyH, canopyR } = evaluateGrowth(growth);
  const s = Math.sin(seed * 127.1) * 43758.5453123;
  const t = s - Math.floor(s);
  const u = Math.sin(seed * 19.19 + 3.7) * 0.5 + 0.5;
  const a = t * Math.PI * 2;
  const b = u * Math.PI;
  const r = canopyR * (0.45 + 0.55 * Math.abs(Math.sin(seed * 0.73)));
  target.set(
    Math.cos(a) * Math.sin(b) * r,
    canopyH * (0.55 + 0.45 * u) + Math.sin(seed) * 0.08,
    Math.sin(a) * Math.sin(b) * r
  );
  return target;
}
function initTree(scene, sharedUniforms, _shapeUniforms) {
  const group = new THREE.Group();
  scene.add(group);
  return {
    group,
    points: null,
    material: null,
    setGrowthProgress(progress) {
      sharedUniforms.uGrowthProgress.value = Math.max(0, progress);
    },
    getCanopyWorldPosition(target = new THREE.Vector3()) {
      const { canopyH } = evaluateGrowth(sharedUniforms.uGrowthProgress.value);
      target.set(0, canopyH * 0.88, 0);
      group.localToWorld(target);
      return target;
    },
    dispose() {
      scene.remove(group);
    }
  };
}

// particles.js
var PARTICLE_SIM_TEXTURE_SIZE = 192;
var phaseId = 0;
function setParticlePhase(name) {
  phaseId = { idle: 0, burst: 1, attract: 2, spiral: 3, fracture: 4 }[name] ?? 0;
}
function getPhaseId() {
  return phaseId;
}
var SIMPLEX4D = (
  /* glsl */
  `
vec4 mod289(vec4 x){return x - floor(x*(1./289.))*289.;}
float mod289(float x){return x - floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289((x*34.+10.)*x);}
float permute(float x){return mod289((x*34.+10.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float taylorInvSqrt(float r){return 1.79284291400159 - 0.85373472095314*r;}
vec4 grad4(float j, vec4 ip){
  vec4 p;
  p.xyz = floor(fract(vec3(j)*ip.xyz)*7.)*ip.z - 1.;
  p.w = 1.5 - dot(abs(p.xyz), vec3(1.));
  vec4 s = vec4(lessThan(p, vec4(0.)));
  p.xyz = p.xyz + (s.xyz*2.-1.)*s.www;
  return p;
}
float snoise4(vec4 v){
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  vec4 i = floor(v+dot(v,vec4(0.309016994374947451)));
  vec4 x0 = v - i + dot(i,C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x+isX.y+isX.z;
  i0.yzw = 1.-isX;
  i0.y += isYZ.x+isYZ.y;
  i0.zw += 1.-isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.-isYZ.z;
  vec4 i3 = clamp(i0, 0., 1.);
  vec4 i2 = clamp(i0 - 1., 0., 1.);
  vec4 i1 = clamp(i0 - 2., 0., 1.);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w)+i.z)+i.y)+i.x);
  vec4 j1 = permute(permute(permute(permute(
    i.w+vec4(i1.w,i2.w,i3.w,1.))+i.z+vec4(i1.z,i2.z,i3.z,1.))+i.y+vec4(i1.y,i2.y,i3.y,1.))+i.x+vec4(i1.x,i2.x,i3.x,1.));
  vec4 ip = vec4(1./294., 1./49., 1./7., 0.);
  vec4 p0 = grad4(j0,ip);
  vec4 p1 = grad4(j1.x,ip);
  vec4 p2 = grad4(j1.y,ip);
  vec4 p3 = grad4(j1.z,ip);
  vec4 p4 = grad4(j1.w,ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4,p4));
  vec3 m0 = max(0.6 - vec3(dot(x0,x0),dot(x1,x1),dot(x2,x2)),0.);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3),dot(x4,x4)),0.);
  m0 = m0*m0; m1 = m1*m1;
  return 49.*(dot(m0*m0, vec3(dot(p0,x0),dot(p1,x1),dot(p2,x2)))+ dot(m1*m1, vec2(dot(p3,x3),dot(p4,x4))));
}
`
);
var NEURAL_FIELD_GLSL = (
  /* glsl */
  `
${SIMPLEX4D}

float fbm4(vec4 v, int octaves, float lacunarity, float gain){
  float sum = 0.0, amp = 0.5;
  for(int i = 0; i < 8; i++){
    if(i >= octaves) break;
    sum += amp * snoise4(v);
    v *= lacunarity;
    amp *= gain;
  }
  return sum;
}

vec3 curlNoise(vec3 p, float t, float scale){
  float e = 0.0024;
  vec4 base = vec4(p * scale, t);
  float dx = fbm4(base + vec4(e,0,0,0), 4, 2.05, 0.5) - fbm4(base - vec4(e,0,0,0), 4, 2.05, 0.5);
  float dy = fbm4(base + vec4(0,e,0,0), 4, 2.05, 0.5) - fbm4(base - vec4(0,e,0,0), 4, 2.05, 0.5);
  float dz = fbm4(base + vec4(0,0,e,0), 4, 2.05, 0.5) - fbm4(base - vec4(0,0,e,0), 4, 2.05, 0.5);
  float inv = 1.0 / (2.0 * e);
  return vec3(dy - dz, dz - dx, dx - dy) * inv;
}

vec3 simplexForce(vec3 p, float t, float gain){
  vec3 s = vec3(
    snoise4(vec4(p * 1.38, t * 0.42)),
    snoise4(vec4(p * 1.38 + vec3(5.2, 3.1, 1.7), t * 0.37)),
    snoise4(vec4(p * 1.38 + vec3(11.3, 7.9, 2.4), t * 0.41))
  );
  return s * gain;
}

vec3 computeNeuralAcceleration(
  vec3 pos,
  float t,
  float dt,
  float g,
  float noiseIntensity,
  float noiseScale,
  float curlStr,
  float curlBoost,
  float attractBoost,
  float attractStrength,
  float branchTightness,
  float branchRibs,
  float canopySpread,
  float curvatureAmount,
  float fruitStrength,
  int phase,
  float typingPulse,
  float introBurst
){
  float gBase = clamp(g, 0.0, 1.0);
  float gExtra = max(g - 1.0, 0.0);
  vec3 F = vec3(0.0);

  float nGain = noiseIntensity * noiseScale * max(0.08, curlStr) * curlBoost;
  F += curlNoise(pos, t * 0.28, 1.12) * nGain;
  F += curlNoise(pos * 1.82 + vec3(2.1, 0.0, 1.7), t * 0.36, 1.95 * noiseScale) * nGain * 0.48;
  F += simplexForce(pos, t, noiseIntensity * noiseScale * 0.5);

  float r = length(pos);
  vec3 centerDir = -normalize(pos + vec3(1e-5));
  float coreGlow = exp(-r * (1.8 + (1.0 - gBase) * 0.6));
  float corePull = smoothstep(1.25, 0.0, r) * (0.55 + 0.45 * gBase) + coreGlow * 0.35;
  F += centerDir * attractStrength * attractBoost * corePull * (0.9 + curvatureAmount * 0.15);

  float xy = length(pos.xz);
  vec3 toAxis = vec3(-pos.x, 0.0, -pos.z) / max(xy, 1e-4);
  float trunkPhase = smoothstep(-0.35, 0.55, pos.y) * (1.0 - smoothstep(0.85 + gExtra * 0.2, 1.45, pos.y));
  float trunkW = trunkPhase * (0.4 + 0.6 * gBase) * (0.35 + branchTightness * 8.0);
  F += toAxis * attractStrength * attractBoost * trunkW * 2.2;

  float branchAngle = atan(pos.z, pos.x);
  float ribs = 4.0 + branchRibs * 7.0;
  float wave = sin(branchAngle * ribs + pos.y * (1.1 + branchRibs) + t * 0.45);
  vec3 radialXZ = normalize(vec3(pos.x, 0.0, pos.z) + vec3(1e-4));
  float canopy = smoothstep(0.12, 0.35, pos.y) * smoothstep(0.0, 1.0, gBase) * (0.55 + canopySpread * 0.45);
  F += radialXZ * wave * canopy * branchRibs * 0.85;
  F += vec3(0.0, 1.0, 0.0) * canopy * 0.32 * canopySpread;

  float fruitMod = 0.08 + fruitStrength * 0.12;
  F += radialXZ * sin(t * 0.7 + r * 3.0) * fruitMod * smoothstep(0.2, 0.9, pos.y);

  if(phase == 1){
    F += normalize(pos + vec3(1e-4)) * nGain * 3.2;
    F += curlNoise(pos * 0.88, t * 1.15, 0.78) * nGain * 1.65;
  }
  if(phase == 2){
    F += centerDir * attractStrength * attractBoost * smoothstep(1.1, 0.0, r) * 0.95;
    F += toAxis * attractStrength * attractBoost * trunkW * 1.1;
  }

  if(typingPulse > 0.01){
    F += normalize(pos + vec3(1e-4)) * sin(r * 7.5 - t * 12.0) * typingPulse * 0.75;
    F += curlNoise(pos * 2.6, t * 1.75, noiseScale) * typingPulse * 0.5;
  }
  if(introBurst > 0.01){
    F += normalize(pos + vec3(1e-4)) * introBurst * 5.0;
    F += curlNoise(pos * 0.82, t * 0.52, noiseScale * 0.55) * introBurst * 2.8;
  }

  return F;
}
`
);
var VEL_UNIFORMS = (
  /* glsl */
  `
uniform float uDelta;
uniform float uTime;
uniform float uDamping;
uniform float uGrowthProgress;
uniform float uNoiseIntensity;
uniform float uNoiseScale;
uniform float uCurlStrength;
uniform float uCurlBoost;
uniform float uAttractBoost;
uniform float uAttractStrength;
uniform float uBranchTightness;
uniform float uBranchRibs;
uniform float uCanopySpread;
uniform float uCurvature;
uniform float uFruitAmount;
uniform float uPhase;
uniform float uTypingPulse;
uniform float uIntroBurst;
uniform sampler2D tPos;
uniform sampler2D tVel;
`
);
function createParticleSimUniforms() {
  return {
    uDelta: { value: 0 },
    uTime: { value: 0 },
    uDamping: { value: 0.94 },
    uGrowthProgress: { value: 0 },
    uNoiseIntensity: { value: 0.88 },
    uNoiseScale: { value: 1.25 },
    uCurlStrength: { value: 0.48 },
    uCurlBoost: { value: 1 },
    uAttractBoost: { value: 1 },
    uAttractStrength: { value: 2.85 },
    uBranchTightness: { value: 0.12 },
    uBranchRibs: { value: 0.72 },
    uCanopySpread: { value: 0.84 },
    uCurvature: { value: 0.55 },
    uFruitAmount: { value: 0.5 },
    uPhase: { value: 0 },
    uSeedRadius: { value: 0.42 },
    uTypingPulse: { value: 0 },
    uIntroBurst: { value: 0 },
    uLineDistBase: { value: 0.16 },
    uLineOpacityMul: { value: 0.52 },
    uLineBrightness: { value: 1.15 },
    uParticleActiveRatio: { value: 0.92 }
  };
}
function createVelocityStepMaterial(u) {
  const mat = new THREE2.ShaderMaterial({
    uniforms: {},
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
    fragmentShader: (
      /* glsl */
      `
      precision highp float;
      ${VEL_UNIFORMS}
      varying vec2 vUv;
      ${NEURAL_FIELD_GLSL}
      void main(){
        vec4 pData = texture2D(tPos, vUv);
        vec3 pos = pData.xyz;
        vec3 vel = texture2D(tVel, vUv).xyz;
        float g = max(0.0, uGrowthProgress);
        int ph = int(uPhase + 0.5);

        vec3 F = computeNeuralAcceleration(
          pos, uTime, uDelta, g,
          uNoiseIntensity, uNoiseScale, uCurlStrength, uCurlBoost, uAttractBoost, uAttractStrength,
          uBranchTightness, uBranchRibs, uCanopySpread, uCurvature, uFruitAmount,
          ph, uTypingPulse, uIntroBurst
        );

        vel = vel * uDamping + F * uDelta;
        float sp = length(vel);
        if(sp > 10.0) vel *= 10.0 / sp;

        gl_FragColor = vec4(vel, 1.0);
      }
    `
    )
  });
  mat.uniforms = u;
  return mat;
}
function createPositionStepMaterial(uniforms) {
  const mat = new THREE2.ShaderMaterial({
    uniforms: {},
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
    fragmentShader: (
      /* glsl */
      `
      precision highp float;
      uniform float uDelta;
      uniform float uSeedRadius;
      uniform float uGrowthProgress;
      uniform sampler2D tPos;
      uniform sampler2D tVel;
      varying vec2 vUv;
      void main(){
        vec4 pd = texture2D(tPos, vUv);
        vec3 pos = pd.xyz;
        float life = pd.w;
        vec3 vel = texture2D(tVel, vUv).xyz;
        pos += vel * uDelta;
        life -= uDelta * 0.082;
        if(life < 0.0){
          float a1 = fract(sin(dot(vUv, vec2(12.9898,78.233)))*43758.5453) * 6.28318;
          float a2 = fract(sin(dot(vUv, vec2(93.989,27.345)))*23421.631) * 6.28318;
          float r = uSeedRadius * (0.28 + 0.72 * fract(sin(dot(vUv, vec2(45.23,97.81)))*65432.1));
          pos = vec3(cos(a1)*cos(a2), sin(a2)*0.52, sin(a1)*cos(a2)) * r;
          life = 0.72 + 0.38 * fract(sin(dot(vUv, vec2(17.42, 63.91)))*12345.67);
        }
        float g = max(0.0, uGrowthProgress);
        float gBase = clamp(g, 0.0, 1.0);
        float gExtra = max(g - 1.0, 0.0);
        float lim = mix(uSeedRadius * 8.5, 7.8, gBase) + gExtra * 2.0;
        float L = length(pos);
        if(L > lim) pos *= lim / max(L, 1e-4);
        gl_FragColor = vec4(pos, life);
      }
    `
    )
  });
  mat.uniforms = uniforms;
  return mat;
}
function createNeuralLineSystem(scene, renderer, texSize, _stride) {
  const particleCount = texSize * texSize;
  const maxSeg = Math.min(1e4, Math.floor(particleCount * 2.2));
  const positions = new Float32Array(maxSeg * 6);
  const geo = new THREE2.BufferGeometry();
  const posAttr = new THREE2.BufferAttribute(positions, 3).setUsage(THREE2.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setDrawRange(0, 0);
  const mat = new THREE2.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.5 },
      uBrightness: { value: 1.1 }
    },
    vertexShader: (
      /* glsl */
      `
      varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = smoothstep(-12.0, -2.0, mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `
    ),
    fragmentShader: (
      /* glsl */
      `
      precision highp float;
      uniform float uOpacity;
      uniform float uBrightness;
      varying float vDepth;
      void main() {
        float a = uOpacity * (0.65 + 0.35 * vDepth);
        gl_FragColor = vec4(vec3(uBrightness), a);
      }
    `
    ),
    transparent: true,
    blending: THREE2.AdditiveBlending,
    depthWrite: false,
    depthTest: false
  });
  const lines = new THREE2.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  const readBuf = new Float32Array(texSize * texSize * 4);
  let frameSkip = 0;
  const cellMap = /* @__PURE__ */ new Map();
  function update(posRT, growth, uSim) {
    frameSkip = (frameSkip + 1) % 2;
    if (frameSkip !== 0) return;
    renderer.readRenderTargetPixels(posRT, 0, 0, texSize, texSize, readBuf);
    const th = uSim.uLineDistBase.value * (0.32 + Math.min(1.2, growth) * 0.95 + Math.max(0, growth - 1) * 0.22);
    const cell = Math.max(0.11, th * 0.75);
    cellMap.clear();
    for (let i = 0; i < particleCount; i++) {
      const o = i * 4;
      const x = readBuf[o];
      const y = readBuf[o + 1];
      const z = readBuf[o + 2];
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const cz = Math.floor(z / cell);
      const key = cx + "," + cy + "," + cz;
      let arr = cellMap.get(key);
      if (!arr) {
        arr = [];
        cellMap.set(key, arr);
      }
      arr.push(i);
    }
    let seg = 0;
    const th2 = th * th;
    for (let i = 0; i < particleCount && seg < maxSeg; i++) {
      const oi = i * 4;
      const x0 = readBuf[oi];
      const y0 = readBuf[oi + 1];
      const z0 = readBuf[oi + 2];
      const cx = Math.floor(x0 / cell);
      const cy = Math.floor(y0 / cell);
      const cz = Math.floor(z0 / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const arr = cellMap.get(cx + dx + "," + (cy + dy) + "," + (cz + dz));
            if (!arr) continue;
            for (let k = 0; k < arr.length; k++) {
              const j = arr[k];
              if (j <= i) continue;
              const oj = j * 4;
              const ax = readBuf[oj] - x0;
              const ay = readBuf[oj + 1] - y0;
              const az = readBuf[oj + 2] - z0;
              const d2 = ax * ax + ay * ay + az * az;
              if (d2 < th2 && d2 > 1e-10) {
                const o = seg * 6;
                positions[o] = x0;
                positions[o + 1] = y0;
                positions[o + 2] = z0;
                positions[o + 3] = readBuf[oj];
                positions[o + 4] = readBuf[oj + 1];
                positions[o + 5] = readBuf[oj + 2];
                seg++;
                if (seg >= maxSeg) break;
              }
            }
            if (seg >= maxSeg) break;
          }
          if (seg >= maxSeg) break;
        }
        if (seg >= maxSeg) break;
      }
    }
    posAttr.needsUpdate = true;
    geo.setDrawRange(0, seg * 2);
    mat.uniforms.uOpacity.value = uSim.uLineOpacityMul.value;
    mat.uniforms.uBrightness.value = uSim.uLineBrightness.value;
  }
  return { lines, update };
}
function createFruitPoints(radius, count, pointSize, opacity = 0.95) {
  const geo = new THREE2.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const th = u * Math.PI * 2;
    const ph = Math.acos(2 * v - 1);
    const r = radius * (0.45 + 0.55 * Math.random());
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
    pos[i * 3 + 1] = Math.cos(ph) * r;
    pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
    seed[i] = Math.random();
  }
  geo.setAttribute("position", new THREE2.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE2.BufferAttribute(seed, 1));
  const mat = new THREE2.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: pointSize },
      uOpacity: { value: opacity },
      uHueShift: { value: 0 },
      uGlow: { value: 1 }
    },
    vertexShader: (
      /* glsl */
      `
      uniform float uTime;
      uniform float uSize;
      uniform float uHueShift;
      attribute float aSeed;
      varying vec3 vColor;
      varying float vAlpha;
      vec3 toneShift(vec3 col, float shift){
        float a = shift * 6.28318;
        return clamp(col * vec3(
          0.9 + 0.2 * sin(a),
          0.9 + 0.2 * sin(a + 2.094),
          0.9 + 0.2 * sin(a + 4.189)
        ), 0.0, 1.0);
      }
      void main(){
        vec3 p = position;
        float sp = sin(uTime * 1.5 + aSeed * 12.0);
        p += normalize(position + 1e-5) * sp * 0.01;
        vec3 gold = vec3(1.0, 0.82, 0.38);
        vec3 cyan = vec3(0.35, 0.85, 0.95);
        vec3 pink = vec3(0.92, 0.45, 0.88);
        vec3 base = mix(gold, cyan, smoothstep(0.2, 0.7, aSeed));
        base = mix(base, pink, smoothstep(0.6, 1.0, aSeed));
        vColor = toneShift(base, uHueShift);
        vAlpha = 0.65 + 0.35 * sin(uTime * 2.0 + aSeed * 8.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (220.0 / (-mv.z + 1.0));
      }
    `
    ),
    fragmentShader: (
      /* glsl */
      `
      precision highp float;
      uniform float uOpacity;
      uniform float uGlow;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        if(d > 0.5) discard;
        float soft = exp(-d * (5.0 + uGlow * 2.0));
        float thorn = smoothstep(0.45, 0.0, abs(sin(atan(q.y, q.x) * 6.0)) * d;
        gl_FragColor = vec4(vColor * (1.0 + thorn * 0.45), uOpacity * vAlpha * soft);
      }
    `
    ),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE2.AdditiveBlending
  });
  const pts = new THREE2.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
function createFruitSystem(scene, camera, domElement) {
  const root = new THREE2.Group();
  scene.add(root);
  const raycaster = new THREE2.Raycaster();
  raycaster.params.Points.threshold = 0.22;
  const pointer = new THREE2.Vector2();
  const smallFruits = [];
  const blossoms = [];
  let finalFruit = null;
  let onSmallFruitClick = null;
  function setOnSmallFruitClick(cb) {
    onSmallFruitClick = cb;
  }
  function addSmallFruit(growth, index, hueShift = 0) {
    if (smallFruits.length >= 8) {
      const old = smallFruits.shift();
      if (old) {
        root.remove(old.points);
        old.points.geometry.dispose();
        old.points.material.dispose();
      }
    }
    const anchor = getFruitAnchorPosition(growth, index + performance.now() * 1e-3, new THREE2.Vector3());
    const points = createFruitPoints(0.13 + Math.random() * 0.06, 86, 10, 0.98);
    points.position.copy(anchor);
    points.userData.kind = "smallFruit";
    points.userData.index = index;
    points.material.uniforms.uHueShift.value = hueShift;
    root.add(points);
    smallFruits.push({ points, born: performance.now() * 1e-3 });
    return points;
  }
  function spawnBlossom(growth) {
    for (let i = 0; i < 14; i++) {
      const p = createFruitPoints(0.08 + Math.random() * 0.07, 32, 8.5, 0.92);
      p.position.copy(getFruitAnchorPosition(growth, i + Math.random() * 30, new THREE2.Vector3()));
      p.material.uniforms.uGlow.value = 1.8;
      p.material.uniforms.uHueShift.value = 0.2 + Math.random() * 0.5;
      root.add(p);
      blossoms.push(p);
      gsap.to(p.material.uniforms.uOpacity, {
        value: 0,
        duration: 1.8,
        ease: "power2.out",
        onComplete: () => {
          root.remove(p);
          p.geometry.dispose();
          p.material.dispose();
        }
      });
    }
  }
  function spawnFinalFruit(growth) {
    if (finalFruit) return Promise.resolve();
    const start = getFruitAnchorPosition(Math.max(growth, 1), 777.7, new THREE2.Vector3());
    const points = createFruitPoints(0.3, 260, 14, 1);
    points.position.copy(start);
    points.material.uniforms.uGlow.value = 2.2;
    points.material.uniforms.uHueShift.value = 0.28;
    points.userData.kind = "finalFruit";
    root.add(points);
    finalFruit = points;
    const c1 = start.clone().add(new THREE2.Vector3((Math.random() - 0.5) * 1.8, 0.95, (Math.random() - 0.5) * 1.8));
    const end = new THREE2.Vector3(0, -1.85, 0.35);
    return new Promise((resolve) => {
      const driver = { t: 0, rot: 0 };
      gsap.to(driver, {
        t: 1,
        rot: Math.PI * 2.4,
        duration: 1.85,
        ease: "power2.in",
        onUpdate: () => {
          const t = driver.t;
          const omt = 1 - t;
          points.position.set(
            omt * omt * start.x + 2 * omt * t * c1.x + t * t * end.x,
            omt * omt * start.y + 2 * omt * t * c1.y + t * t * end.y - 0.45 * t * t,
            omt * omt * start.z + 2 * omt * t * c1.z + t * t * end.z
          );
          points.rotation.y = driver.rot;
          points.rotation.x = driver.rot * 0.35;
        },
        onComplete: () => {
          gsap.to(points.material.uniforms.uOpacity, {
            value: 0,
            duration: 0.45,
            onComplete: () => {
              root.remove(points);
              points.geometry.dispose();
              points.material.dispose();
              finalFruit = null;
              resolve();
            }
          });
        }
      });
    });
  }
  function resetAll() {
    for (const f of smallFruits) {
      root.remove(f.points);
      f.points.geometry.dispose();
      f.points.material.dispose();
    }
    smallFruits.length = 0;
    for (const b of blossoms) {
      root.remove(b);
      b.geometry.dispose();
      b.material.dispose();
    }
    blossoms.length = 0;
    if (finalFruit) {
      root.remove(finalFruit);
      finalFruit.geometry.dispose();
      finalFruit.material.dispose();
      finalFruit = null;
    }
  }
  function handlePointer(clientX, clientY) {
    const rect = domElement.getBoundingClientRect();
    pointer.x = (clientX - rect.left) / rect.width * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const objs = smallFruits.map((f) => f.points);
    const hit = raycaster.intersectObjects(objs, false)[0];
    if (hit?.object?.userData?.kind === "smallFruit") {
      const idx = hit.object.userData.index;
      if (onSmallFruitClick) onSmallFruitClick(idx);
      return true;
    }
    return false;
  }
  function update(time, hueShift = 0) {
    for (let i = 0; i < smallFruits.length; i++) {
      const s = smallFruits[i];
      s.points.material.uniforms.uTime.value = time + i * 0.31;
      s.points.material.uniforms.uHueShift.value = hueShift;
      const pulse = 1 + 0.05 * Math.sin(time * 1.7 + i);
      s.points.scale.setScalar(pulse);
    }
    for (let i = 0; i < blossoms.length; i++) {
      blossoms[i].material.uniforms.uTime.value = time + i * 0.2;
      blossoms[i].rotation.y += 0.01;
    }
    if (finalFruit) {
      finalFruit.material.uniforms.uTime.value = time;
    }
  }
  return {
    addSmallFruit,
    spawnBlossom,
    spawnFinalFruit,
    resetAll,
    handlePointer,
    setOnSmallFruitClick,
    update,
    getSmallFruitCount: () => smallFruits.length
  };
}

// controls-ui.js
import gsap2 from "gsap";
var DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
var DEEPSEEK_MODEL = "deepseek-chat";
var SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u4F4D\u6E29\u548C\u3001\u4E13\u4E1A\u3001\u6709\u540C\u7406\u5FC3\u7684\u7075\u611F\u5F15\u5BFC\u5E08\u3002\u7528\u6237\u4F1A\u7528\u8BED\u97F3\u6216\u6587\u5B57\u544A\u8BC9\u4F60\u7A81\u7136\u5192\u51FA\u7684\u7075\u611F\u3002
\u4F60\u7684\u804C\u8D23\u662F\u4E00\u6B65\u6B65\u5F15\u5BFC\u7528\u6237\u68B3\u7406\u601D\u8DEF\uFF1A\u5148\u503E\u542C\uFF0C\u518D\u8FFD\u95EE\u5173\u952E\u7EC6\u8282\uFF0C\u5E2E\u52A9\u7528\u6237\u4ECE\u6A21\u7CCA\u60F3\u6CD5\u8D70\u5411\u53EF\u6267\u884C\u8BA1\u5212\u3002
\u6BCF\u6B21\u56DE\u590D\u63A7\u5236\u5728 2-4 \u53E5\u8BDD\u4EE5\u5185\uFF0C\u8BED\u6C14\u6E29\u6696\u4F46\u4E0D\u5570\u55E6\u3002\u5584\u7528\u53CD\u95EE\u6765\u6FC0\u53D1\u66F4\u6DF1\u5C42\u601D\u8003\u3002`;
var CARD_SYSTEM_PROMPT = `\u4F60\u662F\u300C\u4ECA\u65E5\u7075\u611F\u5361\u7247\u300D\u751F\u6210\u5668\u3002\u7528\u6237\u4F1A\u63D0\u4F9B\u4ED6\u4E0E AI \u5BFC\u5E08\u4E4B\u95F4\u7684\u5B8C\u6574\u4E2D\u6587\u5BF9\u8BDD\u3002
\u4F60\u5FC5\u987B\u4E25\u683C\u6839\u636E\u5BF9\u8BDD\u4E2D\u771F\u5B9E\u51FA\u73B0\u7684\u5185\u5BB9\u8FDB\u884C\u603B\u7ED3\uFF0C\u4E0D\u8981\u7F16\u9020\u5BF9\u8BDD\u91CC\u6CA1\u6709\u7684\u4E3B\u9898\u6216\u7EC6\u8282\u3002
\u8F93\u51FA\u5FC5\u987B\u662F\u5408\u6CD5 JSON\uFF0C\u4E14\u4EC5\u5305\u542B\u4E09\u4E2A\u5B57\u6BB5\uFF1A
- title: \u7B80\u77ED\u6807\u9898\uFF08\u4E0D\u8D85\u8FC7 8 \u4E2A\u6C49\u5B57\uFF09
- bullets: \u5B57\u7B26\u4E32\u6570\u7EC4\uFF0C3-8 \u6761\uFF0C\u6309\u65F6\u95F4\u987A\u5E8F\u603B\u7ED3\u4E3B\u8981\u6D1E\u5BDF
- actions: \u5B57\u7B26\u4E32\u6570\u7EC4\uFF0C2-6 \u6761\uFF0C\u6BCF\u6761\u4E3A\u5177\u4F53\u53EF\u6267\u884C\u7684\u5C0F\u884C\u52A8
\u4E0D\u8981\u8F93\u51FA markdown\u3001\u4EE3\u7801\u5757\u6216\u5176\u5B83\u6587\u5B57\uFF0C\u53EA\u8F93\u51FA\u4E00\u884C JSON\u3002`;
var FALLBACK_REPLIES = [
  "\u5148\u6162\u6162\u8BF4\uFF1A\u8FD9\u4E2A\u7075\u611F\u7B2C\u4E00\u6B21\u51FA\u73B0\u65F6\uFF0C\u4F60\u6700\u5F3A\u70C8\u7684\u611F\u53D7\u662F\u4EC0\u4E48\uFF1F",
  "\u5982\u679C\u628A\u5B83\u4EEC\u8FDE\u6210\u4E00\u6761\u7EBF\uFF0C\u4F60\u89C9\u5F97\u4E2D\u95F4\u7F3A\u7684\u662F\u54EA\u4E00\u6B65\uFF1F",
  "\u6709\u6CA1\u6709\u4E00\u4E2A\u6700\u5C0F\u3001\u672C\u5468\u5C31\u80FD\u505A\u7684\u5C1D\u8BD5\uFF1F",
  "\u6211\u4EEC\u8BD5\u7740\u7528\u4E00\u53E5\u8BDD\u6982\u62EC\uFF1A\u8FD9\u4EF6\u4E8B\u5BF9\u4F60\u771F\u6B63\u91CD\u8981\u7684\u662F\u4EC0\u4E48\uFF1F"
];
function getApiKey() {
  const el = document.getElementById("ds-key");
  return el ? el.value.trim() : "";
}
async function fetchDeepSeek(messages) {
  const key = getApiKey();
  if (!key) return null;
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature: 0.35, max_tokens: 620 })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}
function buildLocalCard(transcript) {
  const bullets = transcript.map((m) => `${m.role === "user" ? "\u4F60" : "AI"}\uFF1A${m.text}`).slice(-10);
  return {
    title: "\u7075\u611F\u751F\u957F\u8BB0\u5F55",
    bullets: bullets.length ? bullets : ["\u5C1A\u672A\u5F62\u6210\u6709\u6548\u5BF9\u8BDD\u3002"],
    actions: ["\u6311\u4E00\u6761\u6700\u6709\u5171\u9E23\u7684\u60F3\u6CD5\uFF0C\u4ECA\u5929\u505A 15 \u5206\u949F\u5C1D\u8BD5", "\u628A\u60F3\u6CD5\u62C6\u6210\u53EF\u9A8C\u8BC1\u7684\u5C0F\u6B65\u9AA4"]
  };
}
function initControls(api, camRig) {
  const transcript = [];
  const exchanges = [];
  let state = "idle";
  let pendingUserText = "";
  const msgStream = document.getElementById("msg-stream");
  const splash = document.getElementById("splash-text");
  const textInput = document.getElementById("text-input");
  const btnSend = document.getElementById("btn-send");
  const btnVoice = document.getElementById("btn-voice");
  const btnEnd = document.getElementById("btn-end");
  const btnNewChat = document.getElementById("btn-new-chat");
  const panel = document.getElementById("control-panel");
  const statusEl = document.getElementById("status-line");
  const cardDock = document.getElementById("card-dock");
  const fruitDetail = document.getElementById("fruit-detail");
  const recognition = createRecognition();
  function setStatus(t) {
    if (statusEl) statusEl.textContent = t;
  }
  function addImmMsg(role, text) {
    if (!msgStream) return;
    const el = document.createElement("div");
    el.className = `imm-msg ${role === "user" ? "user-msg" : "ai-msg"}`;
    el.innerHTML = `<div class="msg-role">${role === "user" ? "\u4F60" : "AI"}</div><div>${text}</div>`;
    msgStream.appendChild(el);
    const all = msgStream.querySelectorAll(".imm-msg");
    if (all.length > 8) {
      const oldest = all[0];
      oldest.style.opacity = "0";
      setTimeout(() => oldest.remove(), 450);
    }
    setTimeout(() => el.classList.add("fading"), 12e3);
  }
  function runDialogueFX() {
    setParticlePhase("burst");
    api.simUniforms.uCurlBoost.value = 4.2;
    api.simUniforms.uAttractBoost.value = 0.65;
    gsap2.to(api.simUniforms.uCurlBoost, { value: 1, duration: 1.85, ease: "power2.out", delay: 0.12 });
    gsap2.to(api.simUniforms.uAttractBoost, { value: 1.35, duration: 0.55, ease: "power2.out", delay: 0.42 });
    gsap2.to(api.simUniforms.uAttractBoost, { value: 1, duration: 1.4, ease: "power1.inOut", delay: 0.95 });
    gsap2.delayedCall(0.45, () => setParticlePhase("attract"));
    gsap2.delayedCall(2.2, () => setParticlePhase("idle"));
    gsap2.fromTo(camRig, { growthNudge: 0 }, { growthNudge: 0.22, duration: 0.6, yoyo: true, repeat: 1, ease: "sine.inOut" });
  }
  function bumpGrowth(step = 0.23) {
    const next = api.sharedUniforms.uGrowthProgress.value + step;
    api.sharedUniforms.uGrowthProgress.value = next;
    api.treeApi.setGrowthProgress(next);
    state = next > 1 ? "overgrown" : "growing";
  }
  async function assistantReply() {
    const typing = document.createElement("div");
    typing.className = "imm-msg ai-msg";
    typing.style.opacity = "0.5";
    typing.innerHTML = '<div class="msg-role">AI</div><div>\u601D\u8003\u4E2D\u2026</div>';
    msgStream?.appendChild(typing);
    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...transcript.map((m) => ({ role: m.role, content: m.text }))];
    let text = await fetchDeepSeek(messages);
    if (!text) text = FALLBACK_REPLIES[transcript.length % FALLBACK_REPLIES.length];
    typing.remove();
    transcript.push({ role: "assistant", text });
    exchanges.push({ user: pendingUserText, ai: text });
    addImmMsg("assistant", text);
    bumpGrowth(0.23);
    runDialogueFX();
    api.fruitSystem.addSmallFruit(api.sharedUniforms.uGrowthProgress.value, exchanges.length - 1, api.uHueShift.value);
    setStatus("");
  }
  function handleUserInput(text) {
    const v = (text || "").trim();
    if (!v || state === "card") return;
    if (state === "idle") {
      state = "growing";
      splash?.classList.add("hidden");
    }
    pendingUserText = v;
    transcript.push({ role: "user", text: v });
    addImmMsg("user", v);
    api.simUniforms.uTypingPulse.value = 0.95;
    assistantReply();
  }
  async function requestSummary() {
    if (!transcript.length) return buildLocalCard(transcript);
    const local = buildLocalCard(transcript);
    const ctx = transcript.map((m) => `${m.role === "user" ? "\u7528\u6237" : "AI"}\uFF1A${m.text}`).join("\n");
    const raw = await fetchDeepSeek([
      { role: "system", content: CARD_SYSTEM_PROMPT },
      { role: "user", content: `\u4EE5\u4E0B\u4E3A\u5B8C\u6574\u5BF9\u8BDD\uFF0C\u8BF7\u636E\u6B64\u751F\u6210 JSON \u5361\u7247\uFF1A

${ctx}` }
    ]);
    if (!raw) return local;
    try {
      const clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const d = JSON.parse(clean);
      if (d?.title && Array.isArray(d?.bullets)) {
        return {
          title: d.title,
          bullets: d.bullets.filter(Boolean).slice(0, 10),
          actions: Array.isArray(d.actions) ? d.actions.filter(Boolean).slice(0, 8) : local.actions
        };
      }
    } catch {
    }
    return local;
  }
  function renderCard(card) {
    const ts = (/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { hour12: false });
    const wrap = document.createElement("div");
    wrap.className = "inspiration-card";
    wrap.innerHTML = `
      <header><h2 class="card-title"></h2><time></time></header>
      <section><h4>\u5B8C\u6574\u5BF9\u8BDD\u603B\u7ED3</h4><ul class="card-bullets"></ul></section>
      <section><h4>\u884C\u52A8\u8BA1\u5212</h4><ol class="card-actions"></ol></section>
      <div class="card-actions-row">
        <button type="button" class="card-dismiss">\u6536\u8D77</button>
        <button type="button" class="card-save">\u4FDD\u5B58</button>
        <button type="button" class="card-newchat">\u65B0\u5BF9\u8BDD</button>
      </div>`;
    wrap.querySelector(".card-title").textContent = card.title || "\u7075\u611F\u5361\u7247";
    wrap.querySelector("time").textContent = ts;
    const ul = wrap.querySelector(".card-bullets");
    const ol = wrap.querySelector(".card-actions");
    card.bullets.forEach((b) => {
      const li = document.createElement("li");
      li.textContent = b;
      ul.appendChild(li);
    });
    card.actions.forEach((a) => {
      const li = document.createElement("li");
      li.textContent = a;
      ol.appendChild(li);
    });
    wrap.querySelector(".card-dismiss").addEventListener("click", () => {
      cardDock?.classList.remove("card-visible");
      cardDock.innerHTML = "";
      state = "growing";
    });
    wrap.querySelector(".card-save").addEventListener("click", () => {
      const blob = new Blob([wrap.innerText], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `\u7075\u611F\u5361\u7247-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    wrap.querySelector(".card-newchat").addEventListener("click", resetChat);
    return wrap;
  }
  async function showHistoryCard() {
    const cardData = await requestSummary();
    const card = renderCard(cardData);
    cardDock.innerHTML = "";
    cardDock.appendChild(card);
    cardDock.classList.add("card-visible");
    gsap2.fromTo(card, { opacity: 0, y: 20, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power2.out" });
  }
  async function endSession() {
    if (!transcript.length || state === "card") return;
    state = "ending";
    api.fruitSystem.spawnBlossom(api.sharedUniforms.uGrowthProgress.value);
    await api.fruitSystem.spawnFinalFruit(api.sharedUniforms.uGrowthProgress.value);
    await showHistoryCard();
    state = "card";
    setParticlePhase("idle");
  }
  function resetChat() {
    transcript.length = 0;
    exchanges.length = 0;
    state = "idle";
    msgStream.innerHTML = "";
    cardDock.classList.remove("card-visible");
    cardDock.innerHTML = "";
    fruitDetail.classList.remove("visible");
    api.sharedUniforms.uGrowthProgress.value = 0;
    api.treeApi.setGrowthProgress(0);
    api.fruitSystem.resetAll();
    setParticlePhase("idle");
    splash?.classList.remove("hidden");
    setStatus("");
  }
  api.fruitSystem.setOnSmallFruitClick(async (idx) => {
    if (!exchanges[idx]) return;
    fruitDetail.querySelector(".fd-user .fd-text").textContent = exchanges[idx].user;
    fruitDetail.querySelector(".fd-ai .fd-text").textContent = exchanges[idx].ai;
    fruitDetail.classList.add("visible");
    await showHistoryCard();
  });
  textInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = textInput.value;
      textInput.value = "";
      handleUserInput(text);
    }
  });
  btnSend?.addEventListener("click", () => {
    const text = textInput?.value || "";
    if (textInput) textInput.value = "";
    handleUserInput(text);
  });
  btnEnd?.addEventListener("click", endSession);
  btnNewChat?.addEventListener("click", resetChat);
  window.addEventListener("tree:new-chat", resetChat);
  if (recognition) {
    btnVoice?.addEventListener("click", () => {
      try {
        recognition.start();
        btnVoice.classList.add("recording");
      } catch {
      }
    });
    recognition.onresult = (ev) => {
      const last = ev.results[ev.results.length - 1];
      const text = (last[0]?.transcript || "").trim();
      btnVoice?.classList.remove("recording");
      handleUserInput(text);
    };
    recognition.onerror = () => btnVoice?.classList.remove("recording");
    recognition.onend = () => btnVoice?.classList.remove("recording");
  }
  bindPanel(panel, api);
  return { resetChat };
}
function bindPanel(panel, api) {
  if (!panel) return;
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const apply = () => fn(parseFloat(el.value));
    el.addEventListener("input", apply);
    apply();
  };
  bind("sl-trunk", (v) => {
    api.simUniforms.uBranchTightness.value = v;
  });
  bind("sl-branch", (v) => {
    api.simUniforms.uBranchRibs.value = v;
  });
  bind("sl-leaf", (v) => {
    api.simUniforms.uCanopySpread.value = v;
  });
  bind("sl-fruit", (v) => {
    api.simUniforms.uFruitAmount.value = v;
  });
  bind("sl-noise", (v) => {
    api.simUniforms.uNoiseIntensity.value = v;
  });
  bind("sl-curl", (v) => {
    api.simUniforms.uCurlStrength.value = v;
  });
  bind("sl-attract", (v) => {
    api.simUniforms.uAttractStrength.value = v;
  });
  bind("sl-damp", (v) => {
    api.simUniforms.uDamping.value = v;
  });
  bind("sl-point", (v) => {
    api.particleMaterial.uniforms.uPointSize.value = v;
  });
  bind("sl-partcount", (v) => {
    api.simUniforms.uParticleActiveRatio.value = v;
  });
  bind("sl-line-dist", (v) => {
    api.simUniforms.uLineDistBase.value = v;
  });
  bind("sl-line-op", (v) => {
    api.simUniforms.uLineOpacityMul.value = v;
  });
  bind("sl-line-bright", (v) => {
    api.simUniforms.uLineBrightness.value = v;
  });
  bind("sl-bloom", (v) => {
    api.bloomPass.strength = v;
  });
  bind("sl-after", (v) => {
    const u = api.afterimagePass.uniforms;
    if (u?.damp) u.damp.value = v;
  });
}
function createRecognition() {
  const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  if (!SR) return null;
  const r = new SR();
  r.lang = "zh-CN";
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

// core-entry.js
var SIZE = PARTICLE_SIM_TEXTURE_SIZE;
var COUNT = SIZE * SIZE;
var SIM_TEX_TYPE = THREE3.FloatType;
var LINE_STRIDE = 8;
async function main() {
  const canvas = document.getElementById("main-canvas");
  if (!canvas) return;
  const renderer = new THREE3.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE3.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.outputColorSpace = THREE3.SRGBColorSpace;
  const scene = new THREE3.Scene();
  scene.background = new THREE3.Color(0);
  const camera = new THREE3.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 80);
  camera.position.set(0, 0.55, 4.1);
  const sharedUniforms = {
    uTime: { value: 0 },
    uGrowthProgress: { value: 0.16 }
  };
  const simUniforms = createParticleSimUniforms();
  const treeApi = initTree(scene, sharedUniforms, {});
  const fruitSystem = createFruitSystem(scene, camera, renderer.domElement);
  const mkTex = (data) => {
    const t = new THREE3.DataTexture(data, SIZE, SIZE, THREE3.RGBAFormat, SIM_TEX_TYPE);
    t.needsUpdate = true;
    t.magFilter = THREE3.NearestFilter;
    t.minFilter = THREE3.NearestFilter;
    return t;
  };
  const mkRT = () => new THREE3.WebGLRenderTarget(SIZE, SIZE, {
    minFilter: THREE3.NearestFilter,
    magFilter: THREE3.NearestFilter,
    format: THREE3.RGBAFormat,
    type: SIM_TEX_TYPE,
    depthBuffer: false,
    stencilBuffer: false
  });
  const initPos = new Float32Array(COUNT * 4);
  const initVel = new Float32Array(COUNT * 4);
  const r0 = simUniforms.uSeedRadius.value;
  for (let i = 0; i < COUNT; i++) {
    const a1 = Math.random() * Math.PI * 2;
    const a2 = Math.random() * Math.PI * 2;
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
  const quadGeo = new THREE3.PlaneGeometry(2, 2);
  const quadMesh = new THREE3.Mesh(quadGeo, velMat);
  const simScene = new THREE3.Scene();
  simScene.add(quadMesh);
  const simCam = new THREE3.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const lineSystem = createNeuralLineSystem(scene, renderer, SIZE, LINE_STRIDE);
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
  const pGeo = new THREE3.BufferGeometry();
  const refs = new Float32Array(COUNT * 2);
  for (let i = 0; i < COUNT; i++) {
    refs[i * 2] = (i % SIZE + 0.5) / SIZE;
    refs[i * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE;
  }
  pGeo.setAttribute("reference", new THREE3.BufferAttribute(refs, 2));
  const uHueShift = { value: 0 };
  const particleMaterial = new THREE3.ShaderMaterial({
    uniforms: {
      tPos: simUniforms.tPos,
      tVel: simUniforms.tVel,
      uPointSize: { value: 1.45 },
      uTime: sharedUniforms.uTime,
      uGrowthProgress: sharedUniforms.uGrowthProgress,
      uHueShift,
      uParticleActiveRatio: simUniforms.uParticleActiveRatio
    },
    vertexShader: (
      /* glsl */
      `
      uniform sampler2D tPos;
      uniform sampler2D tVel;
      uniform float uPointSize;
      uniform float uTime;
      uniform float uGrowthProgress;
      uniform float uHueShift;
      uniform float uParticleActiveRatio;
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

      float h11(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

      void main(){
        float gate = h11(reference * 499.21);
        if(gate > uParticleActiveRatio){
          gl_Position = vec4(0.0);
          gl_PointSize = 0.0;
          return;
        }

        vec4 pd = texture2D(tPos, reference);
        vec3 pos = pd.xyz;
        float life = pd.w;
        vec3 vel = texture2D(tVel, reference).xyz;
        float spd = length(vel);
        float g = uGrowthProgress;
        float gClamped = clamp(g, 0.0, 1.0);

        vec3 gold = vec3(1.0, 0.95, 0.82);
        vec3 cyan = vec3(0.55, 0.92, 1.0);
        vec3 pink = vec3(0.95, 0.55, 0.92);
        float w = smoothstep(0.0, 1.0, spd * 0.38) * 0.5 + pos.y * 0.1 + h11(reference * 57.0) * 0.18;
        vec3 base = mix(gold, cyan, smoothstep(0.0, 0.55, w));
        base = mix(base, pink, smoothstep(0.35, 1.0, w));
        base = toneShift(base, uHueShift);
        float r = length(pos);
        float core = exp(-r * 2.8);
        base += vec3(0.15, 0.12, 0.1) * core;
        float gExtra = max(uGrowthProgress - 1.0, 0.0);
        float bright = 0.32 + 0.5 * smoothstep(0.0, 0.95, gClamped) + gExtra * 0.1 + core * 0.35;
        vColor = base * bright * (0.78 + 0.15 * smoothstep(0.5, 5.0, spd));
        vAlpha = smoothstep(0.0, 0.14, life) * (0.68 + 0.1 * sin(uTime * 1.15 + reference.x * 40.0));

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float persp = 220.0 / max(1.35, (-mv.z + 1.0));
        gl_PointSize = clamp(uPointSize * persp, 1.0, 10.0);
      }
    `
    ),
    fragmentShader: (
      /* glsl */
      `
      precision highp float;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        if(d > 0.5) discard;
        float soft = exp(-d * 5.8);
        float rim = exp(-d * 13.0) * 0.28;
        gl_FragColor = vec4(vColor * (0.92 + rim), vAlpha * soft);
      }
    `
    ),
    transparent: true,
    blending: THREE3.AdditiveBlending,
    depthWrite: false,
    depthTest: false
  });
  const particlePoints = new THREE3.Points(pGeo, particleMaterial);
  particlePoints.frustumCulled = false;
  scene.add(particlePoints);
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloomPass = new UnrealBloomPass(new THREE3.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.42, 0.62);
  composer.addPass(bloomPass);
  const afterimagePass = new AfterimagePass(0.885);
  composer.addPass(afterimagePass);
  composer.addPass(new OutputPass());
  const camRig = { angle: 0, radius: 4.2, baseY: 0.58, breathe: 0, growthNudge: 0 };
  gsap3.to(camRig, { angle: Math.PI * 2, duration: 56, repeat: -1, ease: "none" });
  gsap3.to(camRig, { breathe: 0.07, duration: 3.8, yoyo: true, repeat: -1, ease: "sine.inOut" });
  function updateCamera() {
    const g = sharedUniforms.uGrowthProgress.value;
    const gBase = THREE3.MathUtils.clamp(g, 0, 1);
    const gExtra = Math.max(0, g - 1);
    const rad = THREE3.MathUtils.lerp(4.3, 2.55, THREE3.MathUtils.smoothstep(gBase, 0, 1)) - gExtra * 0.2 + camRig.breathe + camRig.growthNudge;
    const yy = THREE3.MathUtils.lerp(0.46, 1.35, THREE3.MathUtils.smoothstep(gBase, 0, 1)) + gExtra * 0.12 + camRig.breathe * 0.45;
    camera.position.set(Math.sin(camRig.angle) * rad, yy, Math.cos(camRig.angle) * rad);
    const focusY = THREE3.MathUtils.lerp(0.12, 0.66, THREE3.MathUtils.smoothstep(gBase, 0, 1)) + gExtra * 0.1;
    camera.lookAt(0, focusY, 0);
  }
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    bloomPass.resolution.set(w, h);
    afterimagePass.uniforms.resolution?.value?.set(w, h);
  }
  window.addEventListener("resize", onResize);
  renderer.domElement.addEventListener("pointerdown", (e) => {
    fruitSystem.handlePointer(e.clientX, e.clientY);
  });
  const clock = new THREE3.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.06);
    const t = clock.elapsedTime;
    const g = sharedUniforms.uGrowthProgress.value;
    const gBase = THREE3.MathUtils.clamp(g, 0, 1);
    const gExtra = Math.max(0, g - 1);
    simUniforms.uSeedRadius.value = THREE3.MathUtils.lerp(0.14, 0.95, THREE3.MathUtils.smoothstep(gBase, 0, 1)) + gExtra * 0.2;
    gpgpuStep(dt, t);
    lineSystem.update(posRT[0], g, simUniforms);
    fruitSystem.update(t, uHueShift.value);
    updateCamera();
    composer.render(dt);
  }
  function playIntroAnimation() {
    simUniforms.uIntroBurst.value = 1;
    simUniforms.uCurlStrength.value = 0.92;
    bloomPass.strength = 0.62;
    gsap3.to(simUniforms.uIntroBurst, { value: 0, duration: 2.9, ease: "power2.out" });
    gsap3.to(simUniforms.uCurlStrength, { value: 0.42, duration: 3.3, ease: "power1.out" });
    gsap3.to(bloomPass, { strength: 0.32, duration: 3.6, ease: "power1.out" });
    const overlay = document.getElementById("intro-overlay");
    if (overlay) gsap3.delayedCall(1, () => overlay.classList.add("fade-out"));
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
    fruitSystem
  };
  treeApi.setGrowthProgress(sharedUniforms.uGrowthProgress.value);
  initControls(api, camRig);
  playIntroAnimation();
  animate();
}
main().catch(console.error);

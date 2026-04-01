/**
 * particles.js — GPGPU 星空粒子 + 星座连线 + 灵感星系统
 * 保留 Ping-pong FBO 管线，力场改为宇宙漂移（Curl Noise + 球壳收容）
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { getStarAnchorPosition } from './tree.js';

export const PARTICLE_SIM_TEXTURE_SIZE = 256;

/* ── Phase ── */
let phaseId = 0;
export function setParticlePhase(name) {
  phaseId = { idle: 0, burst: 1, attract: 2 }[name] ?? 0;
}
export function getPhaseId() {
  return phaseId;
}

/* ══════════════════════════════════════════════════════
   GLSL: 4D Simplex Noise + Curl Noise
   ══════════════════════════════════════════════════════ */
const SIMPLEX4D = /* glsl */ `
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
float mod289(float x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289((x*34.+10.)*x);}
float permute(float x){return mod289((x*34.+10.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float taylorInvSqrt(float r){return 1.79284291400159-0.85373472095314*r;}
vec4 grad4(float j,vec4 ip){
  vec4 p;p.xyz=floor(fract(vec3(j)*ip.xyz)*7.)*ip.z-1.;
  p.w=1.5-dot(abs(p.xyz),vec3(1.));
  vec4 s=vec4(lessThan(p,vec4(0.)));
  p.xyz=p.xyz+(s.xyz*2.-1.)*s.www;return p;}
float snoise4(vec4 v){
  const vec4 C=vec4(0.138196601125011,0.276393202250021,0.414589803375032,-0.447213595499958);
  vec4 i=floor(v+dot(v,vec4(0.309016994374947451)));
  vec4 x0=v-i+dot(i,C.xxxx);vec4 i0;
  vec3 isX=step(x0.yzw,x0.xxx);vec3 isYZ=step(x0.zww,x0.yyz);
  i0.x=isX.x+isX.y+isX.z;i0.yzw=1.-isX;
  i0.y+=isYZ.x+isYZ.y;i0.zw+=1.-isYZ.xy;i0.z+=isYZ.z;i0.w+=1.-isYZ.z;
  vec4 i3=clamp(i0,0.,1.);vec4 i2=clamp(i0-1.,0.,1.);vec4 i1=clamp(i0-2.,0.,1.);
  vec4 x1=x0-i1+C.xxxx;vec4 x2=x0-i2+C.yyyy;vec4 x3=x0-i3+C.zzzz;vec4 x4=x0+C.wwww;
  i=mod289(i);
  float j0=permute(permute(permute(permute(i.w)+i.z)+i.y)+i.x);
  vec4 j1=permute(permute(permute(permute(
    i.w+vec4(i1.w,i2.w,i3.w,1.))+i.z+vec4(i1.z,i2.z,i3.z,1.))+i.y+vec4(i1.y,i2.y,i3.y,1.))+i.x+vec4(i1.x,i2.x,i3.x,1.));
  vec4 ip2=vec4(1./294.,1./49.,1./7.,0.);
  vec4 p0=grad4(j0,ip2);vec4 p1=grad4(j1.x,ip2);vec4 p2=grad4(j1.y,ip2);vec4 p3=grad4(j1.z,ip2);vec4 p4=grad4(j1.w,ip2);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;p4*=taylorInvSqrt(dot(p4,p4));
  vec3 m0=max(0.6-vec3(dot(x0,x0),dot(x1,x1),dot(x2,x2)),0.);
  vec2 m1=max(0.6-vec2(dot(x3,x3),dot(x4,x4)),0.);
  m0=m0*m0;m1=m1*m1;
  return 49.*(dot(m0*m0,vec3(dot(p0,x0),dot(p1,x1),dot(p2,x2)))+dot(m1*m1,vec2(dot(p3,x3),dot(p4,x4))));
}
`;

const COSMIC_FIELD = /* glsl */ `
${SIMPLEX4D}

float fbm4(vec4 v,int oct,float lac,float gain){
  float s=0.0,a=0.5;
  for(int i=0;i<6;i++){if(i>=oct)break;s+=a*snoise4(v);v*=lac;a*=gain;}
  return s;
}

vec3 curlNoise(vec3 p,float t,float sc){
  float e=0.003;
  vec4 b=vec4(p*sc,t);
  float dx=fbm4(b+vec4(e,0,0,0),3,2.0,0.5)-fbm4(b-vec4(e,0,0,0),3,2.0,0.5);
  float dy=fbm4(b+vec4(0,e,0,0),3,2.0,0.5)-fbm4(b-vec4(0,e,0,0),3,2.0,0.5);
  float dz=fbm4(b+vec4(0,0,e,0),3,2.0,0.5)-fbm4(b-vec4(0,0,e,0),3,2.0,0.5);
  return vec3(dy-dz,dz-dx,dx-dy)/(2.0*e);
}

vec3 computeSaturnField(
  vec3 pos,vec3 target,float t,float dt,
  float noiseInt,float noiseSc,float curlStr,float curlBoost,
  float attractStr,float attractBoost,float damping,
  int phase,float typingPulse,float introBurst,
  vec3 mouseWorld,float mouseActive,float clickPulse
){
  vec3 F=vec3(0.0);

  vec3 toTarget=target-pos;
  float springK=attractStr*attractBoost;
  F+=toTarget*springK*0.55;

  float nG=noiseInt*noiseSc*max(0.05,curlStr)*curlBoost;
  F+=curlNoise(pos,t*0.04,0.25)*nG*0.07;
  F+=vec3(
    snoise4(vec4(pos*0.35,t*0.08)),
    snoise4(vec4(pos*0.35+vec3(5.0,3.0,1.0),t*0.07)),
    snoise4(vec4(pos*0.35+vec3(11.0,7.0,2.0),t*0.09))
  )*noiseInt*noiseSc*0.012;

  if(mouseActive>0.01){
    vec3 toMouse=pos-mouseWorld;
    float mDist=length(toMouse);
    float repelR=2.8;
    if(mDist<repelR&&mDist>0.01){
      float s=(1.0-mDist/repelR);
      s=s*s*4.5;
      F+=normalize(toMouse)*s*mouseActive;
    }
  }

  if(clickPulse>0.01){
    vec3 outward=normalize(pos+vec3(1e-5));
    F+=outward*clickPulse*2.8;
    F+=curlNoise(pos*0.5,t*0.5,0.4)*clickPulse*2.0;
  }

  if(phase==1){
    F+=curlNoise(pos*0.55,t*0.45,0.65)*nG*0.5;
    F+=normalize(pos+vec3(1e-5))*nG*0.2;
  }
  if(phase==2){
    F+=toTarget*springK*0.35;
  }

  if(typingPulse>0.01){
    F+=curlNoise(pos*1.2,t*0.8,0.5)*typingPulse*0.08;
  }
  if(introBurst>0.01){
    F+=normalize(pos+vec3(1e-5))*introBurst*0.25;
    F+=curlNoise(pos*0.4,t*0.2,0.35)*introBurst*0.4;
  }

  return F;
}
`;

/* ── Velocity step uniforms ── */
const VEL_UNIFORMS = /* glsl */ `
uniform float uDelta;
uniform float uTime;
uniform float uDamping;
uniform float uNoiseIntensity;
uniform float uNoiseScale;
uniform float uCurlStrength;
uniform float uCurlBoost;
uniform float uAttractBoost;
uniform float uAttractStrength;
uniform float uPhase;
uniform float uTypingPulse;
uniform float uIntroBurst;
uniform vec3 uMouseWorld;
uniform float uMouseActive;
uniform float uClickPulse;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tTarget;
`;

/* ══════════════════════════════════════════════════════
   Sim Uniforms
   ══════════════════════════════════════════════════════ */
export function createParticleSimUniforms() {
  return {
    uDelta: { value: 0 },
    uTime: { value: 0 },
    uDamping: { value: 0.985 },
    uNoiseIntensity: { value: 0.20 },
    uNoiseScale: { value: 1.1 },
    uCurlStrength: { value: 0.10 },
    uCurlBoost: { value: 1 },
    uAttractBoost: { value: 1 },
    uAttractStrength: { value: 0.30 },
    uPhase: { value: 0 },
    uSeedRadius: { value: 12.0 },
    uTypingPulse: { value: 0 },
    uIntroBurst: { value: 0 },
    uGrowthProgress: { value: 0 },
    uLineOpacityMul: { value: 0.65 },
    uLineBrightness: { value: 1.2 },
    uParticleActiveRatio: { value: 0.9 },
    uMouseWorld: { value: new THREE.Vector3(0, 0, 100) },
    uMouseActive: { value: 0 },
    uClickPulse: { value: 0 },
    tPos: { value: null },
    tVel: { value: null },
    tTarget: { value: null },
  };
}

/* ── Velocity Step ── */
export function createVelocityStepMaterial(u) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${VEL_UNIFORMS}
      varying vec2 vUv;
      ${COSMIC_FIELD}
      void main(){
        vec3 pos=texture2D(tPos,vUv).xyz;
        vec3 vel=texture2D(tVel,vUv).xyz;
        vec3 target=texture2D(tTarget,vUv).xyz;
        int ph=int(uPhase+0.5);
        vec3 F=computeSaturnField(
          pos,target,uTime,uDelta,
          uNoiseIntensity,uNoiseScale,uCurlStrength,uCurlBoost,
          uAttractStrength,uAttractBoost,uDamping,
          ph,uTypingPulse,uIntroBurst,
          uMouseWorld,uMouseActive,uClickPulse
        );
        vel=vel*uDamping+F*uDelta;
        float sp=length(vel);
        if(sp>4.0) vel*=4.0/sp;
        gl_FragColor=vec4(vel,1.0);
      }
    `,
  });
  mat.uniforms = u;
  return mat;
}

/* ── Position Step ── */
export function createPositionStepMaterial(uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uDelta;
      uniform float uSeedRadius;
      uniform sampler2D tPos;
      uniform sampler2D tVel;
      uniform sampler2D tTarget;
      varying vec2 vUv;
      void main(){
        vec4 pd=texture2D(tPos,vUv);
        vec3 pos=pd.xyz;
        float life=pd.w;
        vec3 vel=texture2D(tVel,vUv).xyz;
        pos+=vel*uDelta;
        life-=uDelta*0.018;
        if(life<0.0){
          vec3 tgt=texture2D(tTarget,vUv).xyz;
          pos=tgt+(fract(sin(dot(vUv,vec2(12.9898,78.233)))*43758.5453)-0.5)*0.15;
          life=0.7+0.5*fract(sin(dot(vUv,vec2(17.42,63.91)))*12345.67);
        }
        float lim=uSeedRadius*2.5;
        float L=length(pos);
        if(L>lim) pos*=lim/max(L,1e-4);
        gl_FragColor=vec4(pos,life);
      }
    `,
  });
  mat.uniforms = uniforms;
  return mat;
}

/* ══════════════════════════════════════════════════════
   Constellation Line System — permanent, one line per dialogue
   ══════════════════════════════════════════════════════ */
export function createConstellationLines(scene) {
  const MAX_LINES = 500;
  const positions = new Float32Array(MAX_LINES * 6);
  const alphas = new Float32Array(MAX_LINES * 2);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const alpAttr = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aAlpha', alpAttr);
  geo.setDrawRange(0, 0);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.65 },
      uBrightness: { value: 1.2 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      uniform float uTime;
      varying float vA;
      varying float vDepth;
      void main(){
        vec4 mv=modelViewMatrix*vec4(position,1.0);
        vDepth=smoothstep(-18.0,-2.0,mv.z);
        vA=aAlpha;
        gl_Position=projectionMatrix*mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uOpacity;
      uniform float uBrightness;
      uniform float uTime;
      varying float vA;
      varying float vDepth;
      void main(){
        float shimmer=0.92+0.08*sin(uTime*1.5+gl_FragCoord.x*0.03+gl_FragCoord.y*0.02);
        float a=uOpacity*vA*(0.55+0.45*vDepth)*shimmer;
        vec3 col=vec3(0.7,0.82,1.0)*uBrightness;
        gl_FragColor=vec4(col,a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);

  let lineCount = 0;
  const constellationNodes = [];

  function addLine(p1, p2) {
    if (lineCount >= MAX_LINES) return;
    const o = lineCount * 6;
    positions[o] = p1.x; positions[o + 1] = p1.y; positions[o + 2] = p1.z;
    positions[o + 3] = p2.x; positions[o + 4] = p2.y; positions[o + 5] = p2.z;
    const ao = lineCount * 2;
    alphas[ao] = 1.0; alphas[ao + 1] = 1.0;
    lineCount++;
    posAttr.needsUpdate = true;
    alpAttr.needsUpdate = true;
    geo.setDrawRange(0, lineCount * 2);

    if (!constellationNodes.find((n) => n.distanceTo(p1) < 0.15)) constellationNodes.push(p1.clone());
    if (!constellationNodes.find((n) => n.distanceTo(p2) < 0.15)) constellationNodes.push(p2.clone());
  }

  /**
   * Read particle FBO, extend the constellation graph by one line.
   * Prefers connecting from an existing node for organic growth.
   */
  function addRandomLine(readBuffer, texSize) {
    const count = texSize * texSize;

    let startPos;
    if (constellationNodes.length > 0) {
      startPos = constellationNodes[Math.floor(Math.random() * constellationNodes.length)];
    } else {
      const idx = Math.floor(Math.random() * count);
      startPos = new THREE.Vector3(readBuffer[idx * 4], readBuffer[idx * 4 + 1], readBuffer[idx * 4 + 2]);
    }

    const idealDist = 0.8 + Math.random() * 2.2;
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let attempt = 0; attempt < 300; attempt++) {
      const j = Math.floor(Math.random() * count);
      const px = readBuffer[j * 4];
      const py = readBuffer[j * 4 + 1];
      const pz = readBuffer[j * 4 + 2];
      const d = Math.sqrt((px - startPos.x) ** 2 + (py - startPos.y) ** 2 + (pz - startPos.z) ** 2);
      if (d > 0.35 && d < 4.5) {
        const diff = Math.abs(d - idealDist);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = j;
        }
      }
    }
    if (bestIdx < 0) return;

    const endPos = new THREE.Vector3(readBuffer[bestIdx * 4], readBuffer[bestIdx * 4 + 1], readBuffer[bestIdx * 4 + 2]);

    const lineObj = { from: startPos.clone(), to: endPos.clone() };
    animateLineIn(lineObj);
  }

  function animateLineIn(lineObj) {
    const driver = { t: 0 };
    const from = lineObj.from;
    const to = lineObj.to;
    const idx = lineCount;
    if (idx >= MAX_LINES) return;

    lineCount++;
    geo.setDrawRange(0, lineCount * 2);
    if (!constellationNodes.find((n) => n.distanceTo(from) < 0.15)) constellationNodes.push(from.clone());
    if (!constellationNodes.find((n) => n.distanceTo(to) < 0.15)) constellationNodes.push(to.clone());

    gsap.to(driver, {
      t: 1,
      duration: 1.2,
      ease: 'power2.out',
      onUpdate() {
        const p = driver.t;
        const o = idx * 6;
        positions[o] = from.x; positions[o + 1] = from.y; positions[o + 2] = from.z;
        positions[o + 3] = THREE.MathUtils.lerp(from.x, to.x, p);
        positions[o + 4] = THREE.MathUtils.lerp(from.y, to.y, p);
        positions[o + 5] = THREE.MathUtils.lerp(from.z, to.z, p);
        const ao = idx * 2;
        alphas[ao] = p; alphas[ao + 1] = p;
        posAttr.needsUpdate = true;
        alpAttr.needsUpdate = true;
      },
    });
  }

  function update(time, uSim) {
    mat.uniforms.uTime.value = time;
    mat.uniforms.uOpacity.value = uSim.uLineOpacityMul.value;
    mat.uniforms.uBrightness.value = uSim.uLineBrightness.value;
  }

  function fadeAll(duration = 2.0) {
    if (lineCount === 0) return;
    gsap.to(mat.uniforms.uOpacity, {
      value: 0,
      duration,
      ease: 'power2.inOut',
      onComplete() {
        mat.uniforms.uOpacity.value = 0.65;
      },
    });
    for (let i = 0; i < lineCount; i++) {
      const ao = i * 2;
      gsap.to(alphas, {
        [ao]: 0, [ao + 1]: 0,
        duration,
        ease: 'power2.inOut',
        onUpdate() { alpAttr.needsUpdate = true; },
      });
    }
  }

  function clearAll() {
    lineCount = 0;
    constellationNodes.length = 0;
    for (let i = 0; i < positions.length; i++) positions[i] = 0;
    for (let i = 0; i < alphas.length; i++) alphas[i] = 0;
    posAttr.needsUpdate = true;
    alpAttr.needsUpdate = true;
    geo.setDrawRange(0, 0);
    mat.uniforms.uOpacity.value = 0.65;
  }

  return { lines, addLine, addRandomLine, fadeAll, clearAll, update, getLineCount: () => lineCount };
}

/* ══════════════════════════════════════════════════════
   Inspiration Star System — replaces fruit system
   射出流星 → 永久灵感星 → 搜索高亮
   ══════════════════════════════════════════════════════ */
export function createInspirationStarSystem(scene, camera, domElement) {
  const root = new THREE.Group();
  scene.add(root);

  const savedStars = [];
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = raycaster.params.Points || {};
  raycaster.params.Points.threshold = 0.35;
  const pointer = new THREE.Vector2();
  let onStarClick = null;
  const labelLayer = document.createElement('div');
  labelLayer.style.position = 'fixed';
  labelLayer.style.inset = '0';
  labelLayer.style.pointerEvents = 'none';
  labelLayer.style.zIndex = '20';
  document.body.appendChild(labelLayer);

  /**
   * Kandinsky-style glowing sphere cluster.
   * Soft circles with bold geometric primary colors and semi-opacity.
   */
  function createGlowStar(pos, radius, brightness, isShootingStar) {
    const count = isShootingStar ? 100 : 60;
    const pArr = new Float32Array(count * 3);
    const sArr = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius * Math.pow(Math.random(), 0.8);
      pArr[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pArr[i * 3 + 1] = Math.cos(phi) * r;
      pArr[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
      sArr[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(sArr, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: isShootingStar ? 1.8 : 1.0 },
        uOpacity: { value: brightness },
        uHighlight: { value: 0 },
        uBreathing: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uSize;
        uniform float uBreathing;
        attribute float aSeed;
        varying vec3 vColor;
        varying float vAlpha;
        void main(){
          vec3 p = position;
          p += normalize(position + 1e-5) * sin(uTime * 1.4 + aSeed * 12.0) * 0.02;

          // Kandinsky palette: bold primaries + geometric flat tones
          vec3 deepBlue   = vec3(0.12, 0.22, 0.72);
          vec3 cadYellow  = vec3(0.95, 0.82, 0.22);
          vec3 vermillion = vec3(0.88, 0.26, 0.16);
          vec3 ochre      = vec3(0.82, 0.62, 0.22);
          vec3 violet     = vec3(0.52, 0.28, 0.76);

          vec3 col;
          float s4 = aSeed * 4.0;
          if(aSeed < 0.25) col = mix(deepBlue, violet, s4);
          else if(aSeed < 0.5) col = mix(cadYellow, ochre, s4 - 1.0);
          else if(aSeed < 0.75) col = mix(vermillion, deepBlue, s4 - 2.0);
          else col = mix(ochre, violet, s4 - 3.0);

          vColor = col;

          float breathScale = 1.0 + uBreathing * 0.3 * sin(uTime * 3.5);
          float pulse = 0.85 + 0.15 * sin(uTime * 1.6 + aSeed * 9.0);
          vAlpha = pulse * breathScale;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * breathScale * (220.0 / (-mv.z + 1.5));
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uOpacity;
        uniform float uHighlight;
        varying vec3 vColor;
        varying float vAlpha;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          if(d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.02, d);
          vec3 col = mix(vColor, vec3(1.0, 0.97, 0.88), uHighlight * 0.5);
          float bright = 1.0 + uHighlight * 0.6;
          gl_FragColor = vec4(col * bright, alpha * vAlpha * uOpacity * 0.72);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const pts = new THREE.Points(geo, mat);
    pts.position.copy(pos);
    pts.frustumCulled = false;
    return pts;
  }

  /** Record a permanent inspiration star with breathing entrance */
  function addInspirationStar(position, cardData) {
    const star = createGlowStar(new THREE.Vector3(), 0.03, 0.95, false);
    star.position.copy(position);
    star.userData.kind = 'inspirationStar';
    star.userData.cardData = cardData;
    star.userData.index = savedStars.length;
    const ts = cardData?.generatedAt || new Date().toISOString();
    const kw = (cardData?.title || cardData?.bullets?.[0] || '灵感').toString().slice(0, 18);
    const tag = document.createElement('div');
    tag.style.position = 'absolute';
    tag.style.transform = 'translate(-50%, -100%)';
    tag.style.padding = '2px 8px';
    tag.style.borderRadius = '999px';
    tag.style.fontSize = '11px';
    tag.style.lineHeight = '1.4';
    tag.style.whiteSpace = 'nowrap';
    tag.style.color = '#d7e6ff';
    tag.style.background = 'rgba(22, 30, 60, 0.42)';
    tag.style.border = '1px solid rgba(128,170,255,0.35)';
    tag.style.textShadow = '0 0 8px rgba(110,170,255,0.5)';
    tag.textContent = `${ts.slice(0, 10)} · ${kw}`;
    labelLayer.appendChild(tag);
    star.userData.tag = tag;
    root.add(star);
    savedStars.push(star);

    // Breathing entrance: pulsate for ~5s then settle
    star.material.uniforms.uBreathing.value = 1.0;
    gsap.to(star.material.uniforms.uBreathing, {
      value: 0,
      duration: 5.0,
      ease: 'power2.out',
    });

    return star;
  }

  /**
   * Shooting-star with dreamy meteor trail.
   * Kandinsky sphere flies via Bezier curve, spawning a rich
   * trail of softly glowing, fading spheres behind it.
   */
  function spawnShootingStar(cardData) {
    const seed = performance.now() * 0.001 + savedStars.length * 17.3;
    const targetPos = getStarAnchorPosition(seed, new THREE.Vector3());

    const starSize = Math.min(window.innerWidth, window.innerHeight) * 0.0006;
    const star = createGlowStar(new THREE.Vector3(), 0.03 * starSize, 1.0, true);
    star.material.uniforms.uSize.value = 2.0;
    star.material.uniforms.uBreathing.value = 1.0;

    const startWorld = new THREE.Vector3(0, 0, -2.5);
    camera.localToWorld(startWorld);
    star.position.copy(startWorld);
    root.add(star);

    const mid = startWorld.clone().lerp(targetPos, 0.35).add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 3.0,
        0.8 + Math.random() * 1.5,
        (Math.random() - 0.5) * 3.0,
      ),
    );

    const trail = [];
    const TRAIL_MAX = 32;
    let lastTrailP = -1;

    return new Promise((resolve) => {
      const driver = { t: 0 };
      gsap.to(driver, {
        t: 1,
        duration: 2.8,
        ease: 'power3.inOut',
        onUpdate() {
          const p = driver.t;
          const omt = 1 - p;
          const x = omt * omt * startWorld.x + 2 * omt * p * mid.x + p * p * targetPos.x;
          const y = omt * omt * startWorld.y + 2 * omt * p * mid.y + p * p * targetPos.y;
          const z = omt * omt * startWorld.z + 2 * omt * p * mid.z + p * p * targetPos.z;
          star.position.set(x, y, z);
          star.rotation.y = p * Math.PI * 3;

          const sizeAnim = p < 0.15
            ? THREE.MathUtils.lerp(0.3, 1.2, p / 0.15)
            : THREE.MathUtils.lerp(1.2, 0.6, (p - 0.15) / 0.85);
          star.scale.setScalar(sizeAnim);
          star.material.uniforms.uOpacity.value = p < 0.1
            ? THREE.MathUtils.lerp(0.2, 1.0, p / 0.1)
            : 1.0 - Math.max(0, p - 0.82) * 4.5;

          // Dreamy trail: emit a particle every ~3% of progress
          if (trail.length < TRAIL_MAX && p > 0.04 && p - lastTrailP > 0.028) {
            lastTrailP = p;
            const trailScale = 0.15 + Math.random() * 0.35;
            const trailR = 0.015 + Math.random() * 0.012;
            const tp = createGlowStar(star.position.clone(), trailR, 0.55, false);
            tp.scale.setScalar(trailScale);
            root.add(tp);
            trail.push(tp);

            const fadeDur = 1.2 + Math.random() * 0.6;
            gsap.to(tp.material.uniforms.uOpacity, { value: 0, duration: fadeDur, ease: 'power2.out' });
            gsap.to(tp.scale, {
              x: 0.02, y: 0.02, z: 0.02,
              duration: fadeDur,
              ease: 'power2.out',
              onComplete() { root.remove(tp); tp.geometry.dispose(); tp.material.dispose(); },
            });
          }
        },
        onComplete() {
          root.remove(star);
          star.geometry.dispose();
          star.material.dispose();
          addInspirationStar(targetPos, cardData);
          resolve();
        },
      });
    });
  }

  /** Highlight stars matching keyword, dim others */
  function searchHighlight(keyword) {
    const kw = (keyword || '').trim().toLowerCase();
    for (const star of savedStars) {
      const cd = star.userData.cardData;
      if (!cd || !kw) {
        star.material.uniforms.uHighlight.value = 0;
        star.material.uniforms.uOpacity.value = 0.95;
        continue;
      }
      const text = [cd.title, ...(cd.bullets || []), ...(cd.actions || [])].join(' ').toLowerCase();
      const match = text.includes(kw);
      star.material.uniforms.uHighlight.value = match ? 1.0 : 0;
      star.material.uniforms.uOpacity.value = match ? 1.0 : 0.2;
    }
  }

  function clearHighlight() {
    for (const star of savedStars) {
      star.material.uniforms.uHighlight.value = 0;
      star.material.uniforms.uOpacity.value = 0.95;
    }
  }

  /** Return the cardData of the first star matching keyword, or null */
  function getFirstMatch(keyword) {
    const kw = (keyword || '').trim().toLowerCase();
    if (!kw) return null;
    for (const star of savedStars) {
      const cd = star.userData.cardData;
      if (!cd) continue;
      const text = [cd.title, ...(cd.bullets || []), ...(cd.actions || [])].join(' ').toLowerCase();
      if (text.includes(kw)) return cd;
    }
    return null;
  }

  function setOnStarClick(cb) { onStarClick = cb; }

  function handlePointer(clientX, clientY) {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(savedStars, false)[0];
    if (hit?.object?.userData?.kind === 'inspirationStar') {
      if (onStarClick) onStarClick(hit.object.userData.cardData);
      return true;
    }
    return false;
  }

  function update(time) {
    for (let i = 0; i < savedStars.length; i++) {
      const s = savedStars[i];
      s.material.uniforms.uTime.value = time + i * 0.4;
      const tag = s.userData.tag;
      if (!tag) continue;
      const p = s.position.clone().project(camera);
      const visible = p.z > -1 && p.z < 1;
      if (!visible) {
        tag.style.opacity = '0';
        continue;
      }
      const x = (p.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight - 14;
      tag.style.left = `${x}px`;
      tag.style.top = `${y}px`;
      tag.style.opacity = '0.88';
    }
  }

  /** Only resets dialogue-specific state; stars are permanent */
  function resetDialogue() { /* noop: stars persist */ }

  return {
    addInspirationStar,
    spawnShootingStar,
    searchHighlight,
    clearHighlight,
    getFirstMatch,
    setOnStarClick,
    handlePointer,
    update,
    resetDialogue,
    getSavedStars: () => savedStars,

    /* backward compat aliases */
    addSmallFruit() {},
    spawnBlossom() {},
    spawnFinalFruit: spawnShootingStar,
    resetAll: resetDialogue,
    setOnSmallFruitClick: setOnStarClick,
    getSmallFruitCount: () => 0,
  };
}

/** Backward compat aliases for core-entry imports */
export const createFruitSystem = createInspirationStarSystem;
export function createNeuralLineSystem(scene, renderer, texSize) {
  const sys = createConstellationLines(scene);
  sys._renderer = renderer;
  sys._texSize = texSize;
  return sys;
}

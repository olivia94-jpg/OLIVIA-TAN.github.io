/**
 * tree.js — 深空背景星场 (简化版，仅远景星 + 鼠标视差)
 */
import * as THREE from 'three';

export function getStarAnchorPosition(seed, target = new THREE.Vector3()) {
  const s1 = Math.sin(seed * 127.1) * 43758.5453;
  const t1 = s1 - Math.floor(s1);
  const s2 = Math.sin(seed * 19.19 + 3.7) * 0.5 + 0.5;
  const a = t1 * Math.PI * 2;
  const b = Math.acos(2 * s2 - 1);
  const r = 2.2 + Math.abs(Math.sin(seed * 0.73)) * 2.8;
  target.set(Math.sin(b) * Math.cos(a) * r, Math.sin(b) * Math.sin(a) * r * 0.7, Math.cos(b) * r);
  return target;
}
export const getFruitAnchorPosition = getStarAnchorPosition;
export function evaluateGrowth() { return { canopyH: 3, canopyR: 3, gBase: 1, gExtra: 0 }; }

export function initTree(scene, sharedUniforms) {
  const group = new THREE.Group();
  scene.add(group);
  const pointer = new THREE.Vector2(0, 0);

  const N = 2500;
  const pos = new Float32Array(N * 3);
  const sd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 30 + Math.random() * 60;
    pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    pos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * r;
    pos[i * 3 + 2] = Math.cos(phi) * r;
    sd[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uPointer: { value: pointer } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uPointer;
      attribute float aSeed;
      varying float vAlpha;
      void main(){
        vec3 p = position;
        p.x += uPointer.x * 0.8;
        p.y += uPointer.y * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(0.3 + aSeed * 0.8, 0.2, 1.3);
        float flicker = 0.5 + 0.5 * sin(uTime * (0.05 + aSeed * 0.1) + aSeed * 60.0);
        vAlpha = flicker * (0.08 + aSeed * 0.25);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if(d > 0.5) discard;
        gl_FragColor = vec4(0.65, 0.70, 0.85, vAlpha * exp(-d * 12.0));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  group.add(pts);

  return {
    group,
    points: null,
    material: null,
    setGrowthProgress() {},
    setPointer(nx = 0, ny = 0) { pointer.set(nx, ny); },
    getCanopyWorldPosition(target = new THREE.Vector3()) { return target.set(0, 0, 0); },
    dispose() { scene.remove(group); mat.dispose(); geo.dispose(); },
  };
}

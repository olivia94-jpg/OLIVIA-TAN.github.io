/**
 * cinematography.js — 无 OrbitControls；视线焦点相对空间；Frustum Fitting；15 套 GSAP 闭环运镜
 */

import * as THREE from 'three';
import gsap from 'gsap';

/** 视锥拟合：boundsRadiusWorld 为场景包围球半径 */
export function fitCameraDistance(camera, boundsRadiusWorld, margin = 1.08) {
  const vFovRad = THREE.MathUtils.degToRad(camera.fov);
  const tanHalfV = Math.tan(vFovRad * 0.5);
  const tanHalfH = tanHalfV * camera.aspect;
  const dV = boundsRadiusWorld / tanHalfV;
  const dH = boundsRadiusWorld / tanHalfH;
  return margin * Math.max(dV, dH, 0.35);
}

function sphericalOffset(dirHoriz, dirElev, dist) {
  const c = Math.cos(dirElev);
  return new THREE.Vector3(Math.sin(dirHoriz) * c * dist, Math.sin(dirElev) * dist, Math.cos(dirHoriz) * c * dist);
}

export function updateCameraFromFocus(camera, focusWorld, rig, minR = 1.35, maxR = 12) {
  const fit = fitCameraDistance(camera, rig.boundsRadius ?? 1.0, 1.06 + (rig.growthNudge || 0) * 0.12);
  let rad = THREE.MathUtils.clamp(rig.radius + rig.breathe + (rig.growthNudge || 0), minR, maxR);
  rad = Math.max(rad, fit * 0.92);

  const off = sphericalOffset(rig.horiz + rig.angle, rig.elev * 0.55, rad);
  off.y += rig.baseY;

  camera.position.copy(focusWorld).add(off);
  camera.lookAt(focusWorld);
  if (Number.isFinite(rig.fovNudge)) {
    camera.fov = THREE.MathUtils.clamp(50 + rig.fovNudge, 32, 72);
    camera.updateProjectionMatrix();
  }
}

/** 15 段顺序播放、整体 repeat:-1 */
export function buildCameraMasterTimeline(rig) {
  const master = gsap.timeline({ repeat: -1, defaults: { ease: 'sine.inOut' } });

  const seg = (dur, fn) => {
    const tl = gsap.timeline();
    fn(tl);
    master.add(tl);
  };

  seg(5.2, (tl) => {
    tl.to(rig, { angle: `+=${Math.PI * 0.55}`, duration: 5.2, ease: 'none' }, 0);
    tl.to(rig, { breathe: 0.06, duration: 2.6, yoyo: true, repeat: 1 }, 0);
  });
  seg(4.8, (tl) => {
    tl.to(rig, { horiz: `+=1.2`, radius: `*=${0.94}`, duration: 4.8 }, 0);
  });
  seg(4.2, (tl) => {
    tl.to(rig, { elev: 0.35, duration: 2.1, yoyo: true, repeat: 1 }, 0);
    tl.to(rig, { fovNudge: 8, duration: 2.1, yoyo: true, repeat: 1 }, 0);
  });
  seg(6.0, (tl) => {
    tl.to(rig, { angle: `-=${Math.PI * 0.45}`, baseY: `+=0.22`, duration: 6, ease: 'none' }, 0);
  });
  seg(3.6, (tl) => {
    tl.to(rig, { radius: `*=${1.12}`, duration: 1.8, yoyo: true, repeat: 1 }, 0);
  });
  seg(5.5, (tl) => {
    tl.to(rig, { horiz: `-=0.9`, duration: 5.5, ease: 'none' }, 0);
    tl.to(rig, { elev: 0.25, duration: 2.75, yoyo: true, repeat: 1 }, 0);
  });
  seg(4.4, (tl) => {
    tl.to(rig, { angle: `+=${Math.PI * 0.95}`, breathe: 0.09, duration: 4.4, ease: 'none' }, 0);
  });
  seg(4.0, (tl) => {
    tl.to(rig, { fovNudge: -6, duration: 2, yoyo: true, repeat: 1 }, 0);
    tl.to(rig, { baseY: `-=0.12`, duration: 4 }, 0);
  });
  seg(5.0, (tl) => {
    tl.to(rig, { radius: `*=${0.88}`, horiz: `+=0.7`, duration: 5, ease: 'none' }, 0);
  });
  seg(4.6, (tl) => {
    tl.to(rig, { angle: `+=${Math.PI * 0.33}`, elev: 0.28, duration: 4.6, ease: 'none' }, 0);
  });
  seg(3.8, (tl) => {
    tl.to(rig, { breathe: 0.11, duration: 1.9, yoyo: true, repeat: 1 }, 0);
  });
  seg(5.8, (tl) => {
    tl.to(rig, { horiz: `-=1.4`, angle: `-=${Math.PI * 0.4}`, duration: 5.8, ease: 'none' }, 0);
  });
  seg(4.3, (tl) => {
    tl.to(rig, { baseY: `+=0.18`, radius: `*=${1.06}`, duration: 4.3 }, 0);
  });
  seg(5.4, (tl) => {
    tl.to(rig, { angle: `+=${Math.PI * 1.1}`, fovNudge: 4, duration: 5.4, ease: 'none' }, 0);
  });
  seg(4.7, (tl) => {
    tl.to(rig, { boundsRadius: 1.45, duration: 2.35, yoyo: true, repeat: 1 }, 0);
    tl.to(rig, { radius: `+=0.15`, duration: 4.7, yoyo: true, repeat: 1 }, 0);
  });

  return master;
}

export function createCameraRig() {
  return {
    angle: 0,
    radius: 4.1,
    baseY: 0.55,
    breathe: 0,
    growthNudge: 0,
    horiz: 0,
    elev: 0,
    fovNudge: 0,
    boundsRadius: 1.25,
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ x: number, y: number, active: boolean }} handNdc — MediaPipe 映射的归一化屏坐标辅助
 */
export function createFocusTracker(canvas, handNdc) {
  const focus = new THREE.Vector3(0, 0.35, 0);
  const smooth = new THREE.Vector3(0, 0.35, 0);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  return {
    focus,
    smooth,
    sampleFromPointer(cam, clientX, clientY, growth) {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      let nx = ndc.x,
        ny = ndc.y;
      if (handNdc?.active) {
        nx = THREE.MathUtils.lerp(nx, handNdc.x, 0.45);
        ny = THREE.MathUtils.lerp(ny, handNdc.y, 0.45);
      }
      ray.camera = cam;
      ray.setFromCamera(new THREE.Vector2(nx * 0.92, ny * 0.92), cam);
      plane.constant = -THREE.MathUtils.lerp(0.08, 0.55, growth);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, hit)) focus.copy(hit);
      else focus.set(0, THREE.MathUtils.lerp(0.12, 0.55, growth), 0);
      smooth.lerp(focus, 0.08);
      return smooth;
    },
  };
}

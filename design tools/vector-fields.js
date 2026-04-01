/**
 * vector-fields.js — GLSL 矢量场库：4D Simplex、Curl（偏导）、SDF 形变、30 路非线性场
 * 物理：阻尼积分 v = v*damping + F*dt（在 Velocity Pass）
 */

import * as THREE from 'three';

/** 目标纹理边长（实际边长受 MAX_TEXTURE_SIZE 限制，见 gpgpu-pipeline#getSimTextureSize） */
export const PARTICLE_SIM_TEXTURE_SIZE = 1024;

/** 树 SDF（供 −∇d 吸引与形变） */
export const TREE_SDF_GLSL = /* glsl */ `
float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec2 hash21(float p){
  return vec2(hash11(p), hash11(p + 19.19));
}
vec3 hash31(float p){
  return vec3(hash11(p+7.7), hash11(p+13.13), hash11(p+21.1));
}
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0-h);
}
float sdSphere(vec3 p, float r){ return length(p) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float rad){
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - rad;
}
float sn3(vec3 x){
  return sin(x.x*1.7) + sin(x.y*2.1) + sin(x.z*1.9);
}
float trunkSDF(vec3 p, float g, float trunkThick, float curvatureAmount){
  float gh = smoothstep(0.12, 0.44, g);
  float h = mix(0.04, 1.75, gh);
  float bend = curvatureAmount * 0.38 * sin(p.y * 2.15 + 1.6);
  vec3 w = p;
  w.x += bend + sn3(vec3(p.y*3.0, 0.0, p.y*1.6)) * trunkThick * 0.55 * gh;
  w.z += sn3(vec3(p.y*2.6, p.y*1.2, 0.0)) * trunkThick * 0.42 * gh;
  float r = trunkThick * mix(0.42, 1.05, gh);
  return sdCapsule(w, vec3(0.0), vec3(0.0, h, 0.0), r);
}
float trunkHeightForG(float g){
  return mix(0.04, 1.75, smoothstep(0.12, 0.44, g));
}
float branchSDF(vec3 p, float g, float trunkH, float branchDensity, float curvatureAmount){
  float gb = smoothstep(0.32, 0.76, g);
  if(gb < 0.008) return 1e3;
  float d = 1e3;
  float layers = floor(mix(3.0, 10.0, branchDensity));
  for(float i = 0.0; i < 10.0; i += 1.0){
    if(i >= layers) break;
    float t = (i + 0.5) / max(layers, 1.0);
    float yb = trunkH * mix(0.26, 0.90, t);
    float ang = t * 6.28318 + curvatureAmount * 1.25;
    float spread = mix(0.22, 0.92, branchDensity) * gb;
    vec3 base = vec3(cos(ang)*trunkH*0.055, yb, sin(ang)*trunkH*0.055);
    vec3 dir = normalize(vec3(cos(ang+0.65)*spread, 0.32 + 0.22*t, sin(ang+0.65)*spread));
    float len = mix(0.12, 0.82, t) * gb * (0.55 + 0.45*branchDensity);
    float rad = mix(0.016, 0.052, 1.0-t) * (0.65 + trunkH*0.12);
    d = smin(d, sdCapsule(p, base, base + dir * len, rad), 0.07);
  }
  return d;
}
float leafClusterSDF(vec3 p, float g, float trunkH, float leafDensity, float curvatureAmount){
  float gc = smoothstep(0.50, 1.0, g);
  if(gc < 0.006) return 1e3;
  vec3 c = vec3(curvatureAmount * 0.11, trunkH * mix(0.70, 1.02, gc), 0.0);
  vec3 q = p - c;
  float R = mix(0.10, 0.98, gc) * mix(0.82, 1.12, leafDensity);
  float ell = length(q / vec3(R, R*0.70, R)) - 1.0;
  float d = ell * R * 0.48;
  float lobes = floor(mix(4.0, 9.0, leafDensity));
  for(float k = 0.0; k < 9.0; k += 1.0){
    if(k >= lobes) break;
    float a = k * 1.0472 + curvatureAmount;
    vec3 off = vec3(cos(a)*R*0.52, sin(a*0.45)*R*0.10, sin(a)*R*0.52);
    vec3 pk = p - c - off;
    float ca = cos(a), sa = sin(a);
    vec2 xz = pk.xz;
    pk.x = ca * xz.x - sa * xz.y;
    pk.z = sa * xz.x + ca * xz.y;
    float palm = length(pk / vec3(R*0.40, R*0.16, R*0.11)) - 1.0;
    d = smin(d, palm * R * 0.20, 0.12);
  }
  return d;
}
float fruitSDF(vec3 p, float g, float trunkH, float fruitStrength){
  float gf = smoothstep(0.78, 1.0, g) * fruitStrength;
  if(gf < 0.015) return 1e3;
  float d = 1e3;
  for(float i = 0.0; i < 5.0; i += 1.0){
    float a = i * 1.256;
    vec3 fc = vec3(cos(a)*0.32*gf, trunkH*0.98 + 0.07*sin(i+1.0), sin(a)*0.32*gf);
    float sp = length(p - fc) - (0.065 + 0.025*sin(i*2.0)) * gf;
    sp += sn3((p - fc) * 9.0) * 0.010 * gf;
    d = smin(d, sp, 0.035);
  }
  return d;
}
float seedSDF(vec3 p, float g, float time){
  float pulse = 0.88 + 0.12 * sin(time * 2.5);
  float r = mix(0.05, 0.14, 1.0 - smoothstep(0.0, 0.42, g)) * pulse;
  return sdSphere(p, max(r, 0.035));
}
float treeSDF(vec3 p, float g, float trunkThick, float branchDensity,
              float leafDensity, float curvatureAmount, float fruitStrength, float time){
  g = clamp(g, 0.0, 1.0);
  float th = trunkHeightForG(g);
  float dSeed = seedSDF(p, g, time);
  float dTrunk = trunkSDF(p, g, trunkThick, curvatureAmount);
  float dBranch = branchSDF(p, g, th, branchDensity, curvatureAmount);
  float dLeaf = leafClusterSDF(p, g, th, leafDensity, curvatureAmount);
  float dFruit = fruitSDF(p, g, th, fruitStrength);
  float wT = smoothstep(0.14, 0.40, g);
  float wB = smoothstep(0.30, 0.68, g);
  float wL = smoothstep(0.48, 0.88, g);
  float wF = smoothstep(0.72, 1.0, g);
  float d = dSeed;
  d = smin(d, dTrunk, 0.22 * wT);
  d = smin(d, dBranch, 0.16 * wB);
  d = smin(d, dLeaf, 0.20 * wL);
  d = smin(d, dFruit, 0.12 * wF);
  return d;
}
vec3 treeSDFGrad(vec3 p, float g, float trunkThick, float branchDensity,
                 float leafDensity, float curvatureAmount, float fruitStrength, float time){
  float e = 0.007;
  float d = treeSDF(p, g, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength, time);
  vec3 gfd = vec3(
    treeSDF(p+vec3(e,0,0), g, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength, time) - d,
    treeSDF(p+vec3(0,e,0), g, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength, time) - d,
    treeSDF(p+vec3(0,0,e), g, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength, time) - d
  );
  float len2 = dot(gfd, gfd);
  if(len2 < 1e-14) return vec3(0.0, 1.0, 0.0);
  return gfd * inversesqrt(len2);
}
`;

const SIMPLEX4D = /* glsl */ `
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
`;

/** 30 路独立场：融合 curl、simplex、SDF 形变与极坐标/折叠类非线性 */
const THIRTY_FIELDS_GLSL = /* glsl */ `
${SIMPLEX4D}
${TREE_SDF_GLSL}

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

vec3 curlNoise(vec3 p, float t, float scaleSc){
  float e = 0.0022;
  vec4 base = vec4(p * scaleSc, t);
  float dx = fbm4(base + vec4(e,0,0,0), 4, 2.05, 0.5) - fbm4(base - vec4(e,0,0,0), 4, 2.05, 0.5);
  float dy = fbm4(base + vec4(0,e,0,0), 4, 2.05, 0.5) - fbm4(base - vec4(0,e,0,0), 4, 2.05, 0.5);
  float dz = fbm4(base + vec4(0,0,e,0), 4, 2.05, 0.5) - fbm4(base - vec4(0,0,e,0), 4, 2.05, 0.5);
  float inv = 1.0 / (2.0 * e);
  return vec3(dy - dz, dz - dx, dx - dy) * inv;
}

vec3 simplexForce(vec3 p, float t, float gain){
  vec3 s = vec3(
    snoise4(vec4(p * 1.35, t * 0.4)),
    snoise4(vec4(p * 1.35 + vec3(5.2, 3.1, 1.7), t * 0.37)),
    snoise4(vec4(p * 1.35 + vec3(11.3, 7.9, 2.4), t * 0.42))
  );
  return s * gain;
}

/** SDF 形变：沿距离调节坐标，用于「多维折叠」感 */
vec3 foldWarp(vec3 p, float g, float tt,
  float trunkThick, float br, float lf, float curv, float fr){
  float d = treeSDF(p, g, trunkThick, br, lf, curv, fr, tt);
  vec3 grad = treeSDFGrad(p, g, trunkThick, br, lf, curv, fr, tt);
  float w = smoothstep(0.35, 0.0, d);
  return p + grad * w * 0.22 * sin(tt * 0.8 + dot(p, vec3(1.1, 0.7, 1.3)));
}

vec3 fieldMode(int mode, vec3 pos, float t, float g, float noiseScale,
  float trunkThick, float branchDensity, float leafDensity, float curvatureAmount, float fruitStrength){
  vec3 p = pos;
  vec3 F = vec3(0.0);
  vec3 c0 = curlNoise(p, t * 0.25, 1.15 * noiseScale);
  vec3 c1 = curlNoise(p * 1.85 + 3.0, t * 0.38, 2.0 * noiseScale);
  vec3 s0 = simplexForce(p, t, noiseScale);
  float d = treeSDF(p, g, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength, t);
  vec3 gd = treeSDFGrad(p, g, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength, t);
  float r = length(p) + 1e-5;
  vec3 rad = p / r;
  float ang = atan(p.z, p.x);
  vec3 pw = foldWarp(p, g, t, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength);

  if(mode == 0){ F = c0 + c1 * 0.42 + s0 * 0.45; }
  else if(mode == 1){ F = c0 * 1.35 + curlNoise(p * 3.2, t * 0.5, noiseScale * 0.6) * 0.5; }
  else if(mode == 2){ F = -rad * (0.85 + 0.35 * snoise4(vec4(p * 0.8, t * 0.2))) + c0 * 0.25; }
  else if(mode == 3){ F = normalize(cross(c0, gd) + vec3(1e-5)) * 1.1 + c0 * 0.35; }
  else if(mode == 4){
    F = vec3(-sin(ang) * (1.0 + 0.3 * s0.y), p.y * 0.35 + s0.x * 0.2, cos(ang) * (1.0 + 0.3 * s0.y)) * 0.9;
    F += c0 * 0.2;
  }
  else if(mode == 5){ F = vec3(s0.x, 1.2 + 0.4 * sin(t + p.y * 3.0), s0.z) * 0.55 + c1 * 0.2; }
  else if(mode == 6){
    float u = p.x * 0.5, v = p.y * 0.5;
    vec3 tk = vec3(sin(u + t), cos(u * 1.7 + v), sin(v * 1.3 + t * 0.6));
    F = normalize(tk + 1e-4) * 1.05 + c0 * 0.3;
  }
  else if(mode == 7){
    vec3 pp = p * 0.35;
    F = vec3(
      6.0 * (pp.y - pp.x) + s0.x * 0.15,
      pp.x * (28.0 - pp.z) - pp.y + s0.y * 0.15,
      pp.x * pp.y - 2.666 * pp.z + s0.z * 0.15
    ) * 0.035;
  }
  else if(mode == 8){ F = c0 * 1.2 + vec3(fbm4(vec4(p * 2.0, t*0.15), 5, 2.0, 0.55)); }
  else if(mode == 9){
    vec3 q = pw;
    q.xz *= sign(sin(dot(q, vec3(3.1, 1.7, 2.3)) + t * 1.1));
    F = curlNoise(q, t * 0.3, noiseScale) * 1.1 + simplexForce(q, t, 0.4);
  }
  else if(mode == 10){
    F = rad * (fbm4(vec4(p, t * 0.25), 3, 1.9, 0.52) * 2.5) + c0 * 0.35;
    F -= gd * smoothstep(0.0, 0.45, -d) * 0.45;
  }
  else if(mode == 11){ F = gd * sin(d * 8.0 - t * 4.0) * 0.65 + c1 * 0.4; }
  else if(mode == 12){
    float hyp = atan(p.y, r) * 1.3;
    F = vec3(cos(hyp + t) * rad.x, sin(hyp * 1.7), cos(hyp - t * 0.7) * rad.z) * 0.75 + c0 * 0.25;
  }
  else if(mode == 13){ F = vec3(-p.y, p.x, p.z * 0.35 + sin(r * 6.0 - t * 2.0) * 0.25) * 0.5 + s0 * 0.35; }
  else if(mode == 14){
    vec3 tor = vec3(cos(ang * 2.0), sin(ang * 2.0 + p.y * 3.0), sin(ang + t));
    F = normalize(tor) * 0.95 + c1 * 0.3;
  }
  else if(mode == 15){ F = c0 - rad * fbm4(vec4(p * 0.9, t * 0.4), 4, 2.1, 0.5) * 1.1; }
  else if(mode == 16){
    vec3 c0r = curlNoise(-p, -t * 0.18, noiseScale * 1.1);
    F = c0r * 1.25 + s0 * 0.35;
  }
  else if(mode == 17){
    F = vec3(sin(p.x * 4.0 + t), cos(p.z * 4.0 + t * 0.8), sin((p.x + p.z) * 3.0 + t * 1.1)) * 0.5 + c0 * 0.4;
  }
  else if(mode == 18){
    float ly = floor(p.y * 5.0 + t * 0.2);
    F = vec3(snoise4(vec4(p.x * 3.0, ly, p.z * 3.0, t * 0.1)), 0.15 * sin(ly + t), 0.0) + c1 * 0.25;
  }
  else if(mode == 19){ F = vec3(p.z * 0.35, -r * 0.25 + 0.2 * sin(t + r * 5.0), -p.x * 0.35) + c0 * 0.35; }
  else if(mode == 20){ F = c0 * 0.9 - rad * dot(rad, c1) * 1.2 + gd * 0.15; }
  else if(mode == 21){
    vec3 q = vec3(p.z, p.y, -p.x);
    F = curlNoise(q * 1.4 + 2.0, t * 0.22, noiseScale) + simplexForce(q, t, 0.42);
  }
  else if(mode == 22){
    float h = exp(-r * 0.45);
    F = vec3(-p.z, 0.55 * h + 0.15 * sin(t * 2.0), p.x) * (0.45 + 0.35 * h) + c0 * 0.22;
  }
  else if(mode == 23){ F = vec3(s0.x * 0.6, (fbm4(vec4(p*1.2,t*0.12),4,2.0,0.5) - 0.1) * 0.8, s0.z * 0.6) + c1 * 0.2; }
  else if(mode == 24){
    vec3 ax = normalize(vec3(1.0, 0.6, 0.45));
    F = ax * snoise4(vec4(dot(p, ax) * 3.0, p.y * 2.0, p.z * 2.0, t * 0.25)) + c0 * 0.45;
  }
  else if(mode == 25){ F = curlNoise(p * 0.6, t * 0.15, noiseScale * 0.85) * 1.4 + s0 * 0.2; }
  else if(mode == 26){ F = -c0 * 1.05 + simplexForce(-p, t * 0.9, noiseScale * 0.5); }
  else if(mode == 27){
    float sh = smoothstep(0.12, 0.0, abs(d));
    F = normalize(cross(gd, rad + vec3(0.001))) * sh * 1.5 + c0 * 0.35;
  }
  else if(mode == 28){
    vec3 h = vec3(snoise4(vec4(p, t*0.2)), snoise4(vec4(p*1.1+2.0,t*0.18)), snoise4(vec4(p*1.1-2.0,t*0.22)));
    F = cross(normalize(h+0.1), rad) * 0.95 + c1 * 0.25;
  }
  else { F = c0 * 0.55 + c1 * 0.35 + s0 * 0.45 - gd * smoothstep(0.25, 0.0, d) * 0.55; }
  return F;
}

vec3 computeParticleAcceleration(
  vec3 pos, float t, float dt, float g, float noiseIntensity, float noiseScale,
  float curlStr, float curlBoost, float attractBoost, float attractStrength,
  float trunkThick, float branchDensity, float leafDensity, float curvatureAmount, float fruitStrength,
  int phase, float typingPulse, float introBurst, int fieldModeId
){
  vec3 F = vec3(0.0);
  float nBase = noiseIntensity * noiseScale * max(0.08, curlStr) * curlBoost;
  int fm = fieldModeId;
  if(fm < 0) fm = 0;
  if(fm > 29) fm = 29;
  F += fieldMode(fm, pos, t, g, noiseScale, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength) * nBase;

  float d = treeSDF(pos, g, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength, t);
  vec3 grad = treeSDFGrad(pos, g, trunkThick, branchDensity, leafDensity, curvatureAmount, fruitStrength, t);
  float shell = smoothstep(2.8, 0.0, d) * (1.0 - smoothstep(-0.12, 0.15, d));
  float growPull = 0.45 + 0.55 * g;
  F -= grad * attractStrength * attractBoost * shell * growPull;

  if(phase == 1){
    F += normalize(pos + 1e-4) * nBase * 2.8;
    F += curlNoise(pos * 0.9, t * 1.1, 0.75) * nBase * 1.5;
  } else if(phase == 2){
    F -= grad * attractStrength * attractBoost * 1.35 * smoothstep(1.5, 0.0, d);
  }

  if(typingPulse > 0.01){
    float rp = length(pos);
    F += normalize(pos + 1e-4) * sin(rp * 8.0 - t * 11.0) * typingPulse * 0.7;
    F += curlNoise(pos * 2.8, t * 1.8, noiseScale) * typingPulse * 0.45;
  }
  if(introBurst > 0.01){
    F += normalize(pos + 1e-4) * introBurst * 4.5;
    F += curlNoise(pos * 0.85, t * 0.55, noiseScale * 0.5) * introBurst * 2.5;
  }
  return F;
}
`;

let phaseId = 0;
export function setParticlePhase(name) {
  phaseId = { idle: 0, burst: 1, attract: 2, spiral: 3, fracture: 4 }[name] ?? 0;
}
export function getPhaseId() {
  return phaseId;
}

const VEL_HEADER = /* glsl */ `
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
uniform float uTrunkThickness;
uniform float uBranchDensity;
uniform float uLeafDensity;
uniform float uCurvature;
uniform float uFruitAmount;
uniform float uPhase;
uniform float uFieldMode;
uniform float uTypingPulse;
uniform float uIntroBurst;
uniform sampler2D tPos;
uniform sampler2D tVel;
`;

export function createParticleSimUniforms() {
  return {
    uDelta: { value: 0 },
    uTime: { value: 0 },
    uDamping: { value: 0.94 },
    uGrowthProgress: { value: 0 },
    uNoiseIntensity: { value: 0.85 },
    uNoiseScale: { value: 1.4 },
    uCurlStrength: { value: 0.48 },
    uCurlBoost: { value: 1 },
    uAttractBoost: { value: 1 },
    uAttractStrength: { value: 2.8 },
    uTrunkThickness: { value: 0.1 },
    uBranchDensity: { value: 0.65 },
    uLeafDensity: { value: 0.78 },
    uCurvature: { value: 0.55 },
    uFruitAmount: { value: 0.5 },
    uPhase: { value: 0 },
    /** 0–29 矢量场模式 */
    uFieldMode: { value: 0 },
    uSeedRadius: { value: 0.42 },
    uTypingPulse: { value: 0 },
    uIntroBurst: { value: 0 },
  };
}

export function createVelocityStepMaterial(u) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      ${VEL_HEADER}
      varying vec2 vUv;
      ${THIRTY_FIELDS_GLSL}
      void main(){
        vec4 pData = texture2D(tPos, vUv);
        vec3 pos = pData.xyz;
        vec3 vel = texture2D(tVel, vUv).xyz;
        float g = clamp(uGrowthProgress, 0.0, 1.0);
        int ph = int(uPhase + 0.5);
        int fm = int(uFieldMode + 0.5);
        vec3 F = computeParticleAcceleration(
          pos, uTime, uDelta, g,
          uNoiseIntensity, uNoiseScale, uCurlStrength, uCurlBoost, uAttractBoost, uAttractStrength,
          uTrunkThickness, uBranchDensity, uLeafDensity, uCurvature, uFruitAmount,
          ph, uTypingPulse, uIntroBurst, fm
        );
        vel = vel * uDamping + F * uDelta;
        float sp = length(vel);
        if(sp > 9.0) vel *= 9.0 / sp;
        gl_FragColor = vec4(vel, 1.0);
      }
    `,
  });
  mat.uniforms = u;
  return mat;
}

export function createPositionStepMaterial(uniforms) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
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
        life -= uDelta * 0.085;
        if(life < 0.0){
          float a1 = fract(sin(dot(vUv, vec2(12.9898,78.233)))*43758.5453) * 6.28318;
          float a2 = fract(sin(dot(vUv, vec2(93.989,27.345)))*23421.631) * 6.28318;
          float r = uSeedRadius * (0.35 + 0.65 * fract(sin(dot(vUv, vec2(45.23,97.81)))*65432.1));
          pos = vec3(cos(a1)*cos(a2), sin(a2)*0.55, sin(a1)*cos(a2)) * r;
          life = 0.75 + 0.35 * fract(sin(dot(vUv, vec2(17.42, 63.91)))*12345.67);
        }
        float g = clamp(uGrowthProgress, 0.0, 1.0);
        float lim = mix(uSeedRadius * 8.0, 6.5, g);
        float L = length(pos);
        if(L > lim) pos *= lim / max(L, 1e-4);
        gl_FragColor = vec4(pos, life);
      }
    `,
  });
  mat.uniforms = uniforms;
  return mat;
}

export function initTree(scene, sharedUniforms, _shapeUniforms) {
  const group = new THREE.Group();
  scene.add(group);
  return {
    group,
    points: null,
    material: null,
    setGrowthProgress(progress) {
      sharedUniforms.uGrowthProgress.value = Math.max(0, Math.min(1, progress));
    },
    getCanopyWorldPosition(target = new THREE.Vector3()) {
      const g = THREE.MathUtils.clamp(sharedUniforms.uGrowthProgress.value, 0, 1);
      const th = THREE.MathUtils.lerp(0.04, 1.75, THREE.MathUtils.smoothstep(g, 0.12, 0.44));
      target.set(0, th * 0.95, 0);
      group.localToWorld(target);
      return target;
    },
    dispose() {
      scene.remove(group);
    },
  };
}

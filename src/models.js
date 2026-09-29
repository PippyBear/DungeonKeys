// 程序化 3D 模型：角色、敌人、机关与道具。静态部件合并为顶点色几何体。
import * as THREE from 'three';
import { makeRng } from './utils.js';
import { glowTexture, runeTexture, blobTexture, webTexture } from './textures.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n3 = new THREE.Matrix3();
const _c = new THREE.Color();

const geoCache = {};
function G(key, fn) { return geoCache[key] || (geoCache[key] = fn()); }
export const Geo = {
  box: () => G('box', () => new THREE.BoxGeometry(1, 1, 1)),
  sph: (w = 10, h = 7) => G('sph' + w + '_' + h, () => new THREE.SphereGeometry(0.5, w, h)),
  hemi: () => G('hemi', () => new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)),
  cyl: (seg = 10, top = 1) => G('cyl' + seg + '_' + top, () => new THREE.CylinderGeometry(0.5 * top, 0.5, 1, seg)),
  cone: (seg = 8) => G('cone' + seg, () => new THREE.ConeGeometry(0.5, 1, seg)),
  ico: () => G('ico', () => new THREE.IcosahedronGeometry(0.5, 0)),
  oct: () => G('oct', () => new THREE.OctahedronGeometry(0.5, 0)),
  dode: () => G('dode', () => new THREE.DodecahedronGeometry(0.5, 0)),
  torus: (t = 0.2) => G('torus' + t, () => new THREE.TorusGeometry(0.5, t, 6, 16)),
  arc: (t = 0.1) => G('arc' + t, () => new THREE.TorusGeometry(0.5, t, 6, 14, Math.PI)),
  pyr: () => G('pyr', () => { const g = new THREE.ConeGeometry(0.7071, 1, 4); g.rotateY(Math.PI / 4); return g; }),
};

function nonIndexed(g) {
  if (!g.userData.ni) g.userData.ni = g.index ? g.toNonIndexed() : g;
  return g.userData.ni;
}

export class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; }
  add(geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, shadeTop = 0) {
    const g = nonIndexed(geo);
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    _n3.getNormalMatrix(_m);
    _c.setHex(color);
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    for (let i = 0; i < pos.length; i += 3) {
      _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(_m);
      this.p.push(_v.x, _v.y, _v.z);
      // 简易环境光遮蔽：越靠近地面越暗
      const ao = shadeTop ? Math.min(1, 0.55 + _v.y * shadeTop) : 1;
      this.c.push(_c.r * ao, _c.g * ao, _c.b * ao);
      _v.set(nor[i], nor[i + 1], nor[i + 2]).applyMatrix3(_n3).normalize();
      this.n.push(_v.x, _v.y, _v.z);
    }
    return this;
  }
  get empty() { return this.p.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
  mesh(shadow = true, mat) {
    const m = new THREE.Mesh(this.geometry(), mat || matVC());
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }
}

// ---------------------------------------------------------------- 材质与墙体剖切
export const CUT = { uPlayer: { value: new THREE.Vector3() }, uCutOn: { value: 1 } };
export function applyCutaway(mat, cutY = 0.95, wallAttr = false) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPlayer = CUT.uPlayer;
    sh.uniforms.uCutOn = CUT.uCutOn;
    sh.vertexShader = (wallAttr ? 'attribute float aWall;\nvarying float vWall;\n' : '') + 'varying vec3 vCutWorld;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;' + (wallAttr ? '\n vWall = aWall;' : ''));
    sh.fragmentShader = (wallAttr ? 'varying float vWall;\n' : '') + 'uniform vec3 uPlayer;\nuniform float uCutOn;\nvarying vec3 vCutWorld;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      {
        vec3 dp = vCutWorld - uPlayer;
        if (uCutOn > 0.5 && dp.y > ${cutY.toFixed(2)} && dp.z > 0.3 && dp.z < 10.0${wallAttr ? ' && (vWall > 0.5 || dp.y > 2.4)' : ''}) {
          float halfW = 2.4 + dp.z * 0.4;
          float ax = abs(dp.x);
          if (ax < halfW) {
            float edge = smoothstep(halfW - 1.4, halfW, ax) + smoothstep(8.0, 10.0, dp.z);
            float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
            if (n > edge) discard;
          }
        }
      }`);
  };
  mat.customProgramCacheKey = () => 'cutaway' + cutY + (wallAttr ? 'w' : '');
  return mat;
}

let _vc = null, _vcNoCut = null;
export function matVC() {
  if (!_vc) { _vc = applyCutaway(new THREE.MeshLambertMaterial({ vertexColors: true }), 2.35); _vc.userData.shared = true; }
  return _vc;
}
// 角色用：不剖切，带边缘光（轮廓在黑暗里更立体）
export const RIM = { uRimColor: { value: new THREE.Color(0x8aa8ff) }, uRimStrength: { value: 0.55 } };
export function applyRim(mat, strength) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = RIM.uRimColor;
    sh.uniforms.uRimStrength = strength === undefined ? RIM.uRimStrength : { value: strength };
    sh.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRimStrength;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 rimV = normalize(vViewPosition);
        float rim = 1.0 - clamp(dot(normal, rimV), 0.0, 1.0);
        outgoingLight += uRimColor * pow(rim, 2.6) * uRimStrength;
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'rim' + (strength === undefined ? '' : strength);
  return mat;
}
export function matChar() {
  if (!_vcNoCut) { _vcNoCut = applyRim(new THREE.MeshLambertMaterial({ vertexColors: true })); _vcNoCut.userData.shared = true; }
  return _vcNoCut;
}
// 描边（反向外壳）：给角色一圈深色轮廓
let _outlineMat = null;
export function outlineMat() {
  if (!_outlineMat) {
    _outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0610, side: THREE.BackSide });
    _outlineMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * 0.035;');
    };
    _outlineMat.customProgramCacheKey = () => 'outline';
    _outlineMat.userData.shared = true;
  }
  return _outlineMat;
}
export function addOutlines(root) {
  if (root.userData.outlined) return root;
  root.userData.outlined = true;
  const list = [];
  root.traverse((o) => { if (o.isMesh && o.material === matChar() && !o.userData.outline) list.push(o); });
  for (const m of list) {
    const o = new THREE.Mesh(m.geometry, outlineMat());
    o.userData.outline = true;
    o.raycast = () => {};
    m.add(o);
  }
  return root;
}
const basicCache = {};
export function matGlow(color, opacity = 1) {
  const k = color + '_' + opacity;
  if (!basicCache[k]) {
    basicCache[k] = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, fog: false });
    basicCache[k].userData.shared = true;
  }
  return basicCache[k];
}
export function glowSprite(color, size = 2, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.set(size, size, 1);
  s.renderOrder = 20;
  return s;
}
let _blobMat = null;
export function blobShadow(size = 1.2) {
  if (!_blobMat) { _blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }); _blobMat.userData.shared = true; }
  const g = G('blobplane', () => { const p = new THREE.PlaneGeometry(1, 1); p.rotateX(-Math.PI / 2); return p; });
  const m = new THREE.Mesh(g, _blobMat);
  m.scale.set(size, 1, size);
  m.position.y = 0.02;
  m.renderOrder = 2;
  return m;
}

function rig(parts) {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  for (const p of parts) pivot.add(p);
  return { root, pivot };
}
function partMesh(b, x = 0, y = 0, z = 0) {
  const m = b.mesh(true, matChar());
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(m);
  return g;
}

// ---------------------------------------------------------------- 主角：小骑士
export function makeHero() {
  const skin = 0xf2c9a0, steel = 0xb8c2cc, steelD = 0x7a8692, tunic = 0x2f5fa8, red = 0xc8302a, brown = 0x5a3a1e;
  const b = new Builder();
  b.add(Geo.sph(), brown, -0.16, 0.13, 0, 0.22, 0.26, 0.3);
  b.add(Geo.sph(), brown, 0.16, 0.13, 0, 0.22, 0.26, 0.3);
  b.add(Geo.cyl(10, 0.8), tunic, 0, 0.45, 0, 0.62, 0.55, 0.5);
  b.add(Geo.sph(), steel, 0, 0.62, 0.02, 0.6, 0.46, 0.46);
  b.add(Geo.box(), 0x5a3a1e, 0, 0.42, 0, 0.64, 0.08, 0.5);
  b.add(Geo.box(), 0xffcf4a, 0, 0.42, 0.25, 0.1, 0.08, 0.02);
  b.add(Geo.sph(), steelD, -0.32, 0.7, 0, 0.26, 0.2, 0.26);
  b.add(Geo.sph(), steelD, 0.32, 0.7, 0, 0.26, 0.2, 0.26);
  b.add(Geo.sph(), skin, -0.36, 0.48, 0.04, 0.16, 0.3, 0.16);
  // 头盔
  b.add(Geo.sph(12, 9), steel, 0, 1.08, 0, 0.66, 0.62, 0.64);
  b.add(Geo.sph(10, 7), skin, 0, 1.02, 0.18, 0.46, 0.34, 0.34);
  b.add(Geo.box(), 0x141414, -0.1, 1.05, 0.34, 0.07, 0.1, 0.02);
  b.add(Geo.box(), 0x141414, 0.1, 1.05, 0.34, 0.07, 0.1, 0.02);
  b.add(Geo.box(), steelD, 0, 1.2, 0.3, 0.52, 0.08, 0.1);
  b.add(Geo.cyl(10), steelD, 0, 0.84, 0, 0.62, 0.06, 0.6);
  b.add(Geo.cone(6), red, 0, 1.42, -0.12, 0.14, 0.3, 0.4, -0.9, 0, 0);
  b.add(Geo.sph(6, 5), red, 0, 1.46, -0.28, 0.16, 0.18, 0.36);
  const body = partMesh(b);
  // 披风
  const cb = new Builder();
  cb.add(Geo.box(), red, 0, -0.3, 0, 0.56, 0.62, 0.05);
  cb.add(Geo.box(), 0xffcf4a, 0, -0.6, 0.01, 0.56, 0.04, 0.05);
  const cape = partMesh(cb, 0, 0.86, -0.25);
  cape.rotation.x = 0.15;
  // 剑（右臂挥砍枢轴）
  const sb = new Builder();
  sb.add(Geo.sph(), skin, 0, 0, 0, 0.16, 0.16, 0.16);
  sb.add(Geo.cyl(6), brown, 0, 0, 0.1, 0.07, 0.24, 0.07, Math.PI / 2, 0, 0);
  sb.add(Geo.box(), 0xffcf4a, 0, 0, 0.24, 0.32, 0.06, 0.08);
  sb.add(Geo.box(), 0xe8eef4, 0, 0, 0.72, 0.1, 0.04, 0.88);
  sb.add(Geo.cone(4), 0xe8eef4, 0, 0, 1.2, 0.1, 0.16, 0.04, Math.PI / 2, 0, 0);
  const sword = partMesh(sb);
  const arm = new THREE.Group();
  arm.position.set(0.38, 0.58, 0.08);
  arm.add(sword);
  // 左手小盾
  const shb = new Builder();
  shb.add(Geo.cyl(12), 0x8a5a2a, 0, 0, 0, 0.5, 0.08, 0.5, Math.PI / 2, 0, 0);
  shb.add(Geo.cyl(12), steel, 0, 0, 0.03, 0.2, 0.06, 0.2, Math.PI / 2, 0, 0);
  shb.add(Geo.torus(0.15), steel, 0, 0, 0, 0.5, 0.5, 0.4);
  const shield = partMesh(shb, -0.42, 0.55, 0.12);
  shield.rotation.y = -0.6;
  const r = rig([body, cape, arm, shield]);
  r.arm = arm; r.cape = cape; r.sword = sword; r.shield = shield; r.height = 1.6;
  return r;
}

// ---------------------------------------------------------------- 敌人
export function makeSkeleton(archer = false) {
  const bone = 0xe8e0cc, dark = 0x6a6258;
  const b = new Builder();
  b.add(Geo.cyl(6), bone, -0.14, 0.26, 0, 0.08, 0.5, 0.08);
  b.add(Geo.cyl(6), bone, 0.14, 0.26, 0, 0.08, 0.5, 0.08);
  b.add(Geo.box(), bone, 0, 0.54, 0, 0.36, 0.1, 0.2);
  b.add(Geo.cyl(6), bone, 0, 0.72, -0.04, 0.07, 0.4, 0.07);
  for (let i = 0; i < 3; i++) b.add(Geo.torus(0.12), bone, 0, 0.7 + i * 0.1, 0, 0.44 - i * 0.03, 0.44 - i * 0.03, 0.34, Math.PI / 2, 0, 0);
  b.add(Geo.box(), bone, 0, 0.98, 0, 0.5, 0.07, 0.14);
  b.add(Geo.cyl(6), bone, -0.3, 0.8, 0, 0.07, 0.36, 0.07, 0, 0, 0.2);
  if (archer) b.add(Geo.hemi(), 0x3a3a2a, 0, 1.26, -0.02, 0.56, 0.5, 0.56);
  b.add(Geo.sph(10, 8), bone, 0, 1.22, 0, 0.46, 0.42, 0.44);
  b.add(Geo.box(), bone, 0, 1.06, 0.1, 0.3, 0.12, 0.24);
  b.add(Geo.sph(), 0x141010, -0.1, 1.24, 0.19, 0.13, 0.14, 0.06);
  b.add(Geo.sph(), 0x141010, 0.1, 1.24, 0.19, 0.13, 0.14, 0.06);
  b.add(Geo.box(), 0x141010, 0, 1.04, 0.22, 0.2, 0.03, 0.02);
  if (!archer) b.add(Geo.box(), 0x5a4a3a, -0.34, 0.66, 0, 0.1, 0.5, 0.5);
  const body = partMesh(b);
  const eyes = new THREE.Group();
  const eg = new THREE.Mesh(Geo.sph(6, 4), matGlow(0xff3a2a));
  eg.scale.setScalar(0.07); eg.position.set(-0.1, 1.24, 0.21);
  const eg2 = eg.clone(); eg2.position.x = 0.1;
  eyes.add(eg, eg2);
  const wb = new Builder();
  if (archer) {
    wb.add(Geo.torus(0.06), 0x6a4a2a, 0, 0, 0.3, 0.9, 0.9, 0.6, 0, Math.PI / 2, 0);
    wb.add(Geo.box(), 0xdddddd, 0, 0, 0.3, 0.01, 0.86, 0.01);
  } else {
    wb.add(Geo.cyl(6), 0x4a3020, 0, 0, 0.08, 0.06, 0.2, 0.06, Math.PI / 2, 0, 0);
    wb.add(Geo.box(), 0x8a8078, 0, 0, 0.55, 0.08, 0.04, 0.8);
    wb.add(Geo.box(), 0x6a5a4a, 0, 0, 0.2, 0.24, 0.05, 0.06);
  }
  const weapon = partMesh(wb);
  const arm = new THREE.Group();
  arm.position.set(0.3, 0.82, 0.05);
  arm.add(weapon);
  const r = rig([body, eyes, arm]);
  r.arm = arm; r.height = 1.5;
  return r;
}

export function makeSlime(color = 0x5ad84a, s = 1) {
  const mat = new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.78, shininess: 90, specular: 0x88ffaa, emissive: color, emissiveIntensity: 0.18 });
  const g = new THREE.Mesh(Geo.sph(14, 10), mat);
  g.scale.set(1.0 * s, 0.75 * s, 1.0 * s);
  g.userData.s = s;
  g.position.y = 0.36 * s;
  g.castShadow = true;
  const core = new THREE.Mesh(Geo.sph(8, 6), matGlow(0x1a6a1a));
  core.scale.setScalar(0.3 * s); core.position.y = 0.3 * s;
  const eb = new Builder();
  eb.add(Geo.sph(), 0xffffff, -0.15 * s, 0.5 * s, 0.38 * s, 0.16 * s, 0.2 * s, 0.1 * s);
  eb.add(Geo.sph(), 0xffffff, 0.15 * s, 0.5 * s, 0.38 * s, 0.16 * s, 0.2 * s, 0.1 * s);
  eb.add(Geo.sph(), 0x101010, -0.15 * s, 0.5 * s, 0.43 * s, 0.08 * s, 0.11 * s, 0.05 * s);
  eb.add(Geo.sph(), 0x101010, 0.15 * s, 0.5 * s, 0.43 * s, 0.08 * s, 0.11 * s, 0.05 * s);
  const eyes = partMesh(eb);
  const r = rig([g, core, eyes]);
  r.blob = g; r.height = 0.9 * s;
  return r;
}

export function makeBat() {
  const b = new Builder();
  b.add(Geo.sph(), 0x3a2a4a, 0, 0, 0, 0.44, 0.4, 0.44);
  b.add(Geo.cone(4), 0x3a2a4a, -0.13, 0.26, 0, 0.12, 0.22, 0.08);
  b.add(Geo.cone(4), 0x3a2a4a, 0.13, 0.26, 0, 0.12, 0.22, 0.08);
  b.add(Geo.cone(4), 0xffffff, -0.06, -0.12, 0.2, 0.04, 0.08, 0.04, Math.PI, 0, 0);
  b.add(Geo.cone(4), 0xffffff, 0.06, -0.12, 0.2, 0.04, 0.08, 0.04, Math.PI, 0, 0);
  const body = partMesh(b);
  const eg = new THREE.Mesh(Geo.sph(6, 4), matGlow(0xffe03a));
  eg.scale.setScalar(0.08); eg.position.set(-0.09, 0.05, 0.2);
  const eg2 = eg.clone(); eg2.position.x = 0.09;
  const wing = (side) => {
    const wb = new Builder();
    wb.add(Geo.box(), 0x4a3a5a, side * 0.4, 0, 0, 0.7, 0.03, 0.4);
    wb.add(Geo.box(), 0x2a1a3a, side * 0.75, 0, -0.1, 0.1, 0.05, 0.5);
    const g = partMesh(wb, side * 0.15, 0.02, 0);
    return g;
  };
  const wl = wing(-1), wr = wing(1);
  const r = rig([body, eg, eg2, wl, wr]);
  r.wl = wl; r.wr = wr; r.height = 0.8;
  r.pivot.position.y = 1.4;
  return r;
}

export function makeGolem() {
  const rock = 0x8a8290, rockD = 0x635c6a;
  const b = new Builder();
  const rng = makeRng(33);
  b.add(Geo.dode(), rock, -0.5, 0.55, 0, 0.7, 1.1, 0.7);
  b.add(Geo.dode(), rock, 0.5, 0.55, 0, 0.7, 1.1, 0.7);
  b.add(Geo.dode(), rock, 0, 1.7, 0, 2.0, 1.6, 1.4);
  b.add(Geo.dode(), rockD, 0, 2.7, 0.1, 1.0, 0.8, 0.9);
  for (let i = 0; i < 8; i++) b.add(Geo.dode(), rockD, rng.range(-0.8, 0.8), rng.range(1.2, 2.3), rng.range(-0.6, 0.6), 0.5, 0.4, 0.5, rng() * 3, rng() * 3, 0);
  b.add(Geo.dode(), rockD, -1.1, 2.3, 0, 0.9, 0.8, 0.9);
  b.add(Geo.dode(), rockD, 1.1, 2.3, 0, 0.9, 0.8, 0.9);
  const body = partMesh(b);
  const glow = new THREE.Group();
  for (const [x, y, z, s] of [[-0.18, 2.75, 0.52, 0.12], [0.18, 2.75, 0.52, 0.12], [0, 1.8, 0.66, 0.3], [0.4, 1.4, 0.6, 0.12], [-0.3, 2.1, 0.64, 0.14]]) {
    const m = new THREE.Mesh(Geo.sph(6, 4), matGlow(0xff7a1a));
    m.scale.setScalar(s); m.position.set(x, y, z);
    glow.add(m);
  }
  const fist = (side) => {
    const fb = new Builder();
    fb.add(Geo.dode(), rock, 0, -0.5, 0, 0.6, 1.0, 0.6);
    fb.add(Geo.dode(), rockD, 0, -1.2, 0.1, 0.9, 0.8, 0.9);
    return partMesh(fb, side * 1.35, 2.3, 0);
  };
  const fl = fist(-1), fr = fist(1);
  const r = rig([body, glow, fl, fr]);
  r.fl = fl; r.fr = fr; r.glow = glow; r.height = 3.4;
  return r;
}

export function makeMimic() {
  const b = new Builder();
  b.add(Geo.box(), 0x7a4a22, 0, 0.3, 0, 1.1, 0.6, 0.8);
  b.add(Geo.box(), 0xb89a3a, 0, 0.3, 0, 1.14, 0.1, 0.84);
  for (let i = 0; i < 5; i++) b.add(Geo.cone(4), 0xf0ead8, -0.4 + i * 0.2, 0.66, 0.36, 0.1, 0.18, 0.08);
  b.add(Geo.box(), 0xc0303a, 0, 0.62, 0.1, 0.5, 0.06, 0.5);
  const body = partMesh(b);
  const lb = new Builder();
  lb.add(Geo.box(), 0x7a4a22, 0, 0.15, 0.4, 1.12, 0.3, 0.82);
  lb.add(Geo.box(), 0xb89a3a, 0, 0.15, 0.82, 1.16, 0.32, 0.06);
  for (let i = 0; i < 5; i++) lb.add(Geo.cone(4), 0xf0ead8, -0.4 + i * 0.2, -0.05, 0.76, 0.1, 0.16, 0.08, Math.PI, 0, 0);
  const lid = partMesh(lb, 0, 0.62, -0.4);
  const eg = new THREE.Mesh(Geo.sph(6, 4), matGlow(0xffe03a));
  eg.scale.setScalar(0.1); eg.position.set(-0.2, 0.2, 0.42);
  lid.add(eg);
  const eg2 = eg.clone(); eg2.position.x = 0.2; lid.add(eg2);
  const r = rig([body, lid]);
  r.lid = lid; r.height = 1.1;
  return r;
}

// ---------------------------------------------------------------- 机关与道具
export function makeTorch(c1 = 0xff7a1a, c2 = 0xffe06a, gc = 0xff8a2a) {
  const b = new Builder();
  b.add(Geo.box(), 0x2a2a2e, 0, 0, -0.08, 0.2, 0.36, 0.08);
  b.add(Geo.box(), 0x2a2a2e, 0, 0.02, 0.12, 0.06, 0.06, 0.34, -0.5, 0, 0);
  b.add(Geo.cyl(6, 1.3), 0x5a3a1e, 0, 0.2, 0.26, 0.12, 0.44, 0.12, -0.3, 0, 0);
  b.add(Geo.cyl(8, 1.4), 0x2a2a2e, 0, 0.42, 0.33, 0.2, 0.12, 0.2);
  const root = new THREE.Group();
  root.add(b.mesh(false));
  const flame = new THREE.Group();
  const f1 = new THREE.Mesh(Geo.cone(6), matGlow(c1));
  f1.scale.set(0.22, 0.42, 0.22); f1.position.y = 0.18;
  const f2 = new THREE.Mesh(Geo.cone(6), matGlow(c2));
  f2.scale.set(0.12, 0.26, 0.12); f2.position.y = 0.12;
  flame.add(f1, f2);
  flame.position.set(0, 0.5, 0.34);
  root.add(flame);
  const glow = glowSprite(gc, 2.4, 0.55);
  glow.position.set(0, 0.7, 0.36);
  root.add(glow);
  return { root, flame, glow };
}

export function makePillar(h = 2.6) {
  const b = new Builder();
  b.add(Geo.box(), 0x4a4452, 0, 0.12, 0, 1.3, 0.24, 1.3, 0, 0, 0, 0.5);
  b.add(Geo.box(), 0x5a5460, 0, 0.3, 0, 1.1, 0.14, 1.1);
  b.add(Geo.cyl(10), 0x5e5866, 0, h / 2, 0, 0.8, h - 0.6, 0.8, 0, 0, 0, 0.3);
  b.add(Geo.box(), 0x5a5460, 0, h - 0.24, 0, 1.1, 0.14, 1.1);
  b.add(Geo.box(), 0x4a4452, 0, h - 0.08, 0, 1.3, 0.2, 1.3);
  return b.mesh(true);
}

export function makeBarrel(seed = 1) {
  const b = new Builder();
  b.add(Geo.cyl(10), 0x6a4a2a, 0, 0.45, 0, 0.8, 0.9, 0.8, 0, seed, 0, 0.8);
  b.add(Geo.cyl(10), 0x7a5a3a, 0, 0.45, 0, 0.86, 0.5, 0.86);
  b.add(Geo.cyl(10), 0x3a3a3e, 0, 0.18, 0, 0.84, 0.06, 0.84);
  b.add(Geo.cyl(10), 0x3a3a3e, 0, 0.72, 0, 0.84, 0.06, 0.84);
  b.add(Geo.cyl(10), 0x5a3a1e, 0, 0.9, 0, 0.72, 0.02, 0.72);
  return b.mesh(true);
}

export function makePot(seed = 1) {
  const rng = makeRng(seed);
  const col = rng.pick([0x9a5a3a, 0x7a6a5a, 0x8a4a2a]);
  const b = new Builder();
  b.add(Geo.sph(10, 8), col, 0, 0.32, 0, 0.6, 0.6, 0.6, 0, 0, 0, 0.9);
  b.add(Geo.cyl(10), col, 0, 0.66, 0, 0.3, 0.16, 0.3);
  b.add(Geo.cyl(10), 0x5a3a1e, 0, 0.75, 0, 0.36, 0.04, 0.36);
  b.add(Geo.torus(0.1), 0xc9a45a, 0, 0.38, 0, 0.58, 0.58, 0.4, Math.PI / 2, 0, 0);
  return b.mesh(true);
}

export function makeCrate() {
  const b = new Builder();
  const w = 1.7;
  b.add(Geo.box(), 0x8a6238, 0, w / 2, 0, w, w, w, 0, 0, 0, 0.35);
  for (const y of [0.1, w - 0.1]) for (const s of [-1, 1]) {
    b.add(Geo.box(), 0x5a3a1e, 0, y, s * w / 2, w + 0.04, 0.16, 0.06);
    b.add(Geo.box(), 0x5a3a1e, s * w / 2, y, 0, 0.06, 0.16, w + 0.04);
  }
  for (const s of [-1, 1]) for (const t of [-1, 1]) b.add(Geo.box(), 0x3a3a3e, s * (w / 2 - 0.04), w / 2, t * (w / 2 - 0.04), 0.14, w + 0.02, 0.14);
  b.add(Geo.box(), 0x5a3a1e, 0, w / 2, w / 2 + 0.01, 0.16, w * 1.3, 0.04, 0, 0, 0.78);
  b.add(Geo.box(), 0x5a3a1e, w / 2 + 0.01, w / 2, 0, 0.04, w * 1.3, 0.16, 0.78, 0, 0);
  b.add(Geo.box(), 0x5a3a1e, -w / 2 - 0.01, w / 2, 0, 0.04, w * 1.3, 0.16, -0.78, 0, 0);
  b.add(Geo.box(), 0x5a3a1e, 0, w / 2, -w / 2 - 0.01, 0.16, w * 1.3, 0.04, 0, 0, -0.78);
  return b.mesh(true);
}

export function makeChest() {
  const b = new Builder();
  b.add(Geo.box(), 0x7a4a22, 0, 0.3, 0, 1.2, 0.6, 0.8, 0, 0, 0, 0.9);
  b.add(Geo.box(), 0xc9a45a, 0, 0.3, 0.41, 1.22, 0.08, 0.02);
  for (const s of [-1, 1]) b.add(Geo.box(), 0xc9a45a, s * 0.5, 0.3, 0, 0.08, 0.62, 0.84);
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const lb = new Builder();
  lb.add(Geo.cyl(10, 1), 0x8a5a2a, 0, 0.0, 0.4, 0.8, 1.2, 0.8, 0, 0, Math.PI / 2);
  lb.add(Geo.box(), 0x7a4a22, 0, -0.1, 0.4, 1.2, 0.2, 0.8);
  for (const s of [-1, 1]) lb.add(Geo.cyl(10), 0xc9a45a, s * 0.5, 0.0, 0.4, 0.84, 0.08, 0.84, 0, 0, Math.PI / 2);
  lb.add(Geo.box(), 0xffcf4a, 0, -0.08, 0.82, 0.2, 0.26, 0.06);
  const lidMesh = lb.mesh(true);
  lidMesh.scale.y = 0.6;
  const lid = new THREE.Group();
  lid.position.set(0, 0.6, -0.4);
  lid.add(lidMesh);
  root.add(lid);
  return { root, lid };
}

export function makeKey(color = 0xffcf4a) {
  const b = new Builder();
  b.add(Geo.torus(0.28), color, 0, 0.45, 0, 0.5, 0.5, 0.5);
  b.add(Geo.cyl(8), color, 0, -0.1, 0, 0.14, 0.9, 0.14);
  b.add(Geo.box(), color, 0.12, -0.4, 0, 0.22, 0.1, 0.1);
  b.add(Geo.box(), color, 0.1, -0.24, 0, 0.18, 0.08, 0.1);
  b.add(Geo.oct(), 0xff3a4a, 0, 0.45, 0, 0.18, 0.22, 0.18);
  const g = new THREE.Group();
  const m = b.mesh(false, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 120, specular: 0xffffff, emissive: 0x3a2a00 }));
  g.add(m);
  g.add(glowSprite(0xffd86a, 2.6, 0.7));
  return g;
}

export function makeCoin() {
  const m = new THREE.Mesh(G('coin', () => new THREE.CylinderGeometry(0.22, 0.22, 0.06, 14).rotateX(Math.PI / 2)), new THREE.MeshPhongMaterial({ color: 0xffcf4a, shininess: 100, specular: 0xffffff, emissive: 0x3a2a00 }));
  m.castShadow = true;
  return m;
}

export function makeHeartPickup() {
  const b = new Builder();
  b.add(Geo.sph(), 0xe8303a, -0.14, 0.08, 0, 0.34, 0.34, 0.24);
  b.add(Geo.sph(), 0xe8303a, 0.14, 0.08, 0, 0.34, 0.34, 0.24);
  b.add(Geo.cone(8), 0xe8303a, 0, -0.16, 0, 0.5, 0.38, 0.24, Math.PI, 0, 0);
  const g = new THREE.Group();
  g.add(b.mesh(true, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, emissive: 0x400808 })));
  g.add(glowSprite(0xff4a5a, 1.6, 0.5));
  return g;
}

export function makeCrystalPickup() {
  const m = new THREE.Mesh(Geo.oct(), new THREE.MeshPhongMaterial({ color: 0xb06aff, shininess: 120, specular: 0xffffff, emissive: 0x3a1a6a, transparent: true, opacity: 0.9 }));
  m.scale.set(0.4, 0.6, 0.4);
  const g = new THREE.Group();
  g.add(m);
  g.add(glowSprite(0xb06aff, 1.6, 0.6));
  return g;
}

export function makePlate() {
  const b = new Builder();
  b.add(Geo.box(), 0x3a3640, 0, 0.03, 0, 1.6, 0.06, 1.6);
  b.add(Geo.box(), 0x6a6474, 0, 0.1, 0, 1.3, 0.1, 1.3);
  const root = new THREE.Group();
  const top = b.mesh(false);
  root.add(top);
  const rune = new THREE.Mesh(G('plateRing', () => new THREE.RingGeometry(0.3, 0.45, 20).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: 0x4a4452, transparent: true }));
  rune.position.y = 0.16;
  root.add(rune);
  return { root, top, rune };
}

export function makeLever() {
  const b = new Builder();
  b.add(Geo.box(), 0x4a4452, 0, 0.2, 0, 0.8, 0.4, 0.6, 0, 0, 0, 0.6);
  b.add(Geo.box(), 0x2a2a2e, 0, 0.42, 0, 0.5, 0.06, 0.2);
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const hb = new Builder();
  hb.add(Geo.cyl(6), 0x6a6474, 0, 0.35, 0, 0.08, 0.7, 0.08);
  hb.add(Geo.sph(8, 6), 0xd8443a, 0, 0.72, 0, 0.2, 0.2, 0.2);
  const handle = new THREE.Group();
  handle.position.y = 0.44;
  handle.add(hb.mesh(true));
  root.add(handle);
  return { root, handle };
}

export function makeBrazier() {
  const b = new Builder();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(Geo.box(), 0x2a2a2e, Math.cos(a) * 0.25, 0.4, Math.sin(a) * 0.25, 0.07, 0.85, 0.07, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
  }
  b.add(Geo.cyl(10, 1.5), 0x3a3a3e, 0, 0.9, 0, 0.6, 0.26, 0.6);
  b.add(Geo.torus(0.12), 0xc9a45a, 0, 1.03, 0, 0.9, 0.9, 0.6, Math.PI / 2, 0, 0);
  b.add(Geo.dode(), 0x1a1a1a, 0, 1.0, 0, 0.5, 0.2, 0.5);
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const flame = new THREE.Group();
  const f1 = new THREE.Mesh(Geo.cone(7), matGlow(0x3ad8ff));
  f1.scale.set(0.45, 0.7, 0.45); f1.position.y = 0.3;
  const f2 = new THREE.Mesh(Geo.cone(7), matGlow(0xd8fbff));
  f2.scale.set(0.22, 0.4, 0.22); f2.position.y = 0.2;
  flame.add(f1, f2);
  flame.position.y = 1.05;
  root.add(flame);
  const glow = glowSprite(0x4ad8ff, 3, 0.6);
  glow.position.y = 1.5;
  root.add(glow);
  return { root, flame, glow };
}

export function makeRunePillar(idx, color) {
  const b = new Builder();
  b.add(Geo.box(), 0x3a3640, 0, 0.15, 0, 1.2, 0.3, 1.2, 0, 0, 0, 0.6);
  b.add(Geo.box(), 0x5a5462, 0, 1.1, 0, 0.8, 1.9, 0.8, 0, 0, 0, 0.35);
  b.add(Geo.pyr(), 0x4a4452, 0, 2.25, 0, 0.9, 0.4, 0.9);
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const mat = new THREE.MeshBasicMaterial({ map: runeTexture(idx), color: 0x4a4452, transparent: true, depthWrite: false });
  const faceGeo = G('runeFace', () => new THREE.PlaneGeometry(0.7, 0.7));
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(faceGeo, mat);
    const a = (k / 4) * Math.PI * 2;
    f.position.set(Math.sin(a) * 0.41, 1.3, Math.cos(a) * 0.41);
    f.rotation.y = a;
    root.add(f);
  }
  const glow = glowSprite(new THREE.Color(color).getHex(), 2.6, 0);
  glow.position.y = 1.4;
  root.add(glow);
  return { root, mat, glow };
}

export function makeTablet() {
  const b = new Builder();
  b.add(Geo.box(), 0x3a3640, 0, 0.1, 0, 1.2, 0.2, 0.7, 0, 0, 0, 0.6);
  b.add(Geo.box(), 0x6a6474, 0, 0.7, 0, 1.0, 1.1, 0.24, -0.15, 0, 0, 0.4);
  b.add(Geo.box(), 0xc9a45a, 0, 1.0, 0.1, 0.7, 0.05, 0.05, -0.15, 0, 0);
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const eye = new THREE.Mesh(Geo.sph(8, 6), matGlow(0x9fe8ff));
  eye.scale.set(0.24, 0.24, 0.06); eye.position.set(0, 0.72, 0.16);
  root.add(eye);
  return root;
}

export function makeMirror() {
  const b = new Builder();
  b.add(Geo.cyl(10), 0x3a3640, 0, 0.12, 0, 1.3, 0.24, 1.3, 0, 0, 0, 0.6);
  b.add(Geo.cyl(10), 0x5a5462, 0, 0.3, 0, 0.9, 0.14, 0.9);
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const mb = new Builder();
  mb.add(Geo.box(), 0xc9a45a, 0, 0.95, 0, 1.5, 1.2, 0.14);
  mb.add(Geo.cyl(6), 0x5a3a1e, 0, 0.4, 0, 0.1, 0.4, 0.1);
  const panel = new THREE.Group();
  panel.add(mb.mesh(true));
  const glass = new THREE.Mesh(G('mirrorGlass', () => new THREE.BoxGeometry(1.3, 1.0, 0.16)), new THREE.MeshPhongMaterial({ color: 0x9fd8ff, shininess: 200, specular: 0xffffff, emissive: 0x1a3a5a }));
  glass.position.y = 0.95;
  panel.add(glass);
  root.add(panel);
  return { root, panel };
}

export function makeEmitter() {
  const b = new Builder();
  b.add(Geo.box(), 0x3a3640, 0, 0.3, 0, 1.2, 0.6, 1.2, 0, 0, 0, 0.6);
  b.add(Geo.cyl(8), 0x5a5462, 0, 0.9, 0, 0.8, 0.6, 0.8);
  b.add(Geo.cyl(8, 0.6), 0xc9a45a, 0, 0.9, 0.5, 0.36, 0.6, 0.36, Math.PI / 2, 0, 0);
  const root = new THREE.Group();
  const aim = new THREE.Group();
  aim.add(b.mesh(true));
  const c = new THREE.Mesh(Geo.oct(), matGlow(0xff5a4a));
  c.scale.setScalar(0.3); c.position.set(0, 0.9, 0.8);
  aim.add(c);
  root.add(aim);
  const glow = glowSprite(0xff5a4a, 1.8, 0.8);
  glow.position.set(0, 0.9, 0.8);
  aim.add(glow);
  return { root, aim };
}

export function makeReceiver() {
  const b = new Builder();
  b.add(Geo.cyl(8), 0x3a3640, 0, 0.2, 0, 1.2, 0.4, 1.2, 0, 0, 0, 0.6);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; b.add(Geo.box(), 0xc9a45a, Math.cos(a) * 0.45, 0.7, Math.sin(a) * 0.45, 0.12, 0.8, 0.12, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); }
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const crystal = new THREE.Mesh(Geo.oct(), new THREE.MeshPhongMaterial({ color: 0x6a5a80, emissive: 0x1a1022, shininess: 120, transparent: true, opacity: 0.92 }));
  crystal.scale.set(0.5, 0.8, 0.5); crystal.position.y = 1.1;
  root.add(crystal);
  const glow = glowSprite(0xff6a5a, 3, 0);
  glow.position.y = 1.1;
  root.add(glow);
  return { root, crystal, glow };
}

export function makeBars(width = 2, height = 2.6, count = 6) {
  const b = new Builder();
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + (i + 0.5) * (width / count);
    b.add(Geo.cyl(6), 0x3a3a42, x, height / 2, 0, 0.1, height, 0.1);
    b.add(Geo.cone(6), 0x3a3a42, x, height + 0.1, 0, 0.14, 0.24, 0.14);
  }
  b.add(Geo.box(), 0x2a2a30, 0, height * 0.3, 0, width, 0.1, 0.12);
  b.add(Geo.box(), 0x2a2a30, 0, height * 0.75, 0, width, 0.1, 0.12);
  return b.mesh(true);
}

export function makeCage() {
  const g = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const bars = makeBars(1.9, 1.8, 5);
    const a = (k / 4) * Math.PI * 2;
    bars.position.set(Math.sin(a) * 0.95, 0, Math.cos(a) * 0.95);
    bars.rotation.y = a;
    g.add(bars);
  }
  const b = new Builder();
  b.add(Geo.box(), 0x2a2a30, 0, 1.95, 0, 2.0, 0.12, 2.0);
  g.add(b.mesh(true));
  return g;
}

export function makeSpikes() {
  const b = new Builder();
  b.add(Geo.box(), 0x3a3640, 0, 0.03, 0, 1.9, 0.06, 1.9);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) b.add(Geo.cyl(6), 0x141418, -0.66 + i * 0.44, 0.07, -0.66 + j * 0.44, 0.16, 0.02, 0.16);
  const root = new THREE.Group();
  root.add(b.mesh(false));
  const sb = new Builder();
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) sb.add(Geo.cone(5), 0xc8ccd4, -0.66 + i * 0.44, 0.3, -0.66 + j * 0.44, 0.14, 0.6, 0.14);
  const spikes = sb.mesh(true);
  spikes.position.y = -0.62;
  root.add(spikes);
  return { root, spikes };
}

export function makeFlameNozzle() {
  const b = new Builder();
  b.add(Geo.box(), 0x4a4452, 0, 0, -0.1, 0.8, 0.8, 0.2);
  b.add(Geo.sph(8, 6), 0x5a5462, 0, 0, 0.1, 0.6, 0.6, 0.5);
  b.add(Geo.cyl(8), 0x1a1a1a, 0, -0.05, 0.36, 0.24, 0.12, 0.24, Math.PI / 2, 0, 0);
  b.add(Geo.cone(4), 0x5a5462, -0.2, 0.28, 0.1, 0.12, 0.2, 0.12);
  b.add(Geo.cone(4), 0x5a5462, 0.2, 0.28, 0.1, 0.12, 0.2, 0.12);
  const root = new THREE.Group();
  root.add(b.mesh(false));
  const eye = new THREE.Mesh(Geo.sph(6, 4), matGlow(0xff5a1a));
  eye.scale.setScalar(0.08); eye.position.set(-0.12, 0.08, 0.34);
  const eye2 = eye.clone(); eye2.position.x = 0.12;
  root.add(eye, eye2);
  return root;
}

export function makePendulum(len = 2.4) {
  const root = new THREE.Group();
  const bb = new Builder();
  bb.add(Geo.box(), 0x2a2a30, 0, 0, 0, 2.2, 0.2, 0.3);
  root.add(bb.mesh(false));
  const arm = new THREE.Group();
  const ab = new Builder();
  ab.add(Geo.cyl(6), 0x3a3a42, 0, -len / 2, 0, 0.1, len, 0.1);
  ab.add(Geo.cyl(16, 1), 0xc8ccd4, 0, -len, 0, 1.3, 0.08, 1.3, 0, 0, Math.PI / 2);
  ab.add(Geo.box(), 0x3a3a42, 0, -len + 0.3, 0, 0.1, 0.5, 0.2);
  const m = ab.mesh(true);
  arm.add(m);
  root.add(arm);
  return { root, arm };
}

export function makeArrowShooter() {
  const b = new Builder();
  b.add(Geo.box(), 0x4a4452, 0, 0, 0, 0.7, 0.5, 0.2);
  for (let i = 0; i < 3; i++) b.add(Geo.cyl(6), 0x101010, -0.2 + i * 0.2, 0, 0.1, 0.1, 0.05, 0.1, Math.PI / 2, 0, 0);
  return b.mesh(false);
}

export function makeStairs() {
  const root = new THREE.Group();
  const b = new Builder();
  b.add(Geo.box(), 0x3a3640, 0, 0.1, -1.0, 2.2, 0.2, 0.2);
  b.add(Geo.box(), 0x3a3640, -1.0, 0.1, 0, 0.2, 0.2, 2.2);
  b.add(Geo.box(), 0x3a3640, 1.0, 0.1, 0, 0.2, 0.2, 2.2);
  for (let i = 0; i < 5; i++) b.add(Geo.box(), 0x4a4452 - i * 0x040404, 0, -0.2 - i * 0.35, -0.7 + i * 0.35, 1.8, 0.35, 0.7);
  root.add(b.mesh(false));
  const pit = new THREE.Mesh(G('stairPit', () => new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2)), matGlow(0x05060a));
  pit.position.y = -1.9;
  root.add(pit);
  const glow = glowSprite(0x4ab8ff, 3.5, 0.7);
  glow.position.set(0, 0.4, 0);
  root.add(glow);
  // 发光立柱
  for (const s of [-1, 1]) {
    const pb = new Builder();
    pb.add(Geo.box(), 0x3a3640, s * 1.2, 0.8, -1.1, 0.4, 1.6, 0.4, 0, 0, 0, 0.5);
    pb.add(Geo.pyr(), 0x4a4452, s * 1.2, 1.75, -1.1, 0.5, 0.3, 0.5);
    root.add(pb.mesh(true));
    const c = new THREE.Mesh(Geo.oct(), matGlow(0x7fd8ff));
    c.scale.set(0.2, 0.3, 0.2); c.position.set(s * 1.2, 2.15, -1.1);
    root.add(c);
    const g2 = glowSprite(0x4ab8ff, 1.6, 0.8);
    g2.position.copy(c.position);
    root.add(g2);
  }
  return { root, glow };
}

export function makeSeal() {
  const g = new THREE.Group();
  const bars = makeBars(2, 2.6, 5);
  g.add(bars);
  const plane = new THREE.Mesh(G('sealPlane', () => new THREE.PlaneGeometry(2, 2.6)), new THREE.MeshBasicMaterial({ color: 0x4ab8ff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  plane.position.y = 1.3;
  g.add(plane);
  const lockB = new Builder();
  lockB.add(Geo.box(), 0xc9a45a, 0, 1.3, 0.1, 0.6, 0.6, 0.12);
  lockB.add(Geo.torus(0.2), 0xc9a45a, 0, 1.65, 0.1, 0.34, 0.34, 0.3);
  g.add(lockB.mesh(true));
  const glow = glowSprite(0x4ab8ff, 3, 0.5);
  glow.position.set(0, 1.3, 0.2);
  g.add(glow);
  return { root: g, plane };
}

export function makeFountain() {
  const b = new Builder();
  b.add(Geo.cyl(14), 0x4a4452, 0, 0.3, 0, 2.2, 0.6, 2.2, 0, 0, 0, 0.6);
  b.add(Geo.cyl(14), 0x2a4a6a, 0, 0.55, 0, 1.9, 0.1, 1.9);
  b.add(Geo.cyl(10), 0x5a5462, 0, 1.0, 0, 0.4, 1.2, 0.4);
  b.add(Geo.cyl(10, 1.8), 0x5a5462, 0, 1.6, 0, 0.8, 0.2, 0.8);
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const water = new THREE.Mesh(G('water', () => new THREE.CircleGeometry(0.92, 20).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: 0x4ad8ff, transparent: true, opacity: 0.7 }));
  water.position.y = 0.62;
  root.add(water);
  const glow = glowSprite(0x4ad8ff, 3.5, 0.5);
  glow.position.y = 1.2;
  root.add(glow);
  return { root, water, glow };
}

export function makeAltar() {
  const b = new Builder();
  b.add(Geo.box(), 0x3a3640, 0, 0.2, 0, 1.8, 0.4, 1.2, 0, 0, 0, 0.6);
  b.add(Geo.box(), 0x5a5462, 0, 0.6, 0, 1.5, 0.4, 0.9);
  b.add(Geo.box(), 0x6a1a22, 0, 0.82, 0, 1.4, 0.04, 0.95);
  b.add(Geo.cyl(8), 0xe8e0cc, -0.5, 1.0, 0.2, 0.1, 0.3, 0.1);
  b.add(Geo.cyl(8), 0xe8e0cc, 0.5, 1.0, 0.2, 0.1, 0.3, 0.1);
  const root = new THREE.Group();
  root.add(b.mesh(true));
  const orb = new THREE.Mesh(Geo.sph(12, 10), new THREE.MeshPhongMaterial({ color: 0xb06aff, emissive: 0x5a2a9a, shininess: 100, transparent: true, opacity: 0.85 }));
  orb.scale.setScalar(0.5); orb.position.y = 1.2;
  root.add(orb);
  const glow = glowSprite(0xb06aff, 2.5, 0.6);
  glow.position.y = 1.2;
  root.add(glow);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(Geo.cone(5), matGlow(0xffb04a));
    f.scale.set(0.08, 0.16, 0.08); f.position.set(s * 0.5, 1.22, 0.2);
    root.add(f);
  }
  return { root, orb };
}

export function makeBones(seed) {
  const rng = makeRng(seed);
  const b = new Builder();
  for (let i = 0; i < 4; i++) b.add(Geo.cyl(5), 0xd8d0bc, rng.range(-0.5, 0.5), 0.05, rng.range(-0.5, 0.5), 0.07, rng.range(0.4, 0.7), 0.07, Math.PI / 2, rng() * 3, 0);
  if (rng() < 0.6) b.add(Geo.sph(8, 6), 0xd8d0bc, rng.range(-0.3, 0.3), 0.14, rng.range(-0.3, 0.3), 0.3, 0.26, 0.3);
  return b.mesh(false);
}

export function makeDoorFrame() {
  const b = new Builder();
  b.add(Geo.box(), 0x4a4452, -1.05, 1.35, 0, 0.35, 2.7, 0.6, 0, 0, 0, 0.35);
  b.add(Geo.box(), 0x4a4452, 1.05, 1.35, 0, 0.35, 2.7, 0.6, 0, 0, 0, 0.35);
  b.add(Geo.box(), 0x3e3846, 0, 2.62, 0, 2.5, 0.35, 0.66);
  b.add(Geo.box(), 0xc9a45a, 0, 2.62, 0.34, 0.3, 0.26, 0.04);
  return b.mesh(true);
}

export function makeRubble(seed) {
  const rng = makeRng(seed);
  const b = new Builder();
  for (let i = 0; i < 5; i++) {
    const s = rng.range(0.15, 0.4);
    b.add(Geo.dode(), rng.pick([0x5a5460, 0x4a4452, 0x6a6474]), rng.range(-0.6, 0.6), s * 0.4, rng.range(-0.6, 0.6), s, s * 0.7, s, rng() * 3, rng() * 3, 0);
  }
  return b.mesh(false);
}

export function makeFireball() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(Geo.sph(10, 8), matGlow(0xffe06a));
  core.scale.setScalar(0.35);
  const shell = new THREE.Mesh(Geo.sph(10, 8), matGlow(0xff6a1a, 0.6));
  shell.scale.setScalar(0.6);
  g.add(core, shell, glowSprite(0xff7a2a, 3, 0.9));
  return g;
}

export function makeArrow() {
  const b = new Builder();
  b.add(Geo.cyl(4), 0x6a4a2a, 0, 0, 0, 0.05, 0.9, 0.05, Math.PI / 2, 0, 0);
  b.add(Geo.cone(4), 0x9aa0a8, 0, 0, 0.5, 0.1, 0.18, 0.1, Math.PI / 2, 0, 0);
  b.add(Geo.box(), 0xe8e0d0, 0, 0, -0.42, 0.14, 0.02, 0.16);
  return b.mesh(false, matChar());
}

// ================================================================ 主题装饰
export function makeMushrooms(seed, color = 0x4affc0) {
  const rng = makeRng(seed);
  const g = new THREE.Group();
  const b = new Builder();
  const n = rng.int(3, 5);
  const caps = [];
  for (let k = 0; k < n; k++) {
    const x = rng.range(-0.6, 0.6), z = rng.range(-0.6, 0.6), h = rng.range(0.3, 0.9), r = rng.range(0.25, 0.5);
    b.add(Geo.cyl(6, 0.8), 0xe8e0c8, x, h / 2, z, 0.12 + r * 0.2, h, 0.12 + r * 0.2);
    b.add(Geo.hemi(), k % 2 ? 0x2a8a7a : 0x3a6aa8, x, h - 0.02, z, r * 2, r * 1.2, r * 2);
    caps.push([x, h, z, r]);
  }
  g.add(b.mesh(true));
  for (const [x, h, z, r] of caps) for (let s = 0; s < 3; s++) {
    const d = new THREE.Mesh(Geo.sph(6, 4), matGlow(color));
    const a = rng() * Math.PI * 2;
    d.scale.setScalar(0.07);
    d.position.set(x + Math.cos(a) * r * 0.5, h + r * 0.35, z + Math.sin(a) * r * 0.5);
    g.add(d);
  }
  const gl = glowSprite(color, 2.4, 0.45);
  gl.position.y = 0.7;
  g.add(gl);
  return g;
}
export function makeCrystals(seed, color = 0x7fd8ff) {
  const rng = makeRng(seed);
  const g = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.35, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.85, flatShading: true });
  const n = rng.int(3, 6);
  for (let k = 0; k < n; k++) {
    const m = new THREE.Mesh(Geo.oct(), mat);
    const h = rng.range(0.6, 1.6);
    m.scale.set(h * 0.35, h, h * 0.35);
    m.position.set(rng.range(-0.5, 0.5), h * 0.45, rng.range(-0.5, 0.5));
    m.rotation.set(rng.range(-0.4, 0.4), rng() * 3, rng.range(-0.4, 0.4));
    m.castShadow = true;
    g.add(m);
  }
  const gl = glowSprite(color, 3, 0.55);
  gl.position.y = 0.8;
  g.add(gl);
  return g;
}
export function makeStalagmite(seed, color = 0x8a96a8) {
  const rng = makeRng(seed);
  const b = new Builder();
  const n = rng.int(1, 3);
  for (let k = 0; k < n; k++) { const h = rng.range(0.8, 2.0); b.add(Geo.cone(7), k ? color : 0xb8c8d8, rng.range(-0.4, 0.4), h / 2, rng.range(-0.4, 0.4), h * 0.4, h, h * 0.4, 0, rng() * 3, 0, 0.35); }
  return b.mesh(true);
}
export function makeSnowPile(seed) {
  const rng = makeRng(seed);
  const b = new Builder();
  for (let k = 0; k < 4; k++) b.add(Geo.sph(8, 6), 0xf2f8ff, rng.range(-0.5, 0.5), 0.05, rng.range(-0.5, 0.5), rng.range(0.6, 1.1), rng.range(0.25, 0.45), rng.range(0.6, 1.1));
  return b.mesh(false);
}
export function makeObsidian(seed) {
  const rng = makeRng(seed);
  const g = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: 0x141018, shininess: 150, specular: 0xff8a5a, flatShading: true });
  for (let k = 0; k < rng.int(2, 4); k++) {
    const m = new THREE.Mesh(Geo.cone(5), mat);
    const h = rng.range(0.7, 1.8);
    m.scale.set(h * 0.4, h, h * 0.4);
    m.position.set(rng.range(-0.5, 0.5), h / 2, rng.range(-0.5, 0.5));
    m.rotation.set(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3));
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
export function makePool(kind, w = 1.9, d = 1.9) {
  const g = new THREE.Group();
  const cols = { lava: [0xff6a10, 0x3a1a10], poison: [0x6aff4a, 0x1a3a14], ice: [0xbfe8ff, 0x6a8aa8] };
  const [c1, c2] = cols[kind];
  const rim = new THREE.Mesh(G('poolRim', () => new THREE.CylinderGeometry(0.5, 0.52, 0.08, 20)), new THREE.MeshLambertMaterial({ color: c2 }));
  rim.scale.set(w, 1, d); rim.position.y = 0.03;
  g.add(rim);
  let surf;
  if (kind === 'ice') surf = new THREE.MeshPhongMaterial({ color: c1, shininess: 200, specular: 0xffffff, transparent: true, opacity: 0.75, emissive: 0x2a4a6a });
  else surf = new THREE.MeshBasicMaterial({ color: c1, transparent: kind === 'poison', opacity: 0.8 });
  const s = new THREE.Mesh(G('poolSurf', () => new THREE.CircleGeometry(0.46, 20).rotateX(-Math.PI / 2)), surf);
  s.scale.set(w, 1, d); s.position.y = 0.075;
  g.add(s);
  if (kind !== 'ice') { const gl = glowSprite(c1, Math.max(w, d) * 1.6, kind === 'lava' ? 0.6 : 0.35); gl.position.y = 0.4; g.add(gl); }
  return { root: g, surf: s };
}
export function makeCobweb(size = 1.6) {
  const m = new THREE.Mesh(G('webPlane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: webTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.scale.set(size, size, 1);
  return m;
}
export function makeVines(seed, h = 2.2) {
  const rng = makeRng(seed);
  const b = new Builder();
  for (let k = 0; k < 4; k++) {
    const x = rng.range(-0.8, 0.8), l = rng.range(0.8, h);
    for (let s = 0; s < l / 0.2; s++) b.add(Geo.sph(5, 4), s % 3 ? 0x3a8a3a : 0x5aaa4a, x + Math.sin(s * 0.8 + k) * 0.06, h - s * 0.2, 0.05, 0.14, 0.2, 0.08);
    if (rng() < 0.6) b.add(Geo.sph(5, 4), 0xff7aa0, x, h - l, 0.08, 0.1, 0.1, 0.06);
  }
  return b.mesh(false);
}
export function makeChains(len = 1.8) {
  const b = new Builder();
  for (let k = 0; k < len / 0.18; k++) b.add(Geo.torus(0.25), 0x4a4a52, 0, -k * 0.18, 0, 0.14, 0.2, 0.14, 0, k % 2 ? Math.PI / 2 : 0, 0);
  b.add(Geo.cone(4), 0x5a5a62, 0, -len - 0.1, 0, 0.14, 0.24, 0.14, Math.PI, 0, 0);
  return b.mesh(true);
}
export function makeCoffin(seed) {
  const b = new Builder();
  b.add(Geo.box(), 0x4a3020, 0, 0.3, 0, 0.9, 0.6, 1.8, 0, 0, 0, 0.8);
  b.add(Geo.box(), 0x5a3a28, 0, 0.64, 0, 0.84, 0.08, 1.74);
  b.add(Geo.box(), 0xc9a45a, 0, 0.7, 0.2, 0.08, 0.02, 0.6);
  b.add(Geo.box(), 0xc9a45a, 0, 0.7, 0.3, 0.3, 0.02, 0.08);
  const m = b.mesh(true);
  m.rotation.y = (seed % 4) * 0.2 - 0.3;
  return m;
}
export function makeBookshelf(seed) {
  const rng = makeRng(seed);
  const b = new Builder();
  b.add(Geo.box(), 0x4a2e1a, 0, 1.1, 0, 1.8, 2.2, 0.5, 0, 0, 0, 0.35);
  const cols = [0x8a2a2a, 0x2a4a8a, 0x3a6a2a, 0x8a6a2a, 0x5a2a6a, 0x6a4a3a];
  for (let r = 0; r < 4; r++) {
    b.add(Geo.box(), 0x3a2212, 0, 0.2 + r * 0.52, 0.02, 1.7, 0.05, 0.46);
    let x = -0.78;
    while (x < 0.75) { const w = rng.range(0.07, 0.14), h = rng.range(0.32, 0.44); b.add(Geo.box(), rng.pick(cols), x + w / 2, 0.23 + r * 0.52 + h / 2, 0.08, w, h, 0.32, 0, 0, rng() < 0.1 ? 0.3 : 0); x += w + 0.01; }
  }
  return b.mesh(true);
}
export function makeCandleTable(seed) {
  const rng = makeRng(seed);
  const g = new THREE.Group();
  const b = new Builder();
  b.add(Geo.box(), 0x5a3a20, 0, 0.72, 0, 1.4, 0.08, 0.9);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(Geo.box(), 0x4a2e18, sx * 0.6, 0.36, sz * 0.36, 0.08, 0.72, 0.08);
  b.add(Geo.box(), 0xe8dcb0, -0.3, 0.78, 0.1, 0.4, 0.02, 0.3, 0, 0.3, 0);
  b.add(Geo.cyl(8), 0x8a6a4a, 0.3, 0.84, -0.1, 0.16, 0.16, 0.16);
  const cand = [];
  for (let k = 0; k < rng.int(2, 3); k++) { const x = rng.range(-0.5, 0.5), z = rng.range(-0.3, 0.3), h = rng.range(0.15, 0.3); b.add(Geo.cyl(6), 0xf0e8d0, x, 0.76 + h / 2, z, 0.08, h, 0.08); cand.push([x, 0.8 + h, z]); }
  g.add(b.mesh(true));
  for (const [x, y, z] of cand) { const f = new THREE.Mesh(Geo.cone(5), matGlow(0xffc04a)); f.scale.set(0.05, 0.12, 0.05); f.position.set(x, y + 0.04, z); g.add(f); }
  const gl = glowSprite(0xffb04a, 1.6, 0.6); gl.position.y = 1.0; g.add(gl);
  return g;
}
export function makeBearStatue(color = 0x8a8496) {
  const b = new Builder();
  b.add(Geo.box(), 0x4a4452, 0, 0.3, 0, 1.3, 0.6, 1.3, 0, 0, 0, 0.5);
  b.add(Geo.box(), 0x5a5462, 0, 0.66, 0, 1.1, 0.12, 1.1);
  b.add(Geo.sph(10, 8), color, 0, 1.3, 0, 0.8, 0.9, 0.7);
  b.add(Geo.sph(10, 8), color, 0, 2.0, 0.05, 0.7, 0.62, 0.62);
  b.add(Geo.sph(8, 6), color, -0.26, 2.28, 0, 0.24, 0.24, 0.16);
  b.add(Geo.sph(8, 6), color, 0.26, 2.28, 0, 0.24, 0.24, 0.16);
  b.add(Geo.sph(8, 6), color, 0, 1.92, 0.3, 0.34, 0.26, 0.26);
  b.add(Geo.sph(8, 6), color, -0.44, 1.4, 0.15, 0.26, 0.5, 0.26, 0.4, 0, 0.3);
  b.add(Geo.sph(8, 6), color, 0.44, 1.4, 0.15, 0.26, 0.5, 0.26, 0.4, 0, -0.3);
  b.add(Geo.box(), color, 0.44, 1.2, 0.5, 0.08, 1.2, 0.08, 0.5, 0, 0);
  return b.mesh(true);
}
export function makeHangingCage(seed) {
  const g = new THREE.Group();
  const b = new Builder();
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.add(Geo.cyl(4), 0x3a3a42, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, 0.05, 1.1, 0.05); }
  b.add(Geo.torus(0.1), 0x3a3a42, 0, 0.55, 0, 0.84, 0.84, 0.6, Math.PI / 2, 0, 0);
  b.add(Geo.torus(0.1), 0x3a3a42, 0, -0.55, 0, 0.84, 0.84, 0.6, Math.PI / 2, 0, 0);
  b.add(Geo.cyl(4), 0x3a3a42, 0, 1.1, 0, 0.05, 1.0, 0.05);
  if (seed % 2) b.add(Geo.sph(8, 6), 0xe8e0cc, 0, -0.38, 0, 0.3, 0.26, 0.3);
  g.add(b.mesh(true));
  return g;
}
export function makeSkullPile(seed) {
  const rng = makeRng(seed);
  const b = new Builder();
  for (let k = 0; k < 6; k++) {
    const x = rng.range(-0.4, 0.4), z = rng.range(-0.4, 0.4), y = k > 3 ? 0.3 : 0.12;
    b.add(Geo.sph(8, 6), 0xe0d8c4, x, y, z, 0.3, 0.27, 0.3);
    b.add(Geo.sph(5, 4), 0x201818, x - 0.06, y + 0.02, z + 0.13, 0.08, 0.08, 0.04);
    b.add(Geo.sph(5, 4), 0x201818, x + 0.06, y + 0.02, z + 0.13, 0.08, 0.08, 0.04);
  }
  return b.mesh(true);
}
export function makeRoots(seed) {
  const rng = makeRng(seed);
  const b = new Builder();
  for (let k = 0; k < 5; k++) { const a = rng() * Math.PI * 2; b.add(Geo.cyl(5, 0.4), 0x5a3a20, Math.cos(a) * 0.4, 0.06, Math.sin(a) * 0.4, 0.14, 1.2, 0.14, Math.PI / 2 - 0.1, a + Math.PI / 2, 0); }
  return b.mesh(false);
}
export function makeLavaBrazier() {
  const b = new Builder();
  b.add(Geo.cyl(8, 1.3), 0x241612, 0, 0.4, 0, 0.9, 0.8, 0.9, 0, 0, 0, 0.5);
  b.add(Geo.torus(0.12), 0x3a2418, 0, 0.8, 0, 1.2, 1.2, 0.8, Math.PI / 2, 0, 0);
  const g = new THREE.Group();
  g.add(b.mesh(true));
  const lava = new THREE.Mesh(Geo.sph(10, 6), matGlow(0xff6a10));
  lava.scale.set(1.05, 0.2, 1.05); lava.position.y = 0.82;
  g.add(lava);
  const gl = glowSprite(0xff6a10, 2.6, 0.6); gl.position.y = 1.2; g.add(gl);
  return g;
}
export function makeStall() {
  const g = new THREE.Group();
  const b = new Builder();
  b.add(Geo.box(), 0x6a4424, 0, 0.5, 0, 2.4, 0.1, 1.0);
  b.add(Geo.box(), 0x5a3a1e, 0, 0.25, 0.45, 2.4, 0.5, 0.08);
  for (const sx of [-1, 1]) b.add(Geo.box(), 0x4a2e18, sx * 1.1, 1.2, -0.4, 0.1, 2.4, 0.1);
  for (let k = 0; k < 6; k++) b.add(Geo.box(), k % 2 ? 0xd8443a : 0xf0e8d0, -1.0 + k * 0.4, 2.35, 0, 0.4, 0.06, 1.2, 0.25, 0, 0);
  b.add(Geo.cyl(8), 0xe8303a, -0.7, 0.65, 0.1, 0.18, 0.26, 0.18);
  b.add(Geo.cyl(8), 0x4a8ae8, -0.35, 0.65, 0.1, 0.18, 0.26, 0.18);
  b.add(Geo.box(), 0xc9a45a, 0.5, 0.62, 0.1, 0.4, 0.14, 0.3);
  b.add(Geo.oct(), 0xb06aff, 0.1, 0.7, 0.1, 0.16, 0.24, 0.16);
  g.add(b.mesh(true));
  return g;
}
export function makeCrackedWall() {
  const m = new THREE.Mesh(G('crackBox', () => new THREE.BoxGeometry(2, 2.6, 2)), new THREE.MeshLambertMaterial({ map: null, color: 0x8a8494 }));
  return m;
}
export function makeStatueDial(color = 0x8a8496) {
  const g = new THREE.Group();
  const bb = new Builder();
  bb.add(Geo.cyl(10), 0x3a3640, 0, 0.15, 0, 1.3, 0.3, 1.3, 0, 0, 0, 0.6);
  g.add(bb.mesh(true));
  const top = new THREE.Group();
  const tb = new Builder();
  tb.add(Geo.sph(10, 8), color, 0, 0.8, 0, 0.7, 0.8, 0.6);
  tb.add(Geo.sph(10, 8), color, 0, 1.42, 0.02, 0.6, 0.54, 0.54);
  tb.add(Geo.sph(8, 6), color, -0.22, 1.66, 0, 0.2, 0.2, 0.14);
  tb.add(Geo.sph(8, 6), color, 0.22, 1.66, 0, 0.2, 0.2, 0.14);
  tb.add(Geo.sph(8, 6), color, 0, 1.36, 0.26, 0.3, 0.22, 0.24);
  tb.add(Geo.cone(4), 0xc9a45a, 0, 0.9, 0.42, 0.14, 0.3, 0.1, Math.PI / 2, 0, 0);
  top.add(tb.mesh(true));
  const eye = new THREE.Mesh(Geo.sph(6, 4), new THREE.MeshBasicMaterial({ color: 0x4affc0, fog: false }));
  eye.scale.set(0.3, 0.06, 0.04); eye.position.set(0, 1.48, 0.29);
  top.add(eye);
  top.position.y = 0.3;
  g.add(top);
  return { root: g, top, eye };
}
export function makeMemoryTile() {
  const g = new THREE.Group();
  const b = new Builder();
  b.add(Geo.box(), 0x3a3640, 0, 0.04, 0, 1.84, 0.08, 1.84);
  b.add(Geo.box(), 0x5a5462, 0, 0.1, 0, 1.6, 0.06, 1.6);
  g.add(b.mesh(false));
  const rune = new THREE.Mesh(G('memRune', () => new THREE.RingGeometry(0.28, 0.5, 4, 1).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: 0x2a2632, fog: false }));
  rune.position.y = 0.14;
  g.add(rune);
  return { root: g, rune };
}

// ================================================================ 新敌人
export function makeMushroomMan() {
  const b = new Builder();
  b.add(Geo.sph(8, 6), 0xe8dcc0, -0.14, 0.12, 0, 0.2, 0.24, 0.24);
  b.add(Geo.sph(8, 6), 0xe8dcc0, 0.14, 0.12, 0, 0.2, 0.24, 0.24);
  b.add(Geo.cyl(10, 0.85), 0xf0e6cc, 0, 0.5, 0, 0.56, 0.7, 0.5);
  b.add(Geo.sph(6, 5), 0x101010, -0.1, 0.62, 0.24, 0.08, 0.12, 0.05);
  b.add(Geo.sph(6, 5), 0x101010, 0.1, 0.62, 0.24, 0.08, 0.12, 0.05);
  b.add(Geo.box(), 0x6a2020, 0, 0.46, 0.25, 0.14, 0.03, 0.02);
  b.add(Geo.sph(6, 5), 0xf0e6cc, -0.32, 0.5, 0.04, 0.16, 0.3, 0.16, 0, 0, 0.5);
  b.add(Geo.sph(6, 5), 0xf0e6cc, 0.32, 0.5, 0.04, 0.16, 0.3, 0.16, 0, 0, -0.5);
  b.add(Geo.hemi(), 0xc8302a, 0, 0.8, 0, 1.2, 0.8, 1.2);
  b.add(Geo.cyl(12), 0xa82020, 0, 0.8, 0, 1.2, 0.04, 1.2);
  const rng = makeRng(5);
  for (let k = 0; k < 7; k++) { const a = rng() * Math.PI * 2, r = rng.range(0.1, 0.45); b.add(Geo.sph(6, 4), 0xfff4e0, Math.cos(a) * r, 0.8 + Math.sqrt(Math.max(0, 0.36 - r * r)) * 0.55, Math.sin(a) * r, 0.14, 0.06, 0.14); }
  const body = partMesh(b);
  const r = rig([body]);
  r.cap = body; r.height = 1.3;
  addOutlines(r.root);
  return r;
}
export function makeWraith() {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: 0x8aa0c8, emissive: 0x2a3a5a, transparent: true, opacity: 0.72, shininess: 30, side: THREE.DoubleSide, depthWrite: false });
  const robe = new THREE.Mesh(G('wraithRobe', () => { const c = new THREE.ConeGeometry(0.55, 1.5, 10, 3, true); const p = c.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.7) p.setY(i, p.getY(i) + Math.sin(i * 2.3) * 0.12); c.computeVertexNormals(); return c; }), mat);
  robe.position.y = 0.95;
  const hood = new THREE.Mesh(Geo.sph(10, 8), mat);
  hood.scale.set(0.6, 0.62, 0.6); hood.position.y = 1.65;
  const face = new THREE.Mesh(Geo.sph(8, 6), matGlow(0x0a0a14));
  face.scale.set(0.4, 0.36, 0.2); face.position.set(0, 1.62, 0.2);
  const e1 = new THREE.Mesh(Geo.sph(6, 4), matGlow(0x9fe8ff));
  e1.scale.set(0.08, 0.05, 0.04); e1.position.set(-0.09, 1.66, 0.29);
  const e2 = e1.clone(); e2.position.x = 0.09;
  const arms = new THREE.Mesh(Geo.box(), mat);
  arms.scale.set(1.3, 0.12, 0.2); arms.position.set(0, 1.25, 0.2);
  g.add(robe, hood, face, e1, e2, arms);
  const gl = glowSprite(0x6a9aff, 2.2, 0.35); gl.position.y = 1.3; g.add(gl);
  const r = rig([g]);
  r.body = g; r.mat = mat; r.height = 1.9;
  return r;
}
export function makeIceMage() {
  const b = new Builder();
  b.add(Geo.cyl(10, 0.5), 0x3a6aa8, 0, 0.55, 0, 0.8, 1.1, 0.7);
  b.add(Geo.cyl(10), 0xbfe8ff, 0, 0.04, 0, 0.82, 0.06, 0.72);
  b.add(Geo.sph(10, 8), 0xe8e0cc, 0, 1.25, 0, 0.44, 0.4, 0.42);
  b.add(Geo.sph(6, 5), 0x141010, -0.09, 1.26, 0.17, 0.11, 0.12, 0.06);
  b.add(Geo.sph(6, 5), 0x141010, 0.09, 1.26, 0.17, 0.11, 0.12, 0.06);
  b.add(Geo.cone(10), 0x2a5a98, 0, 1.5, -0.04, 0.6, 0.7, 0.6, -0.2, 0, 0);
  const body = partMesh(b);
  const e1 = new THREE.Mesh(Geo.sph(6, 4), matGlow(0x9fe8ff)); e1.scale.setScalar(0.05); e1.position.set(-0.09, 1.26, 0.21);
  const e2 = e1.clone(); e2.position.x = 0.09;
  const wb = new Builder();
  wb.add(Geo.cyl(6), 0x6a4a2a, 0, 0.2, 0, 0.06, 1.4, 0.06);
  const staff = partMesh(wb);
  const cr = new THREE.Mesh(Geo.oct(), matGlow(0x9fe8ff)); cr.scale.set(0.16, 0.26, 0.16); cr.position.y = 1.0; staff.add(cr);
  const gl = glowSprite(0x7fd8ff, 1.3, 0.8); gl.position.y = 1.0; staff.add(gl);
  const arm = new THREE.Group(); arm.position.set(0.34, 0.7, 0.1); arm.add(staff);
  const r = rig([body, e1, e2, arm]);
  r.arm = arm; r.height = 1.8;
  addOutlines(r.root);
  return r;
}
export function makeFireImp() {
  const b = new Builder();
  b.add(Geo.sph(10, 8), 0xc8301a, 0, 0, 0, 0.6, 0.62, 0.56);
  b.add(Geo.sph(8, 6), 0xff8a3a, 0, -0.06, 0.2, 0.34, 0.3, 0.2);
  for (const s of [-1, 1]) {
    b.add(Geo.cone(5), 0x2a1410, s * 0.18, 0.34, 0, 0.1, 0.3, 0.1, 0, 0, s * -0.4);
    b.add(Geo.sph(6, 4), 0xffe03a, s * 0.12, 0.08, 0.25, 0.1, 0.08, 0.05);
  }
  b.add(Geo.cone(5), 0xc8301a, 0, -0.2, -0.36, 0.1, 0.6, 0.1, -2.2, 0, 0);
  const body = partMesh(b);
  const wing = (s) => { const wb = new Builder(); wb.add(Geo.box(), 0x5a1a10, s * 0.35, 0, -0.1, 0.6, 0.03, 0.36); wb.add(Geo.box(), 0x3a0a08, s * 0.62, 0, -0.18, 0.08, 0.05, 0.44); return partMesh(wb, s * 0.15, 0.1, 0); };
  const wl = wing(-1), wr = wing(1);
  const tail = new THREE.Mesh(Geo.cone(6), matGlow(0xffa030)); tail.scale.set(0.14, 0.24, 0.14); tail.position.set(0, -0.42, -0.62); tail.rotation.x = -2;
  const gl = glowSprite(0xff6a1a, 1.8, 0.5);
  const r = rig([body, wl, wr, tail, gl]);
  r.wl = wl; r.wr = wr; r.height = 0.8;
  r.pivot.position.y = 1.4;
  addOutlines(r.root);
  return r;
}
export function makeLich() {
  const b = new Builder();
  b.add(Geo.cone(12), 0x3a1a4a, 0, 1.0, 0, 1.3, 2.0, 1.2, 0, 0, 0, 0.2);
  b.add(Geo.cyl(12), 0xc9a45a, 0, 0.25, 0, 1.0, 0.06, 0.95);
  b.add(Geo.sph(10, 8), 0x4a2a5a, 0, 1.9, 0, 1.1, 0.5, 0.8);
  b.add(Geo.sph(12, 10), 0xe8e0cc, 0, 2.35, 0.02, 0.62, 0.58, 0.6);
  b.add(Geo.box(), 0xe8e0cc, 0, 2.12, 0.14, 0.36, 0.14, 0.3);
  b.add(Geo.sph(6, 5), 0x141010, -0.12, 2.36, 0.25, 0.16, 0.16, 0.06);
  b.add(Geo.sph(6, 5), 0x141010, 0.12, 2.36, 0.25, 0.16, 0.16, 0.06);
  b.add(Geo.cyl(10), 0xffcf4a, 0, 2.66, 0, 0.56, 0.14, 0.56);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.add(Geo.cone(4), 0xffcf4a, Math.sin(a) * 0.24, 2.82, Math.cos(a) * 0.24, 0.08, 0.2, 0.08); }
  for (const s of [-1, 1]) b.add(Geo.sph(8, 6), 0x3a1a4a, s * 0.6, 1.8, 0, 0.4, 0.5, 0.4);
  const body = partMesh(b);
  const e1 = new THREE.Mesh(Geo.sph(6, 4), matGlow(0x6aff9a)); e1.scale.setScalar(0.08); e1.position.set(-0.12, 2.36, 0.3);
  const e2 = e1.clone(); e2.position.x = 0.12;
  const wb = new Builder();
  wb.add(Geo.cyl(6), 0x2a2030, 0, 0.4, 0, 0.08, 2.4, 0.08);
  wb.add(Geo.torus(0.12), 0xe8e0cc, 0, 1.7, 0, 0.4, 0.4, 0.3);
  const staff = partMesh(wb);
  const orb = new THREE.Mesh(Geo.sph(10, 8), matGlow(0x6aff9a)); orb.scale.setScalar(0.28); orb.position.y = 1.7; staff.add(orb);
  const gl = glowSprite(0x4aff8a, 2.4, 0.8); gl.position.y = 1.7; staff.add(gl);
  const arm = new THREE.Group(); arm.position.set(0.7, 1.5, 0.2); arm.add(staff);
  const aura = glowSprite(0x6a2aff, 4.5, 0.35); aura.position.y = 1.4;
  const r = rig([body, e1, e2, arm, aura]);
  r.arm = arm; r.orb = orb; r.height = 3.0;
  addOutlines(r.root);
  return r;
}

// ---------------------------------------------------------------- 立体地形道具
// 木梯：局部坐标 z 轴朝外（贴在高台侧面），高 h
export function makeLadder(h) {
  const b = new Builder();
  const wood = 0x8a5a30, dark = 0x5a3a1c;
  for (const x of [-0.42, 0.42]) b.add(Geo.box(), wood, x, h / 2 + 0.1, 0.12, 0.12, h + 0.35, 0.12, 0, 0, 0, 0.3);
  const n = Math.max(3, Math.round(h / 0.38));
  for (let k = 0; k < n; k++) b.add(Geo.cyl(6), dark, 0, 0.3 + k * (h - 0.1) / n, 0.14, 0.07, 0.84, 0.07, 0, 0, Math.PI / 2);
  // 顶部挂钩
  for (const x of [-0.42, 0.42]) b.add(Geo.box(), 0x6a6a72, x, h + 0.02, -0.05, 0.14, 0.06, 0.3);
  return b.mesh(true);
}
// 弹跳机关：石座 + 发光蘑菇垫 / 符文弹簧
export function makeBouncePad(color = 0x4affc0) {
  const g = new THREE.Group();
  const b = new Builder();
  b.add(Geo.cyl(12), 0x4a4652, 0, 0.1, 0, 1.5, 0.2, 1.5, 0, 0, 0, 0.5);
  b.add(Geo.torus(0.12), 0x6a6474, 0, 0.2, 0, 1.4, 1.4, 1.4, Math.PI / 2, 0, 0);
  g.add(b.mesh(true));
  const cap = new Builder();
  cap.add(Geo.hemi(), color, 0, 0, 0, 1.25, 0.5, 1.25);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; cap.add(Geo.sph(6, 4), 0xffffff, Math.cos(a) * 0.35, 0.18, Math.sin(a) * 0.35, 0.16, 0.08, 0.16); }
  const capMesh = cap.mesh(true, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: color, emissiveIntensity: 0.3 }));
  capMesh.position.y = 0.22;
  g.add(capMesh);
  const glow = glowSprite(color, 2.2, 0.35);
  glow.position.y = 0.4;
  g.add(glow);
  return { root: g, cap: capMesh, glow };
}
// 回廊栏杆一段（沿 x 轴，长 T）
export function makeRailing(len = 2, withPost = true) {
  const b = new Builder();
  const c = 0x5a5462;
  if (withPost) b.add(Geo.box(), c, -len / 2 + 0.1, 0.45, 0, 0.18, 0.9, 0.18, 0, 0, 0, 0.4);
  b.add(Geo.box(), 0x6a6474, 0, 0.88, 0, len, 0.1, 0.14);
  for (let k = 1; k < 4; k++) b.add(Geo.cyl(6), c, -len / 2 + k * len / 4, 0.45, 0, 0.07, 0.8, 0.07);
  return b.mesh(true);
}

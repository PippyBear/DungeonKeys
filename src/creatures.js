// 敌人 / 怪物：与熊熊英雄同一套有机建模（SDF 平滑融合 + Marching Cubes + 烘焙 AO）与动画电影材质。
// 为了性能，每个部位是一块独立的刚体网格挂在关节上（不做逐顶点蒙皮），几何体按种类缓存、所有实例共享。
import * as THREE from 'three';
import { unionField, buildSurface, sdPrim } from './bearmesh.js';
import { charMat, charMatOwn, eyeMat, rigidMat } from './charmat.js';
import { Builder, Geo, matGlow, glowSprite } from './models.js';

// ---------------------------------------------------------------- 工具
const ell = (c, r, col, k = 0.06) => ({ t: 'ell', c, r, col, k, bone: 0 });
const cone = (a, b, r1, r2, col, k = 0.05) => ({ t: 'cone', a, b, r1, r2, col, k, bone: 0 });
const box = (c, b, rr, col, k = 0.04) => ({ t: 'box', c, b, rr, col, k, bone: 0 });
const fn = (f, col, bb, k = 0.04) => ({ t: 'fn', f, col, k, bone: 0, bb });
const sub = (p) => Object.assign(p, { sub: true });

function bounds(prims, pad) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  const grow = (c, r) => { for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], c[i] - r[i]); mx[i] = Math.max(mx[i], c[i] + r[i]); } };
  for (const p of prims) {
    if (p.sub) continue;
    if (p.t === 'ell') grow(p.c, p.r);
    else if (p.t === 'box') grow(p.c, [p.b[0] + p.rr, p.b[1] + p.rr, p.b[2] + p.rr]);
    else if (p.t === 'fn') { grow(p.bb[0], [0, 0, 0]); grow(p.bb[1], [0, 0, 0]); }
    else { const r = Math.max(p.r1, p.r2); grow(p.a, [r, r, r]); grow(p.b, [r, r, r]); }
  }
  return [mn.map((v) => v - pad), mx.map((v) => v + pad)];
}
const GC = new Map();
// 画质决定怪物网格精度
let RES_K = 1;
export function setCreatureQuality(q) { RES_K = q === 'low' ? 0.7 : q === 'mid' ? 0.85 : 1; }
function sdfGeo(key, prims, o = {}) {
  key += '@' + RES_K;
  if (GC.has(key)) return GC.get(key);
  const [bmin, bmax] = bounds(prims, o.pad || 0.05);
  const size = Math.max(bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]);
  const cell = Math.max(0.016, size / ((o.res || 36) * RES_K));
  let field = unionField(prims);
  if (o.rough) { const f0 = field, a = o.rough; field = (x, y, z) => f0(x, y, z) + a * Math.sin(x * 23 + y * 7) * Math.sin(y * 19 + z * 11) * Math.sin(z * 17 + x * 13); }
  const t = buildSurface({ field, bmin, bmax, cell, weightPrims: prims, paints: o.paints, boneCount: 1, color: o.color, noise: o.noise === undefined ? 0.03 : o.noise });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(t.nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
  g.setAttribute('aRest', new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute('aFur', new THREE.BufferAttribute(new Float32Array(t.pos.length / 3).fill(o.fur || 0), 1));
  g.setIndex(new THREE.BufferAttribute(t.idx, 1));
  g.computeBoundingSphere();
  g.userData.ni = true; // 缓存几何体：场景销毁时不释放
  GC.set(key, g);
  return g;
}
function part(key, prims, mat, o) {
  const m = new THREE.Mesh(sdfGeo(key, prims, o), typeof mat === 'string' ? charMat(mat) : mat);
  m.castShadow = true;
  return m;
}
function grp(x, y, z, ...ch) { const g = new THREE.Group(); g.position.set(x, y, z); for (const c of ch) if (c) g.add(c); return g; }
function rigid(build, mat) { const b = new Builder(); build(b); const m = b.mesh(true, mat || rigidMat()); return m; }
function glowEye(color, s, x, y, z) { const m = new THREE.Mesh(Geo.sph(8, 6), matGlow(color)); m.scale.setScalar(s); m.position.set(x, y, z); return m; }
function rigOf(parts) { const root = new THREE.Group(); const pivot = new THREE.Group(); root.add(pivot); for (const p of parts) if (p) pivot.add(p); return { root, pivot }; }
// 距离函数里用到的固定基元（预先创建，避免每次求值都分配对象）
const _E0 = { t: 'ell', c: [0, -0.03, 0.08], r: [0.115, 0.04, 0.1] };
const _E1 = { t: 'ell', c: [0, 0.9, 0.02], r: [0.2, 0.19, 0.15] };
const _E3 = { t: 'ell', c: [0, 0.8, 0], r: [0.64, 0.44, 0.64] };
const _C4 = { t: 'cone', a: [-0.5, 0.2, 0.4], b: [0.5, 0.2, 0.4], r1: 0.37, r2: 0.37 };
const _C5 = { t: 'cone', a: [0, 1.5, 0], b: [0, 0.1, 0], r1: 0.24, r2: 0.56 };
const _C6 = { t: 'cone', a: [0, 2.0, 0], b: [0, 0.1, 0], r1: 0.5, r2: 0.95 };

// 蝙蝠 / 小鬼的翼膜：带扇形缺口的膜 + 指骨
function wingMesh(side, col, bone, len = 0.8) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.04);
  s.quadraticCurveTo(len * 0.45, 0.22, len, 0.08);
  const tips = [[len * 0.88, -0.22], [len * 0.6, -0.3], [len * 0.32, -0.26], [0.02, -0.14]];
  let px = len, py = 0.08;
  for (const [tx, ty] of tips) { s.quadraticCurveTo((px + tx) / 2 - 0.02, (py + ty) / 2 + 0.07, tx, ty); px = tx; py = ty; }
  s.lineTo(0, 0.04);
  const g = new THREE.ShapeGeometry(s, 8);
  g.rotateX(-Math.PI / 2);
  if (side < 0) g.scale(-1, 1, 1);
  const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color(col).multiplyScalar(1.5), side: THREE.DoubleSide, shininess: 30, specular: 0x331a22, emissive: new THREE.Color(col).multiplyScalar(0.3), transparent: true, opacity: 0.92 });
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  const g2 = new THREE.Group();
  g2.add(m);
  // 指骨：从翼根呈扇形伸向每个尖端（Builder 圆柱默认沿 y 轴，先绕 z 转到 -x，再绕 y 转到目标方向）
  const bones = rigid((b) => {
    const seg = (x1, z1, r) => { const L = Math.hypot(x1, z1); b.add(Geo.cyl(5), bone, x1 / 2, 0.012, z1 / 2, r, L, r, 0, Math.atan2(z1, -x1), Math.PI / 2); };
    seg(side * len, -0.08, 0.035);
    for (const [tx, ty] of tips.slice(0, 3)) seg(side * tx, -ty, 0.02);
  }, charMat('skin'));
  g2.add(bones);
  return g2;
}

// ---------------------------------------------------------------- 骷髅战士 / 弓手
const BONE = 0xe6dcc4, BONE_D = 0xb8ab90;
function skullPrims() {
  return [
    ell([0, 0.16, -0.01], [0.19, 0.18, 0.2], BONE, 0.05),
    ell([0, 0.05, 0.12], [0.13, 0.08, 0.1], BONE, 0.05),
    ell([-0.1, 0.07, 0.11], [0.06, 0.05, 0.06], BONE, 0.03), ell([0.1, 0.07, 0.11], [0.06, 0.05, 0.06], BONE, 0.03),
    cone([0, -0.1, -0.03], [0, 0.02, -0.02], 0.045, 0.05, BONE_D, 0.03),
    sub(ell([-0.075, 0.12, 0.18], [0.058, 0.055, 0.07], 0)), sub(ell([0.075, 0.12, 0.18], [0.058, 0.055, 0.07], 0)),
    sub(ell([0, 0.05, 0.21], [0.022, 0.035, 0.04], 0)),
  ];
}
function jawPrims() {
  const P = [fn((x, y, z) => Math.max(sdPrim(x, y, z, _E0), -z - 0.02), BONE, [[-0.13, -0.08, -0.03], [0.13, 0.02, 0.19]])];
  for (const s of [-1, 1]) P.push(cone([s * 0.1, -0.02, 0.0], [s * 0.1, 0.05, -0.01], 0.022, 0.02, BONE, 0.02));
  for (let k = -2; k <= 2; k++) P.push(ell([k * 0.03, 0.005, 0.165 - Math.abs(k) * 0.012], [0.013, 0.02, 0.012], 0xf4ecd8, 0.005));
  return P;
}
function upperTeeth() { const P = []; for (let k = -3; k <= 3; k++) P.push(ell([k * 0.028, -0.005, 0.19 - Math.abs(k) * 0.012], [0.012, 0.022, 0.011], 0xf4ecd8, 0.005)); return P; }
function torsoPrims() {
  const cage = (x, y, z) => {
    const shell = Math.abs(sdPrim(x, y, z, _E1)) - 0.016;
    const band = Math.sin((y - 0.76) * 46) > 0.3 ? 0.03 : -0.03;
    const front = z > 0.1 && Math.abs(x) < 0.03 ? 0.03 : -0.03;
    return Math.max(shell, band, front, 0.74 - y, y - 1.07, -z - 0.1 + (y > 0.8 ? 0.1 : 0) * 0);
  };
  const P = [fn(cage, BONE, [[-0.24, 0.7, -0.16], [0.24, 1.1, 0.2]], 0.02)];
  P.push(cone([0, 0.56, -0.05], [0, 1.08, -0.08], 0.032, 0.03, BONE_D, 0.02));
  for (let k = 0; k < 8; k++) P.push(ell([0, 0.58 + k * 0.065, -0.07], [0.045, 0.02, 0.035], BONE, 0.02));
  P.push(cone([0, 0.8, 0.165], [0, 1.03, 0.14], 0.022, 0.026, BONE, 0.02));
  for (const s of [-1, 1]) { P.push(cone([s * 0.03, 1.06, 0.12], [s * 0.2, 1.06, 0.01], 0.02, 0.022, BONE, 0.02)); P.push(ell([s * 0.22, 1.04, 0.0], [0.05, 0.045, 0.05], BONE, 0.03)); }
  // 骨盆
  P.push(ell([0, 0.55, -0.01], [0.12, 0.05, 0.07], BONE, 0.04));
  for (const s of [-1, 1]) { const _E2 = { t: 'ell', c: [s * 0.1, 0.56, 0], r: [0.09, 0.07, 0.07] }; P.push(fn((x, y, z) => Math.max(Math.abs(sdPrim(x, y, z, _E2)) - 0.015, -(y - 0.5)), BONE, [[s * 0.1 - 0.11, 0.48, -0.09], [s * 0.1 + 0.11, 0.65, 0.09]], 0.02)); }
  return P;
}
function limbPrims(len1, len2, r) {
  return {
    upper: [ell([0, 0, 0], [r * 1.35, r * 1.35, r * 1.35], BONE, 0.03), cone([0, 0, 0], [0, -len1, 0.01], r, r * 0.85, BONE, 0.02), ell([0, -len1, 0.01], [r * 1.3, r * 1.2, r * 1.3], BONE, 0.03)],
    lower: [cone([0, 0, 0], [0, -len2, 0.01], r * 0.9, r * 0.75, BONE, 0.02), cone([r * 0.9, 0, 0], [r * 0.7, -len2, 0.01], r * 0.45, r * 0.4, BONE, 0.02)],
  };
}
export function makeSkeleton(archer = false) {
  const torso = part('sk_torso', torsoPrims(), 'bone', { res: 44 });
  const skull = part('sk_skull', [...skullPrims(), ...upperTeeth()], 'bone', { res: 34 });
  const jaw = grp(0, 0.02, 0.0, part('sk_jaw', jawPrims(), 'bone', { res: 26 }));
  const eyes = [glowEye(0xff3a2a, 0.045, -0.075, 0.12, 0.16), glowEye(0xff3a2a, 0.045, 0.075, 0.12, 0.16)];
  const head = grp(0, 1.12, 0.0, skull, jaw, ...eyes);
  if (archer) head.add(part('sk_hood', [ell([0, 0.17, -0.03], [0.24, 0.24, 0.24], 0x3a3a2a, 0.04), cone([0, 0.1, -0.1], [0, -0.14, -0.2], 0.2, 0.26, 0x3a3a2a), sub(ell([0, 0.1, 0.2], [0.16, 0.16, 0.16], 0)), sub(ell([0, 0.12, 0.02], [0.2, 0.2, 0.2], 0))], 'cloth', { res: 30, noise: 0.08 }));
  const L = limbPrims(0.26, 0.24, 0.028);
  const arm = (s) => {
    const up = part('sk_uarm', L.upper, 'bone', { res: 22 });
    const lo = part('sk_farm', L.lower, 'bone', { res: 22 });
    const hand = part('sk_hand', [ell([0, 0, 0.01], [0.04, 0.05, 0.03], BONE, 0.02), cone([0, -0.02, 0.02], [0, -0.09, 0.05], 0.012, 0.009, BONE, 0.01), cone([0.025, -0.02, 0.02], [0.03, -0.08, 0.05], 0.01, 0.008, BONE, 0.01), cone([-0.025, -0.02, 0.02], [-0.03, -0.08, 0.05], 0.01, 0.008, BONE, 0.01)], 'bone', { res: 18 });
    const el = grp(0, -0.27, 0.01, lo, grp(0, -0.25, 0.01, hand));
    const sh = grp(s * 0.25, 1.03, 0.0, up, el);
    sh.userData.el = el;
    return sh;
  };
  const armL = arm(-1), armR = arm(1);
  armL.rotation.z = -0.15; armR.rotation.z = 0.12;
  const leg = (s) => {
    const Lg = limbPrims(0.24, 0.22, 0.034);
    const up = part('sk_thigh', Lg.upper, 'bone', { res: 22 });
    const lo = part('sk_shin', Lg.lower, 'bone', { res: 22 });
    const foot = part('sk_foot', [ell([0, -0.02, 0.05], [0.05, 0.03, 0.1], BONE, 0.02), cone([0, -0.03, 0.08], [0, -0.04, 0.16], 0.02, 0.015, BONE, 0.01)], 'bone', { res: 18 });
    const kn = grp(0, -0.25, 0.01, lo, grp(0, -0.23, 0, foot));
    const hip = grp(s * 0.1, 0.52, 0, up, kn);
    hip.userData.kn = kn;
    return hip;
  };
  const legL = leg(-1), legR = leg(1);
  // 武器
  let weapon;
  if (archer) {
    weapon = rigid((b) => { b.add(Geo.arc(0.06), 0x6a4a2a, 0, 0, 0.12, 0.8, 0.9, 0.6, 0, Math.PI / 2, 0); b.add(Geo.box(), 0xdddddd, 0, 0, 0.12, 0.01, 0.8, 0.01); }, charMat('cloth'));
  } else {
    weapon = rigid((b) => {
      b.add(Geo.cyl(8), 0x4a3020, 0, 0, 0.06, 0.05, 0.18, 0.05, Math.PI / 2, 0, 0);
      b.add(Geo.box(), 0x6a5a4a, 0, 0, 0.17, 0.22, 0.05, 0.05);
      b.add(Geo.box(), 0x8a8078, 0, 0, 0.5, 0.075, 0.03, 0.62);
      b.add(Geo.cone(4), 0x8a8078, 0, 0, 0.85, 0.075, 0.1, 0.03, Math.PI / 2, 0, 0);
    });
    // 破木盾
    const shield = rigid((b) => { b.add(Geo.cyl(16), 0x5a3a22, 0, 0, 0, 0.44, 0.06, 0.44, Math.PI / 2, 0, 0); b.add(Geo.torus(0.08), 0x5a5a60, 0, 0, 0, 0.44, 0.44, 0.44); b.add(Geo.sph(10, 8), 0x6a6a70, 0, 0, 0.03, 0.12, 0.12, 0.08); }, charMat('cloth'));
    shield.position.set(-0.05, -0.12, 0.08); shield.rotation.y = -1.2;
    armL.userData.el.add(shield);
  }
  weapon.position.set(0, -0.26, 0.03);
  armR.userData.el.add(weapon);
  const r = rigOf([torso, head, armL, armR, legL, legR]);
  Object.assign(r, { arm: armR, armL, legL, legR, head, jaw, elbowL: armL.userData.el, elbowR: armR.userData.el, kneeL: legL.userData.kn, kneeR: legR.userData.kn, height: 1.5 });
  return r;
}

// ---------------------------------------------------------------- 史莱姆
export function makeSlime(color = 0x5ad84a, s = 1) {
  const light = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex();
  const P = [ell([0, 0.02, 0], [0.5, 0.48, 0.5], color, 0.1), ell([0, 0.32, -0.02], [0.28, 0.22, 0.28], color, 0.12)];
  for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 + 0.3; P.push(ell([Math.cos(a) * 0.4, -0.36, Math.sin(a) * 0.4], [0.14, 0.1, 0.14], color, 0.1)); }
  const body = part('slime_' + color, P, 'slime', { res: 30, paints: [{ c: [0.1, 0.36, 0.2], r: [0.2, 0.12, 0.14], col: light, soft: 0.08, a: 0.8 }], noise: 0.01 });
  body.scale.set(1.0 * s, 0.75 * s, 1.0 * s);
  body.userData.s = s;
  body.position.y = 0.36 * s;
  const core = new THREE.Mesh(Geo.sph(10, 8), matGlow(new THREE.Color(color).multiplyScalar(0.35).getHex()));
  core.scale.setScalar(0.28 * s); core.position.y = 0.3 * s;
  const eb = new Builder();
  for (const x of [-1, 1]) {
    eb.add(Geo.sph(16, 12), 0xffffff, x * 0.15 * s, 0.52 * s, 0.37 * s, 0.17 * s, 0.21 * s, 0.1 * s);
    eb.add(Geo.sph(12, 9), 0x101010, x * 0.14 * s, 0.51 * s, 0.42 * s, 0.09 * s, 0.12 * s, 0.05 * s);
    eb.add(Geo.sph(8, 6), 0xffffff, x * 0.14 * s + 0.025 * s, 0.55 * s, 0.445 * s, 0.03 * s, 0.03 * s, 0.02 * s);
  }
  const eyes = eb.mesh(false, eyeMat());
  const r = rigOf([body, core, eyes]);
  r.blob = body; r.eyes = eyes; r.height = 0.9 * s;
  return r;
}

// ---------------------------------------------------------------- 吸血蝙蝠
export function makeBat() {
  const fur = 0x3a2a44, pink = 0xb07080;
  const P = [
    ell([0, 0, 0], [0.19, 0.2, 0.18], fur, 0.08), ell([0, 0.15, 0.07], [0.14, 0.13, 0.13], fur, 0.08),
    ell([0, 0.11, 0.19], [0.06, 0.05, 0.06], pink, 0.04),
  ];
  for (const s of [-1, 1]) P.push(cone([s * 0.07, 0.24, 0.05], [s * 0.15, 0.44, 0.0], 0.06, 0.01, fur, 0.03));
  const body = part('bat_body', P, 'fur', { res: 30, fur: 1, paints: [{ c: [-0.12, 0.36, 0.04], r: [0.03, 0.08, 0.02], col: pink, soft: 0.02 }, { c: [0.12, 0.36, 0.04], r: [0.03, 0.08, 0.02], col: pink, soft: 0.02 }] });
  const fangs = rigid((b) => { for (const x of [-1, 1]) b.add(Geo.cone(5), 0xfff4e0, x * 0.035, 0.05, 0.22, 0.025, 0.06, 0.025, Math.PI, 0, 0); }, charMat('bone'));
  const eg = glowEye(0xffe03a, 0.04, -0.06, 0.18, 0.18), eg2 = glowEye(0xffe03a, 0.04, 0.06, 0.18, 0.18);
  const wl = grp(-0.12, 0.02, 0, wingMesh(-1, 0x4a2a52, 0x2a1a30));
  const wr = grp(0.12, 0.02, 0, wingMesh(1, 0x4a2a52, 0x2a1a30));
  const feet = rigid((b) => { for (const x of [-1, 1]) b.add(Geo.cone(4), 0x2a1a20, x * 0.06, -0.22, 0, 0.03, 0.08, 0.03, Math.PI, 0, 0); }, charMat('skin'));
  const r = rigOf([body, fangs, eg, eg2, wl, wr, feet]);
  r.wl = wl; r.wr = wr; r.height = 0.8;
  r.pivot.position.y = 1.4;
  return r;
}

// ---------------------------------------------------------------- 宝箱怪
export function makeMimic() {
  const wood = 0x7a4a22;
  const planks = (x, y, z) => (Math.abs(((y * 6.5) % 1 + 1) % 1 - 0.5) > 0.44 ? 0x3a2410 : ((x * 3.1 + 5) | 0) % 2 ? wood : 0x6e421e);
  const body = part('mimic_body', [box([0, 0.3, 0], [0.5, 0.26, 0.36], 0.04, wood)], 'cloth', { res: 34, color: (x, y, z) => (y > 0.54 && Math.abs(x) < 0.44 && Math.abs(z) < 0.3 ? 0x5a0a10 : planks(x, y, z)) });
  const lidP = [box([0, 0.12, 0.4], [0.51, 0.1, 0.37], 0.04, wood), fn((x, y, z) => Math.max(sdPrim(x, y, z, _C4), 0.2 - y), wood, [[-0.55, 0.2, 0], [0.55, 0.45, 0.8]], 0.02)];
  const lidMesh = part('mimic_lid', lidP, 'cloth', { res: 34, color: (x, y, z) => (y < 0.06 && Math.abs(x) < 0.44 && Math.abs(z - 0.4) < 0.3 ? 0x5a0a10 : planks(x, y + z, z)) });
  const trim = (lid) => rigid((b) => {
    const gold = 0xc8a040;
    if (!lid) { for (const x of [-1, 1]) b.add(Geo.box(), gold, x * 0.5, 0.3, 0, 0.06, 0.56, 0.78); b.add(Geo.box(), gold, 0, 0.3, 0.37, 0.2, 0.2, 0.04); }
    else { for (const x of [-1, 1]) b.add(Geo.box(), gold, x * 0.5, 0.2, 0.4, 0.06, 0.34, 0.8); b.add(Geo.box(), gold, 0, 0.1, 0.78, 0.18, 0.14, 0.04); }
  });
  const teeth = (lid) => rigid((b) => { for (let i = 0; i < 6; i++) { const x = -0.4 + i * 0.16; if (lid) b.add(Geo.cone(5), 0xf0ead8, x, -0.05, 0.74, 0.07, 0.14, 0.06, Math.PI, 0, 0); else b.add(Geo.cone(5), 0xf0ead8, x, 0.62, 0.32, 0.07, 0.14, 0.06); } for (let i = 0; i < 4; i++) { const z = -0.2 + i * 0.14; for (const x of [-1, 1]) lid ? b.add(Geo.cone(5), 0xf0ead8, x * 0.46, -0.04, z + 0.4, 0.05, 0.1, 0.05, Math.PI, 0, 0) : b.add(Geo.cone(5), 0xf0ead8, x * 0.46, 0.6, z, 0.05, 0.1, 0.05); } }, charMat('bone'));
  const tongue = part('mimic_tongue', [cone([0, 0.56, -0.05], [0, 0.6, 0.3], 0.12, 0.08, 0xc03a4a, 0.05), ell([0, 0.58, 0.34], [0.1, 0.03, 0.09], 0xc03a4a, 0.05)], 'slime', { res: 20, noise: 0 });
  const lid = grp(0, 0.6, -0.4, lidMesh, trim(true), teeth(true));
  const eg = glowEye(0xffe03a, 0.08, -0.2, 0.2, 0.82), eg2 = glowEye(0xffe03a, 0.08, 0.2, 0.2, 0.82);
  lid.add(eg, eg2);
  const r = rigOf([body, trim(false), teeth(false), tongue, lid]);
  r.lid = lid; r.tongue = tongue; r.height = 1.1;
  return r;
}

// ---------------------------------------------------------------- 远古石魔（首领）
export function makeGolem() {
  const rock = 0x8a8290, rockD = 0x5e5866, moss = 0x4e6a3a;
  const mossPaint = [{ c: [-0.9, 2.62, 0], r: [0.42, 0.14, 0.36], col: moss, soft: 0.08 }, { c: [0.9, 2.62, 0], r: [0.42, 0.14, 0.36], col: moss, soft: 0.08 }, { c: [0, 3.05, 0.1], r: [0.35, 0.1, 0.3], col: moss, soft: 0.08 }];
  const torsoP = [
    ell([0, 1.75, 0], [0.92, 0.72, 0.62], rock, 0.25), ell([0, 1.1, 0], [0.6, 0.32, 0.45], rockD, 0.2),
    ell([-0.88, 2.25, 0], [0.46, 0.4, 0.42], rockD, 0.15), ell([0.88, 2.25, 0], [0.46, 0.4, 0.42], rockD, 0.15),
    ell([0, 2.7, 0.14], [0.44, 0.36, 0.42], rock, 0.2), ell([0, 2.84, 0.44], [0.4, 0.1, 0.12], rockD, 0.08),
    ell([0, 2.52, 0.4], [0.3, 0.12, 0.2], rockD, 0.08),
    sub(ell([-0.17, 2.74, 0.55], [0.1, 0.07, 0.1], 0)), sub(ell([0.17, 2.74, 0.55], [0.1, 0.07, 0.1], 0)),
  ];
  for (let k = 0; k < 7; k++) { const a = k * 1.7; torsoP.push(ell([Math.sin(a) * 0.55, 1.4 + (k % 3) * 0.35, Math.cos(a) * 0.35], [0.3, 0.25, 0.28], k % 2 ? rock : rockD, 0.12)); }
  const torso = part('golem_torso', torsoP, 'rock', { res: 44, rough: 0.025, paints: mossPaint });
  const glow = new THREE.Group();
  for (const [x, y, z, s] of [[-0.17, 2.74, 0.5, 0.1], [0.17, 2.74, 0.5, 0.1], [0, 1.8, 0.62, 0.26], [0.4, 1.4, 0.56, 0.1], [-0.3, 2.1, 0.6, 0.12]]) glow.add(glowEye(0xff7a1a, s, x, y, z));
  const legP = [ell([0, -0.35, 0], [0.34, 0.5, 0.34], rock, 0.15), ell([0, -0.84, 0.12], [0.4, 0.2, 0.5], rockD, 0.12)];
  const legL = grp(-0.45, 1.0, 0, part('golem_leg', legP, 'rock', { res: 30, rough: 0.03 }));
  const legR = grp(0.45, 1.0, 0, part('golem_leg', legP, 'rock', { res: 30, rough: 0.03 }));
  const fistP = [ell([0, -0.4, 0], [0.3, 0.5, 0.3], rock, 0.15), ell([0, -1.12, 0.1], [0.48, 0.44, 0.48], rockD, 0.15), ell([0, -1.3, 0.4], [0.36, 0.18, 0.14], rock, 0.08)];
  const fl = grp(-1.35, 2.3, 0, part('golem_fist', fistP, 'rock', { res: 32, rough: 0.035 }));
  const fr = grp(1.35, 2.3, 0, part('golem_fist', fistP, 'rock', { res: 32, rough: 0.035 }));
  const r = rigOf([torso, glow, legL, legR, fl, fr]);
  Object.assign(r, { fl, fr, glow, legL, legR, height: 3.4 });
  return r;
}

// ---------------------------------------------------------------- 孢子蘑菇
export function makeMushroomMan() {
  const stem = 0xf0e4c8, cap = 0xc8302a;
  const body = part('mush_stem', [cone([0, 0.2, 0], [0, 0.74, 0], 0.27, 0.21, stem, 0.1), ell([0, 0.36, 0.04], [0.3, 0.27, 0.28], stem, 0.12)], 'skin', { res: 30,
    paints: [{ c: [0, 0.45, 0.27], r: [0.07, 0.02, 0.03], col: 0x5a1a1a, soft: 0.015 }, { c: [0, 0.3, 0.28], r: [0.16, 0.12, 0.05], col: 0xfaf2e0, soft: 0.05, a: 0.6 }] });
  const spots = [];
  for (let k = 0; k < 9; k++) { const a = k * 2.4, rr = 0.15 + (k % 3) * 0.15; spots.push({ c: [Math.cos(a) * rr, 0.82 + Math.sqrt(Math.max(0, 0.4 - rr * rr)) * 0.55, Math.sin(a) * rr], r: [0.08, 0.06, 0.08], col: 0xfff4e0, soft: 0.02 }); }
  spots.push({ c: [0, 0.74, 0], r: [0.6, 0.035, 0.6], col: 0xe8d8b8, soft: 0.02 });
  const capM = part('mush_cap', [fn((x, y, z) => Math.max(sdPrim(x, y, z, _E3), 0.74 - y), cap, [[-0.66, 0.72, -0.66], [0.66, 1.26, 0.66]], 0.04), ell([0, 0.77, 0], [0.66, 0.06, 0.66], cap, 0.06)], 'skin', { res: 36, paints: spots });
  const eb = new Builder();
  for (const x of [-1, 1]) { eb.add(Geo.sph(14, 10), 0x141010, x * 0.09, 0.58, 0.245, 0.075, 0.1, 0.045); eb.add(Geo.sph(8, 6), 0xffffff, x * 0.09 + 0.02, 0.61, 0.265, 0.025, 0.025, 0.015); }
  const eyes = eb.mesh(false, eyeMat());
  const legL = grp(-0.13, 0.18, 0, part('mush_foot', [ell([0, -0.08, 0.04], [0.12, 0.1, 0.15], stem, 0.05)], 'skin', { res: 18 }));
  const legR = grp(0.13, 0.18, 0, part('mush_foot', [ell([0, -0.08, 0.04], [0.12, 0.1, 0.15], stem, 0.05)], 'skin', { res: 18 }));
  const armP = [cone([0, 0, 0], [0.06, -0.22, 0.05], 0.07, 0.055, stem, 0.04)];
  const armL = grp(-0.26, 0.56, 0, part('mush_armL', armP.map((p) => Object.assign({}, p, { b: [-0.06, -0.22, 0.05] })), 'skin', { res: 18 }));
  const armR = grp(0.26, 0.56, 0, part('mush_armR', armP, 'skin', { res: 18 }));
  const capG = grp(0, 0, 0, capM);
  const r = rigOf([body, capG, eyes, legL, legR, armL, armR]);
  Object.assign(r, { cap: capG, legL, legR, armL, armR, height: 1.3 });
  return r;
}

// ---------------------------------------------------------------- 怨灵
export function makeWraith() {
  const g = new THREE.Group();
  const mat = charMatOwn('ghost');
  const hem = (x, y, z) => 0.12 + 0.1 * Math.sin(Math.atan2(x, z) * 5) - y;
  const robeP = [
    fn((x, y, z) => Math.max(sdPrim(x, y, z, _C5), hem(x, y, z)), 0x9ab0d8, [[-0.6, 0, -0.6], [0.6, 1.6, 0.6]], 0.06),
    ell([0, 1.62, 0], [0.3, 0.32, 0.31], 0xb0c4e8, 0.08), sub(ell([0, 1.58, 0.24], [0.17, 0.2, 0.16], 0)),
  ];
  for (const s of [-1, 1]) robeP.push(cone([s * 0.22, 1.32, 0.02], [s * 0.2, 1.14, 0.44], 0.1, 0.13, 0x9ab0d8, 0.06));
  const robe = new THREE.Mesh(sdfGeo('wraith_robe', robeP, { res: 36, color: (x, y) => (y > 1.2 ? 0xb8cce8 : y < 0.4 ? 0x5a6a90 : 0x8aa0c8) }), mat);
  const face = new THREE.Mesh(Geo.sph(10, 8), matGlow(0x05050c)); face.scale.set(0.34, 0.36, 0.2); face.position.set(0, 1.58, 0.16);
  const e1 = glowEye(0x9fe8ff, 0.045, -0.08, 1.62, 0.27), e2 = glowEye(0x9fe8ff, 0.045, 0.08, 1.62, 0.27);
  const hands = rigid((b) => { for (const s of [-1, 1]) { b.add(Geo.sph(8, 6), BONE, s * 0.2, 1.13, 0.56, 0.08, 0.06, 0.08); for (let k = -1; k <= 1; k++) b.add(Geo.cone(4), BONE, s * 0.2 + k * 0.025, 1.1, 0.62, 0.018, 0.08, 0.018, 1.6, 0, 0); } }, charMat('bone'));
  g.add(robe, face, e1, e2, hands);
  const gl = glowSprite(0x6a9aff, 2.2, 0.35); gl.position.y = 1.3; g.add(gl);
  const r = rigOf([g]);
  r.body = g; r.mat = mat; r.height = 1.9;
  return r;
}

// ---------------------------------------------------------------- 冰霜法师（骷髅法师）
export function makeIceMage() {
  const blue = 0x3a6aa8, ice = 0xbfe8ff;
  const robe = part('ice_robe', [cone([0, 1.12, 0], [0, 0.04, 0], 0.22, 0.42, blue, 0.08), ell([0, 1.06, 0], [0.3, 0.13, 0.24], blue, 0.08), cone([-0.26, 1.04, 0], [-0.34, 0.66, 0.08], 0.09, 0.13, blue, 0.06)], 'cloth', { res: 36,
    color: (x, y, z) => (y < 0.12 ? ice : Math.abs(x) < 0.03 && z > 0.1 ? ice : y < 0.3 ? 0x5a8ac0 : blue) });
  const head = grp(0, 1.14, 0, part('sk_skull', [...skullPrims(), ...upperTeeth()], 'bone', { res: 34 }), grp(0, 0.02, 0, part('sk_jaw', jawPrims(), 'bone', { res: 26 })),
    glowEye(0x9fe8ff, 0.04, -0.075, 0.12, 0.16), glowEye(0x9fe8ff, 0.04, 0.075, 0.12, 0.16));
  head.scale.setScalar(0.92);
  const hat = part('ice_hat', [ell([0, 1.42, 0], [0.3, 0.05, 0.3], 0x2a5a98, 0.04), cone([0, 1.44, -0.02], [0, 1.98, -0.16], 0.23, 0.02, 0x2a5a98, 0.03), sub(ell([0, 1.3, 0.05], [0.2, 0.14, 0.2], 0))], 'cloth', { res: 30 });
  const crystals = rigid((b) => { for (const s of [-1, 1]) for (let k = 0; k < 3; k++) b.add(Geo.oct(), ice, s * (0.22 + k * 0.05), 1.14 + k * 0.03, -0.05 - k * 0.04, 0.05, 0.12 - k * 0.02, 0.05, 0, 0, s * (0.3 + k * 0.3)); }, charMat('slime'));
  const staff = rigid((b) => b.add(Geo.cyl(8), 0x6a4a2a, 0, 0.2, 0, 0.06, 1.4, 0.06), charMat('cloth'));
  const cr = new THREE.Mesh(Geo.oct(), matGlow(0x9fe8ff)); cr.scale.set(0.16, 0.26, 0.16); cr.position.y = 1.0; staff.add(cr);
  const gl = glowSprite(0x7fd8ff, 1.3, 0.8); gl.position.y = 1.0; staff.add(gl);
  const sleeve = part('ice_sleeve', [cone([0, 0.3, -0.05], [0, 0.02, 0.0], 0.09, 0.13, blue, 0.04)], 'cloth', { res: 20, color: (x, y) => (y < 0.06 ? ice : blue) });
  const hand = rigid((b) => b.add(Geo.sph(8, 6), BONE, 0, 0.0, 0.0, 0.08, 0.08, 0.08), charMat('bone'));
  const arm = grp(0.34, 0.7, 0.1, staff, sleeve, hand);
  const r = rigOf([robe, head, hat, crystals, arm]);
  r.arm = arm; r.height = 1.8;
  return r;
}

// ---------------------------------------------------------------- 火焰小鬼
export function makeFireImp() {
  const red = 0xc8301a, belly = 0xff8a3a, dark = 0x2a1410;
  const P = [
    ell([0, 0, 0], [0.26, 0.28, 0.24], red, 0.08), ell([0, 0.3, 0.05], [0.22, 0.2, 0.2], red, 0.08), ell([0, 0.25, 0.2], [0.12, 0.08, 0.08], red, 0.05),
    cone([0, -0.12, -0.2], [0, -0.3, -0.55], 0.06, 0.02, red, 0.04),
  ];
  for (const s of [-1, 1]) {
    P.push(cone([s * 0.09, 0.44, 0.0], [s * 0.2, 0.62, -0.08], 0.05, 0.008, dark, 0.02));
    P.push(cone([s * 0.19, 0.32, 0.0], [s * 0.36, 0.38, -0.04], 0.05, 0.008, red, 0.03));
    P.push(cone([s * 0.2, 0.05, 0.05], [s * 0.3, -0.12, 0.14], 0.06, 0.045, red, 0.04));
    P.push(cone([s * 0.1, -0.22, 0.02], [s * 0.12, -0.38, 0.06], 0.07, 0.05, red, 0.04));
  }
  const body = part('imp_body', P, 'skin', { res: 34, paints: [{ c: [0, -0.02, 0.18], r: [0.17, 0.2, 0.1], col: belly, soft: 0.04 }, { c: [0, 0.2, 0.25], r: [0.09, 0.015, 0.03], col: 0x1a0a08, soft: 0.01 }] });
  const eyes = [glowEye(0xffe03a, 0.045, -0.08, 0.34, 0.22), glowEye(0xffe03a, 0.045, 0.08, 0.34, 0.22)];
  const wl = grp(-0.15, 0.12, -0.08, wingMesh(-1, 0x6a1a10, 0x3a0a08, 0.62));
  const wr = grp(0.15, 0.12, -0.08, wingMesh(1, 0x6a1a10, 0x3a0a08, 0.62));
  const tail = new THREE.Mesh(Geo.cone(6), matGlow(0xffa030)); tail.scale.set(0.12, 0.22, 0.12); tail.position.set(0, -0.32, -0.62); tail.rotation.x = -2;
  const gl = glowSprite(0xff6a1a, 1.8, 0.5);
  const r = rigOf([body, ...eyes, wl, wr, tail, gl]);
  r.wl = wl; r.wr = wr; r.height = 0.8;
  r.pivot.position.y = 1.4;
  return r;
}

// ---------------------------------------------------------------- 骷髅巫王（首领）
export function makeLich() {
  const purple = 0x3a1a4a, gold = 0xc9a45a;
  const hem = (x, y, z) => 0.12 + 0.08 * Math.sin(Math.atan2(x, z) * 7) - y;
  const robeP = [
    fn((x, y, z) => Math.max(sdPrim(x, y, z, _C6), hem(x, y, z)), purple, [[-1, 0, -1], [1, 2.1, 1]], 0.08),
    ell([0, 1.84, -0.12], [0.66, 0.26, 0.4], 0x4a2a5a, 0.1), cone([-0.55, 1.85, 0], [-0.75, 1.35, 0.3], 0.2, 0.26, purple, 0.08),
  ];
  const robe = part('lich_robe', robeP, 'cloth', { res: 44, color: (x, y, z) => (y < 0.2 || (Math.abs(x) < 0.07 && z > 0.3) ? gold : y > 1.75 ? 0x4a2a5a : purple) });
  const head = grp(0, 2.26, 0.06, part('sk_skull', [...skullPrims(), ...upperTeeth()], 'bone', { res: 34 }), grp(0, 0.02, 0, part('sk_jaw', jawPrims(), 'bone', { res: 26 })),
    glowEye(0x6aff9a, 0.05, -0.075, 0.12, 0.16), glowEye(0x6aff9a, 0.05, 0.075, 0.12, 0.16));
  head.scale.setScalar(1.55);
  const crown = rigid((b) => { b.add(Geo.cyl(16), 0xffcf4a, 0, 2.74, 0.04, 0.58, 0.12, 0.58); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.add(Geo.cone(4), 0xffcf4a, Math.sin(a) * 0.25, 2.88, Math.cos(a) * 0.25 + 0.04, 0.08, 0.22, 0.08); } b.add(Geo.oct(), 0x6aff9a, 0, 2.76, 0.34, 0.07, 0.09, 0.04); });
  const pauldrons = rigid((b) => { for (const s of [-1, 1]) { b.add(Geo.hemi(), gold, s * 0.58, 1.98, 0, 0.5, 0.36, 0.48, 0, 0, s * -0.4); for (let k = 0; k < 3; k++) b.add(Geo.cone(5), 0xd8d0c0, s * (0.5 + k * 0.1), 2.14 - k * 0.04, -0.05, 0.06, 0.24, 0.06, 0, 0, s * -0.5); } });
  const lhand = rigid((b) => { b.add(Geo.sph(8, 6), BONE, -0.76, 1.3, 0.34, 0.14, 0.12, 0.14); for (let k = -1; k <= 1; k++) b.add(Geo.cone(4), BONE, -0.76 + k * 0.04, 1.2, 0.38, 0.03, 0.14, 0.03, Math.PI, 0, 0); }, charMat('bone'));
  const staff = rigid((b) => { b.add(Geo.cyl(8), 0x3a2a1a, 0, 0.3, 0, 0.1, 2.4, 0.1); b.add(Geo.torus(0.2), 0xffcf4a, 0, 1.55, 0, 0.3, 0.3, 0.3); }, charMat('cloth'));
  const orb = new THREE.Mesh(Geo.sph(12, 10), matGlow(0x6aff9a)); orb.scale.setScalar(0.28); orb.position.y = 1.7; staff.add(orb);
  const gl = glowSprite(0x4aff8a, 2.4, 0.8); gl.position.y = 1.7; staff.add(gl);
  const sleeve = part('lich_sleeve', [cone([0, 0.4, -0.1], [0, 0.0, 0.0], 0.2, 0.26, purple, 0.05)], 'cloth', { res: 22, color: (x, y) => (y < 0.06 ? gold : purple) });
  const arm = grp(0.7, 1.5, 0.2, staff, sleeve, rigid((b) => b.add(Geo.sph(8, 6), BONE, 0, 0, 0.05, 0.14, 0.12, 0.14), charMat('bone')));
  const aura = glowSprite(0x6a2aff, 4.5, 0.35); aura.position.y = 1.4;
  const r = rigOf([robe, head, crown, pauldrons, lhand, arm, aura]);
  r.arm = arm; r.orb = orb; r.height = 3.0;
  return r;
}

// 楼层加载时预先生成会出现的怪物几何体（首次生成较耗时，放在切场景的黑屏里完成）
export function prewarmCreatures(kinds) {
  const mk = { skeleton: () => makeSkeleton(false), archer: () => makeSkeleton(true), slime: () => makeSlime(0x5ad84a, 1), slimelet: () => makeSlime(0x7ae86a, 0.55), bat: makeBat, mimic: makeMimic, golem: makeGolem, lich: makeLich, mushroom: makeMushroomMan, wraith: makeWraith, iceMage: makeIceMage, fireImp: makeFireImp };
  for (const k of new Set(kinds)) if (mk[k]) mk[k]();
}

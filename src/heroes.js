// 熊熊英雄：职业 / 性别 / 毛色 / 服装 / 头饰 / 发型，全部程序化建模，四肢独立骨骼便于动画
// 写实风格（参考写实熊设定图）：长吻、湿润黑鼻头、小眼睛、厚颊毛和肩峰、圆肚子、黑色熊爪；
// 身体由 SDF 基元平滑融合 → Marching Cubes 一整块无缝网格，衣物是沿身体外扩的一层皮（跟随同一副骨骼 CPU 蒙皮），
// 皮带扣 / 腰包 / 盔甲件等硬物沿表面投射贴合，披风与挂件有二级摆动
import * as THREE from 'three';
import { Builder, Geo, matChar, glowSprite, matGlow } from './models.js';
import { unionField, sdPrim, buildSurface, surfaceAlong, SkinnedRig } from './bearmesh.js';
import { charMat, shellMats, eyeMat, rigidMat } from './charmat.js';

export const CLASSES = {
  knight: {
    name: '熊骑士', icon: 'shield', desc: '剑盾在手，攻守兼备。开局自带神圣护盾。',
    hp: 8, dmg: 10, speed: 4.3, attack: 'slash', range: 2.2, cd: 0.34, start: { shield: 1 },
    stats: { hp: 4, atk: 3, spd: 3, rng: 2 },
  },
  ranger: {
    name: '熊游侠', icon: 'bow', desc: '远程弓箭连射，身手敏捷，翻滚冷却更短。',
    hp: 6, dmg: 7, speed: 4.8, attack: 'arrow', range: 9, cd: 0.3, dashMul: 0.7, start: {},
    stats: { hp: 2, atk: 3, spd: 5, rng: 5 },
  },
  mage: {
    name: '熊法师', icon: 'staff', desc: '发射追踪魔弹并小范围爆炸，开局习得火球术。',
    hp: 6, dmg: 8, speed: 4.2, attack: 'bolt', range: 8, cd: 0.42, start: { fireball: 1 },
    stats: { hp: 2, atk: 4, spd: 3, rng: 4 },
  },
  berserker: {
    name: '熊狂战士', icon: 'axe', desc: '巨斧大范围劈砍，生命越低伤害越高。',
    hp: 10, dmg: 15, speed: 4.1, attack: 'cleave', range: 2.5, cd: 0.52, start: {},
    stats: { hp: 5, atk: 5, spd: 2, rng: 2 },
  },
};
export const CLASS_ORDER = ['knight', 'ranger', 'mage', 'berserker'];

// 写实毛色：fur 主毛色、dark 四肢与背部、muzzle 口鼻、belly 胸腹
export const FURS = [
  { name: '棕熊', fur: 0x7a4426, dark: 0x5a2e18, muzzle: 0xc89a6a, belly: 0x94603a, iris: 0x8a5220 },
  { name: '黑熊', fur: 0x2e2628, dark: 0x1c1618, muzzle: 0xb89870, belly: 0x3a3032, chest: true, iris: 0x6a3a18 },
  { name: '北极熊', fur: 0xf0ece2, dark: 0xd6cfbf, muzzle: 0xf8f4ec, belly: 0xfaf6ee, iris: 0x3a2a20 },
  { name: '熊猫', fur: 0xf6f4ee, dark: 0x1e1c20, muzzle: 0xffffff, belly: 0xffffff, panda: true, iris: 0x2a1a12 },
  { name: '蜂蜜熊', fur: 0xc88a3a, dark: 0x9a6424, muzzle: 0xf0d0a0, belly: 0xd8a860, iris: 0x7a4a18 },
  { name: '灰熊', fur: 0x8a7462, dark: 0x5e4e40, muzzle: 0xc8b49a, belly: 0x9a8472, iris: 0x6a4a28 },
  { name: '樱花熊', fur: 0xe8a8b8, dark: 0xc88898, muzzle: 0xfff0f2, belly: 0xffe0e8, iris: 0x3a78c8 },
];
export const OUTFITS = [
  { name: '皇家蓝', main: 0x2f5fa8, dark: 0x1e3c70, trim: 0xffcf4a },
  { name: '烈焰红', main: 0xb8302a, dark: 0x7a1c18, trim: 0xffd86a },
  { name: '森林绿', main: 0x3a6a3a, dark: 0x234a22, trim: 0xd8c070 },
  { name: '魔法紫', main: 0x6a3aa8, dark: 0x40206a, trim: 0x9fe8ff },
  { name: '日耀金', main: 0xc89a30, dark: 0x8a6410, trim: 0xffffff },
  { name: '暗夜黑', main: 0x2a2630, dark: 0x16121a, trim: 0xc8303a },
];
export const ACCESSORIES = [
  { id: 'default', name: '职业头饰' }, { id: 'none', name: '无' }, { id: 'crown', name: '王冠' }, { id: 'flower', name: '花环' },
  { id: 'bow', name: '蝴蝶结' }, { id: 'eyepatch', name: '海盗眼罩' }, { id: 'glasses', name: '圆框眼镜' }, { id: 'scarf', name: '围巾' },
];
export const HAIRS = {
  male: [{ id: 'tuft', name: '短绒毛' }, { id: 'mane', name: '狮子鬃毛' }, { id: 'mohawk', name: '莫西干' }, { id: 'beard', name: '络腮胡' }],
  female: [{ id: 'bangs', name: '齐刘海' }, { id: 'ponytail', name: '高马尾' }, { id: 'buns', name: '双丸子' }, { id: 'braids', name: '麻花辫' }],
};
export const DEFAULT_HERO = { cls: 'knight', gender: 'male', fur: 0, outfit: 0, acc: 0, hair: 0 };

const _gc = new Map();
function cg(key, fn) { let g = _gc.get(key); if (!g) { g = fn(); _gc.set(key, g); } return g; }
const cap = (r, len) => cg('cap' + r + '_' + len, () => new THREE.CapsuleGeometry(r, len, 6, 16));
const S = () => Geo.sph(22, 16);
const Ss = () => Geo.sph(12, 9);
function part(b, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (b && !b.empty) { const m = b.mesh(true, matChar()); m.receiveShadow = false; g.add(m); }
  return g;
}
const darken = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(1 - k); return c.getHex(); };
const mixc = (a, b, k) => { const c = new THREE.Color(a); c.lerp(new THREE.Color(b), k); return c.getHex(); };
const LEATHER = 0x5e3c24, LEATHER_D = 0x3e2616, STEEL = 0xc8d0d8, STEEL_D = 0x7a8692;

// ---------------------------------------------------------------- 骨骼（绑定姿势下的世界坐标）
const BONES = [
  ['hips', -1, 0, 0.86, 0], ['spine', 0, 0, 1.04, 0], ['chest', 1, 0, 1.24, 0], ['neck', 2, 0, 1.42, 0.04], ['head', 3, 0, 1.54, 0.07],
  ['earL', 4, -0.15, 1.78, 0.03], ['earR', 4, 0.15, 1.78, 0.03], ['tail', 0, 0, 0.88, -0.24],
  ['armL', 2, -0.3, 1.38, 0], ['foreL', 8, -0.4, 1.08, 0.02], ['handL', 9, -0.44, 0.84, 0.05],
  ['armR', 2, 0.3, 1.38, 0], ['foreR', 11, 0.4, 1.08, 0.02], ['handR', 12, 0.44, 0.84, 0.05],
  ['thighL', 0, -0.15, 0.82, 0], ['shinL', 14, -0.16, 0.46, 0.03], ['footL', 15, -0.16, 0.13, 0],
  ['thighR', 0, 0.15, 0.82, 0], ['shinR', 17, 0.16, 0.46, 0.03], ['footR', 18, 0.16, 0.13, 0],
];
const BI = {}; BONES.forEach((b, i) => { BI[b[0]] = i; });
const HEADC = 1.67; // 头骨中心高度（帽子 / 发型的挂点）

// 身体基元：写实比例的熊（宽肩、厚胸、圆肚、粗壮四肢、长吻、肩峰）
function bearPrims(fem, F) {
  const W = fem ? 0.88 : 1, L = fem ? 0.9 : 1;
  const fur = F.fur, dk = F.dark, limb = F.panda ? dk : fur, paw = dk, ear = F.panda ? dk : dk;
  const P = [];
  const ell = (name, bone, c, r, col, k = 0.08, soft) => P.push({ t: 'ell', name, bone: BI[bone], c, r, col, k, soft });
  const cone = (name, bone, a, b, r1, r2, col, k = 0.08, soft) => P.push({ t: 'cone', name, bone: BI[bone], a, b, r1, r2, col, k, soft });
  ell('pelvis', 'hips', [0, 0.88, 0.02], [0.3 * W, 0.26, 0.27 * W], fur, 0.1);
  ell('belly', 'spine', [0, 1.04, 0.07], [0.33 * W, 0.27, 0.3 * W], fur, 0.12);
  ell('chest', 'chest', [0, 1.26, 0.01], [0.36 * W, 0.25, 0.27 * W], fur, 0.12);
  if (!fem) ell('hump', 'chest', [0, 1.39, -0.07], [0.29, 0.14, 0.18], F.panda ? dk : dk, 0.1);
  cone('neck', 'neck', [0, 1.36, 0.03], [0, 1.56, 0.08], 0.21 * W, 0.17, fur, 0.1);
  ell('cranium', 'head', [0, HEADC, 0.05], fem ? [0.205, 0.19, 0.195] : [0.2, 0.18, 0.19], fur, 0.08);
  ell('ruff', 'head', [0, 1.58, 0.06], fem ? [0.225, 0.15, 0.18] : [0.245, 0.16, 0.19], fur, 0.1);
  if (!fem) ell('brow', 'head', [0, 1.715, 0.17], [0.15, 0.045, 0.07], F.panda ? fur : dk, 0.05);
  const sz = fem ? 0.33 : 0.39, nz = fem ? 0.39 : 0.452;
  cone('snout', 'head', [0, 1.63, 0.16], [0, 1.598, sz], 0.105, 0.072, F.muzzle, 0.06);
  ell('jaw', 'head', [0, 1.545, fem ? 0.23 : 0.26], [0.08, 0.05, 0.1], F.muzzle, 0.06);
  ell('nose', 'head', [0, 1.618, nz], [0.056, 0.038, 0.034], 0x1c1614, 0.02, 0.012);
  for (const [s, e] of [[-1, 'earL'], [1, 'earR']]) ell('ear', e, [s * (fem ? 0.155 : 0.15), 1.8, 0.03], fem ? [0.088, 0.085, 0.045] : [0.075, 0.072, 0.045], ear, 0.03);
  for (const [s, a, f, h] of [[-1, 'armL', 'foreL', 'handL'], [1, 'armR', 'foreR', 'handR']]) {
    cone('uarm', a, [s * 0.3 * W, 1.38, 0], [s * 0.4, 1.08, 0.02], 0.125 * L, 0.1 * L, limb, 0.1);
    cone('farm', f, [s * 0.4, 1.08, 0.02], [s * 0.44, 0.86, 0.05], 0.1 * L, 0.09 * L, limb, 0.05);
    ell('paw', h, [s * 0.45, 0.77, 0.07], [0.1 * L, 0.11 * L, 0.095 * L], paw, 0.06);
  }
  for (const [s, t, sh, ft] of [[-1, 'thighL', 'shinL', 'footL'], [1, 'thighR', 'shinR', 'footR']]) {
    cone('thigh', t, [s * 0.15, 0.84, 0], [s * 0.16, 0.46, 0.03], 0.165 * L, 0.125 * L, limb, 0.1);
    cone('shin', sh, [s * 0.16, 0.46, 0.03], [s * 0.16, 0.15, 0], 0.125 * L, 0.105 * L, limb, 0.05);
    ell('foot', ft, [s * 0.16, 0.075, 0.08], [0.115 * L, 0.078, 0.185 * L], paw, 0.05);
  }
  ell('tail', 'tail', [0, 0.9, -0.28], [0.065, 0.065, 0.06], fur, 0.04);
  // 涂装：浅色口鼻、胸腹、深色眼窝、耳内、爪垫，熊猫黑眼圈与肩带，黑熊胸前月牙；黑鼻头最后涂
  const paints = [];
  const paint = (c, r, col, soft = 0.03, a = 1) => paints.push({ c, r, col, soft, a });
  paint([0, 1.58, fem ? 0.29 : 0.33], [0.12, 0.1, 0.18], F.muzzle, 0.05);
  paint([0, 1.535, 0.25], [0.08, 0.05, 0.08], mixc(F.muzzle, 0xffffff, 0.2), 0.03);
  if (!F.panda) paint([0, 1.66, 0.28], [0.05, 0.03, 0.1], mixc(fur, F.muzzle, 0.4), 0.03, 0.6);
  paint([0, 1.06, 0.26], [0.2 * W, 0.24, 0.12], F.belly, 0.06, 0.7);
  for (const s of [-1, 1]) {
    if (F.panda) paint([s * 0.08, 1.662, 0.2], [0.065, 0.05, 0.06], dk, 0.02);
    else paint([s * 0.075, 1.665, 0.2], [0.05, 0.035, 0.04], dk, 0.03, 0.6);
    paint([s * 0.15, 1.8, 0.07], [0.04, 0.045, 0.02], fem ? 0xf0a0a8 : mixc(F.muzzle, 0x3a2418, 0.5), 0.015);
    paint([s * 0.16, 0.0, 0.1], [0.1, 0.03, 0.16], 0x2a1c14, 0.02);
    paint([s * 0.45, 0.72, 0.15], [0.065, 0.06, 0.03], 0x3a2418, 0.02);
    if (fem) paint([s * 0.14, 1.585, 0.2], [0.05, 0.03, 0.03], 0xff8a98, 0.03, 0.55);
  }
  if (F.panda) paint([0, 1.36, -0.02], [0.42, 0.1, 0.32], dk, 0.04);
  if (F.chest) paint([0, 1.3, 0.25], [0.16, 0.045, 0.08], 0xf0e8d8, 0.02);
  paint([0, 1.572, nz - 0.04], [0.004, 0.028, 0.02], 0x2a1a14, 0.008);
  paint([0, 1.548, nz - 0.08], [0.06, 0.007, 0.05], 0x2a1a14, 0.01, 0.7);
  paint([0, 1.62, nz - 0.002], [0.062, 0.044, 0.05], 0x1c1614, 0.01);
  return { prims: P, paints };
}
const BMIN = [-0.62, -0.03, -0.46], BMAX = [0.62, 1.95, 0.5];

// ---------------------------------------------------------------- 衣物：身体外扩的一层皮
function garments(cls, fem, O, prims) {
  const by = (n) => prims.filter((p) => p.name === n);
  const inflate = (p, t, t2 = t) => (p.t === 'ell' ? Object.assign({}, p, { r: p.r.map((v) => v + t), k: 0.05 }) : Object.assign({}, p, { r1: p.r1 + t, r2: p.r2 + t2, k: 0.05 }));
  const field = (set, t) => unionField(set.map((p) => inflate(p, t)));
  const clipY = (f, lo, hi) => (x, y, z) => Math.max(f(x, y, z), lo - y, y - hi);
  const plane = (p, fr) => {
    const a = p.a, b = p.b, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz);
    const px = a[0] + dx * fr, py = a[1] + dy * fr, pz = a[2] + dz * fr;
    return (x, y, z) => ((x - px) * dx + (y - py) * dy + (z - pz) * dz) / l;
  };
  const union = (fs) => (x, y, z) => { let d = 1e9; for (const f of fs) d = Math.min(d, f(x, y, z)); return d; };
  const flare = (top, r1, hem, r2) => { const q = { t: 'cone', a: [0, top, 0.03], b: [0, hem, 0.03], r1, r2 }; return (x, y, z) => Math.max(sdPrim(x, y, z, q), hem - y, y - top - 0.05); };
  const torso = [...by('pelvis'), ...by('belly'), ...by('chest'), ...by('hump')];
  const farms = by('farm');
  const sleeves = (tu, tf, fr) => [...by('uarm').map((p) => { const q = inflate(p, tu, tu + 0.005); return (x, y, z) => sdPrim(x, y, z, q); }),
    ...farms.map((p) => { const q = inflate(p, tf, tf); const cl = plane(p, fr); return (x, y, z) => Math.max(sdPrim(x, y, z, q), cl(x, y, z)); })];
  // 前臂上 [lo,hi] 区段（袖口 / 挽袖）
  const onFarm = (x, y, lo, hi) => { for (const p of farms) { const t = ((x - p.a[0]) * (p.b[0] - p.a[0]) + (y - p.a[1]) * (p.b[1] - p.a[1])) / ((p.b[0] - p.a[0]) ** 2 + (p.b[1] - p.a[1]) ** 2); if (t > lo && t < hi && Math.abs(x) > 0.34) return true; } return false; };
  const JB = [-0.68, 0.4, -0.46], JT = [0.68, 1.62, 0.5];
  const pants = (col, lo = 0.2) => ({ field: clipY(field([...by('pelvis'), ...by('thigh'), ...by('shin')], 0.035), lo, 0.97), bmin: [-0.45, 0.1, -0.36], bmax: [0.45, 1.02, 0.4], noise: 0.08, color: (x, y, z) => (y > 0.9 ? (Math.abs(x) < 0.05 && z > 0 ? 0xb8b8b0 : LEATHER) : y < lo + 0.06 ? darken(col, 0.25) : y > 0.4 && y < 0.54 && z > 0.05 ? darken(col, 0.18) : col) });
  const boots = (col) => ({ field: clipY(field([...by('foot'), ...by('shin')], 0.03), -0.02, 0.34), bmin: [-0.34, -0.05, -0.2], bmax: [0.34, 0.4, 0.34], noise: 0.06, color: (x, y) => (y < 0.035 ? 0x1a1410 : y > 0.29 ? darken(col, 0.3) : col) });
  const out = [];
  if (cls === 'knight') {
    // 绗缝内衬（到大腿中部）+ 胸甲（前后片）+ 皮裤 + 铁靴
    const hem = fem ? 0.46 : 0.62;
    const gam = union([clipY(field(torso, 0.032), hem, 1.47), ...sleeves(0.035, 0.04, 0.8), ...(fem ? [flare(0.95, 0.31, hem, 0.44)] : [clipY(field(by('pelvis'), 0.06), hem, 0.95)])]);
    out.push({
      field: gam, bmin: JB, bmax: JT, noise: 0.03, skirt: fem,
      color: (x, y, z) => {
        if (onFarm(x, y, 0.66, 0.82) || y < hem + 0.04 || y > 1.43) return O.trim;
        if (Math.abs(y - 0.92) < 0.03) return Math.abs(x) < 0.05 && z > 0 ? O.trim : LEATHER;
        const q = Math.abs(((y * 12) % 1) - 0.5);
        return q < 0.08 ? darken(O.main, 0.22) : O.main;
      },
    });
    const plate = clipY(field([...by('chest'), ...by('hump')], 0.062), 1.02, 1.44);
    out.push({ field: plate, bmin: [-0.5, 0.96, -0.4], bmax: [0.5, 1.52, 0.44], noise: 0, mat: 'metal', color: (x, y, z) => (Math.abs(x) < 0.02 && z > 0 ? 0xeef4fa : y < 1.06 || y > 1.4 ? STEEL_D : Math.abs(x) > 0.3 ? 0x9aa4ae : 0xb8c2cc) });
    out.push(pants(fem ? darken(O.dark, 0.2) : 0x4a3a2e));
    out.push({ field: clipY(field([...by('foot'), ...by('shin')], 0.035), -0.02, 0.3), bmin: [-0.34, -0.05, -0.2], bmax: [0.34, 0.36, 0.34], noise: 0, mat: 'metal', color: (x, y) => (y < 0.03 ? 0x3a3a40 : y > 0.26 ? STEEL_D : STEEL) });
  } else if (cls === 'ranger') {
    // 米色背心 + 敞怀连帽皮夹克（挽袖）+ 工装裤 + 皮靴；母熊加短裙
    out.push({ field: clipY(field([...by('belly'), ...by('chest')], 0.018), 0.9, 1.44), color: (x, y) => (y > 1.41 ? 0xb8ac90 : 0xcbbfa4), bmin: [-0.45, 0.85, -0.35], bmax: [0.45, 1.5, 0.45], noise: 0.04 });
    const jb = field(torso, 0.05);
    const hood = unionField([{ t: 'ell', c: [0, 1.5, -0.14], r: [0.24, 0.12, 0.15], k: 0.06 }, { t: 'cone', a: [-0.2, 1.45, 0.02], b: [0.2, 1.45, 0.02], r1: 0.08, r2: 0.08, k: 0.08 }]);
    const body = (x, y, z) => { let d = Math.max(jb(x, y, z), 0.84 - y, y - 1.5); const open = Math.abs(x) - (0.11 + (1.45 - y) * 0.12); if (z > 0.05) d = Math.max(d, -open); return d; };
    const collar = (x, y, z) => (z > 0.12 && Math.abs(x) < 0.1 ? 1 : Math.max(hood(x, y, z), 1.36 - y));
    out.push({
      field: union([body, collar, ...sleeves(0.04, 0.05, 0.45)]), bmin: JB, bmax: JT, noise: 0.07,
      color: (x, y, z) => (onFarm(x, y, 0.2, 0.5) ? mixc(O.dark, 0xffffff, 0.15) : y < 0.9 || (z > 0.1 && Math.abs(x) < 0.2) ? darken(O.dark, 0.25) : y > 1.4 && z < 0 ? mixc(O.dark, 0xffffff, 0.12) : O.dark),
    });
    out.push(pants(0x5a4a3a, 0.3));
    out.push(boots(0x5a3a24));
    if (fem) out.push({ skirt: true, field: flare(0.92, 0.3, 0.6, 0.4), bmin: [-0.5, 0.55, -0.46], bmax: [0.5, 1.0, 0.5], noise: 0.04, color: (x, y) => (y < 0.63 ? O.trim : O.main) });
  } else if (cls === 'mage') {
    // 长袍（喇叭袖）+ 披肩领 + 下摆和门襟的纹边
    const sl = [...by('uarm').map((p) => inflate(p, 0.03, 0.045)), ...farms.map((p) => inflate(p, 0.045, 0.085))].map((q) => (x, y, z) => sdPrim(x, y, z, q));
    const robe = union([clipY(field(torso, 0.034), 0.5, 1.45), flare(0.95, 0.32, 0.06, fem ? 0.44 : 0.48), ...sl]);
    out.push({
      field: robe, bmin: [-0.72, 0.0, -0.52], bmax: [0.72, 1.55, 0.56], noise: 0.03, skirt: true,
      color: (x, y, z) => {
        if (y < 0.13 || (y > 0.13 && y < 0.17)) return O.trim;
        if (Math.abs(x) < 0.035 && z > 0 && y < 0.9) return O.trim;
        if (onFarm(x, y, 0.85, 1.2)) return O.trim;
        if (Math.abs(y - 0.9) < 0.028) return 0xc8a060;
        return y < 0.5 ? darken(O.main, 0.1) : O.main;
      },
    });
    const mantle = clipY(field([...by('chest'), ...by('hump')], 0.075), 1.24, 1.5);
    out.push({ field: mantle, bmin: [-0.55, 1.15, -0.42], bmax: [0.55, 1.58, 0.44], noise: 0.04, color: (x, y) => (y < 1.29 ? O.trim : O.dark) });
  } else {
    // 狂战士：皮裙 + 毛皮披肩（带毛发）+ 母熊胸围
    out.push({ skirt: true, field: flare(0.95, 0.32, fem ? 0.5 : 0.54, 0.39), bmin: [-0.52, 0.45, -0.46], bmax: [0.52, 1.02, 0.5], noise: 0.12, color: (x, y, z) => (Math.abs(y - 0.92) < 0.03 ? (Math.abs(x) < 0.05 && z > 0 ? 0xd8d0c0 : LEATHER_D) : y < (fem ? 0.56 : 0.6) ? 0x5a3e24 : Math.sin(Math.atan2(z, x) * 9) > 0.7 ? 0x6a4a2e : 0x7a5a3a) });
    out.push({ field: clipY(field([...by('chest'), ...by('hump')], 0.05), 1.26, 1.48), bmin: [-0.55, 1.18, -0.42], bmax: [0.55, 1.56, 0.44], noise: 0.15, color: () => 0x9a7a52, mat: 'fur' });
    if (fem) out.push({ field: clipY(field(by('chest'), 0.03), 1.1, 1.28), bmin: [-0.45, 1.05, -0.35], bmax: [0.45, 1.33, 0.4], noise: 0.06, color: () => 0x6a4a2a });
    out.push(boots(0x4a3424));
  }
  return out;
}

const TPL = new Map();
let CELL = 0.028, SHELLS = 5;
export function setBearQuality(q) { CELL = q === 'low' ? 0.038 : q === 'mid' ? 0.032 : 0.028; SHELLS = q === 'low' ? 0 : q === 'mid' ? 3 : 5; }
function bearTemplate(cfg, F, O) {
  const fem = cfg.gender === 'female';
  const key = [cfg.cls, fem ? 'f' : 'm', cfg.fur, cfg.outfit, CELL].join('|');
  if (TPL.has(key)) return TPL.get(key);
  const { prims, paints } = bearPrims(fem, F);
  const field = unionField(prims);
  const gs = garments(cfg.cls || 'knight', fem, O, prims);
  // 裙摆 / 长袍以髋骨为主、腿只带一点，避免被腿扯变形
  const skirtW = (x, y) => {
    if (y > 0.9) return null;
    if (Math.abs(x) > 0.34 && y > 0.66) return null;
    const a = Math.min(0.3, Math.max(0, (0.9 - y) * 0.6));
    const side = x < 0 ? BI.thighL : BI.thighR;
    return Math.abs(x) < 0.03 ? [[BI.hips, 1 - a], [BI.thighL, a / 2], [BI.thighR, a / 2]] : [[BI.hips, 1 - a], [side, a]];
  };
  const clothF = (x, y, z) => { let d = 1e9; for (const g of gs) d = Math.min(d, g.field(x, y, z)); return d; };
  const allF = (x, y, z) => Math.min(field(x, y, z), clothF(x, y, z));
  const nose = prims.find((p) => p.name === 'nose'), snout = prims.find((p) => p.name === 'snout');
  const furFn = (x, y, z) => {
    if (gs.length && clothF(x, y, z) < 0.015) return 0;
    if (sdPrim(x, y, z, nose) < 0.015 || y < 0.03) return 0;
    if (sdPrim(x, y, z, snout) < 0.01) return 0.35;
    if (y > 1.72 && Math.abs(Math.abs(x) - 0.15) < 0.05 && z > 0.05) return 0.2;
    if (y > 1.45 && Math.abs(x) > 0.16 && z < 0.2) return 1.3;
    return 1;
  };
  const body = buildSurface({ field, bmin: BMIN, bmax: BMAX, cell: CELL, weightPrims: prims, paints, boneCount: BONES.length, aoField: allF, furFn });
  const cloth = gs.map((g) => ({ mat: g.mat || 'cloth', tpl: buildSurface({ field: g.field, bmin: g.bmin || BMIN, bmax: g.bmax || BMAX, cell: CELL * 1.08, weightPrims: prims, boneCount: BONES.length, color: g.color, noise: g.noise === undefined ? 0.02 : g.noise, weightFn: g.skirt ? skirtW : undefined, aoField: allF }) }));
  const t = { prims, field, body, cloth, allF };
  TPL.set(key, t);
  return t;
}

// 生成熊熊英雄
export function makeBearHero(cfg = DEFAULT_HERO) {
  const F = FURS[cfg.fur] || FURS[0];
  const O = OUTFITS[cfg.outfit] || OUTFITS[0];
  const acc = (ACCESSORIES[cfg.acc] || ACCESSORIES[0]).id;
  const cls = cfg.cls || 'knight';
  const fem = cfg.gender === 'female';
  const hair = (HAIRS[fem ? 'female' : 'male'][cfg.hair || 0] || HAIRS.male[0]).id;
  const wood = 0x6a4424;
  const hairC = F.panda ? F.dark : darken(F.fur, 0.3);
  const tpl = bearTemplate(cfg, F, O);
  const root = new THREE.Group();
  const spin = new THREE.Group(); spin.position.y = 0.8; root.add(spin);
  const off0 = new THREE.Group(); off0.position.y = -0.8; spin.add(off0);
  const pivot = new THREE.Group();
  off0.add(pivot);
  const bones = BONES.map(([name]) => { const b = new THREE.Object3D(); b.name = name; return b; });
  BONES.forEach(([, par, x, y, z], i) => {
    const b = bones[i];
    if (par < 0) { b.position.set(x, y, z); pivot.add(b); }
    else { const P = BONES[par]; b.position.set(x - P[2], y - P[3], z - P[4]); bones[par].add(b); }
    b.userData.bind = b.position.clone();
  });
  const B = {}; BONES.forEach(([n], i) => { B[n] = bones[i]; });
  const rig = new SkinnedRig(bones, BONES.map((b) => [b[2], b[3], b[4]]), pivot);
  const bodyMesh = rig.addSurface(tpl.body, charMat('fur'));
  for (const sm of shellMats(SHELLS)) rig.addLayer(bodyMesh, sm);
  for (const c of tpl.cloth) {
    const m = rig.addSurface(c.tpl, charMat(c.mat));
    if (c.mat === 'fur') for (const sm of shellMats(Math.min(3, SHELLS))) rig.addLayer(m, sm);
  }
  const attach = (boneName, obj, wx, wy, wz) => { const b = BONES[BI[boneName]]; obj.position.set(wx - b[2], wy - b[3], wz - b[4]); B[boneName].add(obj); return obj; };
  // 沿方向投射到身体 / 衣服表面，让硬物贴合
  const surf = (o, d) => { const l = Math.hypot(d[0], d[1], d[2]); return surfaceAlong(tpl.allF, o, d.map((v) => v / l), 0.8); };
  const rigid = (build, bone, x, y, z, mat) => {
    const b = new Builder(); build(b);
    const m = b.mesh(true, mat || rigidMat()); m.receiveShadow = false;
    const g = new THREE.Group(); g.add(m);
    return attach(bone, g, x, y, z);
  };
  const clothM = () => charMat('cloth');

  // ---- 眼睛：公熊小而深（琥珀色虹膜），母熊大眼睛 + 睫毛
  const eyes = [];
  for (const s of [-1, 1]) {
    const pt = surfaceAlong(tpl.field, [s * 0.05, 1.672, 0.08], [s * 0.3, 0.02, 0.95]);
    const eg = new THREE.Group();
    const b = new Builder();
    if (fem) b.add(Geo.sph(14, 10), 0xffffff, 0, 0, -0.004, 0.066, 0.07, 0.03);
    b.add(Geo.sph(14, 10), 0x2a1a12, 0, 0, 0, 0.06, 0.052, 0.035);
    b.add(Geo.sph(14, 10), F.iris || 0x8a5220, 0, 0, 0.008, 0.044, 0.044, 0.024);
    b.add(Geo.sph(12, 8), mixc(F.iris || 0x8a5220, 0xffc060, 0.35), 0, -0.008, 0.012, 0.03, 0.026, 0.02);
    b.add(Geo.sph(12, 8), 0x080404, 0, 0, 0.016, 0.024, 0.026, 0.02);
    b.add(Geo.sph(8, 6), 0xffffff, 0.01, 0.012, 0.024, 0.012, 0.012, 0.006);
    if (fem) for (let k = 0; k < 3; k++) b.add(Geo.cone(4), 0x1a0e0a, s * (0.028 + k * 0.012), 0.03 - k * 0.006, 0.01, 0.008, 0.035, 0.008, 0, 0, s * (-0.9 - k * 0.3));
    eg.add(b.mesh(false, eyeMat()));
    eg.rotation.y = s * 0.3;
    eg.scale.setScalar(fem ? 1.38 : 1.2);
    attach('head', eg, pt[0], pt[1], pt[2] - 0.012);
    eyes.push(eg);
  }
  // ---- 嘴（吻部下方的一道 ω）
  {
    const mp = surfaceAlong(tpl.field, [0, 1.548, 0.18], [0, -0.05, 1]);
    rigid((b) => { for (const s of [-1, 1]) b.add(Geo.arc(0.08), 0x3a2418, s * 0.024, 0.006, 0, 0.05, 0.03, 0.03, 0, 0, Math.PI); }, 'head', 0, mp[1] + 0.005, mp[2] - 0.01, eyeMat());
  }
  // ---- 熊爪（铁靴 / 皮靴盖住脚爪）
  const booted = cls === 'knight' || cls === 'ranger' || cls === 'berserker';
  for (const [s, h, f] of [[-1, 'handL', 'footL'], [1, 'handR', 'footR']]) {
    rigid((b) => { for (let k = -1.5; k <= 1.5; k++) b.add(Geo.cone(6), 0x2a2420, k * 0.03, 0, 0, 0.022, 0.07, 0.02, 2.0, 0, 0); }, h, s * 0.45, 0.675, 0.13, eyeMat());
    if (!booted) rigid((b) => { for (let k = -1.5; k <= 1.5; k++) b.add(Geo.cone(6), 0x2a2420, k * 0.045, 0, 0, 0.026, 0.075, 0.024, Math.PI / 2 + 0.3, 0, 0); }, f, s * 0.16, 0.035, 0.27, eyeMat());
  }
  // ---- 披风 / 挂件（二级摆动，由 animateBear 驱动）
  const capeA = new THREE.Group(), capeB = new THREE.Group(); capeA.add(capeB);
  let capeLen = 0;
  // ---- 职业配件
  const buckle = (col = 0xc8c8c0) => rigid((b) => { b.add(Geo.box(), col, 0, 0, 0, 0.1, 0.07, 0.02); b.add(Geo.box(), darken(col, 0.4), 0, 0, 0.008, 0.06, 0.035, 0.012); }, 'hips', 0, 0.92, surf([0, 0.92, 0.05], [0, 0, 1])[2] + 0.004);
  const pouch = (s, col) => { const p = surf([s * 0.1, 0.9, 0.05], [s * 0.72, 0, 0.7]); rigid((b) => { b.add(Geo.box(), col, 0, 0, 0, 0.13, 0.15, 0.08); b.add(Geo.box(), darken(col, 0.35), 0, 0.05, 0.02, 0.135, 0.06, 0.07); b.add(Geo.sph(6, 4), 0x9a9a90, 0, 0.03, 0.045, 0.018, 0.018, 0.01); }, 'hips', p[0] + s * 0.035, p[1], p[2] + 0.035, clothM()).rotation.y = s * 0.8; };
  if (cls === 'knight') {
    for (const [s, a, fo, sh] of [[-1, 'armL', 'foreL', 'shinL'], [1, 'armR', 'foreR', 'shinR']]) {
      // 分层护肩
      rigid((b) => { b.add(Geo.hemi(), STEEL, 0, 0, 0, 0.36, 0.22, 0.34, 0, 0, s * -0.35); b.add(Geo.hemi(), STEEL_D, s * 0.03, -0.06, 0, 0.33, 0.16, 0.31, 0, 0, s * -0.55); b.add(Geo.torus(0.12), O.trim, 0, 0.005, 0, 0.3, 0.3, 0.3, Math.PI / 2, 0, 0); }, a, s * 0.32, 1.43, -0.01);
      // 护臂
      rigid((b) => { b.add(Geo.cyl(14, 1.12), STEEL_D, 0, 0, 0, 0.23, 0.16, 0.23); b.add(Geo.torus(0.15), STEEL, 0, 0.07, 0, 0.23, 0.23, 0.23, Math.PI / 2, 0, 0); }, fo, s * 0.425, 0.93, 0.04);
      // 护膝
      rigid((b) => { b.add(Geo.sph(10, 8), STEEL, 0, 0, 0, 0.17, 0.13, 0.1); b.add(Geo.cone(6), STEEL_D, 0, 0, 0.06, 0.06, 0.08, 0.06, Math.PI / 2, 0, 0); }, sh, s * 0.16, 0.47, surf([s * 0.16, 0.47, 0.03], [0, 0, 1])[2] - 0.02);
    }
    buckle(O.trim);
    // 胸甲上的纹章
    const cp = surf([0, 1.27, 0.05], [0, 0, 1]);
    rigid((b) => { b.add(Geo.cyl(16), O.trim, 0, 0, 0, 0.13, 0.02, 0.13, Math.PI / 2, 0, 0); b.add(Geo.box(), O.main, 0, 0, 0.012, 0.03, 0.09, 0.01); b.add(Geo.box(), O.main, 0, 0.015, 0.012, 0.08, 0.025, 0.01); }, 'chest', 0, cp[1], cp[2] + 0.006);
    // 背后的披风
    capeLen = fem ? 0.78 : 0.86;
  } else if (cls === 'ranger') {
    buckle(); pouch(-1, LEATHER); pouch(1, LEATHER);
    // 胸前背带
    rigid((b) => { b.add(Geo.box(), LEATHER_D, 0, 0, 0, 0.055, 0.62, 0.03, -0.22, 0, 0.85); }, 'chest', 0.02, 1.2, surf([0.02, 1.2, 0.05], [0, 0, 1])[2] + 0.012);
    // 箭袋
    rigid((b) => {
      b.add(Geo.cyl(12), LEATHER, 0, 0, 0, 0.16, 0.52, 0.16);
      b.add(Geo.torus(0.2), LEATHER_D, 0, 0.22, 0, 0.17, 0.17, 0.17, Math.PI / 2, 0, 0);
      b.add(Geo.torus(0.2), LEATHER_D, 0, -0.18, 0, 0.17, 0.17, 0.17, Math.PI / 2, 0, 0);
      for (let k = 0; k < 4; k++) { b.add(Geo.box(), 0xe8e0d0, (k - 1.5) * 0.035, 0.32, 0, 0.018, 0.16, 0.018); b.add(Geo.cone(4), [0xd8303a, 0xffffff][k % 2], (k - 1.5) * 0.035, 0.41, 0, 0.045, 0.07, 0.012); }
    }, 'chest', 0.12, 1.3, -0.36, clothM()).rotation.set(0.25, 0, -0.4);
    for (const [s, fo] of [[-1, 'foreL'], [1, 'foreR']]) rigid((b) => { b.add(Geo.cyl(12, 1.1), LEATHER, 0, 0, 0, 0.23, 0.15, 0.23); for (let k = 0; k < 2; k++) b.add(Geo.torus(0.2), LEATHER_D, 0, -0.04 + k * 0.08, 0, 0.235, 0.235, 0.235, Math.PI / 2, 0, 0); }, fo, s * 0.43, 0.92, 0.045, clothM());
    // 腰间小刀
    rigid((b) => { b.add(Geo.box(), LEATHER_D, 0, 0, 0, 0.04, 0.2, 0.06); b.add(Geo.cyl(6), 0x5a3a24, 0, 0.14, 0, 0.03, 0.08, 0.03); }, 'hips', surf([-0.1, 0.84, -0.05], [-1, 0, -0.3])[0] - 0.03, 0.82, -0.02, clothM());
  } else if (cls === 'mage') {
    // 绳腰带 + 流苏、挂在腰上的书与药瓶
    const bp = surf([0, 0.9, 0.05], [0, 0, 1]);
    rigid((b) => { b.add(Geo.torus(0.1, 28), 0xc8a060, 0, 0, 0, 0.72, 0.62, 0.66, Math.PI / 2, 0, 0); b.add(Geo.sph(6, 4), 0xc8a060, 0.06, -0.02, 0.32, 0.05, 0.05, 0.05); for (const x of [0.04, 0.08]) b.add(Geo.cyl(4), 0xc8a060, x, -0.1, 0.32, 0.015, 0.16, 0.015); }, 'hips', 0, 0.9, bp[2] - 0.33, clothM());
    const hp = surf([0.1, 0.84, 0.0], [1, 0, 0.3]);
    rigid((b) => { b.add(Geo.box(), 0x6a3a2a, 0, 0, 0, 0.05, 0.2, 0.16); b.add(Geo.box(), 0xf0e6c8, 0.004, 0, 0, 0.046, 0.18, 0.14); b.add(Geo.box(), O.trim, 0.027, 0, 0, 0.005, 0.06, 0.06); }, 'hips', hp[0] + 0.03, 0.82, hp[2], clothM()).rotation.y = 0.2;
    const vp = surf([-0.1, 0.84, 0.0], [-1, 0, 0.3]);
    rigid((b) => { b.add(Geo.sph(10, 8), 0x9a3ae0, 0, 0, 0, 0.09, 0.1, 0.09); b.add(Geo.cyl(6), 0xd8d8e0, 0, 0.07, 0, 0.03, 0.05, 0.03); b.add(Geo.cyl(6), 0x8a5a2a, 0, 0.1, 0, 0.035, 0.025, 0.035); }, 'hips', vp[0] - 0.05, 0.8, vp[2], rigidMat());
  } else if (cls === 'berserker') {
    for (const [s, a] of [[-1, 'armL'], [1, 'armR']]) rigid((b) => { b.add(Geo.torus(0.22), LEATHER, 0, 0, 0, 0.26, 0.26, 0.26, Math.PI / 2, 0, 0); b.add(Geo.torus(0.12), 0xb8a060, 0, 0.04, 0, 0.27, 0.27, 0.27, Math.PI / 2, 0, 0); }, a, s * 0.35, 1.2, 0.01, clothM());
    // 交叉皮带 + 骷髅扣
    for (const s of [-1, 1]) rigid((b) => { b.add(Geo.box(), LEATHER_D, 0, 0, 0, 0.06, 0.66, 0.03, -0.2, 0, s * 0.78); b.add(Geo.sph(6, 4), 0xb8b8b0, 0, 0.18, 0.02, 0.025, 0.025, 0.015); b.add(Geo.sph(6, 4), 0xb8b8b0, 0, -0.18, 0.02, 0.025, 0.025, 0.015); }, 'chest', 0, 1.12, surf([0, 1.12, 0.05], [0, 0, 1])[2] + 0.014, clothM());
    const sk = surf([0, 1.12, 0.05], [0, 0, 1]);
    rigid((b) => { b.add(Geo.sph(10, 8), 0xefe8d8, 0, 0, 0, 0.1, 0.09, 0.07); b.add(Geo.box(), 0xefe8d8, 0, -0.05, 0, 0.06, 0.04, 0.05); for (const x of [-1, 1]) b.add(Geo.sph(6, 4), 0x1a1010, x * 0.022, 0.005, 0.03, 0.025, 0.025, 0.02); }, 'chest', 0, sk[1], sk[2] + 0.03, rigidMat());
    // 缠着布条的前臂
    for (const [s, fo] of [[-1, 'foreL'], [1, 'foreR']]) rigid((b) => { for (let k = 0; k < 4; k++) b.add(Geo.torus(0.25), 0xd8ccb0, 0, -0.06 + k * 0.045, 0, 0.215, 0.215, 0.215, Math.PI / 2, 0, k * 0.4); }, fo, s * 0.43, 0.94, 0.045, clothM());
    // 战纹
    for (const s of [-1, 1]) { const p = surf([s * 0.1, 1.66, 0.1], [s * 0.5, 0, 0.87]); rigid((b) => { b.add(Geo.box(), 0xc8303a, 0, 0, 0, 0.07, 0.012, 0.012, 0, 0, 0.3); b.add(Geo.box(), 0xc8303a, 0, -0.022, 0, 0.07, 0.012, 0.012, 0, 0, 0.3); }, 'head', p[0], p[1] - 0.02, p[2] + 0.004, clothM()).rotation.y = s * 0.5; }
  }
  if (capeLen) {
    // 披风：挂在肩后，两节，行走 / 奔跑时向后飘
    const bk = surf([0, 1.44, -0.05], [0, 0, -1]);
    attach('chest', capeA, 0, 1.44, bk[2] - 0.035);
    const cb = new Builder();
    cb.add(Geo.box(), O.dark, 0, -capeLen * 0.25, 0, 0.62, capeLen * 0.5, 0.03);
    cb.add(Geo.torus(0.2), O.trim, 0, 0.02, 0.02, 0.3, 0.12, 0.2);
    capeA.add(cb.mesh(true, clothM()));
    capeB.position.y = -capeLen * 0.5;
    const cb2 = new Builder();
    cb2.add(Geo.box(), O.dark, 0, -capeLen * 0.24, 0, 0.66, capeLen * 0.48, 0.03);
    cb2.add(Geo.box(), O.trim, 0, -capeLen * 0.47, 0.001, 0.66, 0.04, 0.032);
    capeB.add(cb2.mesh(true, clothM()));
  }
  if (acc === 'scarf') {
    const sc = O.trim === 0xffffff ? 0xd8303a : O.trim;
    rigid((b) => { b.add(Geo.torus(0.28), sc, 0, 0, 0, 0.44, 0.44, 0.4, Math.PI / 2, 0, 0); b.add(cap(0.05, 0.22), sc, 0.12, -0.16, 0.2, 1, 1, 0.6, 0.2, 0, 0.2); }, 'neck', 0, 1.42, 0.05, clothM());
  }

  // ---- 发型 / 头饰（以旧头部半径 0.36 为单位建模，再缩放到头骨）
  let hb = new Builder();
  const covered = acc === 'default';
  const tuft = (x, y, z, sx, sy, rx, rz, c = hairC) => hb.add(Geo.cone(6), c, x, y, z, sx, sy, sx, rx, 0, rz);
  switch (hair) {
    case 'tuft': if (!covered) for (let k = -1; k <= 1; k++) tuft(k * 0.06, 0.34, 0.06, 0.08, 0.16, 0.3, -k * 0.5); break;
    case 'mane':
      for (let k = 0; k < 16; k++) { const a = (k / 15) * Math.PI * 1.5 - Math.PI * 0.75; tuft(Math.sin(a) * 0.4, Math.cos(a) * 0.33 - 0.12, -0.08, 0.17, 0.3, -0.25, -a * 1.1, k % 2 ? darken(F.fur, 0.35) : darken(F.fur, 0.5)); }
      for (let k = 0; k < 5; k++) hb.add(Ss(), darken(F.fur, 0.35), (k - 2) * 0.12, -0.34 - Math.abs(k - 2) * -0.03, 0.1 - Math.abs(k - 2) * 0.04, 0.16, 0.14, 0.14);
      break;
    case 'mohawk': if (!covered) for (let k = 0; k < 5; k++) tuft(0, 0.3 + Math.sin(k / 4 * Math.PI) * 0.04, 0.2 - k * 0.1, 0.08, 0.22, -0.3 - k * 0.35, 0, O.trim === 0xffffff ? 0xd8303a : O.trim); break;
    case 'beard':
      for (let k = 0; k < 7; k++) { const a = (k / 6 - 0.5) * 2.2; hb.add(Ss(), hairC, Math.sin(a) * 0.22, -0.26 - Math.cos(a) * 0.06, 0.22 + Math.cos(a) * 0.1, 0.14, 0.14, 0.12); }
      for (const x of [-1, 1]) tuft(x * 0.36, -0.12, 0.04, 0.09, 0.16, 0, x * 2.3);
      break;
    case 'bangs':
      if (!covered) for (let k = 0; k < 7; k++) { const u = (k - 3) / 3; hb.add(Geo.cone(8), k % 2 ? hairC : darken(hairC, 0.12), u * 0.24, 0.24 - Math.abs(u) * 0.05, 0.27 - Math.abs(u) * 0.08, 0.11, 0.2 - Math.abs(u) * 0.05, 0.08, Math.PI - 0.45, 0, u * 0.35); }
      break;
    case 'ponytail':
      hb.add(Ss(), O.trim, 0, 0.18, -0.3, 0.1, 0.1, 0.08);
      for (let k = 0; k < 4; k++) hb.add(Ss(), hairC, 0, 0.12 - k * 0.1, -0.36 - k * 0.04, 0.17 - k * 0.02, 0.16, 0.15);
      break;
    case 'buns': if (!covered) for (const x of [-1, 1]) { hb.add(S(), hairC, x * 0.2, 0.3, -0.06, 0.2, 0.2, 0.2); hb.add(Geo.torus(0.2), O.trim, x * 0.2, 0.24, -0.06, 0.18, 0.18, 0.18, Math.PI / 2, 0, 0); } break;
    case 'braids':
      for (const x of [-1, 1]) {
        for (let k = 0; k < 4; k++) hb.add(Ss(), hairC, x * (0.32 + k * 0.01), -0.12 - k * 0.1, -0.08, 0.12, 0.12, 0.11);
        hb.add(Ss(), O.trim, x * 0.34, -0.5, -0.08, 0.08, 0.06, 0.08);
      }
      break;
    default: break;
  }
  const hairB = hb.empty ? null : hb;
  hb = new Builder();
  const hat = (id) => {
    switch (id) {
      case 'knight':
        // 带护鼻与翎羽的骑士盔
        hb.add(Geo.hemi(), STEEL, 0, 0.12, -0.02, 0.8, 0.58, 0.74);
        hb.add(Geo.torus(0.08), STEEL_D, 0, 0.13, -0.02, 0.4, 0.37, 0.41, Math.PI / 2, 0, 0);
        hb.add(Geo.box(), STEEL_D, 0, 0.36, 0.06, 0.05, 0.28, 0.5, 0.5, 0, 0);
        hb.add(Geo.box(), STEEL, 0, 0.08, 0.38, 0.06, 0.24, 0.05, 0.15, 0, 0);
        hb.add(cap(0.07, 0.3), O.main, 0, 0.48, -0.14, 1, 1, 1.4, -1.1, 0, 0);
        hb.add(cap(0.05, 0.24), O.trim, 0, 0.52, -0.1, 1, 1, 1.2, -1.2, 0, 0);
        break;
      case 'ranger':
        hb.add(Geo.hemi(), O.dark, 0, 0.06, -0.08, 0.82, 0.7, 0.78, -0.45, 0, 0);
        hb.add(Geo.cone(10), O.dark, 0, 0.24, -0.36, 0.36, 0.46, 0.3, -1.3, 0, 0);
        hb.add(Geo.torus(0.1), darken(O.dark, 0.2), 0, 0.0, 0.05, 0.66, 0.7, 0.64, 0.35, 0, 0);
        hb.add(Geo.cone(4), 0xe8e0d0, 0.2, 0.3, -0.1, 0.05, 0.3, 0.02, 0, 0, -0.5);
        break;
      case 'mage':
        hb.add(Geo.cyl(20), O.main, 0, 0.24, 0, 1.08, 0.04, 1.08);
        hb.add(Geo.cone(16), O.main, 0, 0.6, -0.08, 0.52, 0.74, 0.52, -0.25, 0, 0);
        hb.add(Geo.cone(10), O.main, 0, 0.98, -0.28, 0.2, 0.3, 0.2, -0.9, 0, 0);
        hb.add(Geo.cyl(16), O.trim, 0, 0.28, 0, 0.55, 0.07, 0.55);
        hb.add(Geo.oct(), O.trim, 0.12, 0.46, 0.2, 0.08, 0.1, 0.04);
        break;
      case 'berserker':
        hb.add(Geo.hemi(), 0x7a7066, 0, 0.14, -0.02, 0.8, 0.5, 0.72);
        hb.add(Geo.torus(0.08), 0x5a5048, 0, 0.15, -0.02, 0.41, 0.37, 0.39, Math.PI / 2, 0, 0);
        for (const x of [-1, 1]) { hb.add(Geo.cone(10), 0xf0e8d0, x * 0.42, 0.34, 0, 0.13, 0.48, 0.13, 0, 0, x * -0.9); hb.add(Geo.torus(0.2), 0x5a5048, x * 0.33, 0.24, 0, 0.1, 0.1, 0.1, 0, Math.PI / 2, x * -0.9); }
        break;
      case 'crown':
        hb.add(Geo.cyl(16), 0xffcf4a, 0, 0.31, 0, 0.36, 0.1, 0.36);
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; hb.add(Geo.cone(4), 0xffcf4a, Math.sin(a) * 0.15, 0.41, Math.cos(a) * 0.15, 0.07, 0.14, 0.07); }
        hb.add(Geo.oct(), 0xd8303a, 0, 0.33, 0.18, 0.06, 0.07, 0.04);
        break;
      case 'flower': {
        const cols = [0xff7aa0, 0xffffff, 0xffd84a, 0xb08aff];
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; hb.add(Ss(), cols[k % 4], Math.sin(a) * 0.3, 0.25, Math.cos(a) * 0.28 - 0.02, 0.12, 0.08, 0.12); }
        break;
      }
      case 'bow': {
        const bc = O.trim === 0xffffff ? 0xff6a8a : O.trim;
        for (const x of [-1, 1]) hb.add(S(), bc, x * 0.1 + 0.22, 0.32, 0.02, 0.16, 0.12, 0.07, 0, 0, x * 0.5);
        hb.add(Ss(), bc, 0.22, 0.32, 0.03, 0.07, 0.07, 0.07);
        break;
      }
      case 'eyepatch':
        hb.add(Ss(), 0x141414, 0.14, 0.02, 0.34, 0.14, 0.14, 0.04);
        hb.add(Geo.torus(0.05), 0x141414, 0, 0.08, 0, 0.7, 0.7, 0.64, 1.4, 0, 0.3);
        break;
      case 'glasses':
        for (const x of [-1, 1]) hb.add(Geo.torus(0.12), 0x3a2a1a, x * 0.14, 0.02, 0.35, 0.2, 0.2, 0.2);
        hb.add(Geo.box(), 0x3a2a1a, 0, 0.03, 0.36, 0.08, 0.02, 0.02);
        break;
      default: break;
    }
  };
  if (acc === 'default') hat(cls);
  else hat(acc);
  const hatGroup = (bld, sc, z, outlined) => {
    if (!bld || bld.empty) return;
    const hm = bld.mesh(true, outlined ? rigidMat() : charMat('cloth')); hm.receiveShadow = false;
    const hg = new THREE.Group(); hg.add(hm); hg.scale.setScalar(sc);
    attach('head', hg, 0, HEADC, z);
  };
  hatGroup(hairB, 0.6, 0.05, false);
  hatGroup(hb, 0.6, 0.04, true);

  // ---- 武器（右手）与副手：按熊掌比例缩小
  const hand = new THREE.Group(); hand.position.set(0, -0.07, 0.03); hand.scale.setScalar(0.62); B.handR.add(hand);
  const off = new THREE.Group(); off.position.set(0, -0.07, 0.03); off.scale.setScalar(0.66); B.handL.add(off);
  const wb = new Builder();
  let tipZ = 1.1, tipY = 0;
  let orb = null;
  if (cls === 'knight') {
    wb.add(Geo.cyl(8), wood, 0, 0, 0.08, 0.07, 0.24, 0.07, Math.PI / 2, 0, 0);
    wb.add(Geo.sph(8, 6), O.trim, 0, 0, -0.05, 0.09, 0.09, 0.09);
    wb.add(cap(0.035, 0.28), O.trim, 0, 0, 0.22, 1, 1, 1, 0, 0, Math.PI / 2);
    wb.add(Geo.box(), 0xe8eef4, 0, 0, 0.72, 0.1, 0.035, 0.9);
    wb.add(Geo.box(), 0xb8c4d0, 0, 0, 0.72, 0.02, 0.04, 0.84);
    wb.add(Geo.cone(4), 0xe8eef4, 0, 0, 1.22, 0.1, 0.16, 0.035, Math.PI / 2, 0, 0);
    const sb = new Builder();
    sb.add(Geo.cyl(24), O.main, 0, 0, 0, 0.58, 0.08, 0.58, Math.PI / 2, 0, 0);
    sb.add(Geo.torus(0.12), STEEL, 0, 0, 0, 0.58, 0.58, 0.44);
    sb.add(Geo.box(), O.trim, 0, 0, 0.045, 0.08, 0.44, 0.02);
    sb.add(Geo.box(), O.trim, 0, 0.04, 0.045, 0.34, 0.08, 0.02);
    sb.add(Geo.sph(14, 10), STEEL, 0, 0, 0.04, 0.14, 0.14, 0.08);
    const shield = part(sb, -0.1, 0.02, 0.04);
    shield.scale.setScalar(0.8);
    shield.rotation.y = -1.0;
    off.add(shield);
  } else if (cls === 'ranger') {
    const bb = new Builder();
    bb.add(Geo.arc(0.08), wood, 0, 0, 0.0, 1.0, 1.1, 1.0, 0, -Math.PI / 2, -Math.PI / 2);
    bb.add(Geo.box(), 0xdddddd, 0, 0, 0.0, 0.01, 0.98, 0.01);
    bb.add(cap(0.05, 0.1), LEATHER, 0, 0, 0.18, 1, 1, 1);
    const bow = part(bb, 0, 0.05, 0.1);
    bow.scale.setScalar(0.8);
    off.add(bow);
    wb.add(Geo.box(), 0xe8e0d0, 0, 0, 0.3, 0.03, 0.03, 0.6);
    tipZ = 0.7;
  } else if (cls === 'mage') {
    wb.add(Geo.cyl(10), wood, 0, 0.25, 0.1, 0.07, 1.5, 0.07);
    for (let k = 0; k < 3; k++) wb.add(Geo.torus(0.2), 0xc8a060, 0, -0.1 + k * 0.3, 0.1, 0.09, 0.09, 0.09, Math.PI / 2, 0, 0);
    wb.add(Geo.torus(0.2), O.trim, 0, 1.02, 0.1, 0.24, 0.24, 0.24);
    wb.add(Geo.torus(0.12), O.trim, 0, 1.02, 0.1, 0.2, 0.2, 0.2, 0, Math.PI / 2, 0);
    tipZ = 0.1; tipY = 1.05;
    orb = new THREE.Mesh(Geo.sph(14, 10), matGlow(O.trim === 0xffffff ? 0x9fe8ff : O.trim));
    orb.scale.setScalar(0.16);
    orb.position.set(0, 1.05, 0.1);
  } else {
    wb.add(Geo.cyl(10), wood, 0, 0, 0.35, 0.08, 1.2, 0.08, Math.PI / 2, 0, 0);
    for (let k = 0; k < 3; k++) wb.add(Geo.torus(0.2), LEATHER_D, 0, 0, -0.05 + k * 0.08, 0.1, 0.1, 0.1);
    wb.add(Geo.box(), STEEL, 0.18, 0, 0.86, 0.44, 0.06, 0.4);
    wb.add(Geo.box(), STEEL, -0.14, 0, 0.86, 0.24, 0.06, 0.3);
    wb.add(Geo.box(), 0xeef2f6, 0.4, 0, 0.86, 0.04, 0.07, 0.44);
    wb.add(Geo.sph(8, 6), STEEL_D, 0.02, 0, 0.86, 0.1, 0.1, 0.1);
    tipZ = 1.0;
  }
  const weapon = part(wb);
  if (orb) { weapon.add(orb); const g = glowSprite(orb.material.color.getHex(), 0.9, 0.9); g.position.copy(orb.position); weapon.add(g); }
  hand.add(weapon);
  const tip = new THREE.Object3D();
  tip.position.set(0, tipY, tipZ);
  weapon.add(tip);
  for (const g of [weapon, off]) g.traverse((o) => { if (o.isMesh && o.material === matChar()) o.material = rigidMat(); });
  const scale = fem ? 0.92 : 1.02;
  off0.scale.setScalar(scale);
  const r = {
    root, spin, pivot, rig, B, eyes, torso: B.spine, chest: B.chest, head: B.head, hips: B.hips,
    legL: B.thighL, legR: B.thighR, kneeL: B.shinL, kneeR: B.shinR, footL: B.footL, footR: B.footR,
    armL: B.armL, armR: B.armR, elbowL: B.foreL, elbowR: B.foreR, hand, off, weapon, tip, orb, cls, fem, height: 1.8 * scale,
    capeA: capeLen ? capeA : null, capeB: capeLen ? capeB : null,
    st: { mv: 0, ph: 0, look: 2, lx: 0, ly: 0, hx: 0, hy: 0, blink: 2, flick: 3, earL: 0, earR: 0, ht: 0 },
    arm: B.armR, cape: B.spine,
  };
  animateBear(r, 0, false, 1, 0);
  return r;
}

// ---------------------------------------------------------------- 程序化动画
// 走路：重心左右转移、髋部起伏与扭转、上身反向扭转、屈膝抬脚、脚掌贴地、手臂反向摆动；
// 待机：呼吸、重心缓慢摇摆、东张西望、眨眼、耳朵抖动、尾巴摆动；走 / 停之间平滑过渡；披风随动作飘动
const lerp = (a, b, k) => a + (b - a) * k;
export function animateBear(r, t, moving, speed = 1, dt = 1 / 60) {
  if (!r.B) return;
  const st = r.st, B = r.B;
  st.mv = lerp(st.mv, moving ? 1 : 0, Math.min(1, dt * 7));
  if (moving) st.ph += dt * 8.2 * Math.max(0.6, speed);
  st.ht += dt;
  const m = st.mv, im = 1 - m, T = st.ht;
  const s = Math.sin(st.ph), c = Math.cos(st.ph), s2 = Math.sin(st.ph * 2);
  const br = Math.sin(T * 2.0);
  const sway = Math.sin(T * 0.55);
  st.look -= dt;
  if (st.look <= 0) { st.look = 1.6 + Math.random() * 3; st.lx = (Math.random() - 0.5) * 0.35; st.ly = (Math.random() - 0.5) * 1.1; }
  st.hx = lerp(st.hx, st.lx * im, Math.min(1, dt * 2.5));
  st.hy = lerp(st.hy, st.ly * im, Math.min(1, dt * 2.5));
  const hb = B.hips.userData.bind;
  B.hips.position.set(hb.x + m * s * 0.035 + im * sway * 0.015, hb.y + m * ((1 - Math.cos(st.ph * 2)) * 0.022 - 0.03) + im * (br * 0.004 - 0.012), hb.z);
  B.hips.rotation.set(m * 0.06, m * s * 0.14, m * s * 0.07 + im * sway * 0.025);
  B.spine.rotation.set(m * 0.12 + im * br * 0.018, -m * s * 0.1, -B.hips.rotation.z * 0.6);
  B.chest.rotation.set(im * br * 0.02 - m * 0.04, -m * s * 0.12, -B.hips.rotation.z * 0.3);
  B.neck.rotation.set(-m * 0.05 + st.hx * 0.4, st.hy * 0.4, 0);
  B.head.rotation.set(-m * 0.04 + st.hx * 0.6 + m * s2 * 0.03, st.hy * 0.6 + m * s * 0.08, -B.hips.rotation.z * 0.7 + im * Math.sin(T * 0.8) * 0.04);
  const legs = [[B.thighL, B.shinL, B.footL, -s, c], [B.thighR, B.shinR, B.footR, s, -c]];
  for (const [th, sh, ft, ss, cc] of legs) {
    const tx = m * ss * 0.62 - im * 0.04;
    const kn = m * (Math.max(0, cc) * 0.95 + 0.08) + im * 0.08;
    th.rotation.set(tx, 0, 0);
    sh.rotation.set(kn, 0, 0);
    ft.rotation.set(-(tx + kn) * 0.85 + m * Math.max(0, -cc) * ss * 0.3, 0, 0);
  }
  const arms = [[B.armL, B.foreL, s, -1], [B.armR, B.foreR, -s, 1]];
  for (const [ua, fa, ss, side] of arms) {
    if (side > 0 && r.lockR) continue;
    ua.rotation.set(m * ss * 0.5 + im * br * 0.02, 0, side * (0.14 + im * 0.03 + m * 0.05));
    fa.rotation.set(-(0.28 + m * Math.max(0, -ss) * 0.55 + im * br * 0.03), 0, 0);
  }
  st.flick -= dt;
  if (st.flick <= 0) { st.flick = 2 + Math.random() * 4; st[Math.random() < 0.5 ? 'earL' : 'earR'] = 1; }
  st.earL = Math.max(0, st.earL - dt * 5); st.earR = Math.max(0, st.earR - dt * 5);
  B.earL.rotation.set(0, 0, Math.sin(st.earL * Math.PI * 3) * 0.35 * st.earL + m * s2 * 0.05);
  B.earR.rotation.set(0, 0, -Math.sin(st.earR * Math.PI * 3) * 0.35 * st.earR - m * s2 * 0.05);
  B.tail.rotation.set(0, Math.sin(T * 3) * 0.25 + m * s * 0.3, 0);
  st.blink -= dt;
  if (st.blink <= 0) st.blink = 2.2 + Math.random() * 3;
  const bl = st.blink < 0.12 ? Math.abs(st.blink - 0.06) / 0.06 : 1;
  for (const e of r.eyes) e.scale.set(e.scale.x, e.scale.x * Math.max(0.1, bl), e.scale.z);
  r.pivot.position.y = 0;
  if (r.orb) r.orb.scale.setScalar(0.16 + Math.sin(T * 5) * 0.02);
  // 披风：走得越快越往后飘，停下来轻轻晃
  if (r.capeA) {
    const k = Math.min(1, dt * 8);
    const wind = m * Math.min(1.2, speed);
    r.capeA.rotation.x = lerp(r.capeA.rotation.x, 0.14 + wind * 0.28 + Math.sin(T * 9) * 0.04 * wind + br * 0.02, k);
    r.capeB.rotation.x = lerp(r.capeB.rotation.x, 0.06 + wind * 0.22 + Math.sin(T * 9 - 1) * 0.08 * wind + Math.sin(T * 1.3) * 0.03, k);
    r.capeA.rotation.z = Math.sin(st.ph) * 0.06 * m;
  }
}

// 空中姿态：起跳收腿、下落伸腿张臂保持平衡
export function poseAir(r, vy, dt) {
  const up = vy > 1.5, down = vy < -1.5;
  const k = Math.min(1, dt * 12);
  const L = (o, ax, v) => { o.rotation[ax] += (v - o.rotation[ax]) * k; };
  L(r.legL, 'x', up ? -0.95 : down ? -0.3 : -0.6);
  L(r.legR, 'x', up ? -0.2 : down ? 0.2 : 0.05);
  L(r.kneeL, 'x', up ? 1.5 : down ? 0.35 : 0.9);
  L(r.kneeR, 'x', up ? 0.9 : down ? 0.25 : 0.6);
  if (r.footL) { L(r.footL, 'x', up ? -0.3 : 0.25); L(r.footR, 'x', up ? -0.2 : 0.3); }
  L(r.armL, 'x', up ? -2.1 : down ? -0.9 : -1.4);
  L(r.armL, 'z', up ? -0.25 : -0.85);
  L(r.elbowL, 'x', up ? -0.3 : -0.55);
  L(r.torso, 'x', up ? -0.1 : down ? 0.18 : 0.05);
  L(r.head, 'x', up ? -0.15 : down ? 0.2 : 0);
  if (r.hips) r.hips.position.y = r.hips.userData.bind.y;
  if (r.capeA) { L(r.capeA, 'x', down ? 1.1 : 0.4); L(r.capeB, 'x', down ? 0.5 : 0.25); }
}
// 落地屈膝缓冲
export function poseLand(r, k) {
  if (r.hips) r.hips.position.y = r.hips.userData.bind.y - k * 0.13;
  r.legL.rotation.x = Math.min(r.legL.rotation.x, -k * 0.6);
  r.legR.rotation.x = Math.min(r.legR.rotation.x, -k * 0.6);
  r.kneeL.rotation.x = Math.max(r.kneeL.rotation.x, k * 1.15);
  r.kneeR.rotation.x = Math.max(r.kneeR.rotation.x, k * 1.15);
  if (r.footL) { r.footL.rotation.x = -k * 0.55; r.footR.rotation.x = -k * 0.55; }
  r.torso.rotation.x += k * 0.25;
  r.head.rotation.x -= k * 0.1;
  r.armL.rotation.z = -0.1 - k * 0.5;
}

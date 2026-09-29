// 地牢氛围：让每个房间更有生气、更有层次
//  - 地面贴花（裂纹 / 苔藓 / 霜花 / 发光熔岩缝 / 魔法阵）
//  - 墙面挂饰（盾牌交叉剑、骷髅壁龛、蜡烛架、发光符文、冰棱、熔岩脉）
//  - 地面杂物（烛台群、兵器架、木箱桶堆、断柱、金币堆）
//  - 天光：从天花板裂缝照下的光柱 + 光里的浮尘；贴地流动的雾
//  - 小生物：乱窜会躲人的老鼠、萤火虫、蝴蝶、偶尔飞过的蝙蝠
import * as THREE from 'three';
import { Builder, Geo, matGlow } from './models.js';
import { platform } from './platform.js';
import { T } from './dungeon.js';
import { WH } from './level.js';
import { K } from './terrain.js';

const darken = (hex, k) => new THREE.Color(hex).multiplyScalar(1 - k).getHex();
const mk = (fn, shadow = true) => { const b = new Builder(); fn(b); return b.mesh(shadow); };

// ---------------------------------------------------------------- 贴花纹理
const _dec = {};
function decalTex(kind) {
  if (_dec[kind]) return _dec[kind];
  const c = platform.createCanvas(128, 128), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  const R = (() => { let s = kind.length * 977 + 13; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  if (kind === 'crack' || kind === 'lava') {
    ctx.lineCap = 'round';
    const col = kind === 'lava' ? 'rgba(255,140,40,0.95)' : 'rgba(10,8,12,0.75)';
    for (let n = 0; n < 3; n++) {
      let x = 64, y = 64, a = R() * 6.28;
      ctx.strokeStyle = col; ctx.lineWidth = kind === 'lava' ? 4 : 2.5;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) { a += (R() - 0.5) * 1.4; x += Math.cos(a) * 9; y += Math.sin(a) * 9; ctx.lineTo(x, y); if (R() < 0.3) { ctx.moveTo(x, y); } }
      ctx.stroke();
    }
    if (kind === 'lava') { const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60); g.addColorStop(0, 'rgba(255,120,30,0.35)'); g.addColorStop(1, 'rgba(255,60,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); }
  } else if (kind === 'moss' || kind === 'frost' || kind === 'stain') {
    for (let i = 0; i < 70; i++) {
      const x = 64 + (R() - 0.5) * 90, y = 64 + (R() - 0.5) * 90, r = 3 + R() * 12;
      const d = Math.hypot(x - 64, y - 64) / 60;
      const a = Math.max(0, 1 - d) * (0.3 + R() * 0.4);
      ctx.fillStyle = kind === 'moss' ? `rgba(${60 + R() * 40 | 0},${110 + R() * 60 | 0},${40 + R() * 20 | 0},${a})` : kind === 'frost' ? `rgba(220,240,255,${a})` : `rgba(20,14,10,${a * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  } else if (kind === 'rune') {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3;
    for (const r of [56, 44]) { ctx.beginPath(); ctx.arc(64, 64, r, 0, 7); ctx.stroke(); }
    ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); ctx.lineTo(64 + Math.cos(a + 2.09) * 44, 64 + Math.sin(a + 2.09) * 44); ctx.stroke(); }
    ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glyph = 'ᚠᚢᚦᚨᚱᚲᚷᚹ';
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.fillText(glyph[k], 64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50); }
  }
  const t = new THREE.CanvasTexture(c); t.userData.keep = true;
  _dec[kind] = t;
  return t;
}
let _soft = null;
function softTex() {
  if (_soft) return _soft;
  const c = platform.createCanvas(64, 64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  _soft = new THREE.CanvasTexture(c); _soft.userData.keep = true;
  return _soft;
}
const _decMat = {};
function decalMat(kind, add) {
  const k = kind + (add ? '+' : '');
  if (!_decMat[k]) {
    _decMat[k] = add
      ? new THREE.MeshBasicMaterial({ map: decalTex(kind), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 })
      : new THREE.MeshLambertMaterial({ map: decalTex(kind), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    _decMat[k].userData.shared = true;
  }
  return _decMat[k];
}

// ---------------------------------------------------------------- 模型
function candleCluster(seed) {
  const R = rngOf(seed);
  const g = new THREE.Group();
  const flames = [];
  g.add(mk((b) => {
    b.add(Geo.cyl(10), 0x3a3230, 0, 0.03, 0, 0.7, 0.06, 0.7);
    for (let i = 0; i < 5; i++) {
      const a = R() * 6.28, d = R() * 0.25, h = 0.15 + R() * 0.3;
      b.add(Geo.cyl(8), 0xf0e6cc, Math.cos(a) * d, h / 2 + 0.05, Math.sin(a) * d, 0.08, h, 0.08);
      b.add(Geo.sph(6, 4), 0xe8dcc0, Math.cos(a) * d + 0.03, h * 0.6, Math.sin(a) * d, 0.05, 0.12, 0.05);
      flames.push([Math.cos(a) * d, h + 0.1, Math.sin(a) * d]);
    }
  }));
  for (const [x, y, z] of flames) { const f = new THREE.Mesh(Geo.cone(6), matGlow(0xffc860)); f.scale.set(0.05, 0.1, 0.05); f.position.set(x, y, z); g.add(f); }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: 0xffb050, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  halo.scale.set(1.8, 1.8, 1); halo.position.y = 0.4; g.add(halo);
  g.userData.halo = halo;
  return g;
}
function weaponRack() {
  return mk((b) => {
    const w = 0x6a4424;
    b.add(Geo.box(), w, 0, 0.9, -0.1, 1.5, 0.1, 0.1); b.add(Geo.box(), w, 0, 0.35, -0.1, 1.5, 0.08, 0.08);
    for (const x of [-0.7, 0.7]) b.add(Geo.box(), w, x, 0.6, -0.1, 0.1, 1.2, 0.3);
    for (let i = 0; i < 3; i++) { const x = -0.45 + i * 0.45; b.add(Geo.box(), 0xc8d0d8, x, 0.95, 0, 0.06, 1.1, 0.02); b.add(Geo.box(), 0x8a6a30, x, 0.38, 0, 0.2, 0.05, 0.06); b.add(Geo.cyl(6), 0x5a3a24, x, 0.26, 0, 0.05, 0.2, 0.05); }
    b.add(Geo.cyl(6), w, 0.62, 0.9, 0.06, 0.05, 1.6, 0.05, 0.15, 0, 0);
    b.add(Geo.cone(4), 0xc8d0d8, 0.62, 1.72, 0.18, 0.08, 0.2, 0.04, 0.15, 0, 0);
  });
}
// 一个大木箱（站立高度 = 箱顶 0.95，看到多高就能站多高）+ 旁边一个矮桶
function crateStack(seed) {
  const R = rngOf(seed);
  return mk((b) => {
    const s = 1.5, ry = (R() - 0.5) * 0.3;
    b.add(Geo.box(), 0x9a6a3a, 0, 0.475, 0, s, 0.95, s, 0, ry, 0);
    for (const y of [0.05, 0.9]) b.add(Geo.box(), 0x6a4424, 0, y, 0, s * 1.02, 0.08, s * 1.02, 0, ry, 0);
    for (const d of [-1, 1]) b.add(Geo.box(), 0x6a4424, 0, 0.475, 0, s * 1.02, 0.1, s * 0.12, d * 0.62, ry, 0);
    b.add(Geo.box(), 0xb08050, 0, 0.955, 0, s * 0.92, 0.01, s * 0.92, 0, ry, 0);
  });
}
function brokenColumn(color, seed) {
  const R = rngOf(seed);
  return mk((b) => {
    b.add(Geo.box(), darken(color, 0.15), 0, 0.12, 0, 1.2, 0.24, 1.2);
    const h = 0.6 + R() * 0.9;
    b.add(Geo.cyl(12), color, 0, 0.24 + h / 2, 0, 0.8, h, 0.8, 0, 0, (R() - 0.5) * 0.08);
    b.add(Geo.dode(), darken(color, 0.1), 0, 0.24 + h, 0, 0.8, 0.3, 0.8, R(), R(), 0);
    for (let i = 0; i < 3; i++) b.add(Geo.dode(), color, (R() - 0.5) * 1.4, 0.12, (R() - 0.5) * 1.2, 0.3 + R() * 0.3, 0.2, 0.3, R(), R(), R());
    b.add(Geo.cyl(12), color, 0.9, 0.3, 0.2, 0.6, 0.6, 0.6, Math.PI / 2, 0.4, 0);
  });
}
function goldPile(seed) {
  const R = rngOf(seed);
  const g = new THREE.Group();
  g.add(mk((b) => {
    b.add(Geo.sph(12, 6), 0xd8a830, 0, 0, 0, 0.9, 0.35, 0.8);
    for (let i = 0; i < 22; i++) { const a = R() * 6.28, d = R() * 0.45; b.add(Geo.cyl(8), R() < 0.5 ? 0xffcf4a : 0xe8b030, Math.cos(a) * d, 0.1 + R() * 0.12, Math.sin(a) * d, 0.12, 0.025, 0.12, R() - 0.5, 0, R() - 0.5); }
    b.add(Geo.oct(), 0xd8303a, 0.15, 0.2, 0.1, 0.09, 0.11, 0.06);
    b.add(Geo.oct(), 0x3ad86a, -0.2, 0.18, -0.05, 0.08, 0.1, 0.06);
  }, false));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: 0xffd060, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
  s.scale.set(1.6, 1.6, 1); s.position.y = 0.2; g.add(s);
  return g;
}
function wallPiece(kind, th) {
  const g = new THREE.Group();
  if (kind === 'shield') {
    g.add(mk((b) => {
      for (const s of [-1, 1]) { b.add(Geo.box(), 0xc8d0d8, 0, 0, 0.05, 0.05, 1.3, 0.02, 0, 0, s * 0.7); b.add(Geo.box(), 0x8a6a30, s * 0.42, -0.45, 0.05, 0.2, 0.04, 0.05, 0, 0, s * 0.7); }
      b.add(Geo.cyl(20), [0xb8302a, 0x2f5fa8, 0x3a6a3a][Math.floor(Math.random() * 3)], 0, 0, 0.1, 0.7, 0.06, 0.7, Math.PI / 2, 0, 0);
      b.add(Geo.torus(0.12), 0xc8a040, 0, 0, 0.12, 0.7, 0.7, 0.4);
      b.add(Geo.sph(8, 6), 0xc8a040, 0, 0, 0.15, 0.16, 0.16, 0.08);
    }));
  } else if (kind === 'niche') {
    g.add(mk((b) => {
      b.add(Geo.box(), 0x1a1418, 0, 0, 0.02, 0.8, 0.9, 0.04);
      b.add(Geo.box(), 0x4a4450, 0, -0.47, 0.12, 0.9, 0.08, 0.25);
      b.add(Geo.sph(10, 8), 0xefe8d8, 0, -0.3, 0.12, 0.26, 0.24, 0.24);
      for (const x of [-1, 1]) b.add(Geo.sph(6, 4), 0x1a1010, x * 0.055, -0.28, 0.22, 0.07, 0.07, 0.05);
      b.add(Geo.cyl(8), 0xf0e6cc, 0.28, -0.35, 0.12, 0.07, 0.18, 0.07);
    }));
    const f = new THREE.Mesh(Geo.cone(6), matGlow(0xffc860)); f.scale.set(0.05, 0.1, 0.05); f.position.set(0.28, -0.2, 0.12); g.add(f);
    g.userData.flame = f;
  } else if (kind === 'runes') {
    const col = th.id === 'ice' ? 0x7fd8ff : th.id === 'moss' ? 0x6aff9a : 0xb08aff;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), decalMat('rune', true)); m.material = m.material.clone(); m.material.color.setHex(col); m.material.userData.shared = false;
    g.add(m); g.userData.glow = m;
  } else if (kind === 'veins') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), decalMat('lava', true)); g.add(m); g.userData.glow = m;
  } else if (kind === 'icewall') {
    g.add(mk((b) => { for (let i = 0; i < 6; i++) b.add(Geo.oct(), 0xbfe8ff, (i - 2.5) * 0.25, -0.2 - (i % 3) * 0.3, 0.12, 0.2, 0.5 + (i % 2) * 0.4, 0.14, 0, 0, (i - 2.5) * 0.1); }));
  } else if (kind === 'grate') {
    g.add(mk((b) => { b.add(Geo.box(), 0x1a1618, 0, 0, 0.02, 0.9, 0.7, 0.03); for (let i = 0; i < 5; i++) b.add(Geo.cyl(6), 0x4a4a50, -0.36 + i * 0.18, 0, 0.06, 0.05, 0.72, 0.05); b.add(Geo.box(), 0x4a4a50, 0, 0, 0.06, 0.92, 0.05, 0.05); }));
  }
  return g;
}
function ratModel() {
  const g = new THREE.Group();
  g.add(mk((b) => {
    b.add(Geo.sph(10, 8), 0x5a4e48, 0, 0.1, 0, 0.18, 0.15, 0.32);
    b.add(Geo.sph(8, 6), 0x6a5e58, 0, 0.12, 0.17, 0.12, 0.11, 0.16);
    b.add(Geo.cone(6), 0xd8a0a0, 0, 0.11, 0.27, 0.05, 0.08, 0.05, Math.PI / 2, 0, 0);
    for (const s of [-1, 1]) { b.add(Geo.sph(6, 4), 0xd8a0a0, s * 0.05, 0.19, 0.14, 0.06, 0.07, 0.02); b.add(Geo.sph(4, 3), 0x100808, s * 0.04, 0.15, 0.23, 0.025, 0.025, 0.02); }
    b.add(Geo.cyl(4), 0xc89090, 0, 0.07, -0.34, 0.02, 0.36, 0.02, Math.PI / 2 - 0.3, 0, 0);
  }, false));
  return g;
}
function flyerModel(kind) {
  const g = new THREE.Group();
  const col = kind === 'bat' ? 0x2a1e2a : [0xff9ad8, 0x9ad8ff, 0xffe06a][Math.floor(Math.random() * 3)];
  const body = new THREE.Mesh(Geo.sph(6, 4), new THREE.MeshLambertMaterial({ color: kind === 'bat' ? 0x2a1e2a : 0x2a1a1a }));
  body.scale.set(kind === 'bat' ? 0.14 : 0.04, kind === 'bat' ? 0.14 : 0.04, kind === 'bat' ? 0.2 : 0.1); g.add(body);
  const wm = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide, emissive: kind === 'bat' ? 0x000000 : new THREE.Color(col).multiplyScalar(0.3) });
  for (const s of [-1, 1]) { const w = new THREE.Mesh(Geo.sph(8, 4), wm); w.scale.set(kind === 'bat' ? 0.4 : 0.16, 0.01, kind === 'bat' ? 0.22 : 0.12); w.position.x = s * (kind === 'bat' ? 0.2 : 0.08); const p = new THREE.Group(); p.add(w); g.add(p); g.userData[s < 0 ? 'l' : 'r'] = p; }
  return g;
}
function rngOf(seed) { let s = (seed * 9301 + 49297) % 233280 || 1; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }

// ---------------------------------------------------------------- 管理器
export class Ambience {
  constructor(scene) {
    this.sc = scene;
    this.w = scene.world;
    this.th = scene.theme;
    this.rats = []; this.flyers = []; this.fogs = []; this.shafts = []; this.glows = []; this.candles = [];
    this.t = 0; this.batT = 6;
  }
  // 房间装饰（在 FloorScene.decorate 之后调用）
  enrichRoom(room) {
    const sc = this.sc, w = this.w, th = this.th, rng = sc.rng, reg = room.id;
    const g = w.groups[reg];
    const small = room.type === 'puzzle' || room.type === 'exit' || room.type === 'boss' || room.type === 'secret';
    const flatAt = (i, j) => sc.d.kind[j * sc.d.W + i] === K.FLOOR;
    const spot = (solid, h) => {
      for (let t = 0; t < 14; t++) {
        const i = rng.int(room.x, room.x + room.w - 1), j = rng.int(room.y, room.y + room.h - 1);
        if (!w.isFree(i, j) || !flatAt(i, j)) continue;
        if (solid) { w.setSolid(i, j, true, null, h || 0); w.reserve(i, j); }
        const c = w.center(i, j);
        return { i, j, x: c.x, z: c.z, y: w.groundAt(c.x, c.z) };
      }
      return null;
    };
    // ---- 地面贴花
    const decals = th.id === 'lava' ? ['lava', 'crack', 'stain'] : th.id === 'ice' ? ['frost', 'crack', 'frost'] : th.id === 'moss' ? ['moss', 'moss', 'crack'] : ['crack', 'stain', 'crack'];
    const nd = Math.min(7, Math.round(room.w * room.h / 9));
    for (let k = 0; k < nd; k++) {
      const i = rng.int(room.x, room.x + room.w - 1), j = rng.int(room.y, room.y + room.h - 1);
      if (w.isWall(i, j) || !flatAt(i, j)) continue;
      const kind = decals[k % decals.length];
      const c = w.center(i, j);
      const s = 1.2 + rng() * 1.8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2), decalMat(kind, kind === 'lava'));
      m.position.set(c.x + rng.range(-0.5, 0.5), w.groundAt(c.x, c.z) + 0.02, c.z + rng.range(-0.5, 0.5));
      m.rotation.y = rng() * 6; m.renderOrder = 1;
      g.add(m);
      if (kind === 'lava') this.glows.push({ m, ph: rng() * 6, base: 0.8 });
    }
    // 神殿 / 谜题 / 首领房：地上的发光魔法阵
    if (room.type === 'shrine' || room.type === 'puzzle' || room.type === 'boss') {
      const c = w.center(room.cx, room.y + (room.h >> 1));
      const s = room.type === 'boss' ? 6 : 3.2;
      const mat = decalMat('rune', true).clone(); mat.userData.shared = false;
      mat.color.setHex(room.type === 'boss' ? 0xff5a3a : th.id === 'moss' ? 0x6aff9a : th.id === 'ice' ? 0x7fd8ff : th.id === 'lava' ? 0xff8a30 : 0xb08aff);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2), mat);
      m.position.set(c.x, w.groundAt(c.x, c.z) + 0.025, c.z); m.renderOrder = 1;
      g.add(m);
      this.glows.push({ m, ph: rng() * 6, base: 0.55, spin: 0.15 });
    }
    // ---- 北墙挂饰
    const wallKinds = th.id === 'crypt' ? ['shield', 'niche', 'grate', 'niche'] : th.id === 'moss' ? ['runes', 'niche', 'grate'] : th.id === 'ice' ? ['icewall', 'runes', 'shield'] : ['veins', 'grate', 'niche', 'veins'];
    const nw = small ? 1 : 2;
    for (let k = 0; k < nw; k++) {
      const i = rng.int(room.x + 1, room.x + room.w - 2);
      if (!w.isWall(i, room.y - 1) || !flatAt(i, room.y)) continue;
      const kind = wallKinds[rng.int(0, wallKinds.length - 1)];
      const p = wallPiece(kind, th);
      p.position.set(i * T + 1 + rng.range(-0.3, 0.3), kind === 'veins' ? 1.3 : 1.7, room.y * T + 0.04);
      g.add(p);
      if (p.userData.glow) this.glows.push({ m: p.userData.glow, ph: rng() * 6, base: 0.7 });
      if (p.userData.flame) { this.candles.push({ f: p.userData.flame, ph: rng() * 6 }); w.addLight({ x: p.position.x, y: 1.6, z: p.position.z + 0.4, color: 0xffb04a, intensity: 2.5, range: 3.5, flicker: true, region: reg, priority: 0.4 }); }
    }
    // ---- 地面杂物
    if (!small) {
      if (th.id === 'crypt' || th.id === 'lava' || rng() < 0.5) {
        const s2 = spot(false);
        if (s2) { const cc = candleCluster(rng.int(1, 999)); cc.position.set(s2.x + rng.range(-0.5, 0.5), s2.y, s2.z + rng.range(-0.5, 0.5)); g.add(cc); this.candles.push({ halo: cc.userData.halo, ph: rng() * 6 }); w.addLight({ x: cc.position.x, y: s2.y + 0.8, z: cc.position.z, color: 0xffa040, intensity: 3.5, range: 4.5, flicker: true, region: reg, priority: 0.55 }); }
      }
      if ((room.type === 'monster' || room.type === 'arena' || room.type === 'empty') && rng() < 0.55) {
        const i = rng.int(room.x + 1, room.x + room.w - 2);
        if (w.isWall(i, room.y - 1) && w.isFree(i, room.y) && flatAt(i, room.y)) { const r = weaponRack(); r.position.set(i * T + 1, 0, room.y * T + 0.35); g.add(r); w.setSolid(i, room.y, true, null, 0); w.reserve(i, room.y); }
      }
      if (rng() < 0.6) { const s2 = spot(true, 0.95); if (s2) { const c = crateStack(rng.int(1, 999)); c.position.set(s2.x, s2.y, s2.z); g.add(c); } }
      if (th.id !== 'lava' && rng() < 0.45) { const s2 = spot(true, 0); if (s2) { const b = brokenColumn(th.id === 'ice' ? 0x9ab0c8 : th.id === 'moss' ? 0x7a8a6a : 0x8a8490, rng.int(1, 999)); b.position.set(s2.x, s2.y, s2.z); b.rotation.y = rng() * 6; g.add(b); } }
    }
    if (room.type === 'treasure' || (room.type === 'shrine' && rng() < 0.5)) { const s2 = spot(false); if (s2) { const gp = goldPile(rng.int(1, 999)); gp.position.set(s2.x, s2.y, s2.z); g.add(gp); } }
    // ---- 天光光柱（从天花板裂缝斜照下来）
    if (!small && rng() < 0.45 && th.id !== 'lava') {
      const s2 = spot(false);
      if (s2) {
        const col = th.id === 'ice' ? 0xbfe8ff : th.id === 'moss' ? 0xd8ffc0 : 0xfff0c8;
        const h = WH + 0.2;
        const geo = new THREE.CylinderGeometry(0.7, 1.4, h, 16, 1, true);
        const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(s2.x - 0.6, s2.y + h / 2, s2.z - 0.4); m.rotation.set(0.12, 0, 0.18);
        g.add(m);
        const pool = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
        pool.position.set(s2.x, s2.y + 0.03, s2.z); pool.renderOrder = 1; g.add(pool);
        this.shafts.push({ m, x: s2.x, z: s2.z, y: s2.y, r: reg, col, ph: rng() * 6 });
      }
    }
    // ---- 贴地雾
    if (th.id !== 'lava' && !small) {
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        const i = rng.int(room.x, room.x + room.w - 1), j = rng.int(room.y, room.y + room.h - 1);
        if (w.isWall(i, j)) continue;
        const c = w.center(i, j);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: th.id === 'ice' ? 0xd8ecff : th.id === 'moss' ? 0xa8d8a0 : 0x9a90a8, transparent: true, depthWrite: false, opacity: 0.08 }));
        const sz = 4 + rng() * 3;
        s.scale.set(sz, sz * 0.3, 1);
        s.position.set(c.x, w.groundAt(c.x, c.z) + 0.25, c.z);
        g.add(s);
        this.fogs.push({ s, x0: c.x, z0: c.z, ph: rng() * 6, room });
      }
    }
    // ---- 小生物
    if ((th.id === 'crypt' || th.id === 'lava' || th.id === 'moss') && !small && rng() < 0.7) {
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const s2 = spot(false); if (!s2) break;
        const m = ratModel(); m.position.set(s2.x, s2.y, s2.z); g.add(m);
        this.rats.push({ m, x: s2.x, z: s2.z, room, tx: s2.x, tz: s2.z, wait: rng() * 3, ph: 0 });
      }
    }
    if (th.id === 'moss' && !small) {
      for (let k = 0; k < 3; k++) {
        const s2 = spot(false); if (!s2) break;
        const m = flyerModel('butterfly'); g.add(m);
        this.flyers.push({ m, x: s2.x, z: s2.z, y: s2.y + 1, room, ph: rng() * 6, sp: 0.5 + rng() * 0.5 });
      }
    }
  }
  update(dt) {
    this.t += dt;
    const t = this.t, w = this.w, sc = this.sc, p = sc.player, fx = sc.fx;
    // 发光贴花呼吸、魔法阵缓慢旋转
    for (const G of this.glows) { G.m.material.opacity = G.base * (0.7 + 0.3 * Math.sin(t * 1.8 + G.ph)); if (G.spin) G.m.rotation.y += dt * G.spin; }
    for (const C of this.candles) { const f = 0.85 + Math.sin(t * 17 + C.ph) * 0.08 + Math.sin(t * 29 + C.ph * 2) * 0.07; if (C.halo) C.halo.material.opacity = 0.5 * f; if (C.f) C.f.scale.y = 0.1 * f; }
    // 光柱轻微明暗 + 浮尘
    for (const S of this.shafts) {
      S.m.material.opacity = 0.06 + Math.sin(t * 0.7 + S.ph) * 0.02;
      if (w.discovered[S.r] && Math.abs(S.x - p.x) < 12 && Math.abs(S.z - p.z) < 10 && Math.random() < dt * 5)
        fx.bright.spawn({ x: S.x + (Math.random() - 0.5) * 1.6, y: S.y + 0.3 + Math.random() * 3, z: S.z + (Math.random() - 0.5) * 1.6, vx: (Math.random() - 0.5) * 0.15, vy: -0.05, vz: (Math.random() - 0.5) * 0.15, life: 3, size: 0.03, color: S.col, spin: 0 });
    }
    // 雾缓慢漂移
    for (const F of this.fogs) { F.s.position.x = F.x0 + Math.sin(t * 0.15 + F.ph) * 1.2; F.s.position.z = F.z0 + Math.cos(t * 0.12 + F.ph) * 0.8; F.s.material.opacity = 0.07 + Math.sin(t * 0.3 + F.ph) * 0.03; }
    // 老鼠：在房间里乱窜，玩家靠近就逃
    for (const r of this.rats) {
      const room = r.room;
      const dxp = r.x - p.x, dzp = r.z - p.z, dp = Math.hypot(dxp, dzp);
      if (dp < 2.5 && r.wait > -1) { r.tx = r.x + dxp / (dp || 1) * 3; r.tz = r.z + dzp / (dp || 1) * 3; r.wait = -1; r.fast = true; }
      if (r.wait > 0) { r.wait -= dt; if (r.wait <= 0) { const c = w.center(sc.rng.int(room.x, room.x + room.w - 1), sc.rng.int(room.y, room.y + room.h - 1)); r.tx = c.x; r.tz = c.z; r.fast = false; } continue; }
      const dx = r.tx - r.x, dz = r.tz - r.z, d = Math.hypot(dx, dz);
      const sp = r.fast ? 4.5 : 2;
      if (d < 0.1) { r.wait = 0.5 + Math.random() * 2.5; continue; }
      const nx = r.x + dx / d * sp * dt, nz = r.z + dz / d * sp * dt;
      const ti = Math.floor(nx / T), tj = Math.floor(nz / T);
      if (ti < room.x || ti >= room.x + room.w || tj < room.y || tj >= room.y + room.h || w.blocked(ti, tj)) { r.wait = 0.3; continue; }
      r.x = nx; r.z = nz; r.ph += dt * 30;
      r.m.position.set(r.x, w.groundAt(r.x, r.z) + Math.abs(Math.sin(r.ph)) * 0.02, r.z);
      r.m.rotation.y = Math.atan2(dx, dz);
    }
    // 蝴蝶 / 萤火虫
    for (const f of this.flyers) {
      f.ph += dt * f.sp;
      f.m.position.set(f.x + Math.sin(f.ph * 0.7) * 1.4, f.y + Math.sin(f.ph * 2.1) * 0.3, f.z + Math.cos(f.ph * 0.5) * 1.1);
      f.m.rotation.y = f.ph * 0.7;
      const a = Math.sin(t * 20 + f.ph * 5) * 1.1; f.m.userData.l.rotation.z = a; f.m.userData.r.rotation.z = -a;
    }
    if (this.th.id === 'moss' && Math.random() < dt * 6) fx.bright.spawn({ x: p.x + (Math.random() - 0.5) * 18, y: 0.4 + Math.random() * 2, z: p.z + (Math.random() - 0.5) * 14, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.4, life: 3, size: 0.06, color: 0xd8ff6a, color2: 0x6aff9a, spin: 0 });
    // 偶尔一群蝙蝠从头顶飞过（地窖 / 熔岩）
    if (this.th.id === 'crypt' || this.th.id === 'lava') {
      this.batT -= dt;
      if (this.batT <= 0 && !this.bats) {
        this.batT = 12 + Math.random() * 14;
        const a = Math.random() * 6.28;
        this.bats = { x: p.x - Math.cos(a) * 16, z: p.z - Math.sin(a) * 12, vx: Math.cos(a) * 7, vz: Math.sin(a) * 5, t: 0, list: [] };
        for (let k = 0; k < 5; k++) { const m = flyerModel('bat'); sc.s3.add(m); this.bats.list.push({ m, ox: (Math.random() - 0.5) * 2, oz: (Math.random() - 0.5) * 2, oy: Math.random() * 0.8, ph: Math.random() * 6 }); }
        sc.game.audio.play('swing');
      }
      if (this.bats) {
        const B = this.bats; B.t += dt; B.x += B.vx * dt; B.z += B.vz * dt;
        for (const b of B.list) { b.m.position.set(B.x + b.ox, WH + 0.6 + b.oy + Math.sin(t * 6 + b.ph) * 0.2, B.z + b.oz); b.m.rotation.y = Math.atan2(B.vx, B.vz); const a = Math.sin(t * 22 + b.ph) * 0.9; b.m.userData.l.rotation.z = a; b.m.userData.r.rotation.z = -a; }
        if (B.t > 5) { for (const b of B.list) { sc.s3.remove(b.m); b.m.traverse((o) => { if (o.isMesh) o.material.dispose(); }); } this.bats = null; }
      }
    }
  }
}

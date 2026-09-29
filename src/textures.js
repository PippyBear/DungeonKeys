// 程序化纹理：地牢图集（石板地面 / 砖墙 / 墙顶 / 鹅卵石走廊）、光晕、符文
import * as THREE from 'three';
import { platform } from './platform.js';
import { makeRng } from './utils.js';

const Q = 256; // 每个图集格子的像素尺寸
export const ATLAS = { floor: 0, wall: 1, top: 2, corridor: 3 };
// 图集 UV 区域（留 3px 边距防止采样串色）
export function atlasUV(slot) {
  const pad = 3 / 512;
  const x = (slot % 2) * 0.5, y = Math.floor(slot / 2) * 0.5;
  // CanvasTexture flipY=true：画布上方对应 v=1
  return { u0: x + pad, u1: x + 0.5 - pad, v0: 1 - (y + 0.5) + pad, v1: 1 - y - pad };
}

function noise(ctx, x, y, w, h, rng, n, colors, maxS = 3) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const s = 1 + rng() * maxS;
    ctx.fillRect(x + rng() * w, y + rng() * h, s, s);
  }
}

function bevelRect(ctx, x, y, w, h, base, light, dark, bw = 3) {
  ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = light; ctx.fillRect(x, y, w, bw); ctx.fillRect(x, y, bw, h);
  ctx.fillStyle = dark; ctx.fillRect(x, y + h - bw, w, bw); ctx.fillRect(x + w - bw, y, bw, h);
}

function crack(ctx, x, y, rng, len) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = rng() * Math.PI * 2;
  for (let i = 0; i < len; i++) { a += (rng() - 0.5) * 1.2; x += Math.cos(a) * 6; y += Math.sin(a) * 6; ctx.lineTo(x, y); }
  ctx.strokeStyle = 'rgba(10,8,14,0.55)'; ctx.lineWidth = 1.3; ctx.stroke();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
  return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
}

const atlasCache = {};
// 按主题生成图集：返回 { map, emissive }（自发光图用于熔岩裂缝、冰晶纹等）
export function makeAtlas(theme) {
  const th = theme || { id: 'crypt', floor: '#5a5560', wall: '#56505e', wall2: '#5e5048', mortar: '#221e28', top: '#2c2832', corr: '#57525a', overlay: 'moss' };
  if (atlasCache[th.id]) return atlasCache[th.id];
  const cv = platform.createCanvas(512, 512);
  const ctx = cv.getContext('2d');
  const ev = platform.createCanvas(512, 512);
  const ex = ev.getContext('2d');
  ex.fillStyle = '#000'; ex.fillRect(0, 0, 512, 512);
  const rng = makeRng(7 + th.id.length * 13);
  const ov = th.overlay;
  const glowCrack = (x, y, len, col, w = 2) => {
    // 同时画在颜色图与自发光图上
    let a = rng() * Math.PI * 2, px = x, py = y;
    const pts = [[px, py]];
    for (let i = 0; i < len; i++) { a += (rng() - 0.5) * 1.3; px += Math.cos(a) * 7; py += Math.sin(a) * 7; pts.push([px, py]); }
    for (const c of [ctx, ex]) {
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
      for (const q of pts) c.lineTo(q[0], q[1]);
      c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.stroke();
    }
  };
  // ---- 0: 房间石板地面
  {
    const ox = 0, oy = 0;
    ctx.fillStyle = shade(th.mortar, 0.9); ctx.fillRect(ox, oy, Q, Q);
    const slabs = [[0, 0, 128, 128], [128, 0, 128, 128], [0, 128, 128, 128], [128, 128, 128, 128]];
    for (const [sx, sy, sw, sh] of slabs) {
      const t = 0.85 + rng() * 0.3;
      bevelRect(ctx, ox + sx + 3, oy + sy + 3, sw - 6, sh - 6, shade(th.floor, t), shade(th.floor, t * 1.25), shade(th.floor, t * 0.6), 4);
      noise(ctx, ox + sx + 6, oy + sy + 6, sw - 12, sh - 12, rng, 500, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.12)', 'rgba(90,80,100,0.2)'], 3);
      if (rng() < 0.7) crack(ctx, ox + sx + 20 + rng() * 80, oy + sy + 20 + rng() * 80, rng, 5 + rng() * 6);
      if (ov === 'moss' && rng() < 0.4) { ctx.fillStyle = 'rgba(70,110,60,0.25)'; for (let i = 0; i < 30; i++) ctx.fillRect(ox + sx + 6 + rng() * 20, oy + sy + sh - 20 + rng() * 12, 3, 3); }
      if (ov === 'mossHeavy') {
        for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(80,140,60,' + (0.25 + rng() * 0.3) + ')'; ctx.beginPath(); ctx.arc(ox + sx + rng() * sw, oy + sy + rng() * sh, 8 + rng() * 18, 0, Math.PI * 2); ctx.fill(); }
        for (let i = 0; i < 6; i++) { const x = ox + sx + rng() * sw, y = oy + sy + rng() * sh; ctx.fillStyle = '#8affc8'; ctx.fillRect(x, y, 2, 2); ex.fillStyle = 'rgba(80,255,180,0.9)'; ex.fillRect(x, y, 2, 2); }
      }
      if (ov === 'frost') {
        ctx.strokeStyle = 'rgba(230,245,255,0.55)'; ctx.lineWidth = 3; ctx.strokeRect(ox + sx + 5, oy + sy + 5, sw - 10, sh - 10);
        noise(ctx, ox + sx + 4, oy + sy + 4, sw - 8, sh - 8, rng, 120, ['rgba(255,255,255,0.35)', 'rgba(200,230,255,0.3)'], 2);
        if (rng() < 0.6) glowCrack(ox + sx + 20 + rng() * 80, oy + sy + 20 + rng() * 80, 6, 'rgba(140,220,255,0.7)', 1.5);
      }
      if (ov === 'lava' && rng() < 0.85) glowCrack(ox + sx + 10 + rng() * 100, oy + sy + 10 + rng() * 100, 8 + rng() * 8, '#ff7a1a', 2.5);
    }
  }
  // ---- 1: 砖墙
  {
    const ox = 256, oy = 0;
    ctx.fillStyle = th.mortar; ctx.fillRect(ox, oy, Q, Q);
    const rows = 6, rh = Q / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? -42 : 0;
      for (let bx = off; bx < Q; bx += 84) {
        const x0 = Math.max(0, bx), x1 = Math.min(Q, bx + 84);
        if (x1 - x0 < 6) continue;
        const t = 0.8 + rng() * 0.4;
        const col = rng() < 0.12 ? th.wall2 : th.wall;
        bevelRect(ctx, ox + x0 + 2, oy + r * rh + 2, x1 - x0 - 4, rh - 4, shade(col, t), shade(col, t * 1.3), shade(col, t * 0.55), 3);
        noise(ctx, ox + x0 + 4, oy + r * rh + 4, x1 - x0 - 8, rh - 8, rng, 70, ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.15)'], 2);
      }
    }
    for (let i = 0; i < 4; i++) crack(ctx, ox + rng() * Q, oy + rng() * Q, rng, 4);
    if (ov === 'moss' || ov === 'mossHeavy') {
      const g = ctx.createLinearGradient(0, oy + Q * (ov === 'mossHeavy' ? 0.45 : 0.75), 0, oy + Q);
      g.addColorStop(0, 'rgba(40,80,30,0)'); g.addColorStop(1, ov === 'mossHeavy' ? 'rgba(50,110,40,0.7)' : 'rgba(30,50,30,0.35)');
      ctx.fillStyle = g; ctx.fillRect(ox, oy, Q, Q);
      if (ov === 'mossHeavy') for (let i = 0; i < 8; i++) { ctx.strokeStyle = 'rgba(60,120,40,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); let x = ox + rng() * Q; ctx.moveTo(x, oy); for (let y = 0; y < Q * (0.3 + rng() * 0.5); y += 10) { x += (rng() - 0.5) * 8; ctx.lineTo(x, oy + y); } ctx.stroke(); }
    }
    if (ov === 'frost') {
      const g = ctx.createLinearGradient(0, oy, 0, oy + Q * 0.3);
      g.addColorStop(0, 'rgba(230,245,255,0.6)'); g.addColorStop(1, 'rgba(230,245,255,0)');
      ctx.fillStyle = g; ctx.fillRect(ox, oy, Q, Q * 0.3);
      for (let i = 0; i < 14; i++) { const x = ox + rng() * Q, l = 10 + rng() * 30; ctx.fillStyle = 'rgba(210,240,255,0.7)'; ctx.beginPath(); ctx.moveTo(x - 4, oy); ctx.lineTo(x + 4, oy); ctx.lineTo(x, oy + l); ctx.fill(); }
      for (let i = 0; i < 3; i++) glowCrack(ox + rng() * Q, oy + Q * 0.4 + rng() * Q * 0.5, 5, 'rgba(120,210,255,0.6)', 1.5);
    }
    if (ov === 'lava') {
      for (let i = 0; i < 5; i++) glowCrack(ox + rng() * Q, oy + Q * 0.5 + rng() * Q * 0.5, 6 + rng() * 6, '#ff6a10', 2);
      const g = ctx.createLinearGradient(0, oy + Q * 0.7, 0, oy + Q);
      g.addColorStop(0, 'rgba(255,90,20,0)'); g.addColorStop(1, 'rgba(255,90,20,0.25)');
      ex.fillStyle = g; ex.fillRect(ox, oy + Q * 0.7, Q, Q * 0.3);
    }
  }
  // ---- 2: 墙顶
  {
    const ox = 0, oy = 256;
    ctx.fillStyle = th.top; ctx.fillRect(ox, oy, Q, Q);
    noise(ctx, ox, oy, Q, Q, rng, 2500, [shade(th.top, 1.15), shade(th.top, 0.85), shade(th.top, 1.3)], 4);
    ctx.strokeStyle = shade(th.top, 1.6); ctx.lineWidth = 6; ctx.strokeRect(ox + 3, oy + 3, Q - 6, Q - 6);
    if (ov === 'frost') { ctx.fillStyle = 'rgba(235,248,255,0.55)'; ctx.fillRect(ox, oy, Q, Q); noise(ctx, ox, oy, Q, Q, rng, 600, ['#ffffff', '#d8ecff'], 3); }
    if (ov === 'mossHeavy') { ctx.fillStyle = 'rgba(60,110,40,0.5)'; ctx.fillRect(ox, oy, Q, Q); }
  }
  // ---- 3: 走廊鹅卵石
  {
    const ox = 256, oy = 256;
    ctx.fillStyle = shade(th.mortar, 0.8); ctx.fillRect(ox, oy, Q, Q);
    const n = 8, cs = Q / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = ox + i * cs + cs / 2 + (rng() - 0.5) * 6, cy = oy + j * cs + cs / 2 + (rng() - 0.5) * 6;
      const rx = cs * (0.38 + rng() * 0.1), ry = cs * (0.36 + rng() * 0.1);
      const t = 0.8 + rng() * 0.4;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(rx, ry);
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fillStyle = shade(th.corr, t); ctx.fill();
      ctx.beginPath(); ctx.arc(-0.2, -0.25, 0.6, 0, Math.PI * 2); ctx.fillStyle = ov === 'frost' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.07)'; ctx.fill();
      ctx.restore();
    }
    noise(ctx, ox, oy, Q, Q, rng, 800, ['rgba(0,0,0,0.2)', 'rgba(255,255,255,0.04)'], 2);
    if (ov === 'mossHeavy') for (let i = 0; i < 20; i++) { ctx.fillStyle = 'rgba(70,130,50,0.5)'; ctx.beginPath(); ctx.arc(ox + rng() * Q, oy + rng() * Q, 4 + rng() * 10, 0, Math.PI * 2); ctx.fill(); }
    if (ov === 'lava') for (let i = 0; i < 6; i++) glowCrack(ox + rng() * Q, oy + rng() * Q, 6, '#ff6a10', 2);
  }
  const map = new THREE.CanvasTexture(cv);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  map.userData.keep = true;
  const emissive = new THREE.CanvasTexture(ev);
  emissive.minFilter = THREE.LinearMipmapLinearFilter;
  emissive.userData.keep = true;
  const hasGlow = ov === 'lava' || ov === 'frost' || ov === 'mossHeavy';
  atlasCache[th.id] = { map, emissive: hasGlow ? emissive : null };
  return atlasCache[th.id];
}

let _glow = null;
export function glowTexture() {
  if (_glow) return _glow;
  const cv = platform.createCanvas(128, 128);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(cv);
  _glow.userData.keep = true;
  _glow.minFilter = THREE.LinearFilter;
  _glow.generateMipmaps = false;
  return _glow;
}

// 地面阴影斑（角色脚下的软阴影，补充实时阴影）
let _blob = null;
export function blobTexture() {
  if (_blob) return _blob;
  const cv = platform.createCanvas(64, 64);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _blob = new THREE.CanvasTexture(cv);
  _blob.userData.keep = true;
  _blob.minFilter = THREE.LinearFilter;
  _blob.generateMipmaps = false;
  return _blob;
}

// 符文图案
export const RUNE_COLORS = ['#ff5a4a', '#4ad8ff', '#7aff5a', '#ffd84a', '#d86aff'];
const runeCache = {};
export function runeTexture(idx) {
  if (runeCache[idx]) return runeCache[idx];
  const cv = platform.createCanvas(128, 128);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (idx % 5) {
    case 0: ctx.moveTo(64, 18); ctx.lineTo(64, 110); ctx.moveTo(64, 40); ctx.lineTo(98, 70); ctx.moveTo(64, 60); ctx.lineTo(30, 90); break;
    case 1: ctx.moveTo(30, 20); ctx.lineTo(98, 108); ctx.moveTo(98, 20); ctx.lineTo(30, 108); ctx.moveTo(40, 64); ctx.lineTo(88, 64); break;
    case 2: ctx.arc(64, 64, 38, 0.3, Math.PI * 2 - 0.3); ctx.moveTo(64, 26); ctx.lineTo(64, 102); break;
    case 3: ctx.moveTo(24, 100); ctx.lineTo(64, 20); ctx.lineTo(104, 100); ctx.closePath(); ctx.moveTo(64, 60); ctx.lineTo(64, 84); break;
    default: ctx.moveTo(30, 30); ctx.lineTo(98, 30); ctx.lineTo(30, 98); ctx.lineTo(98, 98); ctx.moveTo(64, 14); ctx.lineTo(64, 114); break;
  }
  ctx.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.userData.keep = true;
  runeCache[idx] = t;
  return t;
}

// 地毯 / 旗帜图案
export function patternTexture(kind) {
  const cv = platform.createCanvas(128, 256);
  const ctx = cv.getContext('2d');
  if (kind === 'banner') {
    ctx.fillStyle = '#6a1a22'; ctx.fillRect(0, 0, 128, 256);
    ctx.fillStyle = '#ffcf4a';
    ctx.fillRect(0, 0, 128, 10); ctx.fillRect(8, 0, 6, 256); ctx.fillRect(114, 0, 6, 256);
    ctx.beginPath(); ctx.arc(64, 100, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6a1a22'; ctx.beginPath(); ctx.moveTo(64, 78); ctx.lineTo(80, 112); ctx.lineTo(48, 112); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffcf4a'; ctx.beginPath(); ctx.moveTo(0, 256); ctx.lineTo(64, 200); ctx.lineTo(128, 256); ctx.fill();
  } else {
    ctx.fillStyle = '#5a1820'; ctx.fillRect(0, 0, 128, 256);
    ctx.strokeStyle = '#c9a45a'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 112, 240);
    ctx.lineWidth = 3; ctx.strokeRect(20, 20, 88, 216);
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(64, 40 + i * 50); ctx.lineTo(84, 60 + i * 50); ctx.lineTo(64, 80 + i * 50); ctx.lineTo(44, 60 + i * 50); ctx.closePath(); ctx.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

// 蛛网
let _web = null;
export function webTexture() {
  if (_web) return _web;
  const cv = platform.createCanvas(128, 128);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(230,230,240,0.7)';
  ctx.lineWidth = 1.5;
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); ctx.stroke(); }
  for (let r = 18; r < 128; r += 18) {
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; const rr = r * (0.9 + (k % 2) * 0.1); if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.stroke();
  }
  _web = new THREE.CanvasTexture(cv);
  _web.minFilter = THREE.LinearFilter; _web.generateMipmaps = false; _web.userData.keep = true;
  return _web;
}
// 裂缝墙
let _crackTex = null;
export function crackTexture() {
  if (_crackTex) return _crackTex;
  const cv = platform.createCanvas(128, 128);
  const ctx = cv.getContext('2d');
  const rng = makeRng(99);
  ctx.fillStyle = '#4e4856'; ctx.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 4; r++) for (let c = -1; c < 3; c++) { const x = c * 48 + (r % 2) * 24; bevelRect(ctx, x + 2, r * 32 + 2, 44, 28, '#56505e', '#6a6474', '#3a3440', 3); }
  ctx.strokeStyle = '#140e10'; ctx.lineWidth = 3;
  for (let k = 0; k < 5; k++) { ctx.beginPath(); let x = 64, y = 64; ctx.moveTo(x, y); for (let i = 0; i < 7; i++) { x += (rng() - 0.5) * 30; y += (rng() - 0.5) * 30; ctx.lineTo(x, y); } ctx.stroke(); }
  _crackTex = new THREE.CanvasTexture(cv);
  _crackTex.minFilter = THREE.LinearFilter; _crackTex.generateMipmaps = false; _crackTex.userData.keep = true;
  return _crackTex;
}

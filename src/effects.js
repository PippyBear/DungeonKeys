// 粒子、闪光、冲击波、漂浮文字、血条
import * as THREE from 'three';
import { platform } from './platform.js';

const MAXP = 700;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

class ParticleLayer {
  constructor(scene, geo, mat, max) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.setHex(0xffffff));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.max = max;
    this.list = [];
  }
  spawn(o) {
    if (this.list.length >= this.max) this.list.shift();
    const p = {
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life || 1, t: 0, size: o.size || 0.3, grav: o.grav === undefined ? 0 : o.grav, drag: o.drag || 0,
      color: o.color === undefined ? 0xffffff : o.color, color2: o.color2, grow: o.grow || 0,
      rx: Math.random() * 6, ry: Math.random() * 6, spin: o.spin === undefined ? 4 : o.spin, floor: o.floor,
    };
    this.list.push(p);
    return p;
  }
  update(dt) {
    const L = this.list;
    let n = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.t += dt;
      if (p.t >= p.life) { L.splice(i, 1); continue; }
    }
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      const k = p.t / p.life;
      p.vy -= p.grav * dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
      let s = p.size * (1 + p.grow * k);
      s *= k < 0.1 ? k / 0.1 : 1 - Math.pow(Math.max(0, (k - 0.5) / 0.5), 2);
      _e.set(p.rx, p.ry, 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(n, _m);
      if (p.color2 !== undefined) _c.setHex(p.color).lerp(_c2.setHex(p.color2), Math.min(1, k * 1.6));
      else _c.setHex(p.color);
      this.mesh.setColorAt(n, _c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.list.length = 0; this.mesh.count = 0; }
}
const _c2 = new THREE.Color();

const texCache = new Map();
function textTexture(text, color, size = 44) {
  const key = text + '|' + color + '|' + size;
  if (texCache.has(key)) return texCache.get(key);
  const w = 256, h = 64;
  const cv = platform.createCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.font = 'bold ' + size + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(40,20,0,0.9)';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.userData.keep = true;
  if (texCache.size > 120) {
    const first = texCache.keys().next().value;
    texCache.get(first).dispose();
    texCache.delete(first);
  }
  texCache.set(key, t);
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.bright = new ParticleLayer(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 360);
    this.puffs = new ParticleLayer(scene, new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), MAXP - 360);
    this.flashes = [];
    this.flashGeo = new THREE.SphereGeometry(0.5, 10, 8);
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    this.texts = [];
    this.shake = 0;
  }
  // ---- 基础发射器
  fire(x, y, z, n, spread, color = 0xffa020, color2 = 0xff3a10, size = 0.35) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * spread;
      this.bright.spawn({ x, y, z, vx: Math.cos(a) * s, vy: Math.random() * spread * 1.2 + 1, vz: Math.sin(a) * s, life: 0.35 + Math.random() * 0.35, size: size * (0.6 + Math.random()), color, color2, drag: 3 });
    }
  }
  smoke(x, y, z, n = 6, size = 0.9, color = 0x777777, spread = 1.2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * spread;
      this.puffs.spawn({ x: x + Math.cos(a) * 0.3, y, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * s, vy: 1 + Math.random() * 1.5, vz: Math.sin(a) * s, life: 0.9 + Math.random() * 0.9, size: size * (0.6 + Math.random() * 0.6), grow: 1.2, color, drag: 1.5, spin: 1 });
    }
  }
  debris(x, y, z, n = 8, color = 0x5a4a3a, power = 6, floor = 0.05) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * power * 0.6;
      this.puffs.spawn({ x, y, z, vx: Math.cos(a) * s, vy: power * (0.5 + Math.random() * 0.7), vz: Math.sin(a) * s, life: 1 + Math.random() * 0.6, size: 0.18 + Math.random() * 0.25, grav: 18, color, spin: 8, floor });
    }
  }
  sparks(x, y, z, n = 6, color = 0xffe066, power = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, b = Math.random() * 3;
      this.bright.spawn({ x, y, z, vx: Math.cos(a) * power * Math.random(), vy: b, vz: Math.sin(a) * power * Math.random(), life: 0.25 + Math.random() * 0.2, size: 0.1 + Math.random() * 0.1, grav: 10, color });
    }
  }
  splash(x, z, n = 10, size = 0.25) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = 1 + Math.random() * 2;
      this.puffs.spawn({ x, y: 0.1, z, vx: Math.cos(a) * s, vy: 3 + Math.random() * 3, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.3, size: size + Math.random() * 0.15, grav: 14, color: 0xeaffff, spin: 3 });
    }
  }
  dust(x, y, z, n = 3, color = 0xd8c9a0) {
    for (let i = 0; i < n; i++) {
      this.puffs.spawn({ x: x + (Math.random() - 0.5) * 0.4, y: y + 0.1, z: z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5), vy: 0.6 + Math.random() * 0.5, vz: (Math.random() - 0.5), life: 0.5 + Math.random() * 0.3, size: 0.25, grow: 1, color, drag: 2, spin: 1 });
    }
  }
  heal(x, y, z, n = 4) {
    for (let i = 0; i < n; i++) {
      this.bright.spawn({ x: x + (Math.random() - 0.5) * 0.8, y: y + Math.random() * 0.5, z: z + (Math.random() - 0.5) * 0.8, vy: 1.5 + Math.random(), life: 0.8, size: 0.16, color: 0x5dff9a, spin: 0 });
    }
  }
  collect(x, y, z, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      this.bright.spawn({ x, y, z, vx: Math.cos(a) * 2, vy: 5 + Math.random() * 4, vz: Math.sin(a) * 2, life: 0.8 + Math.random() * 0.3, size: 0.28, grav: 9, color, spin: 6 });
    }
  }
  flameStream(x, y, z, dx, dz, len = 2) {
    for (let i = 0; i < 3; i++) {
      const sp = 5 + Math.random() * 3;
      this.bright.spawn({ x, y: y + (Math.random() - 0.5) * 0.2, z, vx: dx * sp + (Math.random() - 0.5), vy: Math.random() * 0.8, vz: dz * sp + (Math.random() - 0.5), life: len / sp, size: 0.35 + Math.random() * 0.25, color: 0xffd040, color2: 0xff2a00, drag: 0.5, grow: 0.8 });
    }
  }
  magic(x, y, z, color, n = 6, spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      this.bright.spawn({ x: x + Math.cos(a) * spread * Math.random(), y, z: z + Math.sin(a) * spread * Math.random(), vx: Math.cos(a) * 0.5, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * 0.5, life: 0.7 + Math.random() * 0.5, size: 0.12 + Math.random() * 0.1, color, spin: 3 });
    }
  }
  trail(x, y, z, color = 0xbbbbbb, size = 0.25) {
    this.puffs.spawn({ x, y, z, vy: 0.3, life: 0.5, size, grow: 1.5, color, drag: 1, spin: 1 });
  }
  flash(x, y, z, size = 2, color = 0xffe28a, dur = 0.25) {
    let f = this.flashes.find((q) => !q.mesh.visible);
    if (!f) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const mesh = new THREE.Mesh(this.flashGeo, mat);
      this.scene.add(mesh);
      f = { mesh };
      this.flashes.push(f);
    }
    f.mesh.visible = true;
    f.mesh.material.color.setHex(color);
    f.mesh.position.set(x, y, z);
    f.t = 0; f.dur = dur; f.size = size;
  }
  shockwave(x, z, radius = 3, color = 0xffffff, y = 0.1, dur = 0.5) {
    let r = this.rings.find((q) => !q.mesh.visible);
    if (!r) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      r = { mesh };
      this.rings.push(r);
    }
    r.mesh.visible = true;
    r.mesh.material.color.setHex(color);
    r.mesh.position.set(x, y, z);
    r.t = 0; r.dur = dur; r.radius = radius;
  }
  explosion(x, y, z, scale = 1, floor = 0.05) {
    this.flash(x, y + 0.5 * scale, z, 3 * scale, 0xffd27a, 0.3);
    this.fire(x, y + 0.3, z, Math.round(14 * scale), 3 * scale, 0xffd040, 0xff3a10, 0.45 * scale);
    this.smoke(x, y + 0.5, z, Math.round(8 * scale), 1.1 * scale, 0x5a5a5a, 1.6 * scale);
    this.debris(x, y + 0.4, z, Math.round(8 * scale), 0x3a3530, 7 * Math.sqrt(scale), floor);
    this.shockwave(x, z, 3 * scale, 0xfff0c0, y + 0.1);
    this.shake = Math.max(this.shake, 0.25 * scale);
  }
  text(x, y, z, str, color = '#ffffff', size = 1) {
    let t = this.texts.find((q) => !q.sprite.visible);
    if (!t) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
      sprite.renderOrder = 1000;
      this.scene.add(sprite);
      t = { sprite };
      this.texts.push(t);
    }
    t.sprite.material.map = textTexture(str, color);
    t.sprite.material.opacity = 1;
    t.sprite.material.needsUpdate = true;
    t.sprite.visible = true;
    t.sprite.position.set(x, y, z);
    t.sprite.scale.set(4 * size, 1 * size, 1);
    t.t = 0; t.y0 = y;
  }
  update(dt) {
    this.bright.update(dt);
    this.puffs.update(dt);
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { f.mesh.visible = false; continue; }
      f.mesh.scale.setScalar(f.size * (0.4 + k * 0.8));
      f.mesh.material.opacity = 1 - k;
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.mesh.visible = false; continue; }
      const s = r.radius * (0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 0.85 * (1 - k);
    }
    for (const t of this.texts) {
      if (!t.sprite.visible) continue;
      t.t += dt;
      if (t.t > 1.3) { t.sprite.visible = false; continue; }
      t.sprite.position.y = t.y0 + t.t * 1.6;
      t.sprite.material.opacity = t.t < 0.9 ? 1 : 1 - (t.t - 0.9) / 0.4;
    }
    this.shake = Math.max(0, this.shake - dt * 1.2);
  }
  clear() {
    this.bright.clear(); this.puffs.clear();
    for (const f of this.flashes) f.mesh.visible = false;
    for (const r of this.rings) r.mesh.visible = false;
    for (const t of this.texts) t.sprite.visible = false;
  }
}

// 精灵血条：两块精灵，前景通过 center.x 实现左对齐缩放
const bgMat = new THREE.SpriteMaterial({ color: 0x1a1a1a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85 });
bgMat.userData.shared = true;
const fgMats = {};
function fgMat(color) {
  if (!fgMats[color]) { fgMats[color] = new THREE.SpriteMaterial({ color, depthTest: false, depthWrite: false }); fgMats[color].userData.shared = true; }
  return fgMats[color];
}
export class HealthBar {
  constructor(parentScene, width = 1.2, color = 0x4ade3a) {
    this.w = width;
    this.bg = new THREE.Sprite(bgMat);
    this.fg = new THREE.Sprite(fgMat(color));
    this.bg.renderOrder = 998;
    this.fg.renderOrder = 999;
    this.bg.scale.set(width + 0.12, 0.26, 1);
    this.fg.scale.set(width, 0.16, 1);
    parentScene.add(this.bg);
    parentScene.add(this.fg);
    this.color = color;
    this.set(1);
    this.visible = false;
  }
  set(f) {
    f = Math.max(0.001, Math.min(1, f));
    this.f = f;
    this.fg.scale.x = this.w * f;
    this.fg.center.x = 0.5 / f;
  }
  setColor(c) { if (c !== this.color) { this.color = c; this.fg.material = fgMat(c); } }
  pos(x, y, z) { this.bg.position.set(x, y, z); this.fg.position.set(x, y, z); }
  set visible(v) { this.bg.visible = v; this.fg.visible = v; }
  get visible() { return this.bg.visible; }
  dispose() { this.bg.parent && this.bg.parent.remove(this.bg); this.fg.parent && this.fg.parent.remove(this.fg); }
}

const iconCache = new Map();
export function iconSprite(drawFn, size = 128, scale = 1.6, key = null) {
  let t = key && iconCache.get(key);
  if (!t) {
    const cv = platform.createCanvas(size, size);
    const ctx = cv.getContext('2d');
    drawFn(ctx, size);
    t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.userData.keep = true;
    if (key) iconCache.set(key, t);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(scale, scale, 1);
  s.renderOrder = 950;
  return s;
}

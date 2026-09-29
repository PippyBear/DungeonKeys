// 角色创建：职业 / 性别 / 毛色 / 服装 / 头饰，3D 实时预览
import * as THREE from 'three';
import { platform } from '../platform.js';
import { makeBearHero, animateBear, CLASSES, CLASS_ORDER, FURS, OUTFITS, ACCESSORIES, HAIRS, DEFAULT_HERO } from '../heroes.js';
import { Builder, Geo, glowSprite, makeTorch, matGlow, blobShadow, CUT } from '../models.js';
import { Effects } from '../effects.js';
import { clamp } from '../utils.js';
import { C, roundRect } from '../ui.js';

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

export class SelectScene {
  constructor(game) {
    this.game = game;
    this.save = game.save.data;
    this.cfg = Object.assign({}, DEFAULT_HERO, this.save.hero || {});
    const s3 = new THREE.Scene();
    this.s3 = s3;
    s3.background = new THREE.Color(0x07050c);
    s3.fog = new THREE.Fog(0x07050c, 12, 26);
    s3.add(new THREE.HemisphereLight(0x9aa0d8, 0x2a2018, 0.7));
    const key = new THREE.SpotLight(0xfff0d8, 60, 20, 0.5, 0.6, 1.2);
    key.position.set(2, 8, 5);
    key.target.position.set(0, 0.8, 0);
    key.castShadow = this.save.settings.quality !== 'low';
    key.shadow.mapSize.set(1024, 1024);
    s3.add(key, key.target);
    const rim = new THREE.PointLight(0x6a8aff, 14, 10, 1.5);
    rim.position.set(-2.5, 2.5, -2.5);
    s3.add(rim);
    this.fx = new Effects(s3);
    // 舞台
    const b = new Builder();
    b.add(Geo.cyl(24), 0x2a2632, 0, -0.2, 0, 5, 0.4, 5, 0, 0, 0, 0.6);
    b.add(Geo.cyl(24), 0x3e3846, 0, 0.02, 0, 4.4, 0.06, 4.4);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.add(Geo.box(), 0x4a4452, Math.cos(a) * 2.3, -0.05, Math.sin(a) * 2.3, 0.6, 0.3, 0.6, 0, -a, 0); }
    const stage = b.mesh(false);
    stage.receiveShadow = true;
    s3.add(stage);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.85, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.7, fog: false }));
    this.ring.position.y = 0.07;
    s3.add(this.ring);
    this.ring2 = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.26, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.6, fog: false }));
    this.ring2.position.y = 0.08;
    s3.add(this.ring2);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 24).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x14101a }));
    floor.position.y = -0.4;
    floor.receiveShadow = true;
    s3.add(floor);
    this.torches = [];
    for (const [x, z] of [[-3.6, -2.2], [3.6, -2.2]]) {
      const pb = new Builder();
      pb.add(Geo.cyl(8), 0x3a3440, 0, 0.6, 0, 0.5, 2, 0.5);
      pb.add(Geo.cyl(8, 1.4), 0x2a2630, 0, 1.7, 0, 0.6, 0.2, 0.6);
      const pil = pb.mesh(true);
      pil.position.set(x, -0.4, z);
      s3.add(pil);
      const f = new THREE.Mesh(Geo.cone(6), matGlow(0xff8a2a));
      f.scale.set(0.3, 0.6, 0.3); f.position.set(x, 1.8, z);
      s3.add(f);
      const g = glowSprite(0xff8a2a, 2.6, 0.7); g.position.set(x, 1.9, z); s3.add(g);
      const l = new THREE.PointLight(0xff8a3a, 10, 9, 1.5); l.position.set(x, 2.2, z); s3.add(l);
      this.torches.push({ f, l });
    }
    this.shadow = blobShadow(1.5);
    this.shadow.position.y = 0.09;
    s3.add(this.shadow);
    this.camera = new THREE.PerspectiveCamera(34, platform.width / platform.height, 0.5, 60);
    this.camera.position.set(0, 2.2, 6.2);
    this.camera.lookAt(0, 0.95, 0);
    CUT.uPlayer.value.set(0, 1000, 0);
    this.time = 0;
    this.hudInterval = 0.1;
    this.rot = 0.4;
    this.rebuild();
    game.audio.playMusic('title');
  }
  get wantsStick() { return false; }
  rebuild() {
    if (this.hero) { this.s3.remove(this.hero.root); this.hero.root.traverse((o) => { if (o.geometry && !o.userData.outline) o.geometry.dispose(); }); }
    this.hero = makeBearHero(this.cfg);
    this.hero.root.scale.setScalar(1.25);
    this.hero.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.s3.add(this.hero.root);
    this.pose = 0;
    this.fx.sparks(0, 1.2, 0, 14, 0xffe8a0, 2.5);
    this.game.hud.dirty = true;
  }
  set(key, v) {
    this.cfg[key] = v;
    this.game.audio.play('click');
    this.rebuild();
  }
  onPinch() {}
  update(dt) {
    this.time += dt;
    const t = this.time;
    this.rot += dt * 0.45;
    const h = this.hero;
    h.root.rotation.y = Math.sin(this.rot) * 0.9;
    animateBear(h, t, false);
    // 展示动作
    this.pose += dt;
    const cls = this.cfg.cls;
    const k = (this.pose % 4) / 4;
    h.armR.rotation.order = 'YXZ';
    if (k > 0.7) {
      const q = (k - 0.7) / 0.3;
      if (cls === 'ranger') { h.armL.rotation.x = -1.4; h.armR.rotation.x = -1.3; }
      else if (cls === 'mage') { h.armR.rotation.x = -1.2 - Math.sin(q * Math.PI) * 0.5; if (Math.random() < 0.4) this.fx.magic(0.5, 1.8, 0.6, 0x9fe8ff, 1, 0.3); }
      else h.armR.rotation.set(-2.2 + Math.sin(q * Math.PI) * 1.2, 0, 0);
    } else h.armR.rotation.set(cls === 'knight' || cls === 'berserker' ? -0.35 : -0.2, 0.1, 0);
    if (cls === 'knight' || cls === 'berserker') h.weapon.rotation.x = Math.PI / 2;
    this.ring.rotation.y += dt * 0.3;
    this.ring2.rotation.y -= dt * 0.6;
    this.ring.material.opacity = 0.5 + Math.sin(t * 2) * 0.2;
    for (const tc of this.torches) { const s = 1 + Math.sin(t * 13 + tc.f.position.x) * 0.12; tc.f.scale.set(0.3 * s, 0.6 * s, 0.3 * s); tc.l.intensity = 9 + Math.sin(t * 17 + tc.f.position.x) * 1.5; }
    if (Math.random() < dt * 6) { const a = Math.random() * Math.PI * 2; this.fx.bright.spawn({ x: Math.cos(a) * 1.8, y: 0.1, z: Math.sin(a) * 1.8, vy: 0.8 + Math.random(), life: 1.6, size: 0.05, color: 0xffd86a, spin: 0 }); }
    this.fx.update(dt);
  }
  drawHUD(hud) {
    const W = hud.w, H = hud.h, s = platform.safe;
    const L = 12 + s.left, R = W - 12 - s.right;
    const u = clamp(H / 400, 0.85, 1.5);
    const ctx = hud.ctx;
    const cfg = this.cfg;
    hud.header(W / 2 - 130 * u, 10 * u, 260 * u, 36 * u, '创建你的熊熊英雄');
    // 左：职业
    const pw = Math.min(250 * u, W * 0.3);
    const py = 56 * u, ph = H - py - 66 * u;
    hud.panel(L, py, pw, ph);
    hud.text('职业', L + 14 * u, py + 18 * u, { size: 15 * u, color: C.gold });
    const cw = (pw - 36 * u) / 2, ch = 46 * u;
    CLASS_ORDER.forEach((id, k) => {
      const c = CLASSES[id];
      const x = L + 12 * u + (k % 2) * (cw + 12 * u), y = py + 32 * u + Math.floor(k / 2) * (ch + 8 * u);
      const on = cfg.cls === id;
      hud.button('cls_' + id, x, y, cw, ch, { icon: c.icon, label: c.name, color: on ? '#c9a45a' : C.stone, colorD: on ? '#6e5528' : C.stoneD, fontSize: 14 * u, iconSize: 20 * u }, () => this.set('cls', id));
    });
    const c = CLASSES[cfg.cls];
    let y = py + 32 * u + 2 * (ch + 8 * u) + 6 * u;
    y = hud.paragraph(c.desc, L + 14 * u, y + 6 * u, pw - 28 * u, { size: 12 * u, color: C.text, stroke: false, bold: false }) + 4 * u;
    const bars = [['生命', c.stats.hp, '#e8303a'], ['攻击', c.stats.atk, '#ff9a3a'], ['速度', c.stats.spd, '#4ad8ff'], ['射程', c.stats.rng, '#9dff7a']];
    for (const [name, v, col] of bars) {
      if (y > py + ph - 14 * u) break;
      hud.text(name, L + 14 * u, y, { size: 12 * u, color: C.textDim });
      for (let k = 0; k < 5; k++) {
        roundRect(ctx, L + 52 * u + k * 30 * u, y - 5 * u, 26 * u, 10 * u, 4);
        ctx.fillStyle = k < v ? col : 'rgba(255,255,255,0.1)'; ctx.fill();
      }
      y += 18 * u;
    }
    // 右：外观
    const rx = R - pw;
    hud.panel(rx, py, pw, ph);
    let ry = py + 18 * u;
    hud.text('性别', rx + 14 * u, ry, { size: 15 * u, color: C.gold });
    const gw = (pw - 36 * u) / 2;
    hud.button('g_m', rx + 12 * u, ry + 12 * u, gw, 34 * u, { icon: 'male', label: '公熊', color: cfg.gender === 'male' ? C.blue : C.stone, colorD: cfg.gender === 'male' ? C.blueD : C.stoneD, fontSize: 14 * u, iconSize: 18 * u }, () => this.set('gender', 'male'));
    hud.button('g_f', rx + 24 * u + gw, ry + 12 * u, gw, 34 * u, { icon: 'female', label: '母熊', color: cfg.gender === 'female' ? '#d86a9a' : C.stone, colorD: cfg.gender === 'female' ? '#7a2a4a' : C.stoneD, fontSize: 14 * u, iconSize: 18 * u }, () => this.set('gender', 'female'));
    ry += 62 * u;
    const swatches = (label, list, key, colorOf) => {
      hud.text(label + '：' + list[cfg[key]].name, rx + 14 * u, ry, { size: 13 * u, color: C.gold });
      const sz = Math.min(26 * u, (pw - 28 * u) / list.length - 4);
      list.forEach((it, k) => {
        const x = rx + 14 * u + k * (sz + 4), yy = ry + 12 * u;
        const on = cfg[key] === k;
        ctx.beginPath(); ctx.arc(x + sz / 2, yy + sz / 2, sz / 2, 0, Math.PI * 2);
        ctx.fillStyle = hex(colorOf(it)); ctx.fill();
        if (it.panda) { ctx.beginPath(); ctx.arc(x + sz / 2, yy + sz / 2, sz / 2, Math.PI * 0.5, Math.PI * 1.5); ctx.fillStyle = '#1e1c20'; ctx.fill(); }
        ctx.lineWidth = on ? 3 : 1.5; ctx.strokeStyle = on ? '#ffe08a' : 'rgba(0,0,0,0.6)';
        ctx.beginPath(); ctx.arc(x + sz / 2, yy + sz / 2, sz / 2 + (on ? 2 : 0), 0, Math.PI * 2); ctx.stroke();
        hud.region(key + k, x - 2, yy - 2, sz + 4, sz + 4, () => this.set(key, k));
      });
      ry += sz + 30 * u;
    };
    swatches('毛色', FURS, 'fur', (it) => it.fur);
    swatches('服装', OUTFITS, 'outfit', (it) => it.main);
    // 发型 / 头饰：左右切换
    const hairs = HAIRS[cfg.gender === 'female' ? 'female' : 'male'];
    const half = (pw - 36 * u) / 2;
    const picker = (label, x, key, list) => {
      hud.text(label, x + half / 2, ry, { size: 13 * u, color: C.gold, align: 'center' });
      const y2 = ry + 12 * u, bw2 = 26 * u;
      hud.button(key + '_l', x, y2, bw2, 30 * u, { icon: 'left', iconSize: 15 * u, color: C.stone, colorD: C.stoneD }, () => this.set(key, ((cfg[key] || 0) + list.length - 1) % list.length));
      hud.button(key + '_r', x + half - bw2, y2, bw2, 30 * u, { icon: 'right', iconSize: 15 * u, color: C.stone, colorD: C.stoneD }, () => this.set(key, ((cfg[key] || 0) + 1) % list.length));
      hud.text(list[(cfg[key] || 0) % list.length].name, x + half / 2, y2 + 14 * u, { size: 12 * u, align: 'center', maxW: half - bw2 * 2 - 4 });
    };
    picker('发型', rx + 12 * u, 'hair', hairs);
    picker('头饰', rx + 24 * u + half, 'acc', ACCESSORIES);
    // 底部按钮
    const bw = 170 * u, bh = 46 * u, by = H - bh - 10 * u;
    hud.button('back', L, by, 110 * u, bh, { icon: 'home', label: '返回', color: C.stone, colorD: C.stoneD, fontSize: 15 * u }, () => this.game.goTitle());
    hud.button('rand', W / 2 - bw / 2 - 120 * u, by, 110 * u, bh, { icon: 'star', label: '随机', color: C.purple, colorD: C.purpleD, fontSize: 15 * u }, () => {
      this.cfg = { cls: CLASS_ORDER[Math.floor(Math.random() * 4)], gender: Math.random() < 0.5 ? 'male' : 'female', fur: Math.floor(Math.random() * FURS.length), outfit: Math.floor(Math.random() * OUTFITS.length), acc: Math.floor(Math.random() * ACCESSORIES.length), hair: Math.floor(Math.random() * 4) };
      this.game.audio.play('magic');
      this.rebuild();
    });
    hud.button('go', W / 2 - bw / 2 + 10 * u, by, bw + 20 * u, bh, { icon: 'sword', label: '开始冒险', color: '#b83a30', colorD: '#5a1812', fontSize: 18 * u }, () => {
      this.save.hero = Object.assign({}, this.cfg);
      this.game.save.save();
      this.game.newRun(this.save.hero);
    });
    hud.text((cfg.gender === 'female' ? '母熊' : '公熊') + ' · ' + CLASSES[cfg.cls].name, W / 2, by - 16 * u, { size: 16 * u, align: 'center', color: '#ffe8a0' });
  }
  onResize() { this.camera.aspect = platform.width / platform.height; this.camera.updateProjectionMatrix(); }
  dispose() {
    this.s3.traverse((o) => {
      if (o.geometry && !o.userData.outline) o.geometry.dispose();
      if (o.material && !o.material.userData.shared && !Array.isArray(o.material)) o.material.dispose();
    });
  }
}

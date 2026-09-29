// 标题界面：3D 展示密室 + 菜单 + 水晶祭坛（永久强化）
import * as THREE from 'three';
import { platform } from '../platform.js';
import { T } from '../dungeon.js';
import { buildLevel, WH } from '../level.js';
import { flatTerrain } from '../terrain.js';
import { makeAtlas, patternTexture } from '../textures.js';
import { World } from '../world.js';
import { placeTorch, Chest } from '../objects.js';
import { makeSkeleton, makePillar, makeKey, makeBrazier, makeBones, makeRunePillar, blobShadow, CUT } from '../models.js';
import { Effects } from '../effects.js';
import { META } from '../abilities.js';
import { makeBearHero, animateBear, CLASSES } from '../heroes.js';
import { clamp } from '../utils.js';
import { C, roundRect } from '../ui.js';
import { RUNE_COLORS } from '../textures.js';

export class TitleScene {
  constructor(game) {
    this.game = game;
    this.save = game.save.data;
    const s3 = new THREE.Scene();
    this.s3 = s3;
    s3.background = new THREE.Color(0x05040a);
    s3.fog = new THREE.Fog(0x05040a, 16, 34);
    s3.add(new THREE.HemisphereLight(0x8a90c8, 0x2a2018, 0.7));
    const moon = new THREE.DirectionalLight(0x9aa8e0, 0.7);
    moon.position.set(4, 16, 12);
    moon.target.position.set(13, 0, 11);
    moon.castShadow = this.save.settings.quality !== 'low';
    moon.shadow.mapSize.set(1024, 1024);
    const sc = moon.shadow.camera; sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.far = 50;
    s3.add(moon); s3.add(moon.target);
    // 手工小地牢：一个大房间
    const W = 15, H = 13;
    const tile = new Uint8Array(W * H), region = new Int16Array(W * H).fill(-1);
    const room = { id: 0, x: 2, y: 2, w: 11, h: 9, cx: 7, cy: 6, entrances: [] };
    for (let j = room.y; j < room.y + room.h; j++) for (let i = room.x; i < room.x + room.w; i++) { tile[j * W + i] = 1; region[j * W + i] = 0; }
    const d = flatTerrain({ W, H, tile, region, regions: 1, rooms: [room], seed: 42, floor: 1, keysNeeded: 1 });
    this.fx = new Effects(s3);
    const w = new World(s3, d, game, { abilities: {}, coins: 0, keys: 0, crystals: 0 }, this.fx);
    this.world = w;
    const lvl = buildLevel(d, makeAtlas());
    w.groups = lvl.groups;
    for (const g of lvl.groups) s3.add(g);
    w.discover(0);
    for (const i of [4, 7, 10]) placeTorch(w, i * T + 1, room.y * T + 0.05, 0, 0);
    placeTorch(w, room.x * T + 0.05, 6 * T + 1, Math.PI / 2, 0);
    placeTorch(w, (room.x + room.w) * T - 0.05, 6 * T + 1, -Math.PI / 2, 0);
    for (const [i, j] of [[4, 4], [10, 4], [4, 8], [10, 8]]) { const p = makePillar(WH); p.position.set(i * T + 1, 0, j * T + 1); w.groups[0].add(p); }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2), new THREE.MeshLambertMaterial({ map: patternTexture('banner'), side: THREE.DoubleSide }));
    banner.position.set(7 * T + 1, 1.5, room.y * T + 0.06);
    w.groups[0].add(banner);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 10).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: patternTexture('rug') }));
    rug.position.set(7 * T + 1, 0.02, 6 * T + 1);
    w.groups[0].add(rug);
    this.chest = new Chest(w, 7, 3, { coins: 0 });
    for (const [i, k] of [[3, 0], [11, 1]]) {
      const rp = makeRunePillar(k, RUNE_COLORS[k]);
      rp.root.position.set(i * T + 1, 0, 3 * T + 1);
      rp.mat.color.set(RUNE_COLORS[k]); rp.glow.material.opacity = 0.7;
      w.groups[0].add(rp.root);
      w.addLight({ x: i * T + 1, y: 2, z: 3 * T + 1, color: new THREE.Color(RUNE_COLORS[k]).getHex(), intensity: 8, range: 7 });
    }
    const br = makeBrazier();
    br.root.position.set(5 * T + 1, 0, 9 * T + 1);
    w.groups[0].add(br.root);
    w.addLight({ x: 5 * T + 1, y: 2, z: 9 * T + 1, color: 0x4ad8ff, intensity: 8, range: 8 });
    this.brazier = br;
    const bones = makeBones(3); bones.position.set(10 * T + 1, 0, 9 * T); w.groups[0].add(bones);
    this.hero = makeBearHero(this.save.hero);
    this.hero.armR.rotation.order = 'YXZ';
    if (this.save.hero.cls === 'knight' || this.save.hero.cls === 'berserker') this.hero.weapon.rotation.x = Math.PI / 2;
    this.hero.root.position.set(7 * T + 1, 0, 7 * T + 1);
    this.hero.root.rotation.y = Math.PI;
    s3.add(this.hero.root);
    const hs = blobShadow(1.3); hs.position.set(7 * T + 1, 0.03, 7 * T + 1); s3.add(hs);
    this.skel = makeSkeleton(false);
    this.skel.root.position.set(10 * T + 1, 0, 6 * T + 1);
    this.skel.root.rotation.y = -Math.PI / 2;
    s3.add(this.skel.root);
    this.key = makeKey();
    this.key.position.set(7 * T + 1, 1.6, 4 * T + 1);
    s3.add(this.key);
    w.addLight({ x: 7 * T + 1, y: 2, z: 4 * T + 1, color: 0xffcf4a, intensity: 8, range: 6 });
    this.lantern = new THREE.PointLight(0xffb070, 14, 12, 1.3);
    this.lantern.position.set(7 * T + 1, 2.6, 7.6 * T);
    s3.add(this.lantern);
    this.center = new THREE.Vector3(7 * T + 1, 0, 6 * T + 1);
    CUT.uPlayer.value.set(this.center.x, 0, this.center.z + 6);
    this.camera = new THREE.PerspectiveCamera(42, platform.width / platform.height, 0.5, 80);
    this.time = 0;
    this.hudInterval = 0.05;
    this.overlay = null;
    this.world.player = { x: this.center.x, z: this.center.z, alive: false, heal() {} };
    game.audio.playMusic('title');
  }
  get wantsStick() { return false; }
  update(dt) {
    this.time += dt;
    const t = this.time;
    const w = this.world;
    w.time += dt;
    for (const u of w.updatables) u.update(dt);
    w.updateLights(dt, this.center.x, this.center.z);
    this.fx.update(dt);
    const a = Math.sin(t * 0.12) * 0.5;
    const r = 13;
    this.camera.position.set(this.center.x + Math.sin(a) * r, 9.5, this.center.z + Math.cos(a) * r);
    this.camera.lookAt(this.center.x + 2.5, 0.8, this.center.z);
    CUT.uPlayer.value.set(this.camera.position.x, 0, this.center.z + 7.5);
    this.key.rotation.y += dt * 1.5;
    this.key.position.y = 1.6 + Math.sin(t * 2) * 0.15;
    animateBear(this.hero, t, false);
    this.hero.armR.rotation.x = -0.35 + Math.sin(t * 1.2) * 0.05;
    this.skel.pivot.rotation.z = Math.sin(t * 2) * 0.05;
    this.skel.arm.rotation.x = -0.4 + Math.sin(t * 2.3) * 0.2;
    const k = t * 10;
    this.brazier.flame.scale.set(1 + Math.sin(k) * 0.1, 1 + Math.sin(k * 1.3) * 0.15, 1);
    if (Math.random() < dt * 3) this.fx.magic(this.key.position.x, 1.2, this.key.position.z, 0xffd86a, 1, 0.5);
    if (Math.random() < dt * 4) this.fx.bright.spawn({ x: this.center.x + (Math.random() - 0.5) * 18, y: 0.3, z: this.center.z + (Math.random() - 0.5) * 12, vy: 0.4, life: 3, size: 0.05, color: 0xffcf8a, spin: 0 });
  }
  drawHUD(hud) {
    const W = hud.w, H = hud.h, s = platform.safe;
    const L = 16 + s.left, R = W - 16 - s.right;
    const u = clamp(H / 400, 0.85, 1.6);
    const ctx = hud.ctx;
    const g = ctx.createLinearGradient(0, 0, W * 0.55, 0);
    g.addColorStop(0, 'rgba(4,2,8,0.75)'); g.addColorStop(1, 'rgba(4,2,8,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W * 0.55, H);
    const tx = L + 150 * u;
    const glow = 0.6 + Math.sin(this.time * 2) * 0.2;
    ctx.save();
    ctx.shadowColor = 'rgba(255,190,60,' + glow + ')';
    ctx.shadowBlur = 24 * u;
    hud.text('地牢密钥', tx, H * 0.24, { size: 54 * u, align: 'center', color: '#ffd46a', stroke: '#3a1a04', strokeW: 9 });
    ctx.restore();
    hud.text('D U N G E O N   K E Y S', tx, H * 0.24 + 38 * u, { size: 14 * u, align: 'center', color: '#c9a45a' });
    hud.text('随机地牢 · 机关解谜 · 陷阱与怪物 · 每层获得新能力', tx, H * 0.24 + 62 * u, { size: 13 * u, align: 'center', color: '#b8a888', stroke: false });
    const bw = 230 * u, bh = 46 * u;
    const bx = tx - bw / 2;
    let by = H * 0.24 + 88 * u;
    const run = this.save.run;
    if (run) {
      hud.button('cont', bx, by, bw, bh, { icon: 'play', label: '继续冒险 · 第 ' + run.floor + ' 层', color: C.green, colorD: C.greenD, fontSize: 17 * u }, () => this.game.continueRun());
      by += bh + 10 * u;
    }
    hud.button('new', bx, by, bw, bh, { icon: 'sword', label: run ? '重新开始' : '开始冒险', color: run ? C.stone : '#b83a30', colorD: run ? C.stoneD : '#5a1812', fontSize: 17 * u }, () => { if (run) { this.overlay = 'confirm'; hud.dirty = true; } else this.game.goSelect(); });
    by += bh + 10 * u;
    const half = (bw - 10 * u) / 2;
    hud.button('shop', bx, by, half, bh * 0.9, { icon: 'crystal', label: '水晶祭坛', color: C.purple, colorD: C.purpleD, fontSize: 14 * u }, () => { this.overlay = 'shop'; this.game.audio.play('open'); hud.dirty = true; });
    hud.button('set', bx + half + 10 * u, by, half, bh * 0.9, { icon: 'gear', label: '设置', color: C.stone, colorD: C.stoneD, fontSize: 14 * u }, () => { this.overlay = 'settings'; this.game.audio.play('open'); hud.dirty = true; });
    const st = this.save.stats;
    hud.text('最深到达：第 ' + this.save.best + ' 层   击败敌人：' + st.kills + '   冒险次数：' + st.runs, L, H - 18 * u, { size: 12 * u, color: C.textDim });
    roundRect(ctx, R - 120 * u, 14 * u, 120 * u, 30 * u, 15 * u);
    ctx.fillStyle = 'rgba(10,6,16,0.7)'; ctx.fill();
    hud.iconText('crystal', String(this.save.crystals), R - 112 * u, 29 * u, 15 * u, '#d8b0ff');
    if (!this.game.audioStarted) {
      const a = 0.5 + Math.sin(this.time * 4) * 0.4;
      hud.text('点击任意位置开启声音', W - 16 - s.right, H - 18 * u, { size: 12 * u, align: 'right', color: 'rgba(255,230,180,' + a + ')', stroke: false });
    }
    if (this.overlay === 'shop') this.drawShop(hud, u);
    else if (this.overlay === 'settings') this.drawSettings(hud, u);
    else if (this.overlay === 'confirm') this.drawConfirm(hud, u);
  }
  drawShop(hud, u) {
    const W = hud.w, H = hud.h;
    hud.dim(0.7, () => { this.overlay = null; hud.dirty = true; });
    const pw = Math.min(W - 40, 620 * u), ph = Math.min(H - 50, 300 * u);
    const x = (W - pw) / 2, y = (H - ph) / 2 + 10 * u;
    hud.panel(x, y, pw, ph, { stroke: '#b06aff' });
    hud.header(x + pw * 0.25, y - 18 * u, pw * 0.5, 36 * u, '水晶祭坛', '#d8b0ff');
    hud.button('shopx', x + pw - 26 * u, y - 14 * u, 34 * u, 34 * u, { icon: 'cross', color: C.red, colorD: C.redD, iconSize: 16 * u }, () => { this.overlay = null; hud.dirty = true; });
    hud.text('用冒险中收集的水晶获得永久强化', x + pw / 2, y + 30 * u, { size: 13 * u, align: 'center', color: C.textDim });
    hud.iconText('crystal', '拥有 ' + this.save.crystals, x + 18 * u, y + 30 * u, 13 * u, '#d8b0ff');
    const keys = Object.keys(META);
    const cw = (pw - 30 * u - (keys.length - 1) * 10 * u) / keys.length, ch = ph - 70 * u;
    keys.forEach((k, idx) => {
      const m = META[k];
      const lv = this.save.meta[k] || 0;
      const cx = x + 15 * u + idx * (cw + 10 * u), cy = y + 52 * u;
      const ctx = hud.ctx;
      roundRect(ctx, cx, cy, cw, ch, 10);
      ctx.fillStyle = 'rgba(40,28,60,0.8)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(176,106,255,0.6)'; ctx.stroke();
      hud.icon(m.icon, cx + cw / 2, cy + 34 * u, 38 * u);
      hud.text(m.name, cx + cw / 2, cy + 68 * u, { size: 15 * u, align: 'center', color: '#e8d0ff' });
      hud.paragraph(m.desc, cx + 8 * u, cy + 90 * u, cw - 16 * u, { size: 12 * u, color: C.text, stroke: false, bold: false });
      for (let s = 0; s < m.max; s++) hud.icon('star', cx + cw / 2 + (s - (m.max - 1) / 2) * 16 * u, cy + ch - 62 * u, s < lv ? 14 * u : 9 * u);
      const maxed = lv >= m.max;
      const cost = maxed ? 0 : m.cost[lv];
      hud.button('buy' + k, cx + 8 * u, cy + ch - 46 * u, cw - 16 * u, 38 * u, { icon: maxed ? 'check' : 'crystal', label: maxed ? '已满级' : String(cost), color: maxed ? C.gray : this.save.crystals >= cost ? C.purple : C.grayD, colorD: C.purpleD, fontSize: 15 * u, disabled: maxed }, () => {
        if (this.save.crystals < cost) { this.game.audio.play('error'); hud.toast('水晶不足'); return; }
        this.save.crystals -= cost;
        this.save.meta[k] = lv + 1;
        this.game.save.save();
        this.game.audio.play('levelup');
        hud.toast(m.name + ' 提升到 Lv.' + (lv + 1), '#d8b0ff');
        hud.dirty = true;
      });
    });
  }
  drawSettings(hud, u) {
    const W = hud.w, H = hud.h;
    hud.dim(0.7, () => { this.overlay = null; hud.dirty = true; });
    const pw = 320 * u, ph = 250 * u;
    const x = (W - pw) / 2, y = (H - ph) / 2;
    hud.panel(x, y, pw, ph);
    hud.header(x + pw * 0.2, y - 18 * u, pw * 0.6, 36 * u, '设置');
    const st = this.save.settings;
    const bw = pw - 60 * u, bh = 42 * u;
    let by = y + 32 * u;
    hud.button('s1', x + 30 * u, by, bw, bh, { icon: 'sound', label: st.sound ? '音效：开' : '音效：关', color: st.sound ? C.blue : C.gray, colorD: C.blueD }, () => { st.sound = !st.sound; this.game.save.save(); hud.dirty = true; });
    by += bh + 12 * u;
    hud.button('s2', x + 30 * u, by, bw, bh, { icon: 'music', label: st.music ? '音乐：开' : '音乐：关', color: st.music ? C.blue : C.gray, colorD: C.blueD }, () => { st.music = !st.music; this.game.save.save(); this.game.audio.track = null; this.game.audio.playMusic(st.music ? 'title' : null); hud.dirty = true; });
    by += bh + 12 * u;
    const qn = { high: '画质：高（阴影+高清）', mid: '画质：中（推荐）', low: '画质：低（最流畅）' };
    hud.button('s3', x + 30 * u, by, bw, bh, { icon: 'quality', label: qn[st.quality], color: C.purple, colorD: C.purpleD, fontSize: 15 * u }, () => { st.quality = st.quality === 'high' ? 'mid' : st.quality === 'mid' ? 'low' : 'high'; this.game.save.save(); this.game.applyQuality(); hud.dirty = true; });
    by += bh + 12 * u;
    hud.text('操作：左侧拖动移动；键盘 WASD / J 攻击 / K 翻滚 / E 交互 / Q R 技能', x + pw / 2, by + 8 * u, { size: 10 * u, align: 'center', color: C.textDim, stroke: false, maxW: pw - 20 });
  }
  drawConfirm(hud, u) {
    const W = hud.w, H = hud.h;
    hud.dim(0.7, () => { this.overlay = null; hud.dirty = true; });
    const pw = 320 * u, ph = 160 * u;
    const x = (W - pw) / 2, y = (H - ph) / 2;
    hud.panel(x, y, pw, ph);
    hud.text('放弃当前冒险（第 ' + this.save.run.floor + ' 层）？', x + pw / 2, y + 44 * u, { size: 16 * u, align: 'center' });
    hud.text('已获得的水晶会保留', x + pw / 2, y + 70 * u, { size: 12 * u, align: 'center', color: C.textDim });
    const bw = (pw - 70 * u) / 2;
    hud.button('cno', x + 25 * u, y + ph - 56 * u, bw, 40 * u, { label: '取消', color: C.stone, colorD: C.stoneD }, () => { this.overlay = null; hud.dirty = true; });
    hud.button('cyes', x + 45 * u + bw, y + ph - 56 * u, bw, 40 * u, { label: '重新开始', color: C.red, colorD: C.redD }, () => { this.save.run = null; this.game.goSelect(); });
  }
  onResize() { this.camera.aspect = platform.width / platform.height; this.camera.updateProjectionMatrix(); }
  dispose() {
    this.s3.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.userData.shared) o.material.dispose();
    });
  }
}

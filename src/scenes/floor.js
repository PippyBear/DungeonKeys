// 地牢楼层场景：生成、摆放内容、主循环、HUD 与各种弹窗
import * as THREE from 'three';
import { platform } from '../platform.js';
import { generateDungeon, T, WALL, ROOM } from '../dungeon.js';
import { themeFor, floorTitle, MODIFIERS, rollModifier } from '../themes.js';
import { buildLevel, WH, columnGeometry } from '../level.js';
import { K, LOW, HIGH, PIT } from '../terrain.js';
import { makeAtlas, patternTexture } from '../textures.js';
import { World } from '../world.js';
import { Player } from '../player.js';
import { Enemy } from '../enemies.js';
import { prewarmCreatures } from '../creatures.js';
import { createPuzzle } from '../puzzles.js';
import { createTrap, Spikes, Pendulum } from '../traps.js';
import { Gate, Chest, Breakable, Stairs, Fountain, Altar, placeTorch, HazardPool, CrackedWall, Shop, Prisoner, LoreBook, MovingPlatform } from '../objects.js';
import { makePillar, makeBones, makeRubble, glowSprite, CUT, Builder, Geo, makeMushrooms, makeCrystals, makeStalagmite, makeSnowPile, makeObsidian, makeCobweb, makeVines, makeChains, makeCoffin, makeBookshelf, makeCandleTable, makeBearStatue, makeHangingCage, makeSkullPile, makeRoots, makeLavaBrazier, makePool, makeLadder, makeBouncePad, makeRailing } from '../models.js';
import { Effects } from '../effects.js';
import { Ambience } from '../ambience.js';
import { ABILITIES, rollAbilities } from '../abilities.js';
import { makeRng, clamp, fmtClock } from '../utils.js';
import { C, roundRect, drawIcon } from '../ui.js';

let _rug = null, _banner = null;
// 会坍塌的石柱：偏红褐的岩色，一眼就能和普通石柱区分
const _crumbleMats = new Map();
function crumbleMat(base) {
  let m = _crumbleMats.get(base);
  if (!m) { m = base.clone(); m.color.setHex(0xd8a088); m.userData.shared = true; _crumbleMats.set(base, m); }
  return m;
}

export class FloorScene {
  constructor(game, run) {
    this.game = game;
    this.run = run;
    this.save = game.save.data;
    const q = this.save.settings.quality;
    this.q = q;
    const th = themeFor(run.floor);
    this.theme = th;
    this.mod = run.modFloor === run.floor ? run.mod : rollModifier(run.floor, makeRng(run.seed * 3 + run.floor * 17));
    run.mod = this.mod; run.modFloor = run.floor;
    const d = generateDungeon(run.floor, run.seed + run.floor * 1013, { traps: this.mod === 'traps' });
    this.d = d;
    run.keys = 0;
    const s3 = new THREE.Scene();
    this.s3 = s3;
    const dark = this.mod === 'dark';
    s3.background = new THREE.Color(th.fog);
    s3.fog = new THREE.Fog(th.fog, dark ? 11 : 15, dark ? 24 : 30);
    s3.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, (q === 'low' ? 1.1 : 0.75) * (dark ? 0.45 : 1)));
    this.moon = new THREE.DirectionalLight(th.moon, (q === 'low' ? 0.4 : 0.85) * (dark ? 0.4 : 1));
    if (q !== 'low') {
      this.moon.castShadow = true;
      const sz = q === 'high' ? 2048 : 1024;
      this.moon.shadow.mapSize.set(sz, sz);
      const c = this.moon.shadow.camera;
      c.left = -15; c.right = 15; c.top = 15; c.bottom = -15; c.near = 1; c.far = 50;
      this.moon.shadow.bias = -0.0006;
      this.moon.shadow.normalBias = 0.03;
    }
    s3.add(this.moon); s3.add(this.moon.target);
    this.fx = new Effects(s3);
    const w = new World(s3, d, game, run, this.fx);
    this.world = w;
    w.onEnemyKilled = (e) => this.onEnemyKilled(e);
    w.onPlayerDeath = () => this.onDeath();
    w.platformVibrate = () => platform.vibrate();
    w.dark = dark;
    w.theme = th;
    w.lootMul = this.mod === 'bounty' ? 2 : 1;
    w.hazards = new Map();
    const exitRoom = d.rooms[d.exit];
    this.stairsTile = { i: exitRoom.cx, j: exitRoom.cy };
    const holes = new Set([w.idx(exitRoom.cx, exitRoom.cy)]);
    const lvl = buildLevel(d, makeAtlas(th), holes);
    w.groups = lvl.groups;
    for (const g of lvl.groups) s3.add(g);
    // 楼梯周围保持空旷
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) w.reserve(exitRoom.cx + di, exitRoom.cy + dj);
    this.rng = makeRng(run.seed + run.floor * 7);
    this.buildTerrain(lvl);
    prewarmCreatures([...th.enemies, 'skeleton', 'slime', 'bat', ...(run.floor >= 3 ? ['slimelet', 'mimic'] : []), ...(d.boss ? [run.floor % 10 === 0 ? 'lich' : 'golem'] : [])]);
    this.player = new Player(w, run, this.save.meta);
    w.player = this.player;
    const sr = d.rooms[d.start];
    const sc = w.center(sr.cx, sr.cy);
    this.player.place(sc.x, sc.z);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) w.reserve(sr.cx + di, sr.cy + dj);
    this.encounters = [];
    this.keyChests = [];
    this.seals = [];
    this.unsealed = false;
    this.boss = null;
    this.bossDefeated = false;
    this.placeContent();
    this.placeTerrainRewards();
    w.discover(d.start);
    if (run.abilities.eye) w.revealAll();
    // 相机
    this.camera = new THREE.PerspectiveCamera(44, platform.width / platform.height, 0.5, 90);
    this.camTarget = new THREE.Vector3(sc.x, this.player.y, sc.z);
    this.zoom = 1;
    this.time = 0;
    this.hudInterval = 0.1;
    this.overlay = null;
    this.banner = { title: '第 ' + run.floor + ' 层 · ' + floorTitle(run.floor), sub: th.name + (d.boss ? ' · 首领之层' : '') + (this.mod ? '　【' + MODIFIERS[this.mod].name + '】' + MODIFIERS[this.mod].desc : ''), t: 0, color: this.mod ? MODIFIERS[this.mod].color : null };
    if (dark) this.player.lantern.intensity = 22;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.btn = { attack: false, dash: false, interact: false, skill: null, jump: false };
    this.prevKeys = {};
    this.initOverlay();
    this.interactRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    this.interactRing.renderOrder = 4;
    this.interactRing.visible = false;
    s3.add(this.interactRing);
    game.audio.playMusic('dungeon');
    game.audio.play('descend');
    run.floorStart = Date.now();
    this.saveRun();
  }

  saveRun() {
    const r = this.run;
    this.save.run = { floor: r.floor, hp: r.hp, maxHp: r.maxHp, abilities: Object.assign({}, r.abilities), coins: r.coins, crystals: r.crystals, kills: r.kills, seed: r.seed, time: r.time || 0, hero: r.hero, mod: r.mod, modFloor: r.modFloor };
    this.game.save.save();
  }

  // ------------------------------------------------------------ 立体地形：保留格子、梯子、弹跳机关、石柱、栏杆、深渊光
  buildTerrain(lvl) {
    const w = this.world, d = this.d, th = this.theme;
    const W = d.W;
    const idx = (i, j) => j * W + i;
    for (let j = 0; j < d.H; j++) for (let i = 0; i < W; i++) {
      const k = idx(i, j);
      if (d.tile[k] === WALL) continue;
      if (d.kind[k] !== K.FLOOR) w.reserve(i, j);
    }
    for (const [k, st] of d.stairs) { const i = k % W, j = (k - i) / W; w.reserve(i - st.di, j - st.dj); w.reserve(i + st.di, j + st.dj); }
    const accent = th.id === 'moss' ? 0x8aff4a : th.id === 'ice' ? 0x7fd8ff : th.id === 'lava' ? 0xff8a3a : 0xc08aff;
    // 梯子
    w.ladders = [];
    for (const L of d.ladders) {
      const fi = L.i + L.di, fj = L.j + L.dj;
      const c = w.center(fi, fj);
      const base = Math.min(8, w.groundAt(c.x, c.z));
      w.reserve(fi, fj);
      const m = makeLadder(L.top - base);
      m.position.set(L.i * T + T / 2 + L.di * T / 2, base, L.j * T + T / 2 + L.dj * T / 2);
      m.rotation.y = Math.atan2(L.di, L.dj);
      w.groups[d.region[idx(L.i, L.j)]].add(m);
      w.ladders.push(Object.assign({ base }, L));
    }
    // 弹跳机关
    w.bouncePads = [];
    for (const b of d.bounce) {
      const c = w.center(b.i, b.j);
      const y = Math.min(8, w.groundAt(c.x, c.z));
      const pad = makeBouncePad(accent);
      pad.root.position.set(c.x, y, c.z);
      const reg = d.region[idx(b.i, b.j)];
      w.groups[reg].add(pad.root);
      w.reserve(b.i, b.j);
      const o = { x: c.x, z: c.z, y, t: 1, trigger: () => { o.t = 0; w.audio.play('boing'); this.fx.sparks(c.x, y + 0.5, c.z, 12, accent, 5); } };
      w.bouncePads.push(o);
      w.addLight({ x: c.x, y: y + 0.8, z: c.z, color: accent, intensity: 3, range: 4.5, region: reg, priority: 0.6 });
      w.updatables.push({ update: (dt) => {
        o.t = Math.min(1, o.t + dt * 2.5);
        const k = o.t < 1 ? Math.sin(o.t * Math.PI * 4) * (1 - o.t) : 0;
        pad.cap.scale.set(1 - k * 0.25, 1 + k * 1.4, 1 - k * 0.25);
        pad.glow.material.opacity = 0.3 + (1 - o.t) * 0.6 + Math.sin(w.time * 3) * 0.05;
      } });
    }
    // 深渊石柱（可坍塌）
    this.stones = [];
    for (const st of d.stones) {
      const k = idx(st.i, st.j);
      const m = new THREE.Mesh(columnGeometry(PIT, st.h, T * 0.94), st.crumble ? crumbleMat(lvl.tmat) : lvl.tmat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(st.i * T + T / 2, 0, st.j * T + T / 2);
      w.groups[d.region[k]].add(m);
      if (st.fire) {
        // 喷火石柱：顶部嵌一圈金属喷口
        const b = new Builder();
        b.add(Geo.torus(0.14), 0x3a3438, 0, st.h + 0.03, 0, 0.9, 0.9, 0.9, Math.PI / 2, 0, 0);
        b.add(Geo.cyl(10), 0x1a1214, 0, st.h + 0.02, 0, 0.5, 0.03, 0.5);
        m.add(b.mesh(false));
        const gl = glowSprite(0xff4a1a, 2.4, 0); gl.position.y = st.h + 0.3; m.add(gl);
        st.glow = gl;
      }
      if (st.crumble) {
        // 顶面醒目的发光裂纹 + 侧面碎石缺口：告诉玩家「这块会塌」
        const b = new Builder();
        const cr = [[0.1, 0, 1.4, 0.6], [-0.25, 0.2, 1.0, -0.9], [0.3, -0.35, 0.7, 0.2], [-0.45, -0.3, 0.5, 1.3], [0.45, 0.4, 0.5, -0.4]];
        for (const [x, z, l, a] of cr) b.add(Geo.box(), 0xffffff, x, st.h + 0.015, z, l, 0.02, 0.07, 0, a, 0);
        for (const [x, z, a] of [[-0.9, 0.3, 0], [0.9, -0.2, Math.PI], [0.2, 0.9, Math.PI / 2], [-0.3, -0.9, -Math.PI / 2]]) b.add(Geo.box(), 0xffffff, x, st.h - 0.35, z, 0.05, 0.5, 0.08, 0, a, 0.3);
        const crack = new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.8 }));
        m.add(crack);
        st.crack = crack;
        const cb = new Builder();
        for (let q = 0; q < 5; q++) cb.add(Geo.dode(), 0x6a5a58, (Math.random() - 0.5) * 1.6, st.h + 0.06, (Math.random() - 0.5) * 1.6, 0.18, 0.12, 0.18, q, q, q);
        m.add(cb.mesh(false));
      }
      this.stones.push({ st, m, k, state: 'idle', t: 0 });
    }
    if (this.stones.length) w.updatables.push({ update: (dt) => this.updateStones(dt) });
    // 移动平台 / 升降台
    for (const mv of d.movers || []) new MovingPlatform(w, mv, accent);
    // 跳台机关：摆锤、飞镖墙
    for (const jt of d.jumpTraps || []) createTrap(w, jt);
    // 深渊底部的光
    const pitCol = { lava: [0xff5a10, 0.75], ice: [0x2a6adf, 0.22], moss: [0x2adf7a, 0.16], crypt: [0x6a3adf, 0.2] }[th.id] || [0x8a4aff, 0.35];
    const byReg = new Map();
    this.pitTiles = [];
    for (let k = 0; k < W * d.H; k++) {
      if (d.kind[k] !== K.PIT && d.kind[k] !== K.STONE) continue;
      const r = d.region[k];
      if (!byReg.has(r)) byReg.set(r, new Builder());
      const i = k % W, j = (k - i) / W;
      byReg.get(r).add(Geo.box(), 0xffffff, i * T + T / 2, PIT + 0.3, j * T + T / 2, T, 0.02, T);
      this.pitTiles.push({ x: i * T + T / 2, z: j * T + T / 2, r });
    }
    const pitMat = new THREE.MeshBasicMaterial({ color: pitCol[0], transparent: true, opacity: pitCol[1], blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (const [r, b] of byReg) {
      const m = b.mesh(false, pitMat); m.renderOrder = 2;
      w.groups[r].add(m);
      const room = d.roomByRegion[r];
      if (room) w.addLight({ x: (room.x + room.w / 2) * T, y: -0.6, z: (room.y + room.h / 2) * T, color: pitCol[0], intensity: th.id === 'lava' ? 9 : 4, range: 10, region: r, priority: 0.7 });
    }
    // 回廊栏杆
    for (const room of d.rooms) {
      const tr = room.terrain;
      if (!tr || tr.kind !== 'balcony') continue;
      const out = [-tr.rise[0], -tr.rise[1]];
      for (const t of tr.tiles) {
        if (t.v !== 1) continue;
        const [fi, fj] = tr.map(t.u, 2);
        if (d.stairs.has(idx(fi, fj)) || d.ladders.some((L) => L.i === t.i && L.j === t.j)) continue;
        const rail = makeRailing(T, true);
        rail.position.set(t.i * T + T / 2 + out[0] * (T / 2 - 0.12), HIGH, t.j * T + T / 2 + out[1] * (T / 2 - 0.12));
        rail.rotation.y = out[0] ? Math.PI / 2 : 0;
        w.groups[room.id].add(rail);
      }
    }
  }
  updateStones(dt) {
    const w = this.world, p = this.player, d = this.d;
    for (const s of this.stones) {
      if (s.st.fire) this.updateBurner(s, dt);
      if (!s.st.crumble) continue;
      s.t += dt;
      if (s.state === 'idle') {
        if (s.st.crack) s.st.crack.material.opacity = 0.55 + Math.sin(w.time * 3 + s.k) * 0.2;
        if (p.grounded && w.tileOf(p.x) === s.st.i && w.tileOf(p.z) === s.st.j && Math.abs(p.y - s.st.h) < 0.2) {
          s.state = 'shake'; s.t = 0; w.audio.play('crumble');
          if (!this.crumbleHint) { this.crumbleHint = true; this.game.hud.toast('发光裂纹的石柱会塌，快跳走！', '#ffb070'); }
        }
      } else if (s.state === 'shake') {
        if (s.st.crack) { s.st.crack.material.opacity = 0.9; s.st.crack.material.color.setHex(Math.floor(s.t * 12) % 2 ? 0xffe070 : 0xff5a20); }
        s.m.position.x = s.st.i * T + T / 2 + (Math.random() - 0.5) * 0.12;
        s.m.position.z = s.st.j * T + T / 2 + (Math.random() - 0.5) * 0.12;
        if (Math.random() < 0.4) this.fx.dust(s.m.position.x, s.st.h, s.m.position.z, 1, 0x6a6070);
        if (s.t > 0.9) {
          s.state = 'fall'; s.t = 0;
          d.kind[s.k] = K.PIT; d.hgt[s.k] = PIT;
          this.fx.debris(s.m.position.x, s.st.h, s.m.position.z, 8, 0x5a5460, 4);
          w.audio.play('rockhit');
        }
      } else if (s.state === 'fall') {
        s.m.position.y = -s.t * s.t * 10;
        if (s.t > 0.9) s.m.visible = false;
        if (s.t > 3.6) { s.state = 'rise'; s.t = 0; s.m.visible = true; s.m.position.x = s.st.i * T + T / 2; s.m.position.z = s.st.j * T + T / 2; }
      } else if (s.state === 'rise') {
        const k = Math.min(1, s.t / 0.8);
        s.m.position.y = -6 * (1 - k) * (1 - k);
        if (k >= 1) { s.state = 'idle'; s.m.position.y = 0; if (s.st.crack) s.st.crack.material.color.setHex(0xff9a4a); d.kind[s.k] = K.STONE; d.hgt[s.k] = s.st.h; this.fx.magic(s.m.position.x, s.st.h, s.m.position.z, 0x9fd8ff, 8, 0.6); }
      }
    }
  }
  // 喷火石柱：预警（冒火星、发红光）→ 喷出火柱
  updateBurner(s, dt) {
    const w = this.world, p = this.player, st = s.st;
    if (!w.discovered[this.d.region[s.k]]) return;
    const period = 3.4;
    const u = (w.time + st.phase) % period;
    const x = st.i * T + T / 2, z = st.j * T + T / 2;
    const warn = u > period - 1.9 && u < period - 1.1, fire = u >= period - 1.1;
    st.glow.material.opacity = warn ? 0.3 + Math.sin(w.time * 30) * 0.2 : fire ? 0.9 : 0;
    if (warn && Math.random() < dt * 20) w.fx.sparks(x, st.h + 0.1, z, 1, 0xffa03a, 2);
    if (fire) {
      if (!s.burning) { s.burning = true; if (Math.hypot(p.x - x, p.z - z) < 14) w.audio.play('flame'); }
      if (Math.random() < dt * 40) w.fx.fire(x + (Math.random() - 0.5) * 0.5, st.h + 0.2 + Math.random() * 1.8, z + (Math.random() - 0.5) * 0.5, 1, 1.2, 0xffd040, 0xff3a10, 0.35);
      if (p.alive && Math.abs(p.x - x) < 0.95 && Math.abs(p.z - z) < 0.95 && p.y < st.h + 2.2 && p.y > st.h - 0.5) p.hurt(1, x, z, 'trap');
    } else s.burning = false;
  }
  placeTerrainRewards() {
    const w = this.world, d = this.d, rng = this.rng;
    for (const r of d.rewards) {
      const c = w.center(r.i, r.j);
      const y = w.groundAt(c.x, c.z);
      if (r.kind === 'crystal') w.spawnPickup('crystal', c.x, c.z, { burst: false, y: y + 0.6 });
      else for (let q = 0; q < 3; q++) w.spawnPickup('coin', c.x + (q - 1) * 0.4, c.z, { burst: false, y: y + 0.6, value: 2 });
      w.addLight({ x: c.x, y: y + 1, z: c.z, color: r.kind === 'crystal' ? 0xc89aff : 0xffcf4a, intensity: 3, range: 4, region: d.region[r.j * d.W + r.i], priority: 0.5 });
    }
    for (const room of d.rooms) {
      const tr = room.terrain;
      if (!tr || !tr.top || room.type === 'treasure' || room.type === 'parkour') continue;
      if (tr.kind === 'dais' && rng() < 0.5) continue;
      if (tr.kind === 'sunken') continue;
      const t = tr.top;
      if (w.solid[t.j * d.W + t.i]) continue;
      new Chest(w, t.i, t.j, { coins: 5 + d.floor * 2, crystal: tr.kind === 'dais' ? 0 : 1, heart: rng() < 0.3 }, { face: rng() * 6 });
    }
  }

  // ------------------------------------------------------------ 内容摆放
  placeContent() {
    const w = this.world, d = this.d, rng = this.rng;
    const f = d.floor;
    // 先放谜题（需要空间）
    for (const room of d.rooms) {
      if (room.type !== 'puzzle') continue;
      const loot = room.hasKey ? { key: true, coins: 3 } : { coins: 6 + f, crystal: 1 };
      let puzzle = createPuzzle(w, room, room.puzzle, rng, () => this.onPuzzleSolved(room));
      if (!puzzle) {
        // 退化：换一种谜题
        for (const alt of ['levers', 'crates', 'runes']) { puzzle = createPuzzle(w, room, alt, rng, () => this.onPuzzleSolved(room)); if (puzzle) break; }
      }
      room.puzzleObj = puzzle;
      const spot = (puzzle && puzzle.chestSpot) || this.freeSpot(room, true) || this.freeSpot(room, false);
      if (spot) {
        const ch = new Chest(w, spot.i, spot.j, loot, { caged: !!puzzle });
        room.chest = ch;
        if (loot.key) this.keyChests.push(ch);
      }
    }
    for (const room of d.rooms) {
      switch (room.type) {
        case 'exit': case 'boss': this.setupExit(room); break;
        case 'monster': this.encounters.push(new Encounter(this, room)); break;
        case 'trap': this.setupTrapRoom(room); break;
        case 'treasure': this.setupTreasure(room); break;
        case 'shrine': this.setupShrine(room); break;
        case 'shop': this.shop = new Shop(w, room, this); break;
        case 'prison': { const c = this.freeSpot(room, true); if (c) new Prisoner(w, c.i, c.j, this, (d.seed + room.id * 7) >>> 0); break; }
        case 'library': this.setupLibrary(room); break;
        case 'arena': this.encounters.push(new Encounter(this, room, { waves: 2 })); break;
        case 'secret': this.setupSecret(room); break;
        case 'parkour': this.setupParkour(room); break;
        case 'gauntlet': this.setupGauntlet(room); break;
        case 'maze': this.setupMaze(room); break;
        default: break;
      }
    }
    for (const room of d.rooms) this.decorate(room);
    // 氛围：贴花、挂饰、杂物、天光、地雾、小生物
    this.amb = new Ambience(this);
    for (const room of d.rooms) this.amb.enrichRoom(room);
    for (const t of d.traps) createTrap(w, t);
    for (const wd of d.wanderers) {
      const c = w.center(wd.i, wd.j);
      const pool = this.theme.enemies.filter((k) => k !== 'archer');
      new Enemy(w, rng() < 0.5 ? wd.kind : pool[Math.floor(rng() * pool.length)], c.x, c.z, {});
    }
    // 主题地形危害：部分房间出现熔岩池 / 毒沼 / 冰面
    if (this.theme.hazard) {
      for (const room of d.rooms) {
        if (['empty', 'monster', 'treasure', 'arena', 'trap'].indexOf(room.type) < 0) continue;
        if (room.type !== 'trap' && rng() > 0.45) continue;
        const cells = [];
        const n = room.type === 'trap' ? 6 : this.theme.hazard === 'ice' ? 5 : 3;
        const seedC = this.freeSpot(room, true);
        if (!seedC) continue;
        const q = [seedC];
        const seen = new Set([seedC.i + ',' + seedC.j]);
        while (q.length && cells.length < n) {
          const c = q.splice(Math.floor(rng() * q.length), 1)[0];
          if (!w.isFree(c.i, c.j) || c.i <= room.x || c.j <= room.y || c.i >= room.x + room.w - 1 || c.j >= room.y + room.h - 1) continue;
          cells.push(c);
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k2 = (c.i + di) + ',' + (c.j + dj); if (!seen.has(k2)) { seen.add(k2); q.push({ i: c.i + di, j: c.j + dj }); } }
        }
        if (cells.length) new HazardPool(w, cells, this.theme.hazard);
      }
    }
    // 走廊火把
    for (const cor of d.corridors) {
      if (cor.tiles.length < 5) continue;
      const k = cor.tiles[Math.floor(cor.tiles.length / 2)];
      const i = k % d.W, j = (k - i) / d.W;
      if (w.isWall(i, j - 1)) placeTorch(w, i * T + 1, j * T + 0.05, 0, cor.id, this.theme);
      else if (w.isWall(i - 1, j)) placeTorch(w, i * T + 0.05, j * T + 1, Math.PI / 2, cor.id, this.theme);
      else if (w.isWall(i + 1, j)) placeTorch(w, i * T + T - 0.05, j * T + 1, -Math.PI / 2, cor.id, this.theme);
    }
  }
  freeSpot(room, interior) {
    const w = this.world;
    const cells = [];
    for (let j = room.y; j < room.y + room.h; j++) for (let i = room.x; i < room.x + room.w; i++) {
      const inner = i > room.x && i < room.x + room.w - 1 && j > room.y && j < room.y + room.h - 1;
      if (interior && !inner) continue;
      if (!interior && inner) continue;
      if (w.isFree(i, j)) cells.push({ i, j, d: Math.abs(i - room.cx) + Math.abs(j - room.cy) });
    }
    if (!cells.length) return null;
    cells.sort((a, b) => b.d - a.d);
    return cells[Math.floor(this.rng() * Math.min(4, cells.length))];
  }
  setupExit(room) {
    const w = this.world;
    const st = this.stairsTile;
    this.stairs = new Stairs(w, st.i, st.j, () => this.descend());
    if (room.type === 'boss') {
      this.stairs.root.visible = false;
      this.stairs.active = false;
      const b = new Builder();
      b.add(Geo.box(), 0x4a4452, 0, 0.1, 0, 2, 0.2, 2, 0, 0, 0, 0.5);
      b.add(Geo.box(), 0x5a5462, 0, 0.22, 0, 1.6, 0.06, 1.6);
      this.cover = b.mesh(false);
      const c = w.center(st.i, st.j);
      this.cover.position.set(c.x, 0, c.z);
      w.addAt(this.cover, st.i, st.j);
    }
    for (const e of room.entrances) {
      const g = new Gate(w, e, 'seal');
      this.seals.push(g);
      w.addInteract({
        x: g.x, z: g.z, radius: 2.3, icon: 'key',
        get label() { return '解除封印'; },
        enabled: () => g.closed && !this.unsealed,
        interact: () => this.tryUnseal(),
      });
    }
    if (room.type === 'boss') this.encounters.push(new Encounter(this, room, { boss: true, gates: this.seals }));
  }
  tryUnseal() {
    const need = this.d.keysNeeded;
    if (this.run.keys < need) {
      this.game.audio.play('error');
      this.game.hud.toast('封印需要 ' + need + ' 把钥匙（还差 ' + (need - this.run.keys) + ' 把）', '#ff8a7a');
      return;
    }
    this.unsealed = true;
    for (const g of this.seals) g.open();
    this.game.hud.toast(this.d.boss ? '封印解除……深处传来低吼' : '封印解除！前往楼梯', '#7fd8ff');
    this.game.hud.dirty = true;
  }
  setupTrapRoom(room) {
    const w = this.world, rng = this.rng;
    const spot = this.freeSpot(room, true);
    if (spot) new Chest(w, spot.i, spot.j, { coins: 8 + this.d.floor, crystal: rng() < 0.6 ? 1 : 0, heart: rng() < 0.4 });
    const par = rng() < 0.5 ? 0 : 1;
    for (const c of w.interior(room)) {
      if (!w.isFree(c.i, c.j)) continue;
      if ((c.i + c.j) % 2 === par || rng() < 0.25) new Spikes(w, c.i, c.j, ((c.i + c.j) % 2) * 1.3, 2.6);
    }
  }
  setupParkour(room) {
    const w = this.world, t = room.terrain && room.terrain.top;
    if (!t) return;
    const c = w.center(t.i, t.j);
    new Chest(w, t.i, t.j, { coins: 12 + this.d.floor * 3, crystal: 2, heart: true });
    const y = w.groundAt(c.x, c.z);
    w.addLight({ x: c.x, y: y + 1.6, z: c.z, color: 0xffd86a, intensity: 8, range: 7, region: room.id, priority: 1.5 });
    const g = glowSprite(0xffd86a, 4, 0.35); g.position.set(c.x, y + 1.2, c.z); w.groups[room.id].add(g);
    let told = false;
    w.updatables.push({ update: () => {
      if (told) return false;
      const p = this.player;
      const i = w.tileOf(p.x), j = w.tileOf(p.z);
      if (i >= room.x && i < room.x + room.w && j >= room.y && j < room.y + room.h) { told = true; this.game.hud.toast('深渊跳台：跳过石柱登上中央孤岛' + (this.d.floor >= 3 ? '（带裂纹的石柱会坍塌！）' : ''), '#9fe8ff'); }
      return true;
    } });
  }
  // 刀阵回廊：几排错开相位的摆锤斧 + 周期地刺，尽头放宝箱
  setupGauntlet(room) {
    const w = this.world, rng = this.rng, d = this.d;
    const flat = (i, j) => d.kind[j * d.W + i] === K.FLOOR && w.isFree(i, j);
    const along = room.w >= room.h ? 0 : 1; // 沿长边摆放多排
    const n = along === 0 ? room.w : room.h, m = along === 0 ? room.h : room.w;
    for (let a = 2; a < n - 2; a += 3) {
      for (let b = 1; b < m - 1; b += 2) {
        const i = along === 0 ? room.x + a : room.x + b, j = along === 0 ? room.y + b : room.y + a;
        if (!flat(i, j)) continue;
        // 摆动方向沿长边：穿过这一排时要看准时机
        new Pendulum(w, { i, j, di: along === 0 ? 1 : 0, dj: along === 0 ? 0 : 1, phase: a * 1.3 + b * 0.9 });
      }
      // 两排摆锤之间撒几块地刺
      const a2 = a + 1;
      if (a2 < n - 1) for (let b = 1; b < m - 1; b++) {
        const i = along === 0 ? room.x + a2 : room.x + b, j = along === 0 ? room.y + b : room.y + a2;
        if (flat(i, j) && rng() < 0.35) new Spikes(w, i, j, b * 0.4, 2.4);
      }
    }
    const spot = this.freeSpot(room, false);
    if (spot) new Chest(w, spot.i, spot.j, { coins: 10 + d.floor * 2, crystal: 1, heart: rng() < 0.5 });
    // 地面红色警示条纹，一眼看出这是刀阵
    const g = w.groups[room.id];
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let a = 2; a < n - 2; a += 3) {
      const len = (m - 2) * T;
      const geo = along === 0 ? new THREE.PlaneGeometry(0.5, len) : new THREE.PlaneGeometry(len, 0.5);
      const s = new THREE.Mesh(geo.rotateX(-Math.PI / 2), mat);
      const cx = along === 0 ? (room.x + a) * T + T / 2 : (room.x + room.w / 2) * T;
      const cz = along === 0 ? (room.y + room.h / 2) * T : (room.y + a) * T + T / 2;
      s.position.set(cx, 0.03, cz); s.renderOrder = 1; g.add(s);
    }
    w.addLight({ x: (room.x + room.w / 2) * T, y: 2.4, z: (room.y + room.h / 2) * T, color: 0xff6a3a, intensity: 5, range: 9, region: room.id, priority: 0.6 });
  }
  // 迷宫密室：房间里生成一座迷宫（主题化墙体：树篱 / 石墙 / 冰墙 / 黑曜石），最远的死角放宝箱，还有守卫
  setupMaze(room) {
    const w = this.world, rng = this.rng, d = this.d, th = this.theme;
    const W = room.w, H = room.h;
    const open = new Uint8Array(W * H);
    const L = (u, v) => v * W + u;
    const inb = (u, v) => u >= 0 && v >= 0 && u < W && v < H;
    // 深度优先生成：偶数格为房间，奇数格为墙或通道
    const st = [[0, 0]]; open[L(0, 0)] = 1;
    while (st.length) {
      const [u, v] = st[st.length - 1];
      const nb = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([a, b]) => [u + a, v + b, u + a / 2, v + b / 2]).filter(([a, b]) => inb(a, b) && !open[L(a, b)]);
      if (!nb.length) { st.pop(); continue; }
      const [a, b, ma, mb] = nb[Math.floor(rng() * nb.length)];
      open[L(ma, mb)] = 1; open[L(a, b)] = 1; st.push([a, b]);
    }
    // 每个入口都打通到最近的迷宫格
    for (const e of room.entrances) {
      let u = e.i - e.dir[0] - room.x, v = e.j - e.dir[1] - room.y;
      if (!inb(u, v)) continue;
      const tu = u % 2 ? (u - 1 >= 0 ? u - 1 : u + 1) : u, tv = v % 2 ? (v - 1 >= 0 ? v - 1 : v + 1) : v;
      open[L(u, v)] = 1;
      while (u !== tu) { u += Math.sign(tu - u); open[L(u, v)] = 1; }
      while (v !== tv) { v += Math.sign(tv - v); open[L(u, v)] = 1; }
    }
    // 为了不太憋屈，随机再打通几堵墙（出现环路）
    for (let q = 0; q < Math.floor(W * H / 14); q++) { const u = rng.int(0, W - 1), v = rng.int(0, H - 1); if ((u + v) % 2 === 1) open[L(u, v)] = 1; }
    const col = th.id === 'moss' ? [0x3e7a34, 0x58a048] : th.id === 'ice' ? [0x9ac8e8, 0xd8f0ff] : th.id === 'lava' ? [0x2a1e22, 0xff6a20] : [0x6a6470, 0x8a8490];
    const b = new Builder();
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
      const i = room.x + u, j = room.y + v;
      if (open[L(u, v)]) { w.reserve(i, j); continue; }
      if (!w.isFree(i, j)) { open[L(u, v)] = 1; continue; }
      const c = w.center(i, j);
      if (th.id === 'moss') {
        b.add(Geo.box(), col[0], c.x, 0.8, c.z, T * 0.96, 1.6, T * 0.96);
        for (let k = 0; k < 4; k++) b.add(Geo.ico(), k % 2 ? col[1] : col[0], c.x + (k % 2 - 0.5) * 0.9, 1.55 + (k >> 1) * 0.1, c.z + ((k >> 1) - 0.5) * 0.9, 0.9, 0.5, 0.9);
      } else if (th.id === 'ice') {
        b.add(Geo.box(), col[0], c.x, 0.8, c.z, T * 0.94, 1.6, T * 0.94);
        b.add(Geo.oct(), col[1], c.x, 1.75, c.z, 0.6, 0.6, 0.6);
      } else {
        b.add(Geo.box(), col[0], c.x, 0.8, c.z, T * 0.96, 1.6, T * 0.96);
        b.add(Geo.box(), col[1], c.x, 1.64, c.z, T * 1.0, 0.1, T * 1.0);
      }
      w.setSolid(i, j, true, null, 0);
      w.reserve(i, j);
    }
    const g = w.groups[room.id];
    const mesh = b.mesh(true); g.add(mesh);
    // 找离入口最远的迷宫格放宝箱
    const e0 = room.entrances[0];
    const s0 = e0 ? [e0.i - e0.dir[0] - room.x, e0.j - e0.dir[1] - room.y] : [0, 0];
    const dist = new Int16Array(W * H).fill(-1); const q = [s0]; dist[L(s0[0], s0[1])] = 0; let far = s0;
    while (q.length) { const [u, v] = q.shift(); if (dist[L(u, v)] > dist[L(far[0], far[1])]) far = [u, v]; for (const [a, bb] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nu = u + a, nv = v + bb; if (inb(nu, nv) && open[L(nu, nv)] && dist[L(nu, nv)] < 0) { dist[L(nu, nv)] = dist[L(u, v)] + 1; q.push([nu, nv]); } } }
    const ci = room.x + far[0], cj = room.y + far[1];
    w.reserved[w.idx(ci, cj)] = 0;
    new Chest(w, ci, cj, { coins: 12 + d.floor * 2, crystal: 1, heart: true });
    const cc = w.center(ci, cj);
    w.addLight({ x: cc.x, y: 1.6, z: cc.z, color: 0xffcf4a, intensity: 5, range: 6, region: room.id, priority: 0.8 });
    // 两个守卫在迷宫里巡逻
    const pool = th.enemies.filter((k) => k !== 'archer');
    for (let k = 0; k < 2; k++) {
      const u = rng.int(0, W - 1), v = rng.int(0, H - 1);
      if (!open[L(u, v)] || dist[L(u, v)] < 4) continue;
      const c = w.center(room.x + u, room.y + v);
      new Enemy(w, pool[Math.floor(rng() * pool.length)], c.x, c.z, {});
    }
  }
  setupTreasure(room) {
    const w = this.world, rng = this.rng;
    const spot = (room.terrain && room.terrain.top) || this.freeSpot(room, true);
    if (!spot) return;
    if (this.d.floor >= 3 && rng() < 0.25) {
      w.reserve(spot.i, spot.j);
      const c = w.center(spot.i, spot.j);
      new Enemy(w, 'mimic', c.x, c.z, { room });
    } else new Chest(w, spot.i, spot.j, { coins: 10 + this.d.floor * 2, heart: rng() < 0.5, crystal: rng() < 0.35 ? 1 : 0 });
  }
  setupLibrary(room) {
    const w = this.world, rng = this.rng;
    for (let i = room.x; i < room.x + room.w; i += 1) {
      if (!w.isWall(i, room.y - 1) || !w.isFree(i, room.y) || rng() < 0.3) continue;
      const b = makeBookshelf(rng.int(1, 999));
      const c = w.center(i, room.y);
      b.position.set(c.x, 0, room.y * T + 0.3);
      w.groups[room.id].add(b);
      w.setSolid(i, room.y, true, null, 2.2); w.reserve(i, room.y);
    }
    const c1 = this.freeSpot(room, true);
    if (c1) new LoreBook(w, c1.i, c1.j);
    const c2 = this.freeSpot(room, true);
    if (c2) { const t = makeCandleTable(rng.int(1, 999)); const c = w.center(c2.i, c2.j); t.position.set(c.x, 0, c.z); w.groups[room.id].add(t); w.setSolid(c2.i, c2.j, true, null, 0.78); w.reserve(c2.i, c2.j); w.addLight({ x: c.x, y: 1.4, z: c.z, color: 0xffb04a, intensity: 5, range: 6, flicker: true, region: room.id }); }
  }
  setupSecret(room) {
    const w = this.world;
    new CrackedWall(w, room.connector.i, room.connector.j, room.id);
    const c = { i: room.cx, j: room.cy };
    new Chest(w, c.i, c.j, { coins: 16 + this.d.floor * 3, crystal: 2, heart: true });
    w.addLight({ x: c.i * T + 1, y: 1.5, z: c.j * T + 1, color: 0xffd86a, intensity: 8, range: 6, region: room.id });
    const g = glowSprite(0xffd86a, 5, 0.3); g.position.set(c.i * T + 1, 1, c.j * T + 1); w.groups[room.id].add(g);
  }
  setupShrine(room) {
    const w = this.world;
    const c = { i: room.cx, j: room.cy };
    if (!w.isFree(c.i, c.j)) return;
    if (this.rng() < 0.55) { new Fountain(w, c.i, c.j); room.shrine = 'fountain'; }
    else {
      const price = 80 + this.d.floor * 25;
      new Altar(w, c.i, c.j, price, () => this.openChoice(true));
      room.shrine = 'altar';
    }
  }
  decorate(room) {
    const w = this.world, rng = this.rng;
    const reg = room.id;
    // 火把
    const cand = [];
    for (const frac of [0.3, 0.7]) cand.push({ i: room.x + Math.round((room.w - 1) * frac), j: room.y - 1, side: 'n' });
    if (room.h >= 7) { cand.push({ i: room.x - 1, j: room.y + (room.h >> 1), side: 'w' }); cand.push({ i: room.x + room.w, j: room.y + (room.h >> 1), side: 'e' }); }
    for (const c of cand) {
      if (!w.isWall(c.i, c.j)) continue;
      if (c.side === 'n') placeTorch(w, c.i * T + 1, room.y * T + 0.05, 0, reg, this.theme);
      else if (c.side === 'w') placeTorch(w, room.x * T + 0.05, c.j * T + 1, Math.PI / 2, reg, this.theme);
      else placeTorch(w, (room.x + room.w) * T - 0.05, c.j * T + 1, -Math.PI / 2, reg, this.theme);
    }
    // 旗帜
    if (room.w >= 7 && rng() < 0.7) {
      const i = room.x + (room.w >> 1);
      if (w.isWall(i, room.y - 1) && this.d.kind[room.y * this.d.W + i] === K.FLOOR) {
        if (!_banner) { _banner = patternTexture('banner'); _banner.userData.keep = true; }
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.0), new THREE.MeshLambertMaterial({ map: _banner, side: THREE.DoubleSide }));
        m.position.set(i * T + 1, 1.5, room.y * T + 0.06);
        w.groups[reg].add(m);
      }
    }
    // 地毯
    if (room.type === 'start' || room.type === 'shrine' || (room.type === 'treasure' && rng() < 0.5)) {
      if (!_rug) { _rug = patternTexture('rug'); _rug.userData.keep = true; }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, Math.min(room.h - 2, 5) * T).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: _rug }));
      m.position.set(room.cx * T + 1, 0.02, (room.y + room.h / 2) * T);
      m.receiveShadow = true;
      w.groups[reg].add(m);
    }
    const t = room.type;
    // 柱子
    if ((t === 'empty' || t === 'monster' || t === 'start' || t === 'treasure' || t === 'boss') && room.w >= 8 && room.h >= 8) {
      for (const [pi, pj] of [[room.x + 2, room.y + 2], [room.x + room.w - 3, room.y + 2], [room.x + 2, room.y + room.h - 3], [room.x + room.w - 3, room.y + room.h - 3]]) {
        if (!w.isFree(pi, pj)) continue;
        const p = makePillar(WH);
        const c = w.center(pi, pj);
        p.position.set(c.x, 0, c.z);
        w.groups[reg].add(p);
        w.setSolid(pi, pj, true);
        w.reserve(pi, pj);
      }
    }
    // 可破坏物
    if (t !== 'puzzle' && t !== 'exit' && t !== 'boss') {
      for (const [ci, cj] of [[room.x, room.y], [room.x + room.w - 1, room.y], [room.x, room.y + room.h - 1], [room.x + room.w - 1, room.y + room.h - 1]]) {
        if (rng() < 0.55 && w.isFree(ci, cj)) new Breakable(w, ci, cj, rng() < 0.5 ? 'barrel' : 'pot', rng.int(1, 999));
      }
    }
    // 骨头碎石
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const i = rng.int(room.x, room.x + room.w - 1), j = rng.int(room.y, room.y + room.h - 1);
      if (!w.isFree(i, j)) continue;
      const m = rng() < 0.5 ? makeBones(rng.int(1, 999)) : makeRubble(rng.int(1, 999));
      const c = w.center(i, j);
      m.position.set(c.x + rng.range(-0.5, 0.5), 0, c.z + rng.range(-0.5, 0.5));
      m.rotation.y = rng() * 6;
      w.groups[reg].add(m);
    }
    this.themeDecor(room);
  }
  // 主题装饰：让每种场景都有独特的氛围
  themeDecor(room) {
    const w = this.world, rng = this.rng, th = this.theme, reg = room.id;
    const g = w.groups[reg];
    const corners = [[room.x, room.y, 1, 1], [room.x + room.w, room.y, -1, 1]];
    const wallFace = () => {
      // 北墙随机一处墙面
      const i = rng.int(room.x, room.x + room.w - 1);
      return w.isWall(i, room.y - 1) && this.d.kind[room.y * this.d.W + i] === K.FLOOR ? { x: i * T + 1, z: room.y * T + 0.05 } : null;
    };
    // solid：true 为不可站立障碍，数字为可跳上去站立的高度
    const floorSpot = (solid) => {
      for (let t = 0; t < 12; t++) {
        const i = rng.int(room.x, room.x + room.w - 1), j = rng.int(room.y, room.y + room.h - 1);
        if (!w.isFree(i, j)) continue;
        if (solid) { w.setSolid(i, j, true, null, typeof solid === 'number' ? solid : 0); w.reserve(i, j); }
        const c = w.center(i, j);
        return { i, j, x: c.x, z: c.z };
      }
      return null;
    };
    const small = room.type === 'puzzle' || room.type === 'exit' || room.type === 'boss' || room.type === 'secret';
    const n = small ? 1 : rng.int(2, 3);
    for (const key of th.decor) {
      if (rng() < 0.45) continue;
      for (let k = 0; k < (key === 'cobweb' || key === 'vines' ? 2 : 1); k++) {
        switch (key) {
          case 'cobweb': {
            const cc = corners[k % 2];
            if (!w.isWall(cc[0] - (cc[2] > 0 ? 1 : 0), cc[1] - 1)) break;
            const web = makeCobweb(1.8);
            web.position.set(cc[0] * T, WH - 0.5, cc[1] * T + 0.3);
            web.rotation.set(0, cc[2] > 0 ? Math.PI / 4 : -Math.PI / 4, cc[2] > 0 ? Math.PI : Math.PI / 2);
            g.add(web);
            break;
          }
          case 'chains': { const f = wallFace(); if (!f) break; const c = makeChains(1.2 + rng() * 0.8); c.position.set(f.x + rng.range(-0.5, 0.5), WH, f.z + 0.2); g.add(c); break; }
          case 'coffin': { if (small) break; const s2 = floorSpot(0.68); if (!s2) break; const c = makeCoffin(rng.int(0, 99)); c.position.set(s2.x, 0, s2.z); g.add(c); break; }
          case 'bookshelf': { const i = rng.int(room.x, room.x + room.w - 1); if (!w.isWall(i, room.y - 1) || !w.isFree(i, room.y) || small) break; const b = makeBookshelf(rng.int(1, 999)); b.position.set(i * T + 1, 0, room.y * T + 0.3); g.add(b); w.setSolid(i, room.y, true, null, 2.2); w.reserve(i, room.y); break; }
          case 'table': { if (small) break; const s2 = floorSpot(0.78); if (!s2) break; const t = makeCandleTable(rng.int(1, 999)); t.position.set(s2.x, 0, s2.z); g.add(t); w.addLight({ x: s2.x, y: 1.4, z: s2.z, color: 0xffb04a, intensity: 4, range: 5, flicker: true, region: reg }); break; }
          case 'mushrooms': for (let q = 0; q < n; q++) { const s2 = floorSpot(false); if (!s2) break; const m = makeMushrooms(rng.int(1, 999), rng() < 0.5 ? 0x4affc0 : 0x9a7aff); m.position.set(s2.x + rng.range(-0.4, 0.4), 0, s2.z + rng.range(-0.4, 0.4)); m.scale.setScalar(0.8); g.add(m); if (q === 0) w.addLight({ x: s2.x, y: 1, z: s2.z, color: 0x4affc0, intensity: 4, range: 5, region: reg, priority: 0.7 }); } break;
          case 'vines': { const f = wallFace(); if (!f) break; const v = makeVines(rng.int(1, 999), 2.4); v.position.set(f.x, 0.1, f.z); g.add(v); break; }
          case 'roots': { const s2 = floorSpot(false); if (!s2) break; const r = makeRoots(rng.int(1, 999)); r.position.set(s2.x, 0, s2.z); g.add(r); break; }
          case 'puddle': { const s2 = floorSpot(false); if (!s2) break; const p = makePool('ice', 1.4, 1.1); p.surf.material.color.setHex(0x2a4a3a); p.root.position.set(s2.x, -0.05, s2.z); g.add(p.root); break; }
          case 'statue': { if (small) break; const s2 = floorSpot(true); if (!s2) break; const st = makeBearStatue(th.id === 'ice' ? 0xb8d0e8 : 0x7a8a70); st.position.set(s2.x, 0, s2.z); st.rotation.y = Math.PI + rng.range(-0.5, 0.5); g.add(st); break; }
          case 'crystals': for (let q = 0; q < n; q++) { const s2 = floorSpot(true); if (!s2) break; const c = makeCrystals(rng.int(1, 999), rng() < 0.7 ? 0x7fd8ff : 0xb09aff); c.position.set(s2.x, 0, s2.z); g.add(c); if (q === 0) w.addLight({ x: s2.x, y: 1.2, z: s2.z, color: 0x7fd8ff, intensity: 5, range: 6, region: reg, priority: 0.8 }); } break;
          case 'stalagmites': for (let q = 0; q < n; q++) { const s2 = floorSpot(true); if (!s2) break; const m = makeStalagmite(rng.int(1, 999)); m.position.set(s2.x, 0, s2.z); g.add(m); } break;
          case 'snow': for (let q = 0; q < n; q++) { const s2 = floorSpot(false); if (!s2) break; const m = makeSnowPile(rng.int(1, 999)); m.position.set(s2.x, 0, s2.z); g.add(m); } break;
          case 'icicles': { const f = wallFace(); if (!f) break; for (let q = 0; q < 4; q++) { const c = makeStalagmite(rng.int(1, 999), 0xd8f0ff); c.scale.set(0.35, -0.5, 0.35); c.position.set(f.x + (q - 1.5) * 0.45, WH, f.z + 0.2); g.add(c); } break; }
          case 'lavapool': break; // 熔岩池由地形危害系统生成
          case 'obsidian': for (let q = 0; q < n; q++) { const s2 = floorSpot(true); if (!s2) break; const m = makeObsidian(rng.int(1, 999)); m.position.set(s2.x, 0, s2.z); g.add(m); } break;
          case 'skulls': { const s2 = floorSpot(false); if (!s2) break; const m = makeSkullPile(rng.int(1, 999)); m.position.set(s2.x, 0, s2.z); g.add(m); break; }
          case 'brazierLava': { if (small) break; const s2 = floorSpot(true); if (!s2) break; const m = makeLavaBrazier(); m.position.set(s2.x, 0, s2.z); g.add(m); w.addLight({ x: s2.x, y: 1.4, z: s2.z, color: 0xff5a10, intensity: 7, range: 7, flicker: true, region: reg }); break; }
          default: break;
        }
      }
    }
    if (th.id === 'crypt' && !small && rng() < 0.4) { const s2 = floorSpot(false); if (s2) { const c = makeHangingCage(rng.int(1, 99)); c.position.set(s2.x, 1.8, s2.z); g.add(c); } }
  }

  onPuzzleSolved(room) {
    const w = this.world;
    this.game.audio.play('solve');
    this.game.hud.toast('机关已破解！', '#9dff7a');
    if (room.chest) room.chest.uncage();
    const c = w.center(room.cx, room.cy);
    this.fx.magic(c.x, 0.2, c.z, 0xffd86a, 30, 3);
    this.game.hud.dirty = true;
  }
  onEnemyKilled(e) {
    this.run.kills++;
    this.save.stats.kills++;
    const a = this.run.abilities;
    if (a.vamp && Math.random() < 0.15 * a.vamp) this.player.heal(1);
    if (a.burst && !e.def.boss) {
      this.fx.explosion(e.x, 0.6, e.z, 0.7);
      for (const o of this.world.enemiesInRadius(e.x, e.z, 2.4)) if (o !== e) o.hurt(this.player.dmg * 0.9, e.x, e.z, { knock: 6 });
    }
    if (e.def.boss) {
      this.bossDefeated = true;
      this.save.stats.bosses++;
      this.game.hud.toast('击败了远古石魔！', '#ffcf4a');
    }
    this.game.hud.dirty = true;
  }
  onDeath() {
    this.game.audio.playMusic(null);
    this.game.audio.play('gameover');
    const s = this.save;
    s.best = Math.max(s.best, this.run.floor);
    s.stats.deaths++;
    s.run = null;
    this.game.save.save();
    this.deathT = 0;
  }

  // ------------------------------------------------------------ 下楼与能力选择
  descend() {
    if (this.overlay || this.descending) return;
    this.descending = { t: 0, sx: this.player.x, sz: this.player.z };
    this.game.audio.play('descend');
    this.stick.id = null;
  }
  openChoice(paid) {
    const rng = makeRng((this.run.seed + this.run.floor * 101 + (paid ? 7777 + Math.floor(Math.random() * 1000) : 0)) >>> 0);
    this.choices = rollAbilities(this.run.abilities, rng, 3);
    if (!this.choices.length) {
      this.game.hud.toast('你已掌握所有能力！');
      if (!paid) this.nextFloor();
      return;
    }
    this.choicePaid = paid;
    this.overlay = 'choose';
    this.choiceT = 0;
    this.game.audio.play('levelup');
    this.game.hud.dirty = true;
  }
  choose(id) {
    const run = this.run;
    run.abilities[id] = (run.abilities[id] || 0) + 1;
    if (id === 'heart') { run.maxHp += 2; run.hp = run.maxHp; }
    this.player.recalc();
    this.game.audio.play('levelup');
    this.overlay = null;
    this.game.hud.toast('获得能力：' + ABILITIES[id].name + ' Lv.' + run.abilities[id], '#ffcf4a');
    if (!this.choicePaid) this.nextFloor();
    this.game.hud.dirty = true;
  }
  nextFloor() {
    this.run.floor++;
    this.run.time = (this.run.time || 0) + (Date.now() - this.run.floorStart) / 1000;
    this.save.best = Math.max(this.save.best, this.run.floor);
    this.game.nextFloor(this.run);
  }

  // ------------------------------------------------------------ 输入
  get wantsStick() { return !this.overlay && !this.descending && this.player.alive; }
  stickStart(id, x, y) { this.stick = { id, ox: x, oy: y, x, y }; }
  stickMove(id, x, y) { if (this.stick.id === id) { this.stick.x = x; this.stick.y = y; } }
  stickEnd(id) { if (this.stick.id === id) this.stick.id = null; }
  onPinch(f) { this.zoom = clamp(this.zoom / f, 0.75, 1.35); }
  readInput() {
    const k = this.game.keys;
    const edge = (code) => { const now = !!k[code]; const was = !!this.prevKeys[code]; return now && !was; };
    let mx = 0, mz = 0;
    if (k.KeyA || k.ArrowLeft) mx -= 1;
    if (k.KeyD || k.ArrowRight) mx += 1;
    if (k.KeyW || k.ArrowUp) mz -= 1;
    if (k.KeyS || k.ArrowDown) mz += 1;
    const s = this.stick;
    if (s.id !== null) {
      const R = 52;
      let dx = s.x - s.ox, dy = s.y - s.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { s.ox = s.x - dx / d * R; s.oy = s.y - dy / d * R; dx = s.x - s.ox; dy = s.y - s.oy; }
      if (d > 6) { mx = dx / R; mz = dy / R; }
    }
    const inp = {
      mx, mz,
      attack: this.btn.attack || !!k.KeyJ,
      jump: this.btn.jump || edge('Space'),
      jumpHeld: this.btn.jumpHeld || !!k.Space,
      dash: this.btn.dash || edge('KeyK') || edge('ShiftLeft'),
      interact: this.btn.interact || edge('KeyE'),
      skill: this.btn.skill || (edge('KeyQ') ? this.activeSkills()[0] : edge('KeyR') ? this.activeSkills()[1] : null),
    };
    if (edge('Escape') || edge('KeyP')) this.togglePause();
    this.btn.dash = false; this.btn.interact = false; this.btn.skill = null; this.btn.jump = false;
    this.prevKeys = Object.assign({}, k);
    return inp;
  }
  activeSkills() { return ['fireball', 'nova'].filter((id) => this.run.abilities[id]); }
  togglePause() {
    if (this.overlay === 'pause') this.overlay = null;
    else if (!this.overlay) this.overlay = 'pause';
    this.game.audio.play('click');
    this.game.hud.dirty = true;
  }

  // ------------------------------------------------------------ 主循环
  update(dt) {
    this.time += dt;
    const w = this.world, p = this.player;
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 3.5) this.banner = null; }
    if (this.overlay === 'pause' || this.overlay === 'choose') { this.updateOverlayMeshes(); this.renderCam(0); return; }
    let gdt = dt;
    if (w.hitStop > 0) { w.hitStop -= dt; gdt = dt * 0.2; }
    const inp = this.readInput();
    w.updatePlatforms(gdt);
    if (this.descending) {
      const ds = this.descending;
      ds.t += dt;
      const c = w.center(this.stairsTile.i, this.stairsTile.j);
      const k = Math.min(1, ds.t / 0.8);
      p.x = ds.sx + (c.x - ds.sx) * k; p.z = ds.sz + (c.z - ds.sz) * k;
      p.update(gdt, { mx: 0, mz: 0 });
      p.root.position.y = -Math.max(0, ds.t - 0.6) * 2.2;
      if (ds.t > 1.6 && !this.overlay) { this.descending = null; this.openChoice(false); }
    } else {
      p.update(gdt, inp);
    }
    w.update(gdt, p);
    for (let i = w.enemies.length - 1; i >= 0; i--) if (w.enemies[i].update(gdt) === false) w.enemies.splice(i, 1);
    for (const e of this.encounters) e.update(gdt);
    this.fx.update(gdt);
    w.updateDiscovery(p.x, p.z);
    this.ambient(dt);
    if (this.amb) this.amb.update(dt);
    // 进入特殊房间时提示
    { const rm = w.roomAt(w.tileOf(p.x), w.tileOf(p.z)); if (rm && !rm.toasted && (rm.type === 'gauntlet' || rm.type === 'maze')) { rm.toasted = true; this.game.hud.toast(rm.type === 'gauntlet' ? '刀阵回廊：看准摆锤的节奏再冲！' : '迷宫密室：宝箱藏在最深处', '#ffd070'); } }
    // 地形危害伤害
    const hz = p.alive && !p.dashing && p.grounded ? w.hazardAt(p.x, p.z) : null;
    this.hazT = (this.hazT || 0) - dt;
    if (hz === 'lava' && this.hazT <= 0) { this.hazT = 0.8; p.hurt(1, p.x - p.mvx, p.z - p.mvz, 'trap'); this.fx.fire(p.x, 0.3, p.z, 8, 2, 0xffd040, 0xff3a10, 0.3); this.game.audio.play('flame'); }
    else if (hz === 'poison' && this.hazT <= 0) { this.hazT = 1.4; p.hurt(1, p.x, p.z + 0.01, 'trap'); this.fx.smoke(p.x, 0.3, p.z, 4, 0.5, 0x7ad84a, 0.6); }
    for (const e of w.enemies) { if (e.dead || e.flying) continue; const eh = w.hazardAt(e.x, e.z); if (eh === 'lava') e.hurt(15 * dt, e.x, e.z, { noKnock: true, trap: true, burn: 3 }); else if (eh === 'poison') e.hurt(6 * dt, e.x, e.z, { noKnock: true, trap: true }); }
    // 交互
    this.near = p.alive && !this.descending && !p.climb ? w.nearestInteract(p.x, p.z, p.face, p.y) : null;
    if (this.near) {
      this.interactRing.visible = true;
      const ny = this.near.y !== undefined ? this.near.y : w.groundAt(this.near.x, this.near.z);
      this.interactRing.position.set(this.near.x, (ny > 8 ? 0 : ny) + 0.06, this.near.z);
      this.interactRing.scale.setScalar(1 + Math.sin(this.time * 6) * 0.08);
      if (inp.interact) { this.near.interact(); this.game.hud.dirty = true; }
    } else this.interactRing.visible = false;
    if (this.nearPrev !== this.near) { this.nearPrev = this.near; this.game.hud.dirty = true; }
    if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt * 2.5);
    if (!p.alive && this.overlay !== 'dead' && this.deathT !== undefined) { this.deathT += dt; if (this.deathT > 1.6) { this.overlay = 'dead'; this.game.hud.dirty = true; } }
    this.renderCam(dt);
    this.updateOverlayMeshes();
  }
  ambient(dt) {
    const p = this.player, fx = this.fx, kind = this.theme.particles;
    if (this.pitTiles && this.pitTiles.length && Math.random() < dt * 14) {
      const t = this.pitTiles[Math.floor(Math.random() * this.pitTiles.length)];
      if (Math.abs(t.x - p.x) < 14 && Math.abs(t.z - p.z) < 12 && this.world.discovered[t.r]) {
        const lava = this.theme.id === 'lava';
        fx.bright.spawn({ x: t.x + (Math.random() - 0.5) * 1.8, y: PIT + 0.5, z: t.z + (Math.random() - 0.5) * 1.8, vx: 0, vy: 1.5 + Math.random() * 1.5, vz: 0, life: 1.8, size: lava ? 0.1 : 0.07, color: lava ? 0xffa03a : this.theme.id === 'ice' ? 0x9fd8ff : this.theme.id === 'moss' ? 0x8affb0 : 0xb08aff, spin: 0 });
      }
    }
    const rate = kind === 'snow' ? 18 : kind === 'embers' ? 10 : 6;
    for (let k = 0; k < rate * dt * 3; k++) {
      if (Math.random() > rate * dt) continue;
      const x = p.x + (Math.random() - 0.5) * 22, z = p.z + (Math.random() - 0.5) * 16;
      if (kind === 'snow') fx.bright.spawn({ x, y: 5 + Math.random() * 2, z, vx: 0.3, vy: -1.2 - Math.random(), vz: 0.2, life: 4, size: 0.06 + Math.random() * 0.05, color: 0xeef8ff, spin: 1 });
      else if (kind === 'embers') fx.bright.spawn({ x, y: 0.1, z, vx: (Math.random() - 0.5) * 0.5, vy: 1 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 0.5, life: 2.5, size: 0.06, color: Math.random() < 0.5 ? 0xff8a2a : 0xffd04a, spin: 2 });
      else if (kind === 'spores') fx.bright.spawn({ x, y: 0.3 + Math.random() * 2, z, vx: (Math.random() - 0.5) * 0.4, vy: 0.2, vz: (Math.random() - 0.5) * 0.4, life: 3, size: 0.05, color: Math.random() < 0.5 ? 0x8affc0 : 0xd8ff8a, spin: 0 });
      else fx.bright.spawn({ x, y: 0.5 + Math.random() * 2, z, vx: (Math.random() - 0.5) * 0.2, vy: 0.05, vz: (Math.random() - 0.5) * 0.2, life: 3, size: 0.035, color: 0xd8c8a0, spin: 0 });
    }
  }
  renderCam(dt) {
    const p = this.player;
    const t = this.camTarget;
    const k = Math.min(1, dt * 6);
    t.x += (p.x - t.x) * k; t.z += (p.z - t.z) * k;
    const ty = Math.max(-1, p.alive ? (p.grounded || p.climb ? p.y : Math.min(p.y, t.y + 0.6)) : t.y);
    t.y += (ty - t.y) * Math.min(1, dt * 4);
    const bossOn = this.world.enemies.some((e) => e.def.boss && !e.dead && e.aggro);
    this.zoomFx = (this.zoomFx || 1) + ((bossOn ? 1.28 : 1) - (this.zoomFx || 1)) * Math.min(1, dt * 2);
    const z = this.zoom * this.zoomFx;
    const sh = this.fx.shake;
    this.camera.position.set(t.x + (Math.random() - 0.5) * sh, 11.2 * z + t.y + (Math.random() - 0.5) * sh, t.z + 8.0 * z);
    this.camera.lookAt(t.x, 0.4 + t.y, t.z - 0.4);
    this.moon.position.set(t.x - 7, 16 + t.y, t.z + 5);
    this.moon.target.position.set(t.x, t.y, t.z);
    CUT.uPlayer.value.set(p.x, p.alive ? Math.max(p.y, Math.min(0, t.y)) : t.y, p.z);
  }

  // ------------------------------------------------------------ 摇杆叠加层（网格绘制，避免每帧上传 HUD 纹理）
  initOverlay() {
    const mk = (r, fill, stroke) => {
      const cv = platform.createCanvas(128, 128);
      const ctx = cv.getContext('2d');
      ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = stroke; ctx.stroke();
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, side: THREE.DoubleSide }));
      return m;
    };
    this.stickBase = mk(60, 'rgba(20,16,28,0.35)', 'rgba(201,164,90,0.6)');
    this.stickKnob = mk(28, 'rgba(201,164,90,0.75)', 'rgba(255,240,200,0.9)');
    this.game.hud.overlay.add(this.stickBase, this.stickKnob);
  }
  updateOverlayMeshes() {
    const s = this.stick;
    const hud = this.game.hud;
    const show = !this.overlay && this.player.alive && !this.descending;
    this.stickBase.visible = this.stickKnob.visible = show;
    if (!show) return;
    const u = clamp(hud.h / 400, 0.85, 1.5);
    const dx0 = 30 * u + 60 + platform.safe.left, dy0 = hud.h - 30 * u - 60;
    if (s.id !== null) {
      this.stickBase.position.set(s.ox, s.oy, 0);
      this.stickKnob.position.set(s.x, s.y, 0);
      this.stickBase.material.opacity = 1; this.stickKnob.material.opacity = 1;
    } else {
      this.stickBase.position.set(dx0, dy0, 0);
      this.stickKnob.position.set(dx0, dy0, 0);
      this.stickBase.material.opacity = 0.55; this.stickKnob.material.opacity = 0.5;
    }
  }

  // ------------------------------------------------------------ HUD
  objective() {
    const need = this.d.keysNeeded;
    if (this.run.keys < need) return '寻找钥匙 ' + this.run.keys + '/' + need;
    if (!this.unsealed) return '前往出口，解除封印';
    if (this.d.boss && !this.bossDefeated) return '击败首领';
    return '进入楼梯，前往下一层';
  }
  drawHUD(hud) {
    const W = hud.w, H = hud.h, s = platform.safe;
    const L = 10 + s.left, R = W - 10 - s.right, T0 = 8 + s.top, B = H - 10 - s.bottom;
    const u = clamp(H / 400, 0.85, 1.5);
    const ctx = hud.ctx;
    const run = this.run, p = this.player;
    // 受伤红晕
    if (p.hurtFlash > 0 || run.hp <= 2) {
      const a = Math.max(p.hurtFlash * 0.6, run.hp <= 2 && p.alive ? 0.22 + Math.sin(this.time * 5) * 0.1 : 0);
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.65);
      g.addColorStop(0, 'rgba(200,0,0,0)');
      g.addColorStop(1, 'rgba(200,0,0,' + a + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (p.hurtFlash > 0) this.hudInterval = 0.08;
    }
    // 生命
    const hs = 24 * u;
    const hearts = Math.ceil(run.maxHp / 2);
    for (let k = 0; k < hearts; k++) {
      const v = run.hp - k * 2;
      hud.icon(v >= 2 ? 'heart' : v === 1 ? 'heartHalf' : 'heartEmpty', L + hs / 2 + k * (hs + 2), T0 + hs / 2, hs);
    }
    if (p.shieldReady) hud.icon('shield', L + hs / 2 + hearts * (hs + 2) + 4, T0 + hs / 2, hs);
    let y = T0 + hs + 14 * u;
    let x = L;
    roundRect(ctx, L - 4, y - 12 * u, 210 * u, 24 * u, 12 * u);
    ctx.fillStyle = 'rgba(10,6,16,0.55)'; ctx.fill();
    x += hud.iconText('key', run.keys + '/' + this.d.keysNeeded, x, y, 14 * u, run.keys >= this.d.keysNeeded ? '#9dff7a' : C.gold) + 10 * u;
    x += hud.iconText('coin', String(run.coins), x, y, 14 * u) + 10 * u;
    hud.iconText('crystal', String(this.save.crystals), x, y, 14 * u, '#d8b0ff');
    // 能力图标
    y += 22 * u;
    x = L;
    for (const id in run.abilities) {
      const a = ABILITIES[id];
      roundRect(ctx, x, y - 1, 24 * u, 24 * u, 6); ctx.fillStyle = 'rgba(20,14,30,0.7)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C.borderDark; ctx.stroke();
      hud.icon(a.icon, x + 12 * u, y + 11 * u, 18 * u);
      if (run.abilities[id] > 1) hud.text(String(run.abilities[id]), x + 21 * u, y + 20 * u, { size: 10 * u, align: 'center', color: C.gold });
      x += 26 * u;
    }
    // 顶部中央：楼层 + 目标
    hud.text('第 ' + run.floor + ' 层', W / 2, T0 + 12 * u, { size: 17 * u, align: 'center', color: C.gold });
    hud.text(this.objective(), W / 2, T0 + 33 * u, { size: 13 * u, align: 'center' });
    // Boss 血条
    const boss = this.world.enemies.find((e) => e.def.boss && !e.dead && e.aggro);
    if (boss) {
      hud.text(boss.def.name, W / 2, T0 + 54 * u, { size: 13 * u, align: 'center', color: '#ff8a6a' });
      hud.bar(W / 2 - 150 * u, T0 + 64 * u, 300 * u, 14 * u, boss.hp / boss.maxHp, boss.phase === 2 ? '#ff4a2a' : '#d8443a');
    }
    // 小地图
    const mm = 118 * u;
    const mx = R - mm, my = T0;
    this.drawMinimap(hud, mx, my, mm);
    hud.button('pause', mx - 44 * u, T0, 38 * u, 38 * u, { icon: 'pause', color: C.stone, colorD: C.stoneD }, () => this.togglePause());

    // 右下：操作按钮
    if (!this.overlay && p.alive && !this.descending) {
      const ab = 82 * u;
      const ax = R - ab - 6 * u, ay = B - ab - 6 * u;
      hud.button('attack', ax, ay, ab, ab, { circle: true, icon: { knight: 'sword', ranger: 'bow', mage: 'staff', berserker: 'axe' }[(this.run.hero || {}).cls] || 'sword', iconSize: ab * 0.5, color: '#b83a30', colorD: '#5a1812', down: () => { this.btn.attack = true; }, up: () => { this.btn.attack = false; } }, null);
      const jb = 66 * u;
      const jx = ax - jb - 14 * u, jy = ay + ab - jb + 4 * u;
      hud.button('jump', jx, jy, jb, jb, { circle: true, icon: 'jump', iconSize: jb * 0.55, color: '#3a9a5a', colorD: '#16402a', down: () => { this.btn.jump = true; this.btn.jumpHeld = true; }, up: () => { this.btn.jumpHeld = false; } }, null);
      const db = 56 * u;
      const dcd = Math.max(0, p.dashCd / p.dashCdMax);
      const dx = ax - db * 0.72, dy = ay - db - 4 * u;
      hud.button('dash', dx, dy, db, db, { circle: true, icon: 'dash', color: '#3a6ab8', colorD: '#1a3060', cd: dcd, down: () => { this.btn.dash = true; } }, null);
      if (dcd > 0) this.hudInterval = 0.08;
      const skills = this.activeSkills();
      skills.forEach((id, k) => {
        const sb = 50 * u;
        const cdMax = id === 'fireball' ? (run.abilities[id] === 1 ? 6 : 4) : 9;
        const cd = Math.max(0, p.skillCd[id] / cdMax);
        const sx = k === 0 ? ax + ab - sb + 2 * u : dx - sb - 10 * u, sy = k === 0 ? ay - sb - 24 * u : ay - sb * 0.5 - 18 * u;
        hud.button('skill' + k, sx, sy, sb, sb, { circle: true, icon: id, color: id === 'fireball' ? '#c85a1a' : '#2a8ab8', colorD: '#3a2010', cd, down: () => { this.btn.skill = id; } }, null);
        if (cd > 0) this.hudInterval = 0.08;
      });
      if (this.near) {
        const ib = 62 * u;
        const ix = jx - ib - 16 * u, iy = ay + ab - ib - 20 * u;
        hud.button('interact', ix, iy, ib, ib, { circle: true, icon: this.near.icon || 'hand', iconSize: ib * 0.5, color: '#c9a45a', colorD: '#6e5528', glow: '#fff0b0', down: () => { this.btn.interact = true; } }, null);
        const lbl = typeof this.near.label === 'function' ? this.near.label() : this.near.label;
        const tw = hud.measure(lbl, 13 * u) + 16;
        roundRect(ctx, ix + ib / 2 - tw / 2, iy + ib + 4 * u, tw, 22 * u, 8);
        ctx.fillStyle = 'rgba(10,6,16,0.75)'; ctx.fill();
        hud.text(lbl, ix + ib / 2, iy + ib + 15 * u, { size: 13 * u, align: 'center', color: '#ffe8a0', stroke: false });
      }
      // 新手提示
      if (run.floor === 1 && this.time < 9 && !this.save.tutorial) {
        const msg = '左侧拖动移动 · 右下角攻击 / 跳跃 / 翻滚 · 找到钥匙打开出口';
        const tw = hud.measure(msg, 14 * u) + 30;
        roundRect(ctx, W / 2 - tw / 2, B - 34 * u, tw, 28 * u, 10);
        ctx.fillStyle = 'rgba(10,6,16,0.7)'; ctx.fill();
        hud.text(msg, W / 2, B - 20 * u, { size: 14 * u, align: 'center', color: '#ffe8a0', stroke: false });
      } else if (run.floor === 1 && !this.save.tutorial && this.time >= 9) { this.save.tutorial = 1; }
      // 当前房间谜题提示
      const room = this.world.roomAt(this.world.tileOf(p.x), this.world.tileOf(p.z));
      if (room && room.puzzleObj && !room.puzzleObj.solved) {
        const msg = room.puzzleObj.hint;
        const tw = hud.measure(msg, 13 * u) + 24;
        roundRect(ctx, W / 2 - tw / 2, T0 + (boss ? 84 : 46) * u, tw, 24 * u, 8);
        ctx.fillStyle = 'rgba(40,24,60,0.7)'; ctx.fill();
        hud.text(msg, W / 2, T0 + (boss ? 96 : 58) * u, { size: 13 * u, align: 'center', color: '#d8c0ff', stroke: false });
      }
    }
    // 楼层横幅
    if (this.banner) {
      const b = this.banner;
      const a = b.t < 0.4 ? b.t / 0.4 : b.t > 2.8 ? Math.max(0, 1 - (b.t - 2.8) / 0.7) : 1;
      ctx.globalAlpha = a;
      const by = H * 0.36;
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.65)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, by - 40 * u, W, 84 * u);
      hud.text(b.title, W / 2, by - 6 * u, { size: 36 * u, align: 'center', color: C.gold, strokeW: 6 });
      hud.text(b.sub, W / 2, by + 26 * u, { size: 15 * u, align: 'center', color: b.color || '#d8ccb0', maxW: W - 40 });
      ctx.globalAlpha = 1;
      this.hudInterval = 0.05;
    } else if (!(p.hurtFlash > 0)) this.hudInterval = this.hudInterval < 0.1 ? 0.1 : this.hudInterval;
    if (this.descending) {
      const k = Math.min(1, Math.max(0, (this.descending.t - 0.6) / 1.0));
      ctx.fillStyle = 'rgba(0,0,0,' + k + ')'; ctx.fillRect(0, 0, W, H);
      this.hudInterval = 0.03;
    }
    if (this.overlay === 'pause') this.drawPause(hud, u);
    else if (this.overlay === 'choose') this.drawChoose(hud, u);
    else if (this.overlay === 'dead') this.drawDead(hud, u);
  }
  drawMinimap(hud, x0, y0, size) {
    const ctx = hud.ctx, d = this.d, w = this.world;
    roundRect(ctx, x0 - 3, y0 - 3, size + 6, size + 6, 8);
    ctx.fillStyle = 'rgba(8,6,12,0.72)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.borderDark; ctx.stroke();
    const sc = size / Math.max(d.W, d.H);
    const comp = this.run.abilities.compass;
    for (let j = 0; j < d.H; j++) for (let i = 0; i < d.W; i++) {
      const k = j * d.W + i;
      const t = d.tile[k];
      if (t === WALL) continue;
      if (!w.discovered[d.region[k]]) continue;
      const kd = d.kind[k];
      ctx.fillStyle = kd === K.PIT || kd === K.STONE ? (kd === K.STONE ? '#4a4452' : '#15101c') : kd === K.PLAT || kd === K.BLOCK ? (d.hgt[k] > 1.5 ? '#c8c0d8' : '#aaa2b8') : kd === K.SUNK ? '#6a6278' : kd === K.STAIR ? '#9e96ac' : t === ROOM ? '#8a8298' : '#5e5868';
      ctx.fillRect(x0 + i * sc, y0 + j * sc, sc + 0.3, sc + 0.3);
    }
    const dot = (i, j, color, r) => { ctx.beginPath(); ctx.arc(x0 + (i + 0.5) * sc, y0 + (j + 0.5) * sc, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); };
    const ex = this.stairsTile;
    if (comp || w.discovered[d.exit]) { ctx.fillStyle = this.unsealed ? '#4ab8ff' : '#2a6aa8'; ctx.fillRect(x0 + (ex.i - 0.5) * sc, y0 + (ex.j - 0.5) * sc, sc * 2, sc * 2); }
    for (const ch of this.keyChests) if (!ch.opened && (comp || w.discovered[w.regionAt(ch.i, ch.j)])) dot(ch.i, ch.j, '#ffcf4a', Math.max(2.5, sc * 0.9));
    for (const pk of w.pickups) if (pk.kind === 'key') dot(w.tileOf(pk.x), w.tileOf(pk.z), '#ffcf4a', 3);
    for (const e of w.enemies) if (!e.dead && e.aggro && e.root.visible) dot(w.tileOf(e.x), w.tileOf(e.z), '#ff4a3a', 2);
    const p = this.player;
    const px = x0 + p.x / T * sc, py = y0 + p.z / T * sc;
    ctx.save(); ctx.translate(px, py); ctx.rotate(-p.face + Math.PI);
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath();
    ctx.fillStyle = '#ffe23a'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.restore();
  }
  drawPause(hud, u) {
    const W = hud.w, H = hud.h;
    hud.dim(0.65);
    const pw = 320 * u, ph = 300 * u;
    const x = (W - pw) / 2, y = (H - ph) / 2;
    hud.panel(x, y, pw, ph);
    hud.header(x + pw * 0.2, y - 18 * u, pw * 0.6, 36 * u, '暂停');
    const st = this.save.settings;
    const bw = pw - 60 * u, bh = 40 * u;
    let by = y + 34 * u;
    hud.button('resume', x + 30 * u, by, bw, bh, { icon: 'play', label: '继续冒险', color: C.green, colorD: C.greenD }, () => this.togglePause());
    by += bh + 12 * u;
    const half = (bw - 10 * u) / 2;
    hud.button('snd', x + 30 * u, by, half, bh, { icon: 'sound', label: st.sound ? '音效 开' : '音效 关', color: st.sound ? C.blue : C.gray, colorD: C.blueD, fontSize: 14 * u }, () => { st.sound = !st.sound; this.game.save.save(); this.game.hud.dirty = true; });
    hud.button('mus', x + 40 * u + half, by, half, bh, { icon: 'music', label: st.music ? '音乐 开' : '音乐 关', color: st.music ? C.blue : C.gray, colorD: C.blueD, fontSize: 14 * u }, () => { st.music = !st.music; this.game.save.save(); this.game.audio.track = null; this.game.audio.playMusic(st.music ? 'dungeon' : null); this.game.hud.dirty = true; });
    by += bh + 12 * u;
    const qn = { high: '画质 高', mid: '画质 中', low: '画质 低' };
    hud.button('qual', x + 30 * u, by, bw, bh, { icon: 'quality', label: qn[st.quality] + '（下层生效）', color: C.purple, colorD: C.purpleD, fontSize: 14 * u }, () => { st.quality = st.quality === 'high' ? 'mid' : st.quality === 'mid' ? 'low' : 'high'; this.game.save.save(); this.game.hud.dirty = true; });
    by += bh + 12 * u;
    hud.button('quit', x + 30 * u, by, bw, bh, { icon: 'home', label: '保存并返回标题', color: C.stone, colorD: C.stoneD }, () => { this.saveRun(); this.game.goTitle(); });
    hud.text('第 ' + this.run.floor + ' 层 · 击杀 ' + this.run.kills + ' · 最深 ' + this.save.best + ' 层', W / 2, y + ph - 18 * u, { size: 12 * u, align: 'center', color: C.textDim });
  }
  drawChoose(hud, u) {
    const W = hud.w, H = hud.h;
    this.choiceT += 0.05;
    hud.dim(0.72);
    hud.text(this.choicePaid ? '获得新的力量' : '第 ' + this.run.floor + ' 层 通关！', W / 2, 36 * u, { size: 24 * u, align: 'center', color: C.gold, strokeW: 5 });
    hud.text('选择一项能力', W / 2, 64 * u, { size: 15 * u, align: 'center', color: '#d8ccb0' });
    const n = this.choices.length;
    const cw = Math.min(210 * u, (W - 60 - 20 * (n - 1)) / n), ch = Math.min(250 * u, H - 120 * u);
    const x0 = W / 2 - (n * cw + (n - 1) * 20) / 2, y0 = 84 * u;
    const ctx = hud.ctx;
    this.choices.forEach((id, k) => {
      const a = ABILITIES[id];
      const lv = (this.run.abilities[id] || 0) + 1;
      const x = x0 + k * (cw + 20);
      const pop = Math.min(1, Math.max(0, this.choiceT * 3 - k * 0.3));
      const yy = y0 + (1 - pop) * 40;
      ctx.globalAlpha = pop;
      const rc = a.rarity === 3 ? '#ffb040' : a.rarity === 2 ? '#b06aff' : '#6ab8ff';
      hud.panel(x, yy, cw, ch, { stroke: rc, lw: 3, block: false });
      const g = ctx.createRadialGradient(x + cw / 2, yy + 62 * u, 4, x + cw / 2, yy + 62 * u, 60 * u);
      g.addColorStop(0, rc + '88'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x, yy, cw, 130 * u);
      hud.icon(a.icon, x + cw / 2, yy + 62 * u, 56 * u);
      hud.text(a.name, x + cw / 2, yy + 118 * u, { size: 18 * u, align: 'center', color: rc });
      hud.text(a.active ? '主动技能' : lv > 1 ? '升级 Lv.' + lv : '新能力', x + cw / 2, yy + 140 * u, { size: 12 * u, align: 'center', color: C.textDim });
      hud.paragraph(a.desc(lv), x + 14 * u, yy + 166 * u, cw - 28 * u, { size: 13 * u, color: C.text, stroke: false, bold: false });
      for (let s = 0; s < a.max; s++) hud.icon('star', x + cw / 2 + (s - (a.max - 1) / 2) * 16 * u, yy + ch - 16 * u, s < lv ? 14 * u : 10 * u);
      ctx.globalAlpha = 1;
      hud.region('choice' + k, x, yy, cw, ch, () => this.choose(id));
    });
    if (this.choiceT < 1) this.hudInterval = 0.03;
  }
  drawDead(hud, u) {
    const W = hud.w, H = hud.h;
    hud.dim(0.75);
    const pw = 360 * u, ph = 280 * u;
    const x = (W - pw) / 2, y = (H - ph) / 2 + 10 * u;
    hud.panel(x, y, pw, ph, { stroke: '#a83a30' });
    hud.header(x + pw * 0.15, y - 20 * u, pw * 0.7, 40 * u, '冒险结束', '#ff8a6a');
    hud.icon('skull', x + pw / 2, y + 44 * u, 40 * u);
    const r = this.run;
    const lines = [['到达楼层', '第 ' + r.floor + ' 层'], ['击败敌人', String(r.kills)], ['获得能力', String(Object.keys(r.abilities).length)], ['本次水晶', '+' + r.crystals], ['最深纪录', '第 ' + this.save.best + ' 层']];
    let ly = y + 80 * u;
    for (const [a, b] of lines) {
      hud.text(a, x + 50 * u, ly, { size: 14 * u, color: C.textDim });
      hud.text(b, x + pw - 50 * u, ly, { size: 14 * u, align: 'right', color: C.text });
      ly += 22 * u;
    }
    const bw = (pw - 70 * u) / 2;
    hud.button('again', x + 25 * u, y + ph - 56 * u, bw, 42 * u, { label: '再次挑战', color: C.green, colorD: C.greenD }, () => this.game.newRun());
    hud.button('title', x + 45 * u + bw, y + ph - 56 * u, bw, 42 * u, { label: '水晶祭坛', icon: 'crystal', color: C.purple, colorD: C.purpleD }, () => this.game.goTitle());
  }

  onResize() { this.camera.aspect = platform.width / platform.height; this.camera.updateProjectionMatrix(); }
  dispose() {
    this.game.hud.overlay.remove(this.stickBase, this.stickKnob);
    this.s3.traverse((o) => {
      if (o.geometry && !o.geometry.userData.ni) o.geometry.dispose();
      if (o.material && !o.material.userData.shared) {
        if (o.material.map && !o.material.map.userData.keep) o.material.map.dispose();
        o.material.dispose();
      }
    });
    if (this.q !== 'low' && this.moon.shadow.map) this.moon.shadow.map.dispose();
  }
}

// ---------------------------------------------------------------- 房间遭遇战（封门 → 刷怪 → 清空开门）
class Encounter {
  constructor(scene, room, opts = {}) {
    this.scene = scene;
    this.world = scene.world;
    this.room = room;
    this.boss = !!opts.boss;
    this.waves = opts.waves || 0;
    this.wave = 1;
    this.gates = opts.gates || room.entrances.map((e) => new Gate(scene.world, e, 'iron'));
    this.state = 'idle';
  }
  update(dt) {
    const w = this.world, p = this.scene.player, room = this.room;
    if (this.state === 'idle') {
      if (!p.alive) return;
      const i = w.tileOf(p.x), j = w.tileOf(p.z);
      if (i > room.x && i < room.x + room.w - 1 && j > room.y && j < room.y + room.h - 1) this.start();
    } else if (this.state === 'fight') {
      this.t += dt;
      if (this.t > 1.2 && !w.enemies.some((e) => e.room === room && !e.dead)) {
        if (this.waves && this.wave < this.waves) { this.wave++; this.t = 0; this.scene.game.hud.toast('第 ' + this.wave + ' 波！', '#ff8a7a'); this.spawnWave(); }
        else this.finish();
      }
    }
  }
  start() {
    const w = this.world, sc = this.scene, room = this.room;
    this.state = 'fight';
    this.t = 0;
    for (const g of this.gates) g.close();
    const p = sc.player;
    if (this.boss) {
      const c = w.center(room.cx, room.y + 2);
      const lich = w.d.floor % 10 === 0;
      const e = new Enemy(w, lich ? 'lich' : 'golem', c.x, c.z, { room, aggro: true, rise: true });
      sc.boss = e;
      this.scene.game.audio.playMusic('boss');
      this.scene.game.audio.play('roar');
      this.scene.banner = lich ? { title: '骷髅巫王', sub: '亡者之王从永眠中醒来', t: 0 } : { title: '远古石魔', sub: '守护地牢深处的巨像苏醒了', t: 0 };
      return;
    }
    this.spawnWave();
    this.scene.game.hud.toast(this.waves ? '竞技场挑战：击败 ' + this.waves + ' 波敌人！' : '敌人来袭！', '#ff8a7a');
    this.scene.game.audio.play('roar');
  }
  spawnWave() {
    const w = this.world, sc = this.scene, room = this.room, p = sc.player;
    const f = w.d.floor;
    let n = Math.min(8, 2 + Math.floor(f / 2) + (room.w * room.h > 64 ? 1 : 0)) + (sc.mod === 'swarm' ? 2 : 0) + (this.waves ? 1 : 0);
    let pool = sc.theme.enemies.slice();
    if (f <= 2) pool = pool.filter((k) => k !== 'archer' && k !== 'iceMage' && k !== 'fireImp');
    if (!pool.length) pool = ['skeleton', 'slime'];
    const cells = [];
    for (let j = room.y; j < room.y + room.h; j++) for (let i = room.x; i < room.x + room.w; i++) {
      if (w.blocked(i, j)) continue;
      const k = w.idx(i, j), kd = w.d.kind[k];
      if (kd === K.PIT || kd === K.BLOCK || kd === K.STONE || w.d.jumpOnly[k] || w.d.stairs.has(k)) continue;
      const c = w.center(i, j);
      if (Math.hypot(c.x - p.x, c.z - p.z) < 4.5) continue;
      cells.push(c);
    }
    for (let k = 0; k < n && cells.length; k++) {
      const ci = Math.floor(Math.random() * cells.length);
      const c = cells.splice(ci, 1)[0];
      const kind = pool[Math.floor(Math.random() * pool.length)];
      w.after(k * 0.18, () => new Enemy(w, kind, c.x, c.z, { room, aggro: true, rise: true }));
    }
  }
  finish() {
    const w = this.world, sc = this.scene, room = this.room;
    this.state = 'done';
    for (const g of this.gates) g.open();
    if (this.boss) {
      if (sc.cover) { sc.cover.parent && sc.cover.parent.remove(sc.cover); }
      sc.stairs.root.visible = true;
      sc.stairs.active = true;
      sc.game.audio.playMusic('dungeon');
      const c = w.center(sc.stairsTile.i, sc.stairsTile.j);
      sc.fx.magic(c.x, 0.2, c.z, 0x7fd8ff, 40, 1.5);
      return;
    }
    sc.game.hud.toast(this.waves ? '竞技场胜利！' : '房间已肃清', '#9dff7a');
    sc.game.audio.play('solve');
    if (sc.mod === 'blessed') sc.player.heal(1);
    const spot = sc.freeSpot(room, true) || sc.freeSpot(room, false);
    if (spot) {
      const c = w.center(spot.i, spot.j);
      sc.fx.magic(c.x, 0.2, c.z, 0xffd86a, 30, 1);
      const ch = new Chest(w, spot.i, spot.j, room.hasKey ? { key: true, coins: 4 } : this.waves ? { coins: 12 + w.d.floor * 2, heart: true, crystal: 2 } : { coins: 5 + w.d.floor, heart: Math.random() < 0.35, crystal: Math.random() < 0.3 ? 1 : 0 });
      w.discover(w.regionAt(spot.i, spot.j));
      if (room.hasKey) sc.keyChests.push(ch);
    } else if (room.hasKey) w.spawnPickup('key', sc.player.x, sc.player.z, { y: sc.player.y + 1.5 });
  }
}

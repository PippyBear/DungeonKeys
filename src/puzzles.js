// 机关谜题：推箱压板 / 符文顺序 / 光束反射 / 火盆拉杆（点灯）
// 每种谜题的初始状态都由“已解状态”反推生成，保证一定有解
import * as THREE from 'three';
import { T } from './dungeon.js';
import { makeCrate, makePlate, makeLever, makeBrazier, makeRunePillar, makeTablet, makeMirror, makeEmitter, makeReceiver, glowSprite, makeMemoryTile, makeStatueDial } from './models.js';
import { RUNE_COLORS } from './textures.js';
import { ease } from './utils.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function createPuzzle(world, room, kind, rng, onSolved) {
  const P = { crates: CratePuzzle, runes: RunePuzzle, mirrors: MirrorPuzzle, levers: LeverPuzzle, memory: MemoryPuzzle, statues: StatuePuzzle }[kind];
  const p = new P(world, room, rng, onSolved);
  if (!p.ok) return null;
  world.updatables.push(p);
  return p;
}

function inInterior(room, i, j) { return i >= room.x + 1 && i <= room.x + room.w - 2 && j >= room.y + 1 && j <= room.y + room.h - 2; }
function inRoom(room, i, j) { return i >= room.x && i <= room.x + room.w - 1 && j >= room.y && j <= room.y + room.h - 1; }

// ---------------------------------------------------------------- 推箱子
class CratePuzzle {
  constructor(world, room, rng, onSolved) {
    this.world = world; this.room = room; this.onSolved = onSolved;
    this.hint = '把木箱推到所有压力板上';
    const n = Math.min(3, 1 + (world.d.floor > 3 ? 1 : 0) + (world.d.floor > 6 ? 1 : 0) + (room.w * room.h > 70 ? 1 : 0));
    this.plates = [];
    this.crates = [];
    for (let k = 0; k < n; k++) {
      let placed = false;
      for (let t = 0; t < 250 && !placed; t++) {
        const pi = rng.int(room.x + 1, room.x + room.w - 2), pj = rng.int(room.y + 1, room.y + room.h - 2);
        const [di, dj] = DIRS[rng.int(0, 3)];
        const kk = rng.int(2, 3);
        const ci = pi - di * kk, cj = pj - dj * kk, bi = ci - di, bj = cj - dj;
        if (!inInterior(room, ci, cj) || !inRoom(room, bi, bj)) continue;
        const cells = [];
        for (let s = 0; s <= kk + 1; s++) cells.push([pi - di * s, pj - dj * s]);
        if (!cells.every(([i, j]) => world.isFree(i, j))) continue;
        for (const [i, j] of cells) world.reserve(i, j);
        this.plates.push(this.makePlate(pi, pj));
        this.crates.push(this.makeCrate(ci, cj));
        placed = true;
      }
    }
    this.ok = this.plates.length > 0;
    if (!this.ok) return;
    // 复位拉杆
    const spots = world.interior(room).filter((c) => world.isFree(c.i, c.j));
    const s = spots.length ? spots[rng.int(0, spots.length - 1)] : null;
    if (s) {
      world.reserve(s.i, s.j);
      const lv = makeLever();
      const c = world.center(s.i, s.j);
      lv.root.position.set(c.x, 0, c.z);
      world.addAt(lv.root, s.i, s.j);
      world.setSolid(s.i, s.j, true);
      this.lever = { x: c.x, z: c.z, label: '复位木箱', icon: 'hand', radius: 1.8, handle: lv.handle, enabled: () => !this.solved, interact: () => this.reset() };
      world.addInteract(this.lever);
    }
  }
  makePlate(i, j) {
    const m = makePlate();
    const c = this.world.center(i, j);
    m.root.position.set(c.x, 0, c.z);
    this.world.addAt(m.root, i, j);
    return { i, j, m, pressed: false };
  }
  makeCrate(i, j) {
    const mesh = makeCrate();
    const c = this.world.center(i, j);
    mesh.position.set(c.x, 0, c.z);
    this.world.addAt(mesh, i, j);
    const crate = { i, j, i0: i, j0: j, mesh, anim: null, isCrate: true, puzzle: this };
    this.world.setSolid(i, j, true, crate, 1.7);
    return crate;
  }
  canPush(crate, di, dj) {
    if (this.solved || crate.anim) return false;
    const ni = crate.i + di, nj = crate.j + dj;
    const w = this.world;
    if (!inRoom(this.room, ni, nj)) return false;
    if (w.blocked(ni, nj) || w.doorstep[w.idx(ni, nj)]) return false;
    const p = w.player;
    if (w.tileOf(p.x) === ni && w.tileOf(p.z) === nj) return false;
    return true;
  }
  push(crate, di, dj) {
    if (!this.canPush(crate, di, dj)) return false;
    const w = this.world;
    w.setSolid(crate.i, crate.j, false, crate);
    const from = w.center(crate.i, crate.j);
    crate.i += di; crate.j += dj;
    w.setSolid(crate.i, crate.j, true, crate, 1.7);
    const to = w.center(crate.i, crate.j);
    crate.anim = { t: 0, from, to };
    w.audio.play('push');
    w.fx.dust(from.x, 0.1, from.z, 4, 0x8a8078);
    return true;
  }
  reset() {
    const w = this.world;
    this.lever.handle.rotation.x = this.lever.handle.rotation.x > 0 ? -0.6 : 0.6;
    w.audio.play('lever');
    for (const c of this.crates) { w.setSolid(c.i, c.j, false, c); }
    for (const c of this.crates) {
      const from = w.center(c.i, c.j);
      c.i = c.i0; c.j = c.j0;
      w.setSolid(c.i, c.j, true, c, 1.7);
      c.anim = { t: 0, from, to: w.center(c.i, c.j), dur: 0.5 };
      w.fx.magic(from.x, 0.5, from.z, 0x9fe8ff, 8, 0.8);
    }
  }
  update(dt) {
    for (const c of this.crates) {
      if (!c.anim) continue;
      c.anim.t += dt / (c.anim.dur || 0.22);
      const k = ease.outQuad(Math.min(1, c.anim.t));
      c.mesh.position.set(c.anim.from.x + (c.anim.to.x - c.anim.from.x) * k, 0, c.anim.from.z + (c.anim.to.z - c.anim.from.z) * k);
      if (c.anim.t >= 1) c.anim = null;
    }
    let all = true;
    for (const p of this.plates) {
      const on = this.crates.some((c) => c.i === p.i && c.j === p.j && !c.anim);
      if (on !== p.pressed) {
        p.pressed = on;
        p.m.top.position.y = on ? -0.06 : 0;
        p.m.rune.material.color.setHex(on ? 0x5aff9a : 0x4a4452);
        if (on) { this.world.audio.play('plate'); this.world.fx.magic(this.world.center(p.i, p.j).x, 0.3, this.world.center(p.i, p.j).z, 0x5aff9a, 10, 0.8); }
      }
      if (!on) all = false;
    }
    if (all && !this.solved) { this.solved = true; this.onSolved(); }
  }
}

// ---------------------------------------------------------------- 符文顺序
class RunePuzzle {
  constructor(world, room, rng, onSolved) {
    this.world = world; this.room = room; this.onSolved = onSolved;
    this.hint = '查看石板，按顺序触摸符文石柱';
    const n = world.d.floor < 3 ? 3 : 4;
    const cells = world.interior(room).filter((c) => world.isFree(c.i, c.j));
    let pick = [];
    for (const gap of [3, 2]) {
      pick = [];
      for (let t = 0; t < 400 && pick.length < n + 1 && cells.length; t++) {
        const c = cells[rng.int(0, cells.length - 1)];
        if (pick.some((p) => Math.abs(p.i - c.i) + Math.abs(p.j - c.j) < gap)) continue;
        pick.push(c);
      }
      if (pick.length >= n + 1) break;
    }
    this.ok = pick.length >= n + 1;
    if (!this.ok) return;
    const tab = pick.pop();
    world.reserve(tab.i, tab.j);
    const tc = world.center(tab.i, tab.j);
    const tablet = makeTablet();
    tablet.position.set(tc.x, 0, tc.z);
    world.addAt(tablet, tab.i, tab.j);
    world.setSolid(tab.i, tab.j, true);
    this.pillars = pick.map((c, k) => {
      world.reserve(c.i, c.j);
      const m = makeRunePillar(k, RUNE_COLORS[k]);
      const p = world.center(c.i, c.j);
      m.root.position.set(p.x, 0, p.z);
      world.addAt(m.root, c.i, c.j);
      world.setSolid(c.i, c.j, true);
      const pillar = { k, m, x: p.x, z: p.z, lit: 0, color: new THREE.Color(RUNE_COLORS[k]), label: '触摸符文', icon: 'hand', radius: 1.9 };
      pillar.enabled = () => !this.solved && this.state === 'input';
      pillar.interact = () => this.touch(pillar);
      world.addInteract(pillar);
      world.addLight({ x: p.x, y: 2, z: p.z, color: new THREE.Color(RUNE_COLORS[k]).getHex(), intensity: () => pillar.lit * 10, range: 7, on: () => pillar.lit > 0.05, region: world.regionAt(c.i, c.j), priority: 2 });
      return pillar;
    });
    const order = this.pillars.map((p) => p.k);
    for (let i = order.length - 1; i > 0; i--) { const j = rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
    if (world.d.floor >= 5) order.push(rng.int(0, n - 1));
    this.seq = order;
    this.progress = 0;
    this.state = 'idle';
    this.tablet = { x: tc.x, z: tc.z, label: '查看石板', icon: 'eye', radius: 1.9, enabled: () => !this.solved && this.state !== 'showing', interact: () => this.show() };
    world.addInteract(this.tablet);
  }
  show() {
    this.state = 'showing';
    this.progress = 0;
    this.showT = -0.4;
    this.showIdx = -1;
    this.world.audio.play('magic');
  }
  touch(p) {
    const w = this.world;
    if (this.seq[this.progress] === p.k) {
      p.lit = 1;
      w.audio.play('rune' + p.k);
      w.fx.magic(p.x, 1.5, p.z, p.color.getHex(), 12, 0.5);
      this.progress++;
      if (this.progress >= this.seq.length) {
        this.solved = true;
        this.state = 'done';
        this.onSolved();
      }
    } else {
      w.audio.play('zap');
      w.fx.sparks(p.x, 1.6, p.z, 20, 0x9fe8ff, 5);
      w.player.hurt(1, p.x, p.z, 'trap');
      w.game.hud.toast('顺序错误！重新查看石板', '#ff8a7a');
      this.progress = 0;
      for (const q of this.pillars) q.lit = 0;
      this.state = 'idle';
    }
  }
  update(dt) {
    if (this.state === 'showing') {
      this.showT += dt;
      const step = Math.floor(this.showT / 0.75);
      if (step !== this.showIdx && step >= 0) {
        this.showIdx = step;
        if (step < this.seq.length) {
          const p = this.pillars[this.seq[step]];
          p.lit = 1;
          this.world.audio.play('rune' + p.k);
          this.world.fx.magic(p.x, 1.5, p.z, p.color.getHex(), 8, 0.4);
        } else { this.state = 'input'; this.world.game.hud.toast('按刚才的顺序触摸符文'); }
      }
    }
    for (const p of this.pillars) {
      const keep = this.solved || (this.state === 'input' && this.progressLit(p));
      if (!keep) p.lit = Math.max(0, p.lit - dt * (this.state === 'showing' ? 1.8 : 3));
      const v = this.solved ? 0.8 + Math.sin(this.world.time * 3 + p.k) * 0.2 : p.lit;
      p.m.mat.color.setRGB(0.29 + (p.color.r - 0.29) * v, 0.27 + (p.color.g - 0.27) * v, 0.32 + (p.color.b - 0.32) * v);
      p.m.glow.material.opacity = v * 0.9;
    }
  }
  progressLit(p) { for (let k = 0; k < this.progress; k++) if (this.seq[k] === p.k) return true; return false; }
}

// ---------------------------------------------------------------- 光束反射
const reflect = (d, type) => (type === '/' ? [-d[1], -d[0]] : [d[1], d[0]]);
class MirrorPuzzle {
  constructor(world, room, rng, onSolved) {
    this.world = world; this.room = room; this.onSolved = onSolved;
    this.hint = '旋转镜子，把光束引向水晶';
    this.ok = false;
    const turns = world.d.floor >= 6 ? 3 : 2;
    for (let t = 0; t < 80 && !this.ok; t++) this.ok = this.tryBuild(rng, turns);
    if (!this.ok) return;
    this.beams = [];
    this.recalc();
  }
  tryBuild(rng, turns) {
    const w = this.world, room = this.room;
    const x0 = room.x + 1, x1 = room.x + room.w - 2, y0 = room.y + 1, y1 = room.y + room.h - 2;
    const side = rng.int(0, 3);
    let e, d;
    if (side === 0) { e = [x0, rng.int(y0, y1)]; d = [1, 0]; }
    else if (side === 1) { e = [x1, rng.int(y0, y1)]; d = [-1, 0]; }
    else if (side === 2) { e = [rng.int(x0, x1), y0]; d = [0, 1]; }
    else { e = [rng.int(x0, x1), y1]; d = [0, -1]; }
    const used = new Set([e[0] + ',' + e[1]]);
    const path = [];
    const mirrors = [];
    let cur = e.slice(), dir = d.slice();
    for (let s = 0; s <= turns; s++) {
      const L = rng.int(s === turns ? 1 : 2, 3);
      for (let k = 0; k < L; k++) {
        cur = [cur[0] + dir[0], cur[1] + dir[1]];
        if (!inInterior(room, cur[0], cur[1]) || !w.isFree(cur[0], cur[1])) return false;
        path.push(cur.slice());
      }
      const key = cur[0] + ',' + cur[1];
      if (used.has(key)) return false;
      used.add(key);
      if (s < turns) {
        const nd = rng() < 0.5 ? [dir[1], dir[0]] : [-dir[1], -dir[0]];
        const type = (-dir[1] === nd[0] && -dir[0] === nd[1]) ? '/' : '\\';
        mirrors.push({ i: cur[0], j: cur[1], type });
        dir = nd;
      }
    }
    const recv = cur;
    // 镜子/接收器所在格不能出现在其他路径段中间
    for (const m of mirrors.concat([{ i: recv[0], j: recv[1] }])) {
      const hits = path.filter((p) => p[0] === m.i && p[1] === m.j).length;
      if (hits > 1) return false;
    }
    if (path.some((p) => p[0] === e[0] && p[1] === e[1])) return false;
    // 构建
    for (const p of path) w.reserve(p[0], p[1]);
    w.reserve(e[0], e[1]);
    const em = makeEmitter();
    const ec = w.center(e[0], e[1]);
    em.root.position.set(ec.x, 0, ec.z);
    em.aim.rotation.y = Math.atan2(d[0], d[1]);
    w.addAt(em.root, e[0], e[1]);
    w.setSolid(e[0], e[1], true);
    this.emitter = { i: e[0], j: e[1], d };
    const rv = makeReceiver();
    const rc = w.center(recv[0], recv[1]);
    rv.root.position.set(rc.x, 0, rc.z);
    w.addAt(rv.root, recv[0], recv[1]);
    w.setSolid(recv[0], recv[1], true);
    this.receiver = { i: recv[0], j: recv[1], m: rv };
    w.addLight({ x: rc.x, y: 1.5, z: rc.z, color: 0xff6a5a, intensity: () => (this.solved ? 10 : 0), range: 8, on: () => this.solved, region: w.regionAt(recv[0], recv[1]) });
    // 诱饵镜子
    if (w.d.floor >= 4) {
      const free = w.interior(room).filter((c) => w.isFree(c.i, c.j));
      if (free.length) { const c = free[rng.int(0, free.length - 1)]; mirrors.push({ i: c.i, j: c.j, type: rng() < 0.5 ? '/' : '\\', decoy: true }); }
    }
    // 打乱镜子朝向（至少一个错误）
    let wrong = 0;
    for (const m of mirrors) if (!m.decoy && rng() < 0.6) { m.type = m.type === '/' ? '\\' : '/'; wrong++; }
    if (!wrong) { const m = mirrors.find((q) => !q.decoy); m.type = m.type === '/' ? '\\' : '/'; }
    this.mirrors = mirrors.map((m) => {
      w.reserve(m.i, m.j);
      const mm = makeMirror();
      const c = w.center(m.i, m.j);
      mm.root.position.set(c.x, 0, c.z);
      w.addAt(mm.root, m.i, m.j);
      w.setSolid(m.i, m.j, true);
      const o = Object.assign(m, { mm, x: c.x, z: c.z, rot: m.type === '/' ? Math.PI / 4 : -Math.PI / 4, label: '旋转镜子', icon: 'hand', radius: 1.9 });
      mm.panel.rotation.y = o.rot;
      o.enabled = () => !this.solved;
      o.interact = () => this.rotate(o);
      w.addInteract(o);
      return o;
    });
    this.mirrorAt = new Map(this.mirrors.map((m) => [m.i + ',' + m.j, m]));
    return true;
  }
  rotate(m) {
    m.type = m.type === '/' ? '\\' : '/';
    m.target = m.type === '/' ? Math.PI / 4 : -Math.PI / 4;
    this.world.audio.play('mirror');
    this.recalc();
  }
  recalc() {
    const w = this.world;
    let [i, j] = [this.emitter.i, this.emitter.j];
    let d = this.emitter.d.slice();
    const pts = [w.center(i, j)];
    let hit = false;
    for (let s = 0; s < 60; s++) {
      const ni = i + d[0], nj = j + d[1];
      if (w.isWall(ni, nj)) { const c = w.center(i, j); pts.push({ x: c.x + d[0] * 1, z: c.z + d[1] * 1 }); break; }
      i = ni; j = nj;
      if (i === this.receiver.i && j === this.receiver.j) { pts.push(w.center(i, j)); hit = true; break; }
      const m = this.mirrorAt.get(i + ',' + j);
      if (m) { pts.push(w.center(i, j)); d = reflect(d, m.type); continue; }
      if (w.solid[w.idx(i, j)]) { const c = w.center(i, j); pts.push({ x: c.x - d[0] * 0.6, z: c.z - d[1] * 0.6 }); break; }
    }
    this.drawBeam(pts, hit);
    if (hit && !this.solved) {
      this.solved = true;
      w.fx.magic(w.center(i, j).x, 1, w.center(i, j).z, 0xffd86a, 30, 0.6);
      this.onSolved();
    }
  }
  drawBeam(pts, hit) {
    const w = this.world;
    for (const b of this.beams) b.parent && b.parent.remove(b);
    this.beams = [];
    const col = hit ? 0xffd86a : 0xff4a3a;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      const g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
      const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, len, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      g.add(core, halo);
      g.position.set((a.x + b.x) / 2, 0.95, (a.z + b.z) / 2);
      g.rotation.z = Math.PI / 2;
      g.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      g.rotation.order = 'YZX';
      w.addAt(g, this.emitter.i, this.emitter.j);
      this.beams.push(g);
      const s = glowSprite(col, 1.4, 0.8);
      s.position.set(b.x, 0.95, b.z);
      w.addAt(s, this.emitter.i, this.emitter.j);
      this.beams.push(s);
    }
    this.receiver.m.glow.material.opacity = hit ? 0.9 : 0;
    this.receiver.m.crystal.material.emissive.setHex(hit ? 0xffa03a : 0x1a1022);
  }
  update(dt) {
    for (const m of this.mirrors) {
      if (m.target === undefined) continue;
      const cur = m.mm.panel.rotation.y;
      let diff = m.target - cur;
      diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      m.mm.panel.rotation.y = cur + diff * Math.min(1, dt * 12);
    }
    if (!this.solved && this.beams.length && Math.random() < dt * 10) {
      const b = this.beams[this.beams.length - 1];
      this.world.fx.sparks(b.position.x, 0.95, b.position.z, 1, 0xff8a6a, 1.5);
    }
  }
}

// ---------------------------------------------------------------- 火盆拉杆（点亮全部火盆）
class LeverPuzzle {
  constructor(world, room, rng, onSolved) {
    this.world = world; this.room = room; this.onSolved = onSolved;
    this.hint = '每根拉杆会切换相邻的火盆，点亮全部火盆';
    const x0 = room.x + 1, x1 = room.x + room.w - 2, y0 = room.y + 1;
    const iw = x1 - x0 + 1;
    const n = Math.min(5, Math.max(3, iw));
    const lr = y0 + 2 <= room.y + room.h - 2 ? y0 + 2 : y0 + 1;
    const cols = [];
    for (let k = 0; k < n; k++) cols.push(x0 + Math.round((k * (iw - 1)) / Math.max(1, n - 1)));
    const uniq = [...new Set(cols)];
    this.ok = uniq.length >= 3 && uniq.every((i) => world.isFree(i, y0) && world.isFree(i, lr));
    if (!this.ok) return;
    this.braziers = uniq.map((i, k) => {
      world.reserve(i, y0);
      const m = makeBrazier();
      const c = world.center(i, y0);
      m.root.position.set(c.x, 0, c.z);
      world.addAt(m.root, i, y0);
      world.setSolid(i, y0, true);
      const b = { k, m, x: c.x, z: c.z, lit: true };
      world.addLight({ x: c.x, y: 2, z: c.z, color: 0x4ad8ff, intensity: 8, range: 7, on: () => b.lit, region: world.regionAt(i, y0) });
      return b;
    });
    this.levers = uniq.map((i, k) => {
      world.reserve(i, lr);
      const m = makeLever();
      const c = world.center(i, lr);
      m.root.position.set(c.x, 0, c.z);
      world.addAt(m.root, i, lr);
      world.setSolid(i, lr, true);
      const lv = { k, m, x: c.x, z: c.z, up: true, label: '拉动拉杆', icon: 'hand', radius: 1.8 };
      lv.enabled = () => !this.solved;
      lv.interact = () => this.pull(lv);
      world.addInteract(lv);
      return lv;
    });
    // 从全亮反推随机状态
    const n2 = this.braziers.length;
    const presses = [];
    for (let t = 0; t < 20 && presses.length < Math.min(n2 - 1, 1 + Math.floor(world.d.floor / 3) + 1); t++) {
      const k = rng.int(0, n2 - 1);
      if (presses.indexOf(k) < 0) presses.push(k);
    }
    for (const k of presses) this.toggle(k, true);
    if (this.braziers.every((b) => b.lit)) this.toggle(0, true);
    this.refresh();
  }
  toggle(k, silent) {
    for (const q of [k - 1, k, k + 1]) if (this.braziers[q]) this.braziers[q].lit = !this.braziers[q].lit;
    if (!silent) this.refresh();
  }
  pull(lv) {
    lv.up = !lv.up;
    this.world.audio.play('lever');
    this.toggle(lv.k);
    for (const q of [lv.k - 1, lv.k, lv.k + 1]) {
      const b = this.braziers[q];
      if (b) this.world.fx.magic(b.x, 1.5, b.z, b.lit ? 0x4ad8ff : 0x6a6a6a, 8, 0.3);
    }
    if (this.braziers.every((b) => b.lit) && !this.solved) { this.solved = true; this.onSolved(); }
  }
  refresh() {
    for (const b of this.braziers) { b.m.flame.visible = b.lit; b.m.glow.visible = b.lit; }
  }
  update(dt) {
    for (const lv of this.levers) {
      const target = lv.up ? 0.6 : -0.6;
      lv.m.handle.rotation.x += (target - lv.m.handle.rotation.x) * Math.min(1, dt * 12);
    }
    for (const b of this.braziers) {
      if (b.lit) {
        const k = this.world.time * 10 + b.k;
        b.m.flame.scale.set(1 + Math.sin(k) * 0.1, 1 + Math.sin(k * 1.4) * 0.15, 1 + Math.cos(k) * 0.1);
      } else if (Math.random() < dt * 2) this.world.fx.smoke(b.x, 1.3, b.z, 1, 0.25, 0x555555, 0.2);
    }
  }
}

// ---------------------------------------------------------------- 记忆地砖：记住亮起的路径，只踩路径上的石板
class MemoryPuzzle {
  constructor(world, room, rng, onSolved) {
    this.world = world; this.room = room; this.onSolved = onSolved;
    this.hint = '查看石碑记住路径，只踩亮过的石板走到对面';
    const iw = room.w - 2, ih = room.h - 2;
    const gw = Math.min(5, iw), gh = Math.min(5, ih - 1);
    this.ok = false;
    if (gw < 3 || gh < 3) return;
    const x0 = room.x + 1 + Math.floor((iw - gw) / 2), y0 = room.y + 1;
    for (let j = y0; j < y0 + gh; j++) for (let i = x0; i < x0 + gw; i++) if (!world.isFree(i, j)) return;
    // 从最下排随机游走到最上排
    let path = null;
    for (let t = 0; t < 60 && !path; t++) {
      let ci = x0 + rng.int(0, gw - 1), cj = y0 + gh - 1;
      const pts = [[ci, cj]];
      const seen = new Set([ci + ',' + cj]);
      let guard = 0;
      while (cj > y0 && guard++ < 50) {
        const opts = [[0, -1], [0, -1], [1, 0], [-1, 0]].filter(([di, dj]) => {
          const ni = ci + di, nj = cj + dj;
          return ni >= x0 && ni < x0 + gw && nj >= y0 && !seen.has(ni + ',' + nj);
        });
        if (!opts.length) break;
        const [di, dj] = opts[rng.int(0, opts.length - 1)];
        ci += di; cj += dj; seen.add(ci + ',' + cj); pts.push([ci, cj]);
      }
      if (cj === y0 && pts.length >= gh + 1) path = pts;
    }
    if (!path) return;
    this.ok = true;
    this.path = path;
    this.onPath = new Set(path.map(([i, j]) => i + ',' + j));
    this.tiles = [];
    for (let j = y0; j < y0 + gh; j++) for (let i = x0; i < x0 + gw; i++) {
      world.reserve(i, j);
      const m = makeMemoryTile();
      const c = world.center(i, j);
      m.root.position.set(c.x, 0, c.z);
      world.addAt(m.root, i, j);
      this.tiles.push({ i, j, m, x: c.x, z: c.z, lit: 0, color: 0x2a2632 });
    }
    this.grid = { x0, y0, gw, gh };
    this.visited = new Set();
    this.state = 'idle';
    // 石碑放在网格下方
    const spots = [];
    for (let j = y0 + gh; j <= room.y + room.h - 2; j++) for (let i = room.x + 1; i <= room.x + room.w - 2; i++) if (world.isFree(i, j)) spots.push({ i, j });
    if (!spots.length) for (let i = room.x; i < room.x + room.w; i++) if (world.isFree(i, room.y + room.h - 1)) spots.push({ i, j: room.y + room.h - 1 });
    const sp = spots[Math.floor(spots.length / 2)] || { i: x0 - 1, j: y0 + gh };
    world.reserve(sp.i, sp.j);
    const tab = makeTablet();
    const tc = world.center(sp.i, sp.j);
    tab.position.set(tc.x, 0, tc.z);
    world.addAt(tab, sp.i, sp.j);
    world.setSolid(sp.i, sp.j, true);
    this.tablet = { x: tc.x, z: tc.z, label: '查看路径', icon: 'eye', radius: 2, enabled: () => !this.solved && this.state !== 'showing', interact: () => this.show() };
    world.addInteract(this.tablet);
    this.prevTile = null;
  }
  tileAt(i, j) { return this.tiles.find((t) => t.i === i && t.j === j); }
  show() {
    this.state = 'showing'; this.showT = 0; this.visited.clear();
    this.world.audio.play('magic');
  }
  update(dt) {
    const w = this.world;
    if (this.state === 'showing') {
      this.showT += dt;
      const n = Math.floor(this.showT / 0.35);
      for (let k = 0; k < this.path.length; k++) if (k <= n && this.showT < this.path.length * 0.35 + 1.2) { const t = this.tileAt(...this.path[k]); if (t.lit < 1 && k === n) w.audio.play('rune' + (k % 5)); t.lit = 1; t.color = 0x4affc0; }
      if (this.showT > this.path.length * 0.35 + 1.2) { this.state = 'input'; for (const t of this.tiles) t.lit = 0; w.game.hud.toast('沿着刚才亮起的路径走过去'); }
    } else if (this.state === 'input' && !this.solved && !w.player.airborne) {
      const p = w.player;
      const i = w.tileOf(p.x), j = w.tileOf(p.z);
      const key = i + ',' + j;
      const g = this.grid;
      const inside = i >= g.x0 && i < g.x0 + g.gw && j >= g.y0 && j < g.y0 + g.gh;
      if (inside && key !== this.prevTile) {
        const t = this.tileAt(i, j);
        if (this.onPath.has(key)) {
          if (!this.visited.has(key)) { this.visited.add(key); t.lit = 1; t.color = 0x4affc0; w.audio.play('plate'); }
          if (this.visited.size === this.path.length) { this.solved = true; for (const q of this.tiles) if (this.onPath.has(q.i + ',' + q.j)) { q.lit = 1; q.color = 0xffd86a; } this.onSolved(); }
        } else {
          t.lit = 1; t.color = 0xff3a2a;
          w.audio.play('zap');
          w.fx.sparks(t.x, 0.3, t.z, 16, 0xff6a4a, 4);
          p.hurt(1, t.x, t.z, 'trap');
          this.visited.clear();
          for (const q of this.tiles) if (q !== t) q.lit = 0;
          w.game.hud.toast('踩错了！重新查看路径或凭记忆再试', '#ff8a7a');
        }
      }
      this.prevTile = inside ? key : null;
    }
    for (const t of this.tiles) {
      if (this.state === 'input' && t.color === 0xff3a2a) t.lit = Math.max(0, t.lit - dt * 1.5);
      const c = t.lit > 0.02 ? t.color : 0x2a2632;
      t.m.rune.material.color.setHex(c);
    }
  }
}

// ---------------------------------------------------------------- 守护雕像：让四座熊雕像都面向中央（转动一座会带动下一座）
const DIRV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
class StatuePuzzle {
  constructor(world, room, rng, onSolved) {
    this.world = world; this.room = room; this.onSolved = onSolved;
    this.hint = '让所有雕像面向中央——转动一座雕像会带动下一座';
    this.ok = false;
    const c = { i: room.cx, j: room.cy };
    const offs = [[0, -2], [2, 0], [0, 2], [-2, 0]];
    const cells = offs.map(([di, dj]) => ({ i: c.i + di, j: c.j + dj }));
    if (!world.isFree(c.i, c.j) || !cells.every((q) => q.i > room.x && q.i < room.x + room.w - 1 && q.j > room.y && q.j < room.y + room.h - 1 && world.isFree(q.i, q.j))) return;
    this.ok = true;
    this.chestSpot = c;
    // 目标朝向：面向中心（北侧雕像要朝南等）
    const target = [2, 3, 0, 1];
    this.statues = cells.map((q, k) => {
      world.reserve(q.i, q.j);
      const m = makeStatueDial();
      const p = world.center(q.i, q.j);
      m.root.position.set(p.x, 0, p.z);
      m.root.scale.setScalar(1.25);
      world.addAt(m.root, q.i, q.j);
      world.setSolid(q.i, q.j, true);
      const st = { k, m, x: p.x, z: p.z, f: target[k], target: target[k], label: '转动雕像', icon: 'hand', radius: 2.0 };
      st.enabled = () => !this.solved;
      st.interact = () => this.turn(st);
      world.addInteract(st);
      return st;
    });
    const presses = 1 + Math.min(3, Math.floor(world.d.floor / 3));
    for (let t = 0; t < presses; t++) this.apply(rng.int(0, 3), rng.int(1, 3));
    if (this.statues.every((q) => q.f === q.target)) this.apply(0, 1);
    for (const q of this.statues) q.m.top.rotation.y = this.angle(q.f);
  }
  angle(f) { return Math.atan2(DIRV[f][0], DIRV[f][1]); }
  apply(k, times) { for (let t = 0; t < times; t++) { this.statues[k].f = (this.statues[k].f + 1) % 4; this.statues[(k + 1) % 4].f = (this.statues[(k + 1) % 4].f + 1) % 4; } }
  turn(st) {
    this.apply(st.k, 1);
    this.world.audio.play('mirror');
    this.world.fx.dust(st.x, 0.3, st.z, 4, 0x8a8494);
    if (this.statues.every((q) => q.f === q.target)) { this.solved = true; this.onSolved(); }
  }
  update(dt) {
    for (const q of this.statues) {
      const want = this.angle(q.f);
      let d = want - q.m.top.rotation.y;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      q.m.top.rotation.y += d * Math.min(1, dt * 8);
      q.m.eye.material.color.setHex(q.f === q.target ? (this.solved ? 0xffd86a : 0x4affc0) : 0x3a2a2a);
    }
  }
}

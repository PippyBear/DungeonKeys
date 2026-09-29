// 世界：地牢数据、碰撞、迷雾揭示、动态光源池、流场寻路、拾取物与弹道
import * as THREE from 'three';
import { T, WALL } from './dungeon.js';
import { makeCoin, makeHeartPickup, makeCrystalPickup, makeKey, blobShadow } from './models.js';
import { clamp } from './utils.js';
import { heightAt, walkable, K, PIT } from './terrain.js';

let LIGHTS = 5;

export class World {
  constructor(s3, d, game, run, fx) {
    this.s3 = s3;
    this.d = d;
    this.game = game;
    this.audio = game.audio;
    this.run = run;
    this.fx = fx;
    this.W = d.W; this.H = d.H;
    this.solid = new Uint8Array(d.W * d.H);
    this.propH = new Float32Array(d.W * d.H);   // 可站立障碍物（桌子、木桶、宝箱…）顶面的绝对高度
    this.platforms = [];                        // 移动平台
    this.reserved = new Uint8Array(d.W * d.H);
    this.objAt = new Map();
    this.discovered = new Uint8Array(d.regions);
    this.groups = [];
    this.interactables = [];
    this.updatables = [];
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.lightSources = [];
    this.breakables = [];
    this.time = 0;
    this.timers = [];
    this.flow = new Int16Array(d.W * d.H).fill(-1);
    this.flowT = 0;
    LIGHTS = game.save.data.settings.quality === 'high' ? 5 : game.save.data.settings.quality === 'mid' ? 4 : 3;
    this.lights = [];
    for (let k = 0; k < LIGHTS; k++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 11, 1.6);
      s3.add(l);
      this.lights.push(l);
    }
    this.lightT = 0;
    this.doorstep = new Uint8Array(d.W * d.H);
    for (const r of d.rooms) for (const e of r.entrances) {
      this.doorstep[this.idx(e.i, e.j)] = 1;
      this.doorstep[this.idx(e.i - e.dir[0], e.j - e.dir[1])] = 1;
    }
  }
  idx(i, j) { return j * this.W + i; }
  center(i, j) { return { x: i * T + T / 2, z: j * T + T / 2 }; }
  tileOf(v) { return Math.floor(v / T); }
  tileAt(i, j) { return i < 0 || j < 0 || i >= this.W || j >= this.H ? WALL : this.d.tile[this.idx(i, j)]; }
  isWall(i, j) { return this.tileAt(i, j) === WALL; }
  blocked(i, j) { return this.isWall(i, j) || this.solid[this.idx(i, j)] > 0; }
  regionAt(i, j) { return this.isWall(i, j) ? -1 : this.d.region[this.idx(i, j)]; }
  roomAt(i, j) { const r = this.regionAt(i, j); return r >= 0 && this.d.roomByRegion ? this.d.roomByRegion[r] || null : null; }
  // 地形高度（墙返回 9）
  groundAt(x, z) {
    const i = Math.floor(x / T), j = Math.floor(z / T);
    if (this.isWall(i, j)) return 9;
    const k = this.idx(i, j);
    const g = heightAt(this.d, k, x / T - i, z / T - j);
    return this.solid[k] && this.propH[k] > g ? this.propH[k] : g;
  }
  // 含移动平台的落脚高度（只算脚下 y+0.35 以内的平台）；返回 { g, plat }
  footAt(x, z, y) {
    let g = this.groundAt(x, z), plat = null;
    for (const P of this.platforms) {
      if (Math.abs(x - P.x) < P.hw + 0.12 && Math.abs(z - P.z) < P.hd + 0.12 && P.top <= y + 0.35 && P.top > g) { g = P.top; plat = P; }
    }
    return { g, plat };
  }
  updatePlatforms(dt) { for (const P of this.platforms) P.update(dt); }
  // 格子内离 (x,z) 最近一点的高度（用于碰撞：楼梯从低端进入时按低端算）
  topNear(i, j, x, z) {
    const k = this.idx(i, j);
    const g = heightAt(this.d, k, clamp(x / T - i, 0, 1), clamp(z / T - j, 0, 1));
    return this.solid[k] && this.propH[k] > g ? this.propH[k] : g;
  }
  kindAt(i, j) { return this.isWall(i, j) ? -1 : this.d.kind[this.idx(i, j)]; }
  isPit(i, j) { return this.kindAt(i, j) === K.PIT; }
  hazardAt(x, z) { return this.hazards ? this.hazards.get(this.idx(this.tileOf(x), this.tileOf(z))) || null : null; }
  // h：障碍物高度（>0 表示可以跳上去站立）
  setSolid(i, j, on, obj, h) {
    const k = this.idx(i, j);
    this.solid[k] = Math.max(0, this.solid[k] + (on ? 1 : -1));
    if (on && h) { const g = heightAt(this.d, k, 0.5, 0.5); this.propH[k] = Math.max(this.propH[k], g + h); }
    if (!this.solid[k] || (!on && h)) this.propH[k] = 0;
    if (obj) { if (on) this.objAt.set(k, obj); else if (this.objAt.get(k) === obj) this.objAt.delete(k); }
    this.flowDirty = true;
  }
  interior(room) {
    const out = [];
    for (let j = room.y + 1; j <= room.y + room.h - 2; j++) for (let i = room.x + 1; i <= room.x + room.w - 2; i++) out.push({ i, j });
    return out;
  }
  isFree(i, j) { const k = this.idx(i, j); return !this.isWall(i, j) && !this.reserved[k] && !this.solid[k] && !this.doorstep[k]; }
  reserve(i, j) { this.reserved[this.idx(i, j)] = 1; }
  groupAt(i, j) { const r = this.regionAt(i, j); return this.groups[Math.max(0, r)]; }
  addAt(obj3d, i, j) { this.groupAt(i, j).add(obj3d); return obj3d; }

  // ------------------------------------------------------------ 碰撞（圆 vs 格子）
  // hc: { y, step, drop } 高度约束：比脚下高出 step 以上 / 低于 drop 以上的格子视为阻挡
  moveCircle(e, dx, dz, r, ignoreSolid = false, hc = null) {
    let hit = null;
    const test = (i, j) => {
      if (this.isWall(i, j)) return true;
      if (!ignoreSolid && this.solid[this.idx(i, j)]) {
        // 可站立障碍：跳得够高就能踩上去
        const ph = this.propH[this.idx(i, j)];
        if (!(hc && ph > 0 && hc.y >= ph - hc.step)) return true;
      }
      if (!hc) return false;
      const top = this.topNear(i, j, e.x, e.z);
      return top > hc.y + hc.step || top < hc.y - hc.drop;
    };
    e.x += dx;
    {
      const i0 = this.tileOf(e.x - r), i1 = this.tileOf(e.x + r), j0 = this.tileOf(e.z - r + 0.001), j1 = this.tileOf(e.z + r - 0.001);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!test(i, j)) continue;
        const cz = clamp(e.z, j * T, j * T + T);
        if (Math.abs(cz - e.z) >= r) continue;
        if (dx > 0 && e.x + r > i * T && e.x < i * T + T / 2) { e.x = i * T - r; hit = { i, j, di: 1, dj: 0 }; }
        else if (dx < 0 && e.x - r < i * T + T && e.x > i * T + T / 2) { e.x = i * T + T + r; hit = { i, j, di: -1, dj: 0 }; }
      }
    }
    e.z += dz;
    {
      const j0 = this.tileOf(e.z - r), j1 = this.tileOf(e.z + r), i0 = this.tileOf(e.x - r + 0.001), i1 = this.tileOf(e.x + r - 0.001);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!test(i, j)) continue;
        const cx = clamp(e.x, i * T, i * T + T);
        if (Math.abs(cx - e.x) >= r) continue;
        if (dz > 0 && e.z + r > j * T && e.z < j * T + T / 2) { e.z = j * T - r; hit = { i, j, di: 0, dj: 1 }; }
        else if (dz < 0 && e.z - r < j * T + T && e.z > j * T + T / 2) { e.z = j * T + T + r; hit = { i, j, di: 0, dj: -1 }; }
      }
    }
    return hit;
  }
  los(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d / 0.5);
    for (let k = 1; k < n; k++) {
      const x = x0 + (x1 - x0) * (k / n), z = z0 + (z1 - z0) * (k / n);
      if (this.isWall(this.tileOf(x), this.tileOf(z))) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ 迷雾揭示
  discover(r) {
    if (r < 0 || this.discovered[r]) return;
    if (this.hiddenRegions && this.hiddenRegions.has(r)) return;
    this.discovered[r] = 1;
    this.groups[r].visible = true;
    const g = this.groups[r];
    g.traverse((o) => { if (o.material && o.material.userData && o.material.userData.fadeIn) o.material.opacity = 0; });
  }
  updateDiscovery(px, pz) {
    const pi = this.tileOf(px), pj = this.tileOf(pz);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const r = this.regionAt(pi + di, pj + dj);
      if (r >= 0 && !this.discovered[r]) {
        if (Math.abs(di) + Math.abs(dj) <= 2 && this.los(px, pz, (pi + di) * T + 1, (pj + dj) * T + 1)) this.discover(r);
      }
    }
  }
  revealAll() { for (let r = 0; r < this.d.regions; r++) this.discover(r); }

  // ------------------------------------------------------------ 光源池
  addLight(src) { this.lightSources.push(src); return src; }
  updateLights(dt, px, pz) {
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.25;
      const cand = [];
      for (const s of this.lightSources) {
        if (s.on && !s.on()) continue;
        if (s.region !== undefined && s.region >= 0 && !this.discovered[s.region]) continue;
        const d = (s.x - px) ** 2 + (s.z - pz) ** 2;
        if (d > 22 * 22) continue;
        cand.push({ s, d: d / (s.priority || 1) });
      }
      cand.sort((a, b) => a.d - b.d);
      this.activeLights = cand.slice(0, LIGHTS).map((c) => c.s);
    }
    const act = this.activeLights || [];
    for (let k = 0; k < LIGHTS; k++) {
      const l = this.lights[k];
      const s = act[k];
      if (!s) { l.intensity = Math.max(0, l.intensity - dt * 20); continue; }
      l.position.set(s.x, s.y, s.z);
      l.color.setHex(s.color);
      l.distance = s.range || 11;
      const fl = s.flicker ? 0.82 + Math.sin(this.time * 17 + s.x) * 0.08 + Math.sin(this.time * 29 + s.z) * 0.06 : 1;
      const target = (typeof s.intensity === 'function' ? s.intensity() : s.intensity) * fl;
      l.intensity += (target - l.intensity) * Math.min(1, dt * 10);
    }
  }

  // ------------------------------------------------------------ 流场（敌人寻路）
  updateFlow(dt, px, pz) {
    this.flowT -= dt;
    const pi = this.tileOf(px), pj = this.tileOf(pz);
    if (this.flowT > 0 && !(this.flowDirty && this.flowT < 0.15) && pi === this.fpi && pj === this.fpj) return;
    this.flowT = 0.3;
    this.flowDirty = false;
    this.fpi = pi; this.fpj = pj;
    const f = this.flow;
    f.fill(-1);
    const W = this.W;
    const DI = [1, -1, 0, 0], DJ = [0, 0, 1, -1];
    const s = this.idx(pi, pj);
    if (this.isWall(pi, pj)) return;
    f[s] = 0;
    const q = [s];
    let h = 0;
    while (h < q.length) {
      const c = q[h++];
      const ci = c % W, cj = (c - ci) / W;
      const nd = f[c] + 1;
      if (nd > 40) continue;
      const nb = [c + 1, c - 1, c + W, c - W];
      const ok = [ci < W - 1, ci > 0, cj < this.H - 1, cj > 0];
      for (let k = 0; k < 4; k++) {
        if (!ok[k]) continue;
        const n = nb[k];
        if (f[n] >= 0 || this.d.tile[n] === WALL || this.solid[n]) continue;
        if (!walkable(this.d, c, n, DI[k], DJ[k])) continue;
        f[n] = nd;
        q.push(n);
      }
    }
  }
  flowStep(x, z) {
    const i = this.tileOf(x), j = this.tileOf(z);
    const f = this.flow, d = this.d;
    const hk = this.idx(i, j);
    const here = f[hk];
    let best = here < 0 ? 9999 : here, bi = -1, bj = -1;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= this.W || nj >= this.H) continue;
      const nk = this.idx(ni, nj);
      const v = f[nk];
      if (v < 0 || v >= best) continue;
      if (di && dj) {
        if (this.blocked(i + di, j) || this.blocked(i, j + dj)) continue;
        const ak = this.idx(i + di, j), bk = this.idx(i, j + dj);
        if (!walkable(d, hk, ak, di, 0) || !walkable(d, ak, nk, 0, dj) || !walkable(d, hk, bk, 0, dj) || !walkable(d, bk, nk, di, 0)) continue;
      } else if (!walkable(d, hk, nk, di, dj)) continue;
      best = v; bi = ni; bj = nj;
    }
    if (bi < 0) return null;
    return this.center(bi, bj);
  }

  // ------------------------------------------------------------ 交互物
  addInteract(o) { this.interactables.push(o); return o; }
  removeInteract(o) { const k = this.interactables.indexOf(o); if (k >= 0) this.interactables.splice(k, 1); }
  nearestInteract(px, pz, face, py) {
    let best = null, bs = 1e9;
    for (const o of this.interactables) {
      if (o.enabled && !o.enabled()) continue;
      if (py !== undefined) { const oy = o.y !== undefined ? o.y : this.groundAt(o.x, o.z); if (oy < 8 && Math.abs(oy - py) > 1.3) continue; }
      const d = Math.hypot(o.x - px, o.z - pz);
      const r = o.radius || 1.8;
      if (d > r) continue;
      const a = Math.atan2(o.x - px, o.z - pz);
      let da = Math.abs(((a - face + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      const s = d + da * 0.4;
      if (s < bs) { bs = s; best = o; }
    }
    return best;
  }

  // ------------------------------------------------------------ 拾取物
  spawnPickup(kind, x, z, opts = {}) {
    let mesh;
    if (kind === 'coin') mesh = makeCoin();
    else if (kind === 'heart') mesh = makeHeartPickup();
    else if (kind === 'crystal') mesh = makeCrystalPickup();
    else mesh = makeKey();
    const g = new THREE.Group();
    g.add(mesh);
    const sh = blobShadow(kind === 'key' ? 1 : 0.6);
    this.s3.add(g);
    this.s3.add(sh);
    const a = Math.random() * Math.PI * 2, sp = opts.burst === false ? 0 : 1.5 + Math.random() * 2.5;
    const p = { kind, mesh: g, shadow: sh, x, z, y: opts.y || 0.8, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: opts.burst === false ? 0 : 5 + Math.random() * 2, t: 0, value: opts.value || 1, delay: 0.5 };
    this.pickups.push(p);
    return p;
  }
  updatePickups(dt, player) {
    for (let k = this.pickups.length - 1; k >= 0; k--) {
      const p = this.pickups[k];
      p.t += dt;
      p.delay -= dt;
      let gy = this.groundAt(p.x, p.z);
      if (gy > 8) gy = 0;
      const rest = gy + 0.6;
      if (p.vy !== 0 || p.y > rest + 0.01) {
        p.vy -= 20 * dt;
        p.y += p.vy * dt;
        const e = { x: p.x, z: p.z };
        this.moveCircle(e, p.vx * dt, p.vz * dt, 0.2, true, { y: p.y - 0.6, step: 0.2, drop: 99 });
        p.x = e.x; p.z = e.z;
        let g2 = this.groundAt(p.x, p.z); if (g2 > 8) g2 = 0;
        if (p.y <= g2 + 0.6) { p.y = g2 + 0.6; p.vy = Math.abs(p.vy) > 3 ? -p.vy * 0.35 : 0; p.vx *= 0.5; p.vz *= 0.5; if (p.kind === 'coin' && Math.abs(p.vy) > 0.5) this.audio.play('coinbounce'); }
      } else p.y = rest;
      // 掉进深渊的拾取物：送回最近的安全地面
      if (p.y < PIT + 1.2 && player.safe) { p.x = player.safe.x; p.z = player.safe.z; p.y = player.safe.y + 2; p.vy = 0; p.vx = p.vz = 0; }
      const d = Math.hypot(player.x - p.x, player.z - p.z) + Math.max(0, Math.abs(player.y + 0.6 - p.y) - 0.8);
      const magnet = p.kind === 'key' ? 1.5 : 2.6;
      if (p.delay <= 0 && d < magnet && player.alive) {
        const sp = 12 * dt;
        p.x += (player.x - p.x) / Math.max(d, 0.01) * Math.min(d, sp);
        p.z += (player.z - p.z) / Math.max(d, 0.01) * Math.min(d, sp);
        if (d < 0.6) { this.collect(p, player); this.s3.remove(p.mesh); this.s3.remove(p.shadow); this.pickups.splice(k, 1); continue; }
      }
      p.mesh.position.set(p.x, p.y + Math.sin(p.t * 3) * 0.12, p.z);
      p.mesh.rotation.y += dt * (p.kind === 'key' ? 1.8 : 3);
      p.shadow.position.set(p.x, p.y - 0.57, p.z);
    }
  }
  collect(p, player) {
    const run = this.run;
    switch (p.kind) {
      case 'coin': {
        const v = Math.round(p.value * (1 + 0.5 * (run.abilities.greed || 0)));
        run.coins += v;
        this.audio.play('coin');
        this.fx.text(p.x, 1.8, p.z, '+' + v, '#ffcf4a', 0.6);
        break;
      }
      case 'heart':
        player.heal(2);
        this.audio.play('heal');
        break;
      case 'crystal':
        run.crystals += p.value;
        this.game.save.data.crystals += p.value;
        this.game.save.save();
        this.audio.play('crystal');
        this.fx.text(p.x, 1.8, p.z, '+' + p.value + ' 水晶', '#c89aff', 0.7);
        break;
      case 'key':
        run.keys++;
        this.audio.play('key');
        this.fx.magic(p.x, 0.5, p.z, 0xffd86a, 20, 1);
        this.game.hud.toast('获得钥匙！（' + run.keys + '/' + this.d.keysNeeded + '）', '#ffcf4a');
        break;
      default: break;
    }
    this.game.hud.dirty = true;
  }
  dropLoot(x, z, coins = 1, heartChance = 0, crystalChance = 0) {
    const luck = this.game.save.data.meta.luck || 0;
    const mul = this.lootMul || 1;
    const n = Math.round((coins + (Math.random() < luck * 0.25 ? 1 : 0)) * mul);
    crystalChance *= mul;
    for (let k = 0; k < n; k++) this.spawnPickup('coin', x, z, { value: 1 + Math.floor(Math.random() * 3) });
    if (Math.random() < heartChance) this.spawnPickup('heart', x, z);
    if (Math.random() < crystalChance * (1 + luck * 0.4)) this.spawnPickup('crystal', x, z);
  }

  // ------------------------------------------------------------ 弹道
  addProjectile(p) {
    this.s3.add(p.mesh);
    p.t = 0;
    // 发射高度相对发射者脚下地面；对直线弹道做垂直瞄准（打得到高台上/台下的目标）
    if (!p.absY && p.y !== undefined && !p.grav) { let g = this.groundAt(p.x, p.z); if (g > 8) g = 0; p.y += g; }
    const tg = p.target || (p.team === 'enemy' && !p.grav ? this.player : null);
    if (tg && !p.grav && p.vy === undefined && tg.y !== undefined) {
      const sp = Math.hypot(p.vx, p.vz) || 1;
      const dist = Math.hypot(tg.x - p.x, tg.z - p.z);
      p.vy = clamp(((tg.y + 0.8) - p.y) / Math.max(0.15, dist / sp), -12, 12);
    }
    this.projectiles.push(p);
    return p;
  }
  updateProjectiles(dt, player) {
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const p = this.projectiles[k];
      p.t += dt;
      if (p.update) p.update(p, dt);
      p.x += p.vx * dt; p.z += p.vz * dt;
      if (p.vy !== undefined) { p.vy -= (p.grav || 0) * dt; p.y += p.vy * dt; }
      p.mesh.position.set(p.x, p.y, p.z);
      if (p.spin) p.mesh.rotation.y += p.spin * dt;
      let dead = p.t > (p.life || 3);
      const ti = this.tileOf(p.x), tj = this.tileOf(p.z);
      if (!dead && (this.isWall(ti, tj) || (p.hitSolid !== false && this.solid[this.idx(ti, tj)] && !this.doorstep[this.idx(ti, tj)]))) dead = true;
      if (!dead && p.y !== undefined && !p.grav && p.team && this.groundAt(p.x, p.z) > p.y + (p.team === 'player' ? 0.5 : 0.05)) dead = true;
      if (dead && p.team === 'player' && this.crackedWalls) for (const cw of this.crackedWalls) if (!cw.broken && cw.i === ti && cw.j === tj) cw.hit();
      if (!dead && p.y !== undefined && p.grav && p.y <= Math.min(8, this.groundAt(p.x, p.z)) + 0.2) dead = true;
      if (!dead) {
        if (p.team === 'enemy') {
          if (player.alive && Math.hypot(player.x - p.x, player.z - p.z) < (p.radius || 0.5) && (p.y === undefined || Math.abs(p.y - (player.y + 0.8)) < 1.1)) {
            player.hurt(p.dmg, p.x - p.vx, p.z - p.vz, p.source || 'enemy');
            if (p.onHitPlayer) p.onHitPlayer(p);
            dead = true;
          }
        } else if (p.team === 'player') {
          for (const e of this.enemies) {
            if (e.dead || (p.hitList && p.hitList.has(e))) continue;
            if (Math.hypot(e.x - p.x, e.z - p.z) < (p.radius || 0.6) + e.radius && (p.y === undefined || e.y === undefined || Math.abs(p.y - (e.y + 0.8)) < 1.5)) {
              if (p.onHitEnemy) p.onHitEnemy(p, e);
              else e.hurt(p.dmg, p.x - p.vx * 0.1, p.z - p.vz * 0.1);
              if (p.pierce) { p.hitList = p.hitList || new Set(); p.hitList.add(e); } else { dead = true; break; }
            }
          }
          if (!dead && p.breakables !== false) {
            for (const b of this.breakables) {
              if (!b.broken && Math.hypot(b.x - p.x, b.z - p.z) < 0.9) { b.smash(); if (!p.pierce) { dead = true; break; } }
            }
          }
        }
      }
      if (dead) {
        if (p.onDie) p.onDie(p);
        this.s3.remove(p.mesh);
        this.projectiles.splice(k, 1);
      }
    }
  }
  enemiesInRadius(x, z, r) { return this.enemies.filter((e) => !e.dead && Math.hypot(e.x - x, e.z - z) < r + e.radius); }

  // 按游戏时间调度（暂停时不会触发）
  after(delay, fn) { this.timers.push({ t: this.time + delay, fn }); }
  update(dt, player) {
    this.time += dt;
    if (this.timers.length) {
      const due = this.timers.filter((q) => q.t <= this.time);
      if (due.length) { this.timers = this.timers.filter((q) => q.t > this.time); for (const q of due) q.fn(); }
    }
    for (let k = this.updatables.length - 1; k >= 0; k--) {
      const u = this.updatables[k];
      if (u.update(dt) === false) this.updatables.splice(k, 1);
    }
    this.updatePickups(dt, player);
    this.updateProjectiles(dt, player);
    this.updateLights(dt, player.x, player.z);
    const fa = player.airborne && player.safe;
    this.updateFlow(dt, fa ? player.safe.x : player.x, fa ? player.safe.z : player.z);
  }
}

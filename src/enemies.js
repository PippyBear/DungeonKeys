// 敌人：骷髅战士、骷髅弓手、史莱姆、蝙蝠、宝箱怪、石魔 Boss
import * as THREE from 'three';
import { makeArrow, blobShadow, Geo, matChar, matGlow, glowSprite, addOutlines } from './models.js';
import { makeSkeleton, makeSlime, makeBat, makeGolem, makeMimic, makeMushroomMan, makeWraith, makeIceMage, makeFireImp, makeLich } from './creatures.js';
import { HealthBar } from './effects.js';
import { angleLerp, clamp } from './utils.js';
import { PIT, K } from './terrain.js';

export const DEFS = {
  skeleton: { name: '骷髅战士', hp: 32, speed: 2.5, dmg: 1, radius: 0.45, range: 1.35, windup: 0.5, cd: 1.1, coins: 1 },
  archer: { name: '骷髅弓手', hp: 22, speed: 2.3, dmg: 1, radius: 0.45, range: 7, windup: 0.65, cd: 2.3, coins: 1 },
  slime: { name: '史莱姆', hp: 26, speed: 3.2, dmg: 1, radius: 0.55, coins: 1 },
  slimelet: { name: '小史莱姆', hp: 9, speed: 3.6, dmg: 1, radius: 0.35, coins: 0 },
  bat: { name: '吸血蝙蝠', hp: 12, speed: 4.4, dmg: 1, radius: 0.4, flying: true, coins: 1 },
  mimic: { name: '宝箱怪', hp: 55, speed: 3.3, dmg: 2, radius: 0.6, range: 1.45, windup: 0.38, cd: 1.0, coins: 6 },
  golem: { name: '远古石魔', hp: 420, speed: 1.7, dmg: 2, radius: 1.3, boss: true, coins: 20 },
  lich: { name: '骷髅巫王', hp: 400, speed: 1.5, dmg: 1, radius: 1.0, boss: true, coins: 25 },
  mushroom: { name: '孢子蘑菇', hp: 34, speed: 1.9, dmg: 1, radius: 0.55, coins: 1 },
  wraith: { name: '怨灵', hp: 26, speed: 3.3, dmg: 1, radius: 0.45, flying: true, coins: 1 },
  iceMage: { name: '冰霜法师', hp: 24, speed: 2.2, dmg: 1, radius: 0.45, range: 7, windup: 0.7, cd: 2.5, coins: 1 },
  fireImp: { name: '火焰小鬼', hp: 20, speed: 3.6, dmg: 1, radius: 0.4, flying: true, range: 7, windup: 0.45, cd: 2.6, coins: 1 },
};

function telegraph(world, x, z, r, color = 0xff2a1a) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, fog: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
  const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, fog: false }));
  g.add(disc, ring, fill);
  const gy = world.groundAt(x, z);
  g.position.set(x, (gy > 8 ? 0 : gy) + 0.05, z);
  g.renderOrder = 3;
  world.s3.add(g);
  return { g, fill, remove: () => world.s3.remove(g), set(k) { fill.scale.setScalar(Math.max(0.01, k)); } };
}

export class Enemy {
  constructor(world, kind, x, z, opts = {}) {
    this.world = world;
    this.kind = kind;
    const def = DEFS[kind];
    this.def = def;
    const f = world.d.floor;
    const hpMul = 1 + 0.2 * (f - 1);
    this.maxHp = this.hp = Math.round(def.boss ? def.hp * (1 + 0.1 * (f - 1)) : def.hp * hpMul);
    this.dmg = def.dmg + (f >= 7 && !def.boss ? 1 : 0);
    this.speed = def.speed * (1 + Math.min(0.25, f * 0.02));
    this.radius = def.radius;
    this.flying = !!def.flying;
    this.x = x; this.z = z;
    const g0 = world.groundAt(x, z);
    this.y = g0 > 8 ? 0 : g0;
    this.lift = 0;
    this.hc = { y: this.y, step: 0.45, drop: 0.45 };
    this.vx = 0; this.vz = 0;
    this.face = Math.PI;
    this.cd = 0.5 + Math.random();
    this.state = 'chase';
    this.t = 0;
    this.burnT = 0; this.burnDps = 0; this.slowT = 0; this.freezeT = 0;
    this.aggro = !!opts.aggro;
    this.room = opts.room || null;
    this.dead = false;
    let r;
    if (kind === 'skeleton') r = makeSkeleton(false);
    else if (kind === 'archer') r = makeSkeleton(true);
    else if (kind === 'slime') r = makeSlime(0x5ad84a, 1);
    else if (kind === 'slimelet') r = makeSlime(0x7ae86a, 0.55);
    else if (kind === 'bat') r = makeBat();
    else if (kind === 'mimic') r = makeMimic();
    else if (kind === 'mushroom') r = makeMushroomMan();
    else if (kind === 'wraith') r = makeWraith();
    else if (kind === 'iceMage') r = makeIceMage();
    else if (kind === 'fireImp') r = makeFireImp();
    else if (kind === 'lich') r = makeLich();
    else r = makeGolem();
    addOutlines(r.root);
    this.rig = r;
    this.root = r.root;
    this.root.position.set(x, this.y, z);
    world.s3.add(this.root);
    this.shadow = blobShadow(this.radius * 2.6);
    world.s3.add(this.shadow);
    this.bar = new HealthBar(world.s3, def.boss ? 3 : this.radius * 2.2, 0xff4a3a);
    this.bar.visible = false;
    this.spawnT = opts.rise ? 0.9 : 0;
    if (opts.rise) { this.lift = -1.6; this.root.position.y = this.y - 1.6; world.fx.dust(x, this.y + 0.1, z, 10, 0x6a6474); world.fx.magic(x, this.y + 0.1, z, 0xb06aff, 10, 0.6); }
    this.dormant = kind === 'mimic' && !opts.aggro;
    this.hitCount = 0;
    if (def.boss) {
      this.phase = 1; this.atkT = 2.5; this.teles = [];
      this.root.scale.setScalar(kind === 'golem' ? 1.15 : 1);
      const self = this;
      world.addLight({ get x() { return self.x; }, y: 3.2, get z() { return self.z + 0.8; }, color: kind === 'lich' ? 0x6aff9a : 0xff7a2a, intensity: () => (self.phase === 2 ? 10 : 6), range: 9, on: () => !self.dead, priority: 4 });
    }
    world.enemies.push(this);
  }
  get hpFrac() { return this.hp / this.maxHp; }

  hurt(dmg, fx, fz, opts = {}) {
    if (this.dead || this.spawnT > 0) return;
    const w = this.world;
    if (this.dormant) this.wake();
    this.aggro = true;
    this.hp -= dmg;
    this.bar.visible = true;
    this.bar.set(this.hp / this.maxHp);
    if (!opts.trap) {
      this.punch = 1;
      w.fx.text(this.x, this.y + 2 + (this.def.boss ? 2 : 0), this.z, String(Math.max(1, Math.round(dmg))), opts.crit ? '#ffcf4a' : '#ffffff', 0.55);
      w.fx.sparks(this.x, this.y + 0.9, this.z, 5, this.kind.indexOf('slime') >= 0 ? 0x7aff6a : 0xffffff, 3);
      w.audio.play(this.kind === 'golem' ? 'rockhit' : this.kind.indexOf('slime') >= 0 ? 'squish' : 'hit');
    }
    if (!opts.noKnock && !this.def.boss) {
      const d = Math.hypot(this.x - fx, this.z - fz) || 1;
      const k = opts.knock || 6;
      this.vx += (this.x - fx) / d * k; this.vz += (this.z - fz) / d * k;
    }
    if (opts.burn) { this.burnT = 3; this.burnDps = Math.max(this.burnDps, opts.burn); }
    if (opts.slow) { this.slowT = 2; this.slowAmt = opts.slow; }
    if (opts.freeze) this.freezeT = Math.max(this.freezeT, opts.freeze);
    if (this.state === 'windup' && !this.def.boss && dmg >= 8) { this.state = 'chase'; this.cd = 0.6; }
    if (this.hp <= 0) this.die();
  }
  wake() {
    this.dormant = false;
    this.aggro = true;
    this.world.audio.play('mimic');
    this.world.fx.dust(this.x, 0.1, this.z, 10);
    this.vy = 6;
  }
  die() {
    this.dead = true;
    this.deathT = 0;
    this.bar.dispose();
    const w = this.world;
    w.audio.play(this.kind === 'golem' ? 'bossdie' : this.kind === 'skeleton' || this.kind === 'archer' ? 'bones' : 'die');
    if (this.kind === 'skeleton' || this.kind === 'archer') w.fx.debris(this.x, 1, this.z, 12, 0xe8e0cc, 5);
    else if (this.kind.indexOf('slime') >= 0) w.fx.debris(this.x, 0.5, this.z, 14, 0x5ad84a, 4);
    else if (this.kind === 'golem') { w.fx.explosion(this.x, 1.5, this.z, 2.5); w.fx.debris(this.x, 2, this.z, 30, 0x6a6470, 9); }
    else w.fx.smoke(this.x, 1, this.z, 5, 0.5, 0x4a3a5a);
    if (this.kind === 'slime' && w.d.floor >= 3) {
      for (let k = 0; k < 2; k++) {
        const e = new Enemy(w, 'slimelet', this.x + (k ? 0.5 : -0.5), this.z, { aggro: true, room: this.room });
        e.vx = (k ? 4 : -4);
      }
    }
    const luck = 1;
    const lx = this.falling && this.safe ? this.safe.x : this.x, lz = this.falling && this.safe ? this.safe.z : this.z;
    w.dropLoot(lx, lz, this.def.coins * luck, this.def.boss ? 1 : 0.1, this.def.boss ? 1 : 0.06);
    if (this.def.boss) for (let k = 0; k < 3; k++) w.spawnPickup('crystal', this.x, this.z, { y: 2 });
    if (this.teles) for (const t of this.teles) t.remove();
    if (this.tele) { this.tele.remove(); this.tele = null; }
    w.onEnemyKilled && w.onEnemyKilled(this);
  }

  update(dt) {
    const w = this.world;
    const p = w.player;
    const r = this.rig;
    if (this.dead) {
      this.deathT += dt;
      const k = this.deathT / 0.5;
      if (this.falling) { this.lift -= dt * (4 + this.deathT * 20); this.root.position.y = this.y + this.lift; }
      this.root.scale.setScalar(Math.max(0.01, 1 - k) * (this.kind === 'golem' ? 1.15 : 1));
      this.root.rotation.z = k * 1.2;
      this.shadow.scale.setScalar(Math.max(0.01, (1 - k)) * this.radius * 2.6);
      if (k >= 1) { w.s3.remove(this.root); w.s3.remove(this.shadow); return false; }
      return true;
    }
    this.t += dt;
    // 可见性：区域未揭示时隐藏
    const ti = w.tileOf(this.x), tj = w.tileOf(this.z);
    const reg = w.regionAt(ti, tj);
    const vis = reg < 0 || w.discovered[reg] === 1;
    this.root.visible = vis; this.shadow.visible = vis;
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      this.lift = -1.6 * Math.max(0, this.spawnT / 0.9);
      this.root.position.y = this.y + this.lift;
      if (Math.random() < 0.3) w.fx.dust(this.x, 0.1, this.z, 1, 0x6a6474);
      return true;
    }
    // 状态效果
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.hp -= this.burnDps * dt;
      if (Math.random() < dt * 12) w.fx.fire(this.x, 0.8, this.z, 1, 0.8, 0xffa020, 0xff3a10, 0.2);
      this.bar.visible = true; this.bar.set(this.hp / this.maxHp);
      if (this.hp <= 0) { this.die(); return true; }
    }
    if (this.slowT > 0) this.slowT -= dt;
    const frozen = this.freezeT > 0;
    if (frozen) { this.freezeT -= dt; if (Math.random() < dt * 6) w.fx.sparks(this.x, 1, this.z, 1, 0xbff4ff, 1); }
    // 激活
    const dist = Math.hypot(p.x - this.x, p.z - this.z);
    if (!this.aggro && !this.dormant) {
      const pr = w.regionAt(w.tileOf(p.x), w.tileOf(p.z));
      if ((dist < 7 && w.los(this.x, this.z, p.x, p.z)) || (pr === reg && dist < 12)) { this.aggro = true; }
    }
    if (this.dormant && dist < 2.4) this.wake();
    let mx = 0, mz = 0;
    const spd = this.speed * (this.slowT > 0 ? 1 - (this.slowAmt || 0.4) : 1);
    if (!frozen && this.aggro && p.alive && !this.dormant) {
      const res = this.think(dt, dist, spd);
      if (res) { mx = res[0]; mz = res[1]; }
    }
    // 击退衰减
    this.vx *= Math.pow(0.02, dt); this.vz *= Math.pow(0.02, dt);
    const tx = (mx + this.vx) * dt, tz = (mz + this.vz) * dt;
    // 高度约束：自己走不下高台/深渊，但被重击时可能被打落
    const hc = this.flying ? null : this.hc;
    if (hc) { hc.y = this.y; hc.drop = !this.def.boss && Math.hypot(this.vx, this.vz) > 4 ? 99 : 0.45; }
    w.moveCircle(this, tx, tz, this.radius * 0.9, this.flying, hc);
    // 与其它敌人分离
    if (hc) hc.drop = 0.45;
    for (const o of w.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.x - o.x, dz = this.z - o.z;
      const d = Math.hypot(dx, dz), m = this.radius + o.radius;
      if (d < m && d > 0.001 && Math.abs(this.y - o.y) < 1) { const push = (m - d) * 0.5; w.moveCircle(this, dx / d * push, dz / d * push, this.radius * 0.9, this.flying, hc); }
    }
    // 高度：地面单位贴地（落下时有下落过程），飞行单位跟随玩家所在高度
    let g = w.groundAt(this.x, this.z);
    if (g > 8) g = this.y;
    if (this.flying) {
      const tgt = Math.max(g < PIT + 1 ? 0 : g, dist < 6 ? p.y : 0);
      this.y += (tgt - this.y) * Math.min(1, dt * 3);
    } else if (g < this.y - 0.05) {
      this.fallV = (this.fallV || 0) + 26 * dt;
      this.y = Math.max(g, this.y - this.fallV * dt);
      if (g < PIT + 1 && this.y < -1.2) { this.falling = true; w.audio.play('fall'); this.die(); return true; }
    } else { this.y = g; this.fallV = 0; }
    if (!this.flying && g > PIT + 1) { const ti2 = w.tileOf(this.x), tj2 = w.tileOf(this.z); if (w.kindAt(ti2, tj2) !== K.PIT) this.safe = { x: this.x, z: this.z }; }
    // 动画：朝移动方向前倾、转身时侧倾（次级动作，减少机械感）
    this.root.position.set(this.x, this.y + this.lift, this.z);
    this.root.rotation.order = 'YXZ';
    const mvs = Math.hypot(mx, mz) / (this.speed || 1);
    let dFace = this.face - (this.prevFace === undefined ? this.face : this.prevFace);
    dFace = ((dFace + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.prevFace = this.face;
    this.lean = (this.lean || 0) + (Math.min(1, mvs) * (this.flying ? 0.25 : 0.14) - (this.lean || 0)) * Math.min(1, dt * 6);
    this.bank = (this.bank || 0) + (clamp(-dFace / Math.max(dt, 0.001) * 0.04, -0.25, 0.25) - (this.bank || 0)) * Math.min(1, dt * 5);
    this.root.rotation.y = this.face;
    this.root.rotation.x = this.def.boss ? this.lean * 0.4 : this.lean;
    this.root.rotation.z = this.bank;
    this.shadow.position.set(this.x, (this.flying ? Math.max(g, 0) : this.y) + 0.03, this.z);
    if (this.punch > 0) {
      this.punch = Math.max(0, this.punch - dt * 6);
      const s = 1 + Math.sin(this.punch * Math.PI) * 0.18;
      r.pivot.scale.set(s, 1 / s, s);
    }
    this.animate(dt, Math.hypot(mx, mz) > 0.1, frozen);
    if (this.bar.visible) this.bar.pos(this.x, this.y + (r.height || 1.5) + (this.flying ? 1.4 : 0) + 0.5, this.z);
    // 接触伤害（史莱姆/蝙蝠）
    if ((this.kind === 'slime' || this.kind === 'slimelet' || this.kind === 'bat' || (this.kind === 'wraith' && !this.fading)) && !frozen && dist < this.radius + 0.45 && Math.abs(p.y - this.y) < 1.0) {
      if (this.cd <= 0) { p.hurt(this.dmg, this.x, this.z, 'enemy'); this.cd = 1.0; if (this.kind === 'bat') { this.vx -= (p.x - this.x) * 3; this.vz -= (p.z - this.z) * 3; } }
    }
    return true;
  }

  chaseDir(dist, spd) {
    const w = this.world, p = w.player;
    let tx = p.x, tz = p.z;
    if (dist > 2.2 && !this.flying) {
      const s = w.flowStep(this.x, this.z);
      if (s) { tx = s.x; tz = s.z; }
    }
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz) || 1;
    return [dx / d * spd, dz / d * spd];
  }

  think(dt, dist, spd) {
    const w = this.world, p = w.player;
    this.cd -= dt;
    const toP = Math.atan2(p.x - this.x, p.z - this.z);
    switch (this.kind) {
      case 'skeleton': case 'mimic': {
        if (this.state === 'windup') {
          this.face = angleLerp(this.face, toP, Math.min(1, dt * 4));
          this.st -= dt;
          if (this.st <= 0) {
            this.state = 'chase';
            this.cd = this.def.cd;
            this.swing = 1;
            w.audio.play(this.kind === 'mimic' ? 'chomp' : 'swipe');
            const fx = this.x + Math.sin(this.face) * 0.9, fz = this.z + Math.cos(this.face) * 0.9;
            if (Math.hypot(p.x - fx, p.z - fz) < 1.2 && Math.abs(p.y - this.y) < 1.0) p.hurt(this.dmg, this.x, this.z, 'enemy');
          }
          return null;
        }
        if (dist < this.def.range && this.cd <= 0 && w.los(this.x, this.z, p.x, p.z)) {
          this.state = 'windup'; this.st = this.def.windup;
          return null;
        }
        this.face = angleLerp(this.face, toP, Math.min(1, dt * 8));
        if (dist < this.def.range * 0.8) return null;
        const v = this.chaseDir(dist, spd);
        if (dist > 2.2) this.face = angleLerp(this.face, Math.atan2(v[0], v[1]), Math.min(1, dt * 8));
        return v;
      }
      case 'archer': {
        this.face = angleLerp(this.face, toP, Math.min(1, dt * 6));
        const seen = w.los(this.x, this.z, p.x, p.z);
        if (this.state === 'windup') {
          this.st -= dt;
          if (this.st <= 0) {
            this.state = 'chase'; this.cd = this.def.cd;
            const mesh = makeArrow();
            const a = Math.atan2(p.x - this.x, p.z - this.z);
            mesh.rotation.y = a;
            w.addProjectile({ mesh, x: this.x + Math.sin(a) * 0.6, y: 1.0, z: this.z + Math.cos(a) * 0.6, vx: Math.sin(a) * 10, vz: Math.cos(a) * 10, team: 'enemy', dmg: this.dmg, radius: 0.45, life: 2, source: 'enemy' });
            w.audio.play('arrow');
          }
          return null;
        }
        if (seen && dist < this.def.range && this.cd <= 0) { this.state = 'windup'; this.st = this.def.windup; return null; }
        if (seen && dist < 3.5) { const d = dist || 1; return [-(p.x - this.x) / d * spd, -(p.z - this.z) / d * spd]; }
        if (!seen || dist > 6.5) return this.chaseDir(dist, spd);
        // 侧移
        const s = Math.sin(this.t * 0.8) > 0 ? 1 : -1;
        return [Math.cos(toP) * spd * 0.5 * s, -Math.sin(toP) * spd * 0.5 * s];
      }
      case 'slime': case 'slimelet': {
        this.hopT = (this.hopT || 0) - dt;
        if (this.hopT <= 0 && !this.hopping) { this.hopping = 0.45; this.hopDir = this.chaseDir(dist, spd * 2.2); this.face = Math.atan2(this.hopDir[0], this.hopDir[1]); }
        if (this.hopping) {
          this.hopping -= dt;
          if (this.hopping <= 0) { this.hopping = 0; this.hopT = 0.5 + Math.random() * 0.3; this.squash = 1; w.fx.dust(this.x, 0.05, this.z, 2, 0x4a8a3a); }
          return this.hopDir;
        }
        return null;
      }
      case 'bat': {
        const wob = Math.sin(this.t * 3.1) * 2.2;
        const d = dist || 1;
        const px = -(p.z - this.z) / d, pz = (p.x - this.x) / d;
        const dx = (p.x - this.x) / d * spd + px * wob, dz = (p.z - this.z) / d * spd + pz * wob;
        this.face = Math.atan2(dx, dz);
        return [dx, dz];
      }
      case 'golem': return this.bossThink(dt, dist, spd, toP);
      case 'lich': return this.lichThink(dt, dist, spd, toP);
      case 'mushroom': {
        this.face = angleLerp(this.face, toP, Math.min(1, dt * 4));
        if (this.state === 'windup') {
          this.st -= dt;
          this.tele && this.tele.set(1 - this.st / 0.8);
          if (this.st <= 0) {
            this.state = 'chase'; this.cd = 3;
            this.tele && this.tele.remove(); this.tele = null;
            w.audio.play('spore');
            for (let k = 0; k < 24; k++) { const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3; w.fx.puffs.spawn({ x: this.x, y: 0.6, z: this.z, vx: Math.cos(a) * sp, vy: 0.5 + Math.random(), vz: Math.sin(a) * sp, life: 1.2, size: 0.5, grow: 1.5, color: 0x8ad84a, drag: 2, spin: 1 }); }
            if (dist < 2.5 && Math.abs(p.y - this.y) < 1.5) { p.hurt(this.dmg, this.x, this.z, 'enemy'); p.slow && p.slow(1.5); }
          }
          return null;
        }
        if (dist < 2.3 && this.cd <= 0) { this.state = 'windup'; this.st = 0.8; this.tele = telegraph(w, this.x, this.z, 2.5, 0x6aff3a); return null; }
        return dist < 1.4 ? null : this.chaseDir(dist, spd);
      }
      case 'wraith': {
        this.blinkT = (this.blinkT === undefined ? 3 + Math.random() * 2 : this.blinkT) - dt;
        if (this.fading) {
          this.fading -= dt;
          if (this.fading < 0.5 && !this.blinked) {
            this.blinked = true;
            for (let t = 0; t < 12; t++) {
              const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 1.5;
              const nx = p.x + Math.cos(a) * r, nz = p.z + Math.sin(a) * r;
              if (!w.blocked(w.tileOf(nx), w.tileOf(nz)) && !w.isPit(w.tileOf(nx), w.tileOf(nz))) { this.x = nx; this.z = nz; break; }
            }
            w.audio.play('teleport');
          }
          if (this.fading <= 0) { this.fading = 0; this.blinked = false; }
          return null;
        }
        if (this.blinkT <= 0 && dist > 3) { this.blinkT = 4 + Math.random() * 2; this.fading = 1.0; w.fx.magic(this.x, 1, this.z, 0x9fb8ff, 10, 0.6); return null; }
        const wob = Math.sin(this.t * 2.3) * 1.5, d = dist || 1;
        const dx = (p.x - this.x) / d * spd + (-(p.z - this.z) / d) * wob, dz = (p.z - this.z) / d * spd + ((p.x - this.x) / d) * wob;
        this.face = Math.atan2(dx, dz);
        return [dx, dz];
      }
      case 'iceMage': case 'fireImp': {
        this.face = angleLerp(this.face, toP, Math.min(1, dt * 6));
        const seen = w.los(this.x, this.z, p.x, p.z);
        if (this.state === 'windup') {
          this.st -= dt;
          if (this.st <= 0) { this.state = 'chase'; this.cd = this.def.cd; this.castAt(p); }
          return null;
        }
        if (seen && dist < this.def.range && this.cd <= 0) { this.state = 'windup'; this.st = this.def.windup; w.audio.play(this.kind === 'iceMage' ? 'charge' : 'imp'); return null; }
        if (seen && dist < 3.8) { const d = dist || 1; return [-(p.x - this.x) / d * spd, -(p.z - this.z) / d * spd]; }
        if (!seen || dist > 6.5) return this.chaseDir(dist, spd);
        const s = Math.sin(this.t * 0.9) > 0 ? 1 : -1;
        return [Math.cos(toP) * spd * 0.6 * s, -Math.sin(toP) * spd * 0.6 * s];
      }
      default: return null;
    }
  }

  bossThink(dt, dist, spd, toP) {
    const w = this.world, p = w.player;
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      w.game.hud.toast('石魔狂暴了！', '#ff6a4a');
      w.audio.play('roar');
      w.fx.shake = 0.6;
    }
    const fast = this.phase === 2 ? 1.4 : 1;
    if (this.act) {
      const a = this.act;
      a.t += dt * fast;
      if (a.kind === 'slam') {
        a.tele.set(a.t / 0.9);
        if (a.t >= 0.9 && !a.done) {
          a.done = true;
          a.tele.remove();
          w.fx.explosion(a.x, 0.2, a.z, 1.2);
          w.fx.debris(a.x, 0.5, a.z, 14, 0x6a6470, 7);
          w.fx.shake = 0.5;
          w.audio.play('slam');
          if (Math.hypot(p.x - a.x, p.z - a.z) < 2.6 && p.y - this.y < 1.4) p.hurt(2, a.x, a.z, 'enemy');
        }
        if (a.t >= 1.5) this.act = null;
        return null;
      }
      if (a.kind === 'rocks') {
        if (a.t >= 0.6 && !a.done) {
          a.done = true;
          const n = this.phase === 2 ? 5 : 3;
          for (let k = 0; k < n; k++) {
            const tx = p.x + (k === 0 ? 0 : (Math.random() - 0.5) * 5), tz = p.z + (k === 0 ? 0 : (Math.random() - 0.5) * 5);
            const tele = telegraph(w, tx, tz, 1.3, 0xff7a1a);
            this.teles.push(tele);
            const sx = this.x, sz = this.z, dur = 1.1;
            const mesh = new THREE.Mesh(Geo.dode(), matChar());
            mesh.scale.setScalar(0.9);
            mesh.castShadow = true;
            w.addProjectile({
              mesh, x: sx, y: 3.2, z: sz, vx: (tx - sx) / dur, vz: (tz - sz) / dur, vy: 9, grav: (2 * (3.2 + 9 * dur)) / (dur * dur), team: 'none', life: dur + 0.05, hitSolid: false, spin: 5, breakables: false,
              update: (pp) => { tele.set(pp.t / dur); },
              onDie: () => {
                tele.remove();
                const ix = this.teles.indexOf(tele); if (ix >= 0) this.teles.splice(ix, 1);
                w.fx.explosion(tx, 0.2, tz, 0.7);
                w.audio.play('boom');
                if (w.player.alive && Math.hypot(w.player.x - tx, w.player.z - tz) < 1.4 && w.player.y - w.groundAt(tx, tz) < 1.2) w.player.hurt(1, tx, tz, 'enemy');
              },
            });
          }
          w.audio.play('throw');
        }
        if (a.t >= 1.4) this.act = null;
        return null;
      }
      if (a.kind === 'stomp') {
        if (a.t < 0.5) { this.lift = Math.sin(a.t / 0.5 * Math.PI) * 1.2; }
        else if (!a.landed) {
          a.landed = true; this.lift = 0;
          w.fx.shockwave(this.x, this.z, 9, 0xffa03a, 0.15, 1.1);
          w.fx.shake = 0.5;
          w.audio.play('slam');
          a.ring = 0;
        }
        if (a.landed) {
          const prev = a.ring;
          a.ring += dt * 8.5;
          const d = Math.hypot(p.x - this.x, p.z - this.z);
          if (!a.hit && d >= prev - 0.3 && d <= a.ring + 0.3 && d < 9.5 && !p.dashing && !p.airborne && p.y - this.y < 0.5) { a.hit = true; p.hurt(1, this.x, this.z, 'enemy'); }
          if (a.ring > 10) this.act = null;
        }
        return null;
      }
    }
    this.atkT -= dt * fast;
    this.face = angleLerp(this.face, toP, Math.min(1, dt * 3));
    if (this.atkT <= 0) {
      this.atkT = this.phase === 2 ? 1.8 : 2.6;
      const r = Math.random();
      if (dist < 4.2 && r < 0.6) {
        const x = this.x + Math.sin(toP) * 2.2, z = this.z + Math.cos(toP) * 2.2;
        this.face = toP;
        this.act = { kind: 'slam', t: 0, x, z, tele: telegraph(w, x, z, 2.6) };
        this.teles.push(this.act.tele);
        w.audio.play('roar');
      } else if (r < 0.75 || dist > 6) this.act = { kind: 'rocks', t: 0 };
      else this.act = { kind: 'stomp', t: 0 };
      return null;
    }
    if (dist < 2.5) return null;
    return this.chaseDir(dist, spd);
  }

  castAt(p) {
    const w = this.world;
    const a0 = Math.atan2(p.x - this.x, p.z - this.z);
    if (this.kind === 'iceMage') {
      for (const da of [-0.25, 0, 0.25]) {
        const a = a0 + da;
        const mesh = new THREE.Mesh(Geo.oct(), matGlow(0xbff4ff));
        mesh.scale.set(0.14, 0.14, 0.45);
        mesh.rotation.y = a;
        w.addProjectile({ mesh, x: this.x + Math.sin(a) * 0.6, y: 1.0, z: this.z + Math.cos(a) * 0.6, vx: Math.sin(a) * 8.5, vz: Math.cos(a) * 8.5, team: 'enemy', dmg: this.dmg, radius: 0.45, life: 1.6, source: 'enemy',
          update: (q) => { if (Math.random() < 0.4) w.fx.sparks(q.x, q.y, q.z, 1, 0xbff4ff, 0.5); }, onHitPlayer: () => w.player.slow && w.player.slow(2) });
      }
      w.audio.play('ice');
    } else {
      const g = new THREE.Group();
      const core = new THREE.Mesh(Geo.sph(8, 6), matGlow(0xffd040)); core.scale.setScalar(0.28); g.add(core, glowSprite(0xff6a1a, 1.6, 0.9));
      w.addProjectile({ mesh: g, x: this.x, y: 1.3, z: this.z, vx: Math.sin(a0) * 7, vz: Math.cos(a0) * 7, team: 'enemy', dmg: this.dmg, radius: 0.5, life: 2, source: 'enemy',
        update: (q) => { q.y = Math.max(0.8, q.y - 0.01); if (Math.random() < 0.7) w.fx.fire(q.x, q.y, q.z, 1, 0.5, 0xffd040, 0xff3a10, 0.2); },
        onDie: (q) => { w.fx.fire(q.x, q.y, q.z, 8, 2, 0xffd040, 0xff3a10, 0.3); } });
      w.audio.play('fireball');
    }
  }
  lichThink(dt, dist, spd, toP) {
    const w = this.world, p = w.player;
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) { this.phase = 2; w.game.hud.toast('骷髅巫王召唤了亡灵风暴！', '#8affb0'); w.audio.play('roar'); w.fx.shake = 0.5; }
    const fast = this.phase === 2 ? 1.35 : 1;
    this.face = angleLerp(this.face, toP, Math.min(1, dt * 4));
    if (this.act) {
      const a = this.act;
      a.t += dt * fast;
      if (a.kind === 'bolt' && a.t >= 0.6 && !a.done) {
        a.done = true;
        const n = this.phase === 2 ? 5 : 3;
        for (let k = 0; k < n; k++) {
          const ang = toP + (k - (n - 1) / 2) * 0.22;
          const mesh = new THREE.Mesh(Geo.cone(5), matGlow(0xd8ffd8));
          mesh.scale.set(0.12, 0.6, 0.12); mesh.rotation.set(Math.PI / 2, 0, 0);
          const g = new THREE.Group(); g.add(mesh, glowSprite(0x6aff9a, 1, 0.8)); g.rotation.y = ang;
          w.addProjectile({ mesh: g, x: this.x + Math.sin(ang), y: 1.4, z: this.z + Math.cos(ang), vx: Math.sin(ang) * 9, vz: Math.cos(ang) * 9, team: 'enemy', dmg: 1, radius: 0.5, life: 2.2, source: 'enemy', hitSolid: false });
        }
        w.audio.play('bonecast');
      } else if (a.kind === 'summon' && a.t >= 0.8 && !a.done) {
        a.done = true;
        const alive = w.enemies.filter((e) => !e.dead && e.kind === 'skeleton').length;
        for (let k = 0; k < Math.min(3, 5 - alive); k++) {
          const ang = Math.random() * Math.PI * 2;
          const x = this.x + Math.cos(ang) * 2.5, z = this.z + Math.sin(ang) * 2.5;
          if (!w.blocked(w.tileOf(x), w.tileOf(z)) && w.kindAt(w.tileOf(x), w.tileOf(z)) === K.FLOOR) new Enemy(w, 'skeleton', x, z, { room: this.room, aggro: true, rise: true });
        }
        w.audio.play('summon');
      } else if (a.kind === 'blink') {
        if (a.t >= 0.5 && !a.done) {
          a.done = true;
          const room = this.room;
          for (let t = 0; t < 20 && room; t++) {
            const i = room.x + 1 + Math.floor(Math.random() * (room.w - 2)), j = room.y + 1 + Math.floor(Math.random() * (room.h - 2));
            const c = w.center(i, j);
            if (!w.blocked(i, j) && w.kindAt(i, j) === K.FLOOR && Math.hypot(c.x - p.x, c.z - p.z) > 4) { this.x = c.x; this.z = c.z; break; }
          }
          w.fx.magic(this.x, 0.5, this.z, 0x6aff9a, 24, 1);
          w.audio.play('teleport');
        }
        this.root.visible = a.t < 0.3 || a.t > 0.6 || Math.floor(a.t * 20) % 2 === 0;
      } else if (a.kind === 'ring' && a.t >= 0.7 && !a.done) {
        a.done = true;
        for (let k = 0; k < 14; k++) {
          const ang = (k / 14) * Math.PI * 2 + this.t;
          const g = new THREE.Group(); const m = new THREE.Mesh(Geo.sph(6, 4), matGlow(0x8affb0)); m.scale.setScalar(0.25); g.add(m, glowSprite(0x6aff9a, 1.2, 0.8));
          w.addProjectile({ mesh: g, x: this.x, y: 1.2, z: this.z, vx: Math.sin(ang) * 6, vz: Math.cos(ang) * 6, team: 'enemy', dmg: 1, radius: 0.45, life: 2.5, source: 'enemy', hitSolid: false });
        }
        w.fx.shockwave(this.x, this.z, 3, 0x6aff9a, 0.2, 0.4);
        w.audio.play('bonecast');
      }
      if (a.t >= (a.kind === 'summon' ? 1.4 : 1.1)) this.act = null;
      return null;
    }
    this.atkT -= dt * fast;
    if (this.atkT <= 0) {
      this.atkT = this.phase === 2 ? 1.7 : 2.4;
      const r = Math.random();
      if (r < 0.4) this.act = { kind: 'bolt', t: 0 };
      else if (r < 0.6) this.act = { kind: 'summon', t: 0 };
      else if (r < 0.8 || this.phase === 1) this.act = { kind: dist < 4 ? 'blink' : 'bolt', t: 0 };
      else this.act = { kind: 'ring', t: 0 };
      return null;
    }
    if (dist < 5) { const d = dist || 1; return [-(p.x - this.x) / d * spd * 0.6, -(p.z - this.z) / d * spd * 0.6]; }
    return dist > 8 ? this.chaseDir(dist, spd) : null;
  }

  animate(dt, moving, frozen) {
    const r = this.rig;
    const t = this.t;
    if (frozen) return;
    switch (this.kind) {
      case 'skeleton': case 'archer': {
        // 走路：双腿交替、屈膝、左臂反向摆动；身体起伏、头部随步点头；下颌偶尔咔哒作响
        const ph = t * 8.5;
        const w = moving ? 1 : 0;
        this.walkW = (this.walkW || 0) + (w - (this.walkW || 0)) * Math.min(1, dt * 8);
        const m = this.walkW, sn = Math.sin(ph), cs = Math.cos(ph);
        r.pivot.position.y = m * Math.abs(sn) * 0.06;
        r.pivot.rotation.z = m * sn * 0.06;
        if (r.legL) {
          r.legL.rotation.x = -sn * 0.6 * m; r.legR.rotation.x = sn * 0.6 * m;
          r.kneeL.rotation.x = m * Math.max(0, cs) * 0.9 + 0.05; r.kneeR.rotation.x = m * Math.max(0, -cs) * 0.9 + 0.05;
          r.armL.rotation.x = sn * 0.5 * m + Math.sin(t * 1.7) * 0.05; r.elbowL.rotation.x = -0.3 - m * Math.max(0, -sn) * 0.4;
          r.head.rotation.x = Math.sin(ph * 2) * 0.05 * m + Math.sin(t * 0.9) * 0.05;
          r.head.rotation.y = Math.sin(t * 0.7) * 0.25 * (1 - m);
          this.chatter = (this.chatter || 0) - dt;
          if (this.chatter < -0.4) this.chatter = 1.5 + Math.random() * 3;
          r.jaw.rotation.x = this.state === 'windup' ? 0.35 : this.chatter < 0 ? Math.abs(Math.sin(t * 30)) * 0.3 : 0.03;
          r.elbowR.rotation.x = -0.2;
        }
        if (this.state === 'windup') r.arm.rotation.x = this.kind === 'archer' ? -1.4 : -2.2 * (1 - this.st / this.def.windup);
        else if (this.swing > 0) { this.swing = Math.max(0, this.swing - dt * 5); r.arm.rotation.x = -2.2 + (1 - this.swing) * 3; }
        else r.arm.rotation.x += ((this.kind === 'archer' ? -0.5 : sn * -0.4 * m) - r.arm.rotation.x) * Math.min(1, dt * 6);
        break;
      }
      case 'slime': case 'slimelet': {
        const h = this.hopping ? Math.sin((1 - this.hopping / 0.45) * Math.PI) : 0;
        r.pivot.position.y = h * 0.8;
        this.squash = Math.max(0, (this.squash || 0) - dt * 4);
        const sq = 1 + Math.sin(t * 6) * 0.05 + this.squash * 0.35 - h * 0.15;
        const s0 = r.blob.userData.s || 1;
        r.blob.scale.set(sq * s0, (1 / sq) * 0.75 * s0, sq * s0);
        break;
      }
      case 'bat': {
        const f = Math.sin(t * 22) * 0.9;
        r.wl.rotation.z = f; r.wr.rotation.z = -f;
        r.pivot.position.y = 1.4 + Math.sin(t * 4) * 0.2;
        break;
      }
      case 'mimic': {
        if (this.dormant) { r.lid.rotation.x = 0; r.pivot.position.y = 0; break; }
        r.lid.rotation.x = this.state === 'windup' ? -0.9 : this.swing > 0 ? -0.9 * this.swing : -0.25 - Math.abs(Math.sin(t * 8)) * 0.3;
        if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 5);
        r.pivot.position.y = moving ? Math.abs(Math.sin(t * 10)) * 0.3 : 0;
        break;
      }
      case 'mushroom': {
        const wind = this.state === 'windup' ? 1 - this.st / 0.8 : 0;
        r.pivot.scale.set(1 + wind * 0.25, 1 - wind * 0.2, 1 + wind * 0.25);
        r.pivot.position.y = moving ? Math.abs(Math.sin(t * 6)) * 0.12 : 0;
        r.pivot.rotation.z = moving ? Math.sin(t * 6) * 0.1 : 0;
        if (r.legL) {
          const sn = moving ? Math.sin(t * 6) : 0;
          r.legL.rotation.x = sn * 0.7; r.legR.rotation.x = -sn * 0.7;
          r.armL.rotation.x = -sn * 0.6 - wind * 1.5; r.armR.rotation.x = sn * 0.6 - wind * 1.5;
          r.armL.rotation.z = -wind * 0.6; r.armR.rotation.z = wind * 0.6;
          r.cap.rotation.z = -r.pivot.rotation.z * 0.8; r.cap.position.y = Math.abs(sn) * 0.03 + wind * 0.08;
        }
        break;
      }
      case 'wraith': {
        r.pivot.position.y = 0.3 + Math.sin(t * 2.5) * 0.2;
        r.mat.opacity = this.fading ? Math.abs(this.fading - 0.5) * 1.1 : 0.6;
        r.body.rotation.x = 0.2;
        break;
      }
      case 'iceMage': {
        r.pivot.position.y = moving ? Math.abs(Math.sin(t * 8)) * 0.06 : 0;
        r.arm.rotation.x = this.state === 'windup' ? -1.2 : Math.sin(t * 2) * 0.1;
        if (this.state === 'windup' && Math.random() < 0.5) this.world.fx.sparks(this.x + Math.sin(this.face) * 0.5, 1.8, this.z + Math.cos(this.face) * 0.5, 1, 0xbff4ff, 1);
        break;
      }
      case 'fireImp': {
        const f = Math.sin(t * 20) * 0.8;
        r.wl.rotation.z = f; r.wr.rotation.z = -f;
        r.pivot.position.y = 1.4 + Math.sin(t * 3) * 0.2;
        if (Math.random() < 0.3) this.world.fx.fire(this.x, 1.1, this.z, 1, 0.4, 0xffa030, 0xff3a10, 0.15);
        break;
      }
      case 'lich': {
        r.pivot.position.y = 0.3 + Math.sin(t * 1.8) * 0.15;
        const a = this.act;
        r.arm.rotation.x = a && !a.done ? -1.4 * Math.min(1, a.t / 0.5) : Math.sin(t * 1.2) * 0.1;
        if (Math.random() < 0.2) this.world.fx.magic(this.x + (Math.random() - 0.5) * 1.5, 0.2, this.z + (Math.random() - 0.5) * 1.5, 0x6aff9a, 1, 0.3);
        break;
      }
      case 'golem': {
        const a = this.act;
        r.pivot.position.y = 0;
        if (a && a.kind === 'slam') { const k = Math.min(1, a.t / 0.9); r.fl.rotation.x = r.fr.rotation.x = a.done ? 0.9 : -2.4 * k; }
        else if (a && a.kind === 'rocks') { r.fr.rotation.x = a.done ? 0.6 : -2.8 * Math.min(1, a.t / 0.6); r.fl.rotation.x = 0; }
        else {
          r.fl.rotation.x = moving ? Math.sin(t * 3) * 0.4 : Math.sin(t * 1.2) * 0.05; r.fr.rotation.x = moving ? -Math.sin(t * 3) * 0.4 : -Math.sin(t * 1.2) * 0.05;
          r.pivot.rotation.z = moving ? Math.sin(t * 3) * 0.05 : 0;
          r.pivot.position.y = moving ? Math.abs(Math.sin(t * 3)) * 0.08 : 0;
        }
        if (r.legL) { const sn = moving && !a ? Math.sin(t * 3) : 0; r.legL.rotation.x = -sn * 0.45; r.legR.rotation.x = sn * 0.45; }
        r.glow.children.forEach((g, k) => g.scale.setScalar((k < 2 ? 0.12 : 0.2) * (1 + Math.sin(t * 5 + k) * 0.2) * (this.phase === 2 ? 1.3 : 1)));
        break;
      }
      default: break;
    }
  }
}

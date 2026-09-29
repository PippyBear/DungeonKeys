// 陷阱：地刺、火焰喷口、钟摆利斧、箭矢压板
import * as THREE from 'three';
import { T } from './dungeon.js';
import { WH } from './level.js';
import { makeSpikes, makeFlameNozzle, makePendulum, makeArrowShooter, makePlate, makeArrow, glowSprite } from './models.js';

// maxH：离地高于该值（跳起来）就不会被触发/命中
function playerInTile(p, cx, cz, half = 0.95, maxH = 99) {
  if (p.airborne && p.y - p.world.groundAt(p.x, p.z) > maxH) return false;
  return Math.abs(p.x - cx) < half && Math.abs(p.z - cz) < half;
}
function warnSprite(world, x, z) {
  const s = glowSprite(0xff3a2a, 2.2, 0);
  s.position.set(x, 0.15, z);
  return s;
}

export class Spikes {
  constructor(world, i, j, phase = 0, period = 2.6) {
    this.world = world;
    const c = world.center(i, j);
    this.x = c.x; this.z = c.z;
    this.i = i; this.j = j;
    const m = makeSpikes();
    this.m = m;
    m.root.position.set(c.x, 0, c.z);
    world.addAt(m.root, i, j);
    this.phase = phase;
    this.period = period;
    this.warn = warnSprite(world, c.x, c.z);
    world.addAt(this.warn, i, j);
    world.reserve(i, j);
    this.wasUp = false;
    world.updatables.push(this);
  }
  update(dt) {
    const w = this.world;
    const t = (w.time + this.phase) % this.period;
    const upStart = this.period - 1.2;
    let y;
    if (t < upStart - 0.35) y = -0.62;
    else if (t < upStart) y = -0.5 + Math.sin(t * 60) * 0.02;
    else if (t < upStart + 0.1) y = -0.5 + (t - upStart) / 0.1 * 0.5;
    else if (t < this.period - 0.25) y = 0;
    else y = -((t - (this.period - 0.25)) / 0.25) * 0.62;
    this.m.spikes.position.y = y;
    const up = y > -0.2;
    if (up && !this.wasUp && this.m.root.parent.visible) w.audio.play('spike');
    this.wasUp = up;
    const sense = w.run.abilities.trapsense || 0;
    this.warn.material.opacity = sense ? 0.35 + (y > -0.55 ? 0.4 : 0) : 0;
    if (up) {
      const p = w.player;
      if (playerInTile(p, this.x, this.z, 0.85, 0.35)) p.hurt(1, this.x, this.z, 'trap');
      for (const e of w.enemies) if (!e.dead && !e.flying && playerInTile(e, this.x, this.z, 0.85)) e.hurt(30 * dt, this.x, this.z, { noKnock: true, trap: true });
    }
  }
}

export class FlameJet {
  constructor(world, spec) {
    this.world = world;
    this.i = spec.i; this.j = spec.j;
    const c = world.center(spec.i, spec.j);
    this.dir = [spec.fdi, spec.fdj];
    // 喷口在墙面上
    this.nx = c.x - spec.fdi * 1.0; this.nz = c.z - spec.fdj * 1.0;
    const noz = makeFlameNozzle();
    noz.position.set(this.nx, 1.0, this.nz);
    noz.rotation.y = Math.atan2(spec.fdi, spec.fdj);
    world.addAt(noz, spec.i, spec.j);
    this.x = c.x; this.z = c.z;
    this.phase = spec.phase || 0;
    this.period = 3.4;
    this.firing = false;
    world.reserve(spec.i, spec.j);
    this.warn = warnSprite(world, c.x, c.z);
    world.addAt(this.warn, spec.i, spec.j);
    world.addLight({ x: c.x, y: 1.2, z: c.z, color: 0xff6a1a, intensity: 14, range: 8, on: () => this.firing, region: world.regionAt(spec.i, spec.j), priority: 3 });
    world.updatables.push(this);
  }
  update(dt) {
    const w = this.world;
    const t = (w.time + this.phase) % this.period;
    const was = this.firing;
    this.firing = t > 1.9 && t < 3.2;
    const warning = t > 1.4 && t <= 1.9;
    const vis = w.discovered[w.regionAt(this.i, this.j)];
    if (warning && vis && Math.random() < dt * 20) w.fx.sparks(this.nx + this.dir[0] * 0.4, 1.0, this.nz + this.dir[1] * 0.4, 1, 0xffa03a, 1.5);
    if (this.firing) {
      if (!was && vis) w.audio.play('flame');
      if (vis) w.fx.flameStream(this.nx + this.dir[0] * 0.4, 0.95, this.nz + this.dir[1] * 0.4, this.dir[0], this.dir[1], 2.2);
      const p = w.player;
      if (playerInTile(p, this.x, this.z, 1.0, 1.1)) p.hurt(1, this.nx, this.nz, 'trap');
      for (const e of w.enemies) if (!e.dead && playerInTile(e, this.x, this.z, 1.0)) e.hurt(12 * dt, this.nx, this.nz, { noKnock: true, burn: 2, trap: true });
    }
    const sense = w.run.abilities.trapsense || 0;
    this.warn.material.opacity = sense ? (this.firing ? 0.8 : warning ? 0.5 : 0.25) : 0;
  }
}

export class Pendulum {
  constructor(world, spec) {
    this.world = world;
    this.i = spec.i; this.j = spec.j;
    const c = world.center(spec.i, spec.j);
    this.x = c.x; this.z = c.z;
    this.axis = [spec.di, spec.dj];
    this.len = 2.3;
    const m = makePendulum(this.len);
    this.m = m;
    m.root.position.set(c.x, WH + 0.1, c.z);
    // 摆动平面沿走廊方向
    m.root.rotation.y = spec.di !== 0 ? Math.PI / 2 : 0;
    world.addAt(m.root, spec.i, spec.j);
    this.phase = spec.phase || 0;
    world.reserve(spec.i, spec.j);
    this.warn = warnSprite(world, c.x, c.z);
    world.addAt(this.warn, spec.i, spec.j);
    this.lastSide = 0;
    world.updatables.push(this);
  }
  update(dt) {
    const w = this.world;
    const a = Math.sin(w.time * 2.1 + this.phase) * 1.15;
    this.m.arm.rotation.x = a;
    const off = Math.sin(a) * this.len;
    const by = WH + 0.1 - Math.cos(a) * this.len;
    const bx = this.x + this.axis[0] * -off, bz = this.z + this.axis[1] * -off;
    const side = Math.sign(a);
    if (side !== this.lastSide && w.discovered[w.regionAt(this.i, this.j)] && Math.hypot(w.player.x - this.x, w.player.z - this.z) < 12) w.audio.play('swing');
    this.lastSide = side;
    if (by < 1.3) {
      const p = w.player;
      if (Math.hypot(p.x - bx, p.z - bz) < 0.85 && Math.abs(p.y + 0.8 - by) < 1.1) p.hurt(2, bx, bz, 'trap');
      for (const e of w.enemies) if (!e.dead && Math.hypot(e.x - bx, e.z - bz) < 0.85) e.hurt(30, bx, bz, { trap: true });
    }
    const sense = w.run.abilities.trapsense || 0;
    this.warn.material.opacity = sense ? 0.3 + (by < 1.3 ? 0.5 : 0) : 0;
  }
}

export class ArrowTrap {
  constructor(world, spec) {
    this.world = world;
    this.i = spec.i; this.j = spec.j;
    const c = world.center(spec.i, spec.j);
    this.x = c.x; this.z = c.z;
    this.dir = [spec.fdi, spec.fdj];
    this.sx = c.x - spec.fdi * 0.98; this.sz = c.z - spec.fdj * 0.98;
    const sh = makeArrowShooter();
    sh.position.set(this.sx, 1.0, this.sz);
    sh.rotation.y = Math.atan2(spec.fdi, spec.fdj);
    world.addAt(sh, spec.i, spec.j);
    const pl = makePlate();
    pl.root.position.set(c.x, -0.05, c.z);
    pl.root.scale.set(0.8, 1, 0.8);
    this.plate = pl;
    world.addAt(pl.root, spec.i, spec.j);
    world.reserve(spec.i, spec.j);
    this.cd = 0;
    this.warn = warnSprite(world, c.x, c.z);
    world.addAt(this.warn, spec.i, spec.j);
    world.updatables.push(this);
  }
  update(dt) {
    const w = this.world;
    this.cd -= dt;
    const p = w.player;
    const on = playerInTile(p, this.x, this.z, 0.9, 0.05);
    this.plate.top.position.y = on ? -0.06 : 0;
    if (on && this.cd <= 0) {
      this.cd = 1.6;
      w.audio.play('click');
      w.after(0.18, () => {
        for (let k = -1; k <= 1; k++) {
          const mesh = makeArrow();
          mesh.rotation.y = Math.atan2(this.dir[0], this.dir[1]);
          const px = -this.dir[1] * k * 0.35, pz = this.dir[0] * k * 0.35;
          w.addProjectile({ mesh, x: this.sx + this.dir[0] * 0.3 + px, y: 0.8 + k * 0.1, z: this.sz + this.dir[1] * 0.3 + pz, vx: this.dir[0] * 16, vz: this.dir[1] * 16, team: 'enemy', dmg: 1, radius: 0.45, life: 1.2, source: 'trap', hitSolid: false });
        }
        w.audio.play('arrow');
      });
    }
    const sense = w.run.abilities.trapsense || 0;
    this.warn.material.opacity = sense ? 0.4 : 0;
  }
}

// 飞镖墙：定时从墙上射出飞镖横穿跳台（可能把人打落深渊）
export class DartWall {
  constructor(world, spec) {
    this.world = world;
    this.spec = spec;
    this.dir = [spec.fdi, spec.fdj];
    const c = world.center(spec.wi, spec.wj);
    this.sx = c.x + spec.fdi * 1.0; this.sz = c.z + spec.fdj * 1.0;
    let g = world.groundAt(this.sx + spec.fdi * 0.3, this.sz + spec.fdj * 0.3);
    if (g > 8 || g < -1) g = 0;
    this.y = g + 1.0;
    this.region = spec.room;
    const sh = makeArrowShooter();
    sh.position.set(this.sx, this.y, this.sz);
    sh.rotation.y = Math.atan2(spec.fdi, spec.fdj);
    world.groups[spec.room].add(sh);
    this.glow = glowSprite(0xff3a2a, 1.2, 0);
    this.glow.position.set(this.sx + spec.fdi * 0.2, this.y, this.sz + spec.fdj * 0.2);
    world.groups[spec.room].add(this.glow);
    this.t = spec.phase || 0;
    this.period = spec.period || 2.4;
    world.updatables.push(this);
  }
  update(dt) {
    const w = this.world;
    if (!w.discovered[this.region]) return;
    const prev = this.t % this.period;
    this.t += dt;
    const u = this.t % this.period;
    this.glow.material.opacity = u > this.period - 0.45 ? 0.5 + Math.sin(this.t * 40) * 0.3 : 0;
    if (u < prev) {
      const mesh = makeArrow();
      mesh.scale.setScalar(1.2);
      mesh.rotation.y = Math.atan2(this.dir[0], this.dir[1]);
      w.addProjectile({ mesh, x: this.sx + this.dir[0] * 0.3, y: this.y, z: this.sz + this.dir[1] * 0.3, absY: true, vy: 0, vx: this.dir[0] * 10, vz: this.dir[1] * 10, team: 'enemy', dmg: 1, radius: 0.5, life: 3, source: 'trap', hitSolid: false });
      const p = w.player;
      if (Math.hypot(p.x - this.sx, p.z - this.sz) < 16) w.audio.play('arrow');
    }
  }
}

export function createTrap(world, spec) {
  switch (spec.type) {
    case 'spikes': return new Spikes(world, spec.i, spec.j, spec.phase);
    case 'flame': return new FlameJet(world, spec);
    case 'pendulum': return new Pendulum(world, spec);
    case 'arrow': return new ArrowTrap(world, spec);
    case 'dart': return new DartWall(world, spec);
    default: return null;
  }
}

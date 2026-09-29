// 可交互物件：铁栅门、封印门、宝箱、可破坏物、楼梯、泉水、祭坛、火把
import * as THREE from 'three';
import { WH } from './level.js';
import { T } from './dungeon.js';
import { makeBars, makeSeal, makeChest, makeCage, makeBarrel, makePot, makeStairs, makeFountain, makeAltar, makeTorch, makeRubble, makePool, makeStall, makeKey, makeHeartPickup, glowSprite, Builder, Geo, matGlow } from './models.js';
import { makeBearHero, animateBear, FURS, OUTFITS } from './heroes.js';
import { crackTexture } from './textures.js';
import { ease } from './utils.js';

// 铁栅门（怪物房/Boss 房入口）
export class Gate {
  constructor(world, e, kind = 'iron') {
    this.world = world;
    this.i = e.i; this.j = e.j;
    this.kind = kind;
    const c = world.center(e.i, e.j);
    this.x = c.x; this.z = c.z;
    const o = kind === 'seal' ? makeSeal() : { root: makeBars(2, 2.6, 6) };
    this.root = new THREE.Group();
    this.root.add(o.root);
    this.plane = o.plane;
    // 栅栏位于通道格子靠房间一侧的边上
    const off = 0.9;
    this.root.position.set(c.x - e.dir[0] * off, 0, c.z - e.dir[1] * off);
    if (e.dir[0] !== 0) this.root.rotation.y = Math.PI / 2;
    world.addAt(this.root, e.i, e.j);
    this.closed = kind === 'seal';
    this.y = this.closed ? 0 : -2.8;
    o.root.position.y = this.y;
    this.inner = o.root;
    if (this.closed) world.setSolid(this.i, this.j, true);
    world.updatables.push(this);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.world.setSolid(this.i, this.j, true);
    this.world.audio.play('gate');
    this.world.fx.dust(this.x, 0.1, this.z, 6, 0x6a6474);
  }
  open() {
    if (!this.closed) return;
    this.closed = false;
    this.world.setSolid(this.i, this.j, false);
    this.world.audio.play(this.kind === 'seal' ? 'unseal' : 'gate');
    if (this.kind === 'seal') this.world.fx.magic(this.x, 0.5, this.z, 0x7fd8ff, 30, 1.2);
  }
  update(dt) {
    const target = this.closed ? 0 : -2.8;
    const sp = this.closed ? 14 : 3;
    this.y += Math.sign(target - this.y) * Math.min(Math.abs(target - this.y), sp * dt);
    this.inner.position.y = this.y;
    if (this.plane) this.plane.material.opacity = 0.18 + Math.sin(this.world.time * 3) * 0.08;
  }
}

// 宝箱
export class Chest {
  constructor(world, i, j, loot, opts = {}) {
    this.world = world;
    this.i = i; this.j = j;
    const c = world.center(i, j);
    this.x = c.x; this.z = c.z;
    this.loot = loot;
    const m = makeChest();
    this.root = m.root;
    this.lid = m.lid;
    const gy = world.groundAt(c.x, c.z);
    this.y = gy > 8 ? 0 : gy;
    this.root.position.set(c.x, this.y, c.z);
    this.root.rotation.y = opts.face || 0;
    world.addAt(this.root, i, j);
    world.setSolid(i, j, true, this, 0.85);
    world.reserve(i, j);
    this.opened = false;
    this.caged = !!opts.caged;
    if (this.caged) {
      this.cage = makeCage();
      this.cage.position.set(c.x, this.y, c.z);
      world.addAt(this.cage, i, j);
    }
    this.label = '打开宝箱';
    this.icon = 'hand';
    this.radius = 2.4;
    world.addInteract(this);
    world.updatables.push(this);
    if (loot.key) {
      this.keyGlow = world.addLight({ x: c.x, y: 1.5 + this.y, z: c.z, color: 0xffcf4a, intensity: 6, range: 5, region: world.regionAt(i, j), on: () => !this.opened, priority: 0.8 });
    }
  }
  enabled() { return !this.opened && !this.caged; }
  uncage() {
    if (!this.caged) return;
    this.caged = false;
    const cage = this.cage;
    this.world.audio.play('gate');
    this.world.fx.magic(this.x, 0.3, this.z, 0xffd86a, 24, 1);
    this.cageAnim = 0;
    this.cageRise = cage;
  }
  interact() {
    if (this.opened || this.caged) return;
    this.opened = true;
    this.openT = 0;
    this.world.audio.play('chest');
    const w = this.world, L = this.loot;
    w.after(0.25, () => {
      w.fx.magic(this.x, this.y + 0.8, this.z, 0xffd86a, 18, 0.6);
      const greed = w.run.abilities.greed || 0;
      const coins = Math.round((L.coins || 0) * (1 + greed * 0.3) * (w.lootMul || 1));
      for (let k = 0; k < coins; k++) w.spawnPickup('coin', this.x, this.z, { value: 1 + Math.floor(Math.random() * 3), y: this.y + 1 });
      if (L.key) w.spawnPickup('key', this.x, this.z, { y: this.y + 1.2 });
      if (L.heart) w.spawnPickup('heart', this.x, this.z, { y: this.y + 1 });
      for (let k = 0; k < (L.crystal || 0); k++) w.spawnPickup('crystal', this.x, this.z, { y: this.y + 1 });
    });
  }
  update(dt) {
    if (this.opened && this.openT < 1) {
      this.openT = Math.min(1, this.openT + dt * 3);
      this.lid.rotation.x = -ease.outBack(this.openT) * 1.9;
    }
    if (this.cageRise) {
      this.cageAnim += dt;
      this.cageRise.position.y = this.y + ease.inQuad(Math.min(1, this.cageAnim / 1.2)) * 4;
      if (this.cageAnim > 1.3) { this.cageRise.parent && this.cageRise.parent.remove(this.cageRise); this.cageRise = null; }
    }
  }
}

// 可破坏的罐子/木桶
export class Breakable {
  constructor(world, i, j, kind, seed) {
    this.world = world;
    this.i = i; this.j = j;
    const c = world.center(i, j);
    this.x = c.x + (Math.random() - 0.5) * 0.3; this.z = c.z + (Math.random() - 0.5) * 0.3;
    this.mesh = kind === 'barrel' ? makeBarrel(seed) : makePot(seed);
    this.mesh.position.set(this.x, 0, this.z);
    this.kind = kind;
    world.addAt(this.mesh, i, j);
    world.setSolid(i, j, true, this, kind === 'barrel' ? 0.9 : 0.62);
    world.reserve(i, j);
    world.breakables.push(this);
    this.broken = false;
  }
  smash() {
    if (this.broken) return;
    this.broken = true;
    const w = this.world;
    this.mesh.parent && this.mesh.parent.remove(this.mesh);
    w.setSolid(this.i, this.j, false, this);
    w.audio.play(this.kind === 'barrel' ? 'wood' : 'pot');
    w.fx.debris(this.x, 0.5, this.z, 10, this.kind === 'barrel' ? 0x6a4a2a : 0x9a5a3a, 4);
    w.fx.dust(this.x, 0.2, this.z, 5, 0x8a8078);
    const rub = makeRubble(this.i * 7 + this.j);
    rub.position.set(this.x, 0, this.z);
    rub.scale.setScalar(0.6);
    w.addAt(rub, this.i, this.j);
    w.dropLoot(this.x, this.z, Math.random() < 0.6 ? 1 : 0, 0.08, 0.02);
  }
}

// 下楼楼梯
export class Stairs {
  constructor(world, i, j, onUse) {
    this.world = world;
    const c = world.center(i, j);
    this.x = c.x; this.z = c.z;
    this.i = i; this.j = j;
    const m = makeStairs();
    this.root = m.root;
    this.glow = m.glow;
    this.root.position.set(c.x, 0, c.z);
    world.addAt(this.root, i, j);
    this.onUse = onUse;
    this.label = '进入下一层';
    this.icon = 'stairs';
    this.radius = 2.2;
    this.active = true;
    world.addInteract(this);
    world.updatables.push(this);
    world.addLight({ x: c.x, y: 1.2, z: c.z, color: 0x4ab8ff, intensity: 10, range: 8, region: world.regionAt(i, j), on: () => this.active && this.root.visible, priority: 1.5 });
  }
  enabled() { return this.active && this.root.visible; }
  interact() { this.onUse(); }
  update() {
    this.glow.material.opacity = 0.55 + Math.sin(this.world.time * 2.5) * 0.2;
    if (this.root.visible && Math.random() < 0.3) this.world.fx.magic(this.x, -0.5, this.z, 0x7fd8ff, 1, 0.8);
  }
}

// 治疗泉水
export class Fountain {
  constructor(world, i, j) {
    this.world = world;
    const c = world.center(i, j);
    this.x = c.x; this.z = c.z;
    const m = makeFountain();
    this.m = m;
    m.root.position.set(c.x, 0, c.z);
    world.addAt(m.root, i, j);
    world.setSolid(i, j, true);
    world.reserve(i, j);
    this.used = false;
    this.label = '饮用泉水';
    this.icon = 'potion';
    this.radius = 2.4;
    world.addInteract(this);
    world.updatables.push(this);
    world.addLight({ x: c.x, y: 1.5, z: c.z, color: 0x4ad8ff, intensity: 8, range: 8, region: world.regionAt(i, j), on: () => !this.used });
  }
  enabled() { return !this.used; }
  interact() {
    const p = this.world.player;
    this.used = true;
    p.heal(99);
    this.world.audio.play('heal');
    this.world.fx.magic(p.x, 0.3, p.z, 0x4ad8ff, 30, 0.8);
    this.world.game.hud.toast('生命已完全恢复', '#7fd8ff');
    this.m.water.material.color.setHex(0x2a3a4a);
    this.m.glow.visible = false;
  }
  update(dt) {
    if (!this.used && Math.random() < dt * 8) this.world.fx.magic(this.x + (Math.random() - 0.5), 0.8, this.z + (Math.random() - 0.5), 0x9fe8ff, 1, 0.3);
  }
}

// 神秘祭坛：花金币换能力
export class Altar {
  constructor(world, i, j, price, onBuy) {
    this.world = world;
    const c = world.center(i, j);
    this.x = c.x; this.z = c.z;
    const m = makeAltar();
    this.m = m;
    m.root.position.set(c.x, 0, c.z);
    world.addAt(m.root, i, j);
    world.setSolid(i, j, true);
    world.reserve(i, j);
    this.price = price;
    this.onBuy = onBuy;
    this.used = false;
    this.label = '献祭 ' + price + ' 金币';
    this.icon = 'coin';
    this.radius = 2.4;
    world.addInteract(this);
    world.updatables.push(this);
    world.addLight({ x: c.x, y: 1.5, z: c.z, color: 0xb06aff, intensity: 8, range: 8, region: world.regionAt(i, j), on: () => !this.used });
  }
  enabled() { return !this.used; }
  interact() {
    const run = this.world.run;
    if (run.coins < this.price) { this.world.audio.play('error'); this.world.game.hud.toast('金币不足（需要 ' + this.price + '）', '#ff8a7a'); return; }
    run.coins -= this.price;
    this.used = true;
    this.m.orb.visible = false;
    this.world.audio.play('levelup');
    this.world.fx.magic(this.x, 1, this.z, 0xc89aff, 40, 1);
    this.onBuy();
  }
  update(dt) {
    if (!this.used) { this.m.orb.position.y = 1.2 + Math.sin(this.world.time * 2) * 0.1; this.m.orb.rotation.y += dt; }
  }
}

// 火把：动画 + 登记光源（颜色随主题；无光词缀下熄灭）
export function placeTorch(world, x, z, rotY, region, theme) {
  const fl = theme ? theme.flame : [0xff7a1a, 0xffe06a];
  const lc = theme ? theme.torch : 0xff8a3a;
  const t = makeTorch(fl[0], fl[1], lc);
  // 墙前地面若被抬高（回廊/高台），火把随之上移
  let lift = world.groundAt(x + Math.sin(rotY) * 0.6, z + Math.cos(rotY) * 0.6);
  lift = lift > 8 ? 0 : Math.max(0, Math.min(WH - 1.9, lift));
  t.root.position.set(x, 1.3 + lift, z);
  t.root.rotation.y = rotY;
  world.groups[region].add(t.root);
  if (world.dark) { t.flame.visible = false; t.glow.visible = false; return t; }
  const fx = x + Math.sin(rotY) * 0.4, fz = z + Math.cos(rotY) * 0.4;
  world.addLight({ x: fx, y: 2.0 + lift, z: fz, color: lc, intensity: 9, range: 11, flicker: true, region });
  world.updatables.push({
    update(dt) {
      const k = world.time * 12 + x;
      t.flame.scale.set(1 + Math.sin(k) * 0.12, 1 + Math.sin(k * 1.3) * 0.2, 1 + Math.cos(k) * 0.12);
      t.glow.material.opacity = 0.45 + Math.sin(k * 0.7) * 0.1;
      if (t.root.parent && t.root.parent.visible && Math.random() < dt * 2) world.fx.bright.spawn({ x: fx, y: 2.1 + lift, z: fz, vx: (Math.random() - 0.5) * 0.3, vy: 1.2, vz: (Math.random() - 0.5) * 0.3, life: 0.6, size: 0.06, color: fl[1] });
    },
  });
  return t;
}

// 地形危害池：熔岩（灼烧）/ 毒沼（减速+中毒）/ 冰面（打滑）
export class HazardPool {
  constructor(world, cells, kind) {
    this.world = world;
    this.kind = kind;
    this.cells = cells;
    world.hazards = world.hazards || new Map();
    for (const c of cells) {
      world.hazards.set(world.idx(c.i, c.j), kind);
      world.reserve(c.i, c.j);
      const p = makePool(kind, 1.95, 1.95);
      const cc = world.center(c.i, c.j);
      p.root.position.set(cc.x, 0, cc.z);
      c.surf = p.surf;
      c.x = cc.x; c.z = cc.z;
      world.addAt(p.root, c.i, c.j);
      if (kind === 'lava') world.addLight({ x: cc.x, y: 0.8, z: cc.z, color: 0xff5a10, intensity: 5, range: 5, region: world.regionAt(c.i, c.j), priority: 0.6 });
    }
    world.updatables.push(this);
  }
  update(dt) {
    const w = this.world;
    const vis = w.discovered[w.regionAt(this.cells[0].i, this.cells[0].j)];
    if (!vis) return;
    for (const c of this.cells) {
      if (this.kind === 'lava') {
        const k = 0.8 + Math.sin(w.time * 2 + c.x) * 0.2;
        c.surf.material.color.setRGB(1, 0.35 * k + 0.05, 0.05);
        if (Math.random() < dt * 1.5) w.fx.bright.spawn({ x: c.x + (Math.random() - 0.5) * 1.6, y: 0.1, z: c.z + (Math.random() - 0.5) * 1.6, vy: 1.5 + Math.random(), life: 1, size: 0.1, color: 0xffa030, grav: -0.5 });
      } else if (this.kind === 'poison' && Math.random() < dt * 1.2) {
        w.fx.puffs.spawn({ x: c.x + (Math.random() - 0.5) * 1.4, y: 0.1, z: c.z + (Math.random() - 0.5) * 1.4, vy: 0.6, life: 1.2, size: 0.25, grow: 0.8, color: 0x7ad84a, spin: 0 });
      }
    }
  }
}

// 可破坏的裂缝墙（通往密室）
export class CrackedWall {
  constructor(world, i, j, secretRegion) {
    this.world = world;
    this.i = i; this.j = j;
    const c = world.center(i, j);
    this.x = c.x; this.z = c.z;
    this.hp = 3;
    this.secret = secretRegion;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(2.02, WH, 2.02), new THREE.MeshLambertMaterial({ map: crackTexture() }));
    this.mesh.position.set(c.x, WH / 2, c.z);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    world.s3.add(this.mesh);
    world.setSolid(i, j, true);
    world.hiddenRegions = world.hiddenRegions || new Set();
    world.hiddenRegions.add(secretRegion);
    world.crackedWalls = world.crackedWalls || [];
    world.crackedWalls.push(this);
    world.updatables.push(this);
  }
  hit() {
    if (this.broken) return;
    const w = this.world;
    this.hp--;
    this.shake = 0.2;
    w.audio.play('rockhit');
    w.fx.debris(this.x, 1.2, this.z, 6, 0x6a6474, 4);
    if (this.hp <= 0) {
      this.broken = true;
      w.s3.remove(this.mesh);
      w.setSolid(this.i, this.j, false);
      w.hiddenRegions.delete(this.secret);
      w.discover(this.secret);
      w.fx.explosion(this.x, 1, this.z, 0.8);
      w.fx.debris(this.x, 1.5, this.z, 20, 0x5a5462, 7);
      w.audio.play('boom');
      w.game.hud.toast('发现了隐藏密室！', '#ffcf4a');
    }
  }
  update(dt) {
    if (this.broken) return false;
    if (this.shake > 0) { this.shake -= dt; this.mesh.position.x = this.x + (Math.random() - 0.5) * 0.1; } else this.mesh.position.x = this.x;
    this.mesh.visible = this.world.discovered[this.world.regionAt(this.i, this.j)] === 1 || this.nearSeen();
    if (Math.random() < dt * 0.6) this.world.fx.dust(this.x + (Math.random() - 0.5), 0.2, this.z + (Math.random() - 0.5), 1, 0x8a8494);
    return true;
  }
  nearSeen() { const p = this.world.player; return p && Math.hypot(p.x - this.x, p.z - this.z) < 9; }
}

// 商人熊的小店
export class Shop {
  constructor(world, room, scene) {
    this.world = world;
    const cx = room.cx, sj = room.y + 1;
    const c = world.center(cx, sj);
    const stall = makeStall();
    stall.position.set(c.x, 0, c.z);
    world.addAt(stall, cx, sj);
    for (const di of [-1, 0, 1]) { world.setSolid(cx + di, sj, true); world.reserve(cx + di, sj); }
    const npc = makeBearHero({ cls: 'mage', gender: 'male', fur: 4, outfit: 4, acc: 2 });
    npc.weapon.visible = false;
    npc.root.position.set(c.x, 0, c.z - 1.2);
    world.addAt(npc.root, cx, sj);
    this.npc = npc;
    world.addLight({ x: c.x, y: 2.4, z: c.z + 0.5, color: 0xffd08a, intensity: 10, range: 8, region: room.id, priority: 1.2 });
    const f = world.d.floor;
    const items = [
      { id: 'potion', name: '生命药水', price: 20 + f * 4, icon: 'potion', desc: '回复 2 颗心' },
      { id: 'ability', name: '神秘卷轴', price: 90 + f * 20, icon: 'star', desc: '获得一项能力' },
      { id: 'key', name: '备用钥匙', price: 140 + f * 25, icon: 'key', desc: '直接获得一把钥匙' },
    ];
    this.items = [];
    items.forEach((it, k) => {
      const i = cx - 1 + k, j = sj + 2;
      if (!world.isFree(i, j)) return;
      world.reserve(i, j);
      const p = world.center(i, j);
      const b = new Builder();
      b.add(Geo.cyl(8), 0x4a4452, 0, 0.35, 0, 0.7, 0.7, 0.7, 0, 0, 0, 0.5);
      b.add(Geo.cyl(8), 0x6a1a22, 0, 0.72, 0, 0.8, 0.06, 0.8);
      const ped = b.mesh(true);
      ped.position.set(p.x, 0, p.z);
      world.addAt(ped, i, j);
      world.setSolid(i, j, true);
      let disp;
      if (it.id === 'potion') disp = makeHeartPickup();
      else if (it.id === 'key') disp = makeKey();
      else { const sb = new Builder(); sb.add(Geo.cyl(8), 0xf0e0b0, 0, 0, 0, 0.2, 0.7, 0.2, 0, 0, Math.PI / 2); sb.add(Geo.cyl(8), 0x8a2a2a, 0, 0, 0, 0.24, 0.1, 0.24, 0, 0, Math.PI / 2); disp = new THREE.Group(); disp.add(sb.mesh(false), glowSprite(0xb06aff, 1.4, 0.6)); }
      disp.position.set(p.x, 1.2, p.z);
      world.addAt(disp, i, j);
      const o = Object.assign(it, { x: p.x, z: p.z, disp, sold: false, radius: 2, iconName: it.icon });
      o.icon = 'coin';
      o.label = it.name + ' · ' + it.price + ' 金币';
      o.enabled = () => !o.sold && !(o.id === 'key' && world.run.keys >= world.d.keysNeeded);
      o.interact = () => {
        const run = world.run;
        if (run.coins < o.price) { world.audio.play('error'); world.game.hud.toast('金币不足（需要 ' + o.price + '）', '#ff8a7a'); return; }
        run.coins -= o.price;
        o.sold = true;
        disp.visible = false;
        world.audio.play('buy');
        world.fx.magic(p.x, 1, p.z, 0xffd86a, 20, 0.6);
        if (o.id === 'potion') world.player.heal(4);
        else if (o.id === 'key') { run.keys++; world.game.hud.toast('获得钥匙！（' + run.keys + '/' + world.d.keysNeeded + '）', '#ffcf4a'); world.audio.play('key'); }
        else scene.openChoice(true);
        world.game.hud.dirty = true;
      };
      world.addInteract(o);
      this.items.push(o);
    });
    world.updatables.push(this);
    this.greeted = false;
  }
  update(dt) {
    const w = this.world;
    animateBear(this.npc, w.time, false);
    this.npc.armR.rotation.x = -0.4 + Math.sin(w.time * 3) * 0.3;
    for (const it of this.items) if (!it.sold) { it.disp.rotation.y += dt * 1.5; it.disp.position.y = 1.2 + Math.sin(w.time * 2 + it.x) * 0.08; }
    const p = w.player;
    if (!this.greeted && p && Math.hypot(p.x - this.npc.root.position.x, p.z - this.npc.root.position.z) < 6) {
      this.greeted = true;
      w.game.hud.toast('商人熊：欢迎光临！金币换好货～', '#ffd08a');
    }
  }
}

// 被囚禁的熊熊：解救后获得祝福
export class Prisoner {
  constructor(world, i, j, scene, seed) {
    this.world = world;
    this.scene = scene;
    const c = world.center(i, j);
    this.x = c.x; this.z = c.z;
    this.bear = makeBearHero({ cls: ['knight', 'ranger', 'mage', 'berserker'][seed % 4], gender: seed % 2 ? 'female' : 'male', fur: seed % FURS.length, outfit: (seed * 3) % OUTFITS.length, acc: 1 });
    this.bear.root.position.set(c.x, 0, c.z);
    this.bear.root.rotation.y = 0.3;
    this.bear.weapon.visible = false;
    world.addAt(this.bear.root, i, j);
    this.cage = makeCage();
    this.cage.position.set(c.x, 0, c.z);
    world.addAt(this.cage, i, j);
    world.setSolid(i, j, true);
    world.reserve(i, j);
    this.freed = false;
    this.label = '解救熊熊';
    this.icon = 'hand';
    this.radius = 2.4;
    world.addInteract(this);
    world.updatables.push(this);
  }
  enabled() { return !this.freed; }
  interact() {
    const w = this.world;
    this.freed = true;
    this.t = 0;
    w.audio.play('gate');
    w.audio.play('levelup');
    w.fx.magic(this.x, 0.5, this.z, 0xffd86a, 30, 1);
    const r = Math.random();
    if (r < 0.35) {
      w.run.maxHp += 2; w.run.hp += 2;
      w.game.hud.toast('获救的熊熊：谢谢你！（生命上限 +1 颗心）', '#ffcf4a');
    } else if (r < 0.7) {
      for (let k = 0; k < 2; k++) w.spawnPickup('crystal', this.x, this.z + 1, { y: 1.5 });
      for (let k = 0; k < 8; k++) w.spawnPickup('coin', this.x, this.z + 1, { y: 1.5, value: 2 });
      w.game.hud.toast('获救的熊熊送给你一些宝物！', '#ffcf4a');
    } else {
      w.game.hud.toast('获救的熊熊传授了你一项技艺！', '#ffcf4a');
      this.scene.openChoice(true);
    }
    w.game.hud.dirty = true;
  }
  update(dt) {
    const w = this.world;
    if (!this.freed) {
      animateBear(this.bear, w.time * 0.6, false);
      this.bear.head.rotation.x = 0.3;
      this.bear.armL.rotation.x = -0.6; this.bear.armR.rotation.x = -0.6;
      if (Math.random() < dt * 0.5) w.fx.text(this.x, 2.4, this.z, '救命！', '#ffe8a0', 0.5);
      return;
    }
    this.t += dt;
    this.cage.position.y = Math.min(4, this.t * 3);
    this.bear.pivot.position.y = Math.abs(Math.sin(this.t * 6)) * 0.4;
    this.bear.armL.rotation.x = -2.6 + Math.sin(this.t * 12) * 0.3;
    this.bear.armR.rotation.x = -2.6 - Math.sin(this.t * 12) * 0.3;
    if (this.t > 3) { this.bear.pivot.position.y = 0; this.bear.armR.rotation.x = -2.2 + Math.sin(w.time * 6) * 0.4; this.bear.armL.rotation.x = 0; }
  }
}

// 图书馆的古书：阅读获得水晶与传说
const LORE = [
  '「熊熊王国的密钥被分成碎片，散落在地牢各层……」',
  '「石魔惧怕火焰，但更惧怕勇敢的心。」',
  '「骷髅巫王曾是一位迷路的学者。」',
  '「冰封洞窟的尽头，藏着永不融化的蜂蜜。」',
  '「每一位熊熊勇士，都会在地牢里找到属于自己的力量。」',
  '「据说有些墙壁一敲就碎，后面藏着宝藏。」',
];
export class LoreBook {
  constructor(world, i, j) {
    this.world = world;
    const c = world.center(i, j);
    this.x = c.x; this.z = c.z;
    const b = new Builder();
    b.add(Geo.cyl(8), 0x4a3a2a, 0, 0.45, 0, 0.3, 0.9, 0.3);
    b.add(Geo.box(), 0x5a4030, 0, 0.95, 0, 0.9, 0.1, 0.6, -0.3, 0, 0);
    b.add(Geo.box(), 0xf0e8d0, -0.2, 1.02, 0, 0.4, 0.04, 0.5, -0.3, 0, 0.08);
    b.add(Geo.box(), 0xf0e8d0, 0.2, 1.02, 0, 0.4, 0.04, 0.5, -0.3, 0, -0.08);
    const m = b.mesh(true);
    m.position.set(c.x, 0, c.z);
    world.addAt(m, i, j);
    this.glow = glowSprite(0xffe8a0, 1.6, 0.6);
    this.glow.position.set(c.x, 1.3, c.z);
    world.addAt(this.glow, i, j);
    world.setSolid(i, j, true, null, 1.05);
    world.reserve(i, j);
    this.read = false;
    this.label = '阅读古书';
    this.icon = 'eye';
    this.radius = 2.2;
    world.addInteract(this);
  }
  enabled() { return !this.read; }
  interact() {
    const w = this.world;
    this.read = true;
    this.glow.visible = false;
    w.audio.play('magic');
    w.game.hud.toast(LORE[Math.floor(Math.random() * LORE.length)], '#e8d8b0');
    w.spawnPickup('crystal', this.x, this.z + 1, { y: 1.3 });
    w.fx.magic(this.x, 1, this.z, 0xffe8a0, 16, 0.5);
  }
}


// 移动平台：往返滑动的石板 / 升降台（玩家站上去会被带着走）
export class MovingPlatform {
  constructor(world, spec, accent = 0x9fe8ff) {
    this.world = world;
    this.spec = spec;
    this.lift = spec.kind === 'lift';
    if (this.lift) {
      const c = world.center(spec.i, spec.j);
      this.ax = this.bx = c.x; this.az = this.bz = c.z;
      this.ay = spec.h0; this.by = spec.h1;
      this.region = world.regionAt(spec.i, spec.j);
    } else {
      const a = world.center(spec.a[0], spec.a[1]), b = world.center(spec.b[0], spec.b[1]);
      this.ax = a.x; this.az = a.z; this.bx = b.x; this.bz = b.z;
      this.ay = this.by = spec.h || 0;
      this.region = world.regionAt(spec.a[0], spec.a[1]);
    }
    const dist = Math.hypot(this.bx - this.ax, this.bz - this.az) + Math.abs(this.by - this.ay);
    this.travel = dist / (this.lift ? 1.3 : (spec.speed || 1.8));
    this.pause = this.lift ? 1.1 : 0.8;
    this.t = spec.phase || 0;
    this.hw = this.hd = T * 0.46;
    const b = new Builder();
    const w2 = T * 0.92;
    b.add(Geo.box(), 0x6a6474, 0, -0.18, 0, w2, 0.36, w2, 0, 0, 0, 0.3);
    b.add(Geo.box(), 0x8a8494, 0, -0.01, 0, w2 - 0.2, 0.04, w2 - 0.2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(Geo.box(), 0xc9a45a, sx * (w2 / 2 - 0.08), -0.02, sz * (w2 / 2 - 0.08), 0.18, 0.06, 0.18);
    b.add(Geo.cone(6), 0x4a4452, 0, -0.62, 0, 0.9, 0.6, 0.9, Math.PI, 0, 0);
    if (this.lift) for (const sx of [-1, 1]) b.add(Geo.box(), 0xc9a45a, sx * (w2 / 2 - 0.05), -0.05, 0, 0.06, 0.08, w2);
    this.mesh = b.mesh(true);
    const rune = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 20).rotateX(-Math.PI / 2), matGlow(accent));
    rune.position.y = 0.015;
    this.mesh.add(rune);
    const gl = glowSprite(accent, 2.2, 0.5); gl.position.y = -0.7; this.mesh.add(gl);
    world.groups[this.region].add(this.mesh);
    this.x = this.ax; this.z = this.az; this.top = this.ay;
    this.dx = this.dz = this.dy = 0;
    this.update(0);
    world.platforms.push(this);
  }
  update(dt) {
    this.t += dt;
    const cyc = 2 * (this.travel + this.pause);
    const u = ((this.t % cyc) + cyc) % cyc;
    const sm = (q) => q * q * (3 - 2 * q);
    let k;
    if (u < this.pause) k = 0;
    else if (u < this.pause + this.travel) k = sm((u - this.pause) / this.travel);
    else if (u < 2 * this.pause + this.travel) k = 1;
    else k = 1 - sm((u - 2 * this.pause - this.travel) / this.travel);
    const nx = this.ax + (this.bx - this.ax) * k, nz = this.az + (this.bz - this.az) * k, ny = this.ay + (this.by - this.ay) * k;
    this.dx = nx - this.x; this.dz = nz - this.z; this.dy = ny - this.top;
    this.x = nx; this.z = nz; this.top = ny;
    this.mesh.position.set(nx, ny, nz);
  }
}

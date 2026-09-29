// 玩家（熊熊英雄）：移动、推箱、职业攻击、翻滚、技能、受伤、地形效果
import * as THREE from 'three';
import { blobShadow, makeFireball, Builder, Geo, matGlow, glowSprite, makeArrow } from './models.js';
import { makeBearHero, animateBear, poseAir, poseLand, CLASSES, DEFAULT_HERO } from './heroes.js';
import { angleLerp } from './utils.js';
import { K, PIT } from './terrain.js';
import { T } from './dungeon.js';

const G = 24, JUMP_V = 8.6;

const _v = new THREE.Vector3();

export class Player {
  constructor(world, run, meta) {
    this.world = world;
    this.run = run;
    this.meta = meta;
    this.cfg = run.hero || DEFAULT_HERO;
    this.cls = CLASSES[this.cfg.cls] || CLASSES.knight;
    this.rig = makeBearHero(this.cfg);
    if (this.rig.rig) this.rig.rig.lod = false;
    const r = this.rig;
    r.armR.rotation.order = 'YXZ';
    r.armL.rotation.order = 'YXZ';
    if (this.cls.attack === 'slash' || this.cls.attack === 'cleave') r.weapon.rotation.x = Math.PI / 2;
    this.root = r.root;
    world.s3.add(this.root);
    this.shadow = blobShadow(1.4);
    world.s3.add(this.shadow);
    this.lantern = new THREE.PointLight(0xffb070, 16, 13, 1.3);
    world.s3.add(this.lantern);
    this.x = 0; this.z = 0; this.y = 0;
    this.vy = 0; this.grounded = true; this.coyote = 0; this.jumpBuf = 0; this.airJumps = 0;
    this.climb = null; this.climbT = 0; this.landT = 0; this.landK = 0; this.safe = null;
    this.flipT = 0; this.takeoffT = 0; this.jumpCut = false;
    this.hc = { y: 0, step: 0.3, drop: 99 };
    this.face = Math.PI;
    this.vx = 0; this.vz = 0;
    this.mvx = 0; this.mvz = 0;
    this.alive = true;
    this.invuln = 0;
    this.attackCd = 0;
    this.swingT = -1;
    this.dashT = 0; this.dashCd = 0;
    this.skillCd = { fireball: 0, nova: 0 };
    this.shieldT = 0;
    this.shieldReady = false;
    this.pushT = 0;
    this.hitCounter = 0;
    this.walkT = 0;
    this.hurtFlash = 0;
    this.slowT = 0;
    const wide = this.cls.attack === 'cleave';
    this.slashGeo = new THREE.RingGeometry(0.7, wide ? 2.7 : 2.2, 26, 1, -Math.PI / 2 - (wide ? 1.75 : 1.2), wide ? 3.5 : 2.4).rotateX(-Math.PI / 2);
    this.whirlGeo = new THREE.RingGeometry(0.7, 2.6, 40, 1, 0, Math.PI * 2).rotateX(-Math.PI / 2);
    this.slash = new THREE.Mesh(this.slashGeo, new THREE.MeshBasicMaterial({ color: wide ? 0xffd0a0 : 0xe8f4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.slash.renderOrder = 15;
    world.s3.add(this.slash);
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x6ab8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.bubble.visible = false;
    world.s3.add(this.bubble);
    this.recalc();
  }
  get ab() { return this.run.abilities; }
  recalc() {
    const a = this.ab, c = this.cls;
    this.dmg = c.dmg * (1 + 0.25 * (a.sharp || 0)) * (1 + 0.12 * (this.meta.dmg || 0));
    this.speed = c.speed * (1 + 0.15 * (a.boots || 0));
    this.dashCdMax = 1.0 * (c.dashMul || 1) * (1 - 0.2 * (a.boots || 0));
    this.shieldPeriod = a.shield ? (a.shield === 1 ? 12 : 8) : 0;
  }
  // 狂战士：生命越低伤害越高
  get dmgNow() {
    if (this.cls.attack !== 'cleave') return this.dmg;
    const f = this.run.hp / this.run.maxHp;
    return this.dmg * (1 + (1 - f) * 0.8);
  }
  place(x, z) {
    this.x = x; this.z = z;
    this.y = Math.min(8, this.world.groundAt(x, z));
    this.vy = 0; this.grounded = true; this.climb = null; this.plat = null;
    this.safe = { x, z, y: this.y };
    this.root.position.set(x, this.y, z);
  }
  get airborne() { return !this.grounded && !this.climb; }
  slow(t) { this.slowT = Math.max(this.slowT, t); }

  update(dt, inp) {
    const w = this.world;
    const r = this.rig;
    this.invuln = Math.max(0, this.invuln - dt);
    this.attackCd -= dt;
    this.dashCd -= dt;
    this.slowT = Math.max(0, this.slowT - dt);
    for (const k in this.skillCd) this.skillCd[k] -= dt;
    if (this.shieldPeriod && !this.shieldReady) {
      this.shieldT += dt;
      if (this.shieldT >= this.shieldPeriod) { this.shieldReady = true; this.shieldT = 0; w.audio.play('shield'); w.game.hud.dirty = true; }
    }
    if (!this.alive) {
      this.deathT += dt;
      r.pivot.rotation.x = -Math.min(1.5, this.deathT * 3);
      r.pivot.position.y = Math.max(-0.3, -this.deathT * 0.4);
      this.lantern.intensity = Math.max(0, this.lantern.intensity - dt * 10);
      return;
    }
    const ground = w.hazardAt ? w.hazardAt(this.x, this.z) : null;
    // 站在移动平台上：随平台一起移动
    if (this.grounded && this.plat) { const P = this.plat; if (P.dx || P.dz) this.moveBy(P.dx, P.dz); this.y += P.dy; }
    // 移动
    let mx = inp.mx, mz = inp.mz;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }
    const moving = mag > 0.12;
    if (this.climb) {
      this.mvx = this.mvz = 0;
      if (this.dashT > 0) this.dashT -= dt;
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      const sp = this.ab.phase ? 17 : 14;
      this.moveBy(this.dashDir[0] * sp * dt, this.dashDir[1] * sp * dt);
      if (Math.random() < 0.9) w.fx.puffs.spawn({ x: this.x, y: this.y + 0.8, z: this.z, life: 0.3, size: 0.5, color: this.ab.phase ? 0x9a6aff : 0x9fb8d8, grow: -0.5, spin: 0 });
      if (this.ab.phase) {
        for (const e of w.enemies) {
          if (e.dead || this.dashHits.has(e)) continue;
          if (Math.hypot(e.x - this.x, e.z - this.z) < e.radius + 0.7) { this.dashHits.add(e); this.hitEnemy(e, this.dmgNow * 0.8, this.x, this.z, false); }
        }
      }
      this.mvx = this.dashDir[0] * this.speed; this.mvz = this.dashDir[1] * this.speed;
    } else {
      const spd = this.speed * (this.swingT >= 0 ? 0.55 : 1) * (this.slowT > 0 ? 0.55 : 1) * (ground === 'poison' ? 0.7 : 1);
      const tx = moving ? mx * spd : 0, tz = moving ? mz * spd : 0;
      if (ground === 'ice' && this.grounded) {
        // 冰面：惯性滑行
        const k = Math.min(1, dt * 1.6);
        this.mvx += (tx - this.mvx) * k; this.mvz += (tz - this.mvz) * k;
      } else if (!this.grounded) {
        // 空中：保留起跳动量，转向更柔和
        const k = Math.min(1, dt * (moving ? 7 : 2.5));
        this.mvx += (tx * 1.05 - this.mvx) * k; this.mvz += (tz * 1.05 - this.mvz) * k;
      } else {
        const k = Math.min(1, dt * 22);
        this.mvx += (tx - this.mvx) * k; this.mvz += (tz - this.mvz) * k;
      }
      if (Math.abs(this.mvx) + Math.abs(this.mvz) > 0.05) {
        const hit = this.moveBy(this.mvx * dt, this.mvz * dt);
        if (hit && ground === 'ice') { if (hit.di) this.mvx *= -0.3; if (hit.dj) this.mvz *= -0.3; }
        if (moving && this.grounded) this.handlePush(hit, mx, mz, dt); else this.pushT = 0;
      }
      if (moving && this.swingT < 0) this.face = angleLerp(this.face, Math.atan2(mx, mz), Math.min(1, dt * 14));
      if (moving && this.grounded) { this.walkT += dt * (spd / this.cls.speed); if (Math.sin(this.walkT * 9) > 0.95) w.audio.play('step'); }
    }
    if (this.slowT > 0 && Math.random() < dt * 8) w.fx.sparks(this.x, 0.8, this.z, 1, 0xbff4ff, 1);
    // 击退
    if (Math.abs(this.vx) + Math.abs(this.vz) > 0.01) {
      this.moveBy(this.vx * dt, this.vz * dt);
      this.vx *= Math.pow(0.001, dt); this.vz *= Math.pow(0.001, dt);
    }
    this.vertical(dt, inp, mx, mz, moving);
    if (!this.alive) return;
    // 攻击
    if (inp.attack && this.attackCd <= 0 && this.dashT <= 0 && !this.climb) this.startAttack();
    const at = this.cls.attack;
    const melee = at === 'slash' || at === 'cleave';
    // 行走/待机动画（攻击姿态随后覆盖手臂）
    const movingVis = (moving || Math.abs(this.mvx) + Math.abs(this.mvz) > 0.5) && this.dashT <= 0;
    animateBear(r, w.time, movingVis && this.grounded, Math.hypot(this.mvx, this.mvz) / this.cls.speed, dt);
    r.torso.rotation.x = movingVis && this.grounded ? 0.1 : 0;
    if (this.climb) {
      const c = this.climbT * 7;
      r.armL.rotation.set(-2.7 + Math.sin(c) * 0.35, 0, 0); r.armR.rotation.set(-2.7 - Math.sin(c) * 0.35, 0, 0);
      r.elbowL.rotation.x = -0.5 - Math.max(0, Math.sin(c)) * 0.6; r.elbowR.rotation.x = -0.5 - Math.max(0, -Math.sin(c)) * 0.6;
      r.legL.rotation.x = -0.6 + Math.sin(c) * 0.5; r.legR.rotation.x = -0.6 - Math.sin(c) * 0.5;
      r.kneeL.rotation.x = 0.9 - Math.sin(c) * 0.5; r.kneeR.rotation.x = 0.9 + Math.sin(c) * 0.5;
    } else if (!this.grounded) {
      poseAir(r, this.vy, dt);
      // 身体随水平速度前倾
      r.torso.rotation.x = Math.min(0.3, Math.hypot(this.mvx, this.mvz) * 0.05);
    } else r.armL.rotation.z = r.fem ? -0.12 : -0.18;
    if (this.landT > 0 && this.grounded) poseLand(r, Math.sin(Math.min(1, this.landT) * Math.PI * 0.5) * this.landK);
    r.lockR = this.swingT >= 0;
    if (this.swingT >= 0) {
      const prev = this.swingT;
      this.swingT += dt;
      const hitT = at === 'cleave' ? 0.12 : 0.07;
      if (prev < hitT && this.swingT >= hitT) this.resolveAttack();
      const dur = at === 'cleave' ? 0.3 : 0.22;
      const k = Math.min(1, this.swingT / dur);
      // 全身动作：扭腰、跨步、随势收招；w 为攻击姿态权重（收招时平滑淡出）
      const e = 1 - Math.pow(1 - k, 3);
      const w = this.swingT < dur ? 1 : Math.max(0, 1 - (this.swingT - dur) / 0.1);
      const set = (o, ax, v) => { o.rotation[ax] += (v - o.rotation[ax]) * w; };
      if (melee) {
        set(r.elbowR, 'x', -0.1);
        if (this.whirling) { r.pivot.rotation.y = k * Math.PI * 2; r.armR.rotation.set(-1.5, 0, 0); r.armL.rotation.set(-1.2, 0, -0.6); }
        else if (at === 'cleave') {
          // 高举过头 → 斜劈而下，身体前压、双膝下蹲
          set(r.armR, 'x', -2.9 + e * 3.0); set(r.armR, 'y', 0.5 - e * 1.1); set(r.armR, 'z', 0.2);
          set(r.armL, 'x', -2.4 + e * 2.2); set(r.armL, 'z', -0.2);
          set(r.torso, 'x', -0.25 + e * 0.6); set(r.torso, 'y', 0.25 - e * 0.5);
          set(r.chest, 'x', -0.1 + e * 0.25);
          set(r.kneeL, 'x', 0.1 + e * 0.6); set(r.kneeR, 'x', 0.1 + e * 0.5);
          set(r.legL, 'x', -e * 0.45); set(r.legR, 'x', e * 0.2);
          if (r.hips) r.hips.position.y = r.hips.userData.bind.y - e * 0.1 * w;
        } else {
          // 横斩：从右后方挥向左前方，腰胯带动，前脚跨步
          set(r.armR, 'x', -1.4); set(r.armR, 'y', 1.4 - e * 2.8);
          set(r.armL, 'x', -0.6 + e * 0.3); set(r.armL, 'y', -0.4 + e * 0.6); set(r.armL, 'z', -0.4);
          set(r.torso, 'y', 0.55 - e * 1.0); set(r.chest, 'y', 0.25 - e * 0.45);
          set(r.torso, 'x', 0.12);
          set(r.legL, 'x', -0.5 * e); set(r.kneeL, 'x', 0.35 * e); set(r.legR, 'x', 0.3 * e);
          set(r.head, 'y', -0.3 + e * 0.5);
        }
        this.slash.material.opacity = Math.max(0, 0.75 * (1 - this.swingT / (dur + 0.05)));
      } else if (at === 'arrow') {
        // 侧身拉弓 → 放箭后后坐
        const rec = Math.max(0, (this.swingT - 0.06) / 0.2);
        set(r.torso, 'y', 0.45); set(r.chest, 'y', 0.2);
        set(r.armL, 'x', -1.55); set(r.armL, 'y', -0.45); set(r.elbowL, 'x', -0.05);
        set(r.armR, 'x', -1.45); set(r.armR, 'y', 0.9 + rec * 0.3); set(r.elbowR, 'x', -1.7 + rec * 0.9);
        set(r.head, 'y', -0.35); set(r.torso, 'x', -0.05 * (1 - rec));
      } else {
        // 施法：身体前倾，手臂向前推出
        set(r.armR, 'x', -1.2 - Math.sin(k * Math.PI) * 0.5); set(r.armR, 'y', 0.25); set(r.elbowR, 'x', -0.4 + e * 0.35);
        set(r.armL, 'x', -0.9 * Math.sin(k * Math.PI)); set(r.armL, 'z', -0.5);
        set(r.torso, 'x', 0.1 + Math.sin(k * Math.PI) * 0.15); set(r.torso, 'y', 0.2 - e * 0.3);
      }
      if (this.swingT > dur + 0.1) { this.swingT = -1; r.pivot.rotation.y = 0; this.slash.material.opacity = 0; }
    } else {
      // 持械待机：武器自然垂握，手臂稍前抬
      const rx = melee ? -0.35 : at === 'bolt' ? -0.3 : 0.05;
      r.armR.rotation.x += (rx - r.armR.rotation.x) * Math.min(1, dt * 10);
      r.armR.rotation.y += (0.15 - r.armR.rotation.y) * Math.min(1, dt * 10);
      r.armL.rotation.y += (0 - r.armL.rotation.y) * Math.min(1, dt * 10);
    }
    if (inp.dash && this.dashCd <= 0 && !this.climb) this.startDash(mx, mz, moving);
    if (inp.skill) this.cast(inp.skill);
    // 表现
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.face;
    r.pivot.rotation.x = this.dashT > 0 ? 0.6 : 0;
    // 二段跳前空翻
    if (this.flipT > 0) { this.flipT = Math.max(0, this.flipT - dt); r.spin.rotation.x = (1 - this.flipT / 0.42) * Math.PI * 2; if (this.flipT === 0) r.spin.rotation.x = 0; }
    if (this.landT > 0) this.landT = Math.max(0, this.landT - dt * 4.5);
    // 挤压拉伸：起跳拉长、下落微拉长、落地压扁
    let sy = 1;
    if (this.takeoffT > 0) { this.takeoffT = Math.max(0, this.takeoffT - dt); sy = 1 + Math.sin((1 - this.takeoffT / 0.18) * Math.PI) * 0.16; }
    else if (!this.grounded && !this.climb) sy = 1 + Math.min(0.08, Math.abs(this.vy) * 0.008);
    else if (this.landT > 0) sy = 1 - Math.sin(this.landT * Math.PI) * 0.12 * this.landK;
    r.pivot.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    this.root.visible = !(this.invuln > 0 && this.dashT <= 0 && Math.floor(this.invuln * 16) % 2 === 0);
    let gy = w.footAt(this.x, this.z, this.y).g; if (gy > 8) gy = this.y;
    this.shadow.position.set(this.x, gy + 0.03, this.z);
    const hs = 1 / (1 + Math.max(0, this.y - gy) * 0.35);
    this.shadow.scale.setScalar(hs); this.shadow.visible = gy > PIT + 0.5;
    this.lantern.position.set(this.x, this.y + 2.6, this.z + 0.6);
    this.slash.position.set(this.x, this.y + 0.8, this.z);
    this.bubble.visible = this.shieldReady;
    if (this.shieldReady) { this.bubble.position.set(this.x, this.y + 0.85, this.z); this.bubble.scale.setScalar(1.1 + Math.sin(w.time * 4) * 0.04); }
  }
  moveBy(dx, dz) { this.hc.y = this.y; return this.world.moveCircle(this, dx, dz, 0.42, false, this.hc); }

  // ------------------------------------------------------------ 跳跃 / 重力 / 攀爬 / 坠落
  vertical(dt, inp, mx, mz, moving) {
    const w = this.world, r = this.rig;
    this.jumpBuf = inp.jump ? 0.14 : Math.max(0, this.jumpBuf - dt);
    if (this.climb) {
      const L = this.climb;
      const push = moving && (mx * -L.di + mz * -L.dj) > 0.3;
      if (this.jumpBuf > 0) {
        this.climb = null; this.jumpBuf = 0;
        this.vy = JUMP_V * 0.75; this.vx = L.di * 6; this.vz = L.dj * 6;
        this.face = Math.atan2(L.di, L.dj);
        w.audio.play('jump');
      } else if (push) {
        this.y += 3.8 * dt; this.climbT += dt;
        if (Math.sin(this.climbT * 7) > 0.97) w.audio.play('climb');
        if (this.y >= L.top - 0.25) {
          this.y = L.top + 0.02;
          this.climb = null;
          this.moveBy(-L.di * 0.7, -L.dj * 0.7);
          this.grounded = true; this.vy = 0; this.landT = 1; this.landK = 0.5;
          w.fx.dust(this.x, this.y + 0.1, this.z, 4, 0x8a8078);
        }
      } else if (moving) { this.climb = null; this.vy = 0; }
      if (this.climb) { this.vy = 0; this.grounded = false; return; }
    }
    const F0 = w.footAt(this.x, this.z, this.y);
    const g = F0.g;
    if (this.grounded) {
      if (g < this.y - 0.35) { this.grounded = false; this.coyote = 0.1; this.vy = 0; this.plat = null; }
      else { this.y = g; this.plat = F0.plat; }
    }
    if (this.jumpBuf > 0) {
      if (this.grounded || this.coyote > 0) {
        this.jumpBuf = 0; this.grounded = false; this.coyote = 0;
        // 从移动平台起跳时继承平台速度
        if (this.plat && dt > 0) { this.mvx += this.plat.dx / dt * 0.6; this.mvz += this.plat.dz / dt * 0.6; }
        this.plat = null;
        this.vy = JUMP_V; this.jumpCut = true; this.takeoffT = 0.18;
        this.airJumps = this.ab.wings ? 1 : 0;
        // 起跳时带上当前跑动速度
        this.mvx *= 1.08; this.mvz *= 1.08;
        w.audio.play('jump');
        w.fx.dust(this.x, this.y + 0.05, this.z, 4, 0x8a8078);
      } else if (this.airJumps > 0) {
        this.jumpBuf = 0; this.airJumps--;
        this.vy = JUMP_V * 0.95; this.jumpCut = true; this.flipT = 0.42;
        w.audio.play('jump2');
        for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; w.fx.bright.spawn({ x: this.x, y: this.y + 0.2, z: this.z, vx: Math.cos(a) * 3, vy: -0.5, vz: Math.sin(a) * 3, life: 0.35, size: 0.12, color: 0xdff4ff, drag: 4 }); }
      }
    }
    if (!this.grounded) {
      this.coyote -= dt;
      // 松开跳跃键提前下落（可控跳跃高度）
      if (this.jumpCut && !inp.jumpHeld && this.vy > 2.5) { this.vy *= 0.5; this.jumpCut = false; }
      if (this.vy <= 0) this.jumpCut = false;
      // 上升正常重力，顶点附近滞空，下落更快
      const gm = Math.abs(this.vy) < 2 ? 0.62 : this.vy < 0 ? 1.45 : 1;
      if (this.dashT > 0) this.vy = Math.max(0, this.vy) * 0.5;
      else this.vy = Math.max(-19, this.vy - G * gm * dt);
      this.y += this.vy * dt;
      const F1 = w.footAt(this.x, this.z, this.y - this.vy * dt);
      const g2 = F1.g;
      if (this.y <= g2 && this.vy <= 0) {
        const hard = this.vy < -9;
        this.y = g2; this.grounded = true; this.plat = F1.plat;
        if (this.vy < -3) {
          this.landT = 1; this.landK = hard ? 1 : Math.min(0.8, -this.vy * 0.07);
          w.audio.play(hard ? 'landHard' : 'land');
          w.fx.dust(this.x, this.y + 0.05, this.z, hard ? 8 : 4, 0x8a8078);
          if (hard) w.fx.shake = Math.max(w.fx.shake, 0.12);
        }
        this.vy = 0;
      }
      if (this.y < PIT + 1.6) { this.pitFall(); return; }
    }
    // 弹跳机关
    if (this.grounded && w.bouncePads) {
      for (const b of w.bouncePads) {
        if (Math.abs(this.x - b.x) < 0.8 && Math.abs(this.z - b.z) < 0.8 && Math.abs(this.y - b.y) < 0.3) {
          this.grounded = false; this.vy = 15.5; this.jumpCut = false; this.takeoffT = 0.18; this.airJumps = this.ab.wings ? 1 : 0;
          b.trigger();
          break;
        }
      }
    }
    // 攀爬：贴着梯子并朝梯子方向推摇杆
    if (!this.climb && moving && w.ladders) {
      for (const L of w.ladders) {
        if (this.y > L.top - 0.35 || this.y < L.base - 0.2) continue;
        if (mx * -L.di + mz * -L.dj < 0.55) continue;
        const fx = L.di ? (L.di > 0 ? (L.i + 1) * T : L.i * T) : null, fz = L.dj ? (L.dj > 0 ? (L.j + 1) * T : L.j * T) : null;
        if (L.di) {
          if (Math.abs(this.x - fx) > 0.75 || Math.abs(this.z - (L.j * T + T / 2)) > 0.75) continue;
          this.x = fx + L.di * 0.45; this.z = L.j * T + T / 2;
        } else {
          if (Math.abs(this.z - fz) > 0.75 || Math.abs(this.x - (L.i * T + T / 2)) > 0.75) continue;
          this.z = fz + L.dj * 0.45; this.x = L.i * T + T / 2;
        }
        this.climb = L; this.climbT = 0; this.grounded = false; this.vy = 0; this.dashT = 0;
        this.face = Math.atan2(-L.di, -L.dj);
        break;
      }
    }
    // 记录最近的安全落脚点（用于坠落深渊后复位）
    if (this.grounded) {
      const i = Math.floor(this.x / T), j = Math.floor(this.z / T);
      const kd = w.kindAt(i, j);
      if ((kd === K.FLOOR || kd === K.PLAT || kd === K.SUNK || kd === K.BLOCK) && !w.hazardAt(this.x, this.z)) {
        const cx = i * T + T / 2, cz = j * T + T / 2;
        if (!this.safe || this.safe.i !== i || this.safe.j !== j) this.safe = { x: cx, z: cz, y: w.groundAt(cx, cz), i, j };
      }
    }
  }
  pitFall() {
    const w = this.world;
    const s = this.safe || { x: this.x, z: this.z, y: 0 };
    w.audio.play('fall');
    this.invuln = 0;
    this.hurt(w.theme && w.theme.hazard === 'lava' ? 2 : 1, this.x, this.z, 'fall');
    this.x = s.x; this.z = s.z; this.y = s.y;
    this.vx = this.vz = this.mvx = this.mvz = 0;
    this.vy = 0; this.grounded = true; this.dashT = 0; this.plat = null;
    if (this.alive) this.invuln = Math.max(this.invuln, 1.2);
    w.fx.magic(this.x, this.y + 0.3, this.z, 0x9fd8ff, 16, 0.8);
    w.game.hud.toast('坠入深渊！', '#ff8a7a');
  }
  handlePush(hit, mx, mz, dt) {
    const w = this.world;
    if (!hit) { this.pushT = 0; return; }
    const obj = w.objAt.get(w.idx(hit.i, hit.j));
    if (!obj || !obj.isCrate) { this.pushT = 0; return; }
    if (mx * hit.di + mz * hit.dj < 0.7) { this.pushT = 0; return; }
    this.pushT += dt;
    if (this.pushT > 0.18) {
      this.pushT = 0;
      if (!obj.puzzle.push(obj, hit.di, hit.dj)) w.audio.play('error');
    }
  }
  nearestEnemy(range, needLos) {
    const w = this.world;
    let best = null, bd = range;
    for (const e of w.enemies) {
      if (e.dead || e.spawnT > 0 || !e.root.visible || e.fading) continue;
      const d = Math.hypot(e.x - this.x, e.z - this.z);
      if (d < bd && (!needLos || w.los(this.x, this.z, e.x, e.z))) { bd = d; best = e; }
    }
    return best;
  }
  startAttack() {
    const w = this.world;
    const at = this.cls.attack;
    this.attackCd = this.cls.cd;
    this.swingT = 0;
    this.whirling = !!this.ab.whirl && (at === 'slash' || at === 'cleave');
    const ranged = at === 'arrow' || at === 'bolt';
    let best = this.nearestEnemy(ranged ? this.cls.range + 1 : 3.6, ranged);
    if (!best) for (const b of w.breakables) { if (!b.broken) { const d = Math.hypot(b.x - this.x, b.z - this.z); if (d < (ranged ? 6 : 2.2)) { best = b; break; } } }
    if (best) this.face = Math.atan2(best.x - this.x, best.z - this.z);
    this.aimTarget = best && best.hurt && best.y !== undefined ? best : null;
    if (at === 'arrow') {
      const n = this.ab.whirl ? 3 : 1;
      for (let k = 0; k < n; k++) this.shootArrow(this.face + (k - (n - 1) / 2) * 0.22);
      w.audio.play('bow');
    } else if (at === 'bolt') {
      this.shootBolt(best && best.hurt ? best : null);
      if (this.ab.whirl) { this.shootBolt(null, this.face + 0.5); this.shootBolt(null, this.face - 0.5); }
      w.audio.play('bolt');
    } else {
      this.slash.geometry = this.whirling ? this.whirlGeo : this.slashGeo;
      this.slash.rotation.y = this.face;
      w.audio.play(at === 'cleave' ? 'cleave' : 'slash');
    }
    const bl = this.ab.blade || 0;
    for (let k = 0; k < bl; k++) {
      const a = this.face + (bl === 1 ? 0 : (k - 0.5) * 0.35);
      const b = new Builder();
      b.add(Geo.torus(0.12), 0xdfeeff, 0, 0, 0, 0.8, 0.8, 0.3, Math.PI / 2, 0, 0);
      const mesh = new THREE.Group();
      mesh.add(b.mesh(false, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
      w.addProjectile({ mesh, x: this.x + Math.sin(a) * 0.6, y: 0.9, z: this.z + Math.cos(a) * 0.6, vx: Math.sin(a) * 13, vz: Math.cos(a) * 13, team: 'player', life: 0.55, radius: 0.5, pierce: true, spin: 25, hitSolid: false,
        onHitEnemy: (p, e) => this.hitEnemy(e, this.dmgNow * 0.6, p.x, p.z, false) });
    }
  }
  shootArrow(a) {
    const w = this.world;
    const mesh = makeArrow();
    mesh.scale.setScalar(1.3);
    const g = new THREE.Group(); g.add(mesh); g.rotation.y = a;
    const gl = glowSprite(0xffe8b0, 0.7, 0.6); gl.position.z = 0.3; g.add(gl);
    w.addProjectile({ mesh: g, x: this.x + Math.sin(a) * 0.7, y: 1.0, z: this.z + Math.cos(a) * 0.7, vx: Math.sin(a) * 19, vz: Math.cos(a) * 19, team: 'player', life: 0.65, radius: 0.5, target: this.aimTarget,
      onHitEnemy: (p, e) => this.hitEnemy(e, this.dmgNow, p.x - p.vx * 0.05, p.z - p.vz * 0.05, true, Math.random() < 0.12) });
  }
  shootBolt(target, ang) {
    const w = this.world;
    this.rig.tip.getWorldPosition(_v);
    const a = ang !== undefined ? ang : this.face;
    const col = this.rig.orb ? this.rig.orb.material.color.getHex() : 0x9fe8ff;
    const g = new THREE.Group();
    const core = new THREE.Mesh(Geo.sph(8, 6), matGlow(0xffffff)); core.scale.setScalar(0.18);
    g.add(core, glowSprite(col, 1.4, 0.95));
    const sp = 11;
    const self = this;
    w.addProjectile({ mesh: g, x: _v.x, y: Math.min(_v.y, this.y + 1.6), z: _v.z, absY: true, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, team: 'player', life: 1.2, radius: 0.55,
      update: (p, dt) => {
        if (target && !target.dead) {
          const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz) || 1;
          p.vx += (dx / d * sp - p.vx) * Math.min(1, dt * 6); p.vz += (dz / d * sp - p.vz) * Math.min(1, dt * 6);
        }
        const ty = (target && !target.dead && target.y !== undefined ? target.y : self.y) + 1.0;
        p.y += (ty - p.y) * Math.min(1, dt * 4);
        if (Math.random() < 0.8) w.fx.bright.spawn({ x: p.x, y: p.y, z: p.z, life: 0.3, size: 0.14, color: col, spin: 0 });
      },
      onHitEnemy: (p, e) => {
        self.hitEnemy(e, self.dmgNow, p.x, p.z, true, Math.random() < 0.1);
        for (const o of w.enemiesInRadius(p.x, p.z, 1.4)) if (o !== e) o.hurt(self.dmgNow * 0.5, p.x, p.z, { knock: 3 });
      },
      onDie: (p) => { w.fx.flash(p.x, p.y, p.z, 1.4, col, 0.2); w.fx.sparks(p.x, p.y, p.z, 6, col, 3); },
    });
  }
  resolveAttack() {
    const w = this.world;
    const cleave = this.cls.attack === 'cleave';
    const reach = this.whirling ? 2.6 : cleave ? 2.7 : 2.2;
    const half = cleave ? 1.8 : 1.25;
    let any = false;
    for (const e of w.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      if (e.y !== undefined && Math.abs(e.y - this.y) > 1.2 && !e.flying) continue;
      const d = Math.hypot(e.x - this.x, e.z - this.z);
      if (d > reach + e.radius) continue;
      if (!this.whirling) {
        const a = Math.atan2(e.x - this.x, e.z - this.z);
        const da = Math.abs(((a - this.face + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
        if (da > half && d > e.radius + 0.5) continue;
      }
      const crit = Math.random() < 0.1;
      this.hitEnemy(e, this.dmgNow * (crit ? 1.6 : 1), this.x, this.z, true, crit);
      any = true;
    }
    for (const b of w.breakables) {
      if (b.broken) continue;
      const d = Math.hypot(b.x - this.x, b.z - this.z);
      if (d > reach - 0.2) continue;
      const a = Math.atan2(b.x - this.x, b.z - this.z);
      const da = Math.abs(((a - this.face + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      if (this.whirling || da < half + 0.1) b.smash();
    }
    if (w.crackedWalls) for (const cw of w.crackedWalls) if (!cw.broken && Math.hypot(cw.x - this.x, cw.z - this.z) < reach + 0.8) cw.hit();
    if (any) { w.fx.shake = Math.max(w.fx.shake, cleave ? 0.15 : 0.08); w.hitStop = cleave ? 0.07 : 0.05; }
  }
  hitEnemy(e, dmg, fx, fz, primary, crit) {
    const a = this.ab;
    const opts = { crit, knock: primary ? (this.cls.attack === 'cleave' ? 10 : 7) : 4 };
    if (a.fire) opts.burn = 4 * a.fire;
    if (a.frost) opts.slow = 0.3 + 0.15 * a.frost;
    e.hurt(dmg, fx, fz, opts);
    if (a.frost && !e.dead) this.world.fx.sparks(e.x, 1, e.z, 3, 0xbff4ff, 2);
    if (primary && a.thunder) {
      this.hitCounter++;
      if (this.hitCounter % 3 === 0) this.chainLightning(e, 2 + a.thunder);
    }
  }
  chainLightning(src, n) {
    const w = this.world;
    const hit = new Set([src]);
    let cur = src;
    w.audio.play('thunder');
    for (let k = 0; k < n; k++) {
      let best = null, bd = 6;
      for (const e of w.enemies) {
        if (e.dead || hit.has(e)) continue;
        const d = Math.hypot(e.x - cur.x, e.z - cur.z);
        if (d < bd) { bd = d; best = e; }
      }
      this.boltFx(cur.x, cur.z, best ? best.x : cur.x, best ? best.z : cur.z);
      if (!best) break;
      hit.add(best);
      best.hurt(this.dmgNow * 0.7, cur.x, cur.z, { knock: 2 });
      cur = best;
    }
  }
  boltFx(x0, z0, x1, z1) {
    const w = this.world;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      w.fx.bright.spawn({ x: x0 + (x1 - x0) * t + (Math.random() - 0.5) * 0.4, y: 1 + (Math.random() - 0.5) * 0.5, z: z0 + (z1 - z0) * t + (Math.random() - 0.5) * 0.4, life: 0.25, size: 0.22, color: 0xbfe8ff, spin: 0 });
    }
    w.fx.flash(x1, 1, z1, 1.5, 0x9fd8ff, 0.2);
  }
  startDash(mx, mz, moving) {
    const w = this.world;
    this.dashCd = this.dashCdMax;
    this.dashT = this.ab.phase ? 0.24 : 0.2;
    this.dashDir = moving ? [mx / Math.hypot(mx, mz), mz / Math.hypot(mx, mz)] : [Math.sin(this.face), Math.cos(this.face)];
    this.face = Math.atan2(this.dashDir[0], this.dashDir[1]);
    this.invuln = Math.max(this.invuln, this.dashT + 0.08);
    this.dashHits = new Set();
    w.audio.play('whoosh');
    w.fx.dust(this.x, 0.1, this.z, 5, 0x8a8078);
  }
  get dashing() { return this.dashT > 0; }
  cast(id) {
    const w = this.world;
    const lv = this.ab[id];
    if (!lv || this.skillCd[id] > 0) return;
    if (id === 'fireball') {
      this.skillCd[id] = lv === 1 ? 6 : 4;
      const best = this.nearestEnemy(12, true);
      const a = best ? Math.atan2(best.x - this.x, best.z - this.z) : this.face;
      this.face = a;
      const mesh = makeFireball();
      const radius = lv === 1 ? 2.3 : 3;
      const dmg = this.dmgNow * (2.2 + lv * 0.8);
      const explode = (p) => {
        w.fx.explosion(p.x, 0.8, p.z, lv === 1 ? 0.9 : 1.2);
        w.audio.play('boom');
        for (const e of w.enemiesInRadius(p.x, p.z, radius)) e.hurt(dmg, p.x, p.z, { burn: 6, knock: 9 });
        for (const b of w.breakables) if (!b.broken && Math.hypot(b.x - p.x, b.z - p.z) < radius) b.smash();
      };
      w.addProjectile({ mesh, x: this.x + Math.sin(a) * 0.8, y: 1.0, z: this.z + Math.cos(a) * 0.8, vx: Math.sin(a) * 12, vz: Math.cos(a) * 12, team: 'player', life: 1.6, radius: 0.6,
        update: (p) => { if (Math.random() < 0.8) w.fx.fire(p.x, p.y, p.z, 1, 0.6, 0xffd040, 0xff3a10, 0.3); },
        onHitEnemy: () => {}, onDie: explode });
      w.audio.play('fireball');
    } else if (id === 'nova') {
      this.skillCd[id] = 9;
      w.fx.shockwave(this.x, this.z, 5.5, 0x9fe8ff, 0.2, 0.6);
      w.fx.flash(this.x, 1, this.z, 5, 0xbff4ff, 0.35);
      for (let k = 0; k < 30; k++) { const a = Math.random() * Math.PI * 2; w.fx.bright.spawn({ x: this.x, y: 0.6, z: this.z, vx: Math.cos(a) * 10, vy: 1, vz: Math.sin(a) * 10, life: 0.5, size: 0.2, color: 0xdff8ff, drag: 3 }); }
      for (const e of w.enemiesInRadius(this.x, this.z, 5.5)) e.hurt(this.dmgNow * 1.2, this.x, this.z, { freeze: 2 + lv, knock: 3 });
      w.audio.play('nova');
    }
    w.game.hud.dirty = true;
  }
  hurt(n, sx, sz, src) {
    const w = this.world;
    if (!this.alive || this.invuln > 0) return;
    if (src === 'trap' && this.ab.trapsense) {
      if (this.ab.trapsense >= 2 || Math.random() < 0.5) { this.invuln = 0.4; w.fx.sparks(this.x, this.y + 0.5, this.z, 6, 0x3ae07a, 2); return; }
    }
    if (this.shieldReady) {
      this.shieldReady = false;
      this.shieldT = 0;
      this.invuln = 0.8;
      w.audio.play('shield');
      w.fx.shockwave(this.x, this.z, 2, 0x6ab8ff, this.y + 0.8, 0.4);
      w.fx.sparks(this.x, this.y + 1, this.z, 20, 0x9fd8ff, 5);
      w.game.hud.dirty = true;
      return;
    }
    this.run.hp -= n;
    this.invuln = 1.0;
    const d = Math.hypot(this.x - sx, this.z - sz) || 1;
    const kb = src === 'trap' ? 5 : 9; this.vx = (this.x - sx) / d * kb; this.vz = (this.z - sz) / d * kb;
    w.audio.play('hurt');
    w.fx.sparks(this.x, this.y + 1, this.z, 12, 0xff4a3a, 4);
    w.fx.shake = Math.max(w.fx.shake, 0.3);
    this.hurtFlash = 1;
    w.game.hud.dirty = true;
    w.platformVibrate && w.platformVibrate();
    if (this.run.hp <= 0) {
      this.run.hp = 0;
      this.alive = false;
      this.deathT = 0;
      w.onPlayerDeath && w.onPlayerDeath();
    }
  }
  heal(n) {
    const run = this.run;
    const before = run.hp;
    run.hp = Math.min(run.maxHp, run.hp + n);
    if (run.hp > before) {
      this.world.fx.heal(this.x, this.y + 0.8, this.z, 10);
      this.world.fx.text(this.x, this.y + 2.4, this.z, '+' + ((run.hp - before) / 2) + ' 生命', '#ff6a7a', 0.6);
    }
    this.world.game.hud.dirty = true;
  }
}

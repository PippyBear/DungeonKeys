// 地牢密钥 - 入口：渲染器、主循环、多点触控输入、场景切换
import * as THREE from 'three';
import { skinAll, clearRigs } from './bearmesh.js';
import { platform } from './platform.js';
import { SaveData } from './save.js';
import { HUD } from './ui.js';
import { Audio } from './audio.js';
import { TitleScene } from './scenes/title.js';
import { FloorScene } from './scenes/floor.js';
import { SelectScene } from './scenes/select.js';
import { CLASSES, animateBear, setBearQuality } from './heroes.js';
import * as CREATURES from './creatures.js';
import { ABILITY_IDS, ABILITIES } from './abilities.js';
import { clamp } from './utils.js';

THREE.ColorManagement.enabled = false;

class Game {
  constructor() {
    this.save = new SaveData();
    const canvas = platform.canvas;
    const gl = platform.getGL();
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.applyQuality();
    this.renderer.setSize(platform.width, platform.height, false);
    this.hud = new HUD();
    this.audio = new Audio(this.save.data.settings);
    this.audioStarted = false;
    this.keys = {};
    this.fade = 1;
    this.fadeDir = -1;
    this.pending = null;
    this.hudTimer = 0;
    this.last = Date.now();
    this.setupInput();
    platform.onResize(() => this.onResize());
    platform.onHide(() => { this.save.save(); this.audio.suspend(); if (platform.isWx && this.scene && this.scene.overlay === null && this.scene.togglePause) this.scene.togglePause(); });
    platform.onShow(() => { this.audio.resume(); this.last = Date.now(); });
    this.scene = new TitleScene(this);
    this.loop = this.loop.bind(this);
    platform.raf(this.loop);
  }
  applyQuality() {
    const q = this.save.data.settings.quality;
    setBearQuality(q);
    CREATURES.setCreatureQuality(q);
    this.renderer.setPixelRatio(q === 'low' ? Math.min(1, platform.dpr) : q === 'mid' ? Math.min(1.5, platform.dpr) : platform.dpr);
    this.renderer.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.hud) this.renderer.setSize(platform.width, platform.height, false);
  }

  // ---------------------------------------------------------- 流程
  switchTo(factory) {
    if (this.pending) return;
    this.pending = factory;
    this.fadeDir = 1;
    this.hud.cancelAll();
  }
  goTitle() { this.switchTo(() => new TitleScene(this)); }
  goSelect() { this.switchTo(() => new SelectScene(this)); this.audio.play('open'); }
  newRun(heroCfg) {
    const s = this.save.data;
    const hero = Object.assign({}, heroCfg || s.hero);
    const cls = CLASSES[hero.cls] || CLASSES.knight;
    const maxHp = cls.hp + 2 * (s.meta.hp || 0);
    const run = { floor: 1, hp: maxHp, maxHp, abilities: Object.assign({}, cls.start), coins: 0, crystals: 0, kills: 0, keys: 0, seed: (Math.random() * 1e9) >>> 0, time: 0, hero };
    if (s.meta.talent) {
      const pool = ABILITY_IDS.filter((id) => !ABILITIES[id].active && id !== 'heart' && !run.abilities[id]);
      run.abilities[pool[Math.floor(Math.random() * pool.length)]] = 1;
    }
    s.stats.runs++;
    s.run = null;
    this.save.save();
    this.audio.play('open');
    this.switchTo(() => new FloorScene(this, run));
  }
  continueRun() {
    const r = this.save.data.run;
    if (!r) return this.newRun();
    const run = Object.assign({ keys: 0 }, r, { abilities: Object.assign({}, r.abilities) });
    this.audio.play('open');
    this.switchTo(() => new FloorScene(this, run));
  }
  nextFloor(run) { this.switchTo(() => new FloorScene(this, run)); }

  // ---------------------------------------------------------- 输入（多点触控：摇杆 + 按钮同时操作）
  setupInput() {
    const roles = new Map();
    let pinch = null;
    platform.onTouch({
      start: (changed, all) => {
        if (!this.audioStarted) { this.audio.init(); this.audioStarted = true; if (this.scene instanceof TitleScene) { this.audio.track = null; this.audio.playMusic('title'); } this.hud.dirty = true; }
        for (const t of changed) {
          if (this.pending || this.fade > 0.5) { roles.set(t.id, { r: 'none' }); continue; }
          if (this.hud.press(t.id, t.x, t.y)) { roles.set(t.id, { r: 'ui' }); continue; }
          if (this.scene.wantsStick && t.x < this.hud.w * 0.5) { this.scene.stickStart(t.id, t.x, t.y); roles.set(t.id, { r: 'stick' }); continue; }
          roles.set(t.id, { r: 'tap', x: t.x, y: t.y });
        }
        const taps = all.filter((t) => roles.get(t.id) && roles.get(t.id).r === 'tap');
        if (taps.length === 2) pinch = Math.hypot(taps[0].x - taps[1].x, taps[0].y - taps[1].y);
      },
      move: (changed, all) => {
        for (const t of changed) {
          const r = roles.get(t.id);
          if (r && r.r === 'stick') this.scene.stickMove(t.id, t.x, t.y);
        }
        const taps = all.filter((t) => roles.get(t.id) && roles.get(t.id).r === 'tap');
        if (taps.length === 2 && pinch) {
          const d = Math.hypot(taps[0].x - taps[1].x, taps[0].y - taps[1].y);
          if (this.scene.onPinch) this.scene.onPinch(d / pinch);
          pinch = d;
        }
      },
      end: (changed) => {
        for (const t of changed) {
          const r = roles.get(t.id);
          roles.delete(t.id);
          if (!r) continue;
          if (r.r === 'ui') this.hud.release(t.id, t.x, t.y);
          else if (r.r === 'stick') this.scene.stickEnd(t.id);
          else if (r.r === 'tap' && Math.hypot(t.x - r.x, t.y - r.y) < 14 && this.scene.onTap) this.scene.onTap(t.x, t.y);
        }
        if (roles.size < 2) pinch = null;
      },
      wheel: (dy) => { if (this.scene.onPinch) this.scene.onPinch(dy > 0 ? 0.92 : 1.08); },
    });
    platform.onKey((code) => {
      if (!this.audioStarted) { this.audio.init(); this.audioStarted = true; if (this.scene instanceof TitleScene) { this.audio.track = null; this.audio.playMusic('title'); } }
      this.keys[code] = true;
    }, (code) => { if (code === '*') this.keys = {}; else delete this.keys[code]; });
  }

  onResize() {
    this.applyQuality();
    this.renderer.setSize(platform.width, platform.height, false);
    this.hud.resize();
    if (this.scene && this.scene.onResize) this.scene.onResize();
  }

  // ---------------------------------------------------------- 主循环
  loop() {
    platform.raf(this.loop);
    const now = Date.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = clamp(dt, 0.001, 0.05);
    if (this.fadeDir !== 0) {
      this.fade = clamp(this.fade + this.fadeDir * dt * 2.8, 0, 1);
      this.hud.dirty = true;
      if (this.fadeDir > 0 && this.fade >= 1 && this.pending) {
        const f = this.pending;
        if (this.scene) this.scene.dispose();
        this.scene = null;
        clearRigs();
        try { this.scene = f(); } catch (e) { console.error(e); this.scene = new TitleScene(this); }
        this.pending = null;
        this.fadeDir = -1;
        this.last = Date.now();
        return;
      } else if (this.fadeDir < 0 && this.fade <= 0) this.fadeDir = 0;
    }
    const sc = this.scene;
    sc.update(dt);
    const hud = this.hud;
    this.hudTimer += dt;
    if (hud.dirty || this.hudTimer >= (sc.hudInterval || 0.1) || hud.toasts.length) {
      this.hudTimer = 0;
      hud.dirty = false;
      hud.begin();
      sc.drawHUD(hud);
      hud.drawToasts(dt);
      if (this.fade > 0) {
        hud.ctx.fillStyle = 'rgba(0,0,0,' + this.fade + ')';
        hud.ctx.fillRect(0, 0, hud.w, hud.h);
      }
      hud.end();
    }
    const r = this.renderer;
    if (sc.camera) { sc.camera.updateMatrixWorld(); sc.camera.matrixWorldInverse.copy(sc.camera.matrixWorld).invert(); }
    skinAll(sc.camera);
    r.autoClear = true;
    r.render(sc.s3, sc.camera);
    r.autoClear = false;
    r.clearDepth();
    r.render(hud.scene, hud.camera);
    if (hud.overlay.children.length && this.fade < 0.5) r.render(hud.overlay, hud.overlayCam);
    r.autoClear = true;
  }
}

const game = new Game();
if (typeof window !== 'undefined') { window.__game = game; window.__anim = animateBear; window.__mk = CREATURES; }

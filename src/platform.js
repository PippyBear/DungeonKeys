// 平台抽象层：同一套代码既能跑在微信小游戏，也能跑在浏览器（用于本地预览调试）
const isWx = typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';

function makeBrowser() {
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  document.body.appendChild(canvas);
  // 读取 CSS 安全区（刘海 / 底部横条），需要 viewport-fit=cover 才有值
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
    + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
  document.body.appendChild(probe);
  // 游戏是横屏布局：手机竖着拿时把画布旋转 90°，逻辑尺寸按横屏计算
  const touchDevice = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const view = { w: 0, h: 0, rotated: false, safe: { left: 0, right: 0, top: 0, bottom: 0 } };
  const measure = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const cs = getComputedStyle(probe);
    const inset = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    view.rotated = touchDevice && vh > vw;
    if (view.rotated) {
      // 顺时针旋转 90°：逻辑左 = 屏幕上，逻辑右 = 屏幕下，逻辑上 = 屏幕右，逻辑下 = 屏幕左
      view.w = vh; view.h = vw;
      view.safe = { left: inset.top, right: inset.bottom, top: inset.right, bottom: inset.left };
      canvas.style.width = vh + 'px';
      canvas.style.height = vw + 'px';
      canvas.style.transform = 'translateX(' + vw + 'px) rotate(90deg)';
    } else {
      view.w = vw; view.h = vh;
      view.safe = inset;
      canvas.style.width = vw + 'px';
      canvas.style.height = vh + 'px';
      canvas.style.transform = '';
    }
  };
  measure();
  // 屏幕坐标 → 逻辑坐标
  const toLocal = (e) => (view.rotated ? { x: e.clientY, y: window.innerWidth - e.clientX } : { x: e.clientX, y: e.clientY });
  const p = {
    isWx: false,
    canvas,
    get width() { return view.w; },
    get height() { return view.h; },
    get dpr() { return Math.min(window.devicePixelRatio || 1, 2); },
    get safe() { return view.safe; },
    getGL() {
      const attrs = { antialias: true, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' };
      return canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
    },
    createCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    },
    onTouch(h) {
      const touches = new Map();
      const list = () => Array.from(touches.values());
      const pt = (e) => { const l = toLocal(e); return { id: e.pointerId, x: l.x, y: l.y }; };
      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
        const t = pt(e);
        touches.set(e.pointerId, t);
        h.start([t], list());
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!touches.has(e.pointerId)) return;
        const t = pt(e);
        touches.set(e.pointerId, t);
        h.move([t], list());
      });
      const up = (e) => {
        if (!touches.has(e.pointerId)) return;
        touches.delete(e.pointerId);
        h.end([pt(e)], list());
      };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('wheel', (e) => { e.preventDefault(); const l = toLocal(e); h.wheel && h.wheel(e.deltaY, l.x, l.y); }, { passive: false });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      // iOS Safari 会无视 user-scalable=no，双指缩放 / 双击放大需手动拦截
      document.addEventListener('gesturestart', (e) => e.preventDefault());
      document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
      let lastEnd = 0;
      document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastEnd < 350) e.preventDefault(); lastEnd = now; }, { passive: false });
    },
    onKey(down, up) {
      window.addEventListener('keydown', (e) => { if (!e.repeat) down(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); });
      window.addEventListener('keyup', (e) => up(e.code));
      window.addEventListener('blur', () => up('*'));
    },
    onResize(cb) {
      // 旋转屏幕 / 地址栏收起时各浏览器触发的事件不同，且 iOS 旋转后尺寸会延迟更新，统一合并并补一次延迟检测
      let key = '', timer = 0;
      const check = () => {
        measure();
        const k = view.w + 'x' + view.h + (view.rotated ? 'r' : '') + JSON.stringify(view.safe);
        if (k !== key) { key = k; cb(); }
      };
      key = view.w + 'x' + view.h + (view.rotated ? 'r' : '') + JSON.stringify(view.safe);
      const schedule = () => { check(); clearTimeout(timer); timer = setTimeout(check, 300); };
      window.addEventListener('resize', schedule);
      window.addEventListener('orientationchange', schedule);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule);
    },
    onHide(cb) { document.addEventListener('visibilitychange', () => { if (document.hidden) cb(); }); window.addEventListener('beforeunload', cb); },
    onShow(cb) { document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); }); },
    getItem(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    setItem(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    removeItem(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    createAudioContext() {
      const AC = window.AudioContext || window.webkitAudioContext;
      return AC ? new AC() : null;
    },
    vibrate() { if (navigator.vibrate) navigator.vibrate(15); },
    raf: (fn) => window.requestAnimationFrame(fn),
  };
  return p;
}

function wxWindowInfo() {
  try { if (wx.getWindowInfo) return wx.getWindowInfo(); } catch (e) { /* ignore */ }
  return wx.getSystemInfoSync();
}

function makeWx() {
  const info = wxWindowInfo();
  const canvas = GameGlobal.__mainCanvas || wx.createCanvas();
  const sa = info.safeArea;
  const safe = sa ? {
    left: Math.max(0, sa.left),
    right: Math.max(0, info.windowWidth - sa.right),
    top: Math.max(0, sa.top),
    bottom: Math.max(0, info.windowHeight - sa.bottom),
  } : { left: 0, right: 0, top: 0, bottom: 0 };
  // 横屏时刘海通常在左/右侧，上下的安全区不需要
  if (info.windowWidth > info.windowHeight) { safe.top = 0; safe.bottom = Math.min(safe.bottom, 12); }
  const conv1 = (t) => ({ id: t.identifier, x: t.clientX, y: t.clientY });
  const conv = { list: (arr) => Array.prototype.map.call(arr || [], conv1) };
  const p = {
    isWx: true,
    canvas,
    width: info.windowWidth,
    height: info.windowHeight,
    dpr: Math.min(info.pixelRatio || 1, 1.75),
    safe,
    getGL() {
      return canvas.getContext('webgl', { antialias: true, alpha: false, depth: true, stencil: false, preserveDrawingBuffer: false, antialiasSamples: 4 });
    },
    createCanvas(w, h) {
      const c = wx.createCanvas();
      c.width = w; c.height = h;
      return GameGlobal.__patchCanvas ? GameGlobal.__patchCanvas(c) : c;
    },
    onTouch(h) {
      wx.onTouchStart((e) => h.start(conv.list(e.changedTouches), conv.list(e.touches)));
      wx.onTouchMove((e) => h.move(conv.list(e.changedTouches), conv.list(e.touches)));
      wx.onTouchEnd((e) => h.end(conv.list(e.changedTouches), conv.list(e.touches)));
      wx.onTouchCancel((e) => h.end(conv.list(e.changedTouches), conv.list(e.touches)));
    },
    onKey() { /* 小游戏无键盘 */ },
    onResize(cb) {
      if (wx.onWindowResize) wx.onWindowResize((r) => { p.width = r.windowWidth; p.height = r.windowHeight; cb(); });
    },
    onHide(cb) { wx.onHide(cb); },
    onShow(cb) { wx.onShow(cb); },
    getItem(k) { try { const v = wx.getStorageSync(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    setItem(k, v) { try { wx.setStorageSync(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    removeItem(k) { try { wx.removeStorageSync(k); } catch (e) { /* ignore */ } },
    createAudioContext() {
      try { return wx.createWebAudioContext ? wx.createWebAudioContext() : null; } catch (e) { return null; }
    },
    vibrate() { try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* ignore */ } },
    raf: (fn) => requestAnimationFrame(fn),
  };
  try {
    wx.showShareMenu && wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] });
    wx.onShareAppMessage && wx.onShareAppMessage(() => ({ title: '地牢密钥：你能闯到第几层？' }));
  } catch (e) { /* ignore */ }
  return p;
}

export const platform = isWx ? makeWx() : makeBrowser();

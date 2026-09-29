/* 微信小游戏最小适配层：为 three.js 提供 window/document/navigator 等浏览器对象 */
(function () {
  var g = GameGlobal;
  var noop = function () {};
  function patchCanvas(c) {
    if (!c.style) c.style = { width: c.width + 'px', height: c.height + 'px' };
    if (!c.addEventListener) c.addEventListener = noop;
    if (!c.removeEventListener) c.removeEventListener = noop;
    if (!c.getBoundingClientRect) {
      c.getBoundingClientRect = function () {
        var info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
        return { left: 0, top: 0, x: 0, y: 0, width: info.windowWidth, height: info.windowHeight };
      };
    }
    return c;
  }
  // 第一个 createCanvas 创建的是上屏画布
  var mainCanvas = patchCanvas(wx.createCanvas());
  g.__mainCanvas = mainCanvas;
  g.__patchCanvas = patchCanvas;

  var info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
  var doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    documentElement: { style: {} },
    body: { appendChild: noop, removeChild: noop, style: {} },
    head: { appendChild: noop },
    createElement: function (name) {
      name = String(name).toLowerCase();
      if (name === 'canvas') return patchCanvas(wx.createCanvas());
      if (name === 'img' || name === 'image') return wx.createImage();
      return { style: {}, appendChild: noop, addEventListener: noop, removeEventListener: noop };
    },
    createElementNS: function (ns, name) { return this.createElement(name); },
    getElementById: function () { return null; },
    addEventListener: noop,
    removeEventListener: noop
  };
  if (typeof g.document === 'undefined') g.document = doc;
  if (typeof g.window === 'undefined') g.window = g;
  if (typeof g.self === 'undefined') g.self = g;
  if (typeof g.navigator === 'undefined') g.navigator = { userAgent: 'wechatgame', language: 'zh-CN', platform: info.platform };
  g.innerWidth = info.windowWidth;
  g.innerHeight = info.windowHeight;
  g.devicePixelRatio = info.pixelRatio;
  if (!g.addEventListener) g.addEventListener = noop;
  if (!g.removeEventListener) g.removeEventListener = noop;
  if (typeof g.HTMLCanvasElement === 'undefined') g.HTMLCanvasElement = function () {};
  if (typeof g.HTMLImageElement === 'undefined') g.HTMLImageElement = function () {};
  if (typeof g.HTMLVideoElement === 'undefined') g.HTMLVideoElement = function () {};
})();

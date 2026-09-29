// 2D HUD：离屏 Canvas 纹理叠加在 3D 画面上（小游戏只有一个上屏 Canvas）
// 支持多点触控：按钮可在按下瞬间触发（down）或抬起时触发（tap）
import * as THREE from 'three';
import { platform } from './platform.js';

const FONT = '"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';
export const C = {
  panel: 'rgba(24,20,32,0.94)', panelLight: '#2e2838', border: '#c9a45a', borderDark: '#6e5528',
  text: '#f3e6c8', textDim: '#a89a80', gold: '#ffcf4a', goldD: '#a8781a', red: '#d8443a', redD: '#7a1e18',
  blue: '#3a8ad8', blueD: '#1c4a80', green: '#4cb84a', greenD: '#236a22', purple: '#9a5ad8', purpleD: '#4e2a80',
  gray: '#6a6670', grayD: '#3a3840', stone: '#4a4452', stoneD: '#26222c',
};

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function ellipsePath(ctx, x, y, rx, ry) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.restore();
}
function circle(ctx, x, y, r, fill, stroke, lw = 2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function star(ctx, n, r1, r2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2; const r = i % 2 ? r2 : r1; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath();
}
function heartPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.bezierCurveTo(-18, 0, -12, -16, 0, -6);
  ctx.bezierCurveTo(12, -16, 18, 0, 0, 12);
  ctx.closePath();
}

// ------------------------------------------------------------------ 矢量图标（以 32 为基准尺寸）
export function drawIcon(ctx, name, x, y, s, extra) {
  ctx.save();
  ctx.translate(x, y);
  const k = s / 32;
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const O = '#140e08';
  switch (name) {
    case 'heart': case 'heartHalf': case 'heartEmpty': {
      heartPath(ctx);
      ctx.fillStyle = '#3a1418'; ctx.fill();
      if (name !== 'heartEmpty') {
        ctx.save();
        if (name === 'heartHalf') { ctx.beginPath(); ctx.rect(-20, -20, 20, 40); ctx.clip(); }
        heartPath(ctx);
        ctx.fillStyle = '#e8303a'; ctx.fill();
        ctx.beginPath(); ellipsePath(ctx, -6, -4, 3.5, 2.5); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
        ctx.restore();
      }
      heartPath(ctx); ctx.strokeStyle = O; ctx.lineWidth = 2.5; ctx.stroke();
      break;
    }
    case 'key': {
      ctx.rotate(-0.6);
      circle(ctx, -8, 0, 7, '#ffcf4a', O, 2.5);
      circle(ctx, -8, 0, 3, '#6a4a10');
      roundRect(ctx, -2, -2.5, 18, 5, 2); ctx.fillStyle = '#ffcf4a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.fillStyle = '#ffcf4a'; ctx.fillRect(10, 2, 3, 5); ctx.fillRect(14, 2, 2.5, 4);
      ctx.strokeRect(10, 2, 3, 5);
      break;
    }
    case 'coin': {
      circle(ctx, 0, 0, 12, '#ffcf4a', O, 2.5);
      circle(ctx, 0, 0, 8, null, '#b88a1a', 2);
      ctx.fillStyle = '#b88a1a'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1);
      break;
    }
    case 'crystal': {
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(9, -3); ctx.lineTo(5, 13); ctx.lineTo(-5, 13); ctx.lineTo(-9, -3); ctx.closePath();
      ctx.fillStyle = '#b06aff'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, 13); ctx.moveTo(-9, -3); ctx.lineTo(9, -3); ctx.strokeStyle = '#6a2ab0'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -10); ctx.lineTo(-5, -3); ctx.lineTo(-2, -3); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      break;
    }
    case 'sword': case 'sharp': {
      ctx.rotate(-0.78);
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(4, -11); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.lineTo(-4, -11); ctx.closePath();
      ctx.fillStyle = name === 'sharp' ? '#ffffff' : '#dfe6ee'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(0, 4); ctx.strokeStyle = '#9aa6b2'; ctx.lineWidth = 1.2; ctx.stroke();
      roundRect(ctx, -9, 6, 18, 4, 2); ctx.fillStyle = '#ffcf4a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      roundRect(ctx, -2.5, 10, 5, 7, 2); ctx.fillStyle = '#6a3a1a'; ctx.fill(); ctx.stroke();
      if (name === 'sharp') { ctx.rotate(0.78); ctx.fillStyle = '#ffe98a'; star(ctx, 4, 7, 2); ctx.translate(10, -10); ctx.fill(); }
      break;
    }
    case 'dash': case 'boots': {
      if (name === 'boots') {
        ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(4, -12); ctx.lineTo(4, 4); ctx.lineTo(13, 6); ctx.lineTo(13, 12); ctx.lineTo(-6, 12); ctx.closePath();
        ctx.fillStyle = '#8a5a2a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(-16, -9); ctx.moveTo(-8, 0); ctx.lineTo(-16, 0); ctx.moveTo(-8, 6); ctx.lineTo(-16, 9); ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 2.5; ctx.stroke();
      } else {
        ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 3.5;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-14 + i * 3, -8 + i * 8); ctx.quadraticCurveTo(4, -12 + i * 8, 14, -4 + i * 8); ctx.stroke(); }
      }
      break;
    }
    case 'hand': {
      ctx.fillStyle = '#f3d3a8'; ctx.strokeStyle = O; ctx.lineWidth = 2;
      roundRect(ctx, -10, -2, 20, 15, 5); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) { roundRect(ctx, -10 + i * 5, -13 + (i === 0 || i === 3 ? 3 : 0), 4.6, 14, 2.3); ctx.fill(); ctx.stroke(); }
      break;
    }
    case 'skull': {
      circle(ctx, 0, -2, 12, '#efe8d8', O, 2.2);
      roundRect(ctx, -6, 6, 12, 7, 2); ctx.fillStyle = '#efe8d8'; ctx.fill(); ctx.stroke();
      circle(ctx, -4.5, -2, 3.3, '#1a1010'); circle(ctx, 4.5, -2, 3.3, '#1a1010');
      break;
    }
    case 'stairs': {
      ctx.fillStyle = '#8a8490'; ctx.strokeStyle = O; ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) { ctx.fillRect(-14 + i * 7, -10 + i * 6, 28 - i * 7, 6); ctx.strokeRect(-14 + i * 7, -10 + i * 6, 28 - i * 7, 6); }
      ctx.beginPath(); ctx.moveTo(-4, -16); ctx.lineTo(-4, -8); ctx.moveTo(-8, -12); ctx.lineTo(-4, -7); ctx.lineTo(0, -12); ctx.strokeStyle = '#7fd8ff'; ctx.lineWidth = 2.5; ctx.stroke();
      break;
    }
    case 'pause': {
      ctx.fillStyle = '#f3e6c8'; roundRect(ctx, -9, -11, 6, 22, 2); ctx.fill(); roundRect(ctx, 3, -11, 6, 22, 2); ctx.fill();
      break;
    }
    case 'play': {
      ctx.beginPath(); ctx.moveTo(-8, -12); ctx.lineTo(12, 0); ctx.lineTo(-8, 12); ctx.closePath(); ctx.fillStyle = '#f3e6c8'; ctx.fill();
      break;
    }
    case 'gear': {
      star(ctx, 8, 14, 10); ctx.fillStyle = '#b8b0c0'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      circle(ctx, 0, 0, 4.5, '#4a4452', O, 2);
      break;
    }
    case 'fire': case 'fireball': {
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.bezierCurveTo(10, -4, 12, 4, 8, 10); ctx.quadraticCurveTo(0, 16, -8, 10); ctx.bezierCurveTo(-12, 4, -8, -2, -4, -6); ctx.quadraticCurveTo(-2, 0, 0, -15);
      ctx.fillStyle = '#ff6a1a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -4); ctx.bezierCurveTo(6, 2, 5, 8, 0, 11); ctx.bezierCurveTo(-5, 8, -5, 3, 0, -4); ctx.fillStyle = '#ffe23a'; ctx.fill();
      if (name === 'fireball') { circle(ctx, 0, 5, 4, '#fff6c0'); }
      break;
    }
    case 'frost': case 'nova': {
      ctx.strokeStyle = name === 'nova' ? '#bff4ff' : '#7fd8ff'; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 14); ctx.moveTo(-4, -10); ctx.lineTo(0, -6); ctx.lineTo(4, -10); ctx.moveTo(-4, 10); ctx.lineTo(0, 6); ctx.lineTo(4, 10); ctx.stroke();
        ctx.restore();
      }
      if (name === 'nova') circle(ctx, 0, 0, 15, null, 'rgba(127,216,255,0.6)', 2);
      break;
    }
    case 'thunder': {
      ctx.beginPath(); ctx.moveTo(4, -15); ctx.lineTo(-9, 2); ctx.lineTo(-1, 2); ctx.lineTo(-5, 15); ctx.lineTo(10, -3); ctx.lineTo(2, -3); ctx.closePath();
      ctx.fillStyle = '#ffe23a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'vamp': {
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.bezierCurveTo(10, 0, 10, 12, 0, 12); ctx.bezierCurveTo(-10, 12, -10, 0, 0, -14); ctx.closePath();
      ctx.fillStyle = '#b01828'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ellipsePath(ctx, -3, 3, 2, 3); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      break;
    }
    case 'shield': {
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(12, -9); ctx.quadraticCurveTo(12, 8, 0, 14); ctx.quadraticCurveTo(-12, 8, -12, -9); ctx.closePath();
      ctx.fillStyle = '#3a8ad8'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, -6); ctx.quadraticCurveTo(7, 5, 0, 9); ctx.quadraticCurveTo(-7, 5, -7, -6); ctx.closePath(); ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'whirl': {
      ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 3;
      ctx.beginPath(); for (let a = 0; a < 12; a += 0.2) { const r = a * 1.2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
      break;
    }
    case 'blade': {
      ctx.rotate(0.5);
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(0, -12, 14, 0); ctx.quadraticCurveTo(0, -5, -14, 0);
      ctx.fillStyle = '#dfe6ee'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(-4, 6); ctx.moveTo(-12, 11); ctx.lineTo(0, 11); ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'trap': {
      ctx.fillStyle = '#6a6670'; ctx.fillRect(-14, 8, 28, 5);
      ctx.fillStyle = '#dfe6ee'; ctx.strokeStyle = O; ctx.lineWidth = 1.8;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-12 + i * 7, 8); ctx.lineTo(-9 + i * 7, -10); ctx.lineTo(-6 + i * 7, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      circle(ctx, 10, -10, 5, '#3ae07a', O, 1.5);
      break;
    }
    case 'compass': {
      circle(ctx, 0, 0, 13, '#e8d8b0', O, 2.4);
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(4, 0); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fillStyle = '#d8443a'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 11); ctx.lineTo(4, 0); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fillStyle = '#4a4452'; ctx.fill();
      circle(ctx, 0, 0, 2, '#ffcf4a');
      break;
    }
    case 'greed': {
      ctx.beginPath(); ctx.moveTo(-6, -10); ctx.lineTo(6, -10); ctx.lineTo(3, -5); ctx.quadraticCurveTo(14, 2, 10, 12); ctx.lineTo(-10, 12); ctx.quadraticCurveTo(-14, 2, -3, -5); ctx.closePath();
      ctx.fillStyle = '#8a6a3a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.2; ctx.stroke();
      circle(ctx, 0, 4, 5, '#ffcf4a', O, 1.5);
      break;
    }
    case 'burst': {
      star(ctx, 8, 14, 6); ctx.fillStyle = '#ff8a2a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      circle(ctx, 0, 0, 5, '#fff2a0');
      break;
    }
    case 'phase': {
      ctx.globalAlpha = 0.35; circle(ctx, -8, 0, 7, '#9a5ad8'); ctx.globalAlpha = 0.65; circle(ctx, -2, 0, 7, '#9a5ad8'); ctx.globalAlpha = 1; circle(ctx, 5, 0, 7, '#c89aff', O, 2);
      break;
    }
    case 'eye': {
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.quadraticCurveTo(0, -14, 15, 0); ctx.quadraticCurveTo(0, 14, -15, 0); ctx.closePath();
      ctx.fillStyle = '#efe8d8'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.2; ctx.stroke();
      circle(ctx, 0, 0, 6, '#3ab0e0', O, 1.5); circle(ctx, 0, 0, 2.5, '#101010');
      break;
    }
    case 'lock': {
      ctx.beginPath(); ctx.arc(0, -4, 7, Math.PI, 0); ctx.strokeStyle = '#b8b0c0'; ctx.lineWidth = 4; ctx.stroke();
      roundRect(ctx, -10, -4, 20, 16, 3); ctx.fillStyle = '#ffcf4a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      circle(ctx, 0, 3, 2.5, O);
      break;
    }
    case 'check': {
      ctx.beginPath(); ctx.moveTo(-11, 1); ctx.lineTo(-3, 9); ctx.lineTo(12, -8); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke();
      break;
    }
    case 'cross': {
      ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(9, 9); ctx.moveTo(9, -9); ctx.lineTo(-9, 9); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke();
      break;
    }
    case 'home': {
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(0, -13); ctx.lineTo(14, 0); ctx.closePath(); ctx.fillStyle = '#c9a45a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      roundRect(ctx, -10, 0, 20, 13, 2); ctx.fillStyle = '#6a6670'; ctx.fill(); ctx.stroke();
      break;
    }
    case 'music': {
      ctx.strokeStyle = '#f3e6c8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-4, 8); ctx.lineTo(-4, -10); ctx.lineTo(10, -13); ctx.lineTo(10, 5); ctx.stroke();
      circle(ctx, -7, 9, 4, '#f3e6c8'); circle(ctx, 7, 6, 4, '#f3e6c8');
      break;
    }
    case 'sound': {
      ctx.fillStyle = '#f3e6c8'; ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(-5, -5); ctx.lineTo(3, -12); ctx.lineTo(3, 12); ctx.lineTo(-5, 5); ctx.lineTo(-12, 5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f3e6c8'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(4, 0, 7, -0.8, 0.8); ctx.stroke(); ctx.beginPath(); ctx.arc(4, 0, 12, -0.8, 0.8); ctx.stroke();
      break;
    }
    case 'quality': {
      star(ctx, 4, 14, 4); ctx.fillStyle = '#ffe98a'; ctx.fill();
      break;
    }
    case 'star': {
      star(ctx, 5, 14, 6); ctx.fillStyle = '#ffcf4a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'potion': {
      roundRect(ctx, -4, -14, 8, 6, 1); ctx.fillStyle = '#8a6a3a'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(-4, -3); ctx.quadraticCurveTo(-12, 2, -10, 8); ctx.quadraticCurveTo(0, 16, 10, 8); ctx.quadraticCurveTo(12, 2, 4, -3); ctx.lineTo(4, -8); ctx.closePath();
      ctx.fillStyle = '#e8303a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'altar': {
      roundRect(ctx, -12, 2, 24, 10, 2); ctx.fillStyle = '#6a6670'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.bezierCurveTo(6, -6, 5, 0, 0, 2); ctx.bezierCurveTo(-5, 0, -6, -6, 0, -14); ctx.fillStyle = '#7fd8ff'; ctx.fill();
      break;
    }
    case 'bow': {
      ctx.beginPath(); ctx.arc(-4, 0, 14, -1.2, 1.2); ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1, -13); ctx.lineTo(1, 13); ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(14, 0); ctx.strokeStyle = '#dfe6ee'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(9, -4); ctx.lineTo(9, 4); ctx.closePath(); ctx.fillStyle = '#dfe6ee'; ctx.fill();
      break;
    }
    case 'staff': {
      ctx.rotate(0.5);
      roundRect(ctx, -2, -8, 4, 24, 2); ctx.fillStyle = '#6a4424'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 1.5; ctx.stroke();
      circle(ctx, 0, -11, 6, '#9fe8ff', O, 2); circle(ctx, -2, -13, 2, '#ffffff');
      break;
    }
    case 'axe': {
      ctx.rotate(-0.6);
      roundRect(ctx, -2, -12, 4, 28, 2); ctx.fillStyle = '#6a4424'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -12); ctx.quadraticCurveTo(16, -10, 14, 2); ctx.lineTo(2, -2); ctx.closePath(); ctx.fillStyle = '#c0c8d0'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -10); ctx.quadraticCurveTo(-10, -8, -9, -1); ctx.lineTo(-2, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'male': {
      circle(ctx, -3, 3, 8, null, '#7fc8ff', 3.5);
      ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(12, -12); ctx.moveTo(5, -12); ctx.lineTo(12, -12); ctx.lineTo(12, -5); ctx.strokeStyle = '#7fc8ff'; ctx.lineWidth = 3.5; ctx.stroke();
      break;
    }
    case 'female': {
      circle(ctx, 0, -4, 8, null, '#ffa0c8', 3.5);
      ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, 15); ctx.moveTo(-5, 10); ctx.lineTo(5, 10); ctx.strokeStyle = '#ffa0c8'; ctx.lineWidth = 3.5; ctx.stroke();
      break;
    }
    case 'jump': {
      // 向上的箭头 + 地面弧线
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(11, -2); ctx.lineTo(4.5, -2); ctx.lineTo(4.5, 7); ctx.lineTo(-4.5, 7); ctx.lineTo(-4.5, -2); ctx.lineTo(-11, -2); ctx.closePath();
      ctx.fillStyle = '#eaffef'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 13, 12, 3, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(20,40,20,0.55)'; ctx.fill();
      break;
    }
    case 'wings': {
      for (const sx of [-1, 1]) {
        ctx.save(); ctx.scale(sx, 1);
        ctx.beginPath(); ctx.moveTo(2, 4); ctx.quadraticCurveTo(6, -14, 17, -12); ctx.quadraticCurveTo(15, -6, 17, -4); ctx.quadraticCurveTo(13, 0, 15, 3); ctx.quadraticCurveTo(9, 6, 2, 4);
        ctx.fillStyle = '#eaf4ff'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5, 1); ctx.lineTo(13, -8); ctx.moveTo(6, 3); ctx.lineTo(13, -2); ctx.strokeStyle = '#9fc0e8'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath(); ctx.moveTo(-6, 8); ctx.lineTo(6, 8); ctx.lineTo(4, 15); ctx.lineTo(-4, 15); ctx.closePath(); ctx.fillStyle = '#8a5a2a'; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'left': case 'right': {
      if (name === 'right') ctx.scale(-1, 1);
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(8, -12); ctx.lineTo(8, 12); ctx.closePath(); ctx.fillStyle = '#f3e6c8'; ctx.fill();
      break;
    }
    default:
      circle(ctx, 0, 0, 12, '#888', O, 2);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ HUD 管理
export class HUD {
  constructor() {
    this.scale = Math.min(platform.dpr, platform.isWx ? 1.35 : 2);
    this.canvas = platform.createCanvas(4, 4);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }));
    this.scene.add(this.quad);
    // 像素坐标的叠加层（摇杆等高频变化元素用网格绘制，避免每帧上传整张纹理）
    this.overlay = new THREE.Scene();
    this.overlayCam = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
    this.regions = [];
    this.pressed = new Map();
    this.toasts = [];
    this.dirty = true;
    this.resize();
  }
  resize() {
    this.w = platform.width;
    this.h = platform.height;
    const cw = Math.round(this.w * this.scale), ch = Math.round(this.h * this.scale);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.texture.dispose();
    }
    this.overlayCam.left = 0; this.overlayCam.right = this.w; this.overlayCam.top = 0; this.overlayCam.bottom = this.h;
    this.overlayCam.updateProjectionMatrix();
    this.dirty = true;
  }
  begin() {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.regions = [];
  }
  end() { this.texture.needsUpdate = true; }
  font(size, bold = true) { return (bold ? 'bold ' : '') + Math.round(size) + 'px ' + FONT; }
  text(str, x, y, o = {}) {
    const ctx = this.ctx;
    const size = o.size || 16;
    ctx.font = this.font(size, o.bold !== false);
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'middle';
    let s = String(str);
    if (o.maxW) {
      while (s.length > 1 && ctx.measureText(s).width > o.maxW) s = s.slice(0, -1);
      if (s !== String(str)) s = s.slice(0, -1) + '…';
    }
    if (o.stroke !== false) {
      ctx.lineWidth = o.strokeW || Math.max(3, size / 5);
      ctx.strokeStyle = typeof o.stroke === 'string' ? o.stroke : 'rgba(8,4,12,0.9)';
      ctx.lineJoin = 'round';
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = o.color || C.text;
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
  }
  measure(str, size = 16) { this.ctx.font = this.font(size); return this.ctx.measureText(String(str)).width; }
  // 多行文字（自动换行，中文逐字）
  paragraph(str, x, y, maxW, o = {}) {
    const size = o.size || 14, lh = o.lh || size * 1.45;
    this.ctx.font = this.font(size, o.bold !== false);
    let line = '';
    let yy = y;
    for (const ch of String(str)) {
      const t = line + ch;
      if (this.ctx.measureText(t).width > maxW && line) { this.text(line, x, yy, o); line = ch; yy += lh; } else line = t;
    }
    if (line) { this.text(line, x, yy, o); yy += lh; }
    return yy;
  }
  panel(x, y, w, h, o = {}) {
    const ctx = this.ctx;
    const r = o.r === undefined ? 12 : o.r;
    if (o.shadow !== false) { roundRect(ctx, x + 2, y + 5, w, h, r); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill(); }
    roundRect(ctx, x, y, w, h, r);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, o.fill2 || '#2e2838');
    g.addColorStop(1, o.fill || '#1a1622');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = o.lw || 2.5;
    ctx.strokeStyle = o.stroke || C.border;
    ctx.stroke();
    roundRect(ctx, x + 4, y + 4, w - 8, h - 8, Math.max(2, r - 3));
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(201,164,90,0.35)';
    ctx.stroke();
    if (o.block !== false) this.block(x, y, w, h);
  }
  header(x, y, w, h, title, color = C.gold) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + h * 0.4, y); ctx.lineTo(x + w - h * 0.4, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w - h * 0.4, y + h); ctx.lineTo(x + h * 0.4, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#5a4a30'); g.addColorStop(1, '#2a2016');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.stroke();
    this.text(title, x + w / 2, y + h / 2 + 1, { size: h * 0.5, align: 'center', color });
  }
  button(id, x, y, w, h, o, onTap) {
    const ctx = this.ctx;
    const pressed = this.isPressed(id);
    const disabled = !!o.disabled;
    const col = disabled ? C.gray : (o.color || C.gold);
    const colD = disabled ? C.grayD : (o.colorD || C.goldD);
    const r = o.r === undefined ? Math.min(10, h / 3) : o.r;
    const depth = Math.max(3, Math.round(h * 0.08));
    const oy = pressed ? depth - 1 : 0;
    ctx.save();
    if (o.circle) {
      const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) / 2;
      circle(ctx, cx, cy + depth + 1, rr, 'rgba(0,0,0,0.45)');
      circle(ctx, cx, cy + depth, rr, colD);
      const g = ctx.createRadialGradient(cx - rr * 0.3, cy + oy - rr * 0.4, rr * 0.1, cx, cy + oy, rr);
      g.addColorStop(0, o.glow || lighten(col)); g.addColorStop(1, col);
      circle(ctx, cx, cy + oy, rr, g, o.ring || '#1a1208', 2.5);
      circle(ctx, cx, cy + oy, rr - 4, null, 'rgba(255,240,200,0.35)', 1.5);
      if (o.cd > 0) {
        ctx.beginPath(); ctx.moveTo(cx, cy + oy);
        ctx.arc(cx, cy + oy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o.cd);
        ctx.closePath(); ctx.fillStyle = 'rgba(10,6,16,0.62)'; ctx.fill();
      }
    } else {
      roundRect(ctx, x + 1, y + depth + 2, w, h, r); ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
      roundRect(ctx, x, y + depth, w, h - depth, r); ctx.fillStyle = colD; ctx.fill();
      roundRect(ctx, x, y + oy, w, h - depth, r);
      const g = ctx.createLinearGradient(0, y + oy, 0, y + oy + h - depth);
      g.addColorStop(0, lighten(col)); g.addColorStop(1, col);
      ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1a1208'; ctx.stroke();
    }
    ctx.restore();
    const cy = y + oy + (o.circle ? h / 2 : (h - depth) / 2);
    const cx = x + w / 2;
    const tc = o.textColor || (disabled ? '#ccc' : '#fff8e8');
    if (o.icon && !o.label) drawIcon(ctx, o.icon, cx, cy, o.iconSize || Math.min(w, h) * 0.55);
    else if (o.icon && o.label) {
      const fs = o.fontSize || Math.min(18, h * 0.38);
      const tw = this.measure(o.label, fs);
      const is = o.iconSize || fs * 1.3;
      const total = is + 5 + tw;
      drawIcon(ctx, o.icon, cx - total / 2 + is / 2, cy, is);
      this.text(o.label, cx - total / 2 + is + 5, cy + 1, { size: fs, color: tc });
    } else if (o.label) this.text(o.label, cx, cy + 1, { size: o.fontSize || Math.min(18, h * 0.4), align: 'center', color: tc, maxW: w - 8 });
    if (o.sub) this.text(o.sub, cx, (o.circle ? y + h : y + h) + 9, { size: o.subSize || 12, align: 'center' });
    if (o.badge !== undefined) {
      circle(ctx, x + w - 5, y + 5, 10, C.red, '#fff', 1.5);
      this.text(String(o.badge), x + w - 5, y + 6, { size: 11, align: 'center' });
    }
    this.regions.push({ id, x, y, w, h, onTap: disabled && !o.tapWhenDisabled ? null : onTap, onDown: disabled ? null : o.down, onUp: o.up, block: true });
  }
  bar(x, y, w, h, f, color, bg = 'rgba(0,0,0,0.55)') {
    const ctx = this.ctx;
    roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = bg; ctx.fill();
    if (f > 0) { roundRect(ctx, x + 2, y + 2, Math.max(h - 4, (w - 4) * Math.min(1, f)), h - 4, (h - 4) / 2); ctx.fillStyle = color; ctx.fill(); }
    roundRect(ctx, x, y, w, h, h / 2); ctx.lineWidth = 1.5; ctx.strokeStyle = C.border; ctx.stroke();
  }
  icon(name, x, y, s) { drawIcon(this.ctx, name, x, y, s); }
  iconText(icon, str, x, y, size = 16, color = C.text) {
    drawIcon(this.ctx, icon, x + size * 0.65, y, size * 1.3);
    return this.text(str, x + size * 1.45, y + 1, { size, color }) + size * 1.45;
  }
  region(id, x, y, w, h, onTap, onDown) { this.regions.push({ id, x, y, w, h, onTap, onDown, block: true }); }
  block(x, y, w, h) { this.regions.push({ id: null, x, y, w, h, onTap: null, block: true }); }
  dim(alpha = 0.6, onTap) {
    this.ctx.fillStyle = 'rgba(4,2,8,' + alpha + ')';
    this.ctx.fillRect(0, 0, this.w, this.h);
    this.regions.push({ id: '__dim', x: 0, y: 0, w: this.w, h: this.h, onTap: onTap || null, block: true });
  }
  hit(x, y) {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }
  isPressed(id) { for (const r of this.pressed.values()) if (r.id === id) return true; return false; }
  press(touchId, x, y) {
    const r = this.hit(x, y);
    if (!r) return false;
    if (r.id && (r.onTap || r.onDown || r.onUp)) {
      this.pressed.set(touchId, r);
      this.dirty = true;
      if (r.onDown) r.onDown();
    }
    return true;
  }
  release(touchId, x, y) {
    const p = this.pressed.get(touchId);
    this.pressed.delete(touchId);
    this.dirty = true;
    if (!p) return;
    if (p.onUp) p.onUp();
    const r = this.hit(x, y);
    if (r && r.id === p.id && p.onTap) p.onTap();
  }
  cancelAll() { for (const r of this.pressed.values()) if (r.onUp) r.onUp(); this.pressed.clear(); this.dirty = true; }
  toast(msg, color = C.text) {
    this.toasts.push({ msg, color, t: 0 });
    if (this.toasts.length > 3) this.toasts.shift();
    this.dirty = true;
  }
  drawToasts(dt) {
    for (let i = this.toasts.length - 1; i >= 0; i--) { const t = this.toasts[i]; t.t += dt; if (t.t > 2.2) this.toasts.splice(i, 1); }
    let y = this.h * 0.26;
    for (const t of this.toasts) {
      const a = t.t < 0.15 ? t.t / 0.15 : t.t > 1.8 ? 1 - (t.t - 1.8) / 0.4 : 1;
      const w = this.measure(t.msg, 17) + 40;
      this.ctx.globalAlpha = Math.max(0, a);
      roundRect(this.ctx, this.w / 2 - w / 2, y - 17, w, 34, 8);
      this.ctx.fillStyle = 'rgba(12,8,18,0.82)'; this.ctx.fill();
      this.ctx.lineWidth = 1.5; this.ctx.strokeStyle = 'rgba(201,164,90,0.7)'; this.ctx.stroke();
      this.text(t.msg, this.w / 2, y + 1, { size: 17, align: 'center', color: t.color, stroke: false });
      this.ctx.globalAlpha = 1;
      y += 40;
    }
    return this.toasts.length > 0;
  }
}

function lighten(hex) {
  if (hex[0] !== '#' || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + 50), g = Math.min(255, ((n >> 8) & 255) + 50), b = Math.min(255, (n & 255) + 50);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

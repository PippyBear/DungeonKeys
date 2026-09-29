// 立体地形：石块跳台、高台、二层回廊、下沉庭院、塔楼（梯子/弹跳机关）、深渊跳台、走廊拱桥
// 每个房间的地形生成后都会做一次可达性校验（敌人能走到的地方必须连通），失败则撤销
const WALL = 0;

export const LOW = 0.9;     // 石块 / 高台（一次跳跃可上）
export const HIGH = 2.0;    // 回廊 / 塔楼（需楼梯、梯子、垫脚石或二段跳）
export const SUNK = -0.9;   // 下沉庭院
export const PIT = -3.4;    // 深渊
export const K = { FLOOR: 0, BLOCK: 1, PLAT: 2, STONE: 3, PIT: 4, SUNK: 5, STAIR: 6 };

// 格子内某点高度（fx,fz 为格内 0..1 坐标；楼梯线性插值）
export function heightAt(d, k, fx, fz) {
  const s = d.stairs.get(k);
  if (s) {
    const f = s.di === 1 ? fx : s.di === -1 ? 1 - fx : s.dj === 1 ? fz : 1 - fz;
    return s.h0 + (s.h1 - s.h0) * Math.min(1, Math.max(0, f));
  }
  return d.hgt[k];
}
// 格子某条边的高度（楼梯侧边与深渊不可通行 → NaN）
export function edgeH(d, k, di, dj) {
  const s = d.stairs.get(k);
  if (s) {
    if (di === s.di && dj === s.dj) return s.h1;
    if (di === -s.di && dj === -s.dj) return s.h0;
    return NaN;
  }
  if (d.kind[k] === K.PIT) return NaN;
  return d.hgt[k];
}
export function walkable(d, a, b, di, dj, tol = 0.45) {
  return Math.abs(edgeH(d, a, di, dj) - edgeH(d, b, -di, -dj)) <= tol;
}

// 全平地（标题画面等手工场景用）
export function flatTerrain(d) {
  const N = d.W * d.H;
  d.hgt = new Float32Array(N); d.kind = new Uint8Array(N); d.jumpOnly = new Uint8Array(N);
  d.stairs = new Map(); d.ladders = []; d.bounce = []; d.rewards = []; d.stones = [];
  return d;
}

export function addTerrain(d, rng) {
  const { W, H, tile, region } = d;
  const N = W * H;
  const idx = (i, j) => j * W + i;
  d.hgt = new Float32Array(N);
  d.kind = new Uint8Array(N);
  d.jumpOnly = new Uint8Array(N);
  d.stairs = new Map();
  d.ladders = [];
  d.bounce = [];
  d.rewards = [];
  d.stones = [];
  d.movers = [];     // 移动平台 / 升降台
  d.jumpTraps = [];  // 跳台机关：摆锤、飞镖墙
  // 入口附近保持平地
  const keep = new Uint8Array(N);
  for (const r of d.rooms) for (const e of r.entrances) {
    for (let s = -1; s <= 2; s++) { const i = e.i - e.dir[0] * s, j = e.j - e.dir[1] * s; if (i >= 0 && j >= 0 && i < W && j < H) keep[idx(i, j)] = 1; }
  }
  if (d.secrets) for (const s of d.secrets) { const c = s.connector; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) keep[idx(c.i + di, c.j + dj)] = 1; }

  let tx = null;
  const set = (i, j, h, kind, jumpOnly = 0) => {
    const k = idx(i, j);
    tx.push({ k, h: d.hgt[k], kind: d.kind[k], jo: d.jumpOnly[k], st: d.stairs.get(k) });
    d.hgt[k] = h; d.kind[k] = kind; d.jumpOnly[k] = jumpOnly;
    d.stairs.delete(k);
  };
  const stair = (i, j, di, dj, h0, h1) => { set(i, j, h0, K.STAIR); d.stairs.set(idx(i, j), { di, dj, h0, h1 }); };
  const begin = () => { tx = []; return { ladders: d.ladders.length, bounce: d.bounce.length, rewards: d.rewards.length, stones: d.stones.length, movers: d.movers.length, jt: d.jumpTraps.length }; };
  const revert = (mark) => {
    for (let q = tx.length - 1; q >= 0; q--) {
      const t = tx[q];
      d.hgt[t.k] = t.h; d.kind[t.k] = t.kind; d.jumpOnly[t.k] = t.jo;
      if (t.st) d.stairs.set(t.k, t.st); else d.stairs.delete(t.k);
    }
    d.ladders.length = mark.ladders; d.bounce.length = mark.bounce; d.rewards.length = mark.rewards; d.stones.length = mark.stones;
    d.movers.length = mark.movers; d.jumpTraps.length = mark.jt;
  };
  const inRoom = (room, i, j) => i >= room.x && j >= room.y && i < room.x + room.w && j < room.y + room.h;
  const free = (room, i, j) => {
    if (!inRoom(room, i, j)) return false;
    const k = idx(i, j);
    if (tile[k] === WALL || region[k] !== room.id || keep[k] || d.kind[k] !== K.FLOOR) return false;
    if ((room.type === 'start' || room.type === 'exit' || room.type === 'boss') && Math.abs(i - room.cx) <= 1 && Math.abs(j - room.cy) <= 1) return false;
    if (room.type === 'boss' && Math.abs(i - room.cx) <= 1 && Math.abs(j - room.y - 2) <= 1) return false;
    return true;
  };
  const inner = (room, i, j) => i > room.x && j > room.y && i < room.x + room.w - 1 && j < room.y + room.h - 1;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // 房间内可达性：从入口出发（按敌人规则行走），所有非「仅跳跃可达」的格子都必须可达
  const validate = (room) => {
    const seen = new Uint8Array(N);
    const q = [];
    for (const e of room.entrances) { const k = idx(e.i - e.dir[0], e.j - e.dir[1]); if (!seen[k]) { seen[k] = 1; q.push(k); } }
    if (!q.length) { const k = idx(room.x, room.y); seen[k] = 1; q.push(k); }
    while (q.length) {
      const c = q.pop();
      const ci = c % W, cj = (c - ci) / W;
      for (const [di, dj] of DIRS) {
        const ni = ci + di, nj = cj + dj;
        if (!inRoom(room, ni, nj)) continue;
        const n = idx(ni, nj);
        if (seen[n] || tile[n] === WALL) continue;
        if (!walkable(d, c, n, di, dj)) continue;
        seen[n] = 1; q.push(n);
      }
    }
    for (let j = room.y; j < room.y + room.h; j++) for (let i = room.x; i < room.x + room.w; i++) {
      const k = idx(i, j);
      if (tile[k] === WALL || d.jumpOnly[k] || d.kind[k] === K.PIT) continue;
      if (!seen[k]) return false;
    }
    return true;
  };

  // ---- 石块：散落的跳台，部分叠成两级阶梯，高处放奖励
  const blocks = (room, n) => {
    let placed = 0;
    for (let t = 0; t < 40 && placed < n; t++) {
      const i = rng.int(room.x + 1, room.x + room.w - 2), j = rng.int(room.y + 1, room.y + room.h - 2);
      if (!free(room, i, j)) continue;
      set(i, j, LOW, K.BLOCK, 1);
      placed++;
      if (rng() < 0.45) {
        const [di, dj] = DIRS[rng.int(0, 3)];
        if (inner(room, i + di, j + dj) && free(room, i + di, j + dj)) {
          set(i + di, j + dj, HIGH, K.BLOCK, 1);
          d.rewards.push({ i: i + di, j: j + dj, kind: rng() < 0.3 ? 'crystal' : 'coins' });
        }
      }
    }
    return placed > 0;
  };
  // ---- 高台：带楼梯的方形平台，顶上放宝箱
  const dais = (room) => {
    const dw = rng.int(2, 3), dh = rng.int(2, 3);
    if (room.w - 4 < dw || room.h - 4 < dh) return false;
    const x0 = rng.int(room.x + 2, room.x + room.w - 2 - dw), y0 = rng.int(room.y + 2, room.y + room.h - 2 - dh);
    for (let j = y0; j < y0 + dh; j++) for (let i = x0; i < x0 + dw; i++) if (!free(room, i, j)) return false;
    for (let j = y0; j < y0 + dh; j++) for (let i = x0; i < x0 + dw; i++) set(i, j, LOW, K.PLAT);
    // 一到两侧楼梯
    const sides = [[0, 1], [0, -1], [1, 0], [-1, 0]].sort(() => rng() - 0.5);
    let made = 0;
    for (const [di, dj] of sides) {
      if (made >= (rng() < 0.5 ? 1 : 2)) break;
      const si = di === 1 ? x0 + dw : di === -1 ? x0 - 1 : x0 + rng.int(0, dw - 1);
      const sj = dj === 1 ? y0 + dh : dj === -1 ? y0 - 1 : y0 + rng.int(0, dh - 1);
      if (!free(room, si, sj) || !free(room, si + di, sj + dj)) continue;
      stair(si, sj, -di, -dj, 0, LOW);
      made++;
    }
    if (!made) return false;
    // 宝箱位置：不能挡住楼梯口
    const landings = [];
    for (const [k, st] of d.stairs) { const i = k % W, j = (k - i) / W; landings.push(idx(i + st.di, j + st.dj)); }
    let top = null;
    for (let j = y0; j < y0 + dh && !top; j++) for (let i = x0; i < x0 + dw && !top; i++) if (landings.indexOf(idx(i, j)) < 0 && (i !== x0 + (dw >> 1) || j !== y0 + (dh >> 1) || dw * dh <= 4)) top = { i, j };
    room.terrain = { kind: 'dais', top: top || { i: x0, j: y0 } };
    return true;
  };
  // ---- 二层回廊：沿一面无入口的墙抬高两格，楼梯 + 梯子上下
  const balcony = (room) => {
    const sides = ['n', 's', 'w', 'e'].sort(() => rng() - 0.5);
    for (const side of sides) {
      const along = side === 'n' || side === 's' ? room.w : room.h;
      const across = side === 'n' || side === 's' ? room.h : room.w;
      if (across < 8 || along < 6) continue;
      const map = (u, v) => side === 'n' ? [room.x + u, room.y + v] : side === 's' ? [room.x + u, room.y + room.h - 1 - v] : side === 'w' ? [room.x + v, room.y + u] : [room.x + room.w - 1 - v, room.y + u];
      const rise = side === 'n' ? [0, -1] : side === 's' ? [0, 1] : side === 'w' ? [-1, 0] : [1, 0];
      let ok = true;
      for (let u = 0; u < along && ok; u++) for (let v = 0; v < 2 && ok; v++) { const [i, j] = map(u, v); if (!free(room, i, j)) ok = false; }
      if (!ok) continue;
      const us = rng() < 0.5 ? 1 : along - 2, ul = us === 1 ? along - 2 : 1;
      const need = [[us, 2], [us, 3], [us, 4], [ul, 2]];
      if (need.some(([u, v]) => { const [i, j] = map(u, v); return !free(room, i, j); })) continue;
      const tiles = [];
      for (let u = 0; u < along; u++) for (let v = 0; v < 2; v++) { const [i, j] = map(u, v); set(i, j, HIGH, K.PLAT); tiles.push({ i, j, u, v }); }
      const [a1, b1] = map(us, 2), [a2, b2] = map(us, 3);
      stair(a1, b1, rise[0], rise[1], LOW, HIGH);
      stair(a2, b2, rise[0], rise[1], 0, LOW);
      const [li, lj] = map(ul, 1);
      d.ladders.push({ i: li, j: lj, di: -rise[0], dj: -rise[1], top: HIGH });
      const [ti, tj] = map(along >> 1, 0);
      room.terrain = { kind: 'balcony', side, tiles, top: { i: ti, j: tj }, rise, map, along };
      return true;
    }
    return false;
  };
  // ---- 下沉庭院：中央整体下沉，两侧楼梯
  const sunken = (room) => {
    if (room.w < 8 || room.h < 8) return false;
    const x0 = room.x + 2, y0 = room.y + 2, x1 = room.x + room.w - 3, y1 = room.y + room.h - 3;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const k = idx(i, j);
      if (tile[k] === WALL) continue;
      if (!free(room, i, j)) return false;
    }
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (tile[idx(i, j)] !== WALL) set(i, j, SUNK, K.SUNK);
    const mx = (x0 + x1) >> 1, my = (y0 + y1) >> 1;
    const opts = [[mx, y0, 0, -1], [mx, y1, 0, 1], [x0, my, -1, 0], [x1, my, 1, 0]].sort(() => rng() - 0.5);
    let made = 0;
    for (const [i, j, di, dj] of opts) {
      if (made >= 2) break;
      if (tile[idx(i, j)] === WALL || tile[idx(i + di, j + dj)] === WALL) continue;
      stair(i, j, di, dj, SUNK, 0);
      made++;
    }
    if (!made) return false;
    room.terrain = { kind: 'sunken', rect: [x0, y0, x1, y1] };
    return true;
  };
  // ---- 塔楼：角落 2x2 高塔，梯子攀爬；可附带垫脚石块或弹跳机关
  const tower = (room) => {
    if (room.w < 7 || room.h < 7) return false;
    const c = rng.int(0, 3);
    const right = c & 1, down = c & 2;
    const x0 = right ? room.x + room.w - 3 : room.x + 1, y0 = down ? room.y + room.h - 3 : room.y + 1;
    for (let j = y0; j < y0 + 2; j++) for (let i = x0; i < x0 + 2; i++) if (!free(room, i, j)) return false;
    const inX = right ? -1 : 1, inZ = down ? -1 : 1;
    // 梯子：朝房间内侧的一面
    const faces = [
      { i: right ? x0 : x0 + 1, j: y0 + rng.int(0, 1), di: inX, dj: 0 },
      { i: x0 + rng.int(0, 1), j: down ? y0 : y0 + 1, di: 0, dj: inZ },
    ].sort(() => rng() - 0.5);
    const f = faces[0], g = faces[1];
    if (!free(room, f.i + f.di, f.j + f.dj)) return false;
    for (let j = y0; j < y0 + 2; j++) for (let i = x0; i < x0 + 2; i++) set(i, j, HIGH, K.PLAT, 1);
    d.ladders.push({ i: f.i, j: f.j, di: f.di, dj: f.dj, top: HIGH });
    const gi = g.i + g.di, gj = g.j + g.dj;
    if (free(room, gi, gj) && inner(room, gi, gj)) {
      if (rng() < 0.4) set(gi, gj, LOW, K.BLOCK, 1);
      else d.bounce.push({ i: gi, j: gj });
    }
    // 宝箱：不占梯子口，也不占弹跳/垫脚石一侧的落脚格
    let top = { i: x0, j: y0 };
    for (let j = y0; j < y0 + 2; j++) for (let i = x0; i < x0 + 2; i++) if (!(i === f.i && j === f.j) && !(i === g.i && j === g.j)) top = { i, j };
    room.terrain = { kind: 'tower', top };
    return true;
  };
  // ---- 深渊跳台：房间内部全是深渊，踩着石柱跳到中央孤岛
  const parkour = (room) => {
    if (room.w < 7 || room.h < 7) return false;
    for (let j = room.y + 1; j < room.y + room.h - 1; j++) for (let i = room.x + 1; i < room.x + room.w - 1; i++) {
      const k = idx(i, j);
      if (tile[k] === WALL || region[k] !== room.id || d.kind[k] !== K.FLOOR) return false;
    }
    for (let j = room.y + 1; j < room.y + room.h - 1; j++) for (let i = room.x + 1; i < room.x + room.w - 1; i++) set(i, j, PIT, K.PIT);
    const ci = room.cx, cj = room.cy;
    const island = [[ci, cj], [ci - 1, cj], [ci, cj - 1], [ci - 1, cj - 1]];
    const f = d.floor;
    // 第 3 层起，孤岛可能高高耸立，只能乘升降台上去
    const highIsland = f >= 3 && rng() < 0.4;
    const islandH = highIsland ? HIGH : LOW;
    for (const [i, j] of island) set(i, j, islandH, K.STONE, 1);
    const isIsland = (i, j) => island.some(([a, b]) => a === i && b === j);
    // 路径：从一或两个方向的外圈出发；石柱每隔一格一根（可能坍塌/喷火），或一块往返移动平台
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rng() - 0.5);
    const crumbly = f >= 3;
    let paths = 0;
    for (const [di, dj] of dirs) {
      if (paths >= (room.w * room.h >= 80 ? 2 : 1)) break;
      let i = ci, j = cj;
      while (inner(room, i - di, j - dj)) { i -= di; j -= dj; }
      const cells = [];
      let a = i, b = j;
      while (!isIsland(a, b)) { cells.push([a, b]); a += di; b += dj; if (!inner(room, a, b)) break; }
      const L = cells.length;
      if (L < 2) continue;
      const slide = !highIsland && L >= 3 && rng() < 0.5;
      if (slide) {
        // 往返平台：从外圈旁滑到孤岛旁
        d.movers.push({ kind: 'slide', a: cells[0], b: cells[L - 1], h: 0, phase: rng() * 6, speed: 1.6 + f * 0.08 });
      } else {
        const picks = [];
        for (let s2 = L - 1; s2 >= 1; s2 -= 2) picks.push(s2);
        if (picks[picks.length - 1] === 2) picks.push(0);
        picks.forEach((s2, q) => {
          const [si, sj] = cells[s2];
          if (q === 0 && highIsland) { d.movers.push({ kind: 'lift', i: si, j: sj, h0: 0, h1: HIGH + 0.02, phase: rng() * 6 }); return; }
          const h = q === 0 ? 0.45 : 0;
          set(si, sj, h, K.STONE, 1);
          const cr = crumbly && q > 0 && rng() < 0.5;
          d.stones.push({ i: si, j: sj, h, crumble: cr, fire: f >= 3 && q > 0 && !cr && rng() < 0.5, phase: rng() * 3 });
        });
        // 摆锤横扫石柱之间的空隙
        if (f >= 4 && rng() < 0.6) {
          const gaps = [];
          for (let s2 = 0; s2 < L; s2++) if (picks.indexOf(s2) < 0) gaps.push(cells[s2]);
          if (gaps.length) { const [gi, gj] = gaps[rng.int(0, gaps.length - 1)]; d.jumpTraps.push({ type: 'pendulum', i: gi, j: gj, di: dj, dj: di, phase: rng() * 6 }); }
        }
      }
      // 飞镖墙：从侧墙横穿路径
      if (f >= 3 && rng() < 0.55) {
        const s2 = rng.int(0, L - 1);
        const [pi, pj] = cells[s2];
        const side = rng() < 0.5 ? 1 : -1;
        const fdi = dj ? side : 0, fdj = di ? side : 0;
        let wi = pi, wj = pj;
        while (tile[idx(wi - fdi, wj - fdj)] !== WALL && inRoom(room, wi - fdi, wj - fdj)) { wi -= fdi; wj -= fdj; }
        wi -= fdi; wj -= fdj;
        if (tile[idx(wi, wj)] === WALL) d.jumpTraps.push({ type: 'dart', wi, wj, fdi, fdj, room: room.id, period: 2.6 - Math.min(0.8, f * 0.06), phase: rng() * 2 });
      }
      paths++;
    }
    if (!paths) return false;
    // 装饰石柱（不在路径上）
    for (let t = 0; t < 6; t++) {
      const i = rng.int(room.x + 1, room.x + room.w - 2), j = rng.int(room.y + 1, room.y + room.h - 2);
      const k = idx(i, j);
      if (d.kind[k] !== K.PIT || (i - room.x + j - room.y) % 2) continue;
      if (d.movers.some((m) => m.kind === 'lift' ? m.i === i && m.j === j : (i >= Math.min(m.a[0], m.b[0]) && i <= Math.max(m.a[0], m.b[0]) && j >= Math.min(m.a[1], m.b[1]) && j <= Math.max(m.a[1], m.b[1])))) continue;
      if (d.jumpTraps.some((q) => q.type === 'pendulum' && q.i === i && q.j === j)) continue;
      const h = rng() < 0.5 ? 0 : -0.4;
      set(i, j, h, K.STONE, 1);
      d.stones.push({ i, j, h, crumble: crumbly && rng() < 0.5 });
    }
    for (const [i, j] of island) d.stones.push({ i, j, h: islandH, island: true });
    // 宝箱放在不挨着石柱路径的孤岛格上
    const nearStone = (i, j) => DIRS.some(([a, b]) => d.stones.some((st) => !st.island && st.i === i + a && st.j === j + b));
    const top = island.find(([i, j]) => !nearStone(i, j)) || island[0];
    room.terrain = { kind: 'parkour', top: { i: top[0], j: top[1] } };
    return true;
  };

  const tryOne = (room, fn, ...args) => {
    const mark = begin();
    if (fn(room, ...args) && validate(room)) return true;
    revert(mark);
    room.terrain = null;
    return false;
  };
  const pick = (room, list) => {
    for (const fn of list.sort(() => rng() - 0.5)) if (tryOne(room, fn)) return true;
    return false;
  };

  for (const room of d.rooms) {
    switch (room.type) {
      case 'parkour': if (!tryOne(room, parkour)) room.type = 'treasure'; break;
      case 'monster': case 'arena': {
        const r = rng();
        if (r < 0.3) tryOne(room, blocks, rng.int(2, 4));
        else if (r < 0.92) pick(room, [balcony, dais, sunken, tower]);
        break;
      }
      case 'empty': pick(room, [balcony, sunken, tower, dais, (rm) => blocks(rm, rng.int(2, 4))]); break;
      case 'treasure': pick(room, [dais, tower]); break;
      case 'library': if (rng() < 0.6) tryOne(room, balcony); break;
      case 'trap': if (rng() < 0.4) tryOne(room, blocks, 2); break;
      case 'boss': tryOne(room, blocks, 2); break;
      case 'start': if (d.floor === 1) tryOne(room, blocks, 1); break;
      default: break;
    }
  }
  // 第 1 层起始房间教学：一组必有高低石块 + 奖励
  if (d.floor === 1) {
    const sr = d.rooms[d.start];
    if (!d.rewards.some((r) => inRoom(sr, r.i, r.j))) {
      for (let t = 0; t < 30; t++) {
        const mark = begin();
        const i = rng.int(sr.x + 1, sr.x + sr.w - 2), j = rng.int(sr.y + 1, sr.y + sr.h - 2);
        const [di, dj] = DIRS[rng.int(0, 3)];
        if (!free(sr, i, j) || !free(sr, i + di, j + dj) || !inner(sr, i + di, j + dj)) continue;
        set(i, j, LOW, K.BLOCK, 1); set(i + di, j + dj, HIGH, K.BLOCK, 1);
        d.rewards.push({ i: i + di, j: j + dj, kind: 'crystal' });
        if (validate(sr)) break;
        revert(mark);
      }
    }
  }

  // ---- 走廊拱桥：长直走廊中段抬高，两端楼梯
  const busy = new Set();
  for (const t of d.traps) { busy.add(idx(t.i, t.j)); if (t.wi !== undefined) busy.add(idx(t.wi, t.wj)); }
  for (const wd of d.wanderers) busy.add(idx(wd.i, wd.j));
  const isCorr = (k) => tile[k] === 2;
  for (const c of d.corridors) {
    if (c.tiles.length < 7 || rng() > 0.4) continue;
    const set0 = new Set(c.tiles);
    let done = false;
    for (const t of c.tiles) {
      if (done) break;
      const i = t % W, j = (t - i) / W;
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (set0.has(idx(i - di, j - dj))) continue;
        let len = 0;
        while (set0.has(idx(i + di * len, j + dj * len))) len++;
        if (len < 7) continue;
        const m = len >> 1;
        const run = [];
        for (let s = m - 2; s <= m + 2; s++) run.push([i + di * s, j + dj * s]);
        const ok = run.every(([a, b]) => {
          const k = idx(a, b);
          return isCorr(k) && !busy.has(k) && !keep[k] && !d.isEntrance[k] && d.kind[k] === K.FLOOR &&
            tile[idx(a + dj, b + di)] === WALL && tile[idx(a - dj, b - di)] === WALL;
        });
        if (!ok) continue;
        tx = [];
        stair(run[0][0], run[0][1], di, dj, 0, LOW);
        for (let s = 1; s <= 3; s++) set(run[s][0], run[s][1], LOW, K.PLAT);
        stair(run[4][0], run[4][1], -di, -dj, 0, LOW);
        done = true;
        break;
      }
    }
  }
  tx = null;
}

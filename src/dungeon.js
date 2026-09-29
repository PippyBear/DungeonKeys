// 随机地牢生成：房间 → 最小生成树 + 回路 → A* 挖走廊 → 房间职能分配 → 陷阱布置
// 保证可解：出口房间是生成树的叶子且走廊绕开它，所以封印出口不会挡住任何钥匙
import { makeRng, MinHeap } from './utils.js';
import { addTerrain } from './terrain.js';

export const T = 2;          // 每格世界尺寸
export const WALL = 0, ROOM = 1, CORR = 2;

export const FLOOR_NAMES = ['潮湿地窖', '骸骨回廊', '遗忘牢房', '蛛网密道', '石魔前厅', '幽火墓穴', '沉没神殿', '血色长廊', '熔火深渊', '王座之间'];
export function floorName(f) { return FLOOR_NAMES[(f - 1) % FLOOR_NAMES.length]; }
export function isBossFloor(f) { return f % 5 === 0; }
export function keysNeeded(f) { return f <= 2 ? 1 : f <= 6 ? 2 : 3; }

export function generateDungeon(floor, seed, opts = {}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const d = tryGenerate(floor, seed + attempt * 7919, opts);
    if (d) { addTerrain(d, makeRng((seed + attempt * 7919) ^ 0x5bd1e995)); return d; }
  }
  throw new Error('dungeon generation failed');
}

function tryGenerate(floor, seed, opts) {
  const rng = makeRng(seed);
  const W = 38 + Math.min(floor, 6) * 2, H = W;
  const tile = new Uint8Array(W * H);
  const idx = (i, j) => j * W + i;
  const rooms = [];
  const target = 8 + Math.min(floor, 5);
  for (let t = 0; t < 600 && rooms.length < target; t++) {
    const w = rng.int(6, 10), h = rng.int(6, 9);
    const x = rng.int(2, W - w - 2), y = rng.int(2, H - h - 2);
    let ok = true;
    for (const r of rooms) {
      if (x < r.x + r.w + 4 && x + w + 4 > r.x && y < r.y + r.h + 4 && y + h + 4 > r.y) { ok = false; break; }
    }
    if (!ok) continue;
    rooms.push({ id: rooms.length, x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  if (rooms.length < 6) return null;

  // 最小生成树（Prim）
  const n = rooms.length;
  const dist = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
  const inTree = new Array(n).fill(false);
  inTree[0] = true;
  const edges = [];
  const adj = rooms.map(() => []);
  for (let k = 1; k < n; k++) {
    let best = null, bd = 1e9;
    for (let a = 0; a < n; a++) if (inTree[a]) for (let b = 0; b < n; b++) if (!inTree[b]) {
      const d = dist(rooms[a], rooms[b]);
      if (d < bd) { bd = d; best = [a, b]; }
    }
    inTree[best[1]] = true;
    edges.push(best);
    adj[best[0]].push(best[1]);
    adj[best[1]].push(best[0]);
  }
  const bfs = (s) => {
    const dd = new Array(n).fill(-1);
    dd[s] = 0;
    const q = [s];
    while (q.length) { const a = q.shift(); for (const b of adj[a]) if (dd[b] < 0) { dd[b] = dd[a] + 1; q.push(b); } }
    return dd;
  };
  // 起点：随机；出口：离起点最远的叶子
  const start = rng.int(0, n - 1);
  const ds = bfs(start);
  let exit = -1, bestD = -1;
  for (let r = 0; r < n; r++) if (r !== start && adj[r].length === 1 && ds[r] > bestD) { bestD = ds[r]; exit = r; }
  if (exit < 0) return null;
  const boss = isBossFloor(floor);
  if (boss) {
    // Boss 房尽量扩大
    const r = rooms[exit];
    for (let g = 0; g < 3; g++) {
      const nx = r.x - 1, ny = r.y - 1, nw = r.w + 2, nh = r.h + 2;
      if (nx < 2 || ny < 2 || nx + nw > W - 2 || ny + nh > H - 2) break;
      if (rooms.some((o) => o !== r && nx < o.x + o.w + 2 && nx + nw + 2 > o.x && ny < o.y + o.h + 2 && ny + nh + 2 > o.y)) break;
      r.x = nx; r.y = ny; r.w = nw; r.h = nh;
    }
    r.cx = r.x + (r.w >> 1); r.cy = r.y + (r.h >> 1);
  }
  // 额外回路（不连接出口）
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (a === exit || b === exit) continue;
    if (adj[a].indexOf(b) >= 0) continue;
    if (dist(rooms[a], rooms[b]) < 18 && rng() < 0.22) { edges.push([a, b]); adj[a].push(b); adj[b].push(a); }
  }
  for (const r of rooms) for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) tile[idx(i, j)] = ROOM;
  const roomAt = new Int16Array(W * H).fill(-1);
  for (const r of rooms) for (let j = r.y - 1; j <= r.y + r.h; j++) for (let i = r.x - 1; i <= r.x + r.w; i++) {
    const inside = i >= r.x && i < r.x + r.w && j >= r.y && j < r.y + r.h;
    if (inside) roomAt[idx(i, j)] = r.id;
  }
  const nearExit = (i, j) => {
    const r = rooms[exit];
    return i >= r.x - 2 && i <= r.x + r.w + 1 && j >= r.y - 2 && j <= r.y + r.h + 1;
  };
  const nearRoom = (i, j, except) => {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const k = roomAt[idx(i + di, j + dj)];
      if (k >= 0 && except.indexOf(k) < 0) return k;
    }
    return -1;
  };

  // A* 挖走廊
  const carve = (a, b) => {
    const A = rooms[a], B = rooms[b];
    const sx = A.cx, sy = A.cy, tx = B.cx, ty = B.cy;
    const cost = new Float32Array(W * H).fill(Infinity);
    const prev = new Int32Array(W * H).fill(-1);
    const h = new MinHeap();
    const s = idx(sx, sy);
    cost[s] = 0;
    h.push(0, s);
    const ends = [a, b];
    while (h.size) {
      const c = h.pop();
      const cc = h.topKey;
      const ci = c % W, cj = (c - ci) / W;
      if (ci === tx && cj === ty) break;
      const g = cost[c];
      if (cc - (Math.abs(ci - tx) + Math.abs(cj - ty)) > g + 1e-6) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 1 || nj < 1 || ni >= W - 1 || nj >= H - 1) continue;
        const k = idx(ni, nj);
        const rm = roomAt[k];
        let step;
        if (rm >= 0) {
          if (ends.indexOf(rm) >= 0) step = 1;
          else if (rm === exit) continue;
          else step = 8;
        } else {
          if (ends.indexOf(exit) < 0 && nearExit(ni, nj)) continue;
          const nr = nearRoom(ni, nj, ends);
          step = tile[k] === CORR ? 1 : 2.2;
          if (nr >= 0) step += 4;
          // 转弯惩罚，走廊更笔直
          const pc = prev[c];
          if (pc >= 0) { const pdi = ci - (pc % W), pdj = cj - Math.floor(pc / W); if (pdi !== di || pdj !== dj) step += 0.8; }
        }
        const ng = g + step;
        if (ng < cost[k]) { cost[k] = ng; prev[k] = c; h.push(ng + Math.abs(ni - tx) + Math.abs(nj - ty), k); }
      }
    }
    let c = idx(tx, ty);
    if (prev[c] < 0) return false;
    while (c >= 0) { if (tile[c] === WALL) tile[c] = CORR; c = prev[c]; }
    return true;
  };
  for (const [a, b] of edges) if (!carve(a, b)) return null;

  // 区域划分：房间 id 0..n-1，走廊连通块 n..
  const region = new Int16Array(W * H).fill(-1);
  for (let k = 0; k < W * H; k++) if (roomAt[k] >= 0 && tile[k] === ROOM) region[k] = roomAt[k];
  let nextRegion = n;
  const corridors = [];
  for (let k = 0; k < W * H; k++) {
    if (tile[k] !== CORR || region[k] >= 0) continue;
    const id = nextRegion++;
    const tiles = [];
    const q = [k];
    region[k] = id;
    while (q.length) {
      const c = q.pop();
      tiles.push(c);
      const ci = c % W, cj = (c - ci) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = idx(ci + di, cj + dj);
        if (tile[nk] === CORR && region[nk] < 0) { region[nk] = id; q.push(nk); }
      }
    }
    corridors.push({ id, tiles });
  }
  // 入口
  for (const r of rooms) {
    r.entrances = [];
    for (let j = r.y - 1; j <= r.y + r.h; j++) for (let i = r.x - 1; i <= r.x + r.w; i++) {
      const inside = i >= r.x && i < r.x + r.w && j >= r.y && j < r.y + r.h;
      if (inside) continue;
      const corner = (i === r.x - 1 || i === r.x + r.w) && (j === r.y - 1 || j === r.y + r.h);
      if (corner) continue;
      if (tile[idx(i, j)] !== CORR) continue;
      let dir;
      if (i === r.x - 1) dir = [-1, 0]; else if (i === r.x + r.w) dir = [1, 0]; else if (j === r.y - 1) dir = [0, -1]; else dir = [0, 1];
      const px = dir[0] === 0 ? [1, 0] : [0, 1];
      const narrow = tile[idx(i + px[0], j + px[1])] === WALL && tile[idx(i - px[0], j - px[1])] === WALL;
      r.entrances.push({ i, j, dir, narrow });
    }
  }
  if (!rooms[exit].entrances.length) return null;

  // 连通性检查（全部可达）
  {
    const seen = new Uint8Array(W * H);
    const s = idx(rooms[start].cx, rooms[start].cy);
    const q = [s];
    seen[s] = 1;
    let cnt = 0;
    while (q.length) {
      const c = q.pop(); cnt++;
      const ci = c % W, cj = (c - ci) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = idx(ci + di, cj + dj);
        if (tile[nk] !== WALL && !seen[nk]) { seen[nk] = 1; q.push(nk); }
      }
    }
    let total = 0;
    for (let k = 0; k < W * H; k++) if (tile[k] !== WALL) total++;
    if (cnt !== total) return null;
  }

  // 房间职能
  for (const r of rooms) { r.type = 'empty'; r.hasKey = false; r.dist = ds[r.id]; }
  rooms[start].type = 'start';
  rooms[exit].type = boss ? 'boss' : 'exit';
  const need = keysNeeded(floor);
  const others = rooms.filter((r) => r.id !== start && r.id !== exit);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  const puzzlePool = ['crates', 'levers'];
  if (floor >= 2) puzzlePool.push('runes', 'memory');
  if (floor >= 3) puzzlePool.push('mirrors', 'statues');
  const usedPuzzles = [];
  let k = 0;
  for (let q = 0; q < need && k < others.length; q++, k++) {
    const r = others[k];
    r.hasKey = true;
    if (q === 1 && floor >= 3 && rng() < 0.5) { r.type = 'monster'; continue; }
    let choices = puzzlePool.filter((p) => usedPuzzles.indexOf(p) < 0);
    if (!choices.length) choices = puzzlePool;
    r.type = 'puzzle';
    r.puzzle = choices[Math.floor(rng() * choices.length)];
    usedPuzzles.push(r.puzzle);
  }
  let shrine = floor >= 2 && rng() < 0.5;
  let shop = floor >= 2 && rng() < 0.55;
  let prison = floor >= 3 && rng() < 0.35;
  let library = rng() < 0.3;
  let arena = floor >= 4 && rng() < 0.3;
  let parkour = floor >= 2 ? (rng() < 0.7 ? 1 : 0) + (floor >= 5 && rng() < 0.4 ? 1 : 0) : 0;
  let gauntlet = floor >= 2 && rng() < 0.55;
  let maze = floor >= 2 && rng() < 0.5;
  for (; k < others.length; k++) {
    const r = others[k];
    const x = rng();
    if (shop) { r.type = 'shop'; shop = false; }
    else if (shrine) { r.type = 'shrine'; shrine = false; }
    else if (prison) { r.type = 'prison'; prison = false; }
    else if (arena && r.w >= 7 && r.h >= 7) { r.type = 'arena'; arena = false; }
    else if (parkour > 0 && r.w >= 7 && r.h >= 7) { r.type = 'parkour'; parkour--; }
    else if (gauntlet && r.w >= 7 && r.h >= 7) { r.type = 'gauntlet'; gauntlet = false; }
    else if (maze && r.w >= 7 && r.h >= 7) { r.type = 'maze'; maze = false; }
    else if (library) { r.type = 'library'; library = false; }
    else if (x < 0.42) r.type = 'monster';
    else if (x < 0.62) r.type = 'trap';
    else if (x < 0.8) r.type = 'treasure';
    else if (x < 0.9 && floor >= 2) { r.type = 'puzzle'; r.puzzle = puzzlePool[Math.floor(rng() * puzzlePool.length)]; }
    else r.type = 'empty';
  }

  // 走廊陷阱与游荡怪
  const traps = [];
  const wanderers = [];
  const isEntrance = new Uint8Array(W * H);
  for (const r of rooms) for (const e of r.entrances) {
    isEntrance[idx(e.i, e.j)] = 1;
    isEntrance[idx(e.i + e.dir[0], e.j + e.dir[1])] = 1;
  }
  const startRoom = rooms[start];
  const nearStart = (i, j) => Math.abs(i - startRoom.cx) + Math.abs(j - startRoom.cy) < 9;
  const trapChance = Math.min(0.9, 0.35 + floor * 0.06 + (opts.traps ? 0.3 : 0));
  for (const c of corridors) {
    if (c.tiles.length < 4) continue;
    // 找直线段
    const set = new Set(c.tiles);
    const runs = [];
    for (const t of c.tiles) {
      const i = t % W, j = (t - i) / W;
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (set.has(idx(i - di, j - dj))) continue;
        let len = 0;
        while (set.has(idx(i + di * len, j + dj * len))) len++;
        if (len >= 3) runs.push({ i, j, di, dj, len });
      }
    }
    const usable = (i, j, di, dj) => !isEntrance[idx(i, j)] && !nearStart(i, j) && tile[idx(i + dj, j + di)] === WALL && tile[idx(i - dj, j - di)] === WALL;
    for (const run of runs) {
      if (rng() > trapChance) continue;
      const m = Math.floor(run.len / 2);
      const i = run.i + run.di * m, j = run.j + run.dj * m;
      if (!usable(i, j, run.di, run.dj)) continue;
      if (traps.some((t) => Math.abs(t.i - i) + Math.abs(t.j - j) < 3)) continue;
      const pick = rng();
      if (pick < 0.35) {
        const cnt = Math.min(run.len - 1, 2 + (floor > 3 ? 1 : 0));
        for (let s = 0; s < cnt; s++) {
          const ii = run.i + run.di * (m - (cnt >> 1) + s), jj = run.j + run.dj * (m - (cnt >> 1) + s);
          if (usable(ii, jj, run.di, run.dj)) traps.push({ type: 'spikes', i: ii, j: jj, phase: s * 0.35 });
        }
      } else if (pick < 0.6 && floor >= 2) {
        traps.push({ type: 'pendulum', i, j, di: run.di, dj: run.dj, phase: rng() * 6 });
      } else if (pick < 0.82) {
        const side = rng() < 0.5 ? 1 : -1;
        traps.push({ type: 'flame', i, j, wi: i + run.dj * side, wj: j + run.di * side, fdi: -run.dj * side, fdj: -run.di * side, phase: rng() * 3 });
      } else {
        const side = rng() < 0.5 ? 1 : -1;
        traps.push({ type: 'arrow', i, j, wi: i + run.dj * side, wj: j + run.di * side, fdi: -run.dj * side, fdj: -run.di * side });
      }
    }
    if (c.tiles.length >= 6 && rng() < 0.3 + floor * 0.04) {
      const t = c.tiles[Math.floor(c.tiles.length / 2)];
      const i = t % W, j = (t - i) / W;
      if (!nearStart(i, j) && !traps.some((q) => q.i === i && q.j === j)) wanderers.push({ i, j, kind: floor >= 2 && rng() < 0.5 ? 'bat' : 'slime' });
    }
  }

  // 大房间内部墙柱（增加地形变化，外圈始终连通）
  for (const r of rooms) {
    if (['monster', 'empty', 'arena', 'treasure', 'library'].indexOf(r.type) < 0 || r.w < 8 || r.h < 8) continue;
    const pat = rng.int(0, 3);
    const cells = [];
    const L = r.x + 2, R = r.x + r.w - 3, U = r.y + 2, D = r.y + r.h - 3;
    if (pat === 0) cells.push([L, U], [R, U], [L, D], [R, D]);
    else if (pat === 1) { const cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1); cells.push([cx, cy], [cx - 1, cy], [cx, cy - 1]); }
    else if (pat === 2) { for (let i = L; i <= R; i += 2) { cells.push([i, U]); cells.push([i, D]); } }
    else { cells.push([L, U], [L + 1, U], [R, D], [R - 1, D]); }
    r.pillars = [];
    for (const [i, j] of cells) {
      if (i <= r.x || j <= r.y || i >= r.x + r.w - 1 || j >= r.y + r.h - 1) continue;
      if (i === r.cx && j === r.cy) continue;
      tile[idx(i, j)] = WALL; region[idx(i, j)] = -1;
      r.pillars.push([i, j]);
    }
  }
  {
    // 内部墙柱后再次校验连通性
    const seen = new Uint8Array(W * H);
    const s0 = idx(rooms[start].cx, rooms[start].cy);
    const q = [s0]; seen[s0] = 1; let cnt = 0, total = 0;
    while (q.length) { const c = q.pop(); cnt++; const ci = c % W, cj = (c - ci) / W; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = idx(ci + di, cj + dj); if (tile[nk] !== WALL && !seen[nk]) { seen[nk] = 1; q.push(nk); } } }
    for (let k2 = 0; k2 < W * H; k2++) if (tile[k2] !== WALL) total++;
    if (cnt !== total) return null;
  }
  // 隐藏密室：在某个房间墙外挖出小房间，用可破坏的裂缝墙连接
  const secrets = [];
  if (floor >= 2 && rng() < 0.65) {
    const cands = rooms.filter((r) => r.type !== 'exit' && r.type !== 'boss' && r.type !== 'start');
    for (let t = 0; t < 40 && !secrets.length; t++) {
      const r = cands[rng.int(0, cands.length - 1)];
      if (!r) break;
      const side = rng.int(0, 3);
      let ci, cj, sx, sy;
      if (side === 0) { ci = rng.int(r.x + 1, r.x + r.w - 2); cj = r.y - 1; sx = ci - 1; sy = cj - 3; }
      else if (side === 1) { ci = rng.int(r.x + 1, r.x + r.w - 2); cj = r.y + r.h; sx = ci - 1; sy = cj + 1; }
      else if (side === 2) { ci = r.x - 1; cj = rng.int(r.y + 1, r.y + r.h - 2); sx = ci - 3; sy = cj - 1; }
      else { ci = r.x + r.w; cj = rng.int(r.y + 1, r.y + r.h - 2); sx = ci + 1; sy = cj - 1; }
      if (sx < 2 || sy < 2 || sx + 3 > W - 2 || sy + 3 > H - 2) continue;
      let ok = tile[idx(ci, cj)] === WALL;
      for (let j = sy - 1; j <= sy + 3 && ok; j++) for (let i = sx - 1; i <= sx + 3 && ok; i++) {
        if (i === ci && j === cj) continue;
        if (tile[idx(i, j)] !== WALL) ok = false;
      }
      if (!ok) continue;
      const id = nextRegion++;
      for (let j = sy; j < sy + 3; j++) for (let i = sx; i < sx + 3; i++) { tile[idx(i, j)] = ROOM; region[idx(i, j)] = id; }
      tile[idx(ci, cj)] = CORR; region[idx(ci, cj)] = id;
      const sr = { id, x: sx, y: sy, w: 3, h: 3, cx: sx + 1, cy: sy + 1, type: 'secret', entrances: [], hasKey: false, parent: r.id, connector: { i: ci, j: cj } };
      rooms.push(sr);
      secrets.push(sr);
    }
  }
  const roomByRegion = {};
  for (const r of rooms) roomByRegion[r.id] = r;
  return { floor, seed, W, H, tile, region, regions: nextRegion, rooms, roomByRegion, corridors, start, exit, boss, keysNeeded: need, traps, wanderers, isEntrance, secrets };
}

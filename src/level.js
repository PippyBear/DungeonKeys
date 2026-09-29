// 由地牢数据生成地面/墙体网格（按区域分块，便于迷雾揭示），并烘焙环境光遮蔽
import * as THREE from 'three';
import { T, WALL, ROOM, CORR } from './dungeon.js';
import { atlasUV, ATLAS } from './textures.js';
import { applyCutaway } from './models.js';
import { makeRng } from './utils.js';
import { K, PIT } from './terrain.js';

export const WH = 3.2; // 墙高
const AO = [1.0, 0.7, 0.52, 0.42, 0.38];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

class MeshData {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.w = []; this.wall = 0; }
  quad(v, nrm, uvs, cols) {
    // v: 4 个顶点（数组 [x,y,z]），自动校正朝向
    _a.set(v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]);
    _b.set(v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]);
    _n.crossVectors(_a, _b);
    let order = [0, 1, 2, 0, 2, 3];
    if (_n.x * nrm[0] + _n.y * nrm[1] + _n.z * nrm[2] < 0) order = [0, 2, 1, 0, 3, 2];
    for (const k of order) {
      this.p.push(v[k][0], v[k][1], v[k][2]);
      this.n.push(nrm[0], nrm[1], nrm[2]);
      this.uv.push(uvs[k][0], uvs[k][1]);
      this.c.push(cols[k], cols[k], cols[k] * 1.04);
      this.w.push(this.wall);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    // aWall=1 的面才会被镂空（墙）；地面、台阶、高台、石柱永远不镂空
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(this.w, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// 楼梯：4 级台阶，侧壁补到邻格高度
function stairMesh(md, st, i, j, x0, x1, z0, z1, nbH, topUV, wallUV, face) {
  const n = 4;
  const P = (f, g, y) => {
    if (st.di === 1) return [x0 + f * T, y, z0 + g * T];
    if (st.di === -1) return [x1 - f * T, y, z0 + g * T];
    if (st.dj === 1) return [x0 + g * T, y, z0 + f * T];
    return [x0 + g * T, y, z1 - f * T];
  };
  const alongX = st.di !== 0;
  const side0 = alongX ? [0, -1] : [-1, 0], side1 = alongX ? [0, 1] : [1, 0];
  const nb0 = nbH(i, j, side0[0], side0[1]), nb1 = nbH(i, j, side1[0], side1[1]);
  const back = nbH(i, j, -st.di, -st.dj);
  const tuv = [[topUV.u0, topUV.v1], [topUV.u0, topUV.v0 + (topUV.v1 - topUV.v0) * 0.75], [topUV.u1, topUV.v0 + (topUV.v1 - topUV.v0) * 0.75], [topUV.u1, topUV.v1]];
  for (let s = 0; s < n; s++) {
    const fa = s / n, fb = (s + 1) / n;
    const hs = st.h0 + (st.h1 - st.h0) * (s + 1) / n;
    const hp = s === 0 ? Math.min(st.h0, back === null ? st.h0 : back) : st.h0 + (st.h1 - st.h0) * s / n;
    const c = 1.0 + (s % 2) * 0.1;
    md.quad([P(fa, 0, hs), P(fa, 1, hs), P(fb, 1, hs), P(fb, 0, hs)], [0, 1, 0], tuv, [c, c, c, c]);
    const rv = [P(fa, 0, hp), P(fa, 1, hp), P(fa, 1, hs), P(fa, 0, hs)];
    md.quad(rv, [-st.di, 0, -st.dj], [[wallUV.u0, wallUV.v1 - 0.03], [wallUV.u1, wallUV.v1 - 0.03], [wallUV.u1, wallUV.v1], [wallUV.u0, wallUV.v1]], [0.5, 0.5, 0.75, 0.75]);
    if (nb0 !== null && nb0 < hs - 0.01) { const a = P(fa, 0, 0), b = P(fb, 0, 0); face(md, a[0], a[2], b[0], b[2], nb0, hs, [side0[0], 0, side0[1]], 0.85); }
    if (nb1 !== null && nb1 < hs - 0.01) { const a = P(fa, 1, 0), b = P(fb, 1, 0); face(md, a[0], a[2], b[0], b[2], nb1, hs, [side1[0], 0, side1[1]], 0.85); }
  }
  const fr = nbH(i, j, st.di, st.dj);
  if (fr !== null && fr < st.h1 - 0.01) { const a = P(1, 0, 0), b = P(1, 1, 0); face(md, a[0], a[2], b[0], b[2], fr, st.h1, [st.di, 0, st.dj]); }
}

// 独立石柱（深渊跳台用）：顶面石板 + 四面侧壁
export function columnGeometry(h0, h1, w = T) {
  const md = new MeshData();
  const topUV = atlasUV(ATLAS.top), wallUV = atlasUV(ATLAS.wall);
  const a = -w / 2, b = w / 2;
  md.quad([[a, h1, a], [a, h1, b], [b, h1, b], [b, h1, a]], [0, 1, 0], [[topUV.u0, topUV.v1], [topUV.u0, topUV.v0], [topUV.u1, topUV.v0], [topUV.u1, topUV.v1]], [1, 1, 1, 1]);
  const uv = [[wallUV.u0, wallUV.v0], [wallUV.u0, wallUV.v1], [wallUV.u1, wallUV.v1], [wallUV.u1, wallUV.v0]];
  md.quad([[b, h0, a], [b, h1, a], [b, h1, b], [b, h0, b]], [1, 0, 0], uv, [0.1, 0.9, 0.9, 0.1]);
  md.quad([[a, h0, b], [a, h1, b], [a, h1, a], [a, h0, a]], [-1, 0, 0], uv, [0.1, 0.9, 0.9, 0.1]);
  md.quad([[b, h0, b], [b, h1, b], [a, h1, b], [a, h0, b]], [0, 0, 1], uv, [0.1, 0.9, 0.9, 0.1]);
  md.quad([[a, h0, a], [a, h1, a], [b, h1, a], [b, h0, a]], [0, 0, -1], uv, [0.1, 0.9, 0.9, 0.1]);
  return md.geometry();
}

export function buildLevel(d, atlas, holes) {
  const { W, H, tile, region } = d;
  const idx = (i, j) => j * W + i;
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? WALL : tile[idx(i, j)]);
  const isWall = (i, j) => at(i, j) === WALL;
  const rng = makeRng(d.seed + 5);
  const data = [];
  for (let r = 0; r < d.regions; r++) data.push(new MeshData());
  const floorUV = atlasUV(ATLAS.floor), corrUV = atlasUV(ATLAS.corridor), wallUV = atlasUV(ATLAS.wall), topUV = atlasUV(ATLAS.top);
  // 渲染高度：石柱单独成网格（可坍塌），在关卡网格里当作深渊
  const rh = (k) => (d.kind[k] === K.STONE ? PIT : d.hgt[k]);
  // 邻格沿共享边的最低高度（墙返回 null）
  const nbH = (i, j, di, dj) => {
    const ni = i + di, nj = j + dj;
    if (isWall(ni, nj)) return null;
    const k = idx(ni, nj);
    const st = d.stairs.get(k);
    if (st) {
      if (-di === st.di && -dj === st.dj) return st.h1;
      return st.h0;
    }
    return rh(k);
  };
  const cornerAO = (ci, cj, h) => {
    // 顶点 (ci,cj) 周围四个格子中墙或更高地形的数量
    let n = 0;
    for (const [a, b] of [[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]]) {
      if (isWall(a, b)) n++;
      else { const k = idx(a, b); if (!d.stairs.has(k) && rh(k) > h + 0.3) n++; }
    }
    return AO[n];
  };
  const sideUV = (hgt, uv) => {
    const f = Math.min(1, Math.max(0.12, hgt / (uv === wallUV ? WH : 2)));
    return [[uv.u0, uv.v1 - (uv.v1 - uv.v0) * f], [uv.u0, uv.v1], [uv.u1, uv.v1], [uv.u1, uv.v1 - (uv.v1 - uv.v0) * f]];
  };
  // 竖直面：沿边 (ax,az)-(bx,bz)，从 y0 到 y1，法线 nrm；深渊井壁用墙砖，抬高地形用石块
  const face = (md, ax, az, bx, bz, y0, y1, nrm, dark = 1) => {
    if (y1 - y0 < 0.01) return;
    const tint = (0.9 + rng() * 0.1) * dark;
    const shaft = y0 < -1;
    const lo = shaft ? 0.1 : 0.5, hi = shaft ? 0.8 : 1.08;
    md.quad([[ax, y0, az], [ax, y1, az], [bx, y1, bz], [bx, y0, bz]], nrm, sideUV(y1 - y0, shaft ? wallUV : topUV), [lo * tint, hi * tint, hi * tint, lo * tint]);
  };
  const edges = [
    { di: 1, dj: 0, e: (x0, x1, z0, z1) => [x1, z0, x1, z1] },
    { di: -1, dj: 0, e: (x0, x1, z0, z1) => [x0, z1, x0, z0] },
    { di: 0, dj: 1, e: (x0, x1, z0, z1) => [x1, z1, x0, z1] },
    { di: 0, dj: -1, e: (x0, x1, z0, z1) => [x0, z0, x1, z0] },
  ];
  // 地面 / 平台 / 深渊
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const t = at(i, j);
    if (t === WALL) continue;
    const k = idx(i, j);
    const md = data[region[k]];
    const x0 = i * T, x1 = x0 + T, z0 = j * T, z1 = z0 + T;
    const st = d.stairs.get(k);
    if (st) { stairMesh(md, st, i, j, x0, x1, z0, z1, nbH, topUV, wallUV, face); continue; }
    const h = rh(k);
    const kd = d.kind[k];
    if (!(holes && holes.has(k))) {
      const uv = kd === K.BLOCK ? topUV : t === ROOM ? floorUV : corrUV;
      const rot = Math.floor(rng() * 4);
      const base = [[uv.u0, uv.v1], [uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1]];
      const uvs = [0, 1, 2, 3].map((q) => base[(q + rot) % 4]);
      const tint = (0.92 + rng() * 0.1) * (h < -1 ? 0.18 : kd === K.BLOCK ? 1.1 : h > 0.5 ? 1.12 : h < -0.5 ? 0.82 : 1);
      const cols = [cornerAO(i, j, h) * tint, cornerAO(i, j + 1, h) * tint, cornerAO(i + 1, j + 1, h) * tint, cornerAO(i + 1, j, h) * tint];
      md.quad([[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0]], [0, 1, 0], uvs, cols);
    }
    // 比邻格高 → 画侧面（悬崖 / 台阶侧壁）
    for (const ed of edges) {
      const nb = nbH(i, j, ed.di, ed.dj);
      if (nb === null || nb >= h - 0.01) continue;
      const [ax, az, bx, bz] = ed.e(x0, x1, z0, z1);
      face(md, ax, az, bx, bz, nb, h, [ed.di, 0, ed.dj]);
    }
  }
  for (const md of data) md.wall = 0;
  // 墙体：只生成与地面相邻的墙
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!isWall(i, j)) continue;
    let owner = -1;
    for (const [di, dj] of dirs) if (!isWall(i + di, j + dj)) { owner = region[idx(i + di, j + dj)]; break; }
    if (owner < 0) {
      for (const [di, dj] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) if (!isWall(i + di, j + dj)) { owner = region[idx(i + di, j + dj)]; break; }
    }
    if (owner < 0) continue;
    const md = data[owner];
    md.wall = 1;
    const x0 = i * T, x1 = x0 + T, z0 = j * T, z1 = z0 + T;
    const tuv = [[topUV.u0, topUV.v1], [topUV.u0, topUV.v0], [topUV.u1, topUV.v0], [topUV.u1, topUV.v1]];
    md.quad([[x0, WH, z0], [x0, WH, z1], [x1, WH, z1], [x1, WH, z0]], [0, 1, 0], tuv, [0.62, 0.62, 0.62, 0.62]);
    for (const [di, dj] of dirs) {
      if (isWall(i + di, j + dj)) continue;
      const nk = idx(i + di, j + dj);
      const y0 = Math.min(0, d.stairs.has(nk) ? 0 : rh(nk));
      // 该面朝向 (di,dj)
      let v;
      if (di === 1) v = [[x1, y0, z0], [x1, WH, z0], [x1, WH, z1], [x1, y0, z1]];
      else if (di === -1) v = [[x0, y0, z1], [x0, WH, z1], [x0, WH, z0], [x0, y0, z0]];
      else if (dj === 1) v = [[x1, y0, z1], [x1, WH, z1], [x0, WH, z1], [x0, y0, z1]];
      else v = [[x0, y0, z0], [x0, WH, z0], [x1, WH, z0], [x1, y0, z0]];
      const uvs = [[wallUV.u0, wallUV.v0], [wallUV.u0, wallUV.v1], [wallUV.u1, wallUV.v1], [wallUV.u1, wallUV.v0]];
      // 侧墙左右边缘若挨着另一面墙（内角）更暗
      const li = i + di + (dj !== 0 ? (dj === 1 ? 1 : -1) : 0) * 1, lj = j + dj + (di !== 0 ? (di === 1 ? -1 : 1) : 0);
      const ri = i + di - (dj !== 0 ? (dj === 1 ? 1 : -1) : 0), rj = j + dj - (di !== 0 ? (di === 1 ? -1 : 1) : 0);
      const lc = isWall(li, lj) ? 0.78 : 1, rc = isWall(ri, rj) ? 0.78 : 1;
      const tint = 0.9 + rng() * 0.12;
      const lo = y0 < -1 ? 0.1 : 0.34;
      md.quad(v, [di, 0, dj], uvs, [lo * lc * tint, 0.95 * lc * tint, 0.95 * rc * tint, lo * rc * tint]);
    }
  }
  for (const md of data) md.wall = 0;
  const opts = { map: atlas.map || atlas, vertexColors: true };
  if (atlas.emissive) { opts.emissiveMap = atlas.emissive; opts.emissive = new THREE.Color(0xffffff); }
  const mat = applyCutaway(new THREE.MeshLambertMaterial(opts), 0.95, true);
  // 可站立地形（深渊石柱等独立网格）：不镂空，跳上去永远看得见
  const tmat = new THREE.MeshLambertMaterial(opts);
  const groups = [];
  for (let r = 0; r < d.regions; r++) {
    const g = new THREE.Group();
    if (data[r].p.length) {
      const m = new THREE.Mesh(data[r].geometry(), mat);
      m.receiveShadow = true;
      m.castShadow = true;
      g.add(m);
    }
    g.visible = false;
    groups.push(g);
  }
  return { groups, mat, tmat };
}

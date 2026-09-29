// 有机体网格：用 SDF 基元（椭球 / 圆锥胶囊）平滑融合成一整块身体，Marching Cubes 提取表面，
// 按基元所属骨骼自动计算蒙皮权重，CPU 蒙皮（小游戏 WebGL1 不保证支持 GPU 蒙皮）
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';

// ---------------------------------------------------------------- SDF 基元
function sdEll(x, y, z, p) {
  const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
  const rx = p.r[0], ry = p.r[1], rz = p.r[2];
  const k0 = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2);
  const k1 = Math.sqrt((dx / (rx * rx)) ** 2 + (dy / (ry * ry)) ** 2 + (dz / (rz * rz)) ** 2);
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}
// iq 圆锥胶囊（两端半径不同）
function sdCone(x, y, z, p) {
  const a = p.a, b = p.b, r1 = p.r1, r2 = p.r2;
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
  const xvx = pax * l2 - bax * yy, xvy = pay * l2 - bay * yy, xvz = paz * l2 - baz * yy;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
  const y2 = yy * yy * l2, z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}
function sdBox(x, y, z, p) {
  const qx = Math.abs(x - p.c[0]) - p.b[0], qy = Math.abs(y - p.c[1]) - p.b[1], qz = Math.abs(z - p.c[2]) - p.b[2];
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - (p.rr || 0);
}
// 基元包围球（用于跳过远处基元的计算）
function bsphere(p) {
  if (p.bc) return;
  if (p.t === 'ell') { p.bc = p.c; p.br = Math.max(p.r[0], p.r[1], p.r[2]); }
  else if (p.t === 'box') { p.bc = p.c; p.br = Math.sqrt(p.b[0] ** 2 + p.b[1] ** 2 + p.b[2] ** 2) + (p.rr || 0); }
  else if (p.t === 'fn') { const a = p.bb[0], b = p.bb[1]; p.bc = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; p.br = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2) / 2; }
  else { p.bc = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2]; p.br = Math.sqrt((p.b[0] - p.a[0]) ** 2 + (p.b[1] - p.a[1]) ** 2 + (p.b[2] - p.a[2]) ** 2) / 2 + Math.max(p.r1, p.r2); }
}
function lowerBound(x, y, z, p) { const dx = x - p.bc[0], dy = y - p.bc[1], dz = z - p.bc[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz) - p.br; }
export function sdPrim(x, y, z, p) {
  let d = p.t === 'ell' ? sdEll(x, y, z, p) : p.t === 'box' ? sdBox(x, y, z, p) : p.t === 'fn' ? p.f(x, y, z) : sdCone(x, y, z, p);
  if (p.clip) for (const c of p.clip) d = Math.max(d, c(x, y, z));
  return d;
}
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
// 一组基元的平滑并集
export function unionField(prims, inflate = 0) {
  const add = [], subs = [];
  for (const p of prims) { bsphere(p); (p.sub ? subs : add).push(p); }
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < add.length; i++) {
      const p = add[i];
      const k = p.k === undefined ? 0.06 : p.k;
      // 离得比当前最近距离还远（加上融合半径）的基元不可能影响结果
      if (lowerBound(x, y, z, p) > d + k) continue;
      d = smin(d, sdPrim(x, y, z, p), k);
    }
    for (let i = 0; i < subs.length; i++) { const p = subs[i]; if (lowerBound(x, y, z, p) > 0) continue; d = Math.max(d, -sdPrim(x, y, z, p)); }
    return d - inflate;
  };
}

// ---------------------------------------------------------------- Marching Cubes
// Bourke 标准角点 / 边定义
const EDGE_AXIS = [0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2];
const EDGE_BASE = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];

export function polygonize(field, bmin, bmax, cell) {
  const nx = Math.ceil((bmax[0] - bmin[0]) / cell) + 1, ny = Math.ceil((bmax[1] - bmin[1]) / cell) + 1, nz = Math.ceil((bmax[2] - bmin[2]) / cell) + 1;
  const N = nx * ny * nz;
  const f = new Float32Array(N);
  const id = (i, j, k) => (k * ny + j) * nx + i;
  // 先算粗网格；离表面足够远的细网格节点直接沿用粗网格的值（距离场的 Lipschitz 性质）
  const S = 4;
  const cx = Math.ceil((nx - 1) / S) + 1, cy = Math.ceil((ny - 1) / S) + 1, cz = Math.ceil((nz - 1) / S) + 1;
  const cf = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) cf[(k * cy + j) * cx + i] = field(bmin[0] + i * S * cell, bmin[1] + j * S * cell, bmin[2] + k * S * cell);
  const margin = cell * (S * 1.8 + 2);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ci = Math.min(cx - 1, Math.round(i / S)), cj = Math.min(cy - 1, Math.round(j / S)), ck = Math.min(cz - 1, Math.round(k / S));
    const q = cf[(ck * cy + cj) * cx + ci];
    f[id(i, j, k)] = Math.abs(q) > margin ? q : field(bmin[0] + i * cell, bmin[1] + j * cell, bmin[2] + k * cell);
  }
  const cache = [new Int32Array(N).fill(-1), new Int32Array(N).fill(-1), new Int32Array(N).fill(-1)];
  const pos = [], idx = [];
  const vert = (i, j, k, e) => {
    const b = EDGE_BASE[e], ax = EDGE_AXIS[e];
    const bi = i + b[0], bj = j + b[1], bk = k + b[2];
    const n0 = id(bi, bj, bk);
    const c = cache[ax];
    if (c[n0] >= 0) return c[n0];
    const n1 = ax === 0 ? n0 + 1 : ax === 1 ? n0 + nx : n0 + nx * ny;
    const f0 = f[n0], f1 = f[n1];
    const t = Math.abs(f1 - f0) < 1e-9 ? 0.5 : f0 / (f0 - f1);
    const x = bmin[0] + (bi + (ax === 0 ? t : 0)) * cell, y = bmin[1] + (bj + (ax === 1 ? t : 0)) * cell, z = bmin[2] + (bk + (ax === 2 ? t : 0)) * cell;
    const vi = pos.length / 3;
    pos.push(x, y, z);
    c[n0] = vi;
    return vi;
  };
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let ci = 0;
    for (let q = 0; q < 8; q++) { const o = CORNER[q]; if (f[id(i + o[0], j + o[1], k + o[2])] < 0) ci |= 1 << q; }
    if (!edgeTable[ci]) continue;
    const o = ci * 16;
    for (let q = 0; triTable[o + q] !== -1; q += 3) {
      idx.push(vert(i, j, k, triTable[o + q]), vert(i, j, k, triTable[o + q + 1]), vert(i, j, k, triTable[o + q + 2]));
    }
  }
  return { pos: new Float32Array(pos), idx };
}

// 梯度法线 + 绕序校正
function finish(field, pos, idx) {
  const n = pos.length / 3;
  const nrm = new Float32Array(pos.length);
  const e = 0.004;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let gx = field(x + e, y, z) - field(x - e, y, z), gy = field(x, y + e, z) - field(x, y - e, z), gz = field(x, y, z + e) - field(x, y, z - e);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    nrm[v * 3] = gx / l; nrm[v * 3 + 1] = gy / l; nrm[v * 3 + 2] = gz / l;
  }
  // 抽样检查三角形朝向与法线是否一致，不一致就整体翻转
  let dot = 0;
  for (let t = 0; t < Math.min(idx.length, 600); t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
    dot += cx * nrm[a] + cy * nrm[a + 1] + cz * nrm[a + 2];
  }
  if (dot < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  return nrm;
}

// 由基元距离算颜色与蒙皮权重（离哪块近就更像哪块，关节处自然过渡）
function shade(pos, nrm, prims, paints, boneCount, opt) {
  const n = pos.length / 3;
  const col = new Float32Array(n * 3);
  const sIdx = new Uint8Array(n * 4), sW = new Float32Array(n * 4);
  const acc = new Float32Array(boneCount);
  const tmp = new THREE.Color();
  const shapePrims = prims.filter((p) => !p.sub);
  for (const p of shapePrims) bsphere(p);
  const ds = new Float32Array(shapePrims.length);
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    // 远处基元权重可忽略：用包围球下界代替精确距离
    let lbMin = 1e9;
    for (let q = 0; q < shapePrims.length; q++) { const lb = lowerBound(x, y, z, shapePrims[q]); ds[q] = lb; if (lb < lbMin) lbMin = lb; }
    for (let q = 0; q < shapePrims.length; q++) { if (ds[q] < lbMin + 0.25) ds[q] = sdPrim(x, y, z, shapePrims[q]); else ds[q] = Math.max(ds[q], 0.25); }
    let dmin = 1e9;
    for (const d of ds) dmin = Math.min(dmin, d);
    acc.fill(0);
    let r = 0, g = 0, b = 0, cw = 0;
    const wo = opt.weightFn ? opt.weightFn(x, y, z) : null;
    if (wo) for (const [bi, w] of wo) acc[bi] += w;
    for (let q = 0; q < shapePrims.length; q++) {
      const p = shapePrims[q];
      const w = Math.exp(-(ds[q] - dmin) / (p.soft || 0.03));
      if (!wo) acc[p.bone] += w;
      if (!opt.color) { tmp.setHex(p.col); r += tmp.r * w; g += tmp.g * w; b += tmp.b * w; cw += w; }
    }
    if (opt.color) { tmp.setHex(opt.color(x, y, z)); r = tmp.r; g = tmp.g; b = tmp.b; cw = 1; }
    r /= cw; g /= cw; b /= cw;
    // 仅着色的「涂装」区域（口鼻、肚皮、熊猫花纹…）
    if (paints) for (const pt of paints) {
      const d = sdEll(x, y, z, pt);
      if (d < pt.soft) {
        const k = Math.min(1, (pt.soft - d) / (pt.soft * 2)) * (pt.a || 1);
        tmp.setHex(pt.col);
        r += (tmp.r - r) * k; g += (tmp.g - g) * k; b += (tmp.b - b) * k;
      }
    }
    // 毛色细微斑驳 + 下方略暗
    const noise = opt.noise === 0 ? 0 : (Math.sin(x * 91 + y * 57) * Math.sin(z * 73 + y * 41)) * (opt.noise || 0.035);
    const ao = opt.ao === false ? 1 : 0.82 + 0.18 * Math.min(1, Math.max(0, (nrm[v * 3 + 1] + 1) * 0.6));
    col[v * 3] = Math.max(0, r * (1 + noise) * ao); col[v * 3 + 1] = Math.max(0, g * (1 + noise) * ao); col[v * 3 + 2] = Math.max(0, b * (1 + noise) * ao);
    // 取权重最大的 4 根骨骼
    let tot = 0;
    for (let s = 0; s < 4; s++) {
      let bi = 0, bw = -1;
      for (let q = 0; q < boneCount; q++) if (acc[q] > bw) { bw = acc[q]; bi = q; }
      sIdx[v * 4 + s] = bi; sW[v * 4 + s] = Math.max(0, bw); acc[bi] = -1; tot += Math.max(0, bw);
    }
    for (let s = 0; s < 4; s++) sW[v * 4 + s] /= tot || 1;
  }
  return { col, sIdx, sW };
}

// 构建一块表面模板：field 决定形状；weightPrims 决定颜色与蒙皮（衣服用身体基元算权重）
export function buildSurface({ field, bmin, bmax, cell, weightPrims, paints, boneCount, color, noise, weightFn, aoField, furFn }) {
  const { pos, idx } = polygonize(field, bmin, bmax, cell);
  const nrm = finish(field, pos, idx);
  const { col, sIdx, sW } = shade(pos, nrm, weightPrims, paints, boneCount, { color, noise, ao: false, weightFn });
  const n = pos.length / 3;
  // 烘焙环境光遮蔽：沿法线取样距离场，褶皱、腋下、脖子、吻部根部自然变暗
  const af = aoField || field;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
    let occ = 0, w = 1;
    for (let k = 1; k <= 5; k++) { const h = 0.02 * k; occ += Math.max(0, h - af(x + nx * h, y + ny * h, z + nz * h)) * w; w *= 0.6; }
    const ao = Math.max(0.3, Math.min(1, 1 - occ * 4.5)) * (0.9 + 0.1 * Math.max(0, ny));
    col[v * 3] *= ao; col[v * 3 + 1] *= ao; col[v * 3 + 2] *= ao;
  }
  let fur = null;
  if (furFn) { fur = new Float32Array(n); for (let v = 0; v < n; v++) fur[v] = furFn(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
  return { pos, nrm, col, sIdx, sW, fur, idx: n > 65000 ? new Uint32Array(idx) : new Uint16Array(idx) };
}

// 沿射线找到表面点（用于把眼睛、爪子贴在皮肤上）
export function surfaceAlong(field, o, dir, maxT = 0.6) {
  let t0 = 0, t1 = maxT;
  if (field(o[0], o[1], o[2]) > 0) return o.slice();
  for (let s = 0; s < 32; s++) {
    const t = (t0 + t1) / 2;
    if (field(o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t) < 0) t0 = t; else t1 = t;
  }
  return [o[0] + dir[0] * t0, o[1] + dir[1] * t0, o[2] + dir[2] * t0];
}

// ---------------------------------------------------------------- CPU 蒙皮
const RIGS = new Set();
const _inv = new THREE.Matrix4();
export class SkinnedRig {
  constructor(bones, bindPos, pivot) {
    this.bones = bones;            // Object3D[]
    this.pivot = pivot;
    this.bindInv = bindPos.map((p) => new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
    this.mats = bones.map(() => new THREE.Matrix4());
    this.surfaces = [];
    this.away = 0;
    this.lod = true;
    this.lodPhase = (Math.random() * 2) | 0;
    RIGS.add(this);
  }
  addSurface(tpl, material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tpl.pos), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tpl.nrm), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(tpl.col, 3));
    g.setAttribute('aRest', new THREE.BufferAttribute(tpl.pos, 3));
    g.setAttribute('aFur', new THREE.BufferAttribute(tpl.fur || new Float32Array(tpl.pos.length / 3), 1));
    g.setIndex(new THREE.BufferAttribute(tpl.idx, 1));
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    m.castShadow = true;
    this.pivot.add(m);
    this.surfaces.push({ tpl, g, m });
    return m;
  }
  // 共享同一几何体的附加网格（毛发外壳），不参与蒙皮计算
  addLayer(mesh, material) {
    const m = new THREE.Mesh(mesh.geometry, material);
    m.frustumCulled = false;
    m.userData.outline = true; // 让场景销毁时不重复释放几何体
    mesh.add(m);
    return m;
  }
  skin() {
    const pv = this.pivot;
    pv.updateMatrixWorld(true);
    _inv.copy(pv.matrixWorld).invert();
    for (let i = 0; i < this.bones.length; i++) this.mats[i].multiplyMatrices(_inv, this.bones[i].matrixWorld).multiply(this.bindInv[i]);
    const M = this.mats.map((m) => m.elements);
    for (const s of this.surfaces) {
      const { tpl, g } = s;
      const P = g.attributes.position.array, Nn = g.attributes.normal.array;
      const bp = tpl.pos, bn = tpl.nrm, si = tpl.sIdx, sw = tpl.sW;
      const n = bp.length / 3;
      for (let v = 0; v < n; v++) {
        const x = bp[v * 3], y = bp[v * 3 + 1], z = bp[v * 3 + 2];
        const nx = bn[v * 3], ny = bn[v * 3 + 1], nz = bn[v * 3 + 2];
        let ox = 0, oy = 0, oz = 0, qx = 0, qy = 0, qz = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw[v * 4 + k];
          if (w < 0.001) continue;
          const e = M[si[v * 4 + k]];
          ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
          oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
          oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
          qx += w * (e[0] * nx + e[4] * ny + e[8] * nz);
          qy += w * (e[1] * nx + e[5] * ny + e[9] * nz);
          qz += w * (e[2] * nx + e[6] * ny + e[10] * nz);
        }
        P[v * 3] = ox; P[v * 3 + 1] = oy; P[v * 3 + 2] = oz;
        const l = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
        Nn[v * 3] = qx / l; Nn[v * 3 + 1] = qy / l; Nn[v * 3 + 2] = qz / l;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
    }
  }
}
function inScene(o) {
  let v = true;
  while (o) { if (!o.visible) v = false; if (o.isScene) return v ? 1 : 0; o = o.parent; }
  return -1;
}
// 每帧渲染前调用：只蒙皮场景中可见的角色；脱离场景的角色自动注销
let _frame = 0;
const _wp = new THREE.Vector3(), _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
export function skinAll(camera) {
  _frame++;
  if (camera) { _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frus.setFromProjectionMatrix(_pm); }
  for (const r of RIGS) {
    const s = inScene(r.pivot);
    if (s === 1) {
      r.away = 0;
      // 视野外不蒙皮；远处的角色隔帧更新
      if (camera) {
        r.pivot.getWorldPosition(_wp);
        _sph.set(_wp.setY(_wp.y + 0.9), 1.4);
        if (!_frus.intersectsSphere(_sph)) continue;
        if (r.lod && _wp.distanceTo(camera.position) > 16 && (_frame + r.lodPhase) % 2) continue;
      }
      r.skin();
    }
    else if (s === -1 && ++r.away > 90) RIGS.delete(r);
  }
}
export function clearRigs() { RIGS.clear(); }

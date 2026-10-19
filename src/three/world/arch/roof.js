import * as THREE from 'three';
import { Y_AXIS, chiwenGeometry, finialGeometry } from './kit.js';

/**
 * 中国古典屋顶：
 *  - shell()       四坡屋面（庑殿 / 歇山的下半 / 攒尖的底），带举折曲线与翘角
 *  - gable()       两坡屋面（悬山/硬山，可做卷棚），带山花与博风板
 *  - xieshan()     歇山顶 = 四坡腰檐 + 上部两坡山花
 *  - pyramidRect() 方亭攒尖顶
 *  - hexPyramid()  六角亭攒尖顶
 * 细部：正脊/鸱吻、垂脊、翘角、瓦当（Instanced）、檐椽、檐口板。
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const CAP_SCALE = new THREE.Vector3(0.075, 0.13, 0.075);
const CAP_UP = new THREE.Vector3(0, 1, 0);
const TILE_M = 2.72; // 一张瓦垄贴图对应的米数（8 垄 × 0.34m）

function ease(v, curve) {
  return 1 - Math.pow(1 - v, curve);
}

function liftAt(u, flare, pow = 3.2) {
  const a = Math.abs(2 * u - 1);
  return flare * Math.pow(a, pow);
}

/* ------------------------------------------------------------------ 瓦当 */

function addTileCap(capInst, B, x, y, z, ox, oy, oz) {
  if (!capInst) return;
  _p.set(x, y, z);
  _d.set(ox, oy, oz).normalize();
  _q.setFromUnitVectors(CAP_UP, _d);
  _m.compose(_p, _q, CAP_SCALE);
  capInst.addAt(B, _m);
}

function capsAlong(capInst, B, pts, spacing, flip = false) {
  if (!capInst || pts.length < 2) return;
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1e-4;
    const dx = (b[0] - a[0]) / len;
    const dz = (b[2] - a[2]) / len;
    const nx = flip ? dz : -dz;
    const nz = flip ? -dx : dx;
    let s = carry;
    while (s < len) {
      const t = s / len;
      addTileCap(
        capInst, B,
        a[0] + (b[0] - a[0]) * t + nx * 0.05,
        a[1] + (b[1] - a[1]) * t - 0.11,
        a[2] + (b[2] - a[2]) * t + nz * 0.05,
        nx * 0.96, -0.2, nz * 0.96
      );
      s += spacing;
    }
    carry = s - len;
  }
}

/* ------------------------------------------------------------- 曲面工具 */

function makeGrid(segU, segV, fn) {
  const count = (segU + 1) * (segV + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const idx = [];
  const pts = [];
  for (let j = 0; j <= segV; j++) {
    const row = [];
    for (let i = 0; i <= segU; i++) {
      const p = fn(i / segU, j / segV);
      row.push(p);
      const k = j * (segU + 1) + i;
      pos[k * 3] = p[0];
      pos[k * 3 + 1] = p[1];
      pos[k * 3 + 2] = p[2];
      uv[k * 2] = p[3];
      uv[k * 2 + 1] = p[4];
    }
    pts.push(row);
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i;
      const b = a + 1;
      const c = a + segU + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, pts };
}

/* ---------------------------------------------------------------- 四坡顶 */

export function shell(B, o) {
  const {
    mat = 'tileA',
    eaveW, eaveD, topW = 0.2, topD = 0.2,
    eaveY, topY,
    curve = 1.55,
    flare = 0.5,
    segU = 10, segV = 5,
    fascia = 0.2, fasciaMat = 'ridge',
    capInst = null, tileCaps = true, capSpacing = 0.45,
    hipRidge = true, hipMat = 'ridge',
    rafters = false, rafterMat = 'woodDark',
    cornerHorn = true,
  } = o;

  const hw = eaveW / 2;
  const hd = eaveD / 2;
  const cornerPush = flare * 0.85;
  const rawCorners = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
  const corners = rawCorners.map(([x, z]) => {
    const len = Math.hypot(x, z) || 1;
    return [x + (x / len) * cornerPush, z + (z / len) * cornerPush];
  });
  const topCorners = [
    [-topW / 2, topD / 2], [topW / 2, topD / 2],
    [topW / 2, -topD / 2], [-topW / 2, -topD / 2],
  ];

  const ring = [];
  let ringDist = 0;

  for (let s = 0; s < 4; s++) {
    const A = corners[s];
    const Bp = corners[(s + 1) % 4];
    const TA = topCorners[s];
    const TB = topCorners[(s + 1) % 4];
    const edgeLen = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
    // 每边单独生成，边界控制点与相邻边完全一致（无裂缝）
    const segLen = Math.max(4, segU);
    const grid = makeGrid(segLen, segV, (u, v) => {
      const rx = A[0] + (Bp[0] - A[0]) * u;
      const rz = A[1] + (Bp[1] - A[1]) * u;
      const rxTop = TA[0] + (TB[0] - TA[0]) * u;
      const rzTop = TA[1] + (TB[1] - TA[1]) * u;
      const outerY = eaveY + liftAt(u, flare);
      const x = rxTop + (rx - rxTop) * v;
      const z = rzTop + (rz - rzTop) * v;
      const y = topY + (outerY - topY) * ease(v, curve);
      const uvx = ((edgeLen * u) / TILE_M) + ringDist / TILE_M;
      const uvy = v * 1.05;
      return [x, y, z, uvx, uvy];
    });
    B.addGeo(mat, grid.geo);
    // 该边 eave 环点
    for (let i = 0; i < segLen; i++) {
      const p = grid.pts[segV][i];
      ring.push([p[0], p[1], p[2]]);
    }
    ringDist += edgeLen;
    // 檐口板
    for (let i = 0; i < segLen; i++) {
      const a = grid.pts[segV][i];
      const b = grid.pts[segV][i + 1];
      B.bar(fasciaMat, [a[0], a[1] - fascia * 0.5, a[2]], [b[0], b[1] - fascia * 0.5, b[2]], 0.15, fascia);
    }
    // 檐椽
    if (rafters) {
      const vv = 0.62;
      const jj = Math.max(1, Math.round(segV * vv));
      const step = Math.max(1, Math.round(segLen / 14));
      for (let i = 1; i < segLen; i += step) {
        const a = grid.pts[jj][i];
        const b = grid.pts[segV][i];
        B.bar(rafterMat, [a[0], a[1] - 0.17, a[2]], [b[0], b[1] - 0.16, b[2]], 0.075, 0.1);
      }
    }
    // 垂脊（从内圈角点到檐角）
    if (hipRidge) {
      const tC = topCorners[s];
      const oC = corners[s];
      const my = topY + (eaveY + flare - topY) * 0.62 + 0.1;
      B.tube(hipMat, [
        [tC[0], topY - 0.02, tC[1]],
        [(tC[0] + oC[0]) / 2, my, (tC[1] + oC[1]) / 2],
        [oC[0], eaveY + flare - 0.02, oC[1]],
      ], 0.085, 5, 5);
    }
    // 翘角
    if (cornerHorn) {
      const oC = corners[s];
      const len = Math.hypot(oC[0], oC[1]) || 1;
      const ox = oC[0] / len;
      const oz = oC[1] / len;
      B.tube(hipMat, [
        [oC[0] - ox * 0.25, eaveY + liftAt(0.94, flare) - 0.02, oC[1] - oz * 0.25],
        [oC[0] + ox * 0.18, eaveY + flare + 0.3, oC[1] + oz * 0.18],
        [oC[0] + ox * 0.62, eaveY + flare + 0.78, oC[1] + oz * 0.62],
      ], 0.1, 5, 5);
      B.cyl(hipMat, 0.015, 0.075, 0.34, 5, oC[0] + ox * 0.78, eaveY + flare + 0.95, oC[1] + oz * 0.78, {
        rx: oz * 0.9, rz: -ox * 0.9,
      });
    }
  }

  // 瓦当
  if (capInst && tileCaps) {
    const pts = ring.map((p) => [p[0], p[1] - 0.05, p[2]]);
    capsAlong(capInst, B, pts, capSpacing);
    // 补上首尾相接处
    capsAlong(capInst, B, [pts[pts.length - 1], pts[0]], capSpacing);
  }

  // 环形脊（正脊/博脊用）
  return { ring, corners, topCorners, eaveY, topY };
}

/* ---------------------------------------------------------------- 两坡顶 */

export function gable(B, o) {
  const {
    mat = 'tileA',
    w, d, eaveY, topY,
    curve = 1.4,
    flare = 0.36,
    segU = 10, segV = 4,
    fascia = 0.16, fasciaMat = 'ridge',
    gableEnds = true, gableMat = 'plaster', bargeMat = 'ridge',
    capInst = null, tileCaps = true, capSpacing = 0.45,
    ridge = true, chiwen = true, round = false,
    rafters = false, rafterMat = 'woodDark',
  } = o;
  const rise = topY - eaveY;
  const eavePts = [];
  for (const side of [1, -1]) {
    const grid = makeGrid(segU, segV, (u, v) => {
      const x = (u - 0.5) * w;
      const z = side * (d / 2) * v;
      const outerY = eaveY + liftAt(u, flare);
      const y = topY + (outerY - topY) * ease(v, curve);
      return [x, y, z, (x / TILE_M), v * 1.0];
    });
    B.addGeo(mat, grid.geo);
    // 檐口板 + 瓦当
    const line = [];
    for (let i = 0; i <= segU; i++) {
      const p = grid.pts[segV][i];
      line.push([p[0], p[1], p[2]]);
    }
    for (let i = 0; i < segU; i++) {
      const a = line[i];
      const b = line[i + 1];
      B.bar(fasciaMat, [a[0], a[1] - fascia * 0.5, a[2]], [b[0], b[1] - fascia * 0.5, b[2]], 0.14, fascia);
    }
    if (capInst && tileCaps) capsAlong(capInst, B, line.map((p) => [p[0], p[1] - 0.05, p[2]]), capSpacing, side === -1);
    if (side === 1) eavePts.push(line);
    // 檐椽
    if (rafters) {
      const jj = Math.max(1, Math.round(segV * 0.62));
      const step = Math.max(1, Math.round(segU / 14));
      for (let i = 1; i < segU; i += step) {
        const a = grid.pts[jj][i];
        const b = grid.pts[segV][i];
        B.bar(rafterMat, [a[0], a[1] - 0.15, a[2]], [b[0], b[1] - 0.14, b[2]], 0.075, 0.1);
      }
    }
  }

  // 山花（两端垂直三角面，底边贴檐口、顶到脊）
  if (gableEnds) {
    const shape = new THREE.Shape();
    const n = 10;
    shape.moveTo(-d / 2, eaveY);
    shape.lineTo(d / 2, eaveY);
    // +Z 侧曲线回到脊
    for (let i = n; i >= 0; i--) {
      const v = i / n;
      const z = (d / 2) * v;
      const y = topY + (eaveY + liftAt(0.5, flare) - topY) * ease(v, curve);
      shape.lineTo(z, y);
    }
    // -Z 侧曲线向下
    for (let i = 1; i <= n; i++) {
      const v = i / n;
      const z = -(d / 2) * v;
      const y = topY + (eaveY + liftAt(0.5, flare) - topY) * ease(v, curve);
      shape.lineTo(z, y);
    }
    for (const side of [1, -1]) {
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false, curveSegments: 4 });
      g.rotateY(Math.PI / 2);
      g.translate(side * (w / 2 - 0.1) - side * 0.07, 0, 0);
      B.addGeo(gableMat, g);
    }
    // 博风板（沿两端山面斜边）
    for (const side of [1, -1]) {
      const x = side * (w / 2 + 0.02);
      for (const zs of [1, -1]) {
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const v = i / n;
          const z = zs * (d / 2) * v;
          const y = topY + (eaveY + liftAt(0.5, flare) - topY) * ease(v, curve) + 0.03;
          const p = [x, y, z];
          if (prev) B.bar(bargeMat, prev, p, 0.1, 0.22);
          prev = p;
        }
      }
    }
  }

  // 正脊
  if (ridge) {
    if (round) {
      B.cyl('tileA', 0.42, 0.42, w + 0.1, 10, 0, topY - 0.06, 0, { rz: Math.PI / 2 });
      for (const side of [1, -1]) {
        B.bar(fasciaMat, [-w / 2, topY - 0.12, side * 0.3], [w / 2, topY - 0.12, side * 0.3], 0.1, 0.1);
      }
    } else {
      mainRidge(B, { length: w + 0.2, y: topY + 0.12, mat: 'ridge', chiwen: chiwen && w > 3, scale: 1 });
    }
  }
  return { eavePts };
}

/* ---------------------------------------------------------------- 正脊 */

export function mainRidge(B, o) {
  const {
    length, y, x = 0, z = 0, ry = 0,
    mat = 'ridge', chiwen = true, scale = 1, thin = false,
  } = o;
  B.push(x, 0, z, ry);
  const h = thin ? 0.2 : 0.3;
  const w = thin ? 0.22 : 0.34;
  B.box(mat, length, h, w, 0, y, 0, {});
  B.box('ridgeDark', length + 0.08, 0.09, w * 0.66, 0, y + h / 2 - 0.01, 0, {});
  // 脊上小花饰
  const n = Math.max(2, Math.round(length / 1.1));
  for (let i = 1; i < n; i++) {
    const px = -length / 2 + (length / n) * i;
    B.box('ridgeDark', 0.14, 0.1, w * 0.9, px, y + h / 2 + 0.05, 0, {});
  }
  if (chiwen) {
    const geo = chiwenGeometry();
    for (const side of [-1, 1]) {
      const g = geo.clone();
      _m.makeScale(scale * 1.0, scale * 0.92, scale * 0.9);
      _m.setPosition(side * (length / 2 + 0.12 * scale), y + h / 2 - 0.04, 0);
      g.applyMatrix4(_m);
      B.addGeo('ridge', g);
    }
  }
  B.pop();
}

/* -------------------------------------------------------------- 歇山顶 */

export function xieshan(B, o) {
  const {
    w, d, eaveY, rise,
    eaveOverX = 1.15, eaveOverZ = 1.35,
    mat = 'tileA', hipMat = 'ridge',
    flare = 0.5, segU = 10,
    capInst = null, tileCaps = true, capSpacing = 0.45,
    rafters = true,
    waistRatio = [0.64, 0.46],
    upperScale = 0.9,
  } = o;

  const eaveW = w + eaveOverX * 2;
  const eaveD = d + eaveOverZ * 2;
  const topY = eaveY + rise;
  const waistW = w * waistRatio[0];
  const waistD = d * waistRatio[1];
  const waistY = eaveY + rise * 0.46;

  shell(B, {
    mat, eaveW, eaveD, topW: waistW, topD: waistD,
    eaveY, topY: waistY,
    flare, segU, curve: 1.55,
    capInst, tileCaps, capSpacing,
    hipRidge: true, hipMat,
    rafters, fasciaMat: hipMat,
    cornerHorn: true,
  });
  // 博脊（腰檐上沿）
  const bw = waistW / 2;
  const bd = waistD / 2;
  B.box(hipMat, waistW + 0.2, 0.16, 0.22, 0, waistY + 0.02, bd - 0.02, {});
  B.box(hipMat, waistW + 0.2, 0.16, 0.22, 0, waistY + 0.02, -bd + 0.02, {});
  B.box(hipMat, 0.22, 0.16, waistD + 0.2, bw - 0.02, waistY + 0.02, 0, {});
  B.box(hipMat, 0.22, 0.16, waistD + 0.2, -bw + 0.02, waistY + 0.02, 0, {});
  // 上部两坡
  const upW = waistW + 0.5 * upperScale;
  const upD = waistD + 0.9 * upperScale;
  gable(B, {
    mat, w: upW, d: upD,
    eaveY: waistY - 0.08, topY,
    flare: 0.3, segU: Math.max(6, segU - 2), segV: 3,
    capInst, tileCaps, capSpacing,
    fasciaMat: hipMat, bargeMat: hipMat,
    rafters: false,
    ridge: true, chiwen: true,
  });
  return { ridgeY: topY };
}

/* -------------------------------------------------------------- 攒尖顶 */

export function pyramidRect(B, o) {
  const {
    w, d, eaveY, rise,
    overX = 0.9, overZ = 0.9,
    mat = 'tileA', hipMat = 'ridge',
    flare = 0.5, capInst = null, tileCaps = true, capSpacing = 0.42,
    finial = true,
  } = o;
  const eaveW = w + overX * 2;
  const eaveD = d + overZ * 2;
  const topY = eaveY + rise;
  shell(B, {
    mat, eaveW, eaveD, topW: 0.14, topD: 0.14,
    eaveY, topY, flare, segU: 8, segV: 5,
    capInst, tileCaps, capSpacing, hipRidge: true, hipMat, cornerHorn: true,
    rafters: false,
  });
  if (finial) {
    const geo = finialGeometry().clone();
    _m.makeScale(0.9, 1.15, 0.9);
    _m.setPosition(0, topY - 0.02, 0);
    geo.applyMatrix4(_m);
    B.addGeo('bronze', geo);
  }
  return { topY };
}

/* ------------------------------------------------------------ 六角攒尖顶 */

export function hexPyramid(B, o) {
  const {
    eaveR, eaveY, rise, flare = 0.42,
    mat = 'tileB', hipMat = 'ridge',
    rotation = 0, segU = 4, segV = 4,
    capInst = null, tileCaps = true, capSpacing = 0.42,
    finial = true,
  } = o;
  const topY = eaveY + rise;
  const topR = 0.12;
  const corners = [];
  const tCorners = [];
  for (let k = 0; k < 6; k++) {
    const a = rotation + (k * Math.PI) / 3;
    const push = flare * 0.5;
    corners.push([
      Math.cos(a) * (eaveR + push),
      eaveY + flare,
      Math.sin(a) * (eaveR + push),
    ]);
    tCorners.push([Math.cos(a) * topR, topY, Math.sin(a) * topR]);
  }
  const eaveLines = [];
  for (let k = 0; k < 6; k++) {
    const A = corners[k];
    const Bp = corners[(k + 1) % 6];
    const TA = tCorners[k];
    const TB = tCorners[(k + 1) % 6];
    const edgeLen = Math.hypot(Bp[0] - A[0], Bp[2] - A[2]);
    const grid = makeGrid(segU, segV, (u, v) => {
      const rx = A[0] + (Bp[0] - A[0]) * u;
      const rz = A[2] + (Bp[2] - A[2]) * u;
      const ry = eaveY + flare * Math.pow(Math.abs(2 * u - 1), 3.0);
      const tx = TA[0] + (TB[0] - TA[0]) * u;
      const tz = TA[2] + (TB[2] - TA[2]) * u;
      const x = tx + (rx - tx) * v;
      const z = tz + (rz - tz) * v;
      const y = topY + (ry - topY) * ease(v, 1.45);
      return [x, y, z, (edgeLen * u) / TILE_M, v * 1.0];
    });
    B.addGeo(mat, grid.geo);
    // 檐口 + 瓦当
    const line = [];
    for (let i = 0; i <= segU; i++) {
      const p = grid.pts[segV][i];
      line.push([p[0], p[1], p[2]]);
    }
    for (let i = 0; i < segU; i++) {
      B.bar(hipMat, [line[i][0], line[i][1] - 0.07, line[i][2]], [line[i + 1][0], line[i + 1][1] - 0.07, line[i + 1][2]], 0.13, 0.15);
    }
    if (capInst && tileCaps) capsAlong(capInst, B, line.map((p) => [p[0], p[1] - 0.05, p[2]]), capSpacing, true);
    eaveLines.push(line);
    // 垂脊 + 翘角
    B.tube(hipMat, [
      [TA[0], topY - 0.02, TA[2]],
      [(TA[0] + A[0]) / 2, topY + (A[1] - topY) * 0.58 + 0.08, (TA[2] + A[2]) / 2],
      [A[0], A[1] - 0.02, A[2]],
    ], 0.075, 5, 5);
    const ox = A[0] / (eaveR || 1);
    const oz = A[2] / (eaveR || 1);
    B.tube(hipMat, [
      [A[0] - ox * 0.18, A[1] - 0.02, A[2] - oz * 0.18],
      [A[0] + ox * 0.2, A[1] + 0.28, A[2] + oz * 0.2],
      [A[0] + ox * 0.62, A[1] + 0.62, A[2] + oz * 0.62],
    ], 0.09, 5, 5);
  }
  if (finial) {
    const geo = finialGeometry().clone();
    _m.makeScale(0.68, 0.95, 0.68);
    _m.setPosition(0, topY - 0.02, 0);
    geo.applyMatrix4(_m);
    B.addGeo('bronze', geo);
  }
  return { topY };
}

export { TILE_M };

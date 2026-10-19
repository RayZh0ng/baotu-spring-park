/**
 * 地形模块（A · 泉与地形）
 * ------------------------------------------------------------------
 * 职责：
 *  1. 全园地面在 y=0，趵突泉主池 / 溪流 / 荷花池 / 漱玉泉 / 金线泉 / 马跑泉 /
 *     望水泉 / 沧泉 在地面上挖出**真实的洞**（THREE.Shape + holes），洞下做池底、
 *     竖直石砌池壁；池沿（rimWidth / rimHeight）按 layout 生成，主池与小品泉按
 *     hasRailing / railingGaps 生成石栏（望柱 + 栏板 + 扶手）。
 *  2. 按 PATHS 铺石路（paving / stone），路口用微高差叠加避免 z-fight，
 *     水面处按 0.35m 采样裁切；路缘加碎石收边。
 *  3. 地面用程序化噪声贴图 + 顶点色分区（草地深浅、泥土、林下落叶、水边青苔、
 *     石板广场 / 泉池细石铺地），避免一整块纯色。
 *  4. 天气响应：wetness 变深、粗糙度下降；puddle 低洼积水；snow 覆白；
 *     night 压暗。全部在共享 uniform 中完成，update 内不分配对象。
 *
 * 返回契约见 docs/CONTRACT.md §4。
 */

import * as THREE from 'three';
import {
  BOUNDS,
  WATER_LEVEL,
  WATER_SHAPES,
  PATHS,
  PLANTING_ZONES,
  isWaterAt,
  findPlantableSpot,
} from '../layout.js';
import { COLORS } from '../utils/palette.js';
import { noiseTexture, stoneTexture, makeCanvasTexture } from '../utils/tex.js';
import { mulberry32, fbm2, clamp, lerp, smoothstep } from '../utils/random.js';

/* 石作颜色（模块级常量，避免 TDZ） */
const STONE_TOP = [0.98, 0.97, 0.94];
const STONE_WALL = [0.86, 0.85, 0.82];
const STONE_DEEP = [0.62, 0.64, 0.6];
const STONE_MOSS = [0.66, 0.76, 0.62];
const RAIL_TOP = [1.0, 0.98, 0.94];
const RAIL_BODY = [0.93, 0.91, 0.86];
const RAIL_DARK = [0.82, 0.8, 0.75];

/* ================================================================== *
 * 常量与预计算
 * ================================================================== */

const PARK_MIN_X = BOUNDS.minX - 5;
const PARK_MAX_X = BOUNDS.maxX + 5;
const PARK_MIN_Z = BOUNDS.minZ - 5;
const PARK_MAX_Z = BOUNDS.maxZ + 5;

const GY = WATER_LEVEL; // 水面高度

const ellipseShapes = WATER_SHAPES.filter((s) => s.kind === 'ellipse');
const channelShape = WATER_SHAPES.find((s) => s.kind === 'polyline');
const pondShape = ellipseShapes.find((s) => s.id === 'lotus-pond');

/* ---- 溪流中心线：Catmull-Rom 平滑（更自然的驳岸曲线） ---- */
function catmullRom(points, step) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(segLen / step));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push(points[n - 1].slice());
  return out;
}

const CHANNEL_PTS = catmullRom(channelShape.points, 1.05);
const CH = {
  pts: CHANNEL_PTS,
  hw: channelShape.width / 2,
  rw: channelShape.rimWidth,
  rimH: channelShape.rimHeight,
  depth: channelShape.depth,
  floorY: WATER_LEVEL - channelShape.depth,
};

/* ---- 快速距离查询（顶点色用，避免 layout 里的重复长度计算） ---- */
const PATH_SEGS = [];
for (const p of PATHS) {
  for (let i = 0; i < p.points.length - 1; i++) {
    const a = p.points[i];
    const b = p.points[i + 1];
    PATH_SEGS.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], half: p.width / 2 });
  }
}
function pathDistanceFast(x, z) {
  let best = Infinity;
  for (let i = 0; i < PATH_SEGS.length; i++) {
    const s = PATH_SEGS[i];
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = s.ax + dx * t;
    const pz = s.az + dz * t;
    const d = Math.hypot(x - px, z - pz) - s.half;
    if (d < best) best = d;
  }
  return best;
}

const CHANNEL_SEGS = [];
for (let i = 0; i < CHANNEL_PTS.length - 1; i++) {
  const a = CHANNEL_PTS[i];
  const b = CHANNEL_PTS[i + 1];
  CHANNEL_SEGS.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1] });
}

/** 到最近水面边界的近似带符号距离（外正内负），用于水边青苔 / 泥土染色 */
function waterEdgeDistance(x, z) {
  let best = Infinity;
  for (let i = 0; i < ellipseShapes.length; i++) {
    const s = ellipseShapes[i];
    const nx = (x - s.cx) / s.rx;
    const nz = (z - s.cz) / s.rz;
    const r = Math.hypot(nx, nz);
    if (r > 2.2) continue;
    const d = (r - 1) * Math.min(s.rx, s.rz);
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  for (let i = 0; i < CHANNEL_SEGS.length; i++) {
    const s = CHANNEL_SEGS[i];
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) - CH.hw;
    if (d < best) best = d;
  }
  return best;
}

/* ================================================================== *
 * 通用几何工具
 * ================================================================== */

function newBuf() {
  return { pos: [], nor: [], uv: [], col: [], idx: [] };
}

function bufToGeometry(b, withColor = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (withColor && b.col.length) {
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  }
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * 追加一个四边形。
 * pts 四点按环序给出；upward=true 时若算出法线朝下会自动翻转（地面/铺装用）。
 */
function addQuad(b, pts, col, uvs, upward = false) {
  const p0 = pts[0];
  const p1 = pts[1];
  const p2 = pts[2];
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  let pts4 = pts;
  let col4 = col;
  let uv4 = uvs;
  if (upward && ny < 0) {
    // 交换 1、3 顶点，翻面
    pts4 = [pts[0], pts[3], pts[2], pts[1]];
    if (Array.isArray(col[0])) col4 = [col[0], col[3], col[2], col[1]];
    if (uvs) uv4 = [uvs[0], uvs[3], uvs[2], uvs[1]];
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  const base = b.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    const p = pts4[i];
    b.pos.push(p[0], p[1], p[2]);
    b.nor.push(nx, ny, nz);
    const c = Array.isArray(col4[0]) ? col4[i] : col4;
    b.col.push(c[0], c[1], c[2]);
    const uv = uv4 ? uv4[i] : [0, 0];
    b.uv.push(uv[0], uv[1]);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** 追加一个盒子（含 6 个面各自的法线；yaw 绕 Y） */
function addBox(b, cx, cy, cz, sx, sy, sz, yaw, col, uvScale = 1) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
  const faces = [
    // +X
    {
      pts: [P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz)],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    },
    // -X
    {
      pts: [P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz)],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    },
    // +Y
    {
      pts: [P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz)],
      uvs: [[0, 0], [sx * uvScale, 0], [sx * uvScale, sz * uvScale], [0, sz * uvScale]],
    },
    // -Y
    {
      pts: [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz)],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    },
    // +Z
    {
      pts: [P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)],
      uvs: [[0, 0], [sx * uvScale, 0], [sx * uvScale, sy * uvScale], [0, sy * uvScale]],
    },
    // -Z
    {
      pts: [P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz)],
      uvs: [[0, 0], [sx * uvScale, 0], [sx * uvScale, sy * uvScale], [0, sy * uvScale]],
    },
  ];
  for (const f of faces) addQuad(b, f.pts, col, f.uvs);
}

/** 椭圆环点（closed，不重复首点） */
function ellipseLoop(cx, cz, rx, rz, count, phase = 0) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return pts;
}

/**
 * 开放折线的带状轮廓（左右两条边 + 两端圆头），返回闭合环。
 */
function offsetLoop(points, halfWidth, capSeg = 8) {
  const n = points.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    left.push([p[0] - tz * halfWidth, p[1] + tx * halfWidth]);
    right.push([p[0] + tz * halfWidth, p[1] - tx * halfWidth]);
  }
  const out = [];
  for (const p of left) out.push(p);
  // 末端圆头（从 +90° 到 -90°）
  {
    const a = points[n - 1];
    const b = points[n - 2];
    let tx = a[0] - b[0];
    let tz = a[1] - b[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    for (let k = 1; k < capSeg; k++) {
      const ang = Math.PI / 2 - (Math.PI * k) / capSeg;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const dx = tx * ca - tz * sa;
      const dz = tx * sa + tz * ca;
      out.push([a[0] + dx * halfWidth, a[1] + dz * halfWidth]);
    }
  }
  for (let i = n - 1; i >= 0; i--) out.push(right[i]);
  // 起点圆头（从 -90° 到 -270°，即经过 -t 方向）
  {
    const a = points[0];
    const b = points[1];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    for (let k = 1; k < capSeg; k++) {
      const ang = -Math.PI / 2 - (Math.PI * k) / capSeg;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const dx = tx * ca - tz * sa;
      const dz = tx * sa + tz * ca;
      out.push([a[0] + dx * halfWidth, a[1] + dz * halfWidth]);
    }
  }
  return out;
}

function ellipseSegmentIntersection(a, b, cx, cz, rx, rz) {
  const ox = (a[0] - cx) / rx;
  const oz = (a[1] - cz) / rz;
  const dx = (b[0] - a[0]) / rx;
  const dz = (b[1] - a[1]) / rz;
  const A = dx * dx + dz * dz;
  const B = 2 * (ox * dx + oz * dz);
  const C = ox * ox + oz * oz - 1;
  if (A === 0) return null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-B - sq) / (2 * A);
  const t2 = (-B + sq) / (2 * A);
  let t = null;
  if (t1 > 1e-4 && t1 < 1 - 1e-4) t = t1;
  else if (t2 > 1e-4 && t2 < 1 - 1e-4) t = t2;
  if (t === null) return null;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function angleNorm(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * 溪流与荷花池在地面上的洞：取两个闭合轮廓的并集。
 * 溪流末端伸入荷花池，直接放两个洞会让 earcut 自交；这里把溪流轮廓
 * 伸入池内的那一段换成荷花池边界（长弧），得到干净的并集轮廓。
 */
function unionChannelPond(channelLoop, pond, channelPts) {
  const inside = (p) =>
    ((p[0] - pond.cx) / pond.rx) ** 2 + ((p[1] - pond.cz) / pond.rz) ** 2 < 1;
  const n = channelLoop.length;
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (inside(channelLoop[i]) && !inside(channelLoop[(i - 1 + n) % n])) {
      start = i;
      break;
    }
  }
  if (start < 0) return channelLoop;
  let end = start;
  let guard = 0;
  while (inside(channelLoop[(end + 1) % n]) && guard++ < n) end = (end + 1) % n;
  const pIn = ellipseSegmentIntersection(channelLoop[(start - 1 + n) % n], channelLoop[start], pond.cx, pond.cz, pond.rx, pond.rz);
  const pOut = ellipseSegmentIntersection(channelLoop[end], channelLoop[(end + 1) % n], pond.cx, pond.cz, pond.rx, pond.rz);
  if (!pIn || !pOut) return channelLoop;

  const aIn = Math.atan2((pIn[1] - pond.cz) / pond.rz, (pIn[0] - pond.cx) / pond.rx);
  const aOut = Math.atan2((pOut[1] - pond.cz) / pond.rz, (pOut[0] - pond.cx) / pond.rx);

  // 溪流外轮廓的“带宽”
  const bandLimit = CH.hw + CH.rw + 0.35;
  const distToChannel = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < channelPts.length - 1; i++) {
      const s = channelPts[i];
      const e = channelPts[i + 1];
      const dx = e[0] - s[0];
      const dz = e[1] - s[1];
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - s[0]) * dx + (z - s[1]) * dz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (s[0] + dx * t), z - (s[1] + dz * t));
      if (d < best) best = d;
    }
    return best;
  };

  const PI2 = Math.PI * 2;
  const mod2 = (x) => ((x % PI2) + PI2) % PI2;
  const buildArc = (dir) => {
    const total = dir > 0 ? mod2(aOut - aIn) : mod2(aIn - aOut);
    const steps = Math.max(8, Math.ceil(total / (Math.PI / 48)));
    const arr = [];
    for (let k = 1; k < steps; k++) {
      const a = aIn + dir * (total * k) / steps;
      arr.push([pond.cx + Math.cos(a) * pond.rx, pond.cz + Math.sin(a) * pond.rz]);
    }
    return arr;
  };
  const score = (arr) => {
    let bad = 0;
    for (const p of arr) if (distToChannel(p[0], p[1]) < bandLimit) bad++;
    return bad;
  };
  const arcA = buildArc(1);
  const arcB = buildArc(-1);
  const arc = score(arcA) <= score(arcB) ? arcA : arcB;

  // 溪流轮廓位于荷花池外的部分
  const outside = [];
  let idx = (end + 1) % n;
  while (idx !== start) {
    outside.push(channelLoop[idx]);
    idx = (idx + 1) % n;
    if (outside.length > n) break;
  }

  const result = [];
  for (const p of outside) result.push(p);
  result.push(pIn);
  for (const p of arc) result.push(p);
  result.push(pOut);
  return result;
}

/* ================================================================== *
 * 地面配色
 * ================================================================== */

const G_BASE_DARK = new THREE.Color(0x4f5f33);
const G_BASE_LIGHT = new THREE.Color(0x7d8c50);
const G_DRY = new THREE.Color(0x8b8557);
const G_MOSS = new THREE.Color(0x4e6b47);
const G_DIRT = new THREE.Color(0x776d54);
const G_LITTER = new THREE.Color(0x6f6a3f);
const G_PINE = new THREE.Color(0x47583a);
const _gc = new THREE.Color();

function groundColorAt(x, z, out) {
  const n1 = fbm2(x * 0.017 + 11.2, z * 0.017 + 4.7, 3);
  const n2 = fbm2(x * 0.082 + 2.4, z * 0.082 + 9.1, 2);
  const n3 = fbm2(x * 0.36 + 5.5, z * 0.36 + 15.2, 2);

  out.copy(G_BASE_DARK).lerp(G_BASE_LIGHT, clamp((n1 - 0.25) * 1.7, 0, 1));

  // 干草斑块
  const dry = smoothstep(0.56, 0.86, n2) * 0.5;
  out.lerp(G_DRY, dry);

  // 水边青苔 / 湿土
  const wd = waterEdgeDistance(x, z);
  if (wd < 3.4) {
    const m = 1 - clamp(wd / 3.4, 0, 1);
    _gc.copy(G_MOSS).multiplyScalar(0.85 + n3 * 0.3);
    out.lerp(_gc, m * 0.62);
  }

  // 路边泥土
  const pd = pathDistanceFast(x, z);
  if (pd < 2.0) {
    const m = (1 - clamp(pd / 2.0, 0, 1)) * 0.55;
    out.lerp(G_DIRT, m);
  }

  // 泉池环柳林下落叶（四面荷花三面柳）
  const er = Math.hypot(x / 19.8, z / 14.8);
  const ringD = Math.abs(er - 1) * 17;
  if (ringD < 8) {
    const m = (1 - ringD / 8) * smoothstep(0.3, 0.72, fbm2(x * 0.11 + 7.1, z * 0.11 + 3.3, 2)) * 0.55;
    out.lerp(G_LITTER, m);
  }

  // 北岸松柏林下更深
  out.lerp(G_PINE, smoothstep(-26, -64, z) * 0.4);
  // 池心环内草色稍浅
  out.multiplyScalar(0.9 + n3 * 0.2);
  return out;
}

/* ================================================================== *
 * 模块工厂
 * ================================================================== */

export function createTerrain(ctx) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const colliders = [];
  const { quality = 1 } = ctx;
  const hi = quality >= 0.9;
  const rand = mulberry32(20240611);

  /* ---------------------------------------------------------------- *
   * 天气 uniform（所有标准材质共享）
   * ---------------------------------------------------------------- */
  const wx = {
    uWet: { value: 0 },
    uSnow: { value: 0 },
    uNight: { value: 0 },
    uSnowTint: { value: new THREE.Color(0.9, 0.93, 0.96) },
    uWetTint: { value: new THREE.Color(0.5, 0.55, 0.52) },
  };

  function weatherize(material, { snowAmt = 0.85, wetAmt = 1.0 } = {}) {
    const uSnowAmt = { value: snowAmt };
    const uWetAmt = { value: wetAmt };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWet = wx.uWet;
      shader.uniforms.uSnow = wx.uSnow;
      shader.uniforms.uNight = wx.uNight;
      shader.uniforms.uSnowTint = wx.uSnowTint;
      shader.uniforms.uWetTint = wx.uWetTint;
      shader.uniforms.uSnowAmt = uSnowAmt;
      shader.uniforms.uWetAmt = uWetAmt;
      shader.fragmentShader =
        'uniform float uWet;\nuniform float uSnow;\nuniform float uNight;\nuniform float uSnowAmt;\nuniform float uWetAmt;\nuniform vec3 uSnowTint;\nuniform vec3 uWetTint;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb = mix( diffuseColor.rgb, uSnowTint, smoothstep( 0.0, 0.8, uSnow ) * uSnowAmt );
          diffuseColor.rgb *= mix( vec3( 1.0 ), uWetTint, uWet * uWetAmt );
          diffuseColor.rgb *= ( 1.0 - uNight * 0.22 );`
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.94, uSnow * uSnowAmt );
        roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.52, uWet * uWetAmt );`
      );
    };
    material.customProgramCacheKey = () => 'terrain-wx';
    return material;
  }

  /* ---------------------------------------------------------------- *
   * 程序化贴图
   * ---------------------------------------------------------------- */
  const texGrass = noiseTexture({
    size: 256,
    scale: 11,
    octaves: 3,
    seed: 21,
    contrast: 0.9,
    brightness: 0.86,
  });
  texGrass.repeat.set(0.34, 0.34);

  const texPathStone = stoneTexture({ size: 256, seed: 31, tint: [150, 151, 146], joint: 0.9, moss: 0.32 });
  const texPaving = stoneTexture({ size: 256, seed: 37, tint: [162, 159, 150], joint: 1.0, moss: 0.14 });
  const texRim = stoneTexture({ size: 256, seed: 41, tint: [145, 147, 142], joint: 0.72, moss: 0.45 });
  const texRail = stoneTexture({ size: 128, seed: 43, tint: [205, 201, 190], joint: 0.0, moss: 0.05 });
  const texGravel = stoneTexture({ size: 128, seed: 47, tint: [122, 118, 108], joint: 0.0, moss: 0.12 });

  // 林下落叶 / 花瓣
  const texLitter = makeCanvasTexture(
    128,
    128,
    (c2, w, h) => {
      c2.clearRect(0, 0, w, h);
      const r2 = mulberry32(551);
      for (let i = 0; i < 46; i++) {
        const x = r2() * w;
        const y = r2() * h;
        const ang = r2() * Math.PI * 2;
        const rx = w * (0.014 + r2() * 0.03);
        const ry = rx * (1.5 + r2() * 1.3);
        c2.save();
        c2.translate(x, y);
        c2.rotate(ang);
        const shade = 168 + Math.floor(r2() * 87);
        c2.fillStyle = `rgba(${shade},${shade},${Math.min(255, shade + 6)},${0.82 + r2() * 0.18})`;
        c2.beginPath();
        c2.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        c2.fill();
        c2.restore();
      }
      // 少量细碎花瓣
      for (let i = 0; i < 16; i++) {
        const x = r2() * w;
        const y = r2() * h;
        const rr = w * (0.008 + r2() * 0.012);
        c2.fillStyle = `rgba(246,238,236,${0.5 + r2() * 0.4})`;
        c2.beginPath();
        c2.arc(x, y, rr, 0, Math.PI * 2);
        c2.fill();
      }
    },
    { colorSpace: true }
  );

  /* ---------------------------------------------------------------- *
   * 地面（带水面开洞 + 顶点色）
   * ---------------------------------------------------------------- */
  const groundGeo = buildGroundGeometry(hi ? 3.1 : 4.2);

  const groundMat = weatherize(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texGrass,
      vertexColors: true,
      roughness: 0.97,
      metalness: 0.0,
    }),
    { snowAmt: 0.88, wetAmt: 1.0 }
  );
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  /* ---------------------------------------------------------------- *
   * 池底（自定义 shader：卵石 / 水草 / 焦散）
   * ---------------------------------------------------------------- */
  const floor = buildPoolFloors();
  const floorMat = createFloorMaterial();
  const floorMesh = new THREE.Mesh(floor.geometry, floorMat);
  floorMesh.renderOrder = 0;
  floorMesh.receiveShadow = false;
  group.add(floorMesh);

  /* ---------------------------------------------------------------- *
   * 池壁 / 池沿（石作）
   * ---------------------------------------------------------------- */
  const stoneBuf = newBuf();
  for (const s of ellipseShapes) buildEllipseRim(stoneBuf, s);
  buildChannelRim(stoneBuf);
  const stoneGeo = bufToGeometry(stoneBuf);
  const stoneMat = weatherize(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texRim,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    { snowAmt: 0.9, wetAmt: 0.85 }
  );
  const stoneMesh = new THREE.Mesh(stoneGeo, stoneMat);
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;
  group.add(stoneMesh);

  /* ---------------------------------------------------------------- *
   * 石栏（望柱 + 栏板 + 扶手）
   * ---------------------------------------------------------------- */
  const railBuf = newBuf();
  for (const s of WATER_SHAPES) {
    if (!s.hasRailing) continue;
    if (s.kind === 'ellipse') buildEllipseRailing(railBuf, s);
  }
  const railGeo = bufToGeometry(railBuf);
  const railMat = weatherize(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texRail,
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.0,
    }),
    { snowAmt: 0.95, wetAmt: 0.7 }
  );
  const railMesh = new THREE.Mesh(railGeo, railMat);
  railMesh.castShadow = true;
  railMesh.receiveShadow = true;
  group.add(railMesh);

  /* ---------------------------------------------------------------- *
   * 园路
   * ---------------------------------------------------------------- */
  const pathBufs = { stone: newBuf(), paving: newBuf() };
  const curbBuf = newBuf();
  for (let i = 0; i < PATHS.length; i++) {
    buildPathRibbon(PATHS[i], i, pathBufs, curbBuf);
  }
  const pathMats = {
    stone: weatherize(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: texPathStone,
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.0,
      }),
      { snowAmt: 0.8, wetAmt: 0.8 }
    ),
    paving: weatherize(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: texPaving,
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.0,
      }),
      { snowAmt: 0.8, wetAmt: 0.8 }
    ),
  };
  for (const key of Object.keys(pathBufs)) {
    const b = pathBufs[key];
    if (!b.pos.length) continue;
    const g = bufToGeometry(b);
    const m = new THREE.Mesh(g, pathMats[key]);
    m.receiveShadow = true;
    group.add(m);
  }

  const curbGeo = bufToGeometry(curbBuf);
  const curbMat = weatherize(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texGravel,
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0,
    }),
    { snowAmt: 0.6, wetAmt: 1.0 }
  );
  const curbMesh = new THREE.Mesh(curbGeo, curbMat);
  curbMesh.receiveShadow = true;
  group.add(curbMesh);

  /* ---------------------------------------------------------------- *
   * 泉池 / 荷池细石铺地 + 东门石板广场
   * ---------------------------------------------------------------- */
  const apronBuf = newBuf();
  buildAprons(apronBuf);
  buildPlazas(apronBuf);
  const apronGeo = bufToGeometry(apronBuf);
  const apronMat = weatherize(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texPaving,
      vertexColors: true,
      roughness: 0.93,
      metalness: 0.0,
    }),
    { snowAmt: 0.85, wetAmt: 0.9 }
  );
  const apronMesh = new THREE.Mesh(apronGeo, apronMat);
  apronMesh.receiveShadow = true;
  group.add(apronMesh);

  /* ---------------------------------------------------------------- *
   * 林下落叶贴片
   * ---------------------------------------------------------------- */
  const litterBuf = buildLitterPatches();
  const litterGeo = bufToGeometry(litterBuf);
  const litterMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texLitter,
    vertexColors: true,
    transparent: true,
    alphaTest: 0.28,
    roughness: 0.94,
    metalness: 0.0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const litterMesh = new THREE.Mesh(litterGeo, litterMat);
  litterMesh.renderOrder = 1;
  group.add(litterMesh);

  /* ---------------------------------------------------------------- *
   * 低洼积水（雨天）
   * ---------------------------------------------------------------- */
  const puddleBuf = buildPuddles();
  const puddleGeo = bufToGeometry(puddleBuf);
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x39433f,
    roughness: 0.08,
    metalness: 0.0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  const puddleMesh = new THREE.Mesh(puddleGeo, puddleMat);
  puddleMesh.renderOrder = 1;
  group.add(puddleMesh);

  /* ---------------------------------------------------------------- *
   * 池底卵石 / 水草，路边碎石（instanced，各自 1 draw call）
   * ---------------------------------------------------------------- */
  const pebbleMesh = buildPebbles(hi ? 110 : 70);
  group.add(pebbleMesh);
  const weedMesh = buildWeeds(hi ? 120 : 70);
  group.add(weedMesh);
  const edgeStoneMesh = buildEdgeStones(hi ? 220 : 130);
  group.add(edgeStoneMesh);

  /* ---------------------------------------------------------------- *
   * 碰撞体
   * ---------------------------------------------------------------- */
  // 石栏碰撞在 buildEllipseRailing 中登记
  function addRailingCollider(x, z, dx, dz, halfLen) {
    colliders.push({
      type: 'box',
      x,
      z,
      hx: Math.max(0.12, halfLen),
      hz: 0.16,
      rot: Math.atan2(dz, dx),
      tag: 'solid',
    });
  }

  /* ---------------------------------------------------------------- *
   * 每帧更新（不分配对象）
   * ---------------------------------------------------------------- */
  const _c = new THREE.Color();
  function update(dt, env) {
    wx.uWet.value = env.wetness;
    wx.uSnow.value = env.snow;
    wx.uNight.value = env.night;

    // 池底 shader uniforms
    const fu = floorMat.uniforms;
    fu.uTime.value = env.time;
    fu.uSunDir.value.copy(env.sunDir);
    fu.uSunColor.value.copy(env.sunColor);
    fu.uSunIntensity.value = env.sunIntensity;
    fu.uAmbientColor.value.copy(env.ambientColor);
    fu.uAmbientIntensity.value = env.ambientIntensity;
    fu.uHemiSky.value.copy(env.hemiSky);
    fu.uHemiGround.value.copy(env.hemiGround);
    fu.uHemiIntensity.value = env.hemiIntensity;
    fu.uFogColor.value.copy(env.fogColor);
    fu.uFogDensity.value = env.fogDensity;
    fu.uSunDirView.value.copy(env.sunDir);
    fu.uRain.value = env.rain;
    fu.uSnow.value = env.snow;
    fu.uNight.value = env.night;
    fu.uDayFactor.value = env.dayFactor;
    fu.uLightning.value = env.lightning;
    fu.uWaterDeep.value.copy(_c.copy(COLORS_waterDeep));
    fu.uWaterShallow.value.copy(_c.copy(COLORS_waterShallow));

    // 积水
    puddleMat.opacity = env.puddle * 0.52;
    puddleMat.roughness = 0.08 + (1 - env.wetness) * 0.1;
    puddleMat.color.copy(_c.set(0x39433f)).multiplyScalar(1 - env.night * 0.35);

    // 落叶贴片在雪天被盖住
    litterMat.opacity = clamp(1 - env.snow * 0.9, 0, 1);
    litterMesh.visible = litterMat.opacity > 0.02;
  }

  /* ---------------------------------------------------------------- *
   * 资源释放
   * ---------------------------------------------------------------- */
  const ownedTextures = [texGrass, texPathStone, texPaving, texRim, texRail, texGravel, texLitter];
  const ownedGeometries = [];
  const ownedMaterials = [];
  group.traverse((obj) => {
    if (obj.geometry && ownedGeometries.indexOf(obj.geometry) < 0) ownedGeometries.push(obj.geometry);
    if (obj.material && ownedMaterials.indexOf(obj.material) < 0) ownedMaterials.push(obj.material);
  });

  function dispose() {
    for (const g of ownedGeometries) g.dispose();
    for (const m of ownedMaterials) {
      if (m.uniforms) continue; // shader material 单独释放纹理
      m.dispose();
    }
    floorMat.dispose();
    for (const t of ownedTextures) t.dispose();
    group.removeFromParent();
  }

  return {
    object: group,
    colliders,
    anchors: {
      groundCenter: new THREE.Vector3(0, 0, 0),
      plazaEast: new THREE.Vector3(92, 0.03, 0),
      mainPoolEdge: new THREE.Vector3(0, WATER_LEVEL, 13.4),
      lotusPondEdge: new THREE.Vector3(18, WATER_LEVEL, 70.4),
    },
    update,
    dispose,
  };

  /* ================================================================ *
   * 内部构建函数（闭包，以便访问材质 / colliders / rand）
   * ================================================================ */

  /* ---------------- 地面 ---------------- */
  function buildGroundGeometry(maxEdge) {
    const shape = new THREE.Shape();
    shape.moveTo(PARK_MIN_X, PARK_MIN_Z);
    shape.lineTo(PARK_MAX_X, PARK_MIN_Z);
    shape.lineTo(PARK_MAX_X, PARK_MAX_Z);
    shape.lineTo(PARK_MIN_X, PARK_MAX_Z);
    shape.closePath();

    const addHole = (loop) => {
      const path = new THREE.Path();
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i];
        if (i === 0) path.moveTo(p[0], -p[1]);
        else path.lineTo(p[0], -p[1]);
      }
      path.closePath();
      shape.holes.push(path);
    };

    // 主池 + 小品泉
    for (const s of ellipseShapes) {
      if (s.id === 'lotus-pond') continue;
      addHole(ellipseLoop(s.cx, s.cz, s.rx + s.rimWidth - 0.06, s.rz + s.rimWidth - 0.06, 96));
    }
    // 溪流 ∪ 荷花池
    const pondHole = ellipseLoop(pondShape.cx, pondShape.cz, pondShape.rx + pondShape.rimWidth - 0.06, pondShape.rz + pondShape.rimWidth - 0.06, 96);
    const channelHole = offsetLoop(CH.pts, CH.hw + CH.rw - 0.06, 10);
    const unionHole = unionChannelPond(channelHole, {
      cx: pondShape.cx,
      cz: pondShape.cz,
      rx: pondShape.rx + pondShape.rimWidth - 0.06,
      rz: pondShape.rz + pondShape.rimWidth - 0.06,
    }, CH.pts);
    addHole(unionHole);
    if (unionHole === channelHole) addHole(pondHole);

    const src = new THREE.ShapeGeometry(shape);
    src.rotateX(-Math.PI / 2);
    const srcPos = src.attributes.position.array;
    const srcIdx = src.index.array;

    const outPos = [];
    const outCol = [];
    const outUv = [];
    const outIdx = [];
    const maxE2 = maxEdge * maxEdge;
    const MAX_DEPTH = 8;

    const emit = (ax, ay, az, bx, by, bz, cx2, cy2, cz2) => {
      const base = outPos.length / 3;
      outPos.push(ax, ay, az, bx, by, bz, cx2, cy2, cz2);
      outIdx.push(base, base + 1, base + 2);
      for (let k = 0; k < 3; k++) {
        const px = k === 0 ? ax : k === 1 ? bx : cx2;
        const pz = k === 0 ? az : k === 1 ? bz : cz2;
        groundColorAt(px, pz, _gc);
        outCol.push(_gc.r, _gc.g, _gc.b);
        outUv.push(px, -pz);
      }
    };

    const split = (ax, ay, az, bx, by, bz, cx2, cy2, cz2, depth) => {
      const ab = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
      const bc = (bx - cx2) ** 2 + (by - cy2) ** 2 + (bz - cz2) ** 2;
      const ca = (cx2 - ax) ** 2 + (cy2 - ay) ** 2 + (cz2 - az) ** 2;
      if (depth >= MAX_DEPTH || (ab <= maxE2 && bc <= maxE2 && ca <= maxE2)) {
        emit(ax, ay, az, bx, by, bz, cx2, cy2, cz2);
        return;
      }
      const d2 = depth + 1;
      if (ab >= bc && ab >= ca) {
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const mz = (az + bz) / 2;
        split(ax, ay, az, mx, my, mz, cx2, cy2, cz2, d2);
        split(mx, my, mz, bx, by, bz, cx2, cy2, cz2, d2);
      } else if (bc >= ca) {
        const mx = (bx + cx2) / 2;
        const my = (by + cy2) / 2;
        const mz = (bz + cz2) / 2;
        split(ax, ay, az, bx, by, bz, mx, my, mz, d2);
        split(ax, ay, az, mx, my, mz, cx2, cy2, cz2, d2);
      } else {
        const mx = (cx2 + ax) / 2;
        const my = (cy2 + ay) / 2;
        const mz = (cz2 + az) / 2;
        split(ax, ay, az, bx, by, bz, mx, my, mz, d2);
        split(bx, by, bz, cx2, cy2, cz2, mx, my, mz, d2);
      }
    };

    for (let i = 0; i < srcIdx.length; i += 3) {
      const ia = srcIdx[i] * 3;
      const ib = srcIdx[i + 1] * 3;
      const ic = srcIdx[i + 2] * 3;
      split(
        srcPos[ia],
        srcPos[ia + 1],
        srcPos[ia + 2],
        srcPos[ib],
        srcPos[ib + 1],
        srcPos[ib + 2],
        srcPos[ic],
        srcPos[ic + 1],
        srcPos[ic + 2],
        0
      );
    }
    src.dispose();

    const normals = new Array(outPos.length).fill(0);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(outCol, 3));
    g.setIndex(outIdx);
    g.computeBoundingSphere();
    return g;
  }

  /* ---------------- 池底 ---------------- */
  function buildPoolFloors() {
    const pos = [];
    const shore = [];
    const idx = [];

    function addDisk(cx, cz, rx, rz, floorY, dish, rings, segs) {
      const centerIdx = pos.length / 3;
      pos.push(cx, floorY, cz);
      shore.push(1);
      for (let i = 1; i <= rings; i++) {
        const r = i / rings;
        const rr = Math.pow(r, 1.35);
        for (let j = 0; j < segs; j++) {
          const a = (j / segs) * Math.PI * 2;
          pos.push(cx + Math.cos(a) * rx * rr, floorY + dish * r * r, cz + Math.sin(a) * rz * rr);
          shore.push(clamp((1 - r) * 2.4, 0, 1));
        }
      }
      for (let j = 0; j < segs; j++) idx.push(centerIdx, 1 + j, 1 + ((j + 1) % segs));
      for (let i = 1; i < rings; i++) {
        const start = 1 + (i - 1) * segs;
        const next = 1 + i * segs;
        for (let j = 0; j < segs; j++) {
          const j2 = (j + 1) % segs;
          // 让法线朝上（winding 反转）
          idx.push(start + j, next + j, next + j2);
          idx.push(start + j, next + j2, start + j2);
        }
      }
    }

    for (const s of ellipseShapes) {
      const floorY = WATER_LEVEL - s.depth;
      addDisk(s.cx, s.cz, s.rx + 0.12, s.rz + 0.12, floorY, 0.28, hi ? 16 : 12, hi ? 64 : 48);
    }

    // 溪流池底（V 形）
    const n = CH.pts.length;
    const crossN = 7;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const p = CH.pts[i];
      const prev = CH.pts[Math.max(0, i - 1)];
      const next = CH.pts[Math.min(n - 1, i + 1)];
      let tx = next[0] - prev[0];
      let tz = next[1] - prev[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const nx = -tz;
      const nz = tx;
      for (let j = 0; j < crossN; j++) {
        const u = (j / (crossN - 1)) * 2 - 1;
        const w = CH.hw + 0.12;
        pos.push(p[0] + nx * w * u, CH.floorY + 0.3 * u * u, p[1] + nz * w * u);
        shore.push(clamp((1 - Math.abs(u)) * 1.6, 0, 1));
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < crossN - 1; j++) {
        const a = base + i * crossN + j;
        const b = a + 1;
        const c = a + crossN;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return { geometry: geo };
  }

  /* ---------------- 石作：池沿 + 池壁（颜色常量见文件顶部） ---------------- */

  function pushRingTop(b, inner, outer, y, uvScale) {
    const n = inner.length;
    let sAcc = 0;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const p0 = [outer[i][0], y, outer[i][1]];
      const p1 = [inner[i][0], y, inner[i][1]];
      const p2 = [inner[i2][0], y, inner[i2][1]];
      const p3 = [outer[i2][0], y, outer[i2][1]];
      const segLen = Math.hypot(outer[i2][0] - outer[i][0], outer[i2][1] - outer[i][1]);
      const u0 = sAcc * uvScale;
      const u1 = (sAcc + segLen) * uvScale;
      sAcc += segLen;
      addQuad(
        b,
        [p0, p1, p2, p3],
        [STONE_TOP, STONE_TOP, STONE_TOP, STONE_TOP],
        [
          [u0, 1],
          [u0, 0],
          [u1, 0],
          [u1, 1],
        ],
        true
      );
    }
  }

  /** 竖直池壁：topY → bottomY，沿闭合环 */
  function pushWall(b, loop, topY, bottomY, colorTop, colorBot, inward, uvScale = 0.9) {
    const n = loop.length;
    let sAcc = 0;
    const h = Math.abs(topY - bottomY);
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const p0 = [loop[i][0], topY, loop[i][1]];
      const p1 = [loop[i2][0], topY, loop[i2][1]];
      const p2 = [loop[i2][0], bottomY, loop[i2][1]];
      const p3 = [loop[i][0], bottomY, loop[i][1]];
      const segLen = Math.hypot(loop[i2][0] - loop[i][0], loop[i2][1] - loop[i][1]);
      const u0 = sAcc * uvScale;
      const u1 = (sAcc + segLen) * uvScale;
      sAcc += segLen;
      if (h < 0.02) continue;
      const vTop = h * uvScale;
      const pts = inward ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
      const uvs = inward
        ? [
            [u0, vTop],
            [u0, 0],
            [u1, 0],
            [u1, vTop],
          ]
        : [
            [u0, vTop],
            [u1, vTop],
            [u1, 0],
            [u0, 0],
          ];
      addQuad(b, pts, [colorTop, colorBot, colorBot, colorTop], uvs);
    }
  }

  /** 内壁分三段：石壁 / 水线苔痕 / 水下暗色 */
  function pushInnerWallBands(b, loop, rimH, floorY) {
    const waterTop = WATER_LEVEL + 0.14;
    const waterBot = WATER_LEVEL - 0.3;
    pushWall(b, loop, rimH, waterTop, STONE_WALL, STONE_WALL, true, 0.55);
    pushWall(b, loop, waterTop, waterBot, STONE_MOSS, [0.5, 0.57, 0.49], true, 0.55);
    pushWall(b, loop, waterBot, floorY - 0.35, STONE_DEEP, [0.4, 0.44, 0.41], true, 0.55);
  }

  function buildEllipseRim(b, s) {
    const rimH = s.rimHeight;
    const floorY = WATER_LEVEL - s.depth;
    const inner = ellipseLoop(s.cx, s.cz, s.rx, s.rz, hi ? 112 : 72);
    const outer = ellipseLoop(s.cx, s.cz, s.rx + s.rimWidth, s.rz + s.rimWidth, inner.length);
    pushRingTop(b, inner, outer, rimH, 0.9);
    pushWall(b, outer, rimH, 0.0, STONE_WALL, [0.7, 0.7, 0.67], false, 1.0);
    pushInnerWallBands(b, inner, rimH, floorY);
  }

  function buildChannelRim(b) {
    const inner = offsetLoop(CH.pts, CH.hw, 10);
    const outer = offsetLoop(CH.pts, CH.hw + CH.rw, 10);
    pushRingTop(b, inner, outer, CH.rimH, 0.9);
    pushWall(b, outer, CH.rimH, 0.0, STONE_WALL, [0.7, 0.7, 0.67], false, 1.0);
    pushInnerWallBands(b, inner, CH.rimH, CH.floorY);
  }

  function buildEllipseRailing(b, s) {
    const rimH = s.rimHeight;
    const rx = s.rx + s.rimWidth * 0.52;
    const rz = s.rz + s.rimWidth * 0.52;
    const perim = Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz)));
    const n = Math.max(72, Math.round(perim / 0.32));
    let gaps = s.railingGaps;
    if (!gaps) {
      gaps = [defaultGapForPool(s)];
    }
    const meanR = (rx + rz) / 2;
    const inGap = (ang) => {
      for (const g of gaps) {
        const half = g.width / 2 / meanR;
        if (Math.abs(angleNorm(ang - g.angle)) < half) return true;
      }
      return false;
    };

    // 采样环，累积弧长
    const samples = [];
    let acc = 0;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = s.cx + Math.cos(a) * rx;
      const z = s.cz + Math.sin(a) * rz;
      if (prev) acc += Math.hypot(x - prev[0], z - prev[1]);
      samples.push({ a, x, z, s: acc, gap: inGap(a) });
      prev = [x, z];
    }
    const total = acc;

    const postSpacing = 1.85;
    let lastPost = null;
    let runStart = null;
    let nextPostS = postSpacing * 0.5;
    const addPost = (sm) => {
      const x = sm.x;
      const z = sm.z;
      // 切线方向
      const tan = Math.atan2(
        Math.cos(sm.a) * rz,
        -Math.sin(sm.a) * rx
      );
      // 上面 atan2 给的是切线方向角（dx,dz）
      addBox(b, x, rimH + 0.42, z, 0.17, 0.84, 0.17, tan, RAIL_BODY);
      addBox(b, x, rimH + 0.9, z, 0.25, 0.11, 0.25, tan, RAIL_TOP);
      if (lastPost) {
        const dx = x - lastPost[0];
        const dz = z - lastPost[1];
        const len = Math.hypot(dx, dz);
        if (len > 0.2 && len < 3.2) {
          const yaw = Math.atan2(dz, dx);
          const mx = (x + lastPost[0]) / 2;
          const mz = (z + lastPost[1]) / 2;
          // 栏板
          addBox(b, mx, rimH + 0.38, mz, len - 0.17, 0.46, 0.09, yaw, RAIL_BODY);
          // 扶手
          addBox(b, mx, rimH + 0.69, mz, len - 0.14, 0.1, 0.15, yaw, RAIL_TOP);
          // 下槛
          addBox(b, mx, rimH + 0.08, mz, len - 0.14, 0.12, 0.13, yaw, RAIL_DARK);
        }
      }
      // 碰撞：累积到 2.6m 一段
      if (runStart) {
        const dx = x - runStart[0];
        const dz = z - runStart[1];
        const len = Math.hypot(dx, dz);
        if (len >= 2.6) {
          addRailingCollider((x + runStart[0]) / 2, (z + runStart[1]) / 2, dx, dz, len / 2);
          runStart = [x, z];
        }
      } else {
        runStart = [x, z];
      }
      lastPost = [x, z];
    };

    for (const sm of samples) {
      if (sm.gap) {
        lastPost = null;
        runStart = null;
        nextPostS = sm.s + postSpacing * 0.5;
        continue;
      }
      if (sm.s >= nextPostS) {
        addPost(sm);
        nextPostS += postSpacing;
      }
    }
    void total;
  }

  function defaultGapForPool(s) {
    // 朝向最近园路的方向开一个缺口
    let bx = s.cx;
    let bz = s.cz - s.rz;
    let best = Infinity;
    for (const p of PATHS) {
      for (const q of p.points) {
        const d = (q[0] - s.cx) ** 2 + (q[1] - s.cz) ** 2;
        if (d < best) {
          best = d;
          bx = q[0];
          bz = q[1];
        }
      }
    }
    const rx = s.rx + s.rimWidth * 0.52;
    const rz = s.rz + s.rimWidth * 0.52;
    const angle = Math.atan2((bz - s.cz) / rz, (bx - s.cx) / rx);
    return { angle, width: 2.6 };
  }

  /* ---------------- 园路 ---------------- */
  function buildPathRibbon(path, index, bufs, curbB) {
    const b = bufs[path.type] || bufs.stone;
    const pts = path.points;
    const closed = Boolean(path.closed);
    const halfW = path.width / 2;
    const yBase = 0.03 + (index % 8) * 0.0015;
    const step = 0.4;

    // 稠密采样
    const dense = [];
    const count = closed ? pts.length : pts.length - 1;
    let totalLen = 0;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        dense.push({ x: a[0] + (c[0] - a[0]) * t, z: a[1] + (c[1] - a[1]) * t, s: totalLen + len * t });
      }
      totalLen += len;
    }
    if (!closed) {
      const last = pts[pts.length - 1];
      dense.push({ x: last[0], z: last[1], s: totalLen });
    }
    const N = dense.length;
    if (N < 2) return;
    const tangentAt = (i) => {
      let prevIdx = i - 1;
      let nextIdx = i + 1;
      if (closed) {
        prevIdx = (prevIdx + N) % N;
        nextIdx = nextIdx % N;
      } else {
        prevIdx = Math.max(0, prevIdx);
        nextIdx = Math.min(N - 1, nextIdx);
      }
      const a = dense[prevIdx];
      const c = dense[nextIdx];
      let tx = c.x - a.x;
      let tz = c.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      return [tx / l, tz / l];
    };
    // 采样点：位置、横向法线、是否被水面裁切
    const cross = [];
    for (let i = 0; i < N; i++) {
      const d = dense[i];
      const [tx, tz] = tangentAt(i);
      const nx = -tz;
      const nz = tx;
      const lx = d.x + nx * halfW;
      const lz = d.z + nz * halfW;
      const rx2 = d.x - nx * halfW;
      const rz2 = d.z - nz * halfW;
      const cut =
        Boolean(isWaterAt(d.x, d.z, 0.3)) ||
        Boolean(isWaterAt(lx, lz, 0.0)) ||
        Boolean(isWaterAt(rx2, rz2, 0.0));
      cross.push({ x: d.x, z: d.z, s: d.s, nx, nz, cut });
    }

    const cTop = [0.94, 0.93, 0.9];
    const cEdge = [0.68, 0.68, 0.64];
    const uvScale = 0.42;

    const emitSeg = (a, c) => {
      if (a.cut || c.cut) return;
      const bevel = 0.16;
      const y = yBase;
      const yb = yBase - 0.018;
      const L0 = [a.x + a.nx * halfW, yb, a.z + a.nz * halfW];
      const L1 = [a.x + a.nx * (halfW - bevel), y, a.z + a.nz * (halfW - bevel)];
      const R1 = [a.x - a.nx * (halfW - bevel), y, a.z - a.nz * (halfW - bevel)];
      const R0 = [a.x - a.nx * halfW, yb, a.z - a.nz * halfW];
      const L0b = [c.x + c.nx * halfW, yb, c.z + c.nz * halfW];
      const L1b = [c.x + c.nx * (halfW - bevel), y, c.z + c.nz * (halfW - bevel)];
      const R1b = [c.x - c.nx * (halfW - bevel), y, c.z - c.nz * (halfW - bevel)];
      const R0b = [c.x - c.nx * halfW, yb, c.z - c.nz * halfW];
      const ua = a.s * uvScale;
      const uc = c.s * uvScale;
      // 左倒角
      addQuad(b, [L0, L1, L1b, L0b], [cEdge, cTop, cTop, cEdge], [
        [0.1, ua],
        [0.5, ua],
        [0.5, uc],
        [0.1, uc],
      ], true);
      // 主路面
      addQuad(b, [L1, R1, R1b, L1b], [cTop, cTop, cTop, cTop], [
        [0.5, ua],
        [halfW * 2 * uvScale + 0.5, ua],
        [halfW * 2 * uvScale + 0.5, uc],
        [0.5, uc],
      ], true);
      // 右倒角
      addQuad(b, [R1, R0, R0b, R1b], [cTop, cEdge, cEdge, cTop], [
        [halfW * 2 * uvScale + 0.5, ua],
        [halfW * 2 * uvScale + 0.9, ua],
        [halfW * 2 * uvScale + 0.9, uc],
        [halfW * 2 * uvScale + 0.5, uc],
      ], true);
    };

    for (let i = 0; i < N - (closed ? 0 : 1); i++) {
      if (closed && i === N - 1) emitSeg(cross[i], cross[0]);
      else if (!closed) emitSeg(cross[i], cross[i + 1]);
      else emitSeg(cross[i], cross[i + 1]);
    }

    // 碎石收边
    const cCurb = [0.66, 0.64, 0.58];
    const curbHalf = halfW + 0.36;
    const curbY = yBase - 0.022;
    for (let i = 0; i < N - (closed ? 0 : 1); i++) {
      const a = cross[i];
      const c = cross[closed ? (i + 1) % N : i + 1];
      if (!c) continue;
      if (a.cut || c.cut) continue;
      const la = [a.x + a.nx * curbHalf, curbY, a.z + a.nz * curbHalf];
      const ra = [a.x - a.nx * curbHalf, curbY, a.z - a.nz * curbHalf];
      const lc = [c.x + c.nx * curbHalf, curbY, c.z + c.nz * curbHalf];
      const rc = [c.x - c.nx * curbHalf, curbY, c.z - c.nz * curbHalf];
      addQuad(curbB, [la, ra, rc, lc], [cCurb, cCurb, cCurb, cCurb], [
        [0, a.s * 0.6],
        [1, a.s * 0.6],
        [1, c.s * 0.6],
        [0, c.s * 0.6],
      ], true);
    }
  }

  /* ---------------- 铺地 / 广场 ---------------- */
  function pushRingApron(b, s, extra, y, uvScale) {
    const inner = ellipseLoop(s.cx, s.cz, s.rx + s.rimWidth + 0.02, s.rz + s.rimWidth + 0.02, hi ? 96 : 64);
    const outer = ellipseLoop(s.cx, s.cz, s.rx + s.rimWidth + extra, s.rz + s.rimWidth + extra, inner.length);
    ringStrip(b, inner, outer, y, uvScale);
  }

  function ringStrip(b, inner, outer, y, uvScale) {
    const n = inner.length;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const p0 = [outer[i][0], y, outer[i][1]];
      const p1 = [inner[i][0], y, inner[i][1]];
      const p2 = [inner[i2][0], y, inner[i2][1]];
      const p3 = [outer[i2][0], y, outer[i2][1]];
      const tl = fbm2(inner[i][0] * 0.2, inner[i][1] * 0.2, 2);
      const shade = 0.86 + tl * 0.18;
      const col = [shade, shade * 0.985, shade * 0.95];
      addQuad(b, [p0, p1, p2, p3], col, [
        [inner[i][0] * uvScale, inner[i][1] * uvScale],
        [outer[i][0] * uvScale, outer[i][1] * uvScale],
        [outer[i2][0] * uvScale, outer[i2][1] * uvScale],
        [inner[i2][0] * uvScale, inner[i2][1] * uvScale],
      ], true);
    }
  }

  function buildAprons(b) {
    for (const s of ellipseShapes) {
      const extra = s.id === 'main-spring' ? 2.6 : s.id === 'lotus-pond' ? 1.7 : 1.25;
      const y = s.id === 'main-spring' ? 0.02 : 0.018 + (s.id === 'lotus-pond' ? 0.001 : 0);
      pushRingApron(b, s, extra, y, 0.5);
    }
    // 溪流两岸细石
    const inner = offsetLoop(CH.pts, CH.hw + CH.rw + 0.02, 10);
    const outer = offsetLoop(CH.pts, CH.hw + CH.rw + 1.15, 10);
    ringStrip(b, inner, outer, 0.017, 0.5);
  }

  function buildPlazas(b) {
    const plazaTop = 0.026;
    const uvScale = 0.45;
    // 东门内广场（牌坊前后）
    const rects = [
      { x0: 85, x1: 105.5, z0: -9.5, z1: 9.5 },
      { x0: -9.5, x1: 9.5, z0: -21.5, z1: -14.5 },
    ];
    for (const r of rects) {
      const stepsX = Math.ceil((r.x1 - r.x0) / 2.2);
      const stepsZ = Math.ceil((r.z1 - r.z0) / 2.2);
      for (let ix = 0; ix < stepsX; ix++) {
        for (let iz = 0; iz < stepsZ; iz++) {
          const x0 = r.x0 + ((r.x1 - r.x0) * ix) / stepsX;
          const x1 = r.x0 + ((r.x1 - r.x0) * (ix + 1)) / stepsX;
          const z0 = r.z0 + ((r.z1 - r.z0) * iz) / stepsZ;
          const z1 = r.z0 + ((r.z1 - r.z0) * (iz + 1)) / stepsZ;
          const cx = (x0 + x1) / 2;
          const cz = (z0 + z1) / 2;
          const border = Math.min(cx - r.x0, r.x1 - cx, cz - r.z0, r.z1 - cz) < 1.3;
          const n = fbm2(cx * 0.3, cz * 0.3, 2);
          const shade = border ? 0.72 + n * 0.1 : 0.9 + n * 0.16;
          const col = [shade, shade * 0.985, shade * 0.95];
          const A = [x0, plazaTop, z0];
          const B = [x1, plazaTop, z0];
          const C = [x1, plazaTop, z1];
          const D = [x0, plazaTop, z1];
          addQuad(b, [A, B, C, D], col, [
            [x0 * uvScale, z0 * uvScale],
            [x1 * uvScale, z0 * uvScale],
            [x1 * uvScale, z1 * uvScale],
            [x0 * uvScale, z1 * uvScale],
          ], true);
        }
      }
    }
  }

  /* ---------------- 落叶贴片 ---------------- */
  function buildLitterPatches() {
    const b = newBuf();
    const colors = {
      willow: new THREE.Color(0x8f8a4a),
      blossom: new THREE.Color(0xcf9fa6),
      maple: new THREE.Color(0xa9603c),
      mixed: new THREE.Color(0x7f7d4d),
    };
    for (const zone of PLANTING_ZONES) {
      const kindKey =
        zone.kind === 'willow'
          ? 'willow'
          : zone.kind === 'blossom'
          ? 'blossom'
          : zone.kind === 'maple'
          ? 'maple'
          : 'mixed';
      const tint = colors[kindKey];
      const n = zone.kind === 'willow' ? 11 : zone.kind === 'blossom' ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const spot = findPlantableSpot(rand, zone.area, {
          marginWater: 1.2,
          marginPath: 0.9,
          marginStructure: 1.0,
        });
        if (!spot) continue;
        const x = spot[0];
        const z = spot[1];
        const size = 1.4 + rand() * 2.1;
        const rot = rand() * Math.PI * 2;
        const cs = Math.cos(rot) * size * 0.5;
        const sn = Math.sin(rot) * size * 0.5;
        const y = 0.012;
        const pts = [
          [x - cs - sn, y, z + sn - cs],
          [x + cs - sn, y, z - sn - cs],
          [x + cs + sn, y, z - sn + cs],
          [x - cs + sn, y, z + sn + cs],
        ];
        const shade = 0.8 + rand() * 0.4;
        const col = [tint.r * shade, tint.g * shade, tint.b * shade];
        addQuad(b, pts, col, [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ], true);
      }
    }
    return b;
  }

  /* ---------------- 积水 ---------------- */
  function buildPuddles() {
    const b = newBuf();
    const spots = [];
    for (const p of PATHS) {
      for (let i = 1; i < p.points.length - 1; i += 2) {
        const a = p.points[i];
        const c = p.points[i + 1];
        const mx = (a[0] + c[0]) / 2;
        const mz = (a[1] + c[1]) / 2;
        if (spots.length < 14 && rand() < 0.55) spots.push([mx, mz, p.width / 2]);
      }
    }
    // 草坪低洼
    const lawnSpots = [
      [12, 26], [-13, 24], [-36, 8], [-8, -50], [24, -42], [58, 8], [44, 36], [-52, 30],
      [70, 4], [-22, 44], [84, 16], [-70, 10],
    ];
    for (const s of lawnSpots) if (rand() < 0.8) spots.push([s[0], s[1], 0.8]);
    let spotIndex = 0;
    for (const [x, z, off] of spots) {
      const rx = 0.7 + rand() * 1.5;
      const rz = rx * (0.55 + rand() * 0.4);
      // 前 8 个取在路面上（高于路面），其余在草地
      const y = spotIndex < 8 ? 0.058 : 0.019;
      spotIndex++;
      const seg = 18;
      const cx = x + (rand() - 0.5) * (off + 1.2);
      const cz = z + (rand() - 0.5) * (off + 1.2);
      if (isWaterAt(cx, cz, 0.6)) continue;
      const base = b.pos.length / 3;
      b.pos.push(cx, y, cz);
      b.nor.push(0, 1, 0);
      b.col.push(0.24, 0.26, 0.25);
      b.uv.push(0.5, 0.5);
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        b.pos.push(cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz);
        b.nor.push(0, 1, 0);
        b.col.push(0.24, 0.26, 0.25);
        b.uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
      }
      for (let i = 0; i < seg; i++) b.idx.push(base, base + 1 + i, base + 1 + ((i + 1) % seg));
    }
    return b;
  }

  /* ---------------- 池底卵石 ---------------- */
  function buildPebbles(count) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6a6a60,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    let i = 0;
    for (const s of ellipseShapes) {
      const n = s.id === 'main-spring' ? Math.round(count * 0.55) : Math.round(count * 0.09);
      for (let k = 0; k < n && i < count; k++) {
        const a = rand() * Math.PI * 2;
        const r = 0.25 + Math.sqrt(rand()) * 0.68;
        const x = s.cx + Math.cos(a) * s.rx * r;
        const z = s.cz + Math.sin(a) * s.rz * r;
        const rr = Math.hypot((x - s.cx) / s.rx, (z - s.cz) / s.rz);
        const y = WATER_LEVEL - s.depth + 0.28 * rr * rr + 0.04;
        const sc = 0.05 + rand() * 0.10;
        pos.set(x, y, z);
        e.set(rand() * 3.14, rand() * 3.14, rand() * 3.14);
        q.setFromEuler(e);
        scl.set(sc * (0.8 + rand() * 0.6), sc * 0.55, sc * (0.8 + rand() * 0.6));
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
        const g = 0.20 + rand() * 0.16;
        col.setRGB(g * 1.02, g * 0.98, g * 0.86);
        mesh.setColorAt(i, col);
        i++;
      }
    }
    // 剩下的随机铺在主池里
    const mainSpring = ellipseShapes.find((s) => s.id === 'main-spring');
    while (i < count) {
      const a = rand() * Math.PI * 2;
      const r = 0.2 + Math.sqrt(rand()) * 0.75;
      const x = mainSpring.cx + Math.cos(a) * mainSpring.rx * r;
      const z = mainSpring.cz + Math.sin(a) * mainSpring.rz * r;
      const rr = Math.hypot((x - mainSpring.cx) / mainSpring.rx, (z - mainSpring.cz) / mainSpring.rz);
      pos.set(x, WATER_LEVEL - mainSpring.depth + 0.28 * rr * rr + 0.04, z);
      e.set(rand() * 3.14, rand() * 3.14, rand() * 3.14);
      q.setFromEuler(e);
      const sc = 0.045 + rand() * 0.09;
      scl.set(sc, sc * 0.5, sc);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      const g = 0.18 + rand() * 0.14;
      col.setRGB(g, g * 0.98, g * 0.9);
      mesh.setColorAt(i, col);
      i++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ---------------- 水草 ---------------- */
  function buildWeeds(count) {
    // 一根 3 段的水草叶片（朝上的薄片）
    const pos = [];
    const col = [];
    const idx = [];
    const pushBlade = (ang) => {
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const w = 0.05;
      const h = 1;
      const bend = 0.18;
      let base = pos.length / 3;
      pos.push(-w * ca, 0, -w * sa);
      pos.push(w * ca, 0, w * sa);
      pos.push(-w * 0.7 * ca + bend * sa, h * 0.5, -w * 0.7 * sa - bend * ca);
      pos.push(w * 0.7 * ca + bend * sa, h * 0.5, w * 0.7 * sa - bend * ca);
      pos.push(bend * sa * 1.7, h, -bend * ca * 1.7);
      for (let k = 0; k < 5; k++) col.push(0.22 + k * 0.01, 0.34 + k * 0.01, 0.16);
      idx.push(base, base + 2, base + 3, base, base + 3, base + 1);
      idx.push(base + 2, base + 4, base + 3);
      base += 5;
    };
    const geo = new THREE.BufferGeometry();
    pushBlade(0);
    pushBlade(1.1);
    pushBlade(2.3);
    pushBlade(3.6);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const posV = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let i = 0;
    for (const s of ellipseShapes) {
      const n = Math.round(count * (s.id === 'main-spring' ? 0.5 : 0.1));
      for (let k = 0; k < n && i < count; k++) {
        const a = rand() * Math.PI * 2;
        const r = 0.72 + rand() * 0.24;
        const x = s.cx + Math.cos(a) * s.rx * r;
        const z = s.cz + Math.sin(a) * s.rz * r;
        const rr = Math.hypot((x - s.cx) / s.rx, (z - s.cz) / s.rz);
        posV.set(x, WATER_LEVEL - s.depth + 0.28 * rr * rr, z);
        e.set((rand() - 0.5) * 0.3, rand() * 3.14, (rand() - 0.5) * 0.3);
        q.setFromEuler(e);
        const sc = 0.25 + rand() * 0.55;
        scl.set(sc, sc, sc);
        m.compose(posV, q, scl);
        mesh.setMatrixAt(i, m);
        i++;
      }
    }
    while (i < count) {
      mesh.setMatrixAt(i, m.identity());
      i++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ---------------- 路边碎石 ---------------- */
  function buildEdgeStones(count) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    let i = 0;
    for (const p of PATHS) {
      const pts = p.points;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const c = pts[k + 1];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const steps = Math.max(1, Math.floor(len / 2.2));
        for (let s = 0; s < steps && i < count; s++) {
          const t = (s + 0.5) / steps;
          const x = a[0] + (c[0] - a[0]) * t;
          const z = a[1] + (c[1] - a[1]) * t;
          const side = rand() > 0.5 ? 1 : -1;
          let tx = c[0] - a[0];
          let tz = c[1] - a[1];
          const tl = Math.hypot(tx, tz) || 1;
          tx /= tl;
          tz /= tl;
          const off = p.width / 2 + 0.28 + rand() * 0.22;
          const px = x - tz * off * side;
          const pz = z + tx * off * side;
          if (isWaterAt(px, pz, 0.2)) continue;
          const sc = 0.05 + rand() * 0.09;
          pos.set(px, sc * 0.45, pz);
          e.set(rand() * 3.14, rand() * 3.14, rand() * 3.14);
          q.setFromEuler(e);
          scl.set(sc, sc * 0.65, sc);
          m.compose(pos, q, scl);
          mesh.setMatrixAt(i, m);
          const g = 0.5 + rand() * 0.22;
          col.setRGB(g, g * 0.97, g * 0.9);
          mesh.setColorAt(i, col);
          i++;
        }
      }
    }
    while (i < count) {
      mesh.setMatrixAt(i, m.identity());
      i++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

/* ================================================================== *
 * 池底 shader
 * ================================================================== */

const COLORS_waterDeep = new THREE.Color(COLORS.waterDeep);
const COLORS_waterShallow = new THREE.Color(COLORS.waterShallow);

function createFloorMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSunIntensity: { value: 1 },
    uAmbientColor: { value: new THREE.Color(1, 1, 1) },
    uAmbientIntensity: { value: 0.5 },
    uHemiSky: { value: new THREE.Color(0.5, 0.7, 1) },
    uHemiGround: { value: new THREE.Color(0.3, 0.3, 0.2) },
    uHemiIntensity: { value: 1 },
    uFogColor: { value: new THREE.Color(0.8, 0.9, 1) },
    uFogDensity: { value: 0.0026 },
    uRain: { value: 0 },
    uSnow: { value: 0 },
    uNight: { value: 0 },
    uDayFactor: { value: 1 },
    uLightning: { value: 0 },
    uWaterLevel: { value: WATER_LEVEL },
    uWaterDeep: { value: new THREE.Color(COLORS.waterDeep) },
    uWaterShallow: { value: new THREE.Color(COLORS.waterShallow) },
  };

  const vertexShader = /* glsl */ `
    attribute float aShore;
    varying vec3 vWorld;
    varying float vShore;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vShore = aShore;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uSunIntensity;
    uniform vec3 uAmbientColor;
    uniform float uAmbientIntensity;
    uniform vec3 uHemiSky;
    uniform vec3 uHemiGround;
    uniform float uHemiIntensity;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uRain;
    uniform float uSnow;
    uniform float uNight;
    uniform float uDayFactor;
    uniform float uLightning;
    uniform float uWaterLevel;
    uniform vec3 uWaterDeep;
    uniform vec3 uWaterShallow;
    varying vec3 vWorld;
    varying float vShore;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm2(vec2 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        s += a * vnoise(p);
        p = p * 2.03 + 13.1;
        a *= 0.5;
      }
      return s;
    }
    // 卵石：3x3 哈希单元内最近的圆石
    vec3 pebbleField(vec2 p) {
      vec2 cell = floor(p);
      vec2 f = fract(p);
      float best = 9.0;
      float id = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 c = g + vec2(hash21(cell + g), hash21(cell + g + 7.3));
          vec2 d = f - c;
          float dist = length(d);
          if (dist < best) {
            best = dist;
            id = hash21(cell + g + 3.7);
          }
        }
      }
      float radius = 0.22 + id * 0.20;
      float stone = smoothstep(radius, radius - 0.07, best);
      float tone = 0.55 + id * 0.45;
      return vec3(stone, tone, id);
    }
    // 焦散：距离场脊线
    float caustic(vec2 p, float t) {
      vec2 q = p * 0.9;
      vec2 flow = vec2(t * 0.05, t * 0.035);
      float v = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 c = q + g;
          vec2 o = vec2(hash21(floor(c) + flow * 3.0), hash21(floor(c) + 11.7 - flow * 3.0));
          vec2 nc = c + o;
          float d = length(fract(q) - fract(nc));
          v += 0.02 / (d * d + 0.025);
        }
      }
      return clamp(v * 0.12, 0.0, 1.0);
    }
    void main() {
      vec2 p = vWorld.xz;
      float shore = clamp(vShore, 0.0, 1.0);

      // 底质：细沙 + 卵石
      float sandN = fbm2(p * 0.75);
      vec3 sand = mix(vec3(0.34, 0.32, 0.24), vec3(0.50, 0.47, 0.36), sandN);
      vec3 pb = pebbleField(p * 3.4);
      vec3 pebbleCol = mix(vec3(0.30, 0.30, 0.26), vec3(0.52, 0.50, 0.42), pb.y);
      pebbleCol = mix(pebbleCol, vec3(0.24, 0.24, 0.20), pb.z * 0.5);
      vec3 bed = mix(sand, pebbleCol, pb.x * 0.34);

      // 藻类 / 水草斑
      float weedN = fbm2(p * 0.55 + vec2(3.1, 8.7));
      float weed = smoothstep(0.52, 0.78, weedN) * smoothstep(0.85, 0.15, shore);
      bed = mix(bed, vec3(0.09, 0.16, 0.07), weed * 0.7);
      // 岸边石壁苔痕 & 泥沙
      bed = mix(bed, vec3(0.14, 0.19, 0.11), smoothstep(0.45, 0.0, shore) * 0.55);

      // 光照（近似：底面法线朝上）
      float ndl = max(uSunDir.y, 0.0);
      vec3 light = uAmbientColor * uAmbientIntensity * 0.9
                 + mix(uHemiGround, uHemiSky, 0.6) * uHemiIntensity * 0.5
                 + uSunColor * uSunIntensity * ndl * 0.35;
      // 池底整体压暗（深水吸收）；泉水清冽但深池不应发白
      vec3 col = bed * light * 1.15;

      // 焦散（晴天明显，阴雨减弱）
      float ca = caustic(p, uTime);
      ca = pow(ca, 1.9) * (0.35 + 0.65 * uDayFactor);
      col += uSunColor * uSunIntensity * 0.030 * ca * (1.0 - uRain * 0.6) * (1.0 - uNight * 0.8);
      col += vec3(0.5, 0.75, 0.72) * caustic(p * 1.7, uTime * 1.3) * 0.012 * uDayFactor;

      // 水体吸收：越深越偏青
      float depth = clamp(uWaterLevel - vWorld.y, 0.0, 3.2);
      float absorb = clamp(depth / 1.45, 0.0, 1.0);
      // 深水吸收 → 墨青/碧色；浅处保留卵石与焦散
      col = mix(col, uWaterDeep * 0.72, absorb * 0.70);
      col = mix(col, vec3(0.10, 0.26, 0.25), smoothstep(0.55, 1.0, absorb) * 0.35);

      // 天气
      col *= (1.0 - uRain * 0.18);
      col *= (1.0 - uNight * 0.45);
      col += uLightning * vec3(0.3, 0.35, 0.45);

      // 雾
      float dist = length(cameraPosition - vWorld);
      float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      col = mix(col, uFogColor, fogF);

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    fog: false,
  });
}

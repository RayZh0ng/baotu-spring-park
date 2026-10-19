import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 建筑几何工具箱：
 *  - Builder：把上千个 box/cylinder/自定义曲面按材质合并成少数 Mesh（draw call 关键）。
 *  - Instancer：瓦当 / 斗拱等重复构件的 InstancedMesh 包装。
 *  - 常用构件几何（斗拱、瓦当、鸱吻、宝顶、太湖石变形）。
 *
 * 约定：进深方向 local +Z 为正立面朝向；+X 为面阔方向；原点在建筑中心地面。
 */

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/* ------------------------------------------------------------------ 合并 */

export class Builder {
  constructor() {
    this.buckets = new Map();
    this.matrix = new THREE.Matrix4();
    this.stack = [];
    this.extras = [];
  }

  /** 压入局部坐标系（位置 + 绕 Y 旋转） */
  push(x, y, z, ry = 0) {
    this.stack.push(this.matrix.clone());
    _m2.makeRotationY(ry);
    _m2.setPosition(x, y, z);
    this.matrix.multiply(_m2);
    return this;
  }

  pop() {
    const m = this.stack.pop();
    if (m) this.matrix.copy(m);
    return this;
  }

  /** 加入几何（会接管并销毁传入几何） */
  addGeo(key, geo, local) {
    let g = geo;
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      g = ng;
    }
    const target = local ? _m.copy(this.matrix).multiply(local) : this.matrix;
    g.applyMatrix4(target);
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    let arr = this.buckets.get(key);
    if (!arr) {
      arr = [];
      this.buckets.set(key, arr);
    }
    arr.push(g);
  }

  box(key, w, h, d, x, y, z, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.uv) scaleBoxUV(g, w, h, d, o.uv);
    let local = null;
    if (o.rx || o.ry || o.rz) {
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
      _m2.makeRotationFromEuler(_e);
      _m2.setPosition(x, y, z);
      local = _m2;
    } else {
      _m2.identity().setPosition(x, y, z);
      local = _m2;
    }
    this.addGeo(key, g, _m.clone().copy(local));
  }

  /** 面片：默认朝 +Z */
  plane(key, w, h, x, y, z, o = {}) {
    const g = new THREE.PlaneGeometry(w, h);
    if (o.uv) {
      const uv = g.getAttribute('uv');
      const ux = Array.isArray(o.uv) ? o.uv[0] : o.uv;
      const uy = Array.isArray(o.uv) ? o.uv[1] : o.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ux, uv.getY(i) * uy);
    }
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _m2.makeRotationFromEuler(_e);
    _m2.setPosition(x, y, z);
    this.addGeo(key, g, _m.clone().copy(_m2));
  }

  cyl(key, rTop, rBot, h, seg, x, y, z, o = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!o.open);
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _m2.makeRotationFromEuler(_e);
    _m2.setPosition(x, y, z);
    if (o.sx || o.sy || o.sz) {
      _v.set(o.sx || 1, o.sy || 1, o.sz || 1);
      _m2.scale(_v);
    }
    this.addGeo(key, g, _m.clone().copy(_m2));
  }

  sphere(key, r, x, y, z, o = {}) {
    const seg = o.seg || 10;
    const g = new THREE.IcosahedronGeometry(r, o.detail != null ? o.detail : 1);
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _m2.makeRotationFromEuler(_e);
    _m2.setPosition(x, y, z);
    _v.set(o.sx || 1, o.sy || 1, o.sz || 1);
    _m2.scale(_v);
    this.addGeo(key, g, _m.clone().copy(_m2));
  }

  /** 两点之间的方料（椽、栏杆、脊） */
  bar(key, a, b, w, h) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) return;
    const g = new THREE.BoxGeometry(len, h, w);
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(X_AXIS, _v);
    _v2.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _m2.compose(_v2, _q, ONE);
    this.addGeo(key, g, _m.clone().copy(_m2));
  }

  /** 折线圆管（翘角、脊线） */
  tube(key, points, radius, seg = 6, radial = 5) {
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, seg, radius, radial, false);
    this.addGeo(key, g, null);
  }

  /** 外部独立 Mesh（匾额等唯一贴图），套用当前坐标系 */
  addMesh(obj) {
    obj.applyMatrix4(this.matrix);
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
    this.extras.push(obj);
    return obj;
  }

  finish(group, materials) {
    let count = 0;
    for (const [key, list] of this.buckets) {
      if (!list || !list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) {
        console.warn('[arch] mergeGeometries failed for material', key);
        continue;
      }
      const meta = materials[key];
      if (!meta) {
        console.warn('[arch] missing material', key);
        merged.dispose();
        continue;
      }
      const mesh = new THREE.Mesh(merged, meta.mat);
      mesh.castShadow = meta.cast !== false;
      mesh.receiveShadow = meta.receive !== false;
      mesh.name = `arch-${key}`;
      group.add(mesh);
      count++;
    }
    this.buckets.clear();
    for (const o of this.extras) group.add(o);
    this.extras.length = 0;
    return count;
  }
}

function scaleBoxUV(geo, w, h, d, scale) {
  const uv = geo.getAttribute('uv');
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const du = dims[f][0] * scale;
    const dv = dims[f][1] * scale;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * du, uv.getY(idx) * dv);
    }
  }
  uv.needsUpdate = true;
}

/* -------------------------------------------------------------- Instancer */

export class Instancer {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.matrices = [];
  }

  addMatrix(m) {
    this.matrices.push(m.clone());
  }

  /** 在当前 Builder 坐标系内放置 */
  addAt(builder, local) {
    const m = local ? _m.copy(builder.matrix).multiply(local) : builder.matrix;
    this.matrices.push(m.clone());
  }

  build(group, name, opts = {}) {
    const n = this.matrices.length;
    if (!n) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, n);
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, this.matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = opts.receive !== false;
    mesh.frustumCulled = false;
    mesh.name = name;
    group.add(mesh);
    return mesh;
  }
}

/* ------------------------------------------------------- 构件几何（缓存） */

let _dougongGeo = null;
export function dougongGeometry() {
  if (_dougongGeo) return _dougongGeo;
  const parts = [];
  const add = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g.toNonIndexed());
    g.dispose();
  };
  // 坐斗
  add(0.36, 0.22, 0.36, 0, 0.11, 0);
  // 一层：泥道拱（X 向）+ 华拱（Z 向）
  add(0.98, 0.13, 0.17, 0, 0.3, 0);
  add(0.17, 0.13, 0.68, 0, 0.36, 0);
  // 散斗
  add(0.18, 0.12, 0.18, -0.42, 0.42, 0);
  add(0.18, 0.12, 0.18, 0.42, 0.42, 0);
  add(0.18, 0.12, 0.18, 0, 0.48, -0.28);
  add(0.18, 0.12, 0.18, 0, 0.48, 0.28);
  // 二层
  add(1.2, 0.11, 0.16, 0, 0.56, 0);
  add(0.16, 0.11, 0.84, 0, 0.62, 0);
  // 令拱两端小斗
  add(0.15, 0.15, 0.15, -0.56, 0.68, 0);
  add(0.15, 0.15, 0.15, 0.56, 0.68, 0);
  add(0.15, 0.15, 0.15, 0, 0.7, -0.4);
  add(0.15, 0.15, 0.15, 0, 0.7, 0.4);
  _dougongGeo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return _dougongGeo;
}

let _tileCapGeo = null;
export function tileCapGeometry() {
  if (_tileCapGeo) return _tileCapGeo;
  // 半径 1、短轴沿 Y；实例矩阵缩放/定向
  _tileCapGeo = new THREE.CylinderGeometry(1, 0.84, 1, 5, 1, false);
  return _tileCapGeo;
}

let _chiwenGeo = null;
export function chiwenGeometry() {
  if (_chiwenGeo) return _chiwenGeo;
  const shape = new THREE.Shape();
  shape.moveTo(-0.36, 0);
  shape.lineTo(0.36, 0);
  shape.lineTo(0.42, 0.34);
  shape.quadraticCurveTo(0.46, 0.6, 0.28, 0.74);
  shape.quadraticCurveTo(0.12, 0.84, 0.2, 1.02);
  shape.quadraticCurveTo(0.0, 0.98, -0.02, 0.78);
  shape.quadraticCurveTo(-0.08, 0.56, -0.2, 0.44);
  shape.quadraticCurveTo(-0.32, 0.3, -0.36, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -0.15);
  _chiwenGeo = g;
  return g;
}

let _finialGeo = null;
export function finialGeometry() {
  if (_finialGeo) return _finialGeo;
  const parts = [];
  const add = (geo, y) => {
    geo.translate(0, y, 0);
    parts.push(geo);
  };
  add(new THREE.CylinderGeometry(0.34, 0.42, 0.18, 8), 0.09);
  add(new THREE.CylinderGeometry(0.2, 0.32, 0.22, 8), 0.28);
  add(new THREE.SphereGeometry(0.3, 8, 6), 0.5);
  add(new THREE.CylinderGeometry(0.12, 0.18, 0.2, 8), 0.78);
  add(new THREE.SphereGeometry(0.2, 8, 6), 0.98);
  add(new THREE.ConeGeometry(0.13, 0.34, 8), 1.22);
  const nonIdx = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    return n;
  });
  _finialGeo = mergeGeometries(nonIdx, false);
  for (const g of nonIdx) g.dispose();
  return _finialGeo;
}

/* ------------------------------------------------------------ 通用构件 */

/** 檐柱（含柱础） */
export function column(B, opts) {
  const { x, z, baseY, h, r = 0.24, mat = 'vermilion', plinthMat = 'stoneLight', cap = true } = opts;
  if (cap) {
    B.cyl(plinthMat, r * 1.62, r * 1.82, 0.14, 10, x, baseY + 0.07, z);
    B.cyl(plinthMat, r * 1.28, r * 1.48, 0.12, 10, x, baseY + 0.19, z);
  }
  B.cyl(mat, r * 0.9, r, h, 10, x, baseY + 0.25 + h / 2, z);
}

/** 台基：砖身 + 阶条石 + 土衬 */
export function plinth(B, opts) {
  const {
    w, d, h, x = 0, z = 0,
    body = 'brick', cap = 'stoneLight', base = 'stoneDark',
    over = 0.26, uv = 0.5,
  } = opts;
  if (h <= 0.001) return;
  const bodyH = Math.max(0.05, h - 0.18);
  B.box(base, w + 0.12, 0.1, d + 0.12, x, 0.05, z, { uv });
  B.box(body, w, bodyH, d, x, 0.1 + bodyH / 2, z, { uv });
  B.box(cap, w + over, 0.16, d + over, x, h - 0.08, z, { uv: uv * 1.2 });
}

/** 台阶：从平台前缘（local z=0, y=topY）向 +Z 下行 */
export function stairs(B, opts) {
  const {
    w, topY, steps = 4, run = 0.36, x = 0, z = 0, ry = 0,
    mat = 'stoneLight', side = false, coping = true, nosing = true,
  } = opts;
  if (topY <= 0.02) return;
  const stepH = topY / (steps + 1);
  B.push(x, 0, z, ry);
  for (let i = 0; i < steps; i++) {
    const top = topY - stepH * (i + 1);
    if (top <= 0.025) continue;
    // 踏面
    B.box(mat, w, top, run, 0, top / 2, run * (i + 0.5), { uv: 0.7 });
    // 踏面前缘的"石鼻"（突出 2cm，形成台阶阴影线，近看非常提质感）
    if (nosing && top > 0.12) {
      B.box('stone', w, 0.035, 0.05, 0, top - 0.018, run * (i + 0.5) + run * 0.5 + 0.012, { uv: 0.9 });
    }
    // 踏面石缝（中间一道分割线，避免一整块大石）
    if (w > 2.4) {
      B.box('stoneDark', 0.025, 0.008, run * 0.92, 0, top + 0.004, run * (i + 0.5), {});
    }
  }
  if (side) {
    const outZ = run * steps + 0.15;
    B.bar(mat, [-w / 2 - 0.12, topY, -0.1], [-w / 2 - 0.12, 0.02, outZ], 0.26, 0.22);
    B.bar(mat, [w / 2 + 0.12, topY, -0.1], [w / 2 + 0.12, 0.02, outZ], 0.26, 0.22);
  }
  // 两侧垂带石：沿梯段斜向的石条（中国台基的典型做法）
  if (coping && steps >= 3) {
    for (const sx of [-1, 1]) {
      const x0 = sx * (w / 2 + 0.16);
      // 从地面斜升到台基顶，再在顶部压一小段平石（收口自然）
      B.bar('stone', [x0, topY * 0.5, run * steps * 0.55], [x0, topY, run * steps + 0.08], 0.30, 0.24);
      B.bar('stone', [x0, topY - 0.04, run * steps + 0.02], [x0, topY - 0.04, run * steps + 0.30], 0.32, 0.12);
    }
  }
  B.pop();
}

/** 坐凳栏杆（沿 X 方向，z 为本地横坐标） */
export function benchRail(B, opts) {
  const {
    x0, x1, z, y = 0, mat = 'vermilion', seatMat = 'woodDark', posts = 0,
  } = opts;
  const len = x1 - x0;
  if (len <= 0.1) return;
  const cx = (x0 + x1) / 2;
  B.box(seatMat, len, 0.09, 0.34, cx, y + 0.47, z, { uv: 0.6 });
  B.box(seatMat, len, 0.06, 0.08, cx, y + 0.75, z + 0.14, { uv: 0.6 });
  // 靠背小立柱
  const n = Math.max(2, Math.round(len / 1.1));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (len / n) * i;
    B.box(mat, 0.07, 0.34, 0.07, x, y + 0.29, z, {});
    B.box(mat, 0.07, 0.1, 0.26, x, y + 0.75, z + 0.05, {});
  }
  // 座面下小枋
  B.box(mat, len, 0.08, 0.1, cx, y + 0.38, z - 0.06, {});
  if (posts > 0) {
    for (let i = 0; i < posts; i++) {
      const x = x0 + (len / (posts - 1 || 1)) * i;
      B.box(mat, 0.12, 0.44, 0.12, x, y + 0.22, z, {});
    }
  }
}

/** 石栏板 + 望柱：沿一组 [x,y,z] 点（同一高度） */
export function stoneBalustrade(B, opts) {
  const {
    points, h = 0.95, thickness = 0.16, y = 0,
    postMat = 'stoneLight', panelMat = 'stone', postEvery = 1.1,
    closed = false,
  } = opts;
  const pts = closed ? [...points, points[0]] : points;
  if (pts.length < 2) return;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (segLen < 1e-4) continue;
    // 栏板
    B.bar(panelMat, [a[0], y + h * 0.52, a[2]], [b[0], y + h * 0.52, b[2]], thickness, h * 0.5);
    // 扶手
    B.bar(postMat, [a[0], y + h, a[2]], [b[0], y + h, b[2]], thickness * 1.35, 0.13);
    // 望柱
    const n = Math.max(2, Math.round(segLen / postEvery));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      B.box(postMat, thickness * 1.7, h + 0.12, thickness * 1.7, x, y + (h + 0.12) / 2, z, { uv: 0.5 });
      B.box(postMat, thickness * 1.3, 0.12, thickness * 1.3, x, y + h + 0.18, z, {});
    }
    acc += segLen;
  }
}

/** 木格窗 / 隔扇面板（朝 +Z），带木框 */
export function latticePanel(B, opts) {
  const {
    w, h, x = 0, y = 0, z = 0, mat = 'latticeA', frame = true,
    frameMat = 'woodRed', uvX = null, uvY = null,
  } = opts;
  B.plane(mat, w, h, x, y + h / 2, z, { uv: [uvX != null ? uvX : Math.max(1, w / 1.15), uvY != null ? uvY : 1] });
  if (frame) {
    const t = 0.075;
    B.box(frameMat, w + t * 2, t, 0.14, x, y + t / 2, z - 0.01, {});
    B.box(frameMat, w + t * 2, t, 0.14, x, y + h - t / 2, z - 0.01, {});
    B.box(frameMat, t, h, 0.14, x - w / 2 - t / 2, y + h / 2, z - 0.01, {});
    B.box(frameMat, t, h, 0.14, x + w / 2 + t / 2, y + h / 2, z - 0.01, {});
    // 中竖梃
    B.box(frameMat, t * 0.7, h, 0.1, x, y + h / 2, z - 0.02, {});
  }
}

/** 挂落（檐下花格） */
export function fretwork(B, opts) {
  const { x0, x1, y, z, depth = 0.34, mat = 'woodRed', density = 0.34 } = opts;
  const len = x1 - x0;
  const n = Math.max(2, Math.round(len / density));
  for (let i = 0; i < n; i++) {
    const xa = x0 + (len / n) * i;
    const xb = x0 + (len / n) * (i + 1);
    const xm = (xa + xb) / 2;
    B.box(mat, 0.05, depth, 0.05, xa, y - depth / 2, z, {});
    B.box(mat, xb - xa - 0.04, 0.05, 0.05, xm, y - 0.04, z, {});
    B.box(mat, xb - xa - 0.04, 0.05, 0.05, xm, y - depth + 0.03, z, {});
    if (i % 2 === 0) B.box(mat, 0.05, depth * 0.8, 0.05, xm, y - depth * 0.5, z, {});
  }
}

/** 匾额（独立贴图 Mesh，挂在建筑上） */
export function plaque(site, opts) {
  const {
    text, w, h, x = 0, y = 0, z = 0, vertical = false,
    fontScale = 0.62, both = false, bg, fg, border,
  } = opts;
  const tex = site.makePlaqueTexture({ text, vertical, size: 512, fontScale, bg, fg, border });
  const mat = site.mats.makePlaqueMaterial(tex);
  const geo = new THREE.PlaneGeometry(w, h);
  const front = new THREE.Mesh(geo, mat);
  front.position.set(x, y, z);
  site.B.addMesh(front);
  // 背板 + 边框
  site.B.box('woodDark', w + 0.16, h + 0.16, 0.12, x, y, z - 0.08, {});
  site.B.box('goldDim', w + 0.22, 0.045, 0.08, x, y + h / 2 + 0.1, z - 0.06, {});
  site.B.box('goldDim', w + 0.22, 0.045, 0.08, x, y - h / 2 - 0.1, z - 0.06, {});
  if (both) {
    const back = new THREE.Mesh(geo, mat);
    back.position.set(x, y, z - 0.14);
    back.rotation.y = Math.PI;
    site.B.addMesh(back);
  }
  return mat;
}

/** 建筑挂灯 */
export function lantern(B, opts) {
  const { x, y, z, r = 0.2 } = opts;
  B.sphere('lantern', r, x, y, z, { sy: 1.2, sx: 1, sz: 1 });
  B.cyl('goldDim', r * 0.5, r * 0.62, 0.07, 8, x, y + r * 1.12, z);
  B.cyl('goldDim', r * 0.42, r * 0.42, 0.06, 8, x, y - r * 1.1, z);
  B.cyl('goldDim', 0.014, 0.014, 0.42, 4, x, y + r * 1.35, z);
  B.cyl('lantern', 0.022, 0.05, 0.3, 5, x, y - r * 1.3, z);
  B.cyl('goldDim', 0.03, 0.03, 0.05, 5, x, y - r * 1.47, z);
}

/** 地面铺装（水平面） */
export function paving(B, opts) {
  const { x0, z0, x1, z1, y = 0.02, mat = 'paving', uv = 0.5 } = opts;
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  const g = new THREE.PlaneGeometry(w, d);
  const u = g.getAttribute('uv');
  for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * w * uv, u.getY(i) * d * uv);
  _e.set(-Math.PI / 2, 0, 0);
  _m2.makeRotationFromEuler(_e);
  _m2.setPosition((x0 + x1) / 2, y, (z0 + z1) / 2);
  B.addGeo(mat, g, _m.clone().copy(_m2));
}

/* ------------------------------------------------------- 太湖石变形工具 */

/** 变形多面体岩石（返回新几何，顶点沿法向噪声位移） */
export function deformRock(geo, rand, amount = 0.35, squashY = 1) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const n = 0.72 + rand() * 0.56;
    const x = pos.getX(i) + nrm.getX(i) * amount * n;
    const y = (pos.getY(i) + nrm.getY(i) * amount * n) * squashY;
    const z = pos.getZ(i) + nrm.getZ(i) * amount * n;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export { X_AXIS, Y_AXIS, Z_AXIS };

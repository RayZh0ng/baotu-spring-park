import * as THREE from 'three';

/**
 * 程序化几何合并工具（仅构建期使用，不进入每帧循环）。
 * 目标：把大量静态小几何压成单 mesh / InstancedMesh，减少 draw call。
 */

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** 生成 TRS 矩阵（构建期） */
export function trs(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(px, py, pz);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** 把几何转为 non-indexed、补 uv，并应用可选矩阵（返回克隆） */
export function bake(geo, matrix = null) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  if (!g.getAttribute('uv')) {
    const n = g.getAttribute('position').count;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** 合并一组（已 bake / non-indexed）几何，返回单个 BufferGeometry */
export function mergeGeometries(list) {
  const geos = list.filter(Boolean);
  if (geos.length === 0) return new THREE.BufferGeometry();
  let total = 0;
  for (const g of geos) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let hasColor = false;
  for (const g of geos) if (g.getAttribute('color')) hasColor = true;
  let o3 = 0;
  let o2 = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    pos.set(p.array, o3);
    if (n) nor.set(n.array, o3);
    if (u) uv.set(u.array, o2);
    if (hasColor) {
      const c = g.getAttribute('color');
      if (c) col.set(c.array, o3);
      else col.fill(1, o3, o3 + p.count * 3);
    }
    o3 += p.count * 3;
    o2 += p.count * 2;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (hasColor) merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.computeBoundingSphere();
  return merged;
}

/** 便捷：若干个 [geo, matrix] 一起合并 */
export function mergeAll(items) {
  return mergeGeometries(items.map(([g, m]) => bake(g, m)));
}

/* ------------------------------------------------------------------ 常用体块 */

export const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt, rb, h, seg = 6, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open),
  cone: (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg),
  sphere: (r, ws = 7, hs = 5) => new THREE.SphereGeometry(r, ws, hs),
  dodeca: (r) => new THREE.DodecahedronGeometry(r, 0),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
};

/** 圆柱，底面在 y=0 */
export function pillar(rTop, rBottom, h, seg = 6) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false);
  g.translate(0, h / 2, 0);
  return g;
}

/**
 * 沿折线生成圆管（用于树干/枝干）。
 * points: [[x,y,z], ...]；radii: 每个点半径。
 */
export function tubeGeometry(points, radii, radialSegments = 5) {
  const n = points.length;
  const R = radialSegments;
  const pos = [];
  const uv = [];
  const idx = [];
  const centers = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const a = centers[Math.max(0, i - 1)];
    const b = centers[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a);
    if (t.lengthSq() < 1e-8) t.set(0, 1, 0);
    tangents.push(t.normalize());
  }
  const up = new THREE.Vector3(0, 1, 0);
  const altUp = new THREE.Vector3(1, 0, 0);
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  let vAcc = 0;
  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    const ref = Math.abs(t.dot(up)) > 0.94 ? altUp : up;
    n1.crossVectors(ref, t).normalize();
    n2.crossVectors(t, n1).normalize();
    if (i > 0) vAcc += centers[i].distanceTo(centers[i - 1]) / 1.6;
    const r = radii[Math.min(radii.length - 1, i)];
    for (let j = 0; j < R; j++) {
      const a = (j / R) * Math.PI * 2;
      const ca = Math.cos(a) * r;
      const sa = Math.sin(a) * r;
      pos.push(
        centers[i].x + n1.x * ca + n2.x * sa,
        centers[i].y + n1.y * ca + n2.y * sa,
        centers[i].z + n1.z * ca + n2.z * sa
      );
      uv.push(j / R, vAcc);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < R; j++) {
      const j2 = (j + 1) % R;
      const a = i * R + j;
      const b = i * R + j2;
      const c = (i + 1) * R + j;
      const d = (i + 1) * R + j2;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 简单圆点 tube（两点之间） */
export function branch(a, b, r0, r1, seg = 5) {
  return tubeGeometry([a, b], [r0, r1], seg);
}

/* ------------------------------------------------------------------ 叶卡几何 */

/** 竖直平面卡片（中心在原点） */
export function cardGeometry(w, h) {
  return new THREE.PlaneGeometry(w, h, 1, 1);
}

/**
 * 垂挂卡片：顶边在 y=0，向下 h；带轻微外弧与收窄，模拟垂柳柳帘。
 */
export function hangingCardGeometry(w, h, opts = {}) {
  const { bow = 0.22, segX = 1, segY = 5, taper = 0.18, curl = 0.1 } = opts;
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  g.translate(0, -h / 2, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const t = Math.min(1, Math.max(0, -y / h));
    p.setX(i, x * (1 - taper * t));
    p.setZ(i, bow * t * t * h * 0.5 + Math.sin(t * 2.2) * curl * t * 0.1);
  }
  g.computeVertexNormals();
  return g;
}

/** 水平圆盘（荷叶/苔藓/水波装饰） */
export function discGeometry(r, seg = 18) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** 交叉双片草卡（十字形，中心在底部） */
export function crossCardGeometry(w, h) {
  const a = new THREE.PlaneGeometry(w, h, 1, 1);
  a.translate(0, h / 2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  return mergeGeometries([bake(a), bake(b)]);
}

/** 花瓣几何：底部窄、上端圆尖，带外弧；顶点色由白到粉。 */
export function petalGeometry(opts = {}) {
  const { base = '#fff8f4', tip = '#e8a9b4', height = 1, maxW = 0.24, curve = 0.16 } = opts;
  const cols = 3;
  const rows = 7;
  const pos = [];
  const uv = [];
  const idx = [];
  const cBase = new THREE.Color(base);
  const cTip = new THREE.Color(tip);
  const col = [];
  const _c = new THREE.Color();
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const yy = t * height;
    // 花瓣宽度：基部窄 → 中部宽 → 尖端收
    const wProf = Math.sin(Math.PI * Math.min(1, t * 1.02)) * (1 - 0.15 * t);
    const half = maxW * 0.5 * Math.max(0.06, wProf);
    const z = Math.sin(t * Math.PI) * curve * 0.35 + t * t * curve;
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const xx = (u - 0.5) * 2 * half;
      pos.push(xx, yy, z + Math.abs(u - 0.5) * 0.02);
      uv.push(u, t);
      _c.copy(cBase).lerp(cTip, Math.pow(t, 0.8));
      col.push(_c.r, _c.g, _c.b);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ InstancedMesh */

/**
 * 创建 InstancedMesh。matrices: Matrix4[]；colors 可选 THREE.Color[]。
 */
export function instanced(geo, material, matrices, opts = {}) {
  const { colors = null, castShadow = true, receiveShadow = false, name = '' } = opts;
  const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.needsUpdate = true;
  if (colors) {
    for (let i = 0; i < colors.length; i++) mesh.setColorAt(i, colors[i]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = false;
  if (name) mesh.name = name;
  return mesh;
}

/** 把一组 (geo + matrix) 合并成单个静态 Mesh */
export function mergedMesh(items, material, opts = {}) {
  const { castShadow = true, receiveShadow = true, name = '' } = opts;
  const mesh = new THREE.Mesh(mergeAll(items), material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  if (name) mesh.name = name;
  return mesh;
}

/** 释放几何 */
export function disposeGeometries(geos) {
  for (const g of geos) {
    if (g && g.dispose) g.dispose();
  }
}

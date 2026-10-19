/**
 * 锦鲤（A · 泉与地形 / water 子模块）
 * ------------------------------------------------------------------
 * 主泉池 6 尾、荷花池 3 尾低模锦鲤：一个 InstancedMesh（1 draw call）共享
 * 顶点色鱼身（橙白斑纹），每帧只更新 instanceMatrix。鱼在水面下约 0.5m
 * 沿椭圆路径游弋，偶尔摆尾（整鱼 yaw 微摆），不穿出水面、无碰撞体。
 */

import * as THREE from 'three';
import { WATER_LEVEL } from '../../layout.js';
import { mulberry32, fbm2 } from '../../utils/random.js';

/* ---------------- 低模鱼几何（本地 +X = 鱼头方向） ---------------- */

function createKoiGeometry() {
  const positions = [];
  const colors = [];
  const indices = [];

  const pushVert = (x, y, z, r, g, b) => {
    positions.push(x, y, z);
    colors.push(r, g, b);
    return positions.length / 3 - 1;
  };

  // 鱼身：拉长的多面体（低多边形）
  const bodyRings = 9;
  const bodySegs = 8;
  const ringVerts = [];
  for (let i = 0; i < bodyRings; i++) {
    const t = i / (bodyRings - 1); // 0 尾 → 1 头
    const x = -0.34 + t * 0.7;
    const profile = Math.sin(Math.PI * Math.pow(t, 0.82));
    const ry = 0.105 * profile + 0.012;
    const rz = 0.075 * profile + 0.01;
    const row = [];
    for (let j = 0; j < bodySegs; j++) {
      const a = (j / bodySegs) * Math.PI * 2;
      const y = Math.sin(a) * ry;
      const z = Math.cos(a) * rz;
      // 橙白锦鲤斑纹
      const patch = fbm2(x * 8.5 + 3.1, z * 14.0 + y * 9.5 + 7.7, 2);
      const belly = y < -ry * 0.25 ? 0.35 : 0;
      let r;
      let g;
      let b;
      if (patch > 0.58 || belly > 0) {
        // 白
        const k = 0.86 + (patch - 0.58) * 0.3;
        r = k;
        g = k * 0.97;
        b = k * 0.9;
      } else {
        // 橙红
        const k = 0.62 + patch * 0.5;
        r = 0.78 * k;
        g = 0.32 * k;
        b = 0.14 * k;
      }
      // 背部略深
      if (y > ry * 0.4) {
        r *= 0.82;
        g *= 0.78;
        b *= 0.72;
      }
      row.push(pushVert(x, y, z, r, g, b));
    }
    ringVerts.push(row);
  }
  for (let i = 0; i < bodyRings - 1; i++) {
    for (let j = 0; j < bodySegs; j++) {
      const j2 = (j + 1) % bodySegs;
      const a = ringVerts[i][j];
      const b = ringVerts[i][j2];
      const c = ringVerts[i + 1][j];
      const d = ringVerts[i + 1][j2];
      indices.push(a, c, b, b, c, d);
    }
  }
  // 头尾封口
  const headC = pushVert(0.38, 0, 0, 0.9, 0.55, 0.42);
  const tailC = pushVert(-0.35, 0, 0, 0.85, 0.9, 0.85);
  const last = ringVerts[bodyRings - 1];
  const first = ringVerts[0];
  for (let j = 0; j < bodySegs; j++) {
    const j2 = (j + 1) % bodySegs;
    indices.push(headC, last[j], last[j2]);
    indices.push(tailC, first[j2], first[j]);
  }

  // 尾鳍（两片）
  const t0 = pushVert(-0.34, 0, 0, 0.95, 0.93, 0.86);
  const t1 = pushVert(-0.56, 0.055, 0.13, 0.92, 0.9, 0.82);
  const t2 = pushVert(-0.5, 0.0, 0.015, 0.95, 0.94, 0.88);
  const t3 = pushVert(-0.56, 0.055, -0.13, 0.92, 0.9, 0.82);
  const t4 = pushVert(-0.5, 0.0, -0.015, 0.95, 0.94, 0.88);
  indices.push(t0, t1, t2);
  indices.push(t0, t2, t3);
  indices.push(t0, t3, t4);

  // 背鳍
  const d0 = pushVert(0.16, 0.105, 0, 0.58, 0.28, 0.16);
  const d1 = pushVert(-0.16, 0.105, 0, 0.58, 0.28, 0.16);
  const d2 = pushVert(-0.04, 0.19, 0, 0.66, 0.34, 0.2);
  indices.push(d0, d1, d2);

  // 胸鳍
  for (const side of [1, -1]) {
    const p0 = pushVert(0.16, -0.02, side * 0.07, 0.9, 0.88, 0.8);
    const p1 = pushVert(0.02, -0.05, side * 0.17, 0.9, 0.88, 0.8);
    const p2 = pushVert(-0.06, -0.015, side * 0.08, 0.9, 0.88, 0.8);
    if (side > 0) indices.push(p0, p1, p2);
    else indices.push(p0, p2, p1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/* ---------------- 主入口 ---------------- */

const FISH = [
  // 主泉池（椭圆路径在池内）
  { cx: 0, cz: 0, rx: 12.2, rz: 7.8, y: -1.05, speed: 0.055, phase: 0.2, scale: 1.0 },
  { cx: 0, cz: 0, rx: 9.4, rz: 10.2, y: -1.25, speed: -0.045, phase: 2.1, scale: 0.85 },
  { cx: -2, cz: 1, rx: 13.6, rz: 6.1, y: -0.9, speed: 0.038, phase: 4.0, scale: 1.12 },
  { cx: 1, cz: -1, rx: 7.2, rz: 5.4, y: -1.4, speed: -0.062, phase: 5.2, scale: 0.75 },
  { cx: 3, cz: 2, rx: 10.6, rz: 9.0, y: -1.15, speed: 0.05, phase: 1.2, scale: 0.95 },
  { cx: -3, cz: -2, rx: 15.0, rz: 4.6, y: -0.85, speed: -0.034, phase: 3.2, scale: 1.05 },
  // 荷花池
  { cx: 18, cz: 62, rx: 6.6, rz: 5.9, y: -0.92, speed: 0.06, phase: 0.7, scale: 0.9 },
  { cx: 18, cz: 62, rx: 5.6, rz: 6.8, y: -1.05, speed: -0.05, phase: 3.5, scale: 1.0 },
  { cx: 18, cz: 62, rx: 7.8, rz: 4.6, y: -0.85, speed: 0.042, phase: 5.6, scale: 0.8 },
];

export function createKoi({ quality = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'koi';
  const count = quality >= 0.9 ? FISH.length : 6;

  const geo = createKoiGeometry();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // 个体色偏（橙 / 红白）
  const rand = mulberry32(4242);
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const warm = 0.85 + rand() * 0.25;
    col.setRGB(warm, 0.92 + rand() * 0.1, 0.86 + rand() * 0.12);
    mesh.setColorAt(i, col);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);

  // 复用的变换对象（update 不分配）
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3();
  const angles = FISH.slice(0, count).map((f) => f.phase);

  function update(dt, env) {
    const t = env.time;
    for (let i = 0; i < count; i++) {
      const f = FISH[i];
      angles[i] += dt * f.speed;
      const a = angles[i];
      _p.set(f.cx + Math.cos(a) * f.rx, f.y + Math.sin(t * 0.7 + i * 1.7) * 0.06, f.cz + Math.sin(a) * f.rz);
      // 朝向：轨道切线
      const hx = -Math.sin(a) * f.rx * Math.sign(f.speed);
      const hz = Math.cos(a) * f.rz * Math.sign(f.speed);
      const yaw = Math.atan2(-hz, hx) + Math.sin(t * 2.1 + i * 2.3) * 0.14;
      const pitch = Math.sin(t * 1.3 + i) * 0.05;
      _e.set(pitch, yaw, Math.sin(t * 2.6 + i * 1.3) * 0.08, 'YXZ');
      _q.setFromEuler(_e);
      const sc = f.scale;
      _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    geo.dispose();
    mat.dispose();
    group.removeFromParent();
  }

  return { object: group, update, dispose };
}

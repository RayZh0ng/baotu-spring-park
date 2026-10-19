/**
 * 水面模块（A · 泉与地形）
 * ------------------------------------------------------------------
 * 1. 把主泉池 / 溪流 / 荷花池 / 漱玉泉 / 金线泉 / 马跑泉 / 望水泉 / 沧泉的
 *    水面合并成 **一个 BufferGeometry、一个 ShaderMaterial**（1 draw call），
 *    y = WATER_LEVEL = -0.42；每个顶点带 aShore（0=岸边，1=池心）用于
 *    深浅渐变 / 岸边薄冰 / 泡沫。
 * 2. 水面材质见 ./water/shaders.js：Fresnel 天空反射、多层流动法线、日光高光、
 *    雨点涟漪、雪天薄冰、夜间月光与灯笼暖光、三股泉的水丘位移与白沫。
 * 3. 泉眼特效（水花 / 池底气泡 / “云雾润蒸”水汽）见 ./water/springs.js。
 * 4. 锦鲤见 ./water/koi.js。
 * 5. 碰撞体：各池 ellipse tag:'water'；溪流沿线 circle ring tag:'water'
 *    （桥面高差区域 walker 会忽略 water，见契约 §5）。
 *
 * 返回契约见 docs/CONTRACT.md §4。
 */

import * as THREE from 'three';
import {
  WATER_SHAPES,
  WATER_LEVEL,
  SPRING_JETS,
  BOUNDS,
} from '../layout.js';
import { createWaterMaterial, updateWaterMaterial, bindWaterReflection } from './water/shaders.js';
import { markNoReflect } from '../systems/reflection.js';
import { createSpringEffects } from './water/springs.js';
import { createKoi } from './water/koi.js';

/* ================================================================== *
 * 几何辅助（与 terrain.js 保持同一套溪流曲线，保证水面与驳岸严丝合缝）
 * ================================================================== */

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

function offsetLoop(points, halfWidth, capSeg = 10) {
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
      out.push([a[0] + (tx * ca - tz * sa) * halfWidth, a[1] + (tx * sa + tz * ca) * halfWidth]);
    }
  }
  for (let i = n - 1; i >= 0; i--) out.push(right[i]);
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
      out.push([a[0] + (tx * ca - tz * sa) * halfWidth, a[1] + (tx * sa + tz * ca) * halfWidth]);
    }
  }
  return out;
}

function distToPolyline2(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (d < best) best = d;
  }
  return best;
}

const ellipseShapes = WATER_SHAPES.filter((s) => s.kind === 'ellipse');
const channelShape = WATER_SHAPES.find((s) => s.kind === 'polyline');
const CHANNEL_PTS = catmullRom(channelShape.points, 1.05);
const CH_HW = channelShape.width / 2;

/* ================================================================== *
 * 主入口
 * ================================================================== */

export function createWater(ctx) {
  const group = new THREE.Group();
  group.name = 'water';
  const { env, quality = 1, mobile } = ctx;
  const hi = quality >= 0.9;

  const colliders = [];

  /* ---------------------------------------------------------------- *
   * 1. 合并水面几何
   * ---------------------------------------------------------------- */
  const pos = [];
  const shore = [];
  const idx = [];

  /** 椭圆水面：径向网格（中心密），aShore 由环参数换算 */
  function addEllipseDisk(s, rings, segs) {
    const base = pos.length / 3;
    const minR = Math.min(s.rx, s.rz);
    pos.push(s.cx, WATER_LEVEL, s.cz);
    shore.push(1);
    for (let i = 1; i <= rings; i++) {
      const r = i / rings;
      const rr = Math.pow(r, 1.32);
      const ds = clamp01((1 - rr) * minR / 1.6);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        pos.push(s.cx + Math.cos(a) * s.rx * rr, WATER_LEVEL, s.cz + Math.sin(a) * s.rz * rr);
        shore.push(ds);
      }
    }
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      idx.push(base, base + 1 + j, base + 1 + j2);
    }
    for (let i = 1; i < rings; i++) {
      const s0 = base + 1 + (i - 1) * segs;
      const s1 = base + 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j2 = (j + 1) % segs;
        idx.push(s0 + j, s1 + j, s1 + j2);
        idx.push(s0 + j, s1 + j2, s0 + j2);
      }
    }
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** 溪流水面：ShapeGeometry 多边形 + 三角形细分，aShore 按到中心线距离 */
  function addChannelBand() {
    const loop = offsetLoop(CHANNEL_PTS, CH_HW, 10);
    const shape = new THREE.Shape();
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      if (i === 0) shape.moveTo(p[0], -p[1]);
      else shape.lineTo(p[0], -p[1]);
    }
    shape.closePath();
    const src = new THREE.ShapeGeometry(shape);
    src.rotateX(-Math.PI / 2);
    const sp = src.attributes.position.array;
    const si = src.index.array;
    const outTri = [];
    const maxEdge = 1.25;
    const maxE2 = maxEdge * maxEdge;
    const MAX_DEPTH = 5;
    const pushTri = (ax, az, bx, bz, cx2, cz2) => outTri.push([ax, az, bx, bz, cx2, cz2]);
    const split = (ax, az, bx, bz, cx2, cz2, depth) => {
      const ab = (ax - bx) ** 2 + (az - bz) ** 2;
      const bc = (bx - cx2) ** 2 + (bz - cz2) ** 2;
      const ca = (cx2 - ax) ** 2 + (cz2 - az) ** 2;
      if (depth >= MAX_DEPTH || (ab <= maxE2 && bc <= maxE2 && ca <= maxE2)) {
        pushTri(ax, az, bx, bz, cx2, cz2);
        return;
      }
      const d2 = depth + 1;
      if (ab >= bc && ab >= ca) {
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        split(ax, az, mx, mz, cx2, cz2, d2);
        split(mx, mz, bx, bz, cx2, cz2, d2);
      } else if (bc >= ca) {
        const mx = (bx + cx2) / 2;
        const mz = (bz + cz2) / 2;
        split(ax, az, bx, bz, mx, mz, d2);
        split(ax, az, mx, mz, cx2, cz2, d2);
      } else {
        const mx = (cx2 + ax) / 2;
        const mz = (cz2 + az) / 2;
        split(ax, az, bx, bz, mx, mz, d2);
        split(bx, bz, cx2, cz2, mx, mz, d2);
      }
    };
    for (let i = 0; i < si.length; i += 3) {
      const ia = si[i] * 3;
      const ib = si[i + 1] * 3;
      const ic = si[i + 2] * 3;
      split(sp[ia], sp[ia + 2], sp[ib], sp[ib + 2], sp[ic], sp[ic + 2], 0);
    }
    src.dispose();

    const base = pos.length / 3;
    for (const t of outTri) {
      for (let k = 0; k < 3; k++) {
        const x = t[k * 2];
        const z = t[k * 2 + 1];
        pos.push(x, WATER_LEVEL, z);
        const d = distToPolyline2(x, z, CHANNEL_PTS);
        shore.push(clamp01((CH_HW - d) / 1.15));
      }
      idx.push(base + outTri.indexOf(t) * 3, base + outTri.indexOf(t) * 3 + 1, base + outTri.indexOf(t) * 3 + 2);
    }
  }

  // 主池（最密，供三股水水丘位移）
  addEllipseDisk(ellipseShapes.find((s) => s.id === 'main-spring'), hi ? 24 : 18, hi ? 104 : 72);
  for (const s of ellipseShapes) {
    if (s.id === 'main-spring') continue;
    const isLotus = s.id === 'lotus-pond';
    addEllipseDisk(s, isLotus ? (hi ? 16 : 12) : hi ? 12 : 9, isLotus ? (hi ? 64 : 48) : hi ? 48 : 36);
  }
  addChannelBand();

  const surfaceGeo = new THREE.BufferGeometry();
  surfaceGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surfaceGeo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  surfaceGeo.setIndex(idx);
  surfaceGeo.computeBoundingSphere();

  /* ---------------------------------------------------------------- *
   * 2. 水面材质
   * ---------------------------------------------------------------- */
  const jets = SPRING_JETS.main.jets;
  const smallSprings = [];
  const springAnchors = {};
  springAnchors.main = new THREE.Vector3(0, WATER_LEVEL, 0);
  for (const key of Object.keys(SPRING_JETS)) {
    for (const j of SPRING_JETS[key].jets) {
      if (key !== 'main') {
        smallSprings.push({
          x: j.x,
          z: j.z,
          radius: j.radius,
          strength: 0.22 + j.height * 1.5,
        });
      }
      springAnchors[key] = new THREE.Vector3(j.x, WATER_LEVEL, j.z);
    }
  }
  const material = createWaterMaterial({ env, jets, springs: smallSprings });
  const surface = new THREE.Mesh(surfaceGeo, material);
  surface.userData.noAO = true; // 不参与 GTAO（透明+位移水面会产生 AO 伪影）
  surface.renderOrder = 2;
  surface.receiveShadow = false;
  surface.castShadow = false;
  group.add(surface);

  /* ---------------------------------------------------------------- *
   * 3. 泉眼特效 + 锦鲤
   * ---------------------------------------------------------------- */
  const effects = createSpringEffects({ env, quality });
  effects.object.traverse((o) => {
    o.userData.noAO = true;
  });
  group.add(effects.object);
  const koi = createKoi({ quality });
  koi.object.traverse((o) => {
    o.userData.noAO = true;
  });
  group.add(koi.object);

  /* ---------------------------------------------------------------- *
   * 4. 碰撞体
   * ---------------------------------------------------------------- */
  for (const s of WATER_SHAPES) {
    if (s.kind === 'ellipse') {
      colliders.push({
        type: 'ellipse',
        x: s.cx,
        z: s.cz,
        rx: s.rx,
        rz: s.rz,
        rot: 0,
        tag: 'water',
      });
    } else if (s.kind === 'polyline') {
      const pts = s.points;
      const step = 2.4;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(dist / step));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          colliders.push({
            type: 'circle',
            x: a[0] + (b[0] - a[0]) * t,
            z: a[1] + (b[1] - a[1]) * t,
            r: s.width / 2,
            tag: 'water',
          });
        }
      }
      // 末端
      const last = pts[pts.length - 1];
      colliders.push({ type: 'circle', x: last[0], z: last[1], r: s.width / 2, tag: 'water' });
    }
  }

  /* ---------------------------------------------------------------- *
   * 5. 每帧更新（只写 uniform / instanceMatrix，不分配对象）
   * ---------------------------------------------------------------- */
  let boundReflection = null;

  function update(dt, e) {
    updateWaterMaterial(material, e);
    // 反射矩阵每帧变化：必须同步给 shader
    if (boundReflection) {
      material.uniforms.uReflectionMatrix.value.copy(boundReflection.textureMatrix);
      material.uniforms.uReflectionTexel.value.set(
        1 / boundReflection.width,
        1 / boundReflection.height
      );
    }
    effects.update(dt, e);
    koi.update(dt, e);
  }

  function dispose() {
    surfaceGeo.dispose();
    material.dispose();
    effects.dispose();
    koi.dispose();
    group.removeFromParent();
  }

  // 供其它模块读取的锚点（水面中心 / 各泉眼）
  const anchors = {
    mainSpring: springAnchors.main,
    waterSurfaceCenter: new THREE.Vector3(0, WATER_LEVEL, 0),
    channelMouth: new THREE.Vector3(26.4, WATER_LEVEL, 60),
    lotusPondCenter: new THREE.Vector3(18, WATER_LEVEL, 62),
    ...springAnchors,
  };

  // 水面与粒子不参与反射渲染（避免递归与鬼影）
  markNoReflect(surface);
  markNoReflect(effects.object);
  markNoReflect(koi.object);

  return {
    object: group,
    colliders,
    anchors,
    update,
    dispose,
    /** 供 experience 绑定平面反射（矩阵每帧在 update 中同步） */
    bindReflection(reflection) {
      boundReflection = reflection;
      bindWaterReflection(material, reflection);
    },
    get material() {
      return material;
    },
    get surface() {
      return surface;
    },
  };
}

export { WATER_LEVEL };

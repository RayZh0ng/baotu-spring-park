import * as THREE from 'three';
import { mulberry32 } from '../utils/random.js';
import { softGlowTexture, stoneTexture, woodTexture, leafClusterTexture } from '../utils/tex.js';
import { makePlaqueTexture } from '../utils/labels.js';
import { COLORS } from '../utils/palette.js';
import {
  bake,
  mergeGeometries,
  tubeGeometry,
  instanced,
  trs,
  G,
  discGeometry,
  crossCardGeometry,
} from './plants/merge.js';
import { registerSeason, updateSeason } from './plants/wind.js';
import { findPath, samplePath } from './plants/placement.js';

/**
 * 园林小品（C 号负责人）：
 * 石灯笼 / 红灯笼灯柱 / 东门石狮 / 茶桌凳 / 石条凳 / 指路牌 / 荷花池小舟 / 盆栽。
 * 全部程序化低模 + InstancedMesh / 合并几何；夜间靠自发光 + additive 光晕（不加真实点光源）。
 */
export function createProps(ctx) {
  const group = new THREE.Group();
  group.name = 'props-root';
  const colliders = [];
  const A = assets();
  const out = { ctx, group, colliders, points: [], anchors: {} };
  const rand = mulberry32(0x7a11);

  buildStoneLanterns(out, A, rand);
  buildRedLanterns(out, A, rand);
  buildLions(out, A);
  buildTeaSeats(out, A);
  buildBenches(out, A);
  buildSigns(out, A);
  const boat = buildBoat(out, A);
  buildPlanters(out, A, rand);

  out.anchors.eastLions = new THREE.Vector3(100, 1.2, 0);
  out.anchors.stoneLantern = out.points.length
    ? new THREE.Vector3(out.points[0][0], 1.2, out.points[0][1])
    : new THREE.Vector3(0, 1.2, 0);

  let lastOn = -1;
  function update(dt, env) {
    updateSeason(env);
    const on = Math.max(env.night, env.golden * 0.32);
    if (Math.abs(on - lastOn) > 0.002) {
      lastOn = on;
      A.windowMat.emissiveIntensity = 0.12 + on * 2.6;
      A.glowMat.opacity = 0.04 + on * 0.55;
      A.redMat.emissiveIntensity = 0.08 + on * 1.9;
      A.redGlowMat.opacity = 0.03 + on * 0.5;
    }
    if (boat) boat.position.y = ctx.waterLevel + 0.02 + Math.sin(env.time * 0.85) * 0.018;
  }

  function dispose() {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          if (m.alphaMap) m.alphaMap.dispose();
          m.dispose();
        }
      }
    });
    group.removeFromParent();
  }

  return { object: group, colliders, anchors: out.anchors, update, dispose };
}

/* ================================================================== 资源 */

let _assets = null;
function assets() {
  if (_assets) return _assets;
  const stoneTex = stoneTexture({ tint: [154, 156, 150], seed: 3, moss: 0.4 });
  const stoneDarkTex = stoneTexture({ tint: [116, 120, 114], seed: 8, joint: 0.5 });
  const woodTex = woodTexture({ tint: [66, 52, 39], seed: 5 });
  const woodDarkTex = woodTexture({ tint: [46, 36, 28], seed: 9 });
  const glowTex = softGlowTexture({ size: 128, color: '#ffb96a', falloff: 2.8 });
  const redGlowTex = softGlowTexture({ size: 128, color: '#ff8a5c', falloff: 2.6 });

  const stoneMat = registerSeason(
    new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.94, metalness: 0.02 }),
    { snow: 0.55, wet: 0.5, night: 0.4 }
  );
  const marbleMat = registerSeason(
    new THREE.MeshStandardMaterial({ color: COLORS.marble, roughness: 0.85, metalness: 0.02 }),
    { snow: 0.45, wet: 0.45, night: 0.4 }
  );
  void stoneDarkTex;
  const woodDarkMat = registerSeason(
    new THREE.MeshStandardMaterial({ map: woodDarkTex, roughness: 0.9, metalness: 0 }),
    { snow: 0.35, wet: 0.55, night: 0.42 }
  );
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xf2e0b6,
    emissive: 0xffb45c,
    emissiveIntensity: 0.12,
    roughness: 0.6,
    metalness: 0,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    color: 0xffc27a,
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const redMat = new THREE.MeshStandardMaterial({
    color: COLORS.lanternRed,
    emissive: 0xd8452c,
    emissiveIntensity: 0.08,
    roughness: 0.65,
    metalness: 0,
  });
  const redGlowMat = new THREE.MeshBasicMaterial({
    map: redGlowTex,
    color: 0xffa070,
    transparent: true,
    opacity: 0.03,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const goldMat = registerSeason(
    new THREE.MeshStandardMaterial({ color: COLORS.goldDim, roughness: 0.5, metalness: 0.45 }),
    { snow: 0.3, wet: 0.4, night: 0.35 }
  );
  const ceramicMat = registerSeason(
    new THREE.MeshStandardMaterial({ color: 0x9fb2a4, roughness: 0.42, metalness: 0.05 }),
    { snow: 0.4, wet: 0.4, night: 0.38 }
  );
  const potMat = registerSeason(
    new THREE.MeshStandardMaterial({ color: 0x53463a, roughness: 0.55, metalness: 0.06 }),
    { snow: 0.4, wet: 0.4, night: 0.38 }
  );

  _assets = {
    stoneTex,
    stoneMat,
    marbleMat,
    woodDarkMat,
    windowMat,
    glowMat,
    redMat,
    redGlowMat,
    goldMat,
    ceramicMat,
    potMat,
  };
  void woodTex;
  return _assets;
}

/* ================================================================== 工具 */

function canProp(ctx, x, z, opts = {}) {
  const L = ctx.layout;
  if (x < L.BOUNDS.minX + 2 || x > L.BOUNDS.maxX - 2 || z < L.BOUNDS.minZ + 2 || z > L.BOUNDS.maxZ - 2) return false;
  if (L.isWaterAt(x, z, 0.35)) return false;
  if (L.heightAt(x, z) > 0.45) return false;
  if (L.pathDistance(x, z) < (opts.path ?? 0.15)) return false;
  if (L.isStructureAt(x, z, 0.35)) return false;
  return true;
}

function pushCollider(out, c) {
  if (out.colliders.length >= 220) return;
  out.colliders.push(c);
}

/* ================================================================== 石灯笼 */

function buildStoneLanterns(out, A, rand) {
  const ctx = out.ctx;
  const specs = [
    { id: 'axis-east', spacing: 17, offset: 1.7, phase: 5 },
    { id: 'pool-ring', spacing: 18, offset: 1.6, phase: 3, closed: true },
    { id: 'south-path', spacing: 18, offset: 1.6, phase: 6 },
    { id: 'lotus-ring', spacing: 17, offset: 1.5, phase: 2, closed: true },
    { id: 'north-axis', spacing: 15, offset: 1.5, phase: 7 },
    { id: 'west-path', spacing: 19, offset: 1.6, phase: 8 },
    { id: 'shuyu-path', spacing: 20, offset: 1.5, phase: 6 },
    { id: 'wanzhu-path', spacing: 18, offset: 1.5, phase: 5 },
    { id: 'cang-path', spacing: 16, offset: 1.4, phase: 4 },
  ];
  const mats = [];
  for (const spec of specs) {
    const path = findPath(spec.id);
    if (!path) continue;
    const pts = samplePath(path, spec.spacing, spec.offset, { phase: spec.phase, closed: Boolean(path.closed) });
    for (const p of pts) {
      const cand = [
        [p.x, p.z],
        [p.x - p.nx * spec.offset * 2, p.z - p.nz * spec.offset * 2],
      ];
      for (const [x, z] of cand) {
        if (!canProp(ctx, x, z, { path: 0.12 })) continue;
        let tooClose = false;
        for (const q of out.points) if (Math.hypot(q[0] - x, q[1] - z) < 2.2) tooClose = true;
        if (tooClose) continue;
        mats.push(trs(x, ctx.heightAt(x, z), z, 0, rand() * Math.PI * 2, 0));
        out.points.push([x, z, 'lantern']);
        pushCollider(out, { type: 'circle', x, z, r: 0.34, tag: 'solid' });
        break;
      }
    }
  }

  const stoneGeo = mergeGeometries([
    bake(G.cyl(0.34, 0.4, 0.18, 6), trs(0, 0.09, 0)),
    bake(G.cyl(0.24, 0.31, 0.12, 6), trs(0, 0.24, 0)),
    bake(G.cyl(0.1, 0.14, 0.6, 6), trs(0, 0.6, 0)),
    bake(G.cyl(0.29, 0.2, 0.1, 6), trs(0, 0.95, 0)),
    bake(G.cyl(0.235, 0.235, 0.36, 6), trs(0, 1.18, 0)),
    bake(G.cyl(0.05, 0.44, 0.24, 6), trs(0, 1.48, 0)),
    bake(G.sphere(0.085, 6, 4), trs(0, 1.68, 0)),
  ]);
  const winParts = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    winParts.push(
      bake(
        new THREE.PlaneGeometry(0.23, 0.2),
        trs(0, 1.18, 0, 0, a, 0).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.238))
      )
    );
  }
  const winGeo = mergeGeometries(winParts);
  const glowGeo = mergeGeometries([
    bake(new THREE.PlaneGeometry(1.0, 1.0), trs(0, 1.18, 0)),
    bake(new THREE.PlaneGeometry(1.0, 1.0), trs(0, 1.18, 0, 0, Math.PI / 2, 0)),
    bake(discGeometry(1.2, 14), trs(0, 0.04, 0)),
  ]);

  if (mats.length) {
    out.group.add(instanced(stoneGeo, A.stoneMat, mats, { castShadow: true, name: 'stone-lanterns' }));
    out.group.add(instanced(winGeo, A.windowMat, mats, { castShadow: false, name: 'stone-lantern-windows' }));
    const glow = instanced(glowGeo, A.glowMat, mats, { castShadow: false, name: 'stone-lantern-glow' });
    glow.renderOrder = 3;
    out.group.add(glow);
  }
}

/* ================================================================== 红灯笼灯柱 */

function buildRedLanterns(out, A, rand) {
  const ctx = out.ctx;
  const spots = [
    [103.6, 5.6, -0.9],
    [103.6, -5.6, 0.9],
    [84.6, 5.0, -0.7],
    [84.6, -5.0, 0.7],
    [-13.9, -17.3, 0.2],
    [-45.1, -17.3, -0.2],
    [-64.8, -13.8, 1.2],
    [-64.8, -22.2, -1.2],
    [-38.6, 53.8, 1.4],
    [-38.6, 58.2, -1.4],
    [9.4, 55.0, 0.9],
    [57.2, 33.9, 1.2],
    [62.8, 33.9, -1.2],
  ];
  const mats = [];
  for (const [x, z, yawOff] of spots) {
    if (!canProp(ctx, x, z, { path: 0.05, water: 0.3 })) continue;
    mats.push(trs(x, ctx.heightAt(x, z), z, 0, yawOff, 0));
    out.points.push([x, z, 'redLantern']);
    pushCollider(out, { type: 'circle', x, z, r: 0.16, tag: 'soft' });
  }
  if (!mats.length) return;

  const woodGeo = mergeGeometries([
    bake(G.cyl(0.16, 0.21, 0.2, 6), trs(0, 0.1, 0)),
    bake(G.cyl(0.042, 0.06, 2.55, 6), trs(0, 1.28, 0)),
    bake(tubeGeometry([[0, 2.5, 0], [0.28, 2.62, 0], [0.58, 2.52, 0]], [0.036, 0.03, 0.024], 5), null),
    bake(G.cyl(0.012, 0.012, 0.12, 4), trs(0.58, 2.44, 0)),
  ]);
  const redGeo = mergeGeometries([
    bake(G.sphere(0.27, 9, 6), trs(0.58, 2.16, 0, 0, 0, 0, 1, 0.82, 1)),
    bake(G.cyl(0.018, 0.018, 0.2, 4), trs(0.58, 1.88, 0)),
    bake(G.cone(0.05, 0.16, 5), trs(0.58, 1.72, 0, Math.PI, 0, 0)),
  ]);
  const goldGeo = mergeGeometries([
    bake(G.cyl(0.1, 0.15, 0.07, 8), trs(0.58, 2.41, 0)),
    bake(G.cyl(0.14, 0.1, 0.06, 8), trs(0.58, 1.94, 0)),
    bake(new THREE.TorusGeometry(0.05, 0.012, 4, 8), trs(0.58, 2.48, 0, Math.PI / 2, 0, 0)),
  ]);
  const glowGeo = mergeGeometries([
    bake(new THREE.PlaneGeometry(1.1, 1.1), trs(0.58, 2.16, 0)),
    bake(new THREE.PlaneGeometry(1.1, 1.1), trs(0.58, 2.16, 0, 0, Math.PI / 2, 0)),
  ]);

  out.group.add(instanced(woodGeo, A.woodDarkMat, mats, { castShadow: true, name: 'red-lantern-posts' }));
  out.group.add(instanced(redGeo, A.redMat, mats, { castShadow: false, name: 'red-lantern-bodies' }));
  out.group.add(instanced(goldGeo, A.goldMat, mats, { castShadow: false, name: 'red-lantern-trim' }));
  const glow = instanced(glowGeo, A.redGlowMat, mats, { castShadow: false, name: 'red-lantern-glow' });
  glow.renderOrder = 3;
  out.group.add(glow);
  void rand;
}

/* ================================================================== 石狮一对 */

function buildLions(out, A) {
  const ctx = out.ctx;
  const pair = [
    { x: 100.2, z: 5.3, yaw: Math.PI / 2 + 0.16, cub: false },
    { x: 100.2, z: -5.3, yaw: Math.PI / 2 - 0.16, cub: true },
  ];
  for (const p of pair) {
    if (ctx.layout.isWaterAt(p.x, p.z, 0.3) || ctx.layout.isStructureAt(p.x, p.z, 0.2)) continue;
    const mesh = new THREE.Mesh(lionGeometry(p.cub), A.marbleMat);
    mesh.position.set(p.x, ctx.heightAt(p.x, p.z), p.z);
    mesh.rotation.y = p.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'stone-lion';
    out.group.add(mesh);
    pushCollider(out, { type: 'circle', x: p.x, z: p.z, r: 0.8, tag: 'solid' });
    out.points.push([p.x, p.z, 'lion']);
  }
}

/** 石狮：面朝 +X，蹲坐姿态（低模但可辨认） */
function lionGeometry(withCub) {
  const parts = [];
  const P = (geo, m) => parts.push(bake(geo, m));
  // 台座
  P(G.box(1.5, 0.8, 1.15), trs(0, 0.4, 0));
  P(G.box(1.62, 0.1, 1.26), trs(0, 0.85, 0));
  // 身躯
  P(G.sphere(0.42, 8, 6), trs(0.0, 1.3, 0, 0, 0, 0, 1.35, 0.9, 0.95));
  P(G.sphere(0.34, 8, 6), trs(0.36, 1.55, 0, 0, 0, 0, 0.95, 1.05, 0.9));
  // 后腿
  P(G.cyl(0.16, 0.19, 0.5, 6), trs(-0.3, 1.08, 0.26));
  P(G.cyl(0.16, 0.19, 0.5, 6), trs(-0.3, 1.08, -0.26));
  P(G.box(0.34, 0.14, 0.24), trs(-0.32, 0.9, 0.28));
  P(G.box(0.34, 0.14, 0.24), trs(-0.32, 0.9, -0.28));
  // 前腿
  P(G.cyl(0.1, 0.12, 0.72, 6), trs(0.56, 1.22, 0.24, 0.08, 0, 0));
  P(G.cyl(0.1, 0.12, 0.72, 6), trs(0.56, 1.22, -0.24, -0.08, 0, 0));
  P(G.box(0.26, 0.12, 0.2), trs(0.62, 0.92, 0.24));
  P(G.box(0.26, 0.12, 0.2), trs(0.62, 0.92, -0.24));
  // 头
  P(G.sphere(0.29, 9, 7), trs(0.62, 1.92, 0, 0, 0, 0, 1, 0.98, 0.92));
  P(G.box(0.3, 0.2, 0.24), trs(0.85, 1.82, 0));
  P(G.sphere(0.075, 6, 4), trs(0.97, 1.84, 0));
  P(G.box(0.22, 0.09, 0.42), trs(0.78, 2.04, 0, 0, 0, -0.12));
  // 眼睛
  P(G.sphere(0.05, 6, 4), trs(0.88, 1.97, 0.12));
  P(G.sphere(0.05, 6, 4), trs(0.88, 1.97, -0.12));
  // 耳朵
  P(G.cone(0.08, 0.14, 5), trs(0.55, 2.16, 0.2, 0.4, 0, 0.3));
  P(G.cone(0.08, 0.14, 5), trs(0.55, 2.16, -0.2, -0.4, 0, 0.3));
  // 鬃毛一圈
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const r = 0.34;
    P(G.sphere(0.085 + (i % 3) * 0.014, 5, 4), trs(0.46 + Math.cos(a) * 0.06, 1.92 + Math.sin(a) * r * 0.82, Math.sin(a) * r * 0.95 + Math.cos(a) * 0.05));
  }
  // 尾巴
  P(
    tubeGeometry(
      [[-0.52, 1.4, 0.12], [-0.74, 1.62, 0.22], [-0.72, 1.95, 0.16], [-0.6, 2.02, 0.1]],
      [0.075, 0.06, 0.05, 0.04],
      5
    ),
    null
  );
  P(G.sphere(0.1, 5, 4), trs(-0.58, 2.04, 0.1));
  // 绣球 / 幼狮
  if (withCub) {
    P(G.sphere(0.17, 7, 5), trs(0.82, 1.08, 0.34));
    P(G.sphere(0.12, 6, 4), trs(0.94, 1.24, 0.34));
    P(G.cone(0.05, 0.1, 5), trs(0.9, 1.38, 0.34));
    P(G.box(0.16, 0.08, 0.14), trs(1.0, 1.22, 0.34));
  } else {
    P(G.sphere(0.17, 8, 6), trs(0.86, 1.06, 0.3));
    P(G.sphere(0.05, 5, 4), trs(0.86, 1.26, 0.3));
    P(G.cyl(0.18, 0.18, 0.05, 8), trs(0.86, 1.06, 0.3, 0, 0, 0.4));
  }
  return mergeGeometries(parts);
}

/* ================================================================== 茶座 */

function buildTeaSeats(out, A) {
  const ctx = out.ctx;
  const spots = [
    [42, -12],
    [18, 62],
  ];
  const mats = [];
  for (const [x, z] of spots) {
    const y = ctx.heightAt(x, z);
    mats.push(trs(x, y + 0.01, z, 0, 0, 0));
    pushCollider(out, { type: 'circle', x, z, r: 1.25, tag: 'solid' });
    out.points.push([x, z, 'teaTable']);
  }
  const stoolParts = [45, 135, 225, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return bake(G.cyl(0.17, 0.19, 0.44, 8), trs(Math.cos(a) * 1.05, 0.22, Math.sin(a) * 1.05));
  });
  const stoneGeo = mergeGeometries([
    bake(G.cyl(0.6, 0.6, 0.09, 12), trs(0, 0.75, 0)),
    bake(G.cyl(0.16, 0.22, 0.64, 8), trs(0, 0.4, 0)),
    bake(G.cyl(0.34, 0.4, 0.1, 8), trs(0, 0.05, 0)),
    ...stoolParts,
  ]);
  const cupParts = [20, 110, 200, 290].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return bake(G.cyl(0.045, 0.034, 0.06, 8), trs(0.16 + Math.cos(a) * 0.3, 0.82, 0.06 + Math.sin(a) * 0.3));
  });
  const teaGeo = mergeGeometries([
    bake(G.sphere(0.135, 8, 6), trs(0.16, 0.87, 0.06, 0, 0, 0, 1, 0.72, 1)),
    bake(G.cyl(0.06, 0.075, 0.035, 8), trs(0.16, 0.96, 0.06)),
    bake(G.sphere(0.024, 5, 4), trs(0.16, 0.99, 0.06)),
    bake(tubeGeometry([[0.27, 0.87, 0.06], [0.34, 0.93, 0.06], [0.37, 0.97, 0.06]], [0.024, 0.018, 0.012], 4), null),
    bake(tubeGeometry([[0.05, 0.88, 0.06], [0.02, 0.96, 0.06], [0.06, 0.99, 0.06]], [0.014, 0.012, 0.012], 4), null),
    ...cupParts,
  ]);
  out.group.add(instanced(stoneGeo, A.stoneMat, mats, { castShadow: true, name: 'tea-tables' }));
  out.group.add(instanced(teaGeo, A.ceramicMat, mats, { castShadow: false, name: 'tea-sets' }));
}

/* ================================================================== 石条凳 */

function buildBenches(out, A) {
  const ctx = out.ctx;
  const specs = [
    { id: 'south-path', spacing: 24, offset: 2.7, phase: 7 },
    { id: 'lotus-ring', spacing: 30, offset: 2.5, phase: 6 },
    { id: 'north-axis', spacing: 26, offset: 2.3, phase: 9 },
    { id: 'west-path', spacing: 32, offset: 2.7, phase: 10 },
    { id: 'pond-path', spacing: 30, offset: 2.5, phase: 8 },
    { id: 'axis-east', spacing: 34, offset: 4.8, phase: 13 },
    { id: 'shuyu-path', spacing: 34, offset: 2.5, phase: 9 },
  ];
  const mats = [];
  const tryPlace = (x, z, nx, nz) => {
    if (!canProp(ctx, x, z, { path: 0.1 })) return false;
    for (const q of out.points) if (Math.hypot(q[0] - x, q[1] - z) < 2.0) return false;
    const yaw = Math.atan2(-nx, -nz);
    mats.push(trs(x, ctx.heightAt(x, z), z, 0, yaw, 0));
    out.points.push([x, z, 'bench']);
    pushCollider(out, { type: 'box', x, z, hx: 0.92, hz: 0.28, rot: yaw, tag: 'solid' });
    return true;
  };
  for (const spec of specs) {
    const path = findPath(spec.id);
    if (!path) continue;
    const pts = samplePath(path, spec.spacing, spec.offset, { phase: spec.phase, closed: Boolean(path.closed) });
    for (const p of pts) {
      if (tryPlace(p.x, p.z, p.nx, p.nz)) continue;
      tryPlace(p.x - p.nx * spec.offset * 2, p.z - p.nz * spec.offset * 2, -p.nx, -p.nz);
    }
  }
  for (const ang of [0.7, 2.36, 3.84, 5.5]) {
    const x = Math.cos(ang) * 24.2;
    const z = Math.sin(ang) * 18.4;
    tryPlace(x, z, -Math.cos(ang), -Math.sin(ang) * 0.9);
  }
  tryPlace(30.4, 64.2, -1, 0.2);
  tryPlace(5.6, 68.6, 0.3, -1);

  const geo = mergeGeometries([
    bake(G.box(1.72, 0.14, 0.46), trs(0, 0.46, 0)),
    bake(G.box(0.22, 0.36, 0.4), trs(-0.62, 0.22, 0)),
    bake(G.box(0.22, 0.36, 0.4), trs(0.62, 0.22, 0)),
  ]);
  if (mats.length) out.group.add(instanced(geo, A.stoneMat, mats, { castShadow: true, name: 'stone-benches' }));
}

/* ================================================================== 指路牌 */

function buildSigns(out, A) {
  const ctx = out.ctx;
  const signs = [
    { x: 96.4, z: 6.4, yaw: Math.PI / 2, text: '趵突泉 →' },
    { x: 3.6, z: 17.6, yaw: 0, text: '观澜亭 ←' },
    { x: 11.8, z: 51.6, yaw: Math.PI, text: '荷风亭 →' },
    { x: -64.0, z: -13.2, yaw: Math.PI / 2, text: '万竹园 →' },
    { x: 35.0, z: 6.4, yaw: -Math.PI / 2, text: '东门 →' },
  ];
  const postParts = [];
  const boardMeshes = [];
  for (const s of signs) {
    const y = ctx.heightAt(s.x, s.z);
    const T = trs(s.x, y, s.z, 0, s.yaw, 0);
    const local = (geo, m) => bake(geo, T.clone().multiply(m));
    postParts.push(local(G.box(0.09, 2.02, 0.09), trs(-0.62, 1.01, 0)));
    postParts.push(local(G.box(0.09, 2.02, 0.09), trs(0.62, 1.01, 0)));
    postParts.push(local(G.box(1.42, 0.09, 0.12), trs(0, 1.79, 0)));
    postParts.push(local(G.box(0.86, 0.05, 0.34), trs(-0.4, 1.9, 0.02, 0, 0, 0.16)));
    postParts.push(local(G.box(0.86, 0.05, 0.34), trs(0.4, 1.9, 0.02, 0, 0, -0.16)));
    postParts.push(local(G.box(0.06, 0.62, 0.16), trs(-0.52, 1.36, 0.06)));
    postParts.push(local(G.box(0.06, 0.62, 0.16), trs(0.52, 1.36, 0.06)));
    const tex = makePlaqueTexture({
      text: s.text,
      bg: 'rgba(48,34,24,0.97)',
      fg: '#efe3c0',
      border: '#8a6a3c',
      borderWidth: 4,
      size: 512,
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0.02 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.57), mat);
    board.position.set(s.x + Math.sin(s.yaw) * 0.1, y + 1.42, s.z + Math.cos(s.yaw) * 0.1);
    board.rotation.y = s.yaw;
    board.receiveShadow = true;
    boardMeshes.push(board);
    out.points.push([s.x, s.z, 'sign']);
    pushCollider(out, { type: 'circle', x: s.x, z: s.z, r: 0.55, tag: 'solid' });
  }
  const postMesh = new THREE.Mesh(mergeGeometries(postParts), A.woodDarkMat);
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  postMesh.name = 'signposts';
  out.group.add(postMesh);
  for (const b of boardMeshes) out.group.add(b);
}

/* ================================================================== 荷花池小舟 */

function buildBoat(out, A) {
  const ctx = out.ctx;
  const water = ctx.waterLevel;
  const x = 12.1;
  const z = 66.7;
  const yaw = 2.15;
  const hull = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const parts = [];
  parts.push(bake(hull, trs(0, 0.37, 0, 0, 0, 0, 1.7, 0.42, 0.6)));
  parts.push(bake(new THREE.TorusGeometry(1, 0.035, 5, 18), trs(0, 0.37, 0, -Math.PI / 2, 0, 0, 1.7, 0.6, 1)));
  parts.push(bake(G.box(0.3, 0.06, 0.86), trs(-0.56, 0.34, 0)));
  parts.push(bake(G.box(0.3, 0.06, 0.86), trs(0.24, 0.34, 0)));
  parts.push(bake(G.box(0.3, 0.06, 0.8), trs(0.95, 0.34, 0)));
  parts.push(bake(G.cyl(0.028, 0.028, 1.7, 5), trs(0.25, 0.44, 0.3, 0, 0.5, 1.35)));
  const boat = new THREE.Mesh(mergeGeometries(parts), A.woodDarkMat);
  boat.name = 'lotus-boat';
  boat.rotation.y = yaw;
  boat.position.set(x, water + 0.02, z);
  boat.castShadow = true;
  boat.receiveShadow = true;
  out.group.add(boat);

  const moor = mergeGeometries([
    bake(G.cyl(0.075, 0.09, 1.05, 6), trs(13.55, water + 0.52, 68.15)),
    bake(
      tubeGeometry(
        [
          [13.51, water + 1.02, 68.1],
          [12.9, water + 0.62, 67.6],
          [12.4, water + 0.45, 67.1],
          [12.1, water + 0.42, 66.7],
        ],
        [0.014, 0.012, 0.012, 0.012],
        4
      ),
      null
    ),
  ]);
  const moorMesh = new THREE.Mesh(moor, A.woodDarkMat);
  moorMesh.castShadow = true;
  out.group.add(moorMesh);
  out.points.push([x, z, 'boat']);
  pushCollider(out, { type: 'circle', x, z, r: 1.5, tag: 'soft' });
  return boat;
}

/* ================================================================== 盆栽 */

let _potLeafMat = null;
function potLeafMat() {
  if (_potLeafMat) return _potLeafMat;
  const tex = leafClusterTexture({
    size: 128,
    count: 22,
    color: '#5d7d4c',
    color2: '#8aa262',
    seed: 29,
    spread: 0.92,
    leafW: 0.13,
    leafH: 0.3,
  });
  _potLeafMat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  return _potLeafMat;
}

function buildPlanters(out, A, rand) {
  const ctx = out.ctx;
  const spots = [
    [57.2, 34.2],
    [62.8, 34.2],
    [-65.2, -14.9],
    [-65.2, -21.1],
    [-38.8, 54.2],
    [-38.8, 57.8],
  ];
  const potMats = [];
  const plantMats = [];
  for (const [x, z] of spots) {
    if (ctx.layout.isWaterAt(x, z, 0.2)) continue;
    if (ctx.layout.isStructureAt(x, z, 0.25)) continue;
    const y = ctx.heightAt(x, z);
    potMats.push(trs(x, y, z, 0, rand() * Math.PI * 2, 0));
    for (let i = 0; i < 3; i++) {
      const s = 0.62 + rand() * 0.3;
      plantMats.push(
        trs(
          x + (rand() - 0.5) * 0.3,
          y + 0.44,
          z + (rand() - 0.5) * 0.3,
          (rand() - 0.5) * 0.8,
          rand() * Math.PI * 2,
          (rand() - 0.5) * 0.5,
          s,
          s * (0.8 + rand() * 0.4),
          s
        )
      );
    }
    pushCollider(out, { type: 'circle', x, z, r: 0.34, tag: 'solid' });
    out.points.push([x, z, 'pot']);
  }
  const potGeo = mergeGeometries([
    bake(G.cyl(0.3, 0.2, 0.42, 10), trs(0, 0.21, 0)),
    bake(G.cyl(0.33, 0.3, 0.07, 10), trs(0, 0.43, 0)),
    bake(discGeometry(0.27, 10), trs(0, 0.455, 0)),
  ]);
  if (potMats.length) {
    out.group.add(instanced(potGeo, A.potMat, potMats, { castShadow: true, name: 'planters' }));
    out.group.add(instanced(crossCardGeometry(1, 1), potLeafMat(), plantMats, { castShadow: false, name: 'planter-plants' }));
  }
}

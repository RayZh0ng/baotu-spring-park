import * as THREE from 'three';
import { mulberry32 } from '../../utils/random.js';
import { bake, mergeGeometries, instanced, trs, disposeGeometries } from './merge.js';
import { applyWind, jitterColors, makeSnowOverlayMaterial } from './wind.js';
import { bambooCulmTexture, bambooLeafTexture } from './textures.js';
import { findSpots } from './placement.js';

/**
 * 竹林 —— 万竹园「万竹」+ 西墙/北园/沧园/纪念堂东侧。
 * 竹竿：单个低模竹竿几何 → InstancedMesh（全园约 2000 根，1 draw call）。
 * 竹叶：顶部叶簇卡片 InstancedMesh + 雪层。
 */

let _assets = null;
function assets() {
  if (_assets) return _assets;
  const culmGeo = new THREE.CylinderGeometry(0.032, 0.054, 6, 5, 1, true);
  culmGeo.translate(0, 3, 0);
  const culmMat = new THREE.MeshStandardMaterial({
    map: bambooCulmTexture(),
    roughness: 0.72,
    metalness: 0.02,
  });
  applyWind(culmMat, { mode: 'rigid', sway: 0.05, height: 8, speed: 0.8, snow: 0.28, wet: 0.4, night: 0.4 });

  const leafTex = bambooLeafTexture();
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTex,
    alphaTest: 0.36,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0,
  });
  applyWind(leafMat, { mode: 'rigid', sway: 0.24, height: 9, speed: 1.15, snow: 0.55, wet: 0.45, night: 0.4 });
  const snowMat = makeSnowOverlayMaterial(leafTex, 0);
  applyWind(snowMat, { mode: 'rigid', sway: 0.24, height: 9, speed: 1.15, snow: 0, wet: 0, night: 0.25 });

  _assets = { culmGeo, culmMat, leafMat, snowMat, leafGeo: new THREE.PlaneGeometry(1, 1) };
  return _assets;
}

export function buildBambooGrove(ctx, out) {
  const A = assets();
  const zones = ctx.layout.PLANTING_ZONES.filter((z) => z.kind === 'bamboo');
  const insideCompounds = new Set(['bamboo-wanzhu', 'bamboo-cang', 'bamboo-liqingzhao']);
  const culmM = [];
  const culmC = [];
  const leafM = [];
  const leafC = [];
  let clumps = 0;

  for (const zone of zones) {
    const rand = mulberry32(zone.seed);
    const opts = {
      water: 0.55,
      path: 1.0,
      wall: 2.6,
      building: 0.9,
      compoundWall: 1.7,
      compoundInside: insideCompounds.has(zone.id),
      corridor: false,
    };
    const spots = findSpots(rand, zone.area, zone.count, opts, 2.3);
    const lush = zone.id === 'bamboo-wanzhu';
    for (const [x, z] of spots) {
      clumps++;
      buildClump(rand, x, z, lush, culmM, culmC, leafM, leafC);
    }
  }

  const culmMesh = instanced(A.culmGeo, A.culmMat, culmM, {
    colors: culmC,
    castShadow: true,
    name: 'bamboo-culms',
  });
  out.group.add(culmMesh);

  const leafMesh = instanced(A.leafGeo, A.leafMat, leafM, {
    colors: leafC,
    castShadow: true,
    name: 'bamboo-leaves',
  });
  out.group.add(leafMesh);

  // 雪覆盖层（同一批叶卡，略微上移放大）
  if (leafM.length) {
    const snowM = [];
    for (const m of leafM) snowM.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.04, 0)).scale(new THREE.Vector3(1.03, 1.03, 1.03)));
    const snow = instanced(A.leafGeo, A.snowMat, snowM, { castShadow: false, name: 'bamboo-snow' });
    snow.renderOrder = 2;
    out.group.add(snow);
    out.snowOverlays.push({ mat: A.snowMat, factor: 0.62 });
  }

  out.stats = out.stats || {};
  out.stats.bambooClumps = clumps;
  out.stats.bambooCulms = culmM.length;
  out.geometries.push(A.culmGeo, A.leafGeo);
  out.materials.push(A.culmMat, A.leafMat, A.snowMat);
  return clumps;
}

function buildClump(rand, x, z, lush, culmM, culmC, leafM, leafC) {
  const clumpR = (lush ? 1.2 : 0.7) + rand() * (lush ? 1.4 : 0.9);
  const count = Math.round((lush ? 26 : 15) + rand() * (lush ? 16 : 15));
  const heightMul = 0.88 + rand() * 0.38;
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * clumpR;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    const h = (5.0 + rand() * 3.4) * heightMul;
    const tiltAmt = 0.04 + (r / clumpR) * 0.1 + rand() * 0.04;
    const tiltAng = rand() * Math.PI * 2;
    const rad = 0.8 + rand() * 0.55;
    culmM.push(
      trs(
        px,
        0,
        pz,
        Math.sin(tiltAng) * tiltAmt,
        rand() * Math.PI * 2,
        Math.cos(tiltAng) * tiltAmt,
        rad,
        h / 6,
        rad
      )
    );
    const l = 0.8 + rand() * 0.32;
    culmC.push(new THREE.Color(l * 0.97, l, l * 0.88));

    // 顶部叶簇
    const nLeaf = rand() < 0.6 ? 2 : 1;
    const topX = px + Math.sin(tiltAng) * tiltAmt * h * 0.5;
    const topZ = pz + Math.cos(tiltAng) * tiltAmt * h * 0.5;
    for (let k = 0; k < nLeaf; k++) {
      const sc = 1.0 + rand() * 1.0;
      leafM.push(
        trs(
          topX + (rand() - 0.5) * 1.3,
          h * (0.72 + rand() * 0.22),
          topZ + (rand() - 0.5) * 1.3,
          (rand() - 0.5) * 1.5,
          rand() * Math.PI * 2,
          (rand() - 0.5) * 1.2,
          sc,
          sc * (0.75 + rand() * 0.3),
          1
        )
      );
      const ll = 0.82 + rand() * 0.3;
      leafC.push(new THREE.Color(ll * 0.95, ll, ll * 0.86));
    }
  }
}

/** 释放本模块静态资源（交给 vegetation.dispose） */
export function disposeBambooAssets() {
  if (!_assets) return;
  disposeGeometries([_assets.culmGeo, _assets.leafGeo]);
  _assets.culmMat.dispose();
  _assets.leafMat.dispose();
  _assets.snowMat.dispose();
  _assets = null;
}

import * as THREE from 'three';
import { mulberry32 } from '../../utils/random.js';
import { leafClusterTexture } from '../../utils/tex.js';
import { COLORS } from '../../utils/palette.js';
import { bake, tubeGeometry, hangingCardGeometry, instanced, trs } from './merge.js';
import { mergeGeometries } from './merge.js';
import { applyWind, jitterColors, makeSnowOverlayMaterial } from './wind.js';
import { barkTexture, willowCurtainTexture } from './textures.js';
import { findSpots } from './placement.js';

/**
 * 垂柳 —— 济南「四面荷花三面柳」的灵魂。
 * 树干分叉 + 枝条成帘；柳帘用 InstancedMesh + 顶点风摆。
 */

let _assets = null;
function assets() {
  if (_assets) return _assets;
  const willowLeaf = leafClusterTexture({
    size: 256,
    count: 40,
    color: '#8aa65a',
    color2: '#b0c476',
    seed: 13,
    spread: 0.95,
    leafW: 0.075,
    leafH: 0.30,
  });
  const bark = barkTexture('willow');
  const barkMat = new THREE.MeshStandardMaterial({ map: bark, color: 0xffffff, roughness: 0.96, metalness: 0 });
  const curtainMat = new THREE.MeshStandardMaterial({
    map: willowCurtainTexture(5),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  applyWind(curtainMat, { mode: 'hanging', sway: 0.22, height: 1, speed: 1.0, snow: 0.22, wet: 0.5, night: 0.4 });
  const sprayMat = new THREE.MeshStandardMaterial({
    map: willowLeaf,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  applyWind(sprayMat, { mode: 'rigid', sway: 0.26, height: 11, speed: 1.05, snow: 0.26, wet: 0.5, night: 0.4 });

  _assets = {
    barkMat,
    curtainMat,
    sprayMat,
    // 柳帘卡片细分 10 段：风摆时曲线更顺滑，不会出现折角
    curtainGeo: hangingCardGeometry(1, 1, { bow: 0.16, segY: 10, taper: 0.22, curl: 0.12 }),
    sprayGeo: new THREE.PlaneGeometry(1, 1, 1, 1),
    snowMat: null, // 垂柳不做白卡覆雪，用着色器提亮
  };
  return _assets;
}

/**
 * 生成垂柳。zones 由 layout.PLANTING_ZONES 过滤 kind='willow'。
 */
export function buildWillowGrove(ctx, out) {
  const A = assets();
  const rand0 = mulberry32(0x51a7);
  const trunkGeos = [];
  const curtainM = [];
  const curtainC = [];
  const sprayM = [];
  const sprayC = [];
  const zones = ctx.layout.PLANTING_ZONES.filter((z) => z.kind === 'willow');

  let treeCount = 0;
  for (const zone of zones) {
    const rand = mulberry32(zone.seed);
    const spots = findSpots(rand, zone.area, zone.count, { water: 0.75, path: 1.2, building: 1.5, wall: 3.0 }, 3.0);
    for (const [x, z] of spots) {
      buildOne(rand, x, z, out, trunkGeos, curtainM, curtainC, sprayM, sprayC);
      treeCount++;
    }
  }

  const trunkMesh = new THREE.Mesh(mergeGeometries(trunkGeos), A.barkMat);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  trunkMesh.name = 'willow-trunks';
  out.group.add(trunkMesh);

  const curtainMesh = instanced(A.curtainGeo, A.curtainMat, curtainM, {
    colors: curtainC,
    castShadow: true,
    name: 'willow-curtains',
  });
  out.group.add(curtainMesh);

  if (sprayM.length) {
    const sprayMesh = instanced(A.sprayGeo, A.sprayMat, sprayM, {
      colors: sprayC,
      castShadow: true,
      name: 'willow-sprays',
    });
    out.group.add(sprayMesh);
  }

  // 少量落叶（水面/地面），增加秋意
  const leafM = [];
  const leafC = [];
  for (let i = 0; i < 260; i++) {
    const x = -26 + rand0() * 52;
    const z = -20 + rand0() * 46;
    const water = ctx.layout.isWaterAt(x, z, 0.2);
    const y = water ? ctx.waterLevel + 0.01 : 0.012;
    leafM.push(trs(x, y, z, -Math.PI / 2 + (rand0() - 0.5) * 0.1, rand0() * Math.PI * 2, 0, 0.07 + rand0() * 0.07));
  }
  const leafGeo = new THREE.PlaneGeometry(1, 1);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x93a860,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  const leaves = instanced(leafGeo, leafMat, leafM, { castShadow: false, name: 'willow-fallen' });
  out.group.add(leaves);

  out.stats = out.stats || {};
  out.stats.willows = treeCount;
  void leafC;
  return treeCount;
}

function buildOne(rand, x, z, out, trunkGeos, curtainM, curtainC, sprayM, sprayC) {
  const H = 7.4 + rand() * 3.4;
  const leanAng = rand() * Math.PI * 2;
  const lean = 0.25 + rand() * 0.85;
  const splitY = 2.0 + rand() * 0.9;
  const baseR = 0.27 + rand() * 0.15;
  const dx = Math.cos(leanAng);
  const dz = Math.sin(leanAng);
  const split = [x + dx * lean * 0.45, splitY, z + dz * lean * 0.45];

  // 主干（略带弯曲）
  trunkGeos.push(
    bake(
      tubeGeometry(
        [
          [x, -0.35, z],
          [x + dx * lean * 0.12, splitY * 0.45, z + dz * lean * 0.12],
          split,
        ],
        [baseR * 1.4, baseR, baseR * 0.7],
        6
      )
    )
  );

  const tips = [];
  const nb = 3 + Math.floor(rand() * 2);
  for (let b = 0; b < nb; b++) {
    const ang = leanAng + (b / nb) * Math.PI * 2 + (rand() - 0.5) * 0.9;
    const elev = 0.45 + rand() * 0.6;
    const len = 2.3 + rand() * 2.4;
    const sx = split[0] + (rand() - 0.5) * 0.3;
    const sy = split[1] + rand() * 0.6;
    const sz = split[2] + (rand() - 0.5) * 0.3;
    const dirx = Math.cos(ang) * Math.cos(elev);
    const diry = Math.sin(elev);
    const dirz = Math.sin(ang) * Math.cos(elev);
    const mid = [sx + dirx * len * 0.5, sy + diry * len * 0.55 + 0.15, sz + dirz * len * 0.5];
    const end = [sx + dirx * len, Math.min(sy + diry * len * 0.92, splitY + H - splitY - 0.4), sz + dirz * len];
    trunkGeos.push(bake(tubeGeometry([[sx, sy, sz], mid, end], [baseR * 0.46, baseR * 0.25, baseR * 0.1], 5)));
    tips.push([end[0], end[1], end[2], 1.0]);

    // 次级枝
    const nt = 2 + Math.floor(rand() * 2);
    for (let t = 0; t < nt; t++) {
      const pe = t === 0 ? 0.55 + rand() * 0.15 : 0.8 + rand() * 0.18;
      const bx = sx + (end[0] - sx) * pe;
      const by = sy + (end[1] - sy) * pe;
      const bz = sz + (end[2] - sz) * pe;
      const ta = ang + (rand() - 0.5) * 2.1;
      const tl = 0.8 + rand() * 1.6;
      const ex = bx + Math.cos(ta) * tl * (0.7 + rand() * 0.4);
      const ey = Math.min(by + rand() * 0.6, splitY + H - splitY - 0.5);
      const ez = bz + Math.sin(ta) * tl * (0.7 + rand() * 0.4);
      trunkGeos.push(bake(tubeGeometry([[bx, by, bz], [ex, ey, ez]], [baseR * 0.12, baseR * 0.035], 4)));
      tips.push([ex, ey, ez, 0.85]);
    }
  }
  // 树冠中心顶部
  tips.push([x + dx * lean * 1.4, Math.min(H, splitY + 3.2), z + dz * lean * 1.4, 0.8]);

  // 柳帘：从各枝梢垂挂
  for (const [tx, ty, tz, tipScale] of tips) {
    const n = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const off = 0.1 + rand() * 0.9;
      const ay = ty + (rand() - 0.5) * 0.6;
      const len0 = 2.1 + rand() * 2.1;
      const len = Math.min(len0, ay - (0.65 + rand() * 0.8));
      if (len < 1.1) continue;
      const w = (0.85 + rand() * 0.6) * tipScale;
      curtainM.push(
        trs(
          tx + Math.cos(a) * off,
          ay,
          tz + Math.sin(a) * off,
          (rand() - 0.5) * 0.12,
          rand() * Math.PI * 2,
          (rand() - 0.5) * 0.12,
          w,
          len,
          1
        )
      );
      if (curtainC.length < curtainM.length) {
        const l = 0.86 + rand() * 0.26;
        curtainC.push(new THREE.Color(l, l * (0.99 + rand() * 0.05), l * (0.94 + rand() * 0.08)));
      }
    }
    // 冠顶叶簇补形
    const ns = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < ns; i++) {
      const a = rand() * Math.PI * 2;
      const off = 0.2 + rand() * 0.8;
      const sc = (1.2 + rand() * 1.1) * tipScale;
      sprayM.push(
        trs(
          tx + Math.cos(a) * off,
          ty + 0.1 + rand() * 0.7,
          tz + Math.sin(a) * off,
          (rand() - 0.5) * 1.4,
          rand() * Math.PI * 2,
          (rand() - 0.5) * 0.9,
          sc,
          sc,
          1
        )
      );
      const l = 0.88 + rand() * 0.22;
      sprayC.push(new THREE.Color(l * 0.98, l, l * 0.9));
    }
  }

  out.treeSpots.push([x, z, 'willow']);
  const pd = out.ctx.layout.pathDistance(x, z);
  if (pd < 4.2 && out.colliders.length < 220) {
    out.colliders.push({ type: 'circle', x, z, r: 0.45, tag: 'solid' });
  }
}

export const WILLOW_COLORS = COLORS;
export { makeSnowOverlayMaterial };

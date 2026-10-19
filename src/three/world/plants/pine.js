import * as THREE from 'three';
import { mulberry32 } from '../../utils/random.js';
import { bake, mergeGeometries, tubeGeometry, instanced, trs } from './merge.js';
import { applyWind, jitterColors, makeSnowOverlayMaterial } from './wind.js';
import { barkTexture, pineNeedleTexture } from './textures.js';
import { findSpots } from './placement.js';

/**
 * 松柏 —— 北岸 / 东北 / 西侧。
 * 虬曲主干 + 平展层叠的松针冠（扁平盘状叶簇卡），雪天冠上覆白。
 */

let _assets = null;
function assets() {
  if (_assets) return _assets;
  const barkMat = new THREE.MeshStandardMaterial({
    map: barkTexture('pine'),
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
  });
  const needleTex = pineNeedleTexture();
  const needleMat = new THREE.MeshStandardMaterial({
    map: needleTex,
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.94,
    metalness: 0,
  });
  applyWind(needleMat, { mode: 'rigid', sway: 0.1, height: 10, speed: 0.85, snow: 0.40, wet: 0.45, night: 0.42 });
  const snowMat = makeSnowOverlayMaterial(needleTex, 0);
  applyWind(snowMat, { mode: 'rigid', sway: 0.1, height: 10, speed: 0.85, snow: 0, wet: 0, night: 0.2 });
  _assets = { barkMat, needleMat, snowMat, cardGeo: new THREE.PlaneGeometry(1, 1) };
  return _assets;
}

export function buildPineGrove(ctx, out) {
  const A = assets();
  const zones = ctx.layout.PLANTING_ZONES.filter((z) => z.kind === 'pine');
  const trunkGeos = [];
  const plateM = [];
  const plateC = [];
  let count = 0;
  for (const zone of zones) {
    const rand = mulberry32(zone.seed);
    const spots = findSpots(
      rand,
      zone.area,
      zone.count,
      { water: 0.9, path: 1.6, building: 2.0, wall: 3.0, corridor: false, rocks: false },
      4.0
    );
    for (const [x, z] of spots) {
      buildOnePine(rand, x, z, out, trunkGeos, plateM, plateC);
      count++;
    }
  }

  const trunkMesh = new THREE.Mesh(mergeGeometries(trunkGeos), A.barkMat);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  trunkMesh.name = 'pine-trunks';
  out.group.add(trunkMesh);

  const plates = instanced(A.cardGeo, A.needleMat, plateM, {
    colors: plateC,
    castShadow: true,
    name: 'pine-canopy',
  });
  out.group.add(plates);

  if (plateM.length) {
    const snowM = [];
    const up = new THREE.Matrix4().makeTranslation(0, 0.05, 0);
    const sc = new THREE.Matrix4().makeScale(1.03, 1.03, 1.03);
    for (const m of plateM) snowM.push(m.clone().multiply(up).multiply(sc));
    const snow = instanced(A.cardGeo, A.snowMat, snowM, { castShadow: false, name: 'pine-snow' });
    snow.renderOrder = 2;
    out.group.add(snow);
    out.snowOverlays.push({ mat: A.snowMat, factor: 0.72 });
  }

  out.stats = out.stats || {};
  out.stats.pines = count;
  out.geometries.push(A.cardGeo);
  out.materials.push(A.barkMat, A.needleMat, A.snowMat);
  return count;
}

function buildOnePine(rand, x, z, out, trunkGeos, plateM, plateC) {
  const H = 6.0 + rand() * 3.4;
  const leanAng = rand() * Math.PI * 2;
  const lean = 0.35 + rand() * 1.0;
  const baseR = 0.24 + rand() * 0.15;
  const dx = Math.cos(leanAng);
  const dz = Math.sin(leanAng);
  const p0 = [x, -0.3, z];
  const p1 = [x + dx * lean * 0.15, H * 0.26, z + dz * lean * 0.15];
  const p2 = [x + dx * lean * 0.55, H * 0.58, z + dz * lean * 0.55];
  const p3 = [x + dx * lean, H * 0.86, z + dz * lean];
  const p4 = [x + dx * lean * 1.1 + (rand() - 0.5) * 0.6, H, z + dz * lean * 1.1 + (rand() - 0.5) * 0.6];
  trunkGeos.push(bake(tubeGeometry([p0, p1, p2, p3, p4], [baseR * 1.3, baseR, baseR * 0.72, baseR * 0.4, baseR * 0.18], 6)));

  const trunkAt = (t) => {
    // p1..p3 之间插值
    const a = [p0, p1, p2, p3, p4];
    const f = t * 3;
    const i = Math.min(3, Math.floor(f));
    const k = f - i;
    const A0 = a[i];
    const A1 = a[i + 1];
    return [A0[0] + (A1[0] - A0[0]) * k, A0[1] + (A1[1] - A0[1]) * k, A0[2] + (A1[2] - A0[2]) * k];
  };

  const anchors = [];
  const nb = 3 + Math.floor(rand() * 3);
  for (let b = 0; b < nb; b++) {
    const t = 0.32 + (b / Math.max(1, nb - 1)) * 0.6;
    const start = trunkAt(Math.min(1, t));
    const ang = rand() * Math.PI * 2;
    const elev = 0.12 + rand() * 0.3;
    const len = 1.7 + rand() * 2.7;
    const dirx = Math.cos(ang) * Math.cos(elev);
    const diry = Math.sin(elev);
    const dirz = Math.sin(ang) * Math.cos(elev);
    const mid = [start[0] + dirx * len * 0.5, start[1] + diry * len * 0.4 + 0.25, start[2] + dirz * len * 0.5];
    const end = [start[0] + dirx * len, start[1] + diry * len + 0.1, start[2] + dirz * len];
    trunkGeos.push(bake(tubeGeometry([start, mid, end], [baseR * 0.42, baseR * 0.2, baseR * 0.07], 5)));
    // 枝上铺展松针冠
    const na = 3;
    for (let k = 0; k < na; k++) {
      const f = 0.38 + (k / (na - 1)) * 0.66;
      const ax = start[0] + (end[0] - start[0]) * f + (rand() - 0.5) * 0.5;
      const ay = start[1] + (end[1] - start[1]) * f + 0.28 + (rand() - 0.5) * 0.3;
      const az = start[2] + (end[2] - start[2]) * f + (rand() - 0.5) * 0.5;
      anchors.push([ax, ay, az, 1.6 + rand() * 1.6]);
      if (k === na - 1 && rand() < 0.6) {
        // 枝端小枝 + 小冠
        const ta = ang + (rand() - 0.5) * 1.6;
        const tl = 0.7 + rand() * 1.2;
        const ex = end[0] + Math.cos(ta) * tl;
        const ez = end[2] + Math.sin(ta) * tl;
        const ey = end[1] + 0.2 + rand() * 0.5;
        trunkGeos.push(bake(tubeGeometry([[end[0], end[1], end[2]], [ex, ey, ez]], [baseR * 0.08, baseR * 0.03], 4)));
        anchors.push([ex, ey, ez, 1.1 + rand() * 0.9]);
      }
    }
  }
  // 树顶冠层
  anchors.push([p4[0], H - 0.2 + rand() * 0.3, p4[2], 1.5 + rand() * 1.2]);
  anchors.push([p4[0] + (rand() - 0.5) * 1.4, H - 0.8 + rand() * 0.4, p4[2] + (rand() - 0.5) * 1.4, 1.3 + rand() * 1.0]);

  for (const [ax, ay, az, s] of anchors) {
    const n = rand() < 0.55 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const ss = s * (0.8 + rand() * 0.45);
      plateM.push(
        trs(
          ax + (rand() - 0.5) * 0.7,
          ay + i * 0.22 + (rand() - 0.5) * 0.12,
          az + (rand() - 0.5) * 0.7,
          -Math.PI / 2 + (rand() - 0.5) * 0.3,
          rand() * Math.PI * 2,
          (rand() - 0.5) * 0.22,
          ss,
          ss * (0.8 + rand() * 0.3),
          1
        )
      );
      const l = 0.78 + rand() * 0.3;
      plateC.push(new THREE.Color(l * 0.94, l, l * 0.9));
    }
  }

  out.treeSpots.push([x, z, 'pine']);
  if (out.ctx.layout.pathDistance(x, z) < 4.2 && out.colliders.length < 220) {
    out.colliders.push({ type: 'circle', x, z, r: 0.42, tag: 'solid' });
  }
}

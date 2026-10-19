import * as THREE from 'three';
import { mulberry32 } from '../../utils/random.js';
import { bake, tubeGeometry, instanced, trs, mergeGeometries } from './merge.js';
import { applyWind } from './wind.js';
import { barkTexture, blossomTexture, mapleTexture } from './textures.js';
import { findSpots } from './placement.js';

/**
 * 海棠 / 红枫 —— 花木。
 * 海棠：李清照纪念堂前必植（「知否知否，应是绿肥红瘦」）。
 * 红枫：假山与沧园的秋色点缀。
 */

const _assets = {};

function assets(kind) {
  if (_assets[kind]) return _assets[kind];
  const isBlossom = kind === 'blossom';
  const tex = isBlossom ? blossomTexture('pink') : mapleTexture();
  const cardMat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0,
  });
  applyWind(cardMat, {
    mode: 'rigid',
    sway: isBlossom ? 0.13 : 0.16,
    height: 6,
    speed: 1.0,
    snow: isBlossom ? 0.3 : 0.42,
    wet: 0.42,
    night: 0.42,
  });
  const petalMat = new THREE.MeshStandardMaterial({
    color: isBlossom ? 0xe7b6bd : 0xb0603c,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
  });
  const barkMat = new THREE.MeshStandardMaterial({
    map: barkTexture('willow'),
    color: isBlossom ? 0xcdbfae : 0xb9aa99,
    roughness: 0.95,
    metalness: 0,
  });
  _assets[kind] = {
    cardMat,
    petalMat,
    barkMat,
    cardGeo: new THREE.PlaneGeometry(1, 1),
    petalGeo: new THREE.PlaneGeometry(1, 1),
  };
  return _assets[kind];
}

/** kind: 'blossom' | 'maple' */
export function buildFlowerTrees(ctx, out, kind) {
  const A = assets(kind);
  const zones = ctx.layout.PLANTING_ZONES.filter((z) => z.kind === kind);
  const trunkGeos = [];
  const cardM = [];
  const cardC = [];
  const petalM = [];
  const petalC = [];
  let count = 0;

  for (const zone of zones) {
    const rand = mulberry32(zone.seed);
    const opts = { water: 1.0, path: 1.3, building: 1.6, wall: 3.0, corridor: false, rocks: false };
    const spots = findSpots(rand, zone.area, zone.count, opts, 2.8);
    for (const [x, z] of spots) {
      buildOne(rand, x, z, kind, out, trunkGeos, cardM, cardC, petalM, petalC, 1);
      count++;
    }
  }

  // 李清照纪念堂前：保证有海棠临门（沿祠前小径两翼）
  if (kind === 'blossom') {
    const rand = mulberry32(0x11c0);
    const area = { kind: 'ellipse', cx: 58.5, cz: 30.6, rx: 6.5, rz: 2.6 };
    const featured = findSpots(rand, area, 2, { water: 1.0, path: 1.1, building: 1.4, wall: 2.6 }, 3.0);
    for (const [x, z] of featured) {
      buildOne(rand, x, z, kind, out, trunkGeos, cardM, cardC, petalM, petalC, 1.18);
      count++;
    }
  }

  const trunkMesh = new THREE.Mesh(mergeGeometries(trunkGeos), A.barkMat);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  trunkMesh.name = `${kind}-trunks`;
  out.group.add(trunkMesh);

  const cards = instanced(A.cardGeo, A.cardMat, cardM, {
    colors: cardC,
    castShadow: true,
    name: `${kind}-blooms`,
  });
  out.group.add(cards);

  if (petalM.length) {
    const petals = instanced(A.petalGeo, A.petalMat, petalM, {
      colors: petalC,
      castShadow: false,
      name: `${kind}-fallen`,
    });
    out.group.add(petals);
  }

  out.stats = out.stats || {};
  out.stats[kind === 'blossom' ? 'blossoms' : 'maples'] = count;
  out.geometries.push(A.cardGeo, A.petalGeo);
  out.materials.push(A.barkMat, A.cardMat, A.petalMat);
  return count;
}

function buildOne(rand, x, z, kind, out, trunkGeos, cardM, cardC, petalM, petalC, scale) {
  const isBlossom = kind === 'blossom';
  const H = (isBlossom ? 3.3 + rand() * 1.9 : 3.7 + rand() * 1.9) * scale;
  const splitY = H * (0.3 + rand() * 0.08);
  const baseR = (isBlossom ? 0.15 : 0.17) + rand() * 0.07;
  const leanAng = rand() * Math.PI * 2;
  const lean = 0.15 + rand() * 0.35;
  const dx = Math.cos(leanAng);
  const dz = Math.sin(leanAng);
  const split = [x + dx * lean, splitY, z + dz * lean];
  trunkGeos.push(
    bake(
      tubeGeometry(
        [
          [x, -0.25, z],
          [x + dx * lean * 0.4, splitY * 0.5, z + dz * lean * 0.4],
          split,
        ],
        [baseR * 1.35, baseR, baseR * 0.85],
        5
      )
    )
  );

  const tips = [];
  const nb = 3 + Math.floor(rand() * 2);
  for (let b = 0; b < nb; b++) {
    const ang = leanAng + (b / nb) * Math.PI * 2 + (rand() - 0.5) * 0.8;
    const elev = 0.55 + rand() * 0.55;
    const len = H * (0.35 + rand() * 0.25);
    const start = [split[0] + (rand() - 0.5) * 0.2, split[1] + rand() * 0.25, split[2] + (rand() - 0.5) * 0.2];
    const dirx = Math.cos(ang) * Math.cos(elev);
    const diry = Math.sin(elev);
    const dirz = Math.sin(ang) * Math.cos(elev);
    const mid = [start[0] + dirx * len * 0.55, start[1] + diry * len * 0.6, start[2] + dirz * len * 0.55];
    const end = [start[0] + dirx * len, start[1] + diry * len, start[2] + dirz * len];
    trunkGeos.push(bake(tubeGeometry([start, mid, end], [baseR * 0.62, baseR * 0.34, baseR * 0.13], 5)));
    tips.push([end[0], end[1], end[2], 1.0]);
    const nt = 2 + Math.floor(rand() * 2);
    for (let t = 0; t < nt; t++) {
      const ta = ang + (rand() - 0.5) * 1.7;
      const tl = len * (0.35 + rand() * 0.35);
      const ex = end[0] + Math.cos(ta) * tl;
      const ez = end[2] + Math.sin(ta) * tl;
      const ey = end[1] + (rand() * 0.7 - 0.1) * tl * 0.8;
      trunkGeos.push(bake(tubeGeometry([[end[0], end[1], end[2]], [ex, ey, ez]], [baseR * 0.14, baseR * 0.04], 4)));
      tips.push([ex, ey, ez, 0.85]);
    }
  }

  // 花簇冠：围绕枝梢椭球体积撒卡
  const ccx = x + dx * lean * 1.4;
  const ccy = H * 0.72;
  const ccz = z + dz * lean * 1.4;
  const rx = H * (0.42 + rand() * 0.16) * scale;
  const ry = H * (0.3 + rand() * 0.12) * scale;
  const rz = rx * (0.85 + rand() * 0.3);
  const nCards = Math.round((isBlossom ? 38 : 34) + rand() * 20);
  for (let i = 0; i < nCards; i++) {
    // 球壳体：外缘密、内部疏
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const sq = Math.sqrt(1 - u * u);
    const shell = 0.62 + Math.pow(rand(), 0.4) * 0.42;
    const px = ccx + sq * Math.cos(phi) * rx * shell;
    const py = ccy + u * ry * shell;
    const pz = ccz + sq * Math.sin(phi) * rz * shell;
    const sc = (0.72 + rand() * 0.75) * scale;
    cardM.push(
      trs(
        px,
        py,
        pz,
        (rand() - 0.5) * 1.5,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 1.1,
        sc,
        sc * (0.8 + rand() * 0.35),
        1
      )
    );
    const l = 0.8 + rand() * 0.34;
    cardC.push(new THREE.Color(l, l * (isBlossom ? 0.97 : 0.92), l * (isBlossom ? 0.97 : 0.95)));
  }

  // 落花 / 落叶
  const nPetal = Math.round(14 + rand() * 14);
  for (let i = 0; i < nPetal; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.7 + Math.sqrt(rand()) * 3.0;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (out.ctx.layout.isWaterAt(px, pz, 0.1)) continue;
    petalM.push(trs(px, 0.012 + rand() * 0.006, pz, -Math.PI / 2, rand() * Math.PI * 2, 0, 0.09 + rand() * 0.08, 0.08 + rand() * 0.07, 1));
    const l = 0.82 + rand() * 0.3;
    petalC.push(new THREE.Color(l, l * (isBlossom ? 0.94 : 0.9), l * (isBlossom ? 0.96 : 0.93)));
  }

  out.treeSpots.push([x, z, kind]);
  if (out.ctx.layout.pathDistance(x, z) < 4.0 && out.colliders.length < 220) {
    out.colliders.push({ type: 'circle', x, z, r: 0.36, tag: 'solid' });
  }
}

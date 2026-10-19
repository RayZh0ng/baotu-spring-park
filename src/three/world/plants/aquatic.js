import * as THREE from 'three';
import { mulberry32 } from '../../utils/random.js';
import { lotusPadTexture } from '../../utils/tex.js';
import { discGeometry, petalGeometry, instanced, trs, bake, mergeGeometries, tubeGeometry } from './merge.js';
import { applyWind } from './wind.js';
import { reedTexture } from './textures.js';

/**
 * 水生植物 —— 荷花池/沧泉/望水泉的荷叶、荷花、莲蓬；溪流/荷池边的芦苇。
 */

const _assets = {};
function assets() {
  if (_assets.padMat) return _assets;
  const padMat = new THREE.MeshStandardMaterial({
    map: lotusPadTexture({ size: 128, seed: 11, color: '#5f7d49' }),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0.02,
  });
  applyWind(padMat, { mode: 'rigid', sway: 0.022, height: 0.6, speed: 0.55, snow: 0.34, wet: 0.6, night: 0.4 });

  const petalMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.68,
    metalness: 0,
  });
  applyWind(petalMat, { mode: 'rigid', sway: 0.012, height: 0.7, speed: 0.5, snow: 0.25, wet: 0.3, night: 0.38 });

  const centerMat = new THREE.MeshStandardMaterial({ color: 0xd9c36a, roughness: 0.8, metalness: 0 });

  const podGeo = mergeGeometries([
    bake(tubeGeometry([[0, 0, 0], [0, 0.42, 0], [0, 0.52, 0]], [0.018, 0.016, 0.02], 4)),
    bake(new THREE.CylinderGeometry(0.15, 0.07, 0.16, 7), trs(0, 0.6, 0)),
    bake(new THREE.CylinderGeometry(0.12, 0.15, 0.03, 7), trs(0, 0.685, 0)),
  ]);
  const podMat = new THREE.MeshStandardMaterial({ color: 0x8a9a56, roughness: 0.85, metalness: 0 });
  applyWind(podMat, { mode: 'rigid', sway: 0.02, height: 0.9, speed: 0.5, snow: 0.3, wet: 0.35, night: 0.4 });

  const reedTex = reedTexture('green');
  const reedMat = new THREE.MeshStandardMaterial({
    map: reedTex,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    roughness: 0.92,
  });
  applyWind(reedMat, { mode: 'upright', sway: 0.22, height: 1, speed: 1.35, snow: 0.6, wet: 0.45, night: 0.42 });
  const reedGeo = new THREE.PlaneGeometry(1, 1);
  reedGeo.translate(0, 0.5, 0);

  _assets.padMat = padMat;
  _assets.padGeo = discGeometry(1, 20);
  _assets.petalMat = petalMat;
  _assets.petalGeo = petalGeometry({ base: '#fdf6f2', tip: '#e0879b', height: 1, maxW: 0.5, curve: 0.18 });
  _assets.centerMat = centerMat;
  _assets.centerGeo = new THREE.SphereGeometry(0.055, 6, 4);
  _assets.podGeo = podGeo;
  _assets.podMat = podMat;
  _assets.reedMat = reedMat;
  _assets.reedGeo = reedGeo;
  return _assets;
}

export function buildAquatic(ctx, out) {
  const A = assets();
  const L = ctx.layout;
  const water = ctx.waterLevel;
  const pads = { m: [], c: [] };
  const petals = { m: [], c: [] };
  const centers = { m: [], c: [] };
  const pods = { m: [], c: [] };
  const reeds = { m: [], c: [] };
  const rand = mulberry32(0xa9c1);

  /* ---- 荷叶 / 荷花 / 莲蓬 ---- */
  for (const zone of L.AQUATIC_ZONES) {
    if (zone.kind !== 'lotus') continue;
    const zr = mulberry32(zone.seed);
    const padList = [];
    for (let i = 0; i < zone.count; i++) {
      const a = zr() * Math.PI * 2;
      const r = Math.sqrt(zr()) * 0.94;
      const x = zone.cx + Math.cos(a) * zone.rx * r;
      const z = zone.cz + Math.sin(a) * zone.rz * r;
      const sc = 0.36 + zr() * 0.62;
      const y = water + 0.02 + zr() * 0.17;
      padList.push([x, z]);
      pads.m.push(trs(x, y, z, (zr() - 0.5) * 0.1, zr() * Math.PI * 2, (zr() - 0.5) * 0.1, sc, 1, sc * (0.9 + zr() * 0.2)));
      const l = 0.76 + zr() * 0.4;
      pads.c.push(new THREE.Color(l * 0.92, l, l * 0.86));
      // 少量浮叶上下层
      if (zr() < 0.45) {
        const sx = x + (zr() - 0.5) * 1.2;
        const sz = z + (zr() - 0.5) * 1.2;
        const s2 = sc * (0.55 + zr() * 0.35);
        pads.m.push(trs(sx, water + 0.015 + zr() * 0.05, sz, 0, zr() * Math.PI * 2, 0, s2, 1, s2));
        const l2 = 0.7 + zr() * 0.4;
        pads.c.push(new THREE.Color(l2 * 0.92, l2, l2 * 0.86));
      }
    }

    // 荷花
    const nFlowers = Math.max(2, Math.round(zone.count / 3.4));
    for (let f = 0; f < nFlowers; f++) {
      const pick = padList[Math.floor(zr() * padList.length)];
      const y = water + 0.24 + zr() * 0.34;
      const yaw0 = zr() * Math.PI * 2;
      const fs = 0.3 + zr() * 0.1;
      const ringOuter = 6;
      const ringInner = 5;
      for (let i = 0; i < ringOuter; i++) {
        petals.m.push(trs(pick[0], y, pick[1], 0.92 + zr() * 0.2, yaw0 + (i / ringOuter) * Math.PI * 2, 0, fs, fs * (1.0 + zr() * 0.15), fs));
        petals.c.push(new THREE.Color(0.97 + zr() * 0.06, 0.9 + zr() * 0.08, 0.94 + zr() * 0.06));
      }
      for (let i = 0; i < ringInner; i++) {
        petals.m.push(trs(pick[0], y + 0.02, pick[1], 0.4 + zr() * 0.18, yaw0 + (i / ringInner) * Math.PI * 2 + 0.4, 0, fs * 0.68, fs * 0.6, fs * 0.68));
        petals.c.push(new THREE.Color(1.0, 0.95 + zr() * 0.04, 0.97));
      }
      centers.m.push(trs(pick[0], y + 0.055, pick[1], 0, 0, 0, 1.2 + zr() * 0.5));
      centers.c.push(new THREE.Color(1, 1, 1));
      // 莲蓬
      if (zr() < 0.55) {
        pods.m.push(trs(pick[0] + (zr() - 0.5) * 0.6, water - 0.02, pick[1] + (zr() - 0.5) * 0.6, 0, zr() * Math.PI * 2, 0, 0.9 + zr() * 0.3));
        pods.c.push(new THREE.Color(0.9 + zr() * 0.15, 0.95, 0.85));
      }
    }
  }

  /* ---- 芦苇 ---- */
  const bridges = L.STRUCTURES.filter((s) => s.type === 'archbridge' || s.type === 'slabbridge' || s.type === 'zigzagbridge');
  const nearBridge = (x, z, r) => {
    for (const b of bridges) {
      if (b.points) {
        for (const p of b.points) if (Math.hypot(p[0] - x, p[1] - z) < r) return true;
      } else if (Math.hypot(b.pos[0] - x, b.pos[1] - z) < r) return true;
    }
    return false;
  };
  const addReedCluster = (x, z, zr, inWater) => {
    const baseY = inWater ? water - 0.02 : 0;
    const n = 2 + Math.floor(zr() * 3);
    for (let i = 0; i < n; i++) {
      const h = 0.85 + zr() * 0.75;
      const w = 0.7 + zr() * 0.5;
      reeds.m.push(
        trs(
          x + (zr() - 0.5) * 0.8,
          baseY,
          z + (zr() - 0.5) * 0.8,
          0,
          zr() * Math.PI * 2,
          0,
          w,
          h,
          1
        )
      );
      const l = 0.78 + zr() * 0.34;
      reeds.c.push(new THREE.Color(l * 0.96, l, l * 0.8));
    }
  };

  for (const zone of L.AQUATIC_ZONES) {
    if (zone.kind !== 'reed') continue;
    const zr = mulberry32(zone.seed);
    if (zone.shape === 'line') {
      const pts = zone.points;
      const n = zone.count;
      for (let i = 0; i < n; i++) {
        const seg = Math.floor(zr() * (pts.length - 1));
        const t = zr();
        const [ax, az] = pts[seg];
        const [bx, bz] = pts[seg + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (bz - az) / len;
        const nz = -(bx - ax) / len;
        const side = zr() > 0.5 ? 1 : -1;
        const off = 0.9 + zr() * 0.9;
        const x = ax + (bx - ax) * t + nx * off * side;
        const z = az + (bz - az) * t + nz * off * side;
        if (nearBridge(x, z, 3.6)) continue;
        // 主泉池观景视线上不要芦苇（会挡住泉眼与亭台）
        if (Math.hypot(x - 0, z - 0) < 26) continue;
        const waterShape = L.isWaterAt(x, z, 0.5);
        addReedCluster(x, z, zr, Boolean(waterShape));
      }
    } else if (zone.shape === 'ellipse') {
      for (let i = 0; i < zone.count; i++) {
        const a = zr() * Math.PI * 2;
        const f = 0.78 + zr() * 0.24;
        const x = zone.cx + Math.cos(a) * zone.rx * f;
        const z = zone.cz + Math.sin(a) * zone.rz * f;
        if (nearBridge(x, z, 3.6)) continue;
        if (L.pathDistance(x, z) < 0.8) continue;
        if (Math.hypot(x - 0, z - 0) < 26) continue;
        addReedCluster(x, z, zr, true);
      }
    }
  }

  const mk = (name, geo, mat, set, castShadow) => {
    if (!set.m.length) return;
    const mesh = instanced(geo, mat, set.m, { colors: set.c, castShadow, name });
    mesh.receiveShadow = true;
    out.group.add(mesh);
  };
  mk('lotus-pads', A.padGeo, A.padMat, pads, false);
  mk('lotus-flowers', A.petalGeo, A.petalMat, petals, false);
  mk('lotus-centers', A.centerGeo, A.centerMat, centers, false);
  mk('lotus-pods', A.podGeo, A.podMat, pods, false);
  mk('reeds', A.reedGeo, A.reedMat, reeds, false);

  out.stats = out.stats || {};
  out.stats.lotusPads = pads.m.length;
  out.stats.lotusFlowers = centers.m.length;
  out.stats.reeds = reeds.m.length;
  out.geometries.push(A.padGeo, A.petalGeo, A.centerGeo, A.podGeo, A.reedGeo);
  out.materials.push(A.padMat, A.petalMat, A.centerMat, A.podMat, A.reedMat);
}

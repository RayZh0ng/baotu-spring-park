import * as THREE from 'three';
import { mulberry32 } from '../../utils/random.js';
import { crossCardGeometry, discGeometry, instanced, trs, bake, mergeGeometries } from './merge.js';
import { applyWind, jitterColors } from './wind.js';
import { grassTuftTexture, fernTexture, shrubTexture, mossPatchTexture } from './textures.js';
import { findSpots, isFree, waterEdgePoints, samplePath, findPath, sampleArea } from './placement.js';

/**
 * 地被 —— 草丛 / 蕨类 / 小灌木 / 池边苔藓 / 石缝草。
 * 全部 InstancedMesh，数量克制地铺在种植区、树根、水岸、建筑周边，避免全园铺满。
 */

const _assets = {};
function assets() {
  if (_assets.grass) return _assets;
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTuftTexture('green'),
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.92,
  });
  applyWind(grassMat, { mode: 'upright', sway: 0.13, height: 1, speed: 1.2, snow: 0.45, wet: 0.45, night: 0.4 });
  const dryMat = new THREE.MeshStandardMaterial({
    map: grassTuftTexture('dry'),
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.94,
  });
  applyWind(dryMat, { mode: 'upright', sway: 0.11, height: 1, speed: 1.1, snow: 0.05, wet: 0.4, night: 0.4 });

  const fernMat = new THREE.MeshStandardMaterial({
    map: fernTexture(),
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.92,
  });
  applyWind(fernMat, { mode: 'upright', sway: 0.075, height: 1, speed: 0.9, snow: 0.5, wet: 0.45, night: 0.4 });

  const shrubMat = new THREE.MeshStandardMaterial({
    map: shrubTexture(),
    alphaTest: 0.34,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  applyWind(shrubMat, { mode: 'rigid', sway: 0.07, height: 2.2, speed: 0.95, snow: 0.05, wet: 0.45, night: 0.42 });

  const mossMat = new THREE.MeshStandardMaterial({
    map: mossPatchTexture(),
    alphaTest: 0.16,
    side: THREE.DoubleSide,
    roughness: 0.95,
    transparent: false,
    depthWrite: true,
  });
  applyWind(mossMat, { mode: 'rigid', sway: 0.008, height: 3, speed: 0.4, snow: 0.05, wet: 0.5, night: 0.4 });

  _assets.grassMat = grassMat;
  _assets.dryMat = dryMat;
  _assets.fernMat = fernMat;
  _assets.shrubMat = shrubMat;
  _assets.mossMat = mossMat;
  // 草簇几何：三张卡片交叉（0°/60°/120°），比两张更有体积感
  _assets.crossGeo = (() => {
    const a = new THREE.PlaneGeometry(1, 1, 1, 1);
    // 底部下沉一点：倾斜后草根仍埋在地里，不会翘起露缝
    a.translate(0, 0.5 - 0.06, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 3);
    const c = a.clone();
    c.rotateY((Math.PI * 2) / 3);
    return mergeGeometries([bake(a), bake(b), bake(c)]);
  })();
  _assets.planeGeo = new THREE.PlaneGeometry(1, 1);
  _assets.discGeo = discGeometry(1, 12);
  return _assets;
}

export function buildGroundCover(ctx, out) {
  const A = assets();
  const rand = mulberry32(0x9e37);
  const L = ctx.layout;
  const grass = { m: [], c: [] };
  const dry = { m: [], c: [] };
  const ferns = { m: [], c: [] };
  const shrubs = { m: [], c: [] };
  const moss = { m: [], c: [] };

  const loose = { water: 0.25, path: 0.3, building: 0.5, wall: 1.4, compoundWall: 1.1, elevated: 0.05, corridor: false, rocks: false };
  const looseInside = { ...loose, compoundInside: true };
  const insideCompounds = new Set(['bamboo-wanzhu', 'bamboo-cang', 'bamboo-liqingzhao']);

  /* ---- 1) 种植区内的草地簇 ---- */
  const addGrass = (x, z, scale, dryChance = 0.12) => {
    if (!isFree(x, z, loose)) return false;
    const s = scale * (0.6 + rand() * 0.85);
    const set = rand() < dryChance ? dry : grass;
    // 随机小角度倾斜：草丛不会全都笔直站立
    const tiltX = (rand() - 0.5) * 0.18;
    const tiltZ = (rand() - 0.5) * 0.18;
    set.m.push(trs(x, 0, z, tiltX, rand() * Math.PI * 2, tiltZ, s, s * (0.7 + rand() * 0.75), s));
    const l = 0.78 + rand() * 0.36;
    set.c.push(new THREE.Color(l * 0.98, l, l * 0.86));
    return true;
  };

  for (const zone of L.PLANTING_ZONES) {
    const zr = mulberry32(zone.seed ^ 0x5bd1);
    const n = Math.min(150, Math.round(zone.count * 6));
    const area = zone.area;
    const opts = insideCompounds.has(zone.id) ? looseInside : loose;
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 5; a++) {
        const [x, z] = sampleArea(zr, area);
        if (isFree(x, z, opts)) {
          addGrass(x, z, 0.5 + zr() * 0.55);
          if (zr() < 0.22) ferns.m.length && addFern(x + 0.3, z + 0.2, 0.45 + zr() * 0.4);
          break;
        }
      }
    }
  }

  function addFern(x, z, scale) {
    if (!isFree(x, z, { ...loose, building: 0.4 })) return;
    const s = scale * (0.7 + rand() * 0.5);
    ferns.m.push(trs(x, 0, z, (rand() - 0.5) * 0.22, rand() * Math.PI * 2, (rand() - 0.5) * 0.22, s, s * (0.75 + rand() * 0.4), s));
    const l = 0.78 + rand() * 0.3;
    ferns.c.push(new THREE.Color(l * 0.94, l, l * 0.86));
  }

  /* ---- 2) 树根周边的草与蕨 ---- */
  for (const [tx, tz, kind] of out.treeSpots) {
    const n = kind === 'pine' ? 9 : 12;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = 0.5 + rand() * 2.0;
      addGrass(tx + Math.cos(a) * r, tz + Math.sin(a) * r, 0.42 + rand() * 0.4, 0.18);
    }
    if (kind === 'willow' || kind === 'pine' || kind === 'bamboo') {
      for (let i = 0; i < 2; i++) {
        const a = rand() * Math.PI * 2;
        const r = 0.7 + rand() * 1.6;
        addFern(tx + Math.cos(a) * r, tz + Math.sin(a) * r, 0.42 + rand() * 0.35);
      }
    }
  }

  /* ---- 3) 水岸：蕨类 + 苔藓 ---- */
  const shapes = L.WATER_SHAPES;
  for (const s of shapes) {
    const isMain = s.id === 'main-spring';
    const edgeCount = isMain ? 30 : s.kind === 'polyline' ? 22 : 10;
    const pts = waterEdgePoints(s, rand, edgeCount, 0.42);
    for (const p of pts) {
      // 苔藓紧贴水岸
      if (isFree(p.x, p.z, { ...loose, water: 0.12, path: 0.15, building: 0.3 })) {
        const sc = 0.5 + rand() * 0.9;
        moss.m.push(trs(p.x, 0.02, p.z, 0, rand() * Math.PI * 2, 0, sc, 1, sc * (0.7 + rand() * 0.4)));
        const l = 0.72 + rand() * 0.35;
        moss.c.push(new THREE.Color(l * 0.94, l, l * 0.8));
      }
      if (rand() < 0.5) addFern(p.x + (rand() - 0.5) * 0.8, p.z + (rand() - 0.5) * 0.8, 0.4 + rand() * 0.35);
      if (rand() < 0.35) addGrass(p.x + (rand() - 0.5) * 0.7, p.z + (rand() - 0.5) * 0.7, 0.4 + rand() * 0.3, 0.1);
    }
  }
  // 主泉池周边苔藓再多些
  for (let i = 0; i < 36; i++) {
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * (18.3 + rand() * 1.2);
    const z = Math.sin(a) * (13.3 + rand() * 1.0);
    if (isFree(x, z, { ...loose, water: 0.05, path: 0.1 })) {
      const sc = 0.4 + rand() * 0.8;
      moss.m.push(trs(x, 0.022, z, 0, rand() * Math.PI * 2, 0, sc, 1, sc));
      const l = 0.72 + rand() * 0.3;
      moss.c.push(new THREE.Color(l * 0.92, l, l * 0.8));
    }
  }

  /* ---- 4) 建筑周边灌木 ---- */
  for (const s of L.STRUCTURES) {
    if (s.type === 'compound') {
      // 院墙外一圈低矮灌木
      const [x0, z0, x1, z1] = s.rect;
      const per = 2 * ((x1 - x0) + (z1 - z0));
      const n = Math.round(per / 9);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const d = t * per;
        let x;
        let z;
        if (d < x1 - x0) {
          x = x0 + d;
          z = z0 - 1.4;
        } else if (d < (x1 - x0) + (z1 - z0)) {
          x = x1 + 1.4;
          z = z0 + (d - (x1 - x0));
        } else if (d < 2 * (x1 - x0) + (z1 - z0)) {
          x = x1 - (d - (x1 - x0) - (z1 - z0));
          z = z1 + 1.4;
        } else {
          x = x0 - 1.4;
          z = z1 - (d - 2 * (x1 - x0) - (z1 - z0));
        }
        if (rand() < 0.55) addShrub(x, z, 0.6 + rand() * 0.5);
      }
      continue;
    }
    if (!s.size) continue;
    if (s.type === 'corridor') {
      for (const dx of [-s.length / 2 - 1.2, s.length / 2 + 1.2]) addShrub(s.pos[0] + dx, s.pos[1] + 2.6, 0.7 + rand() * 0.6);
      continue;
    }
    if (s.type !== 'hall' && s.type !== 'gate' && s.type !== 'wing' && s.type !== 'tower' && s.type !== 'pavilion' && s.type !== 'hexpavilion') continue;
    const [w, d] = s.size;
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const rx = w / 2 + 1.1 + rand() * 1.4;
      const rz = d / 2 + 1.1 + rand() * 1.4;
      addShrub(s.pos[0] + Math.cos(a) * rx, s.pos[1] + Math.sin(a) * rz, 0.55 + rand() * 0.55);
    }
  }

  function addShrub(x, z, scale) {
    if (!isFree(x, z, { ...loose, building: 0.3, wall: 0.8 })) return;
    const s = scale * (0.75 + rand() * 0.5);
    shrubs.m.push(trs(x, 0, z, (rand() - 0.5) * 0.16, rand() * Math.PI * 2, (rand() - 0.5) * 0.16, s, s * (0.8 + rand() * 0.45), s));
    const l = 0.76 + rand() * 0.34;
    shrubs.c.push(new THREE.Color(l * 0.92, l, l * 0.82));
  }

  /* ---- 5) 石缝草：沿路缘 ---- */
  for (const path of L.PATHS) {
    const pts = samplePath(path, 3.2, path.width / 2 + 0.25, { phase: 1.7 });
    for (const p of pts) {
      if (rand() < 0.7) addGrass(p.x, p.z, 0.26 + rand() * 0.3, 0.35);
      if (rand() < 0.4) addGrass(p.x + (rand() - 0.5) * 1.2, p.z + (rand() - 0.5) * 1.2, 0.22 + rand() * 0.24, 0.4);
    }
  }

  /* ---- 6) 假山周边苔藓/蕨 ---- */
  const rockery = L.STRUCTURES.find((s) => s.type === 'rockery');
  if (rockery) {
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const r = 5 + rand() * 6;
      const x = rockery.pos[0] + Math.cos(a) * r;
      const z = rockery.pos[1] + Math.sin(a) * r * 0.8;
      const sc = 0.4 + rand() * 0.8;
      if (isFree(x, z, { ...loose, rocks: false })) {
        moss.m.push(trs(x, 0.02, z, 0, rand() * Math.PI * 2, 0, sc, 1, sc));
        const l = 0.7 + rand() * 0.3;
        moss.c.push(new THREE.Color(l * 0.93, l, l * 0.79));
      }
      addFern(rockery.pos[0] + Math.cos(a) * (2.5 + rand() * 3), rockery.pos[1] + Math.sin(a) * (2.2 + rand() * 2.4), 0.4 + rand() * 0.4);
    }
  }

  /* ---- 生成 InstancedMesh ---- */
  const mk = (name, geo, mat, set, castShadow) => {
    if (!set.m.length) return;
    const mesh = instanced(geo, mat, set.m, { colors: set.c, castShadow, name });
    mesh.receiveShadow = true;
    out.group.add(mesh);
  };
  mk('ground-grass', A.crossGeo, A.grassMat, grass, false);
  mk('ground-grass-dry', A.crossGeo, A.dryMat, dry, false);
  mk('ground-fern', A.crossGeo, A.fernMat, ferns, false);
  mk('ground-shrub', A.crossGeo, A.shrubMat, shrubs, true);
  mk('ground-moss', A.discGeo, A.mossMat, moss, false);

  out.stats = out.stats || {};
  out.stats.grassTufts = grass.m.length + dry.m.length;
  out.stats.ferns = ferns.m.length;
  out.stats.shrubs = shrubs.m.length;
  out.stats.moss = moss.m.length;
  out.geometries.push(A.crossGeo, A.planeGeo, A.discGeo);
  out.materials.push(A.grassMat, A.dryMat, A.fernMat, A.shrubMat, A.mossMat);
}

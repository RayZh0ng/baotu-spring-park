import * as THREE from 'three';
import { STRUCTURES } from '../layout.js';
import { makePlaqueTexture } from '../utils/labels.js';
import { mulberry32 } from '../utils/random.js';
import { Builder, Instancer, dougongGeometry, tileCapGeometry } from './arch/kit.js';
import { createMaterials } from './arch/materials.js';
import { buildHall, buildWing, buildGate, buildTower } from './arch/hall.js';
import { buildPavilion, buildHexPavilion, buildCorridor, buildPaifang } from './arch/pavilion.js';
import { buildPerimeterWalls, buildCompound } from './arch/wall.js';
import { buildArchBridge, buildSlabBridge, buildZigzagBridge } from './arch/bridges.js';
import { buildStele, buildDoubleStele, buildRockery, buildGuiStone } from './arch/stones.js';

/**
 * B 号模块入口：建筑与构筑物。
 * 所有坐标来自 layout.STRUCTURES / WALL_SEGMENTS / GATEWAYS；
 * 几何按材质合并（Builder），重复构件用 InstancedMesh。
 */
export function createBuildings(ctx) {
  const group = new THREE.Group();
  group.name = 'buildings';

  const B = new Builder();
  const mats = createMaterials(ctx.quality || 1);
  const colliders = [];
  const anchors = {
    eastGate: new THREE.Vector3(109, 0, 0),
    paifang: new THREE.Vector3(88, 0, 0),
    luoyuan: new THREE.Vector3(0, 0, -25),
    guanlan: new THREE.Vector3(-24, 0, 0),
    lotus: new THREE.Vector3(18, 0, 62),
    baixue: new THREE.Vector3(-58, 0, 52),
  };
  const rng = mulberry32(20241019);

  const capInst = new Instancer(tileCapGeometry(), mats.materials.tileCap.mat);
  const dougongInst = new Instancer(dougongGeometry(), mats.materials.beamPaint.mat);

  const site = {
    B,
    mats,
    colliders,
    rng,
    capInst,
    dougongInst,
    makePlaqueTexture,
    addBox(x, z, hx, hz, tag = 'solid') {
      colliders.push({ type: 'box', x, z, hx, hz, rot: 0, tag });
    },
    addCircle(x, z, r, tag = 'solid') {
      colliders.push({ type: 'circle', x, z, r, tag });
    },
  };

  const built = { gates: 0, halls: 0, pavilions: 0, compounds: 0, bridges: 0, steles: 0 };

  for (const s of STRUCTURES) {
    switch (s.type) {
      case 'hall':
        buildHall(site, s, s.id === 'luoyuan-hall'
          ? { roofMat: 'tileA', couplets: ['云雾润蒸华不注', '波涛声震大明湖'], eaveOverX: 1.25, eaveOverZ: 1.45 }
          : { roofMat: 'tileB', wallMat: 'plasterWarm', eaveOverX: 1.2, eaveOverZ: 1.4, porch: 2.1 });
        built.halls++;
        break;
      case 'wing':
        buildWing(site, s);
        break;
      case 'gate':
        buildGate(site, s);
        built.gates++;
        break;
      case 'tower':
        buildTower(site, s);
        built.halls++;
        break;
      case 'pavilion':
        buildPavilion(site, s, s.id === 'guanlan-pavilion'
          ? { platform: [8, 8], roofMat: 'tileB', sideSteps: true, nX: 2 }
          : { platform: [10, 9], roofMat: 'tileA', rectRoof: true, nX: 3 });
        built.pavilions++;
        break;
      case 'hexpavilion':
        buildHexPavilion(site, s);
        built.pavilions++;
        break;
      case 'corridor':
        buildCorridor(site, s);
        break;
      case 'paifang':
        buildPaifang(site, s);
        break;
      case 'compound':
        buildCompound(site, s);
        built.compounds++;
        break;
      case 'archbridge':
        buildArchBridge(site, s);
        built.bridges++;
        break;
      case 'slabbridge':
        buildSlabBridge(site, s);
        built.bridges++;
        break;
      case 'zigzagbridge':
        buildZigzagBridge(site, s);
        built.bridges++;
        break;
      case 'stele':
        buildStele(site, s);
        built.steles++;
        break;
      case 'steles':
        buildDoubleStele(site, s);
        built.steles++;
        break;
      case 'rockery':
        buildRockery(site, s);
        break;
      case 'rock':
        buildGuiStone(site, s);
        break;
      default:
        break;
    }
  }

  // 公园围墙（含三门缺口）
  buildPerimeterWalls(site);

  const meshCount = B.finish(group, mats.materials);
  capInst.build(group, 'arch-tile-caps', { receive: false });
  dougongInst.build(group, 'arch-dougong', { receive: false });

  return {
    object: group,
    colliders,
    anchors,
    stats: { meshes: meshCount, colliders: colliders.length, ...built },
    update(dt, env) {
      mats.update(dt, env);
    },
    dispose() {
      group.traverse((o) => {
        if (o.isMesh || o.isInstancedMesh) {
          if (o.geometry) o.geometry.dispose();
        }
      });
      mats.dispose();
      group.removeFromParent();
    },
  };
}

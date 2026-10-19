import * as THREE from 'three';
import { buildWillowGrove } from './plants/willow.js';
import { buildBambooGrove } from './plants/bamboo.js';
import { buildPineGrove } from './plants/pine.js';
import { buildFlowerTrees } from './plants/blossom.js';
import { buildGroundCover } from './plants/ground.js';
import { buildAquatic } from './plants/aquatic.js';
import { updateVegetationEnv } from './plants/wind.js';
import { disposeTextures } from './plants/textures.js';

/**
 * 植被总装（C 号负责人）。
 * 分区全部来自 layout.PLANTING_ZONES / AQUATIC_ZONES，确定性随机（mulberry32）。
 * 全部使用 InstancedMesh / 合并几何 + 共享材质，本模块 draw call 目标 < 40。
 */
export function createVegetation(ctx) {
  const group = new THREE.Group();
  group.name = 'vegetation-root';

  const out = {
    ctx,
    group,
    colliders: [],
    anchors: {},
    stats: {},
    treeSpots: [],
    snowOverlays: [],
    geometries: [],
    materials: [],
  };

  /* ---- 分区生成 ---- */
  buildWillowGrove(ctx, out);
  buildBambooGrove(ctx, out);
  buildPineGrove(ctx, out);
  buildFlowerTrees(ctx, out, 'blossom');
  buildFlowerTrees(ctx, out, 'maple');
  buildGroundCover(ctx, out);
  buildAquatic(ctx, out);

  /* ---- anchors（供特效/导览使用） ---- */
  const L = ctx.layout;
  out.anchors.willowPool = new THREE.Vector3(0, 3, 18);
  out.anchors.bambooGarden = new THREE.Vector3(L.LANDMARKS.wanzhu.x, 4, L.LANDMARKS.wanzhu.z);
  out.anchors.lotusPond = new THREE.Vector3(L.LANDMARKS.lotusPond.x, 0.3, L.LANDMARKS.lotusPond.z);
  out.anchors.blossomCourt = new THREE.Vector3(60, 2.6, 31);
  out.anchors.mainSpring = new THREE.Vector3(0, 1.5, 0);

  let overlayOpacity = -1;
  function update(dt, env) {
    updateVegetationEnv(dt, env);
    // 雪覆盖层（松/竹）淡入淡出
    const target = env.snow;
    if (Math.abs(target - overlayOpacity) > 0.002) {
      overlayOpacity = target;
      for (let i = 0; i < out.snowOverlays.length; i++) {
        const o = out.snowOverlays[i];
        o.mat.opacity = target * o.factor;
      }
    }
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
    disposeTextures();
    group.removeFromParent();
  }

  return {
    object: group,
    colliders: out.colliders,
    anchors: out.anchors,
    update,
    dispose,
    stats: out.stats,
  };
}

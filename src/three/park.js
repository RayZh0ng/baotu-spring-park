import * as THREE from 'three';
import { createTerrain } from './world/terrain.js';
import { createWater } from './world/water.js';
import { createBuildings } from './world/buildings.js';
import { createVegetation } from './world/vegetation.js';
import { createProps } from './world/props.js';
import { createOuterWorld } from './world/outer.js';

/**
 * 场景合成器：把各 world 模块组装成一座公园。
 * 每个模块返回 { object, colliders?, anchors?, update?, dispose? }。
 */
export function createPark(ctx) {
  const group = new THREE.Group();
  group.name = 'park';

  const modules = [];
  const colliders = [];
  const anchors = {};
  const byName = {};

  const factories = [
    ['terrain', createTerrain],
    ['water', createWater],
    ['buildings', createBuildings],
    ['vegetation', createVegetation],
    ['props', createProps],
    ['outer', createOuterWorld],
  ];

  for (const [name, factory] of factories) {
    let mod;
    try {
      mod = factory(ctx);
    } catch (err) {
      // 单个模块异常不应拖垮整座公园（也便于并行开发时其它模块自检）
      console.error(`[park] module "${name}" failed to build:`, err);
      continue;
    }
    if (!mod || !mod.object) {
      console.warn(`[park] module "${name}" returned no object`);
      continue;
    }
    mod.object.name = name;
    modules.push(mod);
    byName[name] = mod;
    group.add(mod.object);
    if (mod.colliders) colliders.push(...mod.colliders);
    if (mod.anchors) {
      for (const key of Object.keys(mod.anchors)) anchors[key] = mod.anchors[key];
    }
  }

  return {
    object: group,
    colliders,
    anchors,
    modules,
    /** 按模块名取回模块实例（如 water / terrain / buildings） */
    get(name) {
      return byName[name];
    },
    get water() {
      return byName.water;
    },
    update(dt, env) {
      for (let i = 0; i < modules.length; i++) {
        const m = modules[i];
        if (!m.update) continue;
        try {
          m.update(dt, env);
        } catch (err) {
          // 运行期异常：停用该模块并汇报一次，避免每帧刷屏
          m.update = null;
          console.error(`[park] module "${m.object.name}" update failed:`, err);
        }
      }
    },
    dispose() {
      for (const m of modules) {
        if (m.dispose) m.dispose();
      }
      group.removeFromParent();
    },
  };
}

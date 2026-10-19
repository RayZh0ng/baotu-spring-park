import * as THREE from 'three';
import { createEnv } from './core/env.js';
import { createEngine } from './engine.js';
import { createPark } from './park.js';
import { createSky } from './world/sky.js';
import { createPlanarReflection } from './systems/reflection.js';
import { createSkyIBL } from './systems/ibl.js';
import { createParticles } from './systems/particles.js';
import { createWeather } from './systems/weather.js';
import { createWalker } from './controls/walker.js';
import { createTour } from './controls/tour.js';
import { LAYOUT, WATER_LEVEL, SPAWN, heightAt } from './layout.js';
import { POIS, POI_MAP, TOUR_POIS } from '../data/pois.js';
import { WEATHER_PRESETS, DEFAULT_WEATHER } from '../data/weather.js';

/**
 * 体验编排器：引擎 + 天气 + 公园 + 行走/导览 + UI 事件。
 * Lead 拥有此文件；模块内部实现由各模块负责人负责。
 */
export function createExperience({ canvas, onEvent = () => {} }) {
  const params = new URLSearchParams(window.location.search);
  const mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;
  const qualityParam = params.get('quality');
  const quality = qualityParam === 'low' ? 0.72 : qualityParam === 'high' ? 1 : mobile ? 0.85 : 1;

  const emit = (payload) => {
    try {
      onEvent(payload);
    } catch (err) {
      console.warn('[experience] onEvent error', err);
    }
  };

  // 特效开关（?fx=0 全部关闭 / ?fx=refl,ibl,post 单独调试）
  const fx = params.get('fx');
  const fxDisabled = fx === '0';
  const fxOnly = fx && fx !== '0' ? fx.split(',') : null;
  const fxOn = (name) => (fxOnly ? fxOnly.includes(name) : true) && !fxDisabled;

  const engine = createEngine({ canvas, mobile, quality });
  engine.setQuality(quality);
  if (!fxOn('post')) engine.setPostEnabled(false);

  const env = createEnv();
  env.quality = quality;

  const focus = new THREE.Vector3(SPAWN.x, 1.6, SPAWN.z);

  /* ---- 天气 / 天空 / 粒子 ---- */
  const sky = createSky({
    scene: engine.scene,
    env,
    quality,
    mobile,
    getFocus: () => focus,
  });
  engine.scene.add(sky.object);

  const particles = createParticles({
    scene: engine.scene,
    env,
    camera: engine.camera,
    quality,
    mobile,
  });
  if (particles.object) {
    engine.scene.add(particles.object);
    // 粒子不参与水面反射（省一次 pass 的 draw call）
    particles.object.traverse((o) => o.layers.enable(3));
  }

  const weather = createWeather({
    env,
    sky,
    particles,
    renderer: engine.renderer,
    scene: engine.scene,
    mobile,
  });

  /* ---- 公园 ---- */
  const ctx = {
    env,
    layout: LAYOUT,
    heightAt,
    waterLevel: WATER_LEVEL,
    quality,
    mobile,
  };
  const park = createPark(ctx);
  engine.scene.add(park.object);

  /* ---- 平面反射（水面倒影） ---- */
  const reflection = fxOn('refl') ? createPlanarReflection({
    renderer: engine.renderer,
    scene: engine.scene,
    waterLevel: WATER_LEVEL,
    quality,
    mobile,
  }) : null;
  if (reflection && park.water && park.water.bindReflection) {
    park.water.bindReflection(reflection);
  }

  /* ---- 天空 IBL（环境光照/反射层次） ---- */
  const ibl = fxOn('ibl') ? createSkyIBL({ renderer: engine.renderer, skyObject: sky.object, env }) : null;

  /* ---- 控制 ---- */
  const walker = createWalker({
    camera: engine.camera,
    domElement: canvas,
    colliders: park.colliders,
    heightAt,
    spawn: SPAWN,
    waterLevel: WATER_LEVEL,
    getEnv: () => env,
    mobile,
  });

  let lastPoi = TOUR_POIS[0];
  const tour = createTour({
    camera: engine.camera,
    pois: TOUR_POIS,
    heightAt,
    onPoiChange: (poi) => {
      lastPoi = poi;
      emit({ type: 'poi', poi });
    },
  });

  let mode = 'walk';
  let tourPaused = false;
  let ready = false;
  let disposed = false;
  let raf = 0;
  let lastTime = performance.now();
  let frameIndex = 0;
  let fps = 60;
  let fpsSmooth = 60;
  let statsTimer = 0;
  let nearbyTimer = 0;
  let nearbyId = null;

  const camOverride = parseVec3(params.get('cam'));
  const lookOverride = parseVec3(params.get('look'));
  const noUI = params.get('ui') === '0';

  const playerState = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, mode: 'walk' };

  /* ---- 初始化状态 ---- */
  const initialWeather = params.get('weather');
  weather.setPreset(WEATHER_PRESETS[initialWeather] ? initialWeather : DEFAULT_WEATHER, {
    instant: true,
  });

  const initialT = parseFloat(params.get('t'));
  if (Number.isFinite(initialT)) env.time = initialT;

  const initialPoi = params.get('poi');
  if (initialPoi && POI_MAP[initialPoi]) {
    teleportToPoi(initialPoi, { silent: true });
  } else {
    walker.teleport(SPAWN.x, SPAWN.z, SPAWN.yaw);
  }

  if (params.get('mode') === 'tour') {
    setMode('tour', { poiId: initialPoi });
  }

  /* ---- 工具函数 ---- */
  function yawToward(from, to) {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    return Math.atan2(-dx, -dz);
  }

  function parseVec3(str) {
    if (!str) return null;
    const arr = str.split(',').map(Number);
    if (arr.length !== 3 || arr.some((n) => !Number.isFinite(n))) return null;
    return arr;
  }

  function teleportToPoi(id, { silent = false } = {}) {
    const poi = POI_MAP[id];
    if (!poi) return;
    if (mode === 'tour') {
      tour.goTo(id);
      return;
    }
    const yaw = yawToward(poi.pos, poi.faceTo);
    walker.teleport(poi.pos[0], poi.pos[1], yaw);
    lastPoi = poi;
    emit({ type: 'poi', poi });
    if (!silent) emit({ type: 'teleport', poi });
  }

  function setMode(next, opts = {}) {
    if (next === mode) {
      if (next === 'tour' && opts.poiId) tour.goTo(opts.poiId);
      return;
    }
    if (next === 'tour') {
      walker.setEnabled(false);
      const idx = opts.poiId ? Math.max(0, TOUR_POIS.findIndex((p) => p.id === opts.poiId)) : 0;
      tour.start(idx);
      tourPaused = false;
      tour.setPaused(false);
    } else {
      tour.stop();
      walker.setEnabled(true);
      const poi = lastPoi || TOUR_POIS[0];
      const yaw = yawToward(poi.pos, poi.faceTo);
      walker.teleport(poi.pos[0], poi.pos[1], yaw);
      emit({ type: 'poi', poi });
    }
    mode = next;
    playerState.mode = mode;
    emit({ type: 'mode', mode });
  }

  function setWeather(id) {
    if (!WEATHER_PRESETS[id]) return;
    weather.setPreset(id);
    emit({ type: 'weather', id });
  }

  function nextWeather() {
    weather.next();
    emit({ type: 'weather', id: weather.currentId });
  }

  function setTourPaused(value) {
    tourPaused = Boolean(value);
    tour.setPaused(tourPaused);
    emit({ type: 'tourPause', paused: tourPaused });
  }

  function toggleTourPaused() {
    setTourPaused(!tourPaused);
  }

  /* ---- 模拟（与渲染解耦，便于 QA 快进） ---- */
  function simulate(dt) {
    env.dt = dt;
    env.time += dt;

    weather.update(dt, env);
    park.update(dt, env);
    if (particles.update) particles.update(dt, env);
    if (sky.update) sky.update(dt, env);

    if (mode === 'tour') {
      tour.update(dt, env);
    } else if (!camOverride) {
      walker.update(dt, env);
    }

    if (camOverride) {
      engine.camera.position.set(camOverride[0], camOverride[1], camOverride[2]);
      if (lookOverride) {
        engine.camera.lookAt(lookOverride[0], lookOverride[1], lookOverride[2]);
      }
      focus.set(camOverride[0], Math.max(0.4, camOverride[1] * 0.5), camOverride[2]);
    } else if (mode === 'tour') {
      focus.copy(engine.camera.position);
    } else {
      const p = walker.getPosition();
      focus.set(p.x, p.y - 1.0, p.z);
      playerState.x = p.x;
      playerState.z = p.z;
      playerState.yaw = walker.getYaw();
    }
    env.focus.copy(focus);
    engine.renderer.toneMappingExposure = env.exposure;

    /* 反射 / IBL / 后处理（每帧或节流） */
    if (reflection && reflection.enabled) {
      // 相机矩阵必须先更新，否则反射矩阵用的是上一帧朝向
      engine.camera.updateMatrixWorld();
      // 阴影贴图先更新：反射 pass 会复用这一份阴影（autoUpdate=false），
      // 若顺序反了，主渲染会用到反射 pass 期间的旧阴影
      engine.renderer.shadowMap.needsUpdate = true;
      reflection.update(engine.camera);
    }
    if (ibl && ibl.enabled) {
      ibl.update(dt, env);
      if (ibl.environment && engine.scene.environment !== ibl.environment) {
        engine.scene.environment = ibl.environment;
      }
      // IBL 只做"环境补光"，不能盖过主光与阴影：按天气压到合适强度
      const envInt = 0.10 * (1 - env.night * 0.5) * (1 - env.rain * 0.3);
      engine.scene.environmentIntensity = envInt;
    }
    if (fxOn('post')) engine.updatePost(env);

    /* 近距离景点提示（自由漫游） */
    nearbyTimer += dt;
    if (nearbyTimer > 0.35) {
      nearbyTimer = 0;
      if (mode === 'walk' && !camOverride) {
        let best = null;
        let bestD = 13;
        const p = walker.getPosition();
        for (const poi of POIS) {
          const d = Math.hypot(poi.pos[0] - p.x, poi.pos[1] - p.z);
          if (d < bestD) {
            bestD = d;
            best = poi;
          }
        }
        const id = best ? best.id : null;
        if (id !== nearbyId) {
          nearbyId = id;
          emit({ type: 'nearby', poi: best });
        }
      }
    }
  }

  /* ---- 主循环 ---- */
  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);

    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(0.05, Math.max(0.0005, rawDt || 0.016));
    frameIndex++;

    simulate(dt);

    engine.beginFrame();
    engine.render();

    /* 帧率统计 + 自适应分辨率 */
    fpsSmooth = fpsSmooth * 0.95 + (1 / dt) * 0.05;
    fps = fpsSmooth;
    engine.adapt(dt, fps);

    if (!ready) {
      ready = true;
      window.__PARK_READY__ = true;
      emit({
        type: 'ready',
        weather: weather.currentId,
        mode,
        mobile,
        poi: lastPoi,
        stats: getStats(),
      });
    }
  }

  /** QA/截图用：以固定步长快进模拟（不受 headless 帧率限制） */
  function stepSim(seconds = 1, stepDt = 1 / 60) {
    const steps = Math.max(1, Math.min(3600, Math.ceil(seconds / stepDt)));
    for (let i = 0; i < steps; i++) simulate(stepDt);
    engine.beginFrame();
    engine.render();
    return getStats();
  }

  function getStats() {
    const info = engine.renderer.info;
    return {
      fps: Math.round(fps),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      dpr: engine.dpr,
      colliders: park.colliders.length,
    };
  }

  /* ---- 对外 API（UI + QA） ---- */
  const api = {
    get ready() {
      return ready;
    },
    env,
    engine,
    park,
    reflection,
    ibl,
    weather,
    walker,
    tour,
    layout: LAYOUT,
    pois: POIS,
    noUI,
    player: playerState,
    setWeather,
    nextWeather,
    prevWeather() {
      weather.prev();
      emit({ type: 'weather', id: weather.currentId });
    },
    setMode,
    teleportToPoi,
    nextPoi() {
      tour.next();
    },
    prevPoi() {
      tour.prev();
    },
    setTourPaused,
    toggleTourPaused,
    getStats,
    step(seconds = 1, stepDt = 1 / 60) {
      return stepSim(seconds, stepDt);
    },
    setCameraOverride(cam, look) {
      if (cam) {
        camOverride[0] = cam[0];
        camOverride[1] = cam[1];
        camOverride[2] = cam[2];
      }
      if (look) {
        lookOverride[0] = look[0];
        lookOverride[1] = look[1];
        lookOverride[2] = look[2];
      }
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      walker.dispose();
      if (tour.stop) tour.stop();
      if (sky.dispose) sky.dispose();
      if (reflection) reflection.dispose();
      if (ibl) ibl.dispose();
      if (particles.dispose) particles.dispose();
      if (park.dispose) park.dispose();
      engine.dispose();
      if (window.__park === api) delete window.__park;
    },
  };

  window.__park = api;

  raf = requestAnimationFrame(frame);

  return api;
}

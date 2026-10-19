import * as THREE from 'three';
import { WEATHER_PRESETS, WEATHER_ORDER, DEFAULT_WEATHER } from '../../data/weather.js';
import { mulberry32 } from '../utils/random.js';

/**
 * 天气系统（D 号模块）
 * ------------------------------------------------------------
 * 职责：
 *   1. 读取 src/data/weather.js 的预设，在 ~2.2s 内把 env 中所有目标字段平滑插值到目标值；
 *      切换中再次切换会以「当前 env 值」为新起点续接，不会跳变。
 *   2. 雷雨天的闪电调度：随机 3~7s 一次，双闪/多闪，写入 env.lightning（快速衰减）。
 *   3. 天气系统是 env 的唯一写入者；sky.js / particles.js 等只读 env。
 *
 * 设计要点：
 *   - 所有插值状态在初始化时一次性分配，update 内零对象分配。
 *   - 颜色插值在 THREE.Color 工作空间（linear-srgb）中进行，完成时精确 snap 到目标值。
 *   - env.sunDir 为归一化向量，插值后重新归一化，避免过渡中变长。
 *   - env.lightning 不参与预设插值，由闪电状态机每帧写入。
 */

const TRANSITION_SECONDS = 2.2;
const STRIKE_MIN_GAP = 3.0;
const STRIKE_MAX_GAP = 7.0;

const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** 从预设目标值构建插值描述表（一次性） */
function buildAnimators(env) {
  const sampleTargets = WEATHER_PRESETS[DEFAULT_WEATHER].targets;
  const animators = [];
  for (const key of Object.keys(sampleTargets)) {
    // 闪电是运行时动态量，不参与预设插值
    if (key === 'lightning') continue;
    const value = sampleTargets[key];
    if (Array.isArray(value)) {
      animators.push({
        key,
        kind: 'dir',
        fromV: new THREE.Vector3(),
        toV: new THREE.Vector3(),
      });
    } else if (env[key] && env[key].isColor) {
      animators.push({
        key,
        kind: 'color',
        fromC: new THREE.Color(),
        toC: new THREE.Color(),
      });
    } else {
      animators.push({ key, kind: 'number', from: 0, to: 0 });
    }
  }
  return animators;
}

export function createWeather({ env, sky, particles, renderer, scene, mobile }) {
  const animators = buildAnimators(env);
  const presetIds = Object.keys(WEATHER_PRESETS);

  let currentId = DEFAULT_WEATHER;
  let elapsed = 0;
  let duration = TRANSITION_SECONDS;
  let progress = 1;
  let baseExposure = env.exposure;

  /* ---- 闪电状态（确定性随机，便于 QA 复现） ---- */
  const rand = mulberry32(0x5eed1e);
  let strikeClock = 0;
  let strikeTimer = Infinity;
  let flash = 0;
  const pulses = []; // { at:number, value:number }，复用数组，不每帧分配

  /* ---- 预设目标（从 data/weather.js 读取，唯一数据源） ---- */
  function applyTargets(id) {
    const preset = WEATHER_PRESETS[id];
    const targets = preset.targets;
    for (let i = 0; i < animators.length; i++) {
      const a = animators[i];
      const target = targets[a.key];
      if (a.kind === 'number') {
        a.from = env[a.key];
        a.to = target;
      } else if (a.kind === 'color') {
        a.fromC.copy(env[a.key]);
        a.toC.setHex(target);
      } else {
        a.fromV.copy(env.sunDir);
        a.toV.set(target[0], target[1], target[2]).normalize();
      }
    }
    // env.exposure 此刻可能带着上一帧的闪电脉冲，去掉它再作为基线
    baseExposure = env.exposure - flash * 0.26;
  }

  function snapToTargets() {
    for (let i = 0; i < animators.length; i++) {
      const a = animators[i];
      if (a.kind === 'number') env[a.key] = a.to;
      else if (a.kind === 'color') env[a.key].copy(a.toC);
      else env.sunDir.copy(a.toV);
    }
    baseExposure = env.exposure;
    progress = 1;
    elapsed = 0;
  }

  function scheduleStrike() {
    const r = rand;
    const t0 = strikeClock;
    // 主闪 + 回击（双闪/多闪更真实）
    pulses.push({ at: t0, value: 0.82 + r() * 0.18 });
    pulses.push({ at: t0 + 0.055 + r() * 0.05, value: 0.3 + r() * 0.35 });
    if (r() > 0.42) pulses.push({ at: t0 + 0.15 + r() * 0.08, value: 0.65 + r() * 0.35 });
    if (r() > 0.78) pulses.push({ at: t0 + 0.36 + r() * 0.22, value: 0.45 + r() * 0.4 });
    strikeTimer = STRIKE_MIN_GAP + r() * (STRIKE_MAX_GAP - STRIKE_MIN_GAP);
  }

  function resetLightningState(id) {
    flash = 0;
    pulses.length = 0;
    env.lightning = 0;
    if (id === 'storm') {
      strikeTimer = 1.4 + rand() * 2.2;
    } else {
      strikeTimer = Infinity;
    }
  }

  /**
   * 切换天气。
   * @param {string} id 预设 id
   * @param {{instant?: boolean}} opts instant=true 直接到位（初始化用）
   */
  function setPreset(id, { instant = false } = {}) {
    if (!WEATHER_PRESETS[id]) {
      console.warn(`[weather] unknown preset: ${id}`);
      return;
    }
    currentId = id;
    applyTargets(id);
    elapsed = 0;
    duration = TRANSITION_SECONDS;
    progress = instant ? 1 : 0;
    if (instant) snapToTargets();
    resetLightningState(id);
  }

  /* ---- 过渡插值 ---- */
  function advanceTransition(dt) {
    if (progress >= 1) return;
    elapsed += dt;
    const raw = Math.min(1, elapsed / duration);
    progress = raw;
    if (raw >= 1) {
      snapToTargets();
      return;
    }
    const t = easeInOutCubic(raw);
    for (let i = 0; i < animators.length; i++) {
      const a = animators[i];
      if (a.kind === 'number') {
        env[a.key] = a.from + (a.to - a.from) * t;
      } else if (a.kind === 'color') {
        env[a.key].copy(a.fromC).lerp(a.toC, t);
      } else {
        env.sunDir.lerpVectors(a.fromV, a.toV, t).normalize();
      }
    }
    // 记录当前插值出来的曝光基线（闪电脉冲在 advanceLightning 里叠加）
    baseExposure = env.exposure;
  }

  /* ---- 闪电 ---- */
  function advanceLightning(dt) {
    strikeClock += dt;
    if (currentId === 'storm') {
      strikeTimer -= dt;
      if (strikeTimer <= 0) scheduleStrike();
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      if (strikeClock >= pulses[i].at) {
        if (pulses[i].value > flash) flash = pulses[i].value;
        pulses.splice(i, 1);
      }
    }
    // 快速衰减（指数）+ 轻微曳尾
    flash *= Math.exp(-dt * 6.2);
    if (flash < 0.002) flash = 0;
    env.lightning = flash;
    // 屏幕曝光轻微脉冲（experience 每帧把 env.exposure 写入 toneMappingExposure）
    env.exposure = baseExposure + flash * 0.26;
  }

  function update(dt, e) {
    const d = Number.isFinite(dt) ? Math.min(0.05, Math.max(0, dt)) : 0;
    advanceTransition(d);
    advanceLightning(d);
    void e;
  }

  function next() {
    const i = WEATHER_ORDER.indexOf(currentId);
    setPreset(WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length]);
  }

  function prev() {
    const i = WEATHER_ORDER.indexOf(currentId);
    setPreset(WEATHER_ORDER[(i - 1 + WEATHER_ORDER.length) % WEATHER_ORDER.length]);
  }

  // 初始化：直接对齐默认预设（env 默认值即 sunny，但颜色/时间等统一走一遍）
  setPreset(DEFAULT_WEATHER, { instant: true });

  return {
    presets: WEATHER_PRESETS,
    get currentId() {
      return currentId;
    },
    get transition() {
      return progress;
    },
    setPreset,
    next,
    prev,
    update,
    /** QA 用：立即触发一次闪电（不改变当前天气） */
    triggerLightning() {
      if (currentId !== 'storm') {
        // 非雷雨天气也可以临时闪光，方便调试试听
        strikeClock = strikeClock;
      }
      scheduleStrike();
      flash = 1;
      env.lightning = 1;
    },
    /** QA 用：读取内部闪电状态（不暴露可变引用） */
    getLightningState() {
      return { flash, strikeTimer, queued: pulses.length };
    },
  };
}

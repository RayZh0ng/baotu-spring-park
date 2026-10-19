import * as THREE from 'three';
import { TOUR_POIS } from '../../data/pois.js';
import { heightAt as layoutHeightAt, STRUCTURES } from '../layout.js';
import { createArcSpline, clamp, easeInOutCubic, easeInOutSine, damp } from './spline.js';

/**
 * 自动导览控制器（E 号 · 电影级航拍游园）
 * ------------------------------------------------------------
 *  - 按 TOUR_POIS 顺序（16 站）做 drone 式运镜：
 *      站间 = "起点 → 抬升弧顶 → 终点"三次贝塞尔航拍路径（easeInOutCubic，4.5~6.5s）
 *      到站 = 停在 poi.cam、看向 poi.look，hold 秒（微幅呼吸/漂移），触发 onPoiChange
 *  - 弧顶抬升 clamp(dist*0.34, 8, 26)m，尽量越过建筑与树冠，泉池上方不贴水飞行
 *  - look 目标阻尼跟随，不瞬间转向；lookAt + 世界上向量，无滚转
 *  - next/prev/goTo 立即开始新段（更快的航拍过渡）；start 从当前镜头缓入
 *  - update 内不分配新对象（路径对象、向量均复用）
 *
 * 设计说明：布局数据中若某站机位落在实心建筑体积内（如 eying-shrine 的 cam 在泺源堂内），
 * 为避免镜头穿建筑，本模块会在构建时把该站机位抬到屋顶之上（不改 layout/data）。
 */

const HOLD_FOV = 56; // 停留时略收窄，更"电影"
const TRAVEL_FOV = 62; // 飞行时略广，更有速度感
const FOV_RATE = 2.2;
const LOOK_RATE_TRAVEL = 2.9;
const LOOK_RATE_HOLD = 2.1;
const GROUND_CLEARANCE = 2.0; // 相机最低离地
const MIN_APEX_RAISE = 8;
const MAX_APEX_RAISE = 26;
const APEX_FACTOR = 0.34;
const STATION_CLEARANCE = 2.4; // 机位若在建筑体内，抬到屋顶 + 该余量

const SOLID_WALL_TYPES = new Set(['hall', 'gate', 'tower', 'wing']);

function structureTopAt(s, x, z) {
  if (!s || !s.size || !SOLID_WALL_TYPES.has(s.type)) return 0;
  const [w, d] = s.size;
  const rot = s.rotY || 0;
  const c = Math.cos(-rot);
  const sn = Math.sin(-rot);
  const dx = x - s.pos[0];
  const dz = z - s.pos[1];
  const lx = dx * c - dz * sn;
  const lz = dx * sn + dz * c;
  if (Math.abs(lx) > w * 0.5 + 0.4 || Math.abs(lz) > d * 0.5 + 0.4) return 0;
  return (s.base || 0) + (s.height || 7) + STATION_CLEARANCE;
}

/** 若机位落在实心建筑体内部，沿"背离建筑中心"方向水平推出，而不是抬到屋顶（保留构图） */
function pushOutOfStructures(pos) {
  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (let k = 0; k < STRUCTURES.length; k++) {
      const s = STRUCTURES[k];
      if (!s || !s.size || !SOLID_WALL_TYPES.has(s.type)) continue;
      const [w, d] = s.size;
      const rot = s.rotY || 0;
      const c = Math.cos(-rot);
      const sn = Math.sin(-rot);
      const dx = pos.x - s.pos[0];
      const dz = pos.z - s.pos[1];
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      const ex = w * 0.5 + 1.2;
      const ez = d * 0.5 + 1.2;
      if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
        // 选择最小推出量的一侧
        const px = ex - Math.abs(lx);
        const pz = ez - Math.abs(lz);
        let nlx = lx;
        let nlz = lz;
        if (px < pz) nlx = lx < 0 ? -ex : ex;
        else nlz = lz < 0 ? -ez : ez;
        const cos2 = Math.cos(rot);
        const sin2 = Math.sin(rot);
        pos.x = s.pos[0] + nlx * cos2 - nlz * sin2;
        pos.z = s.pos[1] + nlx * sin2 + nlz * cos2;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function buildStations(pois, hAt) {
  const stations = [];
  for (let i = 0; i < pois.length; i++) {
    const poi = pois[i];
    const c = Array.isArray(poi.cam) ? poi.cam : [0, 4, 0];
    const l = Array.isArray(poi.look) ? poi.look : [0, 1, 0];
    const pos = new THREE.Vector3(c[0], c[1], c[2]);
    // 离地净空
    const minY = hAt(pos.x, pos.z) + GROUND_CLEARANCE;
    if (pos.y < minY) pos.y = minY;
    // 若机位落在实心建筑内，水平推出到建筑外（保留原本的视线高度与构图）
    pushOutOfStructures(pos);
    stations.push({
      poi,
      pos,
      look: new THREE.Vector3(l[0], l[1], l[2]),
      hold: Math.max(1.2, Number.isFinite(poi.hold) ? poi.hold : 4.5),
    });
  }
  return stations;
}

export function createTour({ camera, pois = TOUR_POIS, heightAt, onPoiChange }) {
  const hAt = typeof heightAt === 'function' ? heightAt : layoutHeightAt;
  const list = Array.isArray(pois) && pois.length ? pois : TOUR_POIS;
  const stations = buildStations(list, hAt);
  const count = stations.length;

  /* ---- 复用对象（update 内零分配） ---- */
  const arc = createArcSpline();
  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _lookFrom = new THREE.Vector3();
  const _lookTo = new THREE.Vector3();
  const _lookTarget = new THREE.Vector3();
  const _lookCurrent = new THREE.Vector3();
  camera.getWorldDirection(_dir);
  _lookCurrent.copy(camera.position).addScaledVector(_dir, 18);

  /* ---- 状态 ---- */
  let active = false;
  let paused = false;
  let index = 0; // 目标/当前站序
  let phase = 'travel'; // travel | hold
  let t = 0; // 当前阶段已进行时间
  let duration = 1; // 当前段运镜时长
  let idleClock = 0; // 停留呼吸时钟（暂停时也缓慢走）
  let notified = false; // 本段是否已对 UI 通知过目标景点
  let fovApplied = camera.fov;

  function wrap(i) {
    return ((i % count) + count) % count;
  }

  function emit(poi) {
    if (typeof onPoiChange !== 'function') return;
    try {
      onPoiChange(poi);
    } catch (err) {
      console.warn('[tour] onPoiChange error', err);
    }
  }

  function setFov(target, dt) {
    camera.fov += (target - camera.fov) * damp(FOV_RATE, dt);
    if (Math.abs(camera.fov - fovApplied) > 0.02) {
      fovApplied = camera.fov;
      camera.updateProjectionMatrix();
    }
  }

  function durationFor(kind, dist) {
    if (kind === 'auto') return clamp(3.9 + dist * 0.06, 4.5, 6.5);
    if (kind === 'start') return clamp(1.8 + dist * 0.05, 2.0, 6.5);
    return clamp(0.9 + dist * 0.025, 1.1, 2.6); // 命令切站：快速航拍过渡
  }

  /** 开始飞往 targetIndex（kind: start | auto | command） */
  function beginTravel(targetIndex, kind) {
    const s = stations[wrap(targetIndex)];
    index = wrap(targetIndex);
    phase = 'travel';
    t = 0;
    idleClock = 0;
    notified = false;

    _from.copy(camera.position);
    camera.getWorldDirection(_dir);
    _lookFrom.copy(camera.position).addScaledVector(_dir, 18);
    _lookTo.copy(s.look);
    if (kind === 'start') _lookCurrent.copy(_lookFrom);

    const dist = Math.hypot(s.pos.x - _from.x, s.pos.z - _from.z);
    const raise = clamp(dist * APEX_FACTOR, MIN_APEX_RAISE, MAX_APEX_RAISE);
    const apex = Math.max(_from.y, s.pos.y) + raise;
    const side = Math.min(dist * 0.08, 5.5) * (index % 2 === 0 ? 1 : -1);
    arc.reset(_from, s.pos, apex, side);
    duration = durationFor(kind, dist);

    // 进入导览 / 手动切站：立刻通知 UI 目标景点；自动前进则到站时再通知
    if (kind !== 'auto') {
      notified = true;
      emit(s.poi);
    }

    // 暂停状态下的切站：直接落到目标机位（保持画面，不播放运镜）
    if (paused) {
      phase = 'hold';
      t = 0;
      camera.position.copy(s.pos);
      _lookCurrent.copy(s.look);
      camera.lookAt(_lookCurrent);
    }
  }

  function arrive() {
    const s = stations[index];
    phase = 'hold';
    t = 0;
    idleClock = 0;
    camera.position.copy(s.pos);
    _lookTarget.copy(s.look);
    if (!notified) {
      notified = true;
      emit(s.poi);
    }
  }

  /** 飞行段更新 */
  function updateTravel(dt) {
    t += dt;
    const raw = duration > 0 ? t / duration : 1;
    const k = clamp(raw, 0, 1);
    arc.eval(easeInOutCubic(k), _pos);
    // 路径不得贴地/穿地（正常弧线远高于此，仅兜底）
    const minY = hAt(_pos.x, _pos.z) + GROUND_CLEARANCE;
    if (_pos.y < minY) _pos.y = minY;
    camera.position.copy(_pos);

    // look 目标缓入缓出地过渡，再由阻尼跟随（不会瞬间转向）
    _lookTarget.lerpVectors(_lookFrom, _lookTo, easeInOutSine(k));
    _lookCurrent.lerp(_lookTarget, damp(LOOK_RATE_TRAVEL, dt));
    camera.lookAt(_lookCurrent);

    setFov(TRAVEL_FOV + Math.min(arc.distance * 0.06, 2.0), dt);

    if (raw >= 1) arrive();
  }

  /** 停留段更新：微幅呼吸 / 漂移 */
  function updateHold(dt, advance) {
    const s = stations[index];
    if (advance) t += dt;
    idleClock += dt;
    const c = Math.cos;
    const sn = Math.sin;
    camera.position.set(
      s.pos.x + sn(idleClock * 0.52) * 0.1,
      s.pos.y + sn(idleClock * 0.74 + 1.2) * 0.06,
      s.pos.z + c(idleClock * 0.43) * 0.1
    );
    _lookTarget.set(
      s.look.x + sn(idleClock * 0.36 + 0.7) * 0.28,
      s.look.y + sn(idleClock * 0.27) * 0.12,
      s.look.z + c(idleClock * 0.31 + 1.9) * 0.28
    );
    _lookCurrent.lerp(_lookTarget, damp(LOOK_RATE_HOLD, dt));
    camera.lookAt(_lookCurrent);
    setFov(HOLD_FOV, dt);
    if (advance && t >= s.hold) beginTravel(index + 1, 'auto');
  }

  function update(dt) {
    if (!active) return;
    const stepDt = clamp(Number.isFinite(dt) ? dt : 0.016, 0.0005, 0.1);
    if (paused) {
      // 暂停：保持当前镜头；若正好在停留段，保留非常缓慢的呼吸
      if (phase === 'hold') updateHold(stepDt * 0.55, false);
      return;
    }
    if (phase === 'travel') updateTravel(stepDt);
    else updateHold(stepDt, true);
  }

  /* ---------------------------------------------------------------- API */
  function start(i = 0) {
    if (!count) return;
    active = true;
    paused = false;
    const idx = wrap(Number.isFinite(i) ? Math.floor(i) : 0);
    beginTravel(idx, 'start');
  }

  function stop() {
    active = false;
    paused = false;
    fovApplied = camera.fov;
  }

  function next() {
    if (!count || !active) return false;
    beginTravel(index + 1, 'command');
    return true;
  }

  function prev() {
    if (!count || !active) return false;
    beginTravel(index - 1, 'command');
    return true;
  }

  function goTo(poiId) {
    if (!count) return false;
    let found = -1;
    for (let i = 0; i < count; i++) {
      if (stations[i].poi.id === poiId) {
        found = i;
        break;
      }
    }
    if (found < 0) return false;
    if (!active) {
      start(found);
      return true;
    }
    // 已停在该站：重播停留与呼吸
    if (found === index && phase === 'hold') {
      t = 0;
      idleClock = 0;
      if (!notified) {
        notified = true;
        emit(stations[found].poi);
      }
      return true;
    }
    beginTravel(found, 'command');
    return true;
  }

  function setPaused(v) {
    paused = Boolean(v);
  }

  return {
    start,
    stop,
    next,
    prev,
    goTo,
    setPaused,
    update,

    get isActive() {
      return active;
    },
    get isPaused() {
      return paused;
    },
    get currentPoiId() {
      return count ? stations[index].poi.id : null;
    },
    get currentPoi() {
      return count ? stations[index].poi : null;
    },
    get progress() {
      if (!count) return 0;
      let p = index;
      if (phase === 'hold') p += 1;
      else p += clamp(duration > 0 ? t / duration : 1, 0, 1);
      return clamp(p / count, 0, 1);
    },

    /** 退出导览时把玩家放回当前景点附近的位姿（contract §7 可选） */
    getGroundPose() {
      if (!count) return null;
      const poi = stations[index].poi;
      const px = Array.isArray(poi.pos) ? poi.pos[0] : camera.position.x;
      const pz = Array.isArray(poi.pos) ? poi.pos[1] : camera.position.z;
      let yaw = 0;
      if (Array.isArray(poi.faceTo)) {
        yaw = Math.atan2(-(poi.faceTo[0] - px), -(poi.faceTo[1] - pz));
      }
      return { x: px, z: pz, yaw, poi };
    },

    dispose() {
      active = false;
      paused = false;
    },
  };
}

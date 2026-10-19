import * as THREE from 'three';
import { BOUNDS, EYE_HEIGHT, WATER_LEVEL, heightAt as layoutHeightAt } from '../layout.js';

/**
 * 第一人称漫游控制器（E 号 · 自由漫游）
 * ------------------------------------------------------------
 * 职责：
 *   - 键盘 WASD / 方向键 + Shift 疾行（带加速度与摩擦）
 *   - 鼠标按住拖动 / 触摸单指拖动 / 可选 Pointer Lock 环顾
 *   - 相机 y = heightAt(x,z) + EYE_HEIGHT，缓入缓出 yaw/pitch，轻微头部起伏与疾行 FOV
 *   - 静态碰撞体解析（circle / ellipse / 旋转 box）：solid 推开、water 在桥/岛上忽略、soft 忽略
 *   - 触屏接口：setMoveInput / addLookDelta（由 React UI 摇杆调用）
 *
 * 约束：update 内不分配新对象；不改契约文件；不监听其它模块的事件。
 */

const PLAYER_RADIUS = 0.4;
const WATER_IGNORE_MARGIN = 0.25; // heightAt > waterLevel + 0.25 时视为在桥/岛上
const WATER_MAX_PUSH = 0.75; // 水面碰撞体单次推出超过该距离 → 视为"从高差区域跌向水面"，退回
const WALK_SPEED = 3.2;
const RUN_SPEED = 6.0;
const ACCEL_RATE = 10.5; // 加速趋近速度（1/s）
const FRICTION_RATE = 12.5; // 松手减速
const LOOK_SENSITIVITY = 0.0026; // rad / px（契约值）
const YAW_SMOOTH = 19; // 视角阻尼（1/s）
const PITCH_SMOOTH = 19;
const PITCH_LIMIT = 1.3; // ≈ 74.5°
const BASE_FOV = 58;
const RUN_FOV = 64;
const FOV_SMOOTH = 4.2;
const MAX_SUBSTEP = 0.11; // 单次碰撞子步最大位移（防穿透）
const MAX_SUBSTEPS = 10;
const MAX_COLLISION_ITERS = 4;
const BOUNDS_MARGIN = 2;
const NEAR_ELEVATED_PROBE = [0.55, 1.0]; // 水面阻挡时向前探针（允许踏上桥/岛引桥）

const _push = { x: 0, z: 0, dist: 0 };
const _tmpDir = { x: 0, z: 0 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function isFormTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag && /^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return true;
  return Boolean(target.isContentEditable);
}

/** 圆（含玩家半径）：命中返回 true 并填充 _push */
function hitCircle(c, x, z) {
  const dx = x - c.x;
  const dz = z - c.z;
  const min = (c.r || 0.5) + PLAYER_RADIUS;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  if (d2 < 1e-8) {
    _push.x = c.x + min;
    _push.z = c.z;
    _push.dist = min;
    return true;
  }
  const d = Math.sqrt(d2);
  _push.x = c.x + (dx / d) * min;
  _push.z = c.z + (dz / d) * min;
  _push.dist = min - d;
  return true;
}

/** 椭圆（radii 加玩家半径，近似沿法向推出） */
function hitEllipse(c, x, z) {
  const rot = c.rot || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = x - c.x;
  const dz = z - c.z;
  // 世界 → 局部（旋转 -rot）
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  const ex = (c.rx || 0.5) + PLAYER_RADIUS;
  const ez = (c.rz || 0.5) + PLAYER_RADIUS;
  const nx = lx / ex;
  const nz = lz / ez;
  const m2 = nx * nx + nz * nz;
  if (m2 >= 1) return false;
  let px;
  let pz;
  let dist;
  if (m2 < 1e-8) {
    px = ex;
    pz = 0;
    dist = Math.max(ex, ez);
  } else {
    const m = Math.sqrt(m2);
    px = lx / m;
    pz = lz / m;
    dist = Math.hypot(px - lx, pz - lz);
  }
  // 局部 → 世界（旋转 rot）
  _push.x = c.x + px * cos - pz * sin;
  _push.z = c.z + px * sin + pz * cos;
  _push.dist = dist;
  return true;
}

/** 旋转盒（半尺寸加玩家半径，按最小穿透轴推出） */
function hitBox(c, x, z) {
  const rot = c.rot || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = x - c.x;
  const dz = z - c.z;
  let lx = dx * cos + dz * sin;
  let lz = -dx * sin + dz * cos;
  const ex = (c.hx || 0.5) + PLAYER_RADIUS;
  const ez = (c.hz || 0.5) + PLAYER_RADIUS;
  if (lx <= -ex || lx >= ex || lz <= -ez || lz >= ez) return false;
  const penX = ex - Math.abs(lx);
  const penZ = ez - Math.abs(lz);
  if (penX < penZ) {
    lx = lx < 0 ? -ex : ex;
    _push.dist = penX;
  } else {
    lz = lz < 0 ? -ez : ez;
    _push.dist = penZ;
  }
  _push.x = c.x + lx * cos - lz * sin;
  _push.z = c.z + lx * sin + lz * cos;
  return true;
}

function hit(c, x, z) {
  switch (c.type) {
    case 'circle':
      return hitCircle(c, x, z);
    case 'ellipse':
      return hitEllipse(c, x, z);
    case 'box':
      return hitBox(c, x, z);
    default:
      return false;
  }
}

export function createWalker({
  camera,
  domElement,
  colliders,
  heightAt,
  spawn,
  waterLevel,
  getEnv,
  mobile,
}) {
  const hAt = typeof heightAt === 'function' ? heightAt : layoutHeightAt;
  const basePos = spawn || { x: 98, z: 0, yaw: Math.PI / 2 };
  const waterY = Number.isFinite(waterLevel) ? waterLevel : WATER_LEVEL;
  const waterThreshold = waterY + WATER_IGNORE_MARGIN;
  const isMobile = Boolean(mobile);
  const pointerLockSupported =
    !isMobile && typeof domElement.requestPointerLock === 'function' && !('ontouchstart' in window);

  /* ---- 碰撞体分拣（启动时一次；water / solid 分开，soft 忽略） ---- */
  const solidCols = [];
  const waterCols = [];
  if (Array.isArray(colliders)) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (!c || (c.type !== 'circle' && c.type !== 'ellipse' && c.type !== 'box')) continue;
      const tag = c.tag || 'solid';
      if (tag === 'soft') continue;
      if (tag === 'water') waterCols.push(c);
      else solidCols.push(c);
    }
  }

  /* ---- 状态 ---- */
  const pos = new THREE.Vector3(basePos.x, 0, basePos.z);
  let yaw = Number.isFinite(basePos.yaw) ? basePos.yaw : Math.PI / 2;
  let yawTarget = yaw;
  let pitch = -0.02;
  let pitchTarget = -0.02;
  let enabled = true;
  let locked = false;
  let fovApplied = BASE_FOV;

  const keys = new Set();
  const joyMove = { x: 0, y: 0 }; // 触屏摇杆（-1..1）
  const velocity = new THREE.Vector2();
  let bobPhase = 0;
  let bobAmp = 0;
  let dragging = false;
  let dragMoved = 0;
  let lastX = 0;
  let lastY = 0;
  let dragPointerId = -1;
  let touchId = -1;

  /* 相机初始化 */
  camera.rotation.order = 'YXZ';
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  pos.y = hAt(pos.x, pos.z) + EYE_HEIGHT;
  camera.position.copy(pos);
  camera.rotation.set(pitch, yaw, 0);

  /* 触摸滚动抑制（不改 styles.css，只设本 canvas 的内联样式） */
  const prevTouchAction = domElement.style.touchAction;
  const prevCursor = domElement.style.cursor;
  domElement.style.touchAction = 'none';

  /* ------------------------------------------------------------------ 输入 */
  function onKeyDown(e) {
    if (!enabled) return;
    if (isFormTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const code = e.code;
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }
    keys.add(code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function clearKeys() {
    keys.clear();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (dragPointerId >= 0) {
      try {
        domElement.releasePointerCapture?.(dragPointerId);
      } catch {
        /* ignore */
      }
      dragPointerId = -1;
    }
    if (enabled) domElement.style.cursor = 'grab';
  }

  function onPointerDown(e) {
    if (!enabled) return;
    if (e.pointerType === 'touch') return; // 触摸由 touch 事件处理，避免双倍灵敏度
    if (e.button !== 0) return;
    dragging = true;
    dragMoved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    dragPointerId = e.pointerId;
    try {
      domElement.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    domElement.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!enabled) return;
    if (e.pointerType === 'touch') return;
    if (locked) {
      addLookDelta(e.movementX || 0, e.movementY || 0);
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    addLookDelta(dx, dy);
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch') return;
    const wasDragging = dragging;
    const clickLike = wasDragging && dragMoved < 5 && e.button === 0;
    endDrag();
    // 单击画布（非拖动）→ 尝试 Pointer Lock；拖动永远只做环顾
    if (clickLike && enabled && !locked && pointerLockSupported) {
      try {
        const p = domElement.requestPointerLock?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  function onPointerLockChange() {
    locked = document.pointerLockElement === domElement;
    if (locked) {
      dragging = false;
      domElement.style.cursor = 'none';
    } else if (enabled) {
      domElement.style.cursor = 'grab';
    }
  }

  /* 触摸：单指在画布空白处拖动环顾（passive:false 阻止页面滚动） */
  function onTouchStart(e) {
    if (!enabled) return;
    if (e.touches.length !== 1 || dragging) return;
    const t = e.touches[0];
    touchId = t.identifier;
    dragging = true;
    dragMoved = 0;
    lastX = t.clientX;
    lastY = t.clientY;
    if (e.cancelable) e.preventDefault();
  }

  function onTouchMove(e) {
    if (!enabled) return;
    if (!dragging || touchId < 0) return;
    let t = null;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === touchId) {
        t = e.touches[i];
        break;
      }
    }
    if (!t) return;
    const dx = t.clientX - lastX;
    const dy = t.clientY - lastY;
    lastX = t.clientX;
    lastY = t.clientY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    addLookDelta(dx, dy);
    if (e.cancelable) e.preventDefault();
  }

  function onTouchEnd(e) {
    if (touchId < 0) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touchId = -1;
        endDrag();
        break;
      }
    }
  }

  function onBlur() {
    clearKeys();
    endDrag();
    joyMove.x = 0;
    joyMove.y = 0;
    velocity.set(0, 0);
  }

  function onVisibilityChange() {
    if (document.hidden) onBlur();
  }

  function addLookDelta(dx, dy) {
    if (!enabled) return;
    yawTarget -= dx * LOOK_SENSITIVITY;
    pitchTarget -= dy * LOOK_SENSITIVITY;
    pitchTarget = clamp(pitchTarget, -PITCH_LIMIT, PITCH_LIMIT);
    // yaw 保持在 ±2π 附近，避免长时间转动后数值过大
    if (yawTarget > Math.PI * 4) yawTarget -= Math.PI * 2;
    else if (yawTarget < -Math.PI * 4) yawTarget += Math.PI * 2;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);
  domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  domElement.addEventListener('touchstart', onTouchStart, { passive: false });
  domElement.addEventListener('touchmove', onTouchMove, { passive: false });
  domElement.addEventListener('touchend', onTouchEnd, { passive: false });
  domElement.addEventListener('touchcancel', onTouchEnd, { passive: false });

  /* ---------------------------------------------------------------- 碰撞 */
  /** 水面阻挡时，向前探针判断是否即将踏上高差区域（桥/岛），避免被水边 margin 卡住 */
  function nearElevatedAhead(x, z, dirX, dirZ) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return false;
    const ux = dirX / len;
    const uz = dirZ / len;
    for (let i = 0; i < NEAR_ELEVATED_PROBE.length; i++) {
      const d = NEAR_ELEVATED_PROBE[i];
      if (hAt(x + ux * d, z + uz * d) > waterThreshold) return true;
    }
    return false;
  }

  /**
   * 从 (ax,az) 走向 (x,z) 的碰撞解析，结果写回 _res。
   * 水面的处理：
   *  - 高差区域（heightAt > waterLevel+0.25）上的水面碰撞体忽略（可以站桥上/岛上）
   *  - 一步推出距离过大（离开高差区域跌落水面）→ 退回起点，挡住
   *  - 临近高差区域（引桥）时放行，允许走上桥
   */
  function resolve(ax, az, x, z, dirX, dirZ) {
    const anchorHigh = hAt(ax, az) > waterThreshold;
    for (let iter = 0; iter < MAX_COLLISION_ITERS; iter++) {
      for (let i = 0; i < solidCols.length; i++) {
        if (hit(solidCols[i], x, z)) {
          x = _push.x;
          z = _push.z;
        }
      }
      for (let i = 0; i < waterCols.length; i++) {
        if (hAt(x, z) > waterThreshold) break; // 在桥/岛上：全部水面忽略（同帧一致）
        if (!hit(waterCols[i], x, z)) continue;
        if (_push.dist > WATER_MAX_PUSH) {
          if (anchorHigh) {
            x = ax;
            z = az;
          } else {
            x = _push.x;
            z = _push.z;
          }
        } else if (!nearElevatedAhead(x, z, dirX, dirZ)) {
          x = _push.x;
          z = _push.z;
        }
      }
    }
    _tmpDir.x = x;
    _tmpDir.z = z;
  }

  /* ---------------------------------------------------------------- 主更新 */
  const _res = { x: 0, z: 0 };
  let lastInputMag = 0;
  let running = false;

  function update(dt, env) {
    if (!enabled) return;
    const stepDt = clamp(Number.isFinite(dt) ? dt : 0.016, 0.0005, 0.1);

    /* 1. 输入 → 目标速度（键盘 + 摇杆叠加，斜向归一化） */
    let mx = joyMove.x;
    let mz = joyMove.y;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
      mag = 1;
    }
    lastInputMag = mag;
    running = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && mag > 0.08;
    const speed = running ? RUN_SPEED : WALK_SPEED;

    // 视角平滑（阻尼，不硬跟手）
    const yawK = 1 - Math.exp(-stepDt * YAW_SMOOTH);
    const pitchK = 1 - Math.exp(-stepDt * PITCH_SMOOTH);
    yaw += (yawTarget - yaw) * yawK;
    pitch += (pitchTarget - pitch) * pitchK;

    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    // 前向 = (-sin yaw, -cos yaw)，右向 = (cos yaw, -sin yaw)
    const fx = -sy;
    const fz = -cy;
    const rx = cy;
    const rz = -sy;
    const targetVx = (rx * mx + fx * mz) * speed;
    const targetVz = (rz * mx + fz * mz) * speed;

    const rate = mag > 0.01 ? ACCEL_RATE : FRICTION_RATE;
    const velK = 1 - Math.exp(-stepDt * rate);
    velocity.x += (targetVx - velocity.x) * velK;
    velocity.y += (targetVz - velocity.y) * velK;
    if (Math.abs(velocity.x) < 0.002 && targetVx === 0) velocity.x = 0;
    if (Math.abs(velocity.y) < 0.002 && targetVz === 0) velocity.y = 0;

    const moveX = velocity.x * stepDt;
    const moveZ = velocity.y * stepDt;
    const moveDist = Math.hypot(moveX, moveZ);
    const substeps = moveDist > 1e-6 ? Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(moveDist / MAX_SUBSTEP))) : 1;
    const stepX = moveX / substeps;
    const stepZ = moveZ / substeps;

    let px = pos.x;
    let pz = pos.z;
    for (let s = 0; s < substeps; s++) {
      const ax = px;
      const az = pz;
      let nx = ax + stepX;
      let nz = az + stepZ;
      resolve(ax, az, nx, nz, stepX, stepZ);
      nx = _tmpDir.x;
      nz = _tmpDir.z;
      // 园界钳制（留 2m 余量）
      const minX = BOUNDS.minX + BOUNDS_MARGIN;
      const maxX = BOUNDS.maxX - BOUNDS_MARGIN;
      const minZ = BOUNDS.minZ + BOUNDS_MARGIN;
      const maxZ = BOUNDS.maxZ - BOUNDS_MARGIN;
      px = nx < minX ? minX : nx > maxX ? maxX : nx;
      pz = nz < minZ ? minZ : nz > maxZ ? maxZ : nz;
    }
    pos.x = px;
    pos.z = pz;
    pos.y = hAt(px, pz) + EYE_HEIGHT;

    /* 2. 头部起伏 + 相机 */
    const hSpeed = Math.hypot(velocity.x, velocity.y);
    bobPhase += hSpeed * stepDt * 2.05;
    const bobTarget = Math.min(hSpeed / WALK_SPEED, 1) * 0.022 + Math.min(Math.max(hSpeed - WALK_SPEED, 0) / 2.8, 1) * 0.008;
    bobAmp += (bobTarget - bobAmp) * (1 - Math.exp(-stepDt * 8));
    const bob = hSpeed > 0.05 ? Math.sin(bobPhase) * bobAmp : bobAmp * Math.sin(bobPhase) * 0.35;

    camera.position.set(pos.x, pos.y + bob, pos.z);
    camera.rotation.set(pitch, yaw, 0);

    /* 3. 疾行 FOV 平滑过渡 */
    const fovTarget = running ? RUN_FOV : BASE_FOV;
    camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-stepDt * FOV_SMOOTH));
    if (Math.abs(camera.fov - fovApplied) > 0.02) {
      fovApplied = camera.fov;
      camera.updateProjectionMatrix();
    }

    if (env && env.focus) {
      env.focus.set(pos.x, pos.y - 1.0, pos.z);
    }
  }

  /* ---------------------------------------------------------------- 对外 API */
  function syncCamera() {
    pos.y = hAt(pos.x, pos.z) + EYE_HEIGHT;
    camera.position.copy(pos);
    camera.rotation.set(pitch, yaw, 0);
    camera.fov = BASE_FOV;
    fovApplied = BASE_FOV;
    camera.updateProjectionMatrix();
  }

  function teleport(x, z, newYaw) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    pos.x = x;
    pos.z = z;
    if (typeof newYaw === 'number' && Number.isFinite(newYaw)) {
      yawTarget = newYaw;
      yaw = newYaw;
    }
    pitchTarget = -0.02;
    pitch = -0.02;
    velocity.set(0, 0);
    clearKeys();
    dragging = false;
    syncCamera();
  }

  function setEnabled(on) {
    const next = Boolean(on);
    if (next === enabled) {
      if (next) syncCamera();
      return;
    }
    enabled = next;
    clearKeys();
    endDrag();
    joyMove.x = 0;
    joyMove.y = 0;
    velocity.set(0, 0);
    if (!enabled) {
      if (document.pointerLockElement === domElement) {
        try {
          document.exitPointerLock?.();
        } catch {
          /* ignore */
        }
      }
      domElement.style.cursor = prevCursor;
    } else {
      domElement.style.cursor = 'grab';
      syncCamera();
    }
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    domElement.removeEventListener('touchstart', onTouchStart);
    domElement.removeEventListener('touchmove', onTouchMove);
    domElement.removeEventListener('touchend', onTouchEnd);
    domElement.removeEventListener('touchcancel', onTouchEnd);
    endDrag();
    clearKeys();
    domElement.style.touchAction = prevTouchAction;
    domElement.style.cursor = prevCursor;
    if (document.pointerLockElement === domElement) {
      try {
        document.exitPointerLock?.();
      } catch {
        /* ignore */
      }
    }
  }

  domElement.style.cursor = enabled ? 'grab' : prevCursor;

  return {
    update,
    setEnabled,
    getPosition() {
      return pos;
    },
    getYaw() {
      return yaw;
    },
    getPitch() {
      return pitch;
    },
    teleport,
    setMoveInput(x, y) {
      joyMove.x = clamp(Number.isFinite(x) ? x : 0, -1, 1);
      joyMove.y = clamp(Number.isFinite(y) ? y : 0, -1, 1);
    },
    addLookDelta,
    isLocked() {
      return locked;
    },
    getGroundY() {
      return hAt(pos.x, pos.z);
    },
    dispose,
  };
}

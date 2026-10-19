import * as THREE from 'three';

/**
 * 导览运镜数学小工具（E 号 · tour 专用）
 * ------------------------------------------------------------
 * 所有函数/对象在创建时分配，update 内只做数值运算，不产生新对象。
 */

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 缓入缓出（3 次）：用于每段运镜的时间曲线 */
export function easeInOutCubic(t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) * 0.5;
}

/** 更平缓的正弦缓动：用于 look 目标的过渡 */
export function easeInOutSine(t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return -(Math.cos(Math.PI * k) - 1) * 0.5;
}

/** 指数阻尼系数（帧率无关的平滑） */
export function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

/**
 * 可复用的"起点 → 抬升弧顶 → 终点"三次贝塞尔航拍路径。
 *  - 控制点抬升 lift：使 u=0.5 处世界高度恰为 apex
 *  - 起点/终点带水平内收，形成缓入缓出的水平速度
 *  - side 为弧线中段的水平侧向偏移（米），让连续段落有轻微的 S 形游走
 * 不持有外部引用，可反复 reset 复用。
 */
export function createArcSpline() {
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const p3 = new THREE.Vector3();

  return {
    distance: 0,
    apexY: 0,
    /** 起点（只读） */
    from: p0,
    /** 终点（只读） */
    to: p3,

    /**
     * @param {THREE.Vector3} from 当前相机位置
     * @param {THREE.Vector3} to   下一站机位
     * @param {number} apex 弧顶世界高度（≥ 两端高度）
     * @param {number} side 中段水平侧移（米，可负）
     * @param {number} [insetRatio] 控制点水平内收比例
     */
    reset(from, to, apex, side, insetRatio = 0.16) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const dist = Math.hypot(dx, dz);
      const dirX = dist > 1e-6 ? dx / dist : 0;
      const dirZ = dist > 1e-6 ? dz / dist : 0;
      const perpX = -dirZ;
      const perpZ = dirX;
      // 三次贝塞尔 u=0.5 高度 = 0.5*(y0+y1) + 0.75*lift
      const lift = Math.max(0, (apex - (from.y + to.y) * 0.5) / 0.75);
      const inset = dist * insetRatio;
      // 控制点半侧移 → 曲线中点侧移约为 side
      const ctrlSide = side / 0.45;
      p0.copy(from);
      p1.set(
        from.x + dirX * inset + perpX * ctrlSide,
        from.y + lift,
        from.z + dirZ * inset + perpZ * ctrlSide
      );
      p2.set(
        to.x - dirX * inset + perpX * ctrlSide,
        to.y + lift,
        to.z - dirZ * inset + perpZ * ctrlSide
      );
      p3.copy(to);
      this.distance = dist;
      this.apexY = apex;
    },

    /** 采样路径（u∈0..1），写入 out，返回 out */
    eval(u, out) {
      const k = u < 0 ? 0 : u > 1 ? 1 : u;
      const ik = 1 - k;
      const b0 = ik * ik * ik;
      const b1 = 3 * ik * ik * k;
      const b2 = 3 * ik * k * k;
      const b3 = k * k * k;
      out.set(
        p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3,
        p0.y * b0 + p1.y * b1 + p2.y * b2 + p3.y * b3,
        p0.z * b0 + p1.z * b1 + p2.z * b2 + p3.z * b3
      );
      return out;
    },
  };
}

import {
  BOUNDS,
  WALL_SEGMENTS,
  STRUCTURES,
  PATHS,
  isWaterAt,
  pathDistance,
  distToPolyline,
  heightAt,
} from '../../layout.js';

/**
 * 种植/摆件的落位工具。
 * 复用 layout 的权威数据，但扩展了「园中园内部可种植」与「建筑群落内部避让」，
 * 因为 layout.isPlantable() 会把 compound 整块视为建筑（万竹园/沧园/纪念堂内部无法种竹）。
 */

/** 所有建筑体块（含 compound 内的厅堂/厢房），用于内部避让 */
const BUILDINGS = [];
for (const s of STRUCTURES) {
  if (s.type === 'compound') {
    for (const h of s.halls || []) BUILDINGS.push(h);
  } else if (s.size && (s.type === 'hall' || s.type === 'gate' || s.type === 'wing' || s.type === 'tower' || s.type === 'pavilion' || s.type === 'hexpavilion' || s.type === 'paifang')) {
    BUILDINGS.push(s);
  }
}

function inRotRect(x, z, s, margin = 0) {
  const [w, d] = s.size;
  const rot = s.rotY || 0;
  const c = Math.cos(-rot);
  const sn = Math.sin(-rot);
  const dx = x - s.pos[0];
  const dz = z - s.pos[1];
  const lx = dx * c - dz * sn;
  const lz = dx * sn + dz * c;
  return Math.abs(lx) <= w / 2 + margin && Math.abs(lz) <= d / 2 + margin;
}

/** 是否在某个 compound 内（返回 compound 与到墙内的距离） */
function compoundInfo(x, z) {
  for (const s of STRUCTURES) {
    if (s.type !== 'compound') continue;
    const [x0, z0, x1, z1] = s.rect;
    if (x > x0 && x < x1 && z > z0 && z < z1) {
      const wallDist = Math.min(x - x0, x1 - x, z - z0, z1 - z);
      return { s, wallDist };
    }
  }
  return null;
}

const DEFAULT = {
  water: 0.8,
  path: 1.0,
  wall: 2.4,
  building: 1.2,
  compoundWall: 2.2,
  elevated: 0.06,
  compoundInside: false,
  corridor: true,
  rocks: true,
};

/**
 * 是否可以放置（树木/灌木/摆件）。
 * opts 覆盖 DEFAULT；compoundInside=true 时允许在园中园内部（仍避让墙、厅堂、内部道路）。
 */
export function isFree(x, z, opts = {}) {
  const o = { ...DEFAULT, ...opts };
  if (x < BOUNDS.minX + 2 || x > BOUNDS.maxX - 2 || z < BOUNDS.minZ + 2 || z > BOUNDS.maxZ - 2) return false;
  if (o.elevated > 0 && heightAt(x, z) > o.elevated) return false;
  if (isWaterAt(x, z, o.water)) return false;
  if (pathDistance(x, z) < o.path) return false;

  for (const w of WALL_SEGMENTS) {
    if (Math.abs(x - w.x) < w.hx + o.wall && Math.abs(z - w.z) < w.hz + o.wall) return false;
  }

  const comp = compoundInfo(x, z);
  if (comp) {
    if (!o.compoundInside) return false;
    if (comp.wallDist < o.compoundWall) return false;
  }

  // 厅堂/门/亭/厢房体块
  for (const b of BUILDINGS) {
    if (inRotRect(x, z, b, o.building)) return false;
  }
  // 长廊
  if (o.corridor) {
    for (const s of STRUCTURES) {
      if (s.type !== 'corridor') continue;
      const hx = s.length / 2 + 0.9;
      const hz = s.width / 2 + 0.9;
      if (Math.abs(x - s.pos[0]) < hx && Math.abs(z - s.pos[1]) < hz) return false;
    }
  }
  // 碑 / 龟石 / 假山
  if (o.rocks) {
    for (const s of STRUCTURES) {
      if (s.type === 'stele' || s.type === 'steles') {
        if (Math.hypot(x - s.pos[0], z - s.pos[1]) < 1.9) return false;
      } else if (s.type === 'rock') {
        const r = Math.max(s.size ? s.size[0] : 2, 2) * 0.6 + 0.8;
        if (Math.hypot(x - s.pos[0], z - s.pos[1]) < r) return false;
      } else if (s.type === 'rockery') {
        const [w, d] = s.size;
        const rot = s.rotY || 0;
        const c = Math.cos(-rot);
        const sn = Math.sin(-rot);
        const dx = x - s.pos[0];
        const dz = z - s.pos[1];
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        if (Math.abs(lx) < w / 2 + 1.2 && Math.abs(lz) < d / 2 + 1.2) return false;
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------------ 区域采样 */

/** 按 layout zone.area 的语义取一个随机点 */
export function sampleArea(rand, area) {
  if (area.kind === 'ellipse') {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    return [area.cx + Math.cos(a) * area.rx * r, area.cz + Math.sin(a) * area.rz * r];
  }
  if (area.kind === 'rect') {
    return [area.minX + rand() * (area.maxX - area.minX), area.minZ + rand() * (area.maxZ - area.minZ)];
  }
  if (area.kind === 'ring') {
    const a = rand() * Math.PI * 2;
    const r = area.rx + (rand() - 0.5) * area.band * 2;
    return [area.cx + Math.cos(a) * r, area.cz + Math.sin(a) * (area.rz / area.rx) * r];
  }
  if (area.kind === 'line') {
    const pts = area.points;
    const seg = Math.floor(rand() * (pts.length - 1));
    const t = rand();
    const [ax, az] = pts[seg];
    const [bx, bz] = pts[seg + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (bz - az) / len;
    const nz = -(bx - ax) / len;
    const off = (rand() * 2 - 1) * area.band;
    return [ax + (bx - ax) * t + nx * off, az + (bz - az) * t + nz * off];
  }
  return [0, 0];
}

/** 在 zone.area 里找一个可放置点（找不到返回 null，绝不抛出） */
export function findSpot(rand, area, opts = {}, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    const [x, z] = sampleArea(rand, area);
    if (isFree(x, z, opts)) return [x, z];
  }
  return null;
}

/**
 * 批量取点：spots 越多越难，内部逐级放宽边距。
 * 返回 [[x,z], ...]（数量可能略少于 count）。
 */
export function findSpots(rand, area, count, opts = {}, minDist = 0, relax = null) {
  const steps = relax || [
    {},
    { water: 0.5, path: 0.7, building: 0.9, compoundWall: 1.6 },
    { water: 0.35, path: 0.55, building: 0.7, compoundWall: 1.2, corridor: false, rocks: false },
  ];
  const pts = [];
  for (let k = 0; k < count; k++) {
    let found = null;
    for (let s = 0; s < steps.length && !found; s++) {
      const o = { ...opts, ...steps[s] };
      for (let i = 0; i < 40; i++) {
        const [x, z] = sampleArea(rand, area);
        if (!isFree(x, z, o)) continue;
        if (minDist > 0) {
          let ok = true;
          for (let j = 0; j < pts.length; j++) {
            if (Math.hypot(pts[j][0] - x, pts[j][1] - z) < minDist) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
        found = [x, z];
        break;
      }
    }
    if (found) pts.push(found);
  }
  return pts;
}

/* ------------------------------------------------------------------ 路径采样（小品用） */

/** 折线累计长度 */
export function polylineLength(points, closed = false) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  if (closed && points.length > 2) {
    total += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
  }
  return total;
}

/** 沿路径按间距取点，返回 { x, z, nx, nz, tx, tz } */
export function samplePath(path, spacing, offset = 0, opts = {}) {
  const { start = 0.5, closed = Boolean(path.closed), phase = 0 } = opts;
  const pts = path.points;
  const segs = [];
  let total = 0;
  const n = pts.length;
  const limit = closed ? n : n - 1;
  for (let i = 0; i < limit; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len, start: total });
    total += len;
  }
  const out = [];
  for (let d = start + phase; d < total; d += spacing) {
    let seg = segs[0];
    for (let i = 0; i < segs.length; i++) {
      if (d >= segs[i].start && d <= segs[i].start + segs[i].len) {
        seg = segs[i];
        break;
      }
    }
    const t = seg.len > 1e-6 ? (d - seg.start) / seg.len : 0;
    const x = seg.a[0] + (seg.b[0] - seg.a[0]) * t;
    const z = seg.a[1] + (seg.b[1] - seg.a[1]) * t;
    const len = seg.len || 1;
    const tx = (seg.b[0] - seg.a[0]) / len;
    const tz = (seg.b[1] - seg.a[1]) / len;
    // 左侧法线
    const nx = tz;
    const nz = -tx;
    out.push({ x: x + nx * offset, z: z + nz * offset, nx, nz, tx, tz, yaw: Math.atan2(tx, tz) });
  }
  return out;
}

/** 取某条道路 */
export function findPath(id) {
  return PATHS.find((p) => p.id === id) || null;
}

/* ------------------------------------------------------------------ 距离工具 */

/** 到所有树木/摆件的最小距离 */
export function minDistTo(x, z, list) {
  let best = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.hypot(list[i][0] - x, list[i][1] - z);
    if (d < best) best = d;
  }
  return best;
}

/** 水岸外沿采样：返回水面外侧的陆地环带点（用于池边草/苔藓） */
export function waterEdgePoints(shape, rand, count, margin = 0.5) {
  const out = [];
  if (shape.kind === 'ellipse') {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      out.push({
        x: shape.cx + Math.cos(a) * (shape.rx + margin),
        z: shape.cz + Math.sin(a) * (shape.rz + margin),
        yaw: a,
      });
    }
  } else if (shape.kind === 'polyline') {
    for (let i = 0; i < count; i++) {
      const { dist, t } = { dist: 0, t: rand() };
      const pts = shape.points;
      // 均匀取折线上一点，再沿法线外推
      let acc = 0;
      const total = polylineLength(pts);
      const target = t * total;
      let idx = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const len = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
        if (acc + len >= target) {
          idx = k;
          break;
        }
        acc += len;
      }
      const [ax, az] = pts[idx];
      const [bx, bz] = pts[Math.min(pts.length - 1, idx + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const tt = Math.min(1, Math.max(0, (target - acc) / len));
      const x = ax + (bx - ax) * tt;
      const z = az + (bz - az) * tt;
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      const side = rand() > 0.5 ? 1 : -1;
      const off = shape.width / 2 + margin + rand() * 0.5;
      out.push({ x: x + nx * off * side, z: z + nz * off * side, yaw: Math.atan2(nx, nz) });
    }
  }
  return out;
}

export { distToPolyline };

import * as THREE from 'three';
import { heightAt, ELEVATED } from '../../layout.js';
import { stoneBalustrade, paving } from './kit.js';

/**
 * 桥（B 号补充）：来鹤桥（石拱桥）/ 南石板桥 / 九曲桥
 * 桥面高度严格采样 layout.heightAt（ELEVATED 胶囊），保证行走高度与视觉一致。
 */

function regionFor(id) {
  return ELEVATED.find((r) => r.id === id) || null;
}

function sampleLine(region, count) {
  const pts = region.points;
  const segLens = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segLens.push(l);
    total += l;
  }
  const out = [];
  for (let k = 0; k <= count; k++) {
    const target = (k / count) * total;
    let acc = 0;
    let seg = 0;
    while (seg < segLens.length - 1 && acc + segLens[seg] < target) {
      acc += segLens[seg];
      seg++;
    }
    const t = segLens[seg] > 1e-6 ? (target - acc) / segLens[seg] : 0;
    const [ax, az] = pts[seg];
    const [bx, bz] = pts[seg + 1];
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const dirX = (bx - ax) / (segLens[seg] || 1);
    const dirZ = (bz - az) / (segLens[seg] || 1);
    out.push({ x, z, dirX, dirZ, t: target / total });
  }
  return out;
}

/** 桥面（分段盒体，随 heightAt 起伏）+ 石栏 */
function buildDeckAndRails(site, samples, width, opts = {}) {
  const B = site.B;
  const { deckMat = 'stoneLight', thickness = 0.24, railH = 0.92, rail = true, railGap = 0.3 } = opts;
  const half = width / 2;

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 0.04;
    const ry = Math.atan2(-(b.z - a.z), b.x - a.x);
    const y = heightAt(mx, mz);
    B.box(deckMat, len, thickness, width, mx, y - thickness / 2 + 0.02, mz, { ry, uv: 0.55 });
    // 桥面石缝
    B.box('stoneDark', len, 0.02, width + 0.02, mx, y + 0.025, mz, { ry, uv: 0.55 });
  }

  if (rail) {
    for (const side of [-1, 1]) {
      const pts = samples.map((s) => {
        const nx = -s.dirZ;
        const nz = s.dirX;
        return [
          s.x + nx * side * (half - 0.12),
          heightAt(s.x, s.z) + 0.02,
          s.z + nz * side * (half - 0.12),
        ];
      });
      stoneBalustrade(B, {
        points: pts,
        h: railH,
        thickness: 0.14,
        postEvery: 1.05,
        postMat: 'stoneLight',
        panelMat: 'stone',
      });
    }
  }
}

/** 来鹤桥：石拱桥（桥面拱形 + 桥台 + 拱券带） */
export function buildArchBridge(site, s) {
  const region = regionFor(s.id);
  if (!region) return;
  const B = site.B;
  const samples = sampleLine(region, 22);
  buildDeckAndRails(site, samples, s.deckWidth || region.r * 2, {
    railH: s.railH || 0.95,
    thickness: 0.26,
  });

  /* 桥台：两端实体 */
  const a = samples[0];
  const b = samples[samples.length - 1];
  for (const p of [a, b]) {
    const ry = Math.atan2(-p.dirZ, p.dirX);
    B.box('stone', 1.5, 0.9, (s.deckWidth || 5.6) + 0.2, p.x, -0.25, p.z, { ry, uv: 0.6 });
  }

  /* 拱券带：桥面下方一条随拱起伏的弧形石带 */
  for (let i = 1; i < samples.length - 1; i++) {
    const a2 = samples[i];
    const b2 = samples[i + 1];
    const mx = (a2.x + b2.x) / 2;
    const mz = (a2.z + b2.z) / 2;
    const len = Math.hypot(b2.x - a2.x, b2.z - a2.z) + 0.05;
    const ry = Math.atan2(-(b2.z - a2.z), b2.x - a2.x);
    const y = heightAt(mx, mz);
    B.box('stoneDark', len, 0.3, (s.deckWidth || 5.6) - 0.1, mx, y - 0.44, mz, { ry, uv: 0.5 });
  }
}

/** 南石板桥：平桥 + 低栏 */
export function buildSlabBridge(site, s) {
  const region = regionFor(s.id);
  if (!region) return;
  const samples = sampleLine(region, 12);
  buildDeckAndRails(site, samples, s.deckWidth || region.r * 2, {
    railH: s.railH || 0.5,
    thickness: 0.22,
    rail: true,
  });
}

/** 九曲桥：折线桥面 + 低石栏 */
export function buildZigzagBridge(site, s) {
  const B = site.B;
  const pts = s.points;
  const width = s.width || 2.2;
  const y = s.deckY || 0.28;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az) + 0.12;
    const ry = Math.atan2(-(bz - az), bx - ax);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    B.box('stoneLight', len, 0.2, width, mx, y - 0.1, mz, { ry, uv: 0.6 });
    B.box('stoneDark', len, 0.03, width + 0.02, mx, y + 0.015, mz, { ry, uv: 0.6 });
    // 低栏
    for (const side of [-1, 1]) {
      const nx = -(bz - az) / (len || 1);
      const nz = (bx - ax) / (len || 1);
      const off = width / 2 - 0.12;
      const x0 = ax + nx * side * off;
      const z0 = az + nz * side * off;
      const x1 = bx + nx * side * off;
      const z1 = bz + nz * side * off;
      B.bar('stone', [x0, y + 0.42, z0], [x1, y + 0.42, z1], 0.12, 0.1);
      const n = Math.max(2, Math.round(len / 1.4));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        B.box('stoneLight', 0.16, 0.44, 0.16, x0 + (x1 - x0) * t, y + 0.22, z0 + (z1 - z0) * t, { uv: 0.5 });
      }
    }
  }
  // 桥头小平台
  for (const p of [pts[0], pts[pts.length - 1]]) {
    B.box('stoneLight', 1.6, 0.2, width + 0.8, p[0], y - 0.1, p[1], { uv: 0.6 });
  }
}

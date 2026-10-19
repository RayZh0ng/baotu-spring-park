import * as THREE from 'three';
import { column, plinth, stairs, latticePanel, fretwork, plaque, lantern, benchRail } from './kit.js';
import { pyramidRect, hexPyramid, xieshan, gable, shell, mainRidge } from './roof.js';

/** 亭、廊、牌坊 */

const _m = new THREE.Matrix4();

/* ------------------------------------------------------------------ 方亭 */

export function buildPavilion(site, s, opts = {}) {
  const B = site.B;
  const [w, d] = s.size;
  const base = s.base != null ? s.base : 0.4;
  const totalH = s.height || 6.2;
  const [pw, pd] = opts.platform || [w + 1.0, d + 1.0];
  const rise = Math.max(2.0, totalH - base - 3.0);
  const colH = Math.max(2.6, totalH - base - rise - 0.35);
  const eaveY = base + colH + 0.3;
  const mat = opts.roofMat || 'tileB';
  const nX = opts.nX || (w > 8 ? 3 : 2);
  const nZ = 2;

  B.push(s.pos[0], 0, s.pos[1], s.rotY || 0);

  /* 台基（与 layout.ELEVATED 对齐） */
  plinth(B, { w: pw, d: pd, h: base, uv: 0.5 });
  // 四向踏步：正面 + 两侧（背面视情况）
  B.push(0, 0, pd / 2, 0);
  stairs(B, { w: Math.min(2.6, pw * 0.32), topY: base, steps: 2, run: 0.32 });
  B.pop();
  if (opts.sideSteps) {
    for (const side of [-1, 1]) {
      B.push(side * pw / 2, 0, 0, side * Math.PI / 2);
      stairs(B, { w: Math.min(2.2, pd * 0.3), topY: base, steps: 2, run: 0.3, side: false });
      B.pop();
    }
  }

  /* 柱网 */
  const inset = 0.55;
  const xs = [];
  if (nX === 2) {
    xs.push(-w / 2 + inset, w / 2 - inset);
  } else {
    xs.push(-w / 2 + inset, 0, w / 2 - inset);
  }
  const zs = [-d / 2 + inset, d / 2 - inset];
  for (const x of xs) {
    for (const z of zs) column(B, { x, z, baseY: base, h: colH, r: 0.24 });
  }

  /* 额枋 + 挂落 */
  const by = base + colH + 0.02;
  for (const z of zs) {
    B.box('vermilionDark', w - inset * 2 + 1.1, 0.3, 0.24, 0, by + 0.15, z, { uv: 0.5 });
    B.box('woodDark', w - inset * 2 + 1.3, 0.1, 0.3, 0, by + 0.32, z, {});
  }
  for (const x of xs) {
    B.box('vermilionDark', 0.24, 0.3, d - inset * 2 + 1.1, x, by + 0.15, 0, { uv: 0.5 });
  }
  // 正面与背面的挂落（柱间）
  for (let i = 0; i < xs.length - 1; i++) {
    fretwork(B, { x0: xs[i] + 0.28, x1: xs[i + 1] - 0.28, y: by - 0.02, z: zs[1], depth: 0.28 });
    if (!opts.openBack) fretwork(B, { x0: xs[i] + 0.28, x1: xs[i + 1] - 0.28, y: by - 0.02, z: zs[0], depth: 0.28 });
  }
  /* 美人靠：背面 + 两侧（正面留门） */
  if (!opts.noBench) {
    benchRail(B, {
      x0: xs[0] + 0.32, x1: xs[xs.length - 1] - 0.32, z: zs[0],
      y: base, mat: 'vermilion', seatMat: 'woodDark',
    });
    for (const side of [-1, 1]) {
      B.push(side * (w / 2 - inset), 0, 0, side * Math.PI / 2);
      benchRail(B, {
        x0: -d / 2 + inset + 0.32, x1: d / 2 - inset - 0.32, z: 0,
        y: base, mat: 'vermilion', seatMat: 'woodDark',
      });
      B.pop();
    }
  }

  /* 屋顶 */
  if (opts.rectRoof) {
    xieshan(B, {
      w: w - 0.4, d: d - 0.4, eaveY: eaveY + 0.02, rise: totalH - eaveY,
      eaveOverX: 1.0, eaveOverZ: 1.0,
      mat, flare: 0.42,
      capInst: site.capInst, tileCaps: true, capSpacing: 0.46,
      rafters: true,
      waistRatio: [0.6, 0.4],
      upperScale: 0.9,
    });
  } else {
    pyramidRect(B, {
      w: w - 0.3, d: d - 0.3, eaveY: eaveY + 0.02, rise: totalH - eaveY,
      overX: 0.95, overZ: 0.95,
      mat, flare: 0.52,
      capInst: site.capInst, tileCaps: true, capSpacing: 0.44,
    });
  }

  /* 匾额 */
  if (s.plaque) {
    plaque(site, {
      text: s.plaque, w: 1.85, h: 0.62,
      x: 0, y: by - 0.62, z: zs[1] + 0.36,
      fontScale: 0.62,
    });
  }
  lantern(B, { x: -(w / 2 - inset - 0.2), y: by - 0.8, z: zs[1] + 0.25, r: 0.17 });
  lantern(B, { x: w / 2 - inset + 0.2, y: by - 0.8, z: zs[1] + 0.25, r: 0.17 });

  B.pop();

  /* 碰撞：仅柱网（可走进亭内） */
  const rot = s.rotY || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (const x of xs) {
    for (const z of zs) {
      site.addCircle(s.pos[0] + x * cos + z * sin, s.pos[1] - x * sin + z * cos, 0.34, 'solid');
    }
  }
  return { eaveY };
}

/* ---------------------------------------------------------------- 六角亭 */

export function buildHexPavilion(site, s) {
  const B = site.B;
  const [, d] = s.size;
  const base = s.base != null ? s.base : 0.3;
  const totalH = s.height || 5.2;
  const colH = 2.7;
  const eaveY = base + colH + 0.28;
  const rise = Math.max(1.8, totalH - eaveY);
  const colR = Math.min(2.25, d * 0.42);

  B.push(s.pos[0], 0, s.pos[1], s.rotY || 0);

  // 岛面石台（薄层，与 heightAt 的岛面 0.3 对齐）
  B.cyl('stoneLight', colR + 0.75, colR + 0.85, 0.16, 6, 0, base - 0.08, 0, { open: false });
  B.cyl('stoneDark', colR + 0.95, colR + 1.05, 0.1, 6, 0, base - 0.15, 0, {});
  // 台面
  B.cyl('stone', colR + 0.55, colR + 0.6, 0.08, 6, 0, base - 0.02, 0, {});
  // 小踏步（朝 -X：九曲桥来向）
  B.push(-(colR + 0.9), 0, 0, -Math.PI / 2);
  stairs(B, { w: 1.6, topY: Math.max(0.12, base - 0.06), steps: 2, run: 0.3, side: false });
  B.pop();

  // 六柱
  const colAngles = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 6;
    colAngles.push(a);
    column(B, {
      x: Math.cos(a) * colR, z: Math.sin(a) * colR,
      baseY: base, h: colH, r: 0.2,
    });
  }
  // 六边形额枋
  const by = base + colH;
  for (let k = 0; k < 6; k++) {
    const a0 = colAngles[k];
    const a1 = colAngles[(k + 1) % 6];
    const x0 = Math.cos(a0) * colR;
    const z0 = Math.sin(a0) * colR;
    const x1 = Math.cos(a1) * colR;
    const z1 = Math.sin(a1) * colR;
    B.bar('vermilionDark', [x0, by + 0.16, z0], [x1, by + 0.16, z1], 0.24, 0.3);
    B.bar('woodDark', [x0, by + 0.34, z0], [x1, by + 0.34, z1], 0.3, 0.1);
  }
  // 挂落 + 美人靠（五个面，朝桥面留空）
  for (let k = 0; k < 6; k++) {
    const a0 = colAngles[k];
    const a1 = colAngles[(k + 1) % 6];
    const x0 = Math.cos(a0) * colR;
    const z0 = Math.sin(a0) * colR;
    const x1 = Math.cos(a1) * colR;
    const z1 = Math.sin(a1) * colR;
    const skip = k === 3; // 朝 -X 的入口面
    if (skip) continue;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    // 以中点为局部坐标系：沿边方向
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = -Math.atan2(z1 - z0, x1 - x0);
    B.push(mx, 0, mz, ry);
    benchRail(B, { x0: -len / 2 + 0.3, x1: len / 2 - 0.3, z: 0, y: base, mat: 'vermilion', seatMat: 'woodDark' });
    B.pop();
  }
  for (let k = 0; k < 6; k++) {
    if (k === 3) continue;
    const a0 = colAngles[k];
    const a1 = colAngles[(k + 1) % 6];
    const x0 = Math.cos(a0) * colR;
    const z0 = Math.sin(a0) * colR;
    const x1 = Math.cos(a1) * colR;
    const z1 = Math.sin(a1) * colR;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = -Math.atan2(z1 - z0, x1 - x0);
    B.push(mx, 0, mz, ry);
    fretwork(B, { x0: -len / 2 + 0.2, x1: len / 2 - 0.2, y: by - 0.02, z: 0, depth: 0.26 });
    B.pop();
  }

  hexPyramid(B, {
    eaveR: colR + 0.85, eaveY: eaveY + 0.02, rise,
    flare: 0.42, rotation: Math.PI / 6,
    mat: 'tileB', capInst: site.capInst, tileCaps: true, capSpacing: 0.42,
  });

  if (s.plaque) {
    plaque(site, {
      text: s.plaque, w: 1.5, h: 0.56,
      x: 0, y: by - 0.55, z: colR * Math.sin(Math.PI / 6) + 0.55,
      fontScale: 0.62,
    });
  }
  B.pop();

  for (const a of colAngles) {
    site.addCircle(
      s.pos[0] + Math.cos(a) * colR,
      s.pos[1] + Math.sin(a) * colR,
      0.32,
      'solid'
    );
  }
  return { eaveY };
}

/* ------------------------------------------------------------------ 长廊 */

export function buildCorridor(site, s) {
  const B = site.B;
  const len = s.length || 32;
  const width = s.width || 3.4;
  const totalH = s.height || 5.4;
  const baseH = 0.14;
  const bays = s.bays || 8;
  const eaveY = baseH + 3.25;
  const rise = Math.max(1.4, totalH - eaveY);
  const hw = len / 2;

  B.push(s.pos[0], 0, s.pos[1], s.rotY || 0);

  // 台明
  B.box('stoneLight', len + 0.9, baseH, width + 1.5, 0, baseH / 2, 0, { uv: 0.6 });
  B.box('stoneDark', len + 1.1, 0.1, width + 1.7, 0, 0.05, 0, { uv: 0.6 });
  // 端头踏步
  for (const side of [-1, 1]) {
    B.push(side * (hw + 0.45), 0, 0, side * -Math.PI / 2);
    stairs(B, { w: width * 0.8, topY: baseH, steps: 1, run: 0.36, side: false });
    B.pop();
  }
  // 柱
  const zs = [-width / 2 + 0.18, width / 2 - 0.18];
  const stepX = len / bays;
  for (let i = 0; i <= bays; i++) {
    const x = -hw + stepX * i;
    for (const z of zs) column(B, { x, z, baseY: baseH, h: eaveY - baseH - 0.2, r: 0.18 });
    // 坐凳栏杆（北侧全通；南侧留中间两开间作为入口）
    if (i < bays) {
      const x0 = x + 0.24;
      const x1 = x + stepX - 0.24;
      benchRail(B, { x0, x1, z: zs[0], y: baseH, mat: 'vermilion', seatMat: 'woodDark' });
      const mid = bays / 2;
      const isEntry = i >= mid - 1 && i <= mid;
      if (!isEntry) {
        benchRail(B, { x0, x1, z: zs[1], y: baseH, mat: 'vermilion', seatMat: 'woodDark' });
      }
    }
  }
  // 额枋
  for (const z of zs) {
    B.box('vermilionDark', len + 0.3, 0.26, 0.2, 0, eaveY - 0.2, z, { uv: 0.5 });
  }
  // 挂落（柱间）
  for (let i = 0; i < bays; i++) {
    const x0 = -hw + stepX * i + 0.3;
    const x1 = x0 + stepX - 0.6;
    for (const z of zs) {
      fretwork(B, { x0, x1, y: eaveY - 0.35, z, depth: 0.26, density: 0.42 });
    }
  }
  // 卷棚顶
  gable(B, {
    w: len + 1.0, d: width + 1.6,
    eaveY: eaveY - 0.05, topY: eaveY + rise,
    flare: 0.16, segU: 20, segV: 2,
    mat: 'tileB', round: true,
    capInst: site.capInst, tileCaps: true, capSpacing: 0.55,
    gableEnds: true, gableMat: 'plaster',
    bargeMat: 'ridgeDark',
    rafters: false,
  });

  B.pop();

  // 碰撞：柱子
  const rot = s.rotY || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (let i = 0; i <= bays; i++) {
    const x = -hw + stepX * i;
    for (const z of zs) {
      site.addCircle(s.pos[0] + x * cos + z * sin, s.pos[1] - x * sin + z * cos, 0.26, 'solid');
    }
  }
}

/* ---------------------------------------------------------------- 牌坊 */

export function buildPaifang(site, s) {
  const B = site.B;
  const [w, d] = s.size;
  const totalH = s.height || 8.6;
  const colXs = [-w / 2 + 1.2, -1.9, 1.9, w / 2 - 1.2];
  const beamY = totalH * 0.6;
  const mainRoofY = beamY + 1.0;
  const sideRoofY = beamY + 0.15;

  B.push(s.pos[0], 0, s.pos[1], s.rotY || 0);

  // 柱与柱础
  for (const x of colXs) {
    const isOuter = Math.abs(x) > w / 2 - 2;
    const h = isOuter ? beamY + 0.4 : beamY + 1.2;
    column(B, { x, z: 0, baseY: 0.25, h: h - 0.25, r: 0.3, plinthMat: 'stoneLight' });
    B.box('stoneDark', 0.9, 0.25, 0.9, x, 0.125, 0, { uv: 0.6 });
    B.box('stoneLight', 0.72, 0.18, 0.72, x, 0.3, 0, { uv: 0.6 });
    if (isOuter) {
      // 抱鼓石
      for (const zs of [-1, 1]) {
        B.cyl('stoneLight', 0.42, 0.5, 0.24, 10, x, 0.62, zs * (d / 2 + 0.18), { rx: Math.PI / 2 });
        B.box('stone', 0.5, 0.5, 0.9, x, 0.32, zs * (d / 2 + 0.1), { uv: 0.6 });
      }
    }
  }

  // 额枋两层 + 花板
  B.box('vermilionDark', w - 0.4, 0.34, 0.34, 0, beamY - 0.2, 0, { uv: 0.5 });
  B.box('vermilion', w - 0.6, 0.2, 0.28, 0, beamY + 0.62, 0, { uv: 0.5 });
  B.box('beamPaint', w - 0.8, 0.72, 0.2, 0, beamY + 0.12, 0, { uv: 0.5 });
  // 花板上的浮雕小格
  const decoN = 14;
  for (let i = 0; i < decoN; i++) {
    const x = -w / 2 + 0.9 + ((w - 1.8) / (decoN - 1)) * i;
    B.box('goldDim', 0.12, 0.24, 0.06, x, beamY + 0.14, 0.12, {});
    B.box('goldDim', 0.12, 0.24, 0.06, x, beamY + 0.14, -0.12, {});
  }
  // 斗拱
  const inst = site.dougongInst;
  if (inst) {
    for (let i = 0; i <= 10; i++) {
      const x = -w / 2 + 0.6 + ((w - 1.2) / 10) * i;
      _m.makeScale(1.25, 1.15, 1.25);
      _m.setPosition(x, beamY + 0.78, 0);
      inst.addAt(B, _m);
    }
  }

  // 中部高牌楼顶（庑殿）
  shell(B, {
    mat: 'tileA',
    eaveW: 5.6, eaveD: d + 1.1,
    topW: 2.8, topD: 0.18,
    eaveY: mainRoofY, topY: mainRoofY + 1.5,
    flare: 0.34, segU: 8, segV: 3,
    capInst: site.capInst, tileCaps: true, capSpacing: 0.4,
    hipRidge: true, hipMat: 'ridge', rafters: false, cornerHorn: true,
  });
  mainRidge(B, { length: 2.9, y: mainRoofY + 1.62, thin: true, chiwen: false });
  // 两侧低顶
  for (const side of [-1, 1]) {
    const cx = side * (w / 2 - 2.9);
    B.push(cx, 0, 0, 0);
    shell(B, {
      mat: 'tileB',
      eaveW: 3.9, eaveD: d + 0.9,
      topW: 1.7, topD: 0.16,
      eaveY: sideRoofY, topY: sideRoofY + 1.1,
      flare: 0.28, segU: 6, segV: 3,
      capInst: site.capInst, tileCaps: true, capSpacing: 0.4,
      hipRidge: true, hipMat: 'ridge', rafters: false, cornerHorn: true,
    });
    mainRidge(B, { length: 1.8, y: sideRoofY + 1.22, thin: true, chiwen: false });
    B.pop();
  }

  // 匾额
  if (s.plaque) {
    plaque(site, {
      text: s.plaque, w: 3.2, h: 0.78,
      x: 0, y: beamY + 1.34, z: d / 2 - 0.15,
      fontScale: 0.55, both: true,
    });
  }
  // 小挂灯
  for (const side of [-1, 1]) {
    lantern(B, { x: side * 2.4, y: beamY - 0.35, z: 0, r: 0.16 });
  }

  B.pop();

  // 碰撞：柱与抱鼓石
  const rot = s.rotY || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (const x of colXs) {
    site.addCircle(s.pos[0] + x * cos, s.pos[1] - x * sin, 0.42, 'solid');
  }
}

import * as THREE from 'three';
import {
  column, plinth, stairs, latticePanel, fretwork, plaque, lantern,
  benchRail, dougongGeometry,
} from './kit.js';
import { xieshan, gable, mainRidge, shell } from './roof.js';

/** 殿堂 / 厢房 / 门楼 / 楼阁 —— 统一由 layout.STRUCTURES 驱动 */

const _m = new THREE.Matrix4();

export function boxCollider(site, s, hx, hz, lx = 0, lz = 0, tag = 'solid') {
  const rot = s.rotY || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const wx = s.pos[0] + lx * cos + lz * sin;
  const wz = s.pos[1] - lx * sin + lz * cos;
  const c = Math.abs(cos);
  const sn = Math.abs(sin);
  site.addBox(wx, wz, hx * c + hz * sn + 0.3, hx * sn + hz * c + 0.3, tag);
}

function dougongRow(site, x0, x1, y, z, step = 1.05, scale = 1) {
  const inst = site.dougongInst;
  if (!inst) return;
  const n = Math.max(1, Math.round((x1 - x0) / step));
  for (let i = 0; i <= n; i++) {
    _m.makeScale(scale, scale, scale);
    _m.setPosition(x0 + ((x1 - x0) / n) * i, y, z);
    inst.addAt(site.B, _m);
  }
}

/** 檐下木作：额枋 + 平板枋 */
function beamLine(B, w, y, z, o = {}) {
  const mat = o.mat || 'vermilionDark';
  B.box(mat, w, 0.32, 0.26, 0, y, z, { uv: 0.5 });
  B.box('woodDark', w, 0.12, 0.32, 0, y + 0.24, z, { uv: 0.5 });
  if (o.purlins) {
    B.box('woodDark', w, 0.14, 0.16, 0, y - 0.36, z, {});
  }
}

/* ------------------------------------------------------------------ 大殿 */

export function buildHall(site, s, opts = {}) {
  const B = site.B;
  const [w, d] = s.size;
  const base = s.base != null ? s.base : 0.8;
  const totalH = s.height || 8;
  const rise = Math.min(4.4, Math.max(2.6, totalH * 0.5));
  const eaveY = totalH - rise;
  const bays = s.bays || 3;
  const porch = opts.porch != null ? opts.porch : 1.9;
  const wallH = eaveY - base - 0.42;
  const frontWallZ = d / 2 - porch;
  const pw = w + 2.5;
  const pd = d + 2.6;
  const roofMat = opts.roofMat || 'tileA';
  const wallMat = opts.wallMat || 'plaster';

  B.push(s.pos[0], 0, s.pos[1], s.rotY || 0);

  /* 台基与台阶 */
  plinth(B, { w: pw, d: pd, h: base, uv: 0.45 });
  B.push(0, 0, pd / 2, 0);
  stairs(B, { w: Math.min(4.2, w * 0.26), topY: base, steps: 4, run: 0.34 });
  B.pop();
  B.push(0, 0, -pd / 2, Math.PI);
  stairs(B, { w: Math.min(3.4, w * 0.2), topY: base, steps: 3, run: 0.3, side: false });
  B.pop();

  /* 柱子：前檐一列 + 两侧回廊柱 */
  const colH = eaveY - base - 0.25;
  const colZ = d / 2 - 0.5;
  const xs = [];
  for (let i = 0; i < bays; i++) {
    xs.push(-w / 2 + 0.62 + ((w - 1.24) / (bays - 1)) * i);
  }
  for (const x of xs) {
    column(B, { x, z: colZ, baseY: base, h: colH, r: 0.26 });
  }
  for (const side of [-1, 1]) {
    column(B, { x: side * (w / 2 - 0.62), z: frontWallZ + 0.1, baseY: base, h: colH, r: 0.24 });
    column(B, { x: side * (w / 2 - 0.62), z: -d / 2 + 0.5, baseY: base, h: colH, r: 0.24 });
  }

  /* 墙身 */
  const wallT = 0.42;
  // 后墙
  B.box(wallMat, w, wallH, wallT, 0, base + wallH / 2, -d / 2 + wallT / 2, { uv: 0.4 });
  // 两山墙
  const sideDepth = d - porch - 0.2;
  const sideCenter = (-d / 2 + frontWallZ) / 2;
  for (const side of [-1, 1]) {
    B.box(wallMat, wallT, wallH, sideDepth, side * (w / 2 - wallT / 2), base + wallH / 2, sideCenter, { uv: 0.4 });
    // 墙基青砖
    B.box('brick', wallT + 0.06, 0.8, sideDepth, side * (w / 2 - wallT / 2), base + 0.4, sideCenter, { uv: 0.6 });
  }
  // 前墙（隔扇门所在）
  B.box(wallMat, w, wallH, 0.36, 0, base + wallH * 0.55, frontWallZ, { uv: 0.4 });
  B.box('brick', w, 0.8, 0.42, 0, base + 0.4, frontWallZ, { uv: 0.6 });

  /* 隔扇门窗（每间再分 4~7 扇，形成中国传统立面节奏） */
  const doorH = Math.min(2.35, Math.max(1.85, wallH - 0.9));
  const transomH = Math.max(0.34, Math.min(0.62, wallH - doorH - 0.28));
  for (let i = 0; i < bays - 1; i++) {
    const x0 = xs[i] + 0.5;
    const x1 = xs[i + 1] - 0.5;
    const span = x1 - x0;
    const n = Math.max(2, Math.round(span / 1.08));
    const pw2 = span / n;
    const isCenter = i === Math.floor((bays - 1) / 2);
    for (let k = 0; k < n; k++) {
      const cx = x0 + pw2 * (k + 0.5);
      latticePanel(B, {
        w: pw2 - 0.07, h: doorH, x: cx, y: base, z: frontWallZ + 0.2,
        mat: isCenter ? 'latticeB' : 'latticeA',
      });
    }
    // 横披窗（整间一条）
    latticePanel(B, {
      w: span, h: transomH, x: (x0 + x1) / 2,
      y: base + doorH + 0.12, z: frontWallZ + 0.2,
      mat: 'latticeA', frame: true, uvY: 1,
    });
  }

  /* 檐下木作 */
  beamLine(B, w + 0.5, eaveY - 0.34, colZ);
  beamLine(B, w + 0.2, eaveY - 0.34, -d / 2 + 0.5);
  for (const side of [-1, 1]) {
    B.box('vermilionDark', 0.26, 0.32, d - 0.4, side * (w / 2 - 0.5), eaveY - 0.34, 0, { uv: 0.5 });
  }
  dougongRow(site, -w / 2 + 0.5, w / 2 - 0.5, eaveY - 0.02, colZ);
  dougongRow(site, -w / 2 + 0.5, w / 2 - 0.5, eaveY - 0.02, -d / 2 + 0.5, 1.05, 0.9);
  // 挂落
  for (let i = 0; i < bays - 1; i++) {
    const a = xs[i] + 0.3;
    const b = xs[i + 1] - 0.3;
    fretwork(B, { x0: a, x1: b, y: eaveY - 0.62, z: colZ, depth: 0.3 });
  }

  /* 屋顶 */
  xieshan(B, {
    w, d, eaveY: eaveY + 0.02, rise,
    eaveOverX: opts.eaveOverX || 1.15,
    eaveOverZ: opts.eaveOverZ || 1.35,
    mat: roofMat,
    flare: opts.flare != null ? opts.flare : 0.5,
    capInst: site.capInst,
    tileCaps: true,
    rafters: true,
    waistRatio: opts.waistRatio || [0.64, 0.46],
    upperScale: opts.upperScale || 0.92,
  });

  /* 匾额 + 挂灯 */
  if (s.plaque) {
    plaque(site, {
      text: s.plaque,
      w: Math.min(3.4, Math.max(1.9, s.plaque.length * 0.62)),
      h: 0.82,
      x: 0,
      y: eaveY - 1.02,
      z: colZ + 0.34,
      fontScale: 0.6,
    });
  }
  if (opts.lanterns !== false) {
    lantern(B, { x: -w * 0.28, y: eaveY - 1.35, z: colZ + 0.3 });
    lantern(B, { x: w * 0.28, y: eaveY - 1.35, z: colZ + 0.3 });
  }

  /* 楹联（泺源堂一联） */
  if (opts.couplets) {
    const cw = 0.34;
    const chh = 1.9;
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const tex = site.makePlaqueTexture({
        text: opts.couplets[i], vertical: true, size: 512, fontScale: 0.72,
        bg: 'rgba(30,24,18,0.94)', fg: '#e8d8a8',
      });
      const mat = site.mats.makePlaqueMaterial(tex);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cw, chh), mat);
      mesh.position.set(side * (w / 2 - 0.62), base + (eaveY - base) * 0.52, colZ + 0.3);
      B.addMesh(mesh);
    }
  }

  B.pop();

  /* 碰撞体 */
  boxCollider(site, s, pw / 2, pd / 2);
  return { eaveY, totalH };
}

/* ------------------------------------------------------------------ 厢房 */

export function buildWing(site, s) {
  const B = site.B;
  const [w, d] = s.size;
  const base = s.base != null ? s.base : 0.4;
  const totalH = s.height || 4.6;
  const eaveY = base + Math.min(2.9, totalH * 0.62);
  const rise = Math.max(1.0, totalH - eaveY);
  const wallH = eaveY - base - 0.2;
  const pw = w + 1.7;
  const pd = d + 1.7;

  B.push(s.pos[0], 0, s.pos[1], s.rotY || 0);
  plinth(B, { w: pw, d: pd, h: base, uv: 0.45 });
  B.push(0, 0, pd / 2, 0);
  stairs(B, { w: Math.min(2.4, w * 0.3), topY: base, steps: 2, run: 0.32, side: false });
  B.pop();

  const colH = eaveY - base - 0.22;
  const xs = [-w / 2 + 0.5, 0, w / 2 - 0.5];
  for (const x of xs) column(B, { x, z: d / 2 - 0.4, baseY: base, h: colH, r: 0.2 });
  for (const side of [-1, 1]) {
    column(B, { x: side * (w / 2 - 0.5), z: -d / 2 + 0.4, baseY: base, h: colH, r: 0.2 });
  }

  const wallZ = d / 2 - 1.05;
  B.box('plaster', w, wallH, 0.34, 0, base + wallH / 2, wallZ, { uv: 0.4 });
  B.box('brick', w, 0.62, 0.4, 0, base + 0.31, wallZ, { uv: 0.6 });
  B.box('plaster', w, wallH, 0.36, 0, base + wallH / 2, -d / 2 + 0.18, { uv: 0.4 });
  for (const side of [-1, 1]) {
    B.box('plaster', 0.36, wallH, d - 0.6, side * (w / 2 - 0.18), base + wallH / 2, -0.1, { uv: 0.4 });
    B.box('brick', 0.42, 0.62, d - 0.6, side * (w / 2 - 0.18), base + 0.31, -0.1, { uv: 0.6 });
  }
  // 门窗
  latticePanel(B, { w: 1.15, h: Math.min(2.1, wallH - 0.3), x: 0, y: base, z: wallZ + 0.18, mat: 'latticeB' });
  for (const side of [-1, 1]) {
    latticePanel(B, {
      w: Math.min(1.9, w * 0.2), h: 1.35, x: side * w * 0.3, y: base + 0.85,
      z: wallZ + 0.18, mat: 'latticeA',
    });
  }
  // 檐下
  beamLine(B, w + 0.3, eaveY - 0.28, d / 2 - 0.4);
  B.box('vermilionDark', 0.2, 0.26, d - 0.5, -(w / 2 - 0.4), eaveY - 0.28, 0, {});
  B.box('vermilionDark', 0.2, 0.26, d - 0.5, w / 2 - 0.4, eaveY - 0.28, 0, {});
  gable(B, {
    w: w + 0.9, d: d + 1.3,
    eaveY: eaveY - 0.02, topY: eaveY + rise,
    flare: 0.22, segU: 6, segV: 3,
    mat: 'tileB',
    capInst: site.capInst, tileCaps: true, capSpacing: 0.48,
    gableEnds: true, gableMat: 'plaster', bargeMat: 'ridgeDark',
    ridge: true, chiwen: false,
    rafters: false,
  });
  // 山墙小披檐
  B.pop();

  boxCollider(site, s, pw / 2, pd / 2);
}

/* ------------------------------------------------------------------ 门楼 */

export function buildGate(site, s) {
  const B = site.B;
  const [w, d] = s.size;
  const base = s.base != null ? s.base : 0.4;
  const totalH = s.height || 8.5;
  const isMain = !!s.main;
  const p = w >= 13 ? 6.6 : 6.2; // 中间门洞净宽（≥6m）
  const rise = Math.min(4.6, Math.max(2.1, totalH * 0.42));
  const eaveY = totalH - rise;
  const doorH = isMain ? 4.0 : 3.3;
  const wallH = eaveY - base - 0.7;
  const roofMat = isMain ? 'tileA' : 'tileB';

  B.push(s.pos[0], 0, s.pos[1], s.rotY || 0);

  /* 台基：两侧实体，中间留门道（地面平接） */
  const sideW = w / 2 - p / 2;
  for (const side of [-1, 1]) {
    const cx = side * (p / 2 + sideW / 2);
    plinth(B, { w: sideW, d, h: base, x: cx, uv: 0.45 });
    // 门道外侧台阶
    B.push(cx, 0, d / 2, 0);
    stairs(B, { w: Math.min(2.8, sideW * 0.9), topY: base, steps: 2, run: 0.3, side: false });
    B.pop();
  }
  // 门道石地面 + 门槛
  B.box('stoneLight', p + 0.4, 0.12, d + 1.4, 0, 0.06, 0, { uv: 0.6 });
  B.box('stoneDark', p + 0.2, 0.02, d + 1.5, 0, 0.13, 0, { uv: 0.6 });
  B.box('woodDark', p - 0.3, 0.13, 0.24, 0, 0.2, d / 2 + 0.1, {});
  B.box('woodDark', p - 0.3, 0.13, 0.24, 0, 0.2, -d / 2 - 0.1, {});

  /* 两侧墩台墙身 */
  for (const side of [-1, 1]) {
    const cx = side * (p / 2 + sideW / 2);
    const bodyH = eaveY - base;
    B.box('plaster', sideW - 0.05, bodyH, d - 0.06, cx, base + bodyH / 2, 0, { uv: 0.35 });
    B.box('brick', sideW, 1.0, d + 0.1, cx, base + 0.5, 0, { uv: 0.55 });
    // 侧墙垛口线条
    B.box('stoneLight', sideW + 0.14, 0.16, d + 0.14, cx, base + 1.02, 0, { uv: 0.5 });
    // 侧面漏窗
    const winW = Math.min(1.4, sideW * 0.5);
    for (const zs of [-1, 1]) {
      latticePanel(B, {
        w: winW, h: 1.1, x: cx + side * sideW * 0.18, y: base + 1.55,
        z: zs * (d / 2 - 0.03), mat: 'latticeA', frameMat: 'stoneLight',
      });
    }
  }

  /* 门道上方墙体（前后两面） */
  const upperH = eaveY - doorH - base;
  for (const zs of [-1, 1]) {
    B.box('plaster', p + 0.3, upperH, 0.5, 0, doorH + base + upperH / 2, zs * (d / 2 - 0.24), { uv: 0.35 });
    B.box('brick', p + 0.46, 0.55, 0.62, 0, base + doorH + 0.28, zs * (d / 2 - 0.22), { uv: 0.55 });
    // 门框
    B.box('woodRed', 0.26, doorH + 0.3, 0.5, -p / 2 + 0.13, base + (doorH + 0.3) / 2, zs * (d / 2 - 0.1), {});
    B.box('woodRed', 0.26, doorH + 0.3, 0.5, p / 2 - 0.13, base + (doorH + 0.3) / 2, zs * (d / 2 - 0.1), {});
    B.box('woodRed', p, 0.28, 0.5, 0, base + doorH + 0.16, zs * (d / 2 - 0.1), {});
    // 门簪
    for (let i = -1; i <= 1; i += 2) {
      B.cyl('goldDim', 0.1, 0.1, 0.24, 8, i * p * 0.22, base + doorH + 0.44, zs * (d / 2 - 0.05), { rx: Math.PI / 2 });
    }
  }
  /* 门道两侧木饰（贴在门洞左右壁上，不能横在门道中间） */
  for (const side of [-1, 1]) {
    for (const zs of [-1, 1]) {
      B.box('woodRed', 0.24, doorH + 0.4, 0.5, side * (p / 2 - 0.14), base + (doorH + 0.4) / 2, zs * (d / 2 - 0.5), {});
    }
  }
  /* 门道顶部木梁 + 天花 */
  for (const zs of [-1, 1]) {
    B.box('woodRed', p, 0.3, 0.4, 0, base + doorH + 0.32, zs * (d / 2 - 0.5), {});
  }
  B.box('woodDark', p, 0.14, d - 0.9, 0, base + doorH + 0.5, 0, {});

  /* 中柱与檐柱 */
  const colH = eaveY - base - 0.25;
  for (const zs of [-1, 1]) {
    for (const x of [-p / 2 - 0.05, p / 2 + 0.05]) {
      column(B, { x, z: zs * (d / 2 - 0.55), baseY: base, h: colH, r: 0.3 });
    }
    for (const side of [-1, 1]) {
      column(B, { x: side * (w / 2 - 0.65), z: zs * (d / 2 - 0.55), baseY: base, h: colH, r: 0.28 });
    }
  }

  /* 门扇（向内开启，门钉贴图，双面） */
  if (isMain) {
    const leafW = p / 2 - 0.3;
    const yC = base + doorH / 2;
    const open = 1.3;
    const s0 = Math.cos(open);
    const c0 = Math.sin(open);
    // 左扇：铰链在 -p/2，开向门内（-Z）
    B.plane('door', leafW, doorH - 0.1,
      -p / 2 + 0.16 + (leafW / 2) * s0,
      yC,
      d / 2 - 0.62 - (leafW / 2) * c0,
      { ry: open });
    // 右扇：铰链在 +p/2，镜像
    B.plane('door', leafW, doorH - 0.1,
      p / 2 - 0.16 - (leafW / 2) * s0,
      yC,
      d / 2 - 0.62 - (leafW / 2) * c0,
      { ry: Math.PI - open });
  }

  /* 檐下 */
  beamLine(B, w + 0.4, eaveY - 0.36, d / 2 - 0.55);
  beamLine(B, w + 0.4, eaveY - 0.36, -d / 2 + 0.55);
  dougongRow(site, -w / 2 + 0.5, w / 2 - 0.5, eaveY - 0.02, d / 2 - 0.55, 1.0, isMain ? 1.15 : 1);
  dougongRow(site, -w / 2 + 0.5, w / 2 - 0.5, eaveY - 0.02, -d / 2 + 0.55, 1.0, isMain ? 1.15 : 1);

  /* 屋顶 */
  xieshan(B, {
    w, d,
    eaveY: eaveY + 0.02,
    rise,
    eaveOverX: isMain ? 1.7 : 1.35,
    eaveOverZ: isMain ? 1.8 : 1.45,
    mat: roofMat,
    flare: isMain ? 0.62 : 0.48,
    capInst: site.capInst,
    tileCaps: true,
    rafters: true,
    waistRatio: isMain ? [0.62, 0.44] : [0.64, 0.46],
  });

  /* 匾额（前后两面） */
  if (s.plaque) {
    const pw3 = Math.min(3.6, Math.max(2.0, s.plaque.length * 0.66));
    for (const zs of [-1, 1]) {
      plaque(site, {
        text: s.plaque, w: pw3, h: 0.86,
        x: 0, y: base + doorH + 0.86,
        z: zs * (d / 2 + 0.16),
        ry: zs === -1 ? Math.PI : 0,
        fontScale: 0.6,
      });
    }
  }

  /* 挂灯 */
  lantern(B, { x: -p * 0.5 - 0.9, y: eaveY - 1.25, z: d / 2 - 0.4, r: isMain ? 0.24 : 0.2 });
  lantern(B, { x: p * 0.5 + 0.9, y: eaveY - 1.25, z: d / 2 - 0.4, r: isMain ? 0.24 : 0.2 });

  B.pop();

  /* 碰撞：只堵两侧墩台，中间门道通行 */
  const rot = s.rotY || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  for (const side of [-1, 1]) {
    const lx = side * (p / 2 + sideW / 2);
    const wx = s.pos[0] + lx * cos;
    const wz = s.pos[1] - lx * sin;
    const c = Math.abs(cos);
    const sn = Math.abs(sin);
    site.addBox(wx, wz, (sideW / 2) * c + (d / 2) * sn, (sideW / 2) * sn + (d / 2) * c);
  }
  return { p };
}

/* ------------------------------------------------------------------ 楼阁 */

export function buildTower(site, s) {
  const B = site.B;
  const [w, d] = s.size;
  const base = s.base != null ? s.base : 0.6;
  const totalH = s.height || 10;
  const rise = Math.min(4.6, Math.max(2.6, totalH * 0.4));
  const eaveY2 = totalH - rise;
  const eaveY1 = base + (eaveY2 - base) * 0.46;
  const w2 = w - 2.4;
  const d2 = d - 1.6;
  const pw = w + 2.4;
  const pd = d + 2.2;

  B.push(s.pos[0], 0, s.pos[1], s.rotY || 0);

  plinth(B, { w: pw, d: pd, h: base, uv: 0.45 });
  B.push(0, 0, pd / 2, 0);
  stairs(B, { w: 3.0, topY: base, steps: 4, run: 0.34 });
  B.pop();

  /* 一层 */
  const colH1 = eaveY1 - base - 0.25;
  for (const x of [-w / 2 + 0.6, -w * 0.16, w * 0.16, w / 2 - 0.6]) {
    column(B, { x, z: d / 2 - 0.5, baseY: base, h: colH1, r: 0.26 });
    column(B, { x, z: -d / 2 + 0.5, baseY: base, h: colH1, r: 0.26 });
  }
  const wallH1 = eaveY1 - base - 0.3;
  B.box('plaster', w, wallH1, 0.4, 0, base + wallH1 / 2, d / 2 - 1.75, { uv: 0.4 });
  B.box('plaster', w, wallH1, 0.4, 0, base + wallH1 / 2, -d / 2 + 0.2, { uv: 0.4 });
  for (const side of [-1, 1]) {
    B.box('plaster', 0.4, wallH1, d - 1.4, side * (w / 2 - 0.2), base + wallH1 / 2, 0, { uv: 0.4 });
    B.box('brick', 0.46, 0.9, d - 1.4, side * (w / 2 - 0.2), base + 0.45, 0, { uv: 0.6 });
  }
  for (const x of [-w * 0.32, 0, w * 0.32]) {
    latticePanel(B, {
      w: Math.min(2.0, w * 0.18), h: 2.4, x, y: base,
      z: d / 2 - 1.75 + 0.22, mat: 'latticeB',
    });
  }
  beamLine(B, w + 0.3, eaveY1 - 0.32, d / 2 - 0.5);
  beamLine(B, w + 0.3, eaveY1 - 0.32, -d / 2 + 0.5);
  dougongRow(site, -w / 2 + 0.5, w / 2 - 0.5, eaveY1 - 0.02, d / 2 - 0.5, 1.1, 0.95);
  dougongRow(site, -w / 2 + 0.5, w / 2 - 0.5, eaveY1 - 0.02, -d / 2 + 0.5, 1.1, 0.95);

  /* 腰檐 */
  shell(B, {
    mat: 'tileB', eaveW: w + 2.6, eaveD: d + 2.6,
    topW: w2 + 0.4, topD: d2 + 0.4,
    eaveY: eaveY1 + 0.02, topY: eaveY1 + 0.62,
    flare: 0.42, segU: 10, segV: 3,
    capInst: site.capInst, tileCaps: true, capSpacing: 0.46,
    hipRidge: true, hipMat: 'ridge', rafters: false,
    cornerHorn: true,
  });

  /* 二层 */
  const y2 = eaveY1 + 0.55;
  const colH2 = eaveY2 - y2 - 0.2;
  B.box('brick', w2, 0.22, d2, 0, y2 - 0.05, 0, { uv: 0.6 });
  // 栏杆
  const railY = y2 + 0.12;
  for (const side of [-1, 1]) {
    B.box('stoneLight', w2 + 0.6, 0.1, 0.16, 0, railY + 0.82, side * (d2 / 2 + 0.28), {});
    B.box('stoneLight', 0.16, 0.1, d2 + 0.6, side * (w2 / 2 + 0.28), railY + 0.82, 0, {});
  }
  const railN = Math.round(w2 / 1.2);
  for (let i = 0; i <= railN; i++) {
    const x = -w2 / 2 + (w2 / railN) * i;
    for (const side of [-1, 1]) {
      B.box('stoneLight', 0.14, 0.86, 0.14, x, railY + 0.44, side * (d2 / 2 + 0.28), {});
    }
  }
  const railNz = Math.round(d2 / 1.2);
  for (let i = 0; i <= railNz; i++) {
    const z = -d2 / 2 + (d2 / railNz) * i;
    for (const side of [-1, 1]) {
      B.box('stoneLight', 0.14, 0.86, 0.14, side * (w2 / 2 + 0.28), railY + 0.44, z, {});
    }
  }
  // 二层墙与门窗
  const wallH2 = eaveY2 - y2 - 0.35;
  B.box('plaster', w2, wallH2, 0.36, 0, y2 + wallH2 / 2, d2 / 2 - 1.35, { uv: 0.4 });
  B.box('plaster', w2, wallH2, 0.36, 0, y2 + wallH2 / 2, -d2 / 2 + 0.18, { uv: 0.4 });
  for (const side of [-1, 1]) {
    B.box('plaster', 0.36, wallH2, d2 - 1.2, side * (w2 / 2 - 0.18), y2 + wallH2 / 2, 0, { uv: 0.4 });
  }
  for (const x of [-w2 * 0.3, 0, w2 * 0.3]) {
    latticePanel(B, {
      w: Math.min(1.8, w2 * 0.2), h: 2.0, x, y: y2,
      z: d2 / 2 - 1.35 + 0.2, mat: 'latticeA',
    });
  }
  for (const x of [-w2 / 2 + 0.5, w2 / 2 - 0.5]) {
    for (const z of [d2 / 2 - 0.45, -d2 / 2 + 0.45]) {
      column(B, { x, z, baseY: y2, h: colH2, r: 0.24 });
    }
  }
  for (const x of [-w2 * 0.3, 0, w2 * 0.3]) {
    column(B, { x, z: d2 / 2 - 0.45, baseY: y2, h: colH2, r: 0.24 });
  }
  beamLine(B, w2 + 0.6, eaveY2 - 0.3, d2 / 2 - 0.45);
  dougongRow(site, -w2 / 2 + 0.4, w2 / 2 - 0.4, eaveY2 - 0.02, d2 / 2 - 0.45, 1.0, 0.9);

  /* 上层屋顶 */
  xieshan(B, {
    w: w2 + 0.4, d: d2 + 0.2, eaveY: eaveY2 + 0.02, rise,
    eaveOverX: 1.25, eaveOverZ: 1.45,
    mat: 'tileA', flare: 0.55,
    capInst: site.capInst, tileCaps: true,
    rafters: true,
    waistRatio: [0.66, 0.5],
  });

  if (s.plaque) {
    plaque(site, {
      text: s.plaque, w: 2.6, h: 0.78,
      x: 0, y: eaveY2 - 0.95, z: d2 / 2 - 0.1,
      fontScale: 0.6,
    });
  }
  lantern(B, { x: -w * 0.3, y: eaveY2 - 1.2, z: d2 / 2 });
  lantern(B, { x: w * 0.3, y: eaveY2 - 1.2, z: d2 / 2 });

  B.pop();
  boxCollider(site, s, pw / 2, pd / 2);
  return { eaveY1, eaveY2 };
}

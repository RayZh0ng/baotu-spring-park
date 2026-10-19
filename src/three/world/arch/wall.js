import * as THREE from 'three';
import { WALL_SEGMENTS, STRUCTURES } from '../../layout.js';
import { column, plaque, lantern } from './kit.js';
import { buildHall, buildWing, buildTower } from './hall.js';
import { gable } from './roof.js';

/**
 * 围墙 / 院墙 / 院门（B 号建筑模块的补充）
 * ------------------------------------------------------------
 *  - 公园四周：青砖墙基 + 白灰墙身 + 灰瓦墙帽 + 壁柱，4.4m 高
 *  - 院落：3m 院墙 + 瓦帽，门洞处建门楼（朱柱、灰瓦、匾额），门洞净宽 ≥ 5m 可通行
 */

const _v = new THREE.Vector3();

/** 一段墙（轴对齐）：从 (x0,z0) 到 (x1,z1) */
function wallRun(site, x0, z0, x1, z1, opts = {}) {
  const {
    height = 4.4,
    thickness = 1.0,
    bodyMat = 'plaster',
    baseMat = 'brick',
    capMat = 'tileB',
    ridgeMat = 'ridge',
    pilasters = true,
    pilasterEvery = 6,
    capOverhang = 0.55,
    snow = true,
  } = opts;

  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const ry = Math.atan2(-dz, dx);
  const B = site.B;
  const t = thickness;

  B.push(mx, 0, mz, ry);

  /* 墙基（青砖） */
  B.box('stoneDark', len, 0.18, t + 0.24, 0, 0.09, 0, { uv: 0.6 });
  B.box(baseMat, len, 0.72, t + 0.1, 0, 0.18 + 0.36, 0, { uv: 0.55 });

  /* 墙身（白灰） */
  const bodyH = height - 0.9 - 0.5;
  B.box(bodyMat, len, bodyH, t * 0.84, 0, 0.9 + bodyH / 2, 0, { uv: 0.34 });

  /* 壁柱 */
  if (pilasters && len > 3.5) {
    const n = Math.max(1, Math.round(len / pilasterEvery));
    for (let i = 0; i <= n; i++) {
      const x = -len / 2 + (len / n) * i;
      B.box('brick', 0.5, bodyH + 0.1, t * 0.96, x, 0.9 + bodyH / 2, 0, { uv: 0.6 });
      B.box('stoneLight', 0.62, 0.14, t * 1.02, x, height - 0.56, 0, { uv: 0.5 });
    }
  }

  /* 墙帽：两坡瓦 + 正脊 */
  const capY = height - 0.46;
  const capW = t + capOverhang * 2;
  const half = capW / 2;
  const slope = 0.34;
  // 两片斜瓦
  B.box(capMat, len + 0.2, 0.12, half * 1.02, 0, capY + 0.16, -half * 0.5, { rx: -slope, uv: 0.6 });
  B.box(capMat, len + 0.2, 0.12, half * 1.02, 0, capY + 0.16, half * 0.5, { rx: slope, uv: 0.6 });
  // 瓦当收边
  B.box(ridgeMat, len + 0.24, 0.1, 0.16, 0, capY + 0.02, -half, { uv: 0.5 });
  B.box(ridgeMat, len + 0.24, 0.1, 0.16, 0, capY + 0.02, half, { uv: 0.5 });
  // 正脊
  B.box(ridgeMat, len + 0.26, 0.22, 0.34, 0, capY + 0.34, 0, { uv: 0.5 });
  B.box(ridgeMat, len + 0.1, 0.1, 0.2, 0, capY + 0.48, 0, { uv: 0.5 });

  B.pop();

  /* 碰撞体（轴对齐） */
  if (Math.abs(dx) >= Math.abs(dz)) {
    site.addBox(mx, mz, len / 2, t / 2 + 0.12);
  } else {
    site.addBox(mx, mz, t / 2 + 0.12, len / 2);
  }
}

/** 公园围墙（含三门缺口，缺口由 layout.WALL_SEGMENTS 决定） */
export function buildPerimeterWalls(site) {
  for (const w of WALL_SEGMENTS) {
    const alongX = w.hx > w.hz;
    if (alongX) {
      wallRun(site, w.x - w.hx, w.z, w.x + w.hx, w.z, {
        height: 4.4,
        thickness: w.hz * 2,
        pilasterEvery: 7,
      });
    } else {
      wallRun(site, w.x, w.z - w.hz, w.x, w.z + w.hz, {
        height: 4.4,
        thickness: w.hx * 2,
        pilasterEvery: 7,
      });
    }
  }
}

/** 院落门楼：门洞净宽 5.2m，朱柱、灰瓦、匾额 */
function compoundGate(site, s) {
  const B = site.B;
  const [gx, gz] = s.gate;
  const facing = s.gateFacing || 'east';
  const gateW = 5.2;
  const ry = facing === 'east' ? Math.PI / 2 : facing === 'south' ? 0 : facing === 'north' ? Math.PI : -Math.PI / 2;

  B.push(gx, 0, gz, ry);

  /* 两侧门柱墩 */
  for (const side of [-1, 1]) {
    const x = side * (gateW / 2 + 0.55);
    B.box('stoneLight', 1.1, 0.3, 1.7, x, 0.15, 0, { uv: 0.6 });
    B.box('plaster', 1.0, 3.1, 1.5, x, 1.55, 0, { uv: 0.4 });
    B.box('brick', 1.06, 0.8, 1.56, x, 0.55, 0, { uv: 0.55 });
    B.box('stoneLight', 1.16, 0.14, 1.62, x, 3.12, 0, { uv: 0.5 });
    site.addBox(gx + x * Math.cos(ry), gz - x * Math.sin(ry), 0.55, 0.8);
  }
  /* 门洞上方额枋 + 匾额 */
  B.box('woodRed', gateW + 2.4, 0.34, 0.4, 0, 3.36, 0, {});
  B.box('woodDark', gateW + 2.2, 0.16, 0.3, 0, 3.06, 0, {});
  if (s.plaque) {
    plaque(site, { text: s.plaque, w: 2.2, h: 0.78, x: 0, y: 3.92, z: 0.24, fontScale: 0.6 });
  }
  /* 门楼屋顶（小歇山） */
  gable(B, {
    mat: 'tileB',
    w: gateW + 2.6,
    d: 3.2,
    eaveY: 4.06,
    topY: 5.35,
    flare: 0.42,
    segU: 8,
    segV: 3,
    capInst: site.capInst,
    tileCaps: true,
    capSpacing: 0.5,
    gableEnds: true,
    gableMat: 'plaster',
    bargeMat: 'ridgeDark',
    ridge: true,
    chiwen: false,
    rafters: false,
  });
  /* 檐下挂灯 */
  lantern(B, { x: -gateW / 2 - 0.5, y: 2.9, z: 0.5, r: 0.18 });
  lantern(B, { x: gateW / 2 + 0.5, y: 2.9, z: 0.5, r: 0.18 });
  B.pop();
}

/** 院落（院墙 + 门楼 + 内部建筑） */
export function buildCompound(site, s) {
  const [x0, z0, x1, z1] = s.rect;
  const H = s.wallHeight || 3.0;
  const gateW = 5.2;
  const [gx, gz] = s.gate;
  const facing = s.gateFacing || 'east';

  if (facing === 'east') {
    // 东墙留门
    wallRun(site, x1, z0, x1, gz - gateW / 2, { height: H, thickness: 0.5, pilasterEvery: 5 });
    wallRun(site, x1, gz + gateW / 2, x1, z1, { height: H, thickness: 0.5, pilasterEvery: 5 });
  } else if (facing === 'west') {
    wallRun(site, x0, z0, x0, gz - gateW / 2, { height: H, thickness: 0.5 });
    wallRun(site, x0, gz + gateW / 2, x0, z1, { height: H, thickness: 0.5 });
  } else if (facing === 'north') {
    wallRun(site, x0, z0, gx - gateW / 2, z0, { height: H, thickness: 0.5, pilasterEvery: 5 });
    wallRun(site, gx + gateW / 2, z0, x1, z0, { height: H, thickness: 0.5, pilasterEvery: 5 });
  } else {
    wallRun(site, x0, z1, gx - gateW / 2, z1, { height: H, thickness: 0.5, pilasterEvery: 5 });
    wallRun(site, gx + gateW / 2, z1, x1, z1, { height: H, thickness: 0.5, pilasterEvery: 5 });
  }
  // 其余三面
  if (facing !== 'north') wallRun(site, x0, z0, x1, z0, { height: H, thickness: 0.5, pilasterEvery: 5 });
  if (facing !== 'south') wallRun(site, x0, z1, x1, z1, { height: H, thickness: 0.5, pilasterEvery: 5 });
  if (facing !== 'east') wallRun(site, x1, z0, x1, z1, { height: H, thickness: 0.5, pilasterEvery: 5 });
  if (facing !== 'west') wallRun(site, x0, z0, x0, z1, { height: H, thickness: 0.5, pilasterEvery: 5 });

  compoundGate(site, s);

  // 院内建筑
  for (const hall of s.halls || []) {
    if (hall.type === 'hall') buildHall(site, hall, { roofMat: 'tileB', eaveOverX: 1.1, eaveOverZ: 1.3 });
    else if (hall.type === 'wing') buildWing(site, hall);
    else if (hall.type === 'tower') buildTower(site, hall);
  }

  // 院落铺地（轻量，避免院内全是草地）
  const B = site.B;
  B.push(0, 0, 0, 0);
  const pw = x1 - x0 - 2.2;
  const pd = z1 - z0 - 2.2;
  const g = new THREE.PlaneGeometry(pw, pd);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * pw * 0.5, uv.getY(i) * pd * 0.5);
  B.addGeo('paving', g, new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition((x0 + x1) / 2, 0.03, (z0 + z1) / 2));
  B.pop();
}

export { wallRun };

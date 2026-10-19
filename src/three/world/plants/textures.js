import * as THREE from 'three';
import { makeCanvasTexture, hexA } from '../../utils/tex.js';
import { mulberry32 } from '../../utils/random.js';
import { COLORS } from '../../utils/palette.js';

/**
 * 植被专用程序化贴图（全部 canvas 绘制，无外部资源）。
 * 模块级缓存：多个构建器共享同一张纹理，避免重复上传 GPU。
 */

const _cache = new Map();

function cached(key, make) {
  let t = _cache.get(key);
  if (!t) {
    t = make();
    _cache.set(key, t);
  }
  return t;
}

export function disposeTextures() {
  for (const t of _cache.values()) {
    if (t && t.dispose) t.dispose();
  }
  _cache.clear();
}

/* ------------------------------------------------------------------ 绘制小工具 */

/** 透明底色的“防黑边”处理：让 mipmap 平均值保持植物色而非黑色 */
function bleed(ctx, w, h, hex, alpha = 0.014) {
  ctx.fillStyle = hexA(hex, alpha);
  ctx.fillRect(0, 0, w, h);
}

/** 画一片叶（角度 0 = 指向 -y 上方） */
function leaf(ctx, x, y, len, wid, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid, -len * 0.46, 0, -len);
  ctx.quadraticCurveTo(-wid, -len * 0.46, 0, 0);
  ctx.fill();
  ctx.restore();
}

function pickC(rand, arr) {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
}

function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/* ------------------------------------------------------------------ 树皮 */

export function barkTexture(variant = 'willow') {
  return cached(`bark-${variant}`, () => {
    const willow = variant === 'willow';
    const tint = willow ? [96, 84, 70] : [78, 66, 56];
    const rand = mulberry32(willow ? 31 : 77);
    return makeCanvasTexture(256, 256, (ctx) => {
      ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
      ctx.fillRect(0, 0, 256, 256);
      // 竖向树皮沟壑
      for (let i = 0; i < 90; i++) {
        const x = rand() * 256;
        const w = 1 + rand() * 3.4;
        const y = rand() * 256;
        const len = 30 + rand() * 170;
        ctx.strokeStyle = rand() > 0.45
          ? `rgba(${tint[0] - 34},${tint[1] - 30},${tint[2] - 24},${0.28 + rand() * 0.3})`
          : `rgba(${tint[0] + 34},${tint[1] + 30},${tint[2] + 24},${0.12 + rand() * 0.18})`;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + (rand() - 0.5) * 9, y + len * 0.33, x + (rand() - 0.5) * 9, y + len * 0.66, x + (rand() - 0.5) * 6, y + len);
        ctx.stroke();
      }
      // 横向裂纹 / 皮孔
      for (let i = 0; i < 70; i++) {
        const x = rand() * 256;
        const y = rand() * 256;
        ctx.fillStyle = `rgba(28,24,20,${0.16 + rand() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 1 + rand() * 3.4, 0.6 + rand() * 1.1, rand() * 3.14, 0, Math.PI * 2);
        ctx.fill();
      }
      // 苔痕（少量，靠下）
      for (let i = 0; i < 40; i++) {
        const x = rand() * 256;
        const y = 150 + rand() * 106;
        ctx.fillStyle = `rgba(${70 + rand() * 35},${95 + rand() * 30},${52 + rand() * 20},${rand() * 0.16})`;
        ctx.beginPath();
        ctx.arc(x, y, 1 + rand() * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { repeat: [1, 1], wrap: THREE.RepeatWrapping, anisotropy: 4 });
  });
}

/* ------------------------------------------------------------------ 垂柳 */

export function willowCurtainTexture(seed = 5) {
  return cached(`willow-curtain-${seed}`, () => {
    const W = 256;
    const H = 768;
    const rand = mulberry32(seed);
    return makeCanvasTexture(W, H, (ctx) => {
      bleed(ctx, W, H, '#7f9a52', 0.008);
      const base = ['#6f8a4a', '#7a9450', '#647f42', '#829c55', '#5d7840'];
      const light = ['#8fa85e', '#98b168', '#a4bb74', '#7f9a52'];
      const strands = 14;
      for (let s = 0; s < strands; s++) {
        let x = W * 0.5 + (rand() - 0.5) * W * 0.72;
        let y = rand() * 16;
        const sway = (rand() - 0.5) * 20;
        const hue = pickC(rand, base);
        // 茎
        ctx.strokeStyle = hexA('#6c7f45', 0.5);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const ctrlX = x + sway;
        ctx.bezierCurveTo(ctrlX, H * 0.36, x - sway * 0.7, H * 0.72, x + sway * 0.4, H * (0.8 + rand() * 0.18));
        ctx.stroke();
        // 叶片沿茎分布
        const leaves = 34 + Math.floor(rand() * 18);
        for (let i = 0; i < leaves; i++) {
          const t = i / leaves;
          const yy = y + 12 + t * (H * 0.9 - y);
          const drift = Math.sin(t * Math.PI * 1.6) * sway * 1.4;
          const xx = x + drift + (rand() - 0.5) * 5;
          const side = i % 2 ? 1 : -1;
          const ang = side * (0.5 + rand() * 0.5) + (rand() - 0.5) * 0.4;
          const len = 26 + rand() * 20 * (1 - t * 0.25);
          const wid = 4.2 + rand() * 2.6;
          leaf(ctx, xx, yy, len, wid, ang, rand() > 0.72 ? pickC(rand, light) : hue);
        }
      }
      // 零星亮叶
      for (let i = 0; i < 70; i++) {
        leaf(ctx, rand() * W, 40 + rand() * (H - 60), 16 + rand() * 16, 4, (rand() - 0.5) * 2.6, pickC(rand, light));
      }
    }, { colorSpace: true, anisotropy: 8, wrap: THREE.ClampToEdgeWrapping });
  });
}

/* ------------------------------------------------------------------ 竹 */

export function bambooLeafTexture() {
  return cached('bamboo-leaf', () => {
    const S = 128;
    const rand = mulberry32(19);
    return makeCanvasTexture(S, S, (ctx) => {
      bleed(ctx, S, S, '#52713f', 0.012);
      const dark = ['#3f5a32', '#4e6b3e', '#435f36'];
      const mid = ['#5d7d4c', '#6b8a52', '#547244'];
      const lite = ['#8aa262', '#7d9a55'];
      for (let t = 0; t < 5; t++) {
        const cx = S * (0.2 + rand() * 0.6);
        const cy = S * (0.28 + rand() * 0.44);
        const dir = rand() * Math.PI * 2;
        // 小枝
        ctx.strokeStyle = 'rgba(74,88,52,0.8)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(dir) * 8, cy - Math.sin(dir) * 8);
        ctx.lineTo(cx + Math.cos(dir) * 10, cy + Math.sin(dir) * 10);
        ctx.stroke();
        const n = 3 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const a = dir + (i - (n - 1) / 2) * 0.42 + (rand() - 0.5) * 0.16;
          const len = 40 + rand() * 24;
          const wid = 4.4 + rand() * 2.2;
          const ox = cx + Math.cos(dir) * (4 + i * 2);
          const oy = cy + Math.sin(dir) * (4 + i * 2);
          // 竹叶：窄长、尖端更尖
          leaf(ctx, ox, oy, len, wid, a - Math.PI / 2, pickC(rand, i % 2 ? mid : dark));
          leaf(ctx, ox, oy, len * 0.82, wid * 0.72, a - Math.PI / 2 + 0.08, pickC(rand, i % 3 ? lite : mid));
          // 叶脉
          ctx.strokeStyle = 'rgba(210,225,170,0.20)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ox + Math.cos(a - Math.PI / 2) * len * 0.9, oy + Math.sin(a - Math.PI / 2) * len * 0.9);
          ctx.stroke();
        }
      }
    }, { colorSpace: true, anisotropy: 4 });
  });
}

export function bambooCulmTexture() {
  return cached('bamboo-culm', () => {
    const W = 64;
    const H = 256;
    const rand = mulberry32(23);
    return makeCanvasTexture(W, H, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#4c6639');
      grad.addColorStop(0.22, '#68864c');
      grad.addColorStop(0.5, '#7d9a58');
      grad.addColorStop(0.78, '#5f7d45');
      grad.addColorStop(1, '#455e33');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      // 竖向纤维
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = `rgba(${210 + rand() * 20},${225 + rand() * 20},${170},${0.03 + rand() * 0.07})`;
        ctx.lineWidth = 0.6 + rand();
        const x = rand() * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (rand() - 0.5) * 3, H);
        ctx.stroke();
      }
      // 竹节（横向节环 + 下方白粉带 + 上方暗环）
      const nodes = [18, 52, 88, 122, 158, 194, 228, 250];
      for (const y of nodes) {
        ctx.fillStyle = 'rgba(38,52,28,0.72)';
        ctx.fillRect(0, y - 2, W, 2.6);
        ctx.fillStyle = 'rgba(230,238,205,0.30)';
        ctx.fillRect(0, y - 5.5, W, 2.4);
        ctx.fillStyle = 'rgba(30,42,22,0.28)';
        ctx.fillRect(0, y + 1, W, 1.4);
      }
      // 斑点
      for (let i = 0; i < 50; i++) {
        ctx.fillStyle = `rgba(40,54,30,${0.05 + rand() * 0.12})`;
        ctx.beginPath();
        ctx.ellipse(rand() * W, rand() * H, 0.8 + rand() * 2, 0.5 + rand() * 1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { colorSpace: true, wrap: THREE.RepeatWrapping, anisotropy: 4 });
  });
}

/* ------------------------------------------------------------------ 松 */

export function pineNeedleTexture() {
  return cached('pine-needle', () => {
    const S = 128;
    const rand = mulberry32(41);
    return makeCanvasTexture(S, S, (ctx) => {
      bleed(ctx, S, S, '#3a4c38', 0.012);
      const darks = ['#2f4033', '#38493a', '#26382c'];
      const mids = ['#3f5240', '#4a5e46', '#546a4c'];
      const lites = ['#6b8160', '#7d926e', '#8fa07a'];
      const tufts = 6;
      for (let t = 0; t < tufts; t++) {
        const cx = S * (0.24 + rand() * 0.52);
        const cy = S * (0.26 + rand() * 0.48);
        const rad = 16 + rand() * 16;
        // 小枝
        ctx.strokeStyle = 'rgba(92,80,60,0.65)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(cx, cy, rad * 0.7, rand() * 3, rand() * 3 + 2.4);
        ctx.stroke();
        const needles = 34;
        for (let i = 0; i < needles; i++) {
          const a = rand() * Math.PI * 2;
          const r0 = rad * (0.18 + rand() * 0.3);
          const r1 = rad * (0.65 + rand() * 0.55);
          const x0 = cx + Math.cos(a) * r0;
          const y0 = cy + Math.sin(a) * r0;
          const x1 = cx + Math.cos(a + (rand() - 0.5) * 0.32) * r1;
          const y1 = cy + Math.sin(a + (rand() - 0.5) * 0.32) * r1;
          const r = rand();
          ctx.strokeStyle = r > 0.82 ? pickC(rand, lites) : r > 0.3 ? pickC(rand, mids) : pickC(rand, darks);
          ctx.lineWidth = 0.75 + rand() * 0.7;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo((x0 + x1) / 2 + (rand() - 0.5) * 5, (y0 + y1) / 2, x1, y1);
          ctx.stroke();
        }
      }
      // 松塔 / 芽点
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `rgba(120,96,64,${0.4 + rand() * 0.3})`;
        ctx.beginPath();
        ctx.ellipse(rand() * S, rand() * S, 1.6 + rand() * 1.6, 1 + rand(), rand(), 0, Math.PI * 2);
        ctx.fill();
      }
    }, { colorSpace: true, anisotropy: 4 });
  });
}

/* ------------------------------------------------------------------ 海棠 / 花木 */

export function blossomTexture(variant = 'pink') {
  return cached(`blossom-${variant}`, () => {
    const S = 128;
    const rand = mulberry32(variant === 'pink' ? 57 : 61);
    const petals = variant === 'pink'
      ? ['#e6b7bd', '#edc8ce', '#dda3ad', '#f2d6da']
      : ['#f2e9e6', '#f7f1ee', '#e8dcd8', '#fbf7f4'];
    const deep = variant === 'pink' ? '#c98692' : '#d8c4be';
    return makeCanvasTexture(S, S, (ctx) => {
      bleed(ctx, S, S, '#d8b8bc', 0.01);
      // 枝条
      ctx.strokeStyle = 'rgba(98,74,52,0.75)';
      ctx.lineWidth = 1.4;
      for (let b = 0; b < 4; b++) {
        const x0 = S * (0.2 + rand() * 0.6);
        const y0 = S * (0.2 + rand() * 0.6);
        const a = rand() * Math.PI * 2;
        const len = 25 + rand() * 26;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x0 + Math.cos(a) * len * 0.5 + 4, y0 + Math.sin(a) * len * 0.5 - 4, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
        ctx.stroke();
      }
      const flowers = 24;
      for (let i = 0; i < flowers; i++) {
        const cx = 12 + rand() * (S - 24);
        const cy = 12 + rand() * (S - 24);
        const pr = 4 + rand() * 3.2;
        const c = pickC(rand, petals);
        const nPet = 5;
        for (let p = 0; p < nPet; p++) {
          const a = (p / nPet) * Math.PI * 2 + rand() * 0.3;
          const px = cx + Math.cos(a) * pr * 0.62;
          const py = cy + Math.sin(a) * pr * 0.62;
          ctx.fillStyle = p === 0 ? shadeHex(c, 0.96) : c;
          ctx.beginPath();
          ctx.ellipse(px, py, pr * 0.62, pr * 0.42, a, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = hexA(deep, 0.28);
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
        ctx.fillStyle = '#d9b45e';
        ctx.beginPath();
        ctx.arc(cx, cy, pr * 0.24, 0, Math.PI * 2);
        ctx.fill();
        // 花蕊
        ctx.strokeStyle = 'rgba(180,140,60,0.55)';
        ctx.lineWidth = 0.5;
        for (let s = 0; s < 5; s++) {
          const a = rand() * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * pr * 0.5, cy + Math.sin(a) * pr * 0.5);
          ctx.stroke();
        }
      }
      // 花苞
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = hexA(deep, 0.85);
        ctx.beginPath();
        ctx.arc(12 + rand() * (S - 24), 12 + rand() * (S - 24), 1.6 + rand() * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // 嫩叶
      for (let i = 0; i < 20; i++) {
        leaf(ctx, rand() * S, rand() * S, 7 + rand() * 6, 2.4, (rand() - 0.5) * 3, pickC(rand, ['#7d9a4e', '#8aa65a', '#6d8b47']));
      }
    }, { colorSpace: true, anisotropy: 4 });
  });
}

/* ------------------------------------------------------------------ 红枫 */

export function mapleTexture() {
  return cached('maple', () => {
    const S = 128;
    const rand = mulberry32(67);
    const tones = ['#b05a3a', '#c46a3f', '#a34b33', '#d08348', '#b8623c'];
    return makeCanvasTexture(S, S, (ctx) => {
      bleed(ctx, S, S, '#a85638', 0.01);
      // 细枝
      ctx.strokeStyle = 'rgba(84,62,46,0.7)';
      ctx.lineWidth = 1.2;
      for (let b = 0; b < 5; b++) {
        const x0 = S * (0.3 + rand() * 0.4);
        const y0 = S * (0.3 + rand() * 0.4);
        const a = rand() * Math.PI * 2;
        const len = 20 + rand() * 30;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
        ctx.stroke();
      }
      for (let i = 0; i < 17; i++) {
        const cx = 10 + rand() * (S - 20);
        const cy = 10 + rand() * (S - 20);
        drawMapleLeaf(ctx, cx, cy, 8 + rand() * 8, rand() * Math.PI * 2, pickC(rand, tones));
      }
    }, { colorSpace: true, anisotropy: 4 });
  });
}

function drawMapleLeaf(ctx, x, y, r, rot, color) {
  const pts = [
    [0, 0],
    [0.26, 0.1],
    [0.2, 0.42],
    [0.52, 0.24],
    [0.46, 0.62],
    [0.92, 0.4],
    [0.66, 0.78],
    [1.0, 0.88],
    [0.42, 1.0],
    [0, 0.72],
    [-0.42, 1.0],
    [-1.0, 0.88],
    [-0.66, 0.78],
    [-0.92, 0.4],
    [-0.46, 0.62],
    [-0.52, 0.24],
    [-0.2, 0.42],
    [-0.26, 0.1],
  ];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const px = pts[i][0] * r;
    const py = -pts[i][1] * r * 0.92;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,40,26,0.4)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.78);
  ctx.lineTo(0, -r * 0.6);
  for (let i = 1; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.moveTo(0, -r * 0.5);
    ctx.lineTo(Math.cos(a) * r * 0.7, -r * 0.5 - Math.sin(a) * r * 0.7);
  }
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ 地被 */

export function grassTuftTexture(variant = 'green') {
  return cached(`grass-${variant}`, () => {
    const W = 256;
    const H = 256;
    const rand = mulberry32(variant === 'green' ? 71 : 73);
    const cols = variant === 'green'
      ? ['#6f7f4a', '#7d8f52', '#5f7042', '#8b9557', '#697a48', '#93a35f']
      : ['#8b8557', '#9a9364', '#7f7a4c', '#a29a6b', '#8d875a', '#a8a072'];
    return makeCanvasTexture(W, H, (ctx) => {
      bleed(ctx, W, H, cols[0], 0.01);
      const baseX = W * 0.5;
      const baseY = H - 2;
      // 草叶数量随分辨率提升（256² 下 26 根会显得稀疏）
      const blades = 64;
      for (let i = 0; i < blades; i++) {
        const bx = baseX + (rand() - 0.5) * W * 0.74;
        const tipX = bx + (rand() - 0.5) * W * 0.85;
        const h = H * (0.28 + rand() * 0.68);
        const w = 1.6 + rand() * 3.0;
        const bend = (rand() - 0.5) * 46;
        const col = pickC(rand, cols);
        // 叶片渐变：根部深、叶尖亮（光照感）
        const grad = ctx.createLinearGradient(0, baseY, 0, baseY - h);
        grad.addColorStop(0, shadeHex(col, 0.72));
        grad.addColorStop(0.55, col);
        grad.addColorStop(1, shadeHex(col, 1.22));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(bx - w, baseY);
        ctx.quadraticCurveTo(bx + bend * 0.5, baseY - h * 0.55, tipX, baseY - h);
        ctx.quadraticCurveTo(bx + bend * 0.5 + w * 0.7, baseY - h * 0.5, bx + w, baseY);
        ctx.closePath();
        ctx.fill();
        // 叶脉/高光
        if (rand() < 0.35) {
          ctx.strokeStyle = shadeHex(col, 1.35);
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(bx, baseY);
          ctx.quadraticCurveTo(bx + bend * 0.5, baseY - h * 0.55, tipX, baseY - h);
          ctx.stroke();
        }
      }
    }, { colorSpace: true, anisotropy: 8 });
  });
}

export function fernTexture() {
  return cached('fern', () => {
    const S = 128;
    const rand = mulberry32(79);
    return makeCanvasTexture(S, S, (ctx) => {
      bleed(ctx, S, S, '#5f7d4a', 0.012);
      const cols = ['#5f7d4a', '#6f8f52', '#7d9a4e', '#4f6b3e'];
      for (let f = 0; f < 5; f++) {
        const bx = S * (0.4 + rand() * 0.2);
        const by = S - 4;
        const tipX = S * (0.06 + rand() * 0.88);
        const tipY = S * (0.06 + rand() * 0.4);
        const color = pickC(rand, cols);
        // 叶轴
        ctx.strokeStyle = hexA('#4c633c', 0.75);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo((bx + tipX) / 2 + (rand() - 0.5) * 20, (by + tipY) / 2, tipX, tipY);
        ctx.stroke();
        // 羽片
        const steps = 9;
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const px = bx + (tipX - bx) * t + Math.sin(t * 3) * 4;
          const py = by + (tipY - by) * t;
          const ll = (1 - t) * 16 + 3;
          const a = Math.atan2(tipY - by, tipX - bx) + Math.PI / 2;
          leaf(ctx, px, py, ll, 2.4, a + (rand() - 0.5) * 0.5, color);
          leaf(ctx, px, py, ll, 2.4, a + Math.PI + (rand() - 0.5) * 0.5, shadeHex(color, 0.86));
        }
      }
    }, { colorSpace: true, anisotropy: 4 });
  });
}

export function shrubTexture() {
  return cached('shrub', () => {
    const S = 128;
    const rand = mulberry32(83);
    return makeCanvasTexture(S, S, (ctx) => {
      bleed(ctx, S, S, '#5d7d4c', 0.012);
      const cols = ['#5d7d4c', '#6b8a52', '#7d9a4e', '#4c6b3e', '#88a35c'];
      const cx = S / 2;
      const cy = S / 2;
      // 底层暗色团块
      for (let i = 0; i < 26; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 34;
        ctx.fillStyle = hexA('#3f5734', 0.5);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 7 + rand() * 8, 0, Math.PI * 2);
        ctx.fill();
      }
      // 叶片
      for (let i = 0; i < 90; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.pow(rand(), 0.65) * 44;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.9;
        leaf(ctx, x, y, 6 + rand() * 7, 2.6 + rand() * 1.4, rand() * Math.PI * 2, pickC(rand, cols));
      }
      // 高光
      for (let i = 0; i < 22; i++) {
        const a = -Math.PI * 0.7 + rand() * 0.8;
        const r = rand() * 30;
        leaf(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4 + rand() * 4, 1.8, rand() * 3, '#9aad6a');
      }
    }, { colorSpace: true, anisotropy: 4 });
  });
}

export function mossPatchTexture() {
  return cached('moss', () => {
    const S = 128;
    const rand = mulberry32(89);
    return makeCanvasTexture(S, S, (ctx) => {
      const g = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.48);
      g.addColorStop(0, 'rgba(104,122,62,0.95)');
      g.addColorStop(0.55, 'rgba(92,112,56,0.8)');
      g.addColorStop(0.82, 'rgba(84,102,52,0.42)');
      g.addColorStop(1, 'rgba(80,98,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(S / 2, S / 2, S * 0.48, S * 0.44, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 240; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * S * 0.44;
        const x = S / 2 + Math.cos(a) * r;
        const y = S / 2 + Math.sin(a) * r * 0.92;
        ctx.fillStyle = `rgba(${86 + rand() * 50},${112 + rand() * 44},${52 + rand() * 26},${0.2 + rand() * 0.4})`;
        ctx.beginPath();
        ctx.arc(x, y, 1 + rand() * 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { colorSpace: true, anisotropy: 4 });
  });
}

/* ------------------------------------------------------------------ 芦苇 */

export function reedTexture(variant = 'green') {
  return cached(`reed-${variant}`, () => {
    const W = 128;
    const H = 256;
    const rand = mulberry32(variant === 'green' ? 97 : 101);
    const cols = variant === 'green'
      ? ['#7f8a55', '#8f9a60', '#6f7d4c', '#9aa368']
      : ['#9a9364', '#a89a6b', '#8b8557', '#b0a272'];
    return makeCanvasTexture(W, H, (ctx) => {
      bleed(ctx, W, H, cols[0], 0.012);
      const blades = 16;
      for (let i = 0; i < blades; i++) {
        const bx = W * (0.3 + rand() * 0.4);
        const by = H - 2;
        const h = H * (0.5 + rand() * 0.48);
        const tipX = bx + (rand() - 0.5) * W * 0.75;
        const w = 1.6 + rand() * 2.2;
        const bend = (rand() - 0.5) * 30;
        ctx.fillStyle = pickC(rand, cols);
        ctx.beginPath();
        ctx.moveTo(bx - w, by);
        ctx.quadraticCurveTo(bx + bend, by - h * 0.5, tipX, by - h);
        ctx.quadraticCurveTo(bx + bend + w, by - h * 0.5, bx + w, by);
        ctx.closePath();
        ctx.fill();
      }
      // 芦苇穗
      for (let i = 0; i < 4; i++) {
        const bx = W * (0.2 + rand() * 0.6);
        const topY = H * (0.06 + rand() * 0.22);
        ctx.strokeStyle = hexA('#8a8256', 0.6);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(bx, H - 4);
        ctx.quadraticCurveTo(bx + 6, H * 0.5, bx + (rand() - 0.5) * 8, topY);
        ctx.stroke();
        for (let k = 0; k < 15; k++) {
          const t = rand();
          ctx.fillStyle = `rgba(${190 + rand() * 30},${170 + rand() * 26},${130 + rand() * 24},${0.3 + rand() * 0.4})`;
          ctx.beginPath();
          ctx.ellipse(bx + (rand() - 0.5) * 12, topY + t * 26, 2 + rand() * 2.4, 5 + rand() * 6, (rand() - 0.5) * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }, { colorSpace: true, anisotropy: 4 });
  });
}

/* ------------------------------------------------------------------ 莲蓬 / 荷花苞 */

export function lotusPodTexture() {
  return cached('lotus-pod', () => {
    const S = 64;
    const rand = mulberry32(103);
    return makeCanvasTexture(S, S, (ctx) => {
      ctx.fillStyle = '#8a9a56';
      ctx.fillRect(0, 0, S, S);
      // 顶部孔洞
      for (let i = 0; i < 16; i++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * S * 0.3;
        ctx.fillStyle = `rgba(60,72,38,${0.5 + rand() * 0.4})`;
        ctx.beginPath();
        ctx.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1.6 + rand() * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { colorSpace: true, wrap: THREE.ClampToEdgeWrapping });
  });
}

export function groundNoiseTexture() {
  return cached('ground-noise', () => {
    return makeCanvasTexture(128, 128, (ctx) => {
      const img = ctx.createImageData(128, 128);
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          const i = (y * 128 + x) * 4;
          const v = 235 + (((x * 13 + y * 7) % 17) - 8) * 1.6;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }, { repeat: [1, 1], wrap: THREE.RepeatWrapping, colorSpace: false });
  });
}

/* ------------------------------------------------------------------ 叶片材质种子色 */

export const LEAF_TINT = {
  willow: new THREE.Color(COLORS.willow),
  bamboo: new THREE.Color(COLORS.bamboo),
  pine: new THREE.Color(COLORS.pine),
  blossom: new THREE.Color(COLORS.blossom),
  maple: new THREE.Color(COLORS.maple),
  grass: new THREE.Color(COLORS.grass),
  lotus: new THREE.Color(COLORS.lotusLeaf),
};

import * as THREE from 'three';
import { mulberry32, fbm2, hash2, clamp } from './random.js';

/** 用 canvas 画图 → CanvasTexture（程序化资产的唯一入口） */
export function makeCanvasTexture(width, height, draw, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts.colorSpace === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  if (opts.wrap) {
    tex.wrapS = tex.wrapT = opts.wrap;
  }
  tex.anisotropy = opts.anisotropy ?? 4;
  tex.needsUpdate = true;
  return tex;
}

/** 分形噪声灰度图（可平铺） */
export function noiseTexture(opts = {}) {
  const {
    size = 256,
    scale = 6,
    octaves = 4,
    seed = 1,
    contrast = 1,
    brightness = 0.5,
    repeat = [1, 1],
    tint = null,
  } = opts;
  const rand = mulberry32(seed);
  const off = rand() * 100;
  return makeCanvasTexture(size, size, (ctx) => {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // 平铺：用环形坐标
        const u = x / size;
        const v = y / size;
        const n =
          fbm2(u * scale + off, v * scale + off, octaves) * 0.75 +
          fbm2(u * scale * 2 + 17, v * scale * 2 + 31, 2) * 0.25;
        const c = clamp((n - 0.5) * contrast + 0.5 + (brightness - 0.5), 0, 1);
        const i = (y * size + x) * 4;
        if (tint) {
          img.data[i] = Math.round(tint[0] * c);
          img.data[i + 1] = Math.round(tint[1] * c);
          img.data[i + 2] = Math.round(tint[2] * c);
        } else {
          img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(c * 255);
        }
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat, wrap: THREE.RepeatWrapping });
}

/** 柔和径向光斑（粒子/雾气/光晕用） */
export function softGlowTexture(opts = {}) {
  const { size = 128, color = '#ffffff', falloff = 2.2, inner = 0.0 } = opts;
  return makeCanvasTexture(size, size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.35, hexA(color, 0.75));
    g.addColorStop(0.7, hexA(color, 0.18));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // 提高边缘柔和度
    if (falloff > 2) {
      ctx.globalCompositeOperation = 'destination-in';
      const g2 = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g2.addColorStop(0, '#fff');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, size, size);
    }
  }, { colorSpace: false });
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

/** 一簇叶子（透明背景，alphaTest 用） */
export function leafClusterTexture(opts = {}) {
  const {
    size = 128,
    count = 9,
    color = '#7d9a4e',
    color2 = '#9db96a',
    seed = 7,
    spread = 0.78,
    leafW = 0.16,
    leafH = 0.34,
    veins = true,
  } = opts;
  return makeCanvasTexture(size, size, (ctx) => {
    const rand = mulberry32(seed);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    for (let i = 0; i < count; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = rand() * size * 0.42 * spread;
      const x = Math.cos(ang) * dist;
      const y = Math.sin(ang) * dist * 0.9;
      const rot = -Math.PI / 2 + (rand() - 0.5) * 2.0 + ang * 0.2;
      const w = size * leafW * (0.7 + rand() * 0.6);
      const h = size * leafH * (0.7 + rand() * 0.6);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      const c = rand() > 0.5 ? color2 : color;
      grad.addColorStop(0, c);
      grad.addColorStop(1, shade(c, 0.8));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.5);
      ctx.quadraticCurveTo(w * 0.62, -h * 0.05, 0, h * 0.5);
      ctx.quadraticCurveTo(-w * 0.62, -h * 0.05, 0, -h * 0.5);
      ctx.fill();
      if (veins) {
        ctx.strokeStyle = 'rgba(40,55,30,0.25)';
        ctx.lineWidth = Math.max(1, size * 0.006);
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.45);
        ctx.lineTo(0, h * 0.45);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, { colorSpace: true });
}

function shade(hex, f) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

/** 石材/墙面纹理：噪声 + 斑驳 + 细纹 */
export function stoneTexture(opts = {}) {
  const { size = 256, tint = [154, 157, 152], seed = 3, moss = 0.0, joint = 0.0 } = opts;
  const rand = mulberry32(seed);
  return makeCanvasTexture(size, size, (ctx) => {
    ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
    ctx.fillRect(0, 0, size, size);
    // 斑驳
    for (let i = 0; i < 1400; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = rand() * size * 0.045 + 1;
      const a = rand() * 0.16;
      ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(20,25,22,${a * 0.9})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 苔痕
    if (moss > 0) {
      for (let i = 0; i < 500 * moss; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const r = rand() * size * 0.05 + 1;
        ctx.fillStyle = `rgba(${70 + rand() * 40},${95 + rand() * 45},${50 + rand() * 25},${rand() * 0.35})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 石缝
    if (joint > 0) {
      ctx.strokeStyle = `rgba(30,35,32,${0.35 * joint})`;
      ctx.lineWidth = Math.max(1, size * 0.006);
      const step = size / 4;
      for (let y = 0; y <= size; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      for (let row = 0; row < 4; row++) {
        const offset = row % 2 ? step / 2 : 0;
        for (let x = offset; x <= size; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, row * step);
          ctx.lineTo(x, (row + 1) * step);
          ctx.stroke();
        }
      }
    }
  }, { repeat: [1, 1], wrap: THREE.RepeatWrapping });
}

/** 木纹 */
export function woodTexture(opts = {}) {
  const { size = 256, tint = [61, 47, 38], seed = 5, lines = 46 } = opts;
  const rand = mulberry32(seed);
  return makeCanvasTexture(size, size, (ctx) => {
    ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < lines; i++) {
      const y = rand() * size;
      const w = 0.6 + rand() * 2.2;
      ctx.strokeStyle = `rgba(${Math.max(0, tint[0] - 18)},${Math.max(0, tint[1] - 14)},${Math.max(0, tint[2] - 10)},${0.25 + rand() * 0.35})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += size / 8) {
        ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * (2 + rand() * 3));
      }
      ctx.stroke();
    }
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(255,235,200,${rand() * 0.05})`;
      ctx.fillRect(rand() * size, rand() * size, 1, 2 + rand() * 4);
    }
  }, { repeat: [1, 1], wrap: THREE.RepeatWrapping });
}

/** 云朵贴图（billboard 云层备用） */
export function cloudTexture(opts = {}) {
  const { size = 256, seed = 9, puffs = 14, color = '#ffffff' } = opts;
  const rand = mulberry32(seed);
  return makeCanvasTexture(size, size, (ctx) => {
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < puffs; i++) {
      const x = size * 0.5 + (rand() - 0.5) * size * 0.62;
      const y = size * 0.52 + (rand() - 0.5) * size * 0.34;
      const r = size * (0.08 + rand() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hexA(color, 0.5));
      g.addColorStop(0.55, hexA(color, 0.24));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { colorSpace: false });
}

/** 荷叶贴图（圆盘 + 缺口 + 叶脉） */
export function lotusPadTexture(opts = {}) {
  const { size = 128, seed = 11, color = '#5f7d49' } = opts;
  const rand = mulberry32(seed);
  return makeCanvasTexture(size, size, (ctx) => {
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.47;
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, shade(color, 1.15));
    g.addColorStop(0.7, color);
    g.addColorStop(1, shade(color, 0.8));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.18, Math.PI * 2 - 0.05);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,245,200,0.3)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(30,50,25,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.18, Math.PI * 2 - 0.05);
    ctx.stroke();
  }, { colorSpace: true });
}

export { hexA };

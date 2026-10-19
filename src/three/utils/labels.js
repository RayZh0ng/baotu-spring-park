import * as THREE from 'three';
import { FONT_SERIF } from './palette.js';
import { makeCanvasTexture } from './tex.js';

/**
 * 匾额 / 碑刻 / 楹联文字贴图。
 * opts: { text, vertical, bg, fg, border, size, aspect, font, glow }
 */
export function makePlaqueTexture(opts) {
  const {
    text = '趵突泉',
    vertical = false,
    bg = 'rgba(22,28,24,0.92)',
    fg = '#e8d8a8',
    border = '#a98b4f',
    borderWidth = 3,
    size = 512,
    font = FONT_SERIF,
    fontScale = 0.62,
    engraved = true,
    pad = 0.1,
  } = opts;

  const chars = [...text];
  const n = Math.max(1, chars.length);
  const w = vertical ? Math.round(size * 0.42) : size;
  const h = vertical ? size : Math.round(size * 0.42);

  return makeCanvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, h, Math.min(w, h) * 0.04);
    ctx.fill();
    if (borderWidth > 0) {
      ctx.strokeStyle = border;
      ctx.lineWidth = borderWidth;
      roundRect(ctx, borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth, Math.min(w, h) * 0.04);
      ctx.stroke();
    }
    // 内嵌细线
    ctx.strokeStyle = 'rgba(200,162,94,0.35)';
    ctx.lineWidth = Math.max(1, borderWidth * 0.4);
    const inset = Math.min(w, h) * 0.08;
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (vertical) {
      const cell = (h - inset * 2) / n;
      const fs = Math.min(w * 0.62, cell * 0.78);
      ctx.font = `${fs}px ${font}`;
      for (let i = 0; i < n; i++) {
        const cy = inset + cell * (i + 0.5);
        if (engraved) {
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillText(chars[i], w / 2 + fs * 0.035, cy + fs * 0.035);
        }
        ctx.fillStyle = fg;
        ctx.fillText(chars[i], w / 2, cy);
      }
    } else {
      const cell = (w - inset * 2) / n;
      const fs = Math.min(h * 0.55, cell * 0.72);
      ctx.font = `${fs}px ${font}`;
      for (let i = 0; i < n; i++) {
        const cx = inset + cell * (i + 0.5);
        if (engraved) {
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillText(chars[i], cx + fs * 0.035, h / 2 + fs * 0.035);
        }
        ctx.fillStyle = fg;
        ctx.fillText(chars[i], cx, h / 2);
      }
    }
  }, { colorSpace: true, anisotropy: 8 });
}

/** 石碑石材纹理（用于碑身侧面） */
export function makeSteleFaceTexture(opts = {}) {
  const { text = '趵突泉', vertical = true, fg = 'rgba(35,40,36,0.92)', size = 512 } = opts;
  const chars = [...text];
  const n = Math.max(1, chars.length);
  const w = vertical ? Math.round(size * 0.5) : Math.round(size * 1.5);
  const h = vertical ? Math.round(size * 1.5) : Math.round(size * 0.5);
  return makeCanvasTexture(w, h, (ctx) => {
    // 石面
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#b9b5a8');
    g.addColorStop(0.5, '#a7a397');
    g.addColorStop(1, '#c2beb1');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 斑驳
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = Math.random() * 3 + 0.4;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(50,50,45,0.08)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (vertical) {
      const cell = (h * 0.82) / n;
      const fs = Math.min(w * 0.6, cell * 0.8);
      ctx.font = `${fs}px ${FONT_SERIF}`;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillText(chars[i], w / 2 + fs * 0.03, h * 0.09 + cell * (i + 0.5) + fs * 0.03);
        ctx.fillStyle = fg;
        ctx.fillText(chars[i], w / 2, h * 0.09 + cell * (i + 0.5));
      }
    } else {
      const cell = (w * 0.82) / n;
      const fs = Math.min(h * 0.5, cell * 0.8);
      ctx.font = `${fs}px ${FONT_SERIF}`;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = fg;
        ctx.fillText(chars[i], w * 0.09 + cell * (i + 0.5), h / 2);
      }
    }
  }, { colorSpace: true, anisotropy: 8 });
}

/** 题字 Sprite（用于远景/UI 外的 3D 文字） */
export function makeTextSprite(text, opts = {}) {
  const {
    color = '#f2e7c8',
    bg = 'rgba(0,0,0,0)',
    font = FONT_SERIF,
    fontSize = 64,
    padding = 18,
    scale = 1,
  } = opts;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSpec = `${fontSize}px ${font}`;
  ctx.font = fontSpec;
  const w = Math.ceil(ctx.measureText(text).width + padding * 2);
  const h = Math.ceil(fontSize * 1.5);
  canvas.width = w;
  canvas.height = h;
  const c2 = canvas.getContext('2d');
  c2.font = fontSpec;
  c2.fillStyle = bg;
  c2.fillRect(0, 0, w, h);
  c2.fillStyle = color;
  c2.textAlign = 'center';
  c2.textBaseline = 'middle';
  c2.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set((w / h) * scale, scale, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

import * as THREE from 'three';
import { COLORS } from '../../utils/palette.js';
import { makeCanvasTexture, stoneTexture, woodTexture } from '../../utils/tex.js';
import { makePlaqueTexture, makeSteleFaceTexture } from '../../utils/labels.js';
import { mulberry32, clamp } from '../../utils/random.js';

/**
 * 建筑材质库：程序化贴图 + 统一色板 + 轻量天气响应。
 * - 所有材质只在这里创建一次；几何合并由 kit.js 的 Builder 负责。
 * - 天气响应：雪 → 屋瓦/墙帽/石面向白 lerp；湿 → 石材/木/瓦变深、粗糙度降低；
 *   夜 → 匾额/窗纸/灯笼自发光。
 */

const SNOW_COLOR = new THREE.Color(0xf1f4f7);
const SNOW_WARM = new THREE.Color(0xe9eef2);
const _tmp = new THREE.Color();

const REPEAT = { wrap: THREE.RepeatWrapping, anisotropy: 8 };

/* ------------------------------------------------------------------ 贴图 */

function plainCanvas(size, draw) {
  return makeCanvasTexture(size, size, draw, REPEAT);
}

/** 灰筒瓦屋面：竖向瓦垄（条纹）+ 横向瓦节 + 斑驳 */
function textureRoof(seed, wear = 0) {
  const rand = mulberry32(seed);
  return plainCanvas(256, (ctx, w, h) => {
    ctx.fillStyle = '#b6bec3';
    ctx.fillRect(0, 0, w, h);
    const cols = 8;
    const cw = w / cols;
    for (let i = 0; i < cols; i++) {
      const x = i * cw;
      const g = ctx.createLinearGradient(x, 0, x + cw, 0);
      g.addColorStop(0.0, '#6f7a82');
      g.addColorStop(0.1, '#a9b3b9');
      g.addColorStop(0.32, '#d6dde0');
      g.addColorStop(0.52, '#e4e9eb');
      g.addColorStop(0.76, '#b6c0c5');
      g.addColorStop(0.9, '#8b969d');
      g.addColorStop(1.0, '#68737b');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, cw, h);
    }
    // 瓦节（横向，只留很淡的一层，避免盖过竖向瓦垄）
    for (let y = 46; y < h; y += 64) {
      ctx.fillStyle = 'rgba(52,62,70,0.07)';
      ctx.fillRect(0, y, w, 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, y + 1.5, w, 1);
    }
    // 竖向瓦缝压深一点，让"瓦垄"读得出来
    for (let i = 0; i < cols; i++) {
      const x = i * cw;
      ctx.fillStyle = 'rgba(38,48,56,0.35)';
      ctx.fillRect(x, 0, 1.6, h);
      ctx.fillRect(x + cw - 1.6, 0, 1.6, h);
    }
    // 斑驳与水渍
    for (let i = 0; i < 1400; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = rand() * 2.4 + 0.3;
      const a = rand() * 0.12 * (1 + wear);
      ctx.fillStyle = rand() > 0.55 ? `rgba(36,46,52,${a})` : `rgba(236,242,244,${a * 0.8})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 苔痕/风化的淡青
    if (wear > 0) {
      for (let i = 0; i < 40; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = 6 + rand() * 22;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(92,108,86,${0.1 * wear})`);
        g.addColorStop(1, 'rgba(92,108,86,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  });
}

/** 白灰墙面：细腻噪声 + 淡淡雨痕 */
function texturePlaster(seed) {
  const rand = mulberry32(seed);
  return plainCanvas(256, (ctx, w, h) => {
    ctx.fillStyle = '#efeee7';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 10 + rand() * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rand() > 0.5;
      g.addColorStop(0, dark ? 'rgba(168,166,152,0.055)' : 'rgba(255,255,252,0.07)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // 竖向雨痕（墙根）
    ctx.strokeStyle = 'rgba(140,142,130,0.055)';
    for (let i = 0; i < 26; i++) {
      const x = rand() * w;
      ctx.lineWidth = 1 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (rand() - 0.5) * 6, h);
      ctx.stroke();
    }
    for (let i = 0; i < 500; i++) {
      const x = rand() * w;
      const y = rand() * h;
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(120,122,112,0.05)';
      ctx.fillRect(x, y, 1 + rand() * 1.5, 1 + rand() * 1.5);
    }
  });
}

/** 青砖：错缝砖砌 */
function textureBrick(seed) {
  const rand = mulberry32(seed);
  return plainCanvas(256, (ctx, w, h) => {
    ctx.fillStyle = '#8e979b';
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    const cols = 4;
    const bh = h / rows;
    const bw = w / cols;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw * 0.5 : 0;
      for (let c = -1; c <= cols; c++) {
        const x = c * bw + off;
        const y = r * bh;
        const tone = 148 + Math.floor(rand() * 42);
        const blue = tone + Math.floor(rand() * 8);
        ctx.fillStyle = `rgb(${tone - 6},${tone + 2},${blue})`;
        ctx.fillRect(x + 1.4, y + 1.4, bw - 2.8, bh - 2.8);
        // 砖面斑驳
        for (let k = 0; k < 5; k++) {
          ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(30,36,38,0.06)';
          ctx.fillRect(x + 2 + rand() * (bw - 6), y + 2 + rand() * (bh - 6), 2 + rand() * 6, 1 + rand() * 3);
        }
      }
    }
  });
}

/** 木格窗（暖纸 + 深色棂条），同时用于自发光 */
function textureLattice(seed, style = 0) {
  const rand = mulberry32(seed);
  return makeCanvasTexture(256, 256, (ctx, w, h) => {
    // 窗纸
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#efe4c6');
    g.addColorStop(0.55, '#e8dcba');
    g.addColorStop(1, '#dccda6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,250,235,0.16)' : 'rgba(150,130,95,0.08)';
      ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 10, 1 + rand() * 2);
    }
    // 棂条
    ctx.strokeStyle = '#4a3628';
    ctx.lineCap = 'square';
    const frame = 11;
    ctx.lineWidth = frame;
    ctx.strokeRect(frame / 2, frame / 2, w - frame, h - frame);
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo((w / 4) * i, frame);
      ctx.lineTo((w / 4) * i, h - frame);
    }
    const rows = style === 1 ? 3 : 4;
    for (let i = 1; i < rows; i++) {
      ctx.moveTo(frame, (h / rows) * i);
      ctx.lineTo(w - frame, (h / rows) * i);
    }
    ctx.stroke();
    // 步步锦小折线
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#5a4230';
    ctx.beginPath();
    const stepY = h / rows;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < 4; j++) {
        const x = frame + (w - 2 * frame) * (j / 4) + 6;
        const y = frame + stepY * i + stepY * 0.5;
        ctx.moveTo(x, y - stepY * 0.16);
        ctx.lineTo(x + stepY * 0.2, y);
        ctx.lineTo(x, y + stepY * 0.16);
      }
    }
    ctx.stroke();
  }, { colorSpace: true, anisotropy: 8 });
}

/** 隔扇门 / 板门（朱红 + 金钉） */
function textureDoor(seed, studs = true) {
  const rand = mulberry32(seed);
  return makeCanvasTexture(256, 384, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#6d2a20');
    g.addColorStop(0.3, '#8a3a2c');
    g.addColorStop(0.62, '#7c3327');
    g.addColorStop(1, '#5f241c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 板缝
    for (let i = 1; i < 5; i++) {
      ctx.fillStyle = 'rgba(30,12,8,0.42)';
      ctx.fillRect((w / 5) * i, 0, 2.5, h);
      ctx.fillStyle = 'rgba(255,190,150,0.08)';
      ctx.fillRect((w / 5) * i + 2.5, 0, 2, h);
    }
    // 木纹
    for (let i = 0; i < 130; i++) {
      ctx.fillStyle = `rgba(30,12,8,${0.04 + rand() * 0.06})`;
      ctx.fillRect(rand() * w, 0, 1 + rand() * 2, h);
    }
    if (studs) {
      // 门钉
      const cols = 5;
      const rows = 6;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = (w / (cols + 1)) * (c + 1);
          const y = h * 0.1 + (h * 0.78 / (rows - 1)) * r;
          const rg = ctx.createRadialGradient(x - 2, y - 2, 0.5, x, y, 6.5);
          rg.addColorStop(0, '#f0d59c');
          rg.addColorStop(0.5, '#c8a25e');
          rg.addColorStop(1, '#7a5c2c');
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // 铺首
    ctx.strokeStyle = '#c8a25e';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.52, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.52 + 15, 8, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }, { colorSpace: true, anisotropy: 8 });
}

/** 院落铺地：方石板 + 缝隙 */
function texturePaving(seed) {
  const rand = mulberry32(seed);
  return plainCanvas(256, (ctx, w, h) => {
    ctx.fillStyle = '#9aa09a';
    ctx.fillRect(0, 0, w, h);
    const n = 4;
    const s = w / n;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const tone = 170 + Math.floor(rand() * 40);
        ctx.fillStyle = `rgb(${tone},${tone + 2},${tone - 4})`;
        ctx.fillRect(c * s + 2, r * s + 2, s - 4, s - 4);
        for (let k = 0; k < 12; k++) {
          ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(40,46,42,0.08)';
          ctx.fillRect(c * s + 2 + rand() * (s - 6), r * s + 2 + rand() * (s - 6), 1 + rand() * 6, 1 + rand() * 4);
        }
      }
    }
    ctx.fillStyle = 'rgba(40,46,42,0.35)';
    for (let i = 0; i <= n; i++) {
      ctx.fillRect(i * s - 1, 0, 2, h);
      ctx.fillRect(0, i * s - 1, w, 2);
    }
  });
}

/* ------------------------------------------------------------- 材质工厂 */

function tinted(color, f) {
  const c = new THREE.Color(color);
  c.r = clamp(c.r * f, 0, 1);
  c.g = clamp(c.g * f, 0, 1);
  c.b = clamp(c.b * f, 0, 1);
  return c;
}

export function createMaterials(quality = 1) {
  const aniso = quality >= 1 ? 8 : 4;
  const textures = [];
  const materials = {}; // key -> { mat, cast, receive }
  const weatherList = [];
  const nightList = [];
  const uniqueMats = [];
  let seed = 41;

  const tex = (t) => {
    t.anisotropy = aniso;
    textures.push(t);
    return t;
  };

  function def(key, material, opts = {}) {
    const { snow = 0, wet = 0, cast = true, receive = true, flat = false } = opts;
    if (flat) material.flatShading = true;
    material.userData.arch = key;
    if (snow > 0 || wet > 0) {
      weatherList.push({
        mat: material,
        base: material.color.clone(),
        baseRough: material.roughness,
        snow,
        wet,
      });
    }
    materials[key] = { mat: material, cast, receive };
    return material;
  }

  /* ---- 贴图 ---- */
  const roofA = tex(textureRoof(seed++, 0));
  const roofB = tex(textureRoof(seed++, 0.7));
  const plasterA = tex(texturePlaster(seed++));
  const brickTex = tex(textureBrick(seed++));
  const latticeA = tex(textureLattice(seed++, 0));
  const latticeB = tex(textureLattice(seed++, 1));
  const doorTex = tex(textureDoor(seed++, true));
  const doorPlain = tex(textureDoor(seed++, false));
  const pavingTex = tex(texturePaving(seed++));
  const stoneTex = tex(stoneTexture({ size: 256, tint: [208, 208, 200], seed: seed++, moss: 0.25, joint: 0.5 }));
  const stoneDarkTex = tex(stoneTexture({ size: 256, tint: [188, 190, 184], seed: seed++, moss: 0.4, joint: 0.8 }));
  const rockTex = tex(stoneTexture({ size: 512, tint: [200, 202, 196], seed: seed++, moss: 2.2, joint: 0.5 }));
  const woodTex = tex(woodTexture({ size: 256, tint: [205, 190, 172], seed: seed++, lines: 60 }));

  /* ---- 基础材质 ---- */
  def('plaster', new THREE.MeshStandardMaterial({
    color: 0xece7d8, map: plasterA, roughness: 0.93, metalness: 0,
  }), { snow: 0.16, wet: 0.5 });

  def('plasterWarm', new THREE.MeshStandardMaterial({
    color: 0xe4ddc9, map: plasterA, roughness: 0.94, metalness: 0,
  }), { snow: 0.14, wet: 0.5 });

  def('brick', new THREE.MeshStandardMaterial({
    color: 0xb9c1c4, map: brickTex, roughness: 0.95, metalness: 0,
  }), { snow: 0.1, wet: 0.75 });

  def('stone', new THREE.MeshStandardMaterial({
    color: 0xa8b1a9, map: stoneTex, roughness: 0.9, metalness: 0.02,
  }), { snow: 0.3, wet: 0.85 });

  def('stoneDark', new THREE.MeshStandardMaterial({
    color: 0x8a958e, map: stoneDarkTex, roughness: 0.94, metalness: 0.02,
  }), { snow: 0.24, wet: 0.85 });

  def('stoneLight', new THREE.MeshStandardMaterial({
    color: 0xbfc5bc, map: stoneTex, roughness: 0.86, metalness: 0.02,
  }), { snow: 0.32, wet: 0.8 });

  def('marble', new THREE.MeshStandardMaterial({
    color: 0xcfcabe, map: stoneTex, roughness: 0.72, metalness: 0.03,
  }), { snow: 0.3, wet: 0.7 });

  def('paving', new THREE.MeshStandardMaterial({
    color: 0xa4aa9f, map: pavingTex, roughness: 0.93, metalness: 0.01,
  }), { snow: 0.34, wet: 0.9, cast: false });

  def('wood', new THREE.MeshStandardMaterial({
    color: 0x7a6248, map: woodTex, roughness: 0.8, metalness: 0.02,
  }), { snow: 0.08, wet: 0.55 });

  def('woodDark', new THREE.MeshStandardMaterial({
    color: 0x3d2f26, roughness: 0.76, metalness: 0.02,
  }), { snow: 0.06, wet: 0.45 });

  def('woodRed', new THREE.MeshStandardMaterial({
    color: 0x74352a, roughness: 0.7, metalness: 0.02,
  }), { snow: 0.06, wet: 0.45 });

  def('vermilion', new THREE.MeshStandardMaterial({
    color: 0xa8432f, roughness: 0.62, metalness: 0.03,
  }), { snow: 0.1, wet: 0.55 });

  def('vermilionDark', new THREE.MeshStandardMaterial({
    color: 0x84301f, roughness: 0.66, metalness: 0.03,
  }), { snow: 0.08, wet: 0.5 });

  def('beamPaint', new THREE.MeshStandardMaterial({
    color: 0x3f5a57, roughness: 0.7, metalness: 0.05,
  }), { snow: 0.06, wet: 0.45 });

  def('tileA', new THREE.MeshStandardMaterial({
    color: 0x8d9da6, map: roofA, roughness: 0.8, metalness: 0.04, side: THREE.DoubleSide,
  }), { snow: 0.92, wet: 0.85 });

  def('tileB', new THREE.MeshStandardMaterial({
    color: 0x87969e, map: roofB, roughness: 0.82, metalness: 0.04, side: THREE.DoubleSide,
  }), { snow: 0.92, wet: 0.85 });

  def('tileOld', new THREE.MeshStandardMaterial({
    color: 0x7f9098, map: roofB, roughness: 0.86, metalness: 0.03, side: THREE.DoubleSide,
  }), { snow: 0.9, wet: 0.85 });

  def('ridge', new THREE.MeshStandardMaterial({
    color: 0x414f58, roughness: 0.74, metalness: 0.06,
  }), { snow: 0.55, wet: 0.8 });

  def('ridgeDark', new THREE.MeshStandardMaterial({
    color: 0x313d45, roughness: 0.7, metalness: 0.08,
  }), { snow: 0.45, wet: 0.75 });

  def('tileCap', new THREE.MeshStandardMaterial({
    color: 0x77868f, roughness: 0.8, metalness: 0.04,
  }), { snow: 0.85, wet: 0.8 });

  def('wallCap', new THREE.MeshStandardMaterial({
    color: 0x64727b, map: roofA, roughness: 0.82, metalness: 0.04,
  }), { snow: 0.88, wet: 0.8 });

  def('gold', new THREE.MeshStandardMaterial({
    color: 0xc8a25e, roughness: 0.38, metalness: 0.55,
  }), { snow: 0.14, wet: 0.35 });

  def('goldDim', new THREE.MeshStandardMaterial({
    color: 0x9b7b41, roughness: 0.45, metalness: 0.5,
  }), { snow: 0.14, wet: 0.35 });

  def('bronze', new THREE.MeshStandardMaterial({
    color: 0x6d5a3c, roughness: 0.42, metalness: 0.6,
  }), { snow: 0.16, wet: 0.4 });

  def('latticeA', new THREE.MeshStandardMaterial({
    color: 0xffffff, map: latticeA, roughness: 0.62, metalness: 0,
    emissive: new THREE.Color(0xffd291), emissiveMap: latticeA, emissiveIntensity: 0.05,
  }), {});
  nightList.push({ mat: materials['latticeA'].mat, baseEmissive: 0.05, boost: 0.85 });

  def('latticeB', new THREE.MeshStandardMaterial({
    color: 0xf4ecdd, map: latticeB, roughness: 0.66, metalness: 0,
    emissive: new THREE.Color(0xffd291), emissiveMap: latticeB, emissiveIntensity: 0.05,
  }), {});
  nightList.push({ mat: materials['latticeB'].mat, baseEmissive: 0.05, boost: 0.75 });

  def('door', new THREE.MeshStandardMaterial({
    color: 0xe8dccb, map: doorTex, roughness: 0.68, metalness: 0.1, side: THREE.DoubleSide,
  }), { snow: 0.05, wet: 0.4 });

  def('doorPlain', new THREE.MeshStandardMaterial({
    color: 0xd8c9b6, map: doorPlain, roughness: 0.7, metalness: 0.08,
  }), { snow: 0.05, wet: 0.4 });

  def('rock', new THREE.MeshStandardMaterial({
    color: 0x9ca5a0, map: rockTex, roughness: 0.98, metalness: 0.01,
  }), { snow: 0.38, wet: 0.85, flat: true });

  def('rockDark', new THREE.MeshStandardMaterial({
    color: 0x7e8883, map: rockTex, roughness: 1, metalness: 0,
  }), { snow: 0.3, wet: 0.85, flat: true });

  def('moss', new THREE.MeshStandardMaterial({
    color: 0x5d7048, roughness: 1, metalness: 0,
  }), { snow: 0.22, wet: 0.6, flat: true });

  def('recess', new THREE.MeshStandardMaterial({
    color: 0x151a17, roughness: 1, metalness: 0,
  }), {});

  def('lantern', new THREE.MeshStandardMaterial({
    color: 0xc0472f, roughness: 0.55, metalness: 0.05,
    emissive: new THREE.Color(0xff6a3a), emissiveIntensity: 0.22,
  }), { snow: 0.05 });
  nightList.push({ mat: materials.lantern.mat, baseEmissive: 0.22, boost: 2.6 });

  def('lanternGlow', new THREE.MeshStandardMaterial({
    color: 0xe9b06a, roughness: 0.5, metalness: 0,
    emissive: new THREE.Color(0xffb066), emissiveIntensity: 0.3,
  }), {});
  nightList.push({ mat: materials.lanternGlow.mat, baseEmissive: 0.3, boost: 3.2 });

  def('black', new THREE.MeshStandardMaterial({
    color: 0x14181a, roughness: 0.95, metalness: 0.02,
  }), {});

  /* ---- 匾额 / 碑面材质（每块独立贴图） ---- */
  function makePlaqueMaterial(texture) {
    const m = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.52,
      metalness: 0.16,
      emissive: new THREE.Color(0xd9b26c),
      emissiveMap: texture,
      emissiveIntensity: 0.03,
    });
    nightList.push({ mat: m, baseEmissive: 0.03, boost: 0.62 });
    uniqueMats.push(m);
    return m;
  }

  function makeSteleMaterial(texture) {
    const m = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.88,
      metalness: 0.02,
    });
    uniqueMats.push(m);
    return m;
  }

  /* ---- 天气响应 ---- */
  function update(dt, env) {
    const snow = clamp((env.snow || 0) * 1.08, 0, 1);
    const wet = clamp(env.wetness || 0, 0, 1);
    const night = clamp(env.night || 0, 0, 1);
    for (let i = 0; i < weatherList.length; i++) {
      const e = weatherList[i];
      const mat = e.mat;
      _tmp.copy(e.base);
      if (wet > 0.001) _tmp.multiplyScalar(1 - 0.3 * wet * e.wet);
      if (snow > 0.001) _tmp.lerp(SNOW_COLOR, Math.min(0.94, snow * e.snow));
      mat.color.copy(_tmp);
      if (e.baseRough !== undefined && (wet > 0.001 || snow > 0.001)) {
        mat.roughness = clamp(e.baseRough - 0.3 * wet * e.wet - 0.1 * snow * e.snow, 0.06, 1);
      }
    }
    if (night > 0.001 || this._lastNight !== night) {
      for (let i = 0; i < nightList.length; i++) {
        const e = nightList[i];
        e.mat.emissiveIntensity = e.baseEmissive + night * e.boost;
      }
      this._lastNight = night;
    }
  }

  function dispose() {
    for (const t of textures) t.dispose();
    for (const k in materials) materials[k].mat.dispose();
    for (const m of uniqueMats) m.dispose();
  }

  return {
    materials,
    update,
    makePlaqueMaterial,
    makeSteleMaterial,
    dispose,
    _lastNight: -1,
    _snowWarm: SNOW_WARM,
  };
}

import * as THREE from 'three';
import { hash2 } from '../utils/random.js';

/**
 * 天空与灯光（D 号模块）
 * ------------------------------------------------------------
 * 视觉构成（全部在一个穹顶 ShaderMaterial 里，1 个 draw call）：
 *   1. skyTop / skyHorizon / skyBottom 三段渐变
 *   2. 太阳圆盘 + 光晕（黄昏地平线暖光）
 *   3. 月亮圆盘（冷白 + 柔和光晕 + 月海细节），夜晚出场
 *   4. 程序化云层：4 通道可平铺 FBM 噪声纹理，多层不同速度/缩放 + 域扭曲，
 *      云色受 cloudTint 控制、密度受 cloudCover、流动受 cloudSpd 控制；有明暗层次与体积感
 *   5. 星空：方向空间 cube-face 网格哈希星点（含银河带），慢速闪烁、被云遮挡
 *   6. env.lightning：整片天空冷蓝白提亮 + 云层被照亮
 *
 * 灯光（自己 add 到 scene）：
 *   主 DirectionalLight（太阳/月亮方向，2048 阴影，120×120m，跟随 env.focus）
 *   月亮补光 DirectionalLight / HemisphereLight / AmbientLight
 *
 * 雾：scene.fog = FogExp2(env.fogColor, env.fogDensity)，每帧同步。
 * 不修改 scene.background —— 背景完全由穹顶绘制。
 */

const DOME_RADIUS = 420;
const SHADOW_EXTENT = 42; // 阴影相机覆盖 104m × 104m（更小范围 = 更高阴影精度）
const CLOUD_GRID = 42.0; // 星空 cube-face 网格密度

/* ------------------------------------------------------------------ *
 * 程序化云噪声纹理：4 通道可平铺 FBM（DataTexture，只在启动时生成一次）
 * ------------------------------------------------------------------ */

function tileableNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const wrap = (n) => ((n % period) + period) % period;
  const h = (a, b) => hash2(wrap(a) + seed * 131, wrap(b) + seed * 173);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function tileableFbm(u, v, basePeriod, octaves, seed) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += tileableNoise(u * period, v * period, period, seed + o * 17.7) * amp;
    norm += amp;
    amp *= 0.55;
    period *= 2;
  }
  return sum / norm;
}

function makeCloudNoiseTexture(size) {
  const data = new Uint8Array(size * size * 4);
  const channels = [
    { base: 4, octaves: 5, seed: 1.7 },
    { base: 6, octaves: 5, seed: 7.3 },
    { base: 11, octaves: 4, seed: 13.1 },
    { base: 5, octaves: 4, seed: 23.9 },
  ];
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const idx = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        const ch = channels[c];
        data[idx + c] = Math.round(tileableFbm(u, v, ch.base, ch.octaves, ch.seed) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ *
 * 穹顶 Shader
 * ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTopColor;
uniform vec3 uHorizonColor;
uniform vec3 uBottomColor;
uniform vec3 uFogColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCloudTint;
uniform vec3 uGalaxyNormal;

uniform float uSunIntensity;
uniform float uMoonIntensity;
uniform float uNight;
uniform float uGolden;
uniform float uDayFactor;
uniform float uCloudCover;
uniform float uCloudSpd;
uniform float uStarOpacity;
uniform float uLightning;
uniform float uTime;

uniform vec2 uSunDisc;
uniform vec2 uMoonDisc;
uniform sampler2D uCloudTex;

varying vec3 vDir;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/* 方向空间星点：cube-face 网格 + 哈希，避免球面极点聚集与噪点式闪烁 */
vec3 starField(vec3 dir, float h) {
  vec3 ad = abs(dir);
  vec2 cuv;
  float faceId;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    cuv = dir.yz / max(ad.x, 1e-4);
    faceId = dir.x > 0.0 ? 0.0 : 1.0;
  } else if (ad.y >= ad.z) {
    cuv = dir.xz / max(ad.y, 1e-4);
    faceId = dir.y > 0.0 ? 2.0 : 3.0;
  } else {
    cuv = dir.xy / max(ad.z, 1e-4);
    faceId = dir.z > 0.0 ? 4.0 : 5.0;
  }

  float grid = ${CLOUD_GRID.toFixed(1)};
  vec2 g = cuv * grid;
  vec2 cell = floor(g);
  float seed = faceId * 17.0;
  float r1 = hash21(cell + seed);
  float r2 = hash21(cell + seed + 19.7);
  float r3 = hash21(cell + seed + 47.3);
  vec2 starPos = cell + 0.22 + vec2(r1, r2) * 0.56;
  float d = length(g - starPos);

  float band = exp(-pow(dot(dir, uGalaxyNormal) / 0.22, 2.0));
  float density = 0.030 + band * 0.110;
  float exists = step(1.0 - density, r3);

  float core = smoothstep(0.035, 0.0, d);
  float glow = smoothstep(0.120, 0.0, d) * 0.32;
  float twinkle = 0.62 + 0.38 * sin(uTime * (0.6 + r1 * 1.8) + r3 * 43.0);
  vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.90, 0.75), r2);
  float horizonMask = smoothstep(0.0, 0.16, h);
  return tint * (exists * (core + glow) * twinkle * horizonMask * 2.0);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float sunCos = dot(dir, uSunDir);

  /* ---------- 1. 三段渐变（地平线白带更窄，抬头即见天色） ---------- */
  float topT = pow(smoothstep(0.0, 0.34, h), 0.9);
  float botT = smoothstep(0.0, -0.35, h);
  vec3 col = mix(uHorizonColor, uTopColor, topT);
  col = mix(col, uBottomColor, botT * 0.92);

  /* ---------- 2. 黄昏地平线暖光 ---------- */
  float horizonBand = exp(-abs(h) * 9.0);
  col += uSunColor * uGolden * horizonBand * pow(max(sunCos, 0.0), 2.0) * 0.5;

  /* ---------- 3. 云层采样 ---------- */
  float denom = max(h, 0.05);
  vec2 baseUV = dir.xz / denom;
  float uvR = length(baseUV);
  if (uvR > 18.0) baseUV *= 18.0 / uvR;
  baseUV *= 0.075;
  vec2 drift = vec2(0.012, 0.0045) * uCloudSpd * uTime;
  vec2 uv1 = baseUV + drift;
  vec2 uv2 = baseUV * 2.27 + vec2(0.37, 0.61) + drift * 0.55;
  vec2 uv3 = baseUV * 5.15 + vec2(0.13, 0.77) + drift * 1.35;
  float n1 = texture2D(uCloudTex, uv1).r;
  float n2 = texture2D(uCloudTex, uv2).g;
  float n3 = texture2D(uCloudTex, uv3).b;
  float warp = texture2D(uCloudTex, baseUV * 1.9 + vec2(0.51, 0.29) - drift * 0.35).a;

  float n = n1 * 0.62 + n2 * 0.26 + n3 * 0.12;
  n += (warp - 0.5) * (0.16 + uCloudCover * 0.22);

  float th = 0.62 - uCloudCover * 0.35 + (n3 - 0.5) * 0.06;
  float dens = smoothstep(th, th + 0.18, n);
  // 高云量天气（阴/雷雨）过渡成一整片低垂云幕，但仍保留内部明暗纹理
  float sheet = smoothstep(0.55, 0.95, uCloudCover);
  dens = mix(dens, 0.80 + 0.20 * dens, sheet);
  dens *= smoothstep(0.0, 0.14, h);

  float detail = texture2D(uCloudTex, baseUV * 3.7 + vec2(0.83, 0.17) + drift * 1.1).b;
  float core = smoothstep(0.52, 1.0, n);

  /* ---------- 4. 星空 + 银河 ---------- */
  float cloudMask = 1.0 - dens * 0.92;
  float starVis = uStarOpacity * cloudMask * smoothstep(0.0, 0.18, h);
  if (starVis > 0.002) {
    col += starField(dir, h) * starVis;
    float band = exp(-pow(dot(dir, uGalaxyNormal) / 0.26, 2.0));
    col += vec3(0.13, 0.16, 0.24) * band * starVis * 0.55;
  }

  /* ---------- 5. 太阳（白天） ---------- */
  float sunVis = clamp(uSunIntensity * 0.5, 0.0, 1.15) *
                 (1.0 - uCloudCover * 0.55) *
                 (1.0 - uNight * 0.92);
  float sunGlow = pow(max(sunCos, 0.0), 5.0) * 0.20 +
                  pow(max(sunCos, 0.0), 26.0) * 0.40;
  col += uSunColor * sunGlow * sunVis;
  float sunDisc = smoothstep(uSunDisc.x, uSunDisc.y, sunCos);
  col += uSunColor * sunDisc * 2.6 * sunVis;
  col += uSunColor * pow(max(sunCos, 0.0), 700.0) * 0.6 * sunVis;

  /* ---------- 6. 月亮（夜晚） ---------- */
  float moonVis = smoothstep(0.22, 0.72, uNight) *
                  (1.0 - uCloudCover * 0.5) *
                  clamp(uMoonIntensity * 0.7, 0.0, 1.2);
  float moonDisc = smoothstep(uMoonDisc.x, uMoonDisc.y, sunCos);
  float maria = texture2D(uCloudTex, dir.xz * 1.6 + vec2(0.2) + uSunDir.xz * 2.0).r;
  col += vec3(0.82, 0.90, 1.0) * moonDisc * (0.60 + 0.40 * maria) * 2.8 * moonVis;
  float moonHalo = pow(max(sunCos, 0.0), 400.0) * 0.5 +
                   pow(max(sunCos, 0.0), 48.0) * 0.07;
  col += vec3(0.45, 0.60, 1.0) * moonHalo * moonVis;

  /* ---------- 7. 云色合成（体积感：向阳面亮、致密核心暗、太阳边缘镀银） ---------- */
  vec2 dirXZ = normalize(dir.xz + vec2(0.0001));
  vec2 sunXZ = normalize(uSunDir.xz + vec2(0.0001));
  float sunSide = dot(dirXZ, sunXZ) * 0.5 + 0.5;
  vec3 cloudCol = uCloudTint * (0.78 + 0.50 * sunSide) * (0.90 + detail * 0.28);
  cloudCol = mix(cloudCol, cloudCol * 0.72, core * 0.60);
  float rim = pow(max(sunCos, 0.0), 9.0);
  cloudCol += uSunColor * rim * 0.55 * (1.0 - uNight * 0.8) * (1.0 - uCloudCover * 0.3);
  cloudCol += vec3(0.45, 0.55, 0.80) * uNight * uMoonIntensity * 0.05 * (0.25 + rim);
  cloudCol += vec3(0.62, 0.72, 0.95) * uLightning * (1.6 + core * 1.8);
  cloudCol = mix(cloudCol, uHorizonColor, smoothstep(0.22, 0.01, h) * 0.72);

  float cloudAlpha = dens * (0.90 + 0.10 * detail);
  col = mix(col, cloudCol, cloudAlpha);

  /* ---------- 8. 地平线雾霭收边 ---------- */
  float haze = smoothstep(0.055, -0.02, h);
  col = mix(col, uFogColor, haze * 0.65);

  /* ---------- 9. 闪电整片提亮 ---------- */
  col += vec3(0.45, 0.52, 0.72) * uLightning * (0.35 + cloudAlpha * 0.90);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------ *
 * createSky
 * ------------------------------------------------------------------ */

export function createSky({ scene, env, quality, mobile, getFocus }) {
  const group = new THREE.Group();
  group.name = 'sky';

  /* ---- 云噪声纹理：移动端/低质量用 128，桌面 256 ---- */
  const texSize = mobile || quality < 0.9 ? 128 : 256;
  const cloudTex = makeCloudNoiseTexture(texSize);

  const uniforms = {
    uTopColor: { value: new THREE.Color(env.skyTop.getHex()) },
    uHorizonColor: { value: new THREE.Color(env.skyHorizon.getHex()) },
    uBottomColor: { value: new THREE.Color(env.skyBottom.getHex()) },
    uFogColor: { value: new THREE.Color(env.fogColor.getHex()) },
    uSunColor: { value: new THREE.Color(env.sunColor.getHex()) },
    uSunDir: { value: env.sunDir.clone() },
    uCloudTint: { value: new THREE.Color(env.cloudTint.getHex()) },
    uGalaxyNormal: { value: new THREE.Vector3(-0.46, 0.58, 0.67).normalize() },
    uSunIntensity: { value: env.sunIntensity },
    uMoonIntensity: { value: env.moonIntensity },
    uNight: { value: env.night },
    uGolden: { value: env.golden },
    uDayFactor: { value: env.dayFactor },
    uCloudCover: { value: env.cloudCover },
    uCloudSpd: { value: env.cloudSpd },
    uStarOpacity: { value: env.starOpacity },
    uLightning: { value: 0 },
    uTime: { value: 0 },
    uSunDisc: { value: new THREE.Vector2(Math.cos(0.021), Math.cos(0.012)) },
    uMoonDisc: { value: new THREE.Vector2(Math.cos(0.013), Math.cos(0.0075)) },
    uCloudTex: { value: cloudTex },
  };

  const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 48, 32);
  const domeMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.name = 'sky-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  group.add(dome);

  /* ---- 灯光（weather 模块不创建灯光，全部由 sky 负责） ---- */
  const sun = new THREE.DirectionalLight(env.sunColor.getHex(), env.sunIntensity);
  sun.name = 'sun-light';
  sun.castShadow = true;
  const shadowSize = mobile ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 170;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.22;
  sun.shadow.radius = 1.8; // PCF 软阴影半径（three r186 支持）
  scene.add(sun);
  scene.add(sun.target);

  const moonColor = new THREE.Color(0x9db4d6);
  const moon = new THREE.DirectionalLight(0x9db4d6, 0);
  moon.name = 'moon-light';
  moon.castShadow = false;
  scene.add(moon);
  scene.add(moon.target);

  const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiIntensity);
  hemi.name = 'hemi-light';
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(env.ambientColor, env.ambientIntensity);
  ambient.name = 'ambient-light';
  scene.add(ambient);

  /* ---- 雾（穹顶负责背景，不设置 scene.background） ---- */
  scene.fog = new THREE.FogExp2(env.fogColor.getHex(), env.fogDensity);

  /* ---- 每帧复用临时对象（update 内零分配） ---- */
  const _focus = new THREE.Vector3();
  const _moonDir = new THREE.Vector3();
  const _sunPos = new THREE.Vector3();

  let disposed = false;

  function update(dt, e) {
    if (disposed) return;
    const focus = getFocus ? getFocus() : e.focus;
    _focus.copy(focus);

    /* 穹顶跟随玩家（保持视觉上的无限远） */
    group.position.set(_focus.x, _focus.y + 1.2, _focus.z);

    /* uniforms */
    uniforms.uTopColor.value.copy(e.skyTop);
    uniforms.uHorizonColor.value.copy(e.skyHorizon);
    uniforms.uBottomColor.value.copy(e.skyBottom);
    uniforms.uFogColor.value.copy(e.fogColor);
    uniforms.uSunColor.value.copy(e.sunColor);
    uniforms.uSunDir.value.copy(e.sunDir);
    uniforms.uCloudTint.value.copy(e.cloudTint);
    uniforms.uSunIntensity.value = e.sunIntensity;
    uniforms.uMoonIntensity.value = e.moonIntensity;
    uniforms.uNight.value = e.night;
    uniforms.uGolden.value = e.golden;
    uniforms.uDayFactor.value = e.dayFactor;
    uniforms.uCloudCover.value = e.cloudCover;
    uniforms.uCloudSpd.value = e.cloudSpd;
    uniforms.uStarOpacity.value = e.starOpacity;
    uniforms.uLightning.value = e.lightning;
    uniforms.uTime.value = e.time;

    /* 主光：方向/颜色/强度全部来自 env，阴影相机跟随 focus */
    sun.color.copy(e.sunColor);
    sun.intensity = e.sunIntensity;
    // 光源距离只影响阴影相机的 near/far 跨度，不影响方向：
    // 拉近到 90 可显著提升阴影贴图精度（远景细节更清晰）
    const sunDist = 90;
    _sunPos.set(
      _focus.x + e.sunDir.x * sunDist,
      _focus.y + e.sunDir.y * sunDist,
      _focus.z + e.sunDir.z * sunDist
    );
    sun.position.copy(_sunPos);
    sun.target.position.set(_focus.x, 0, _focus.z);
    // 阴影强度：晴日清晰、阴雨柔化、夜晚减弱（保留月光轮廓）
    if (sun.shadow) {
      const sh = (1 - e.rain * 0.45) * (1 - e.snow * 0.30) * (1 - e.fogDensity * 22) * (1 - e.night * 0.55);
      sun.shadow.intensity = Math.max(0.18, Math.min(1, sh));
      // 让阴影在贴图边界处柔和淡出，避免出现方形接缝
      sun.shadow.radius = 2.2 + e.rain * 1.5 + e.snow * 0.8;
    }

    /* 月亮补光：从主光对侧偏高处补冷光，夜里有轮廓又不死黑 */
    _moonDir.set(-e.sunDir.x, Math.max(0.42, e.sunDir.y * 0.8), -e.sunDir.z).normalize();
    moon.color.copy(e.sunColor).lerp(moonColor, 0.35 + 0.65 * Math.min(1, e.night));
    moon.intensity = e.moonIntensity * 0.9;
    moon.position.set(
      _focus.x + _moonDir.x * 120,
      _moonDir.y * 120,
      _focus.z + _moonDir.z * 120
    );
    moon.target.position.set(_focus.x, 0, _focus.z);

    /* 半球光 / 环境光 */
    hemi.color.copy(e.hemiSky);
    hemi.groundColor.copy(e.hemiGround);
    hemi.intensity = e.hemiIntensity;
    ambient.color.copy(e.ambientColor);
    ambient.intensity = e.ambientIntensity;

    /* 雾 */
    if (scene.fog) {
      scene.fog.color.copy(e.fogColor);
      scene.fog.density = e.fogDensity;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(sun);
    scene.remove(sun.target);
    scene.remove(moon);
    scene.remove(moon.target);
    scene.remove(hemi);
    scene.remove(ambient);
    sun.dispose();
    moon.dispose();
    hemi.dispose();
    ambient.dispose();
    domeGeo.dispose();
    domeMat.dispose();
    cloudTex.dispose();
    group.removeFromParent();
    if (scene.fog) scene.fog = null;
  }

  // 首帧之前先用 env 初始值对齐一次（experience 会先 setPreset(instant) 再进循环）
  update(0, env);

  return { object: group, update, dispose };
}

/**
 * 水面着色器（A · 泉与地形 / water 子模块）
 * ------------------------------------------------------------------
 * 一个共享的 ShaderMaterial 渲染全园水面（主池 + 溪流 + 荷花池 + 5 个小泉池）：
 *  - 深度渐变（aShore 属性：0=岸边，1=池心）+ 天空 Fresnel 反射（实时 env 颜色）
 *  - 多层流动法线噪声 + 日光/月光高光（env.sunDir / sunColor）
 *  - 雨天雨点涟漪（程序化圆环）、阴雨变暗变糙；雪天边缘薄冰；夜间月光与灯笼暖光
 *  - 三股主泉的水丘位移（顶点着色器）+ 白沫 / 扩散波纹环；小泉冒泡涟漪
 *  - 手工 FogExp2（与场景雾一致），片元末尾接 ACES tone mapping + 色彩空间转换
 */

import * as THREE from 'three';
import { COLORS } from '../../utils/palette.js';

export const JET_COUNT = 3;
export const SPRING_COUNT = 5;

const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

export const WATER_VERT = /* glsl */ `
  precision highp float;
  attribute float aShore;
  uniform float uTime;
  uniform float uWind;
  uniform vec4 uJetA[3];
  uniform float uJetPhase[3];
  varying vec3 vWorld;
  varying float vShore;

  ${NOISE_GLSL}

  float waveField(vec2 p) {
    float t = uTime;
    float amp = mix(0.4, 1.0, uWind);
    float h = 0.0;
    h += vnoise(p * 0.42 + vec2(t * 0.05, t * 0.035)) * 0.075;
    h += vnoise(p * 1.15 + vec2(-t * 0.09, t * 0.06)) * 0.030;
    h += vnoise(p * 2.70 + vec2(t * 0.16, -t * 0.11)) * 0.012;
    return h * amp;
  }

  float jetMound(vec2 p) {
    float t = uTime;
    float h = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 j = uJetA[i];
      vec2 d = p - j.xy;
      float r = j.z;
      float pulse = 0.82 + 0.18 * sin(t * 1.9 + uJetPhase[i]) + 0.07 * sin(t * 3.3 + uJetPhase[i] * 1.7);
      h += exp(-dot(d, d) / (r * r * 1.35)) * j.w * 0.52 * pulse;
      float dl = length(d);
      h += sin(dl * 4.5 - t * 3.0 + uJetPhase[i]) * exp(-dl * 1.15) * 0.018;
    }
    return h;
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += waveField(wp.xz) + jetMound(wp.xz);
    vWorld = wp.xyz;
    vShore = aShore;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const WATER_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uRain;
  uniform float uSnow;
  uniform float uWind;
  uniform float uNight;
  uniform float uGolden;
  uniform float uDayFactor;
  uniform float uLightning;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyBottom;
  uniform vec3 uCloudTint;
  uniform vec3 uAmbientColor;
  uniform vec3 uHemiSky;
  uniform vec3 uHemiGround;
  uniform vec3 uWarm;
  uniform float uSunIntensity;
  uniform float uMoonIntensity;
  uniform float uAmbientIntensity;
  uniform float uHemiIntensity;
  uniform float uCloudCover;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uWaterDeep;
  uniform vec3 uWaterShallow;
  uniform vec3 uWaterSurface;
  uniform sampler2D uReflection;
  uniform mat4 uReflectionMatrix;
  uniform float uReflectionStrength;
  uniform vec2 uReflectionTexel;
  uniform vec4 uJetA[3];
  uniform float uJetPhase[3];
  uniform vec4 uSpringA[5];

  varying vec3 vWorld;
  varying float vShore;

  ${NOISE_GLSL}

  float waveField(vec2 p) {
    float t = uTime;
    float amp = mix(0.4, 1.0, uWind);
    float h = 0.0;
    h += vnoise(p * 0.42 + vec2(t * 0.05, t * 0.035)) * 0.075;
    h += vnoise(p * 1.15 + vec2(-t * 0.09, t * 0.06)) * 0.030;
    h += vnoise(p * 2.70 + vec2(t * 0.16, -t * 0.11)) * 0.012;
    return h * amp;
  }

  float jetMound(vec2 p) {
    float t = uTime;
    float h = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 j = uJetA[i];
      vec2 d = p - j.xy;
      float r = j.z;
      float pulse = 0.82 + 0.18 * sin(t * 1.9 + uJetPhase[i]) + 0.07 * sin(t * 3.3 + uJetPhase[i] * 1.7);
      h += exp(-dot(d, d) / (r * r * 1.35)) * j.w * 0.52 * pulse;
      float dl = length(d);
      h += sin(dl * 4.5 - t * 3.0 + uJetPhase[i]) * exp(-dl * 1.15) * 0.018;
    }
    return h;
  }

  // 雨天涟漪
  float rainRings(vec2 p, float t) {
    if (uRain < 0.015) return 0.0;
    float acc = 0.0;
    for (int i = 0; i < 2; i++) {
      float sc = 1.75 + float(i) * 1.25;
      vec2 q = p * sc;
      vec2 cell = floor(q);
      vec2 f = fract(q);
      float seed = hash21(cell + 3.7);
      float bt = fract(t * (0.85 + 0.5 * seed) + seed * 7.0);
      vec2 c = vec2(hash21(cell + 1.3), hash21(cell + 8.1)) * 0.5 + 0.25;
      float d = length(f - c);
      float radius = bt * 0.44;
      float ring = smoothstep(0.075, 0.0, abs(d - radius)) * (1.0 - bt);
      acc += ring;
    }
    return acc * uRain;
  }

  // 三股泉的白沫与波纹环
  float jetFoam(vec2 p) {
    float t = uTime;
    float f = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 j = uJetA[i];
      vec2 d = p - j.xy;
      float dist = length(d);
      float r = j.z;
      float core = exp(-dist * dist / (r * r * 2.1));
      float boil = 0.55 + 0.45 * sin(dist * 9.0 - t * 5.2 + uJetPhase[i]);
      f += core * (0.78 + 0.38 * boil);
      // 更宽的白沫圈 + 多层扩散环
      f += exp(-dist * dist / (r * r * 7.5)) * 0.34 * (0.6 + 0.4 * sin(t * 2.6 + uJetPhase[i]));
      float ring = sin(dist * 5.2 - t * 3.4 + uJetPhase[i] * 2.0);
      f += smoothstep(0.40, 1.0, ring) * exp(-dist * 0.42) * 0.42;
    }
    return clamp(f, 0.0, 1.0);
  }

  // 小泉冒泡的细密涟漪
  float springRipples(vec2 p) {
    float t = uTime;
    float f = 0.0;
    for (int i = 0; i < 5; i++) {
      vec4 s = uSpringA[i];
      float d = length(p - s.xy);
      float ring = 0.5 + 0.5 * sin(d * 6.8 - t * 2.3 + s.w * 9.0);
      f += pow(ring, 5.0) * exp(-d * 0.8) * s.w * 0.9;
      f += exp(-d * d / (s.z * s.z * 0.5)) * s.w * 0.22 * (0.65 + 0.35 * sin(t * 3.1 + s.w * 22.0));
    }
    return f;
  }

  vec3 waterNormal(vec2 p) {
    float e = 0.22;
    float hl = waveField(p - vec2(e, 0.0)) + jetMound(p - vec2(e, 0.0));
    float hr = waveField(p + vec2(e, 0.0)) + jetMound(p + vec2(e, 0.0));
    float hd = waveField(p - vec2(0.0, e)) + jetMound(p - vec2(0.0, e));
    float hu = waveField(p + vec2(0.0, e)) + jetMound(p + vec2(0.0, e));
    vec2 grad = vec2(hr - hl, hu - hd) / (2.0 * e);
    return normalize(vec3(-grad.x, 1.0, -grad.y));
  }

  void main() {
    vec3 p3 = vWorld;
    vec2 p = p3.xz;
    float t = uTime;
    float shore = clamp(vShore, 0.0, 1.0);
    float shoreEdge = 1.0 - shore; // 1=水边

    vec3 N = waterNormal(p);

    // 雨天打碎法线
    float rainN1 = vnoise(p * 8.5 + vec2(t * 1.4, t * 0.6)) - 0.5;
    float rainN2 = vnoise(p * 8.5 + vec2(-t * 0.8, t * 1.1) + 17.3) - 0.5;
    N = normalize(N + vec3(rainN1, 0.0, rainN2) * uRain * 0.55);
    // 雪天法线更平
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), uSnow * 0.45));
    N = normalize(N + vec3(rainN1, 0.0, rainN2) * 0.02);

    vec3 V = normalize(cameraPosition - p3);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 4.2);
    float F = mix(0.02, 1.0, fres);

    // ---- 天空反射 ----
    vec3 R = reflect(-V, N);
    float ry = clamp(R.y, -1.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.55, ry));
    sky = mix(sky, uSkyBottom, smoothstep(0.0, -0.4, ry));
    // 云反射微调
    sky = mix(sky, uCloudTint, uCloudCover * 0.10 * smoothstep(0.0, 0.8, ry));

    float sunDot = max(dot(R, uSunDir), 0.0);
    float dayGlow = uSunIntensity * mix(0.25, 1.0, uDayFactor);
    sky += uSunColor * (pow(sunDot, 620.0) * 3.2 + pow(sunDot, 34.0) * 0.34) * dayGlow * 0.6;
    // 月光
    float moonDot = pow(max(dot(R, uSunDir), 0.0), 320.0);
    sky += vec3(0.62, 0.72, 0.92) * (moonDot * 1.1 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.06) * uMoonIntensity;
    // 夜间岸边灯笼的暖光（虚化反射）
    float lantern = exp(-shoreEdge * 2.2) * uNight;
    sky += uWarm * lantern * (0.10 + 0.14 * vnoise(p * 0.9 + t * 0.05));


    // ---- 水体颜色 ----
    vec3 body = mix(uWaterShallow, uWaterDeep, smoothstep(0.05, 0.95, shore));
    // 泉水本身近乎无色：以极淡的青绿色为主，主要靠池底与反射呈现
    body = mix(vec3(0.10, 0.28, 0.28), body, 0.42);
    vec3 lit = uAmbientColor * uAmbientIntensity * 0.55
             + mix(uHemiGround, uHemiSky, 0.6) * uHemiIntensity * 0.35
             + uSunColor * uSunIntensity * 0.12;
    body *= (0.12 + lit * 0.40);
    body = mix(body, body * vec3(0.72, 0.82, 0.86), uRain * 0.6);
    body = mix(body, body * vec3(0.80, 0.92, 1.0), uSnow * 0.5);
    // 夜间水体整体压暗（月光下的深青）
    body *= mix(1.0, 0.30, uNight);
    body += vec3(0.035, 0.055, 0.08) * uMoonIntensity * 0.6;

    // ---- 白沫 / 涟漪 / 冰 ----
    float foam = jetFoam(p) + springRipples(p);
    // 岸边细沫（风大时更明显）
    foam += smoothstep(0.72, 1.0, shoreEdge) * (0.10 + 0.18 * uWind) * (0.4 + 0.6 * vnoise(p * 3.2 + t * 0.4));
    foam += rainRings(p, t) * 0.55;
    foam = clamp(foam, 0.0, 1.4);

    float ice = (1.0 - smoothstep(0.0, 0.55, shore)) * uSnow;
    ice *= 0.55 + 0.45 * vnoise(p * 1.6 + 4.2);
    ice = clamp(ice, 0.0, 1.0);

    // ---- 真实平面反射（亭台、树木、天空映在水中） ----
    // 用反射相机纹理矩阵把水面世界坐标投到反射 RT 的屏幕 UV，并按法线做轻微扰动
    vec4 reflCoord = uReflectionMatrix * vec4(p3, 1.0);
    vec2 reflUV = reflCoord.xy / max(reflCoord.w, 1e-4);
    // 扰动只取低频、小幅度，避免三角扇几何法线在三角边界产生楔形条纹
    float dn1 = vnoise(p * 0.55 + vec2(t * 0.10, -t * 0.07)) - 0.5;
    float dn2 = vnoise(p * 0.55 + vec2(-t * 0.08, t * 0.11) + 31.7) - 0.5;
    vec2 distortion = vec2(dn1, dn2) * 0.035 + vec2(N.x, N.z) * 0.012;
    reflUV += distortion;
    // 竖向拉丝：水面反射比镜面更"糊"，按距离做模糊采样
    // 反射相机只渲染水面以上，靠近相机的水面可能投影到 RT 之外：
    // 用边缘淡出（0 表示该处没有可用反射），避免采到无效区域产生黑色楔形
    vec2 edge = smoothstep(vec2(0.0), vec2(0.30), reflUV) *
                smoothstep(vec2(0.0), vec2(0.30), 1.0 - reflUV);
    float reflValid = edge.x * edge.y;
    vec3 reflCol = vec3(0.0);
    float reflW = 0.0;
    for (int i = -1; i <= 1; i++) {
      float w = 1.0 - abs(float(i)) * 0.35;
      vec2 uv = reflUV + vec2(0.0, float(i) * uReflectionTexel.y * 1.6);
      reflCol += texture2D(uReflection, clamp(uv, 0.02, 0.98)).rgb * w;
      reflW += w;
    }
    reflCol /= max(reflW, 1e-4);
    // 水面吸收：倒影随距离与深度衰减，加入水色
    // 水面吸收：清澈泉水对倒影吸收很弱，只轻微压暗并带一点水色
    vec3 reflTint = mix(uWaterDeep * 0.42 + uWaterShallow * 0.28, vec3(1.0), 0.84);
    reflCol *= reflTint;
    // 倒影略提对比，避免被水面雾化冲淡
    reflCol = (reflCol - 0.5) * 1.08 + 0.5;
    // 反射权重：以 Fresnel 为主，浅水/岸边稍弱；白沫与冰面不反射
    float reflAmount = uReflectionStrength * clamp(0.55 + F * 0.75, 0.0, 1.0);
    reflAmount *= 1.0 - ice * 0.85;
    reflAmount *= 1.0 - clamp(foam, 0.0, 1.0) * 0.7;
    reflAmount *= reflValid;                 // 无有效反射处退回天空反射
    reflAmount = clamp(reflAmount, 0.0, 0.95);
    // 倒影参与最终颜色（同时保留天空反射作为兜底）
    sky = mix(sky, reflCol, reflAmount);

    vec3 foamColor = vec3(0.92, 0.96, 0.99) * (0.46 + 0.42 * clamp(lit, 0.0, 1.2));
    vec3 iceColor = vec3(0.78, 0.86, 0.92) * (0.5 + 0.5 * clamp(lit, 0.0, 1.2));

    // ---- 合成 ----
    // 天空反射与真实倒影按 Fresnel 混合后，再与水体颜色合成
    vec3 col = mix(body, sky, clamp(F * 0.95, 0.0, 1.0));
    // 倒影再叠加一层（清透水面下也可见），随深度/浑浊度衰减
    float reflDirect = reflAmount * (0.62 + 0.38 * F);
    col = mix(col, reflCol, clamp(reflDirect, 0.0, 0.92));
    col = mix(col, foamColor, clamp(foam, 0.0, 1.0) * 0.68);
    col = mix(col, iceColor, ice * 0.72);
    // 金色时刻水面偏暖
    col += uSunColor * uGolden * 0.05 * smoothstep(0.2, 1.0, F + 0.2);
    col *= mix(1.0, 0.8, uRain * 0.8);
    col += uLightning * vec3(0.45, 0.55, 0.7) * (0.25 + 0.75 * F);
    // 夜间：反射星空/月光，而非白天天空色
    col = mix(col, col * vec3(0.30, 0.42, 0.62) + vec3(0.02, 0.03, 0.055) * F, uNight * 0.85);

    // 趵突泉水"清冽见底"：中心水浅处更透明，让池底卵石与焦散透出来；
    // 只在 Fresnel 反射角、白沫、薄冰处提高不透明度。
    float depthFade = smoothstep(0.10, 0.92, shore);      // 靠岸更透明（浅）
    // 更通透：中心区几乎可以看穿到池底（池底自身有颜色与焦散）
    float alpha = 0.12 + F * 0.82 + foam * 0.60 + ice * 0.45;
    alpha += reflAmount * 0.78;              // 倒影区域接近不透明，倒影才清晰
    alpha *= mix(1.0, 0.58, depthFade);
    alpha = clamp(alpha, 0.0, 0.96);

    // 手工雾（FogExp2）
    float dist = length(cameraPosition - p3);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createWaterMaterial({ env, jets, springs }) {
  // 占位反射纹理：绑定真实反射 RT 之前，避免 null sampler 造成 WebGL 校验错误
  const placeholder = new THREE.DataTexture(new Uint8Array([120, 150, 160, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const uniforms = {
    uTime: { value: 0 },
    uRain: { value: 0 },
    uSnow: { value: 0 },
    uWind: { value: 0.2 },
    uNight: { value: 0 },
    uGolden: { value: 0 },
    uDayFactor: { value: 1 },
    uLightning: { value: 0 },
    uSunDir: { value: env.sunDir },
    uSunColor: { value: env.sunColor },
    uSkyTop: { value: env.skyTop },
    uSkyHorizon: { value: env.skyHorizon },
    uSkyBottom: { value: env.skyBottom },
    uCloudTint: { value: env.cloudTint },
    uAmbientColor: { value: env.ambientColor },
    uHemiSky: { value: env.hemiSky },
    uHemiGround: { value: env.hemiGround },
    uWarm: { value: new THREE.Color(1.0, 0.55, 0.26) },
    uSunIntensity: { value: 1 },
    uMoonIntensity: { value: 0 },
    uAmbientIntensity: { value: 0.5 },
    uHemiIntensity: { value: 1 },
    uCloudCover: { value: 0 },
    uFogColor: { value: env.fogColor },
    uFogDensity: { value: 0.0026 },
    uWaterDeep: { value: new THREE.Color(COLORS.waterDeep) },
    uWaterShallow: { value: new THREE.Color(COLORS.waterShallow) },
    uWaterSurface: { value: new THREE.Color(COLORS.waterSurface) },
    uJetA: {
      value: jets.map((j) => new THREE.Vector4(j.x, j.z, j.radius, j.height)),
    },
    uJetPhase: { value: jets.map((j) => j.phase) },
    uSpringA: {
      value: springs.map((s) => new THREE.Vector4(s.x, s.z, s.radius, s.strength)),
    },
    uReflection: { value: placeholder },
    uReflectionMatrix: { value: new THREE.Matrix4() },
    uReflectionStrength: { value: 0 },
    uReflectionTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: true,
    fog: false,
  });
  material.extensions = { derivatives: false };
  return material;
}

/** 绑定平面反射纹理与矩阵（reflection 为 null 时关闭真实反射） */
export function bindWaterReflection(material, reflection) {
  const u = material.uniforms;
  if (!reflection) {
    u.uReflectionStrength.value = 0;
    return;
  }
  u.uReflection.value = reflection.renderTarget.texture;
  u.uReflectionMatrix.value.copy(reflection.textureMatrix);
  u.uReflectionTexel.value.set(1 / reflection.width, 1 / reflection.height);
  u.uReflectionStrength.value = 0.82;
}

export function updateWaterMaterial(material, env) {
  const u = material.uniforms;
  u.uTime.value = env.time;
  u.uRain.value = env.rain;
  u.uSnow.value = env.snow;
  u.uWind.value = env.wind;
  u.uNight.value = env.night;
  u.uGolden.value = env.golden;
  u.uDayFactor.value = env.dayFactor;
  u.uLightning.value = env.lightning;
  u.uSunIntensity.value = env.sunIntensity;
  u.uMoonIntensity.value = env.moonIntensity;
  u.uAmbientIntensity.value = env.ambientIntensity;
  u.uHemiIntensity.value = env.hemiIntensity;
  u.uCloudCover.value = env.cloudCover;
  u.uFogDensity.value = env.fogDensity;
  // 颜色 uniform 直接引用 env 对象，无需拷贝
}

export { NOISE_GLSL };

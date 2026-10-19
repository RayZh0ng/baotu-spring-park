import * as THREE from 'three';
import { COLORS } from '../../utils/palette.js';

/**
 * 植被风摆 shader 注入 + 天气/季节着色。
 *
 * 设计：
 *  - 所有环境量放在共享 uniform 对象里（每帧只改 value，不新建对象）。
 *  - 顶点：替换 project_vertex，在实例变换后按高度/垂挂程度做正弦位移。
 *  - 片元：color_fragment 之后按 env 做湿润压暗 / 覆雪提白 / 夜晚压暗。
 *  - 非 shader 材质（树干、石小品）用 registerSeason() 做 CPU 颜色插值。
 */

/** 全局风/季节 uniform（所有植被材质共享引用） */
export const ENV_U = {
  time: { value: 0 },
  wind: { value: 0.25 },
  gust: { value: 1 },
  windDir: { value: new THREE.Vector2(0.78, 0.62).normalize() },
  snow: { value: 0 },
  wet: { value: 0 },
  night: { value: 0 },
  golden: { value: 0 },
};

const SNOW_TINT = `vec3( ${new THREE.Color(COLORS.snowTint).r.toFixed(3)}, ${new THREE.Color(COLORS.snowTint).g.toFixed(3)}, ${new THREE.Color(COLORS.snowTint).b.toFixed(3)} )`;

let _windClock = 0;

/** 每帧更新共享 uniform */
export function updateWindUniforms(dt, env) {
  // 独立风钟：风越大走得越快，但基础速度保留一点，静止时也有微动
  _windClock += dt * (0.6 + env.wind * 1.15);
  ENV_U.time.value = _windClock;
  ENV_U.wind.value = env.wind;
  // 阵风包络：低频起伏，让风一阵一阵地吹（自然感的关键）
  const t = _windClock;
  const gust = 0.62
    + 0.26 * Math.sin(t * 0.37)
    + 0.14 * Math.sin(t * 0.83 + 1.7)
    + 0.08 * Math.sin(t * 1.71 + 4.2);
  ENV_U.gust.value = Math.max(0.18, gust);
  // 风向缓慢摆动（±25°）
  const ang = 0.32 + Math.sin(t * 0.11) * 0.42;
  ENV_U.windDir.value.set(Math.cos(ang), Math.sin(ang));
  ENV_U.snow.value = env.snow;
  ENV_U.wet.value = env.wetness;
  ENV_U.night.value = env.night;
  ENV_U.golden.value = env.golden;
}

/* ------------------------------------------------------------------ shader 片段 */

function windVertexCode(mode, u) {
  const head = `
vec4 mvPosition = vec4( transformed, 1.0 );
vec3 iOrigin = vec3( 0.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	iOrigin = instanceMatrix[ 3 ].xyz;
#endif
float wPh = iOrigin.x * 0.37 + iOrigin.z * 0.29;
float wT = uTime * ${u.speed.toFixed(3)};
// 阵风：整体强度包络（uGust 由 CPU 侧低频起伏）
float wGust = uGust;
float wStrength = uWind * ${u.sway.toFixed(4)} * wGust;
// 每株植物自己的相位偏移，避免整片同步摆动
float wPhase = wPh * 1.7;
vec2 wDir = uWindDir;
`;
  if (mode === 'hanging') {
    // 垂挂卡片（柳条/藤蔓）：越靠下摆幅越大，并带轻微扭转
    return `${head}
float hang = clamp( -position.y / ${u.height.toFixed(3)}, 0.0, 1.0 );
hang = hang * hang * ( 3.0 - 2.0 * hang );
float s1 = sin( wT * 1.05 + wPh + position.y * 0.35 );
float s2 = sin( wT * 2.17 + wPh * 1.6 + position.y * 0.9 );
float s3 = sin( wT * 0.43 + wPh * 0.7 );
float sway = ( s1 * 0.62 + s2 * 0.24 + s3 * 0.32 ) * wStrength * hang;
mvPosition.x += ( sway * wDir.x + s2 * 0.12 * wStrength * hang ) ;
mvPosition.z += ( sway * wDir.y + cos( wT * 0.86 + wPh * 1.24 + position.y * 0.55 ) * wStrength * 0.35 * hang );
mvPosition.y += sin( wT * 1.47 + wPh * 1.9 + position.y * 0.7 ) * wStrength * 0.08 * hang;
// 叶片随摆动轻微扭转（绕枝条轴向）
float twist = sin( wT * 1.3 + wPh * 2.1 + position.y * 1.4 ) * wStrength * 2.2 * hang;
mvPosition.x += position.z * twist;
mvPosition.z -= position.x * twist;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
  }
  if (mode === 'upright') {
    // 竖直卡（草/芦苇）：根部固定，越高越摆；草尖带高频颤动
    return `${head}
float hFac = clamp( position.y / ${u.height.toFixed(3)}, 0.0, 1.0 );
float bend = hFac * hFac;
// 三个频段叠加：低频倒伏 + 中频摆动 + 高频颤动
float low = sin( wT * 0.72 + wPh * 0.55 );
float mid = sin( wT * 1.75 + wPh + position.y * 0.6 );
float high = sin( wT * 3.9 + wPh * 2.3 + position.y * 2.1 );
float sway = ( low * 0.55 + mid * 0.38 + high * 0.12 ) * wStrength * bend;
mvPosition.x += sway * wDir.x;
mvPosition.z += sway * wDir.y;
// 草叶横向扭动（垂直于风向）
float cross = cos( wT * 1.35 + wPh * 1.4 + position.y * 1.1 ) * wStrength * 0.28 * bend;
mvPosition.x += -wDir.y * cross;
mvPosition.z += wDir.x * cross;
// 阵风时草叶被压低的纵向变化
mvPosition.y -= abs(sway) * 0.35 * hFac;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
  }
  // rigid：整张叶簇作为一个实例随高度整体轻摆，并带轻微扭转
  return `${head}
float hFac = clamp( ( iOrigin.y - 0.15 ) / ${u.height.toFixed(3)}, 0.0, 1.0 );
hFac = hFac * hFac * ( 3.0 - 2.0 * hFac );
float s1 = sin( wT * 1.12 + wPh );
float s2 = sin( wT * 2.36 + wPh * 1.7 );
float s3 = sin( wT * 0.61 + wPh * 0.9 );
float sway = ( s1 * 0.58 + s2 * 0.26 + s3 * 0.30 ) * wStrength * hFac;
mvPosition.x += sway * wDir.x;
mvPosition.z += sway * wDir.y;
mvPosition.y += sin( wT * 1.73 + wPh * 2.1 ) * wStrength * 0.10 * hFac;
// 叶簇整体轻微扭转，避免"整片平移"的假感
float twist = s2 * wStrength * 0.55 * hFac;
mvPosition.x += ( position.z ) * twist;
mvPosition.z -= ( position.x ) * twist;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
}

/**
 * 给材质注入风摆 + 天候着色。
 * opts: { mode:'rigid'|'hanging'|'upright', sway, height, speed, snow, wet, night }
 */
export function applyWind(material, opts = {}) {
  const u = {
    mode: opts.mode || 'rigid',
    sway: opts.sway ?? 0.16,
    height: opts.height ?? 7,
    speed: opts.speed ?? 1,
    snow: opts.snow ?? 0.72,
    wet: opts.wet ?? 0.45,
    night: opts.night ?? 0.42,
  };
  const uid = `${u.mode}-${u.sway}-${u.height}-${u.speed}-${u.snow}-${u.wet}-${u.night}`;
  material.customProgramCacheKey = () => `vegwind:${uid}`;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = ENV_U.time;
    shader.uniforms.uWind = ENV_U.wind;
    shader.uniforms.uGust = ENV_U.gust;
    shader.uniforms.uWindDir = ENV_U.windDir;
    shader.uniforms.uSnow = ENV_U.snow;
    shader.uniforms.uWet = ENV_U.wet;
    shader.uniforms.uNight = ENV_U.night;
    shader.uniforms.uSnowAmt = { value: u.snow };
    shader.uniforms.uWetAmt = { value: u.wet };
    shader.uniforms.uNightAmt = { value: u.night };

    shader.vertexShader =
      'uniform float uTime;\nuniform float uWind;\nuniform float uGust;\nuniform vec2 uWindDir;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      windVertexCode(u.mode, u)
    );

    shader.fragmentShader =
      'uniform float uSnow;\nuniform float uWet;\nuniform float uNight;\nuniform float uSnowAmt;\nuniform float uWetAmt;\nuniform float uNightAmt;\n' +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
	diffuseColor.rgb *= mix( 1.0, 0.58, uWet * uWetAmt );
	diffuseColor.rgb = mix( diffuseColor.rgb, ${SNOW_TINT}, uSnow * uSnowAmt );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.10, 0.15, 0.22 ), uNight * uNightAmt );`
    );
  };
  material.needsUpdate = true;
  return material;
}

/* ------------------------------------------------------------------ 非 shader 材质的季节色 */

const _tmpColor = new THREE.Color();
const SNOW = new THREE.Color(COLORS.snowTint);
const NIGHT = new THREE.Color(0x2c3a4d);
const seasonEntries = [];

/** 注册随天气变化的普通材质（树干、石材、木材等），CPU 侧颜色插值 */
export function registerSeason(material, opts = {}) {
  seasonEntries.push({
    mat: material,
    base: material.color.clone(),
    wetBase: material.color.clone().multiplyScalar(0.68),
    snowAmt: opts.snow ?? 0.35,
    wetAmt: opts.wet ?? 0.5,
    nightAmt: opts.night ?? 0.35,
  });
  return material;
}

export function updateSeason(env) {
  const { wetness, snow, night } = env;
  for (let i = 0; i < seasonEntries.length; i++) {
    const e = seasonEntries[i];
    const c = e.mat.color;
    c.copy(e.base);
    if (wetness > 0.002) c.lerp(e.wetBase, wetness * e.wetAmt);
    if (night > 0.002) c.lerp(NIGHT, night * e.nightAmt);
    if (snow > 0.002) c.lerp(SNOW, snow * e.snowAmt);
  }
}

/** 供植被 update 汇总调用 */
export function updateVegetationEnv(dt, env) {
  updateWindUniforms(dt, env);
  updateSeason(env);
}

/* ------------------------------------------------------------------ 覆雪覆盖层 */

/**
 * 生成“积雪层”材质：与叶材质同位重合的白卡，夜晚/雪天只改 opacity。
 * alphaMap 用叶片贴图自身，保证雪只落在叶子形状上。
 */
export function makeSnowOverlayMaterial(alphaMap, opacity = 0) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xeef4f7,
    roughness: 0.92,
    metalness: 0.0,
    transparent: true,
    opacity,
    alphaMap,
    alphaTest: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return mat;
}

/* ------------------------------------------------------------------ 实例颜色 */

const _c = new THREE.Color();
/** 建立轻微明暗/色相变化的实例色（避免整片死板），返回 Color[] */
export function jitterColors(rand, count, opts = {}) {
  const { lum = 0.18, warm = 0.05 } = opts;
  const colors = new Array(count);
  for (let i = 0; i < count; i++) {
    const l = 1 - lum * 0.5 + rand() * lum;
    const w = 1 + (rand() - 0.5) * warm;
    _c.setRGB(Math.min(1.08, l * w), l, Math.min(1.08, l / w));
    colors[i] = _c.clone();
  }
  return colors;
}

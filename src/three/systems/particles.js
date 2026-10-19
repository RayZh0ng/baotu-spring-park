import * as THREE from 'three';
import { mulberry32 } from '../utils/random.js';
import { softGlowTexture } from '../utils/tex.js';
import { WATER_SHAPES, WATER_LEVEL } from '../layout.js';

/**
 * 天气粒子（D 号模块）
 * ------------------------------------------------------------
 * 全部在 GPU 上循环滚动（顶点着色器算位置），update() 只写 uniform，
 * 不重建 BufferGeometry、不分配新对象。
 *
 *   rain     雨丝：实例化相机朝向的细长四边形，斜向下落、近清晰远雾化
 *   splash   雨点溅落：短命白色小点精灵（地面 / 主泉池水面）
 *   snow     飘雪：点精灵，缓慢下坠 + 风偏 + 上下浮动
 *   mist     环境轻雾：低空缓慢漂移的 billboard 雾团（泉池正上方淡化，蒸汽归水模块）
 *   firefly  夜间萤火：草丛间暖黄光点，闪烁
 *   leaves   大风时落叶：旋转的小叶片点精灵
 *
 * 粒子盒跟随 env.focus；数量按 quality / 移动端缩放。draw calls = 6（全部可见时）。
 */

const WIND_DIR = new THREE.Vector2(0.78, 0.62).normalize();
const _windXZ = new THREE.Vector2();
const _mistColor = new THREE.Color();
const _white = new THREE.Color(0xffffff);

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

function makeQuadGeometry() {
  // 实例化 billboard 的基础四边形（x/y ∈ [-0.5, 0.5]）
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const pos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const uv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** 相机点精灵像素尺寸换算：worldSize（米）→ 屏幕像素 */
function computePointScale(camera) {
  const dpr = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  const f = camera.projectionMatrix.elements[5] || 1.8;
  return (window.innerHeight || 900) * Math.min(dpr, 2) * 0.5 * f;
}

/* ------------------------------------------------------------------ *
 * 创建粒子系统
 * ------------------------------------------------------------------ */

export function createParticles({ env, camera, quality, mobile }) {
  const group = new THREE.Group();
  group.name = 'particles';

  const q = Math.min(1, Math.max(0.5, Number.isFinite(quality) ? quality : 1));
  const deviceScale = mobile ? 0.5 : 1;
  const rand = mulberry32(0x9a7e5d);

  const RAIN_MAX = Math.round(3200 * q * deviceScale);
  const SNOW_MAX = Math.round(2100 * q * deviceScale);
  const SPLASH_MAX = Math.round(180 * q * deviceScale);
  const MIST_MAX = Math.round(28 * q * (mobile ? 0.7 : 1));
  const FIREFLY_MAX = Math.round(120 * q * deviceScale);
  const LEAF_MAX = Math.round(90 * q * deviceScale);

  const mainPool = WATER_SHAPES.find((s) => s.id === 'main-spring') || {
    cx: 0,
    cz: 0,
    rx: 18,
    rz: 13,
  };

  let pointScale = computePointScale(camera);
  let lastInnerHeight = window.innerHeight || 900;

  /* ================================================================ *
   * 1. 雨丝（实例化四边形）
   * ================================================================ */
  const rainGeo = makeQuadGeometry();
  const rainSeeds = new Float32Array(RAIN_MAX * 4);
  for (let i = 0; i < rainSeeds.length; i++) rainSeeds[i] = rand();
  rainGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(rainSeeds, 4));
  rainGeo.instanceCount = RAIN_MAX;
  rainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const rainUniforms = {
    uFocus: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uRain: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uBox: { value: new THREE.Vector3(52, 26, 52) },
    uAlpha: { value: 0.34 },
    uColor: { value: new THREE.Color(0xc6d8e8) },
  };
  const rainMat = new THREE.ShaderMaterial({
    uniforms: rainUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform vec3 uFocus;
      uniform float uTime;
      uniform float uRain;
      uniform vec2 uWind;
      uniform vec3 uBox;
      uniform float uAlpha;
      attribute vec4 aSeed;
      varying float vAlpha;

      void main() {
        float speed = mix(10.0, 24.0, uRain) * (0.78 + 0.44 * aSeed.w);
        vec3 vel = vec3(uWind.x * 7.0, -speed, uWind.y * 7.0);
        vec3 center = uFocus + vec3(0.0, uBox.y * 0.42, 0.0);
        vec3 size = uBox;
        vec3 rel = aSeed.xyz * size + vel * uTime - center;
        rel = mod(rel, size);
        vec3 world = center + rel - size * 0.5;

        vec3 dirV = normalize(vel);
        vec3 toCam = cameraPosition - world;
        float dist = length(toCam);
        vec3 toCamN = toCam / max(dist, 0.001);
        vec3 side = cross(dirV, toCamN);
        float sl = length(side);
        side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);

        float width = mix(0.007, 0.013, uRain) * (0.7 + 0.6 * aSeed.w);
        float len = mix(0.16, 0.42, uRain) * (0.6 + 0.8 * aSeed.z);
        vec3 pos = world + side * position.x * width + dirV * position.y * len;

        // 近处雨丝淡出（避免贴脸的大白条），远处雾化
        float nearFade = smoothstep(1.2, 4.5, dist);
        float farFade = smoothstep(42.0, 12.0, dist);
        vAlpha = uAlpha * nearFade * farFade * uRain * (0.45 + 0.4 * aSeed.w) * 0.75;
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vAlpha);
      }
    `,
  });
  const rainMesh = new THREE.Mesh(rainGeo, rainMat);
  rainMesh.name = 'rain';
  rainMesh.frustumCulled = false;
  rainMesh.visible = false;
  rainMesh.renderOrder = 6;
  group.add(rainMesh);

  /* ================================================================ *
   * 2. 飘雪（点精灵）
   * ================================================================ */
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW_MAX * 3);
  const snowPhase = new Float32Array(SNOW_MAX);
  const snowSize = new Float32Array(SNOW_MAX);
  for (let i = 0; i < SNOW_MAX; i++) {
    snowPos[i * 3] = rand();
    snowPos[i * 3 + 1] = rand();
    snowPos[i * 3 + 2] = rand();
    snowPhase[i] = rand();
    snowSize[i] = 0.012 + rand() * 0.022;
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  snowGeo.setAttribute('aPhase', new THREE.BufferAttribute(snowPhase, 1));
  snowGeo.setAttribute('aSize', new THREE.BufferAttribute(snowSize, 1));
  snowGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const snowUniforms = {
    uFocus: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uSnow: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uBox: { value: new THREE.Vector3(56, 22, 56) },
    uPointScale: { value: pointScale },
    uColor: { value: new THREE.Color(0xf2f7ff) },
  };
  const snowMat = new THREE.ShaderMaterial({
    uniforms: snowUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      uniform vec3 uFocus;
      uniform float uTime;
      uniform float uSnow;
      uniform vec2 uWind;
      uniform vec3 uBox;
      uniform float uPointScale;
      attribute float aPhase;
      attribute float aSize;
      varying float vAlpha;

      void main() {
        vec3 size = uBox;
        vec3 center = uFocus + vec3(0.0, uBox.y * 0.38, 0.0);
        float fall = mix(0.9, 2.6, uSnow) * (0.65 + aPhase * 0.9);
        float y = mod(position.y * size.y - uTime * fall, size.y);
        float swayX = sin(uTime * (0.55 + aPhase * 0.9) + aPhase * 6.2831) * (0.5 + aPhase * 0.8);
        float swayZ = cos(uTime * (0.45 + aPhase * 0.7) + aPhase * 12.566) * (0.45 + aPhase * 0.7);
        float wx = mod(position.x * size.x + uTime * uWind.x * 2.4 + swayX, size.x);
        float wz = mod(position.z * size.z + uTime * uWind.y * 2.4 + swayZ, size.z);
        vec3 world = center + vec3(wx, y, wz) - size * 0.5;

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        float dist = length(world - cameraPosition);
        float px = uPointScale * aSize * (0.7 + aPhase * 0.6) / max(dist, 0.3);
        gl_PointSize = clamp(px, 1.0, 26.0);
        vAlpha = uSnow * smoothstep(52.0, 10.0, dist) * smoothstep(0.3, 1.4, dist) * (0.55 + 0.45 * aPhase);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float a = smoothstep(1.0, 0.12, d);
        gl_FragColor = vec4(uColor, a * vAlpha);
      }
    `,
  });
  const snowPoints = new THREE.Points(snowGeo, snowMat);
  snowPoints.name = 'snow';
  snowPoints.frustumCulled = false;
  snowPoints.visible = false;
  snowPoints.renderOrder = 6;
  group.add(snowPoints);

  /* ================================================================ *
   * 3. 雨点溅落（点精灵）
   * ================================================================ */
  const splashGeo = new THREE.BufferGeometry();
  const splashPos = new Float32Array(SPLASH_MAX * 3);
  for (let i = 0; i < SPLASH_MAX; i++) {
    splashPos[i * 3] = rand();
    splashPos[i * 3 + 1] = rand(); // 相位
    splashPos[i * 3 + 2] = rand();
  }
  splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPos, 3));
  splashGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const splashUniforms = {
    uFocus: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uRain: { value: 0 },
    uBox: { value: new THREE.Vector2(40, 40) },
    uPointScale: { value: pointScale },
    uPool: { value: new THREE.Vector4(mainPool.cx, mainPool.cz, mainPool.rx, mainPool.rz) },
    uWaterY: { value: WATER_LEVEL },
    uColor: { value: new THREE.Color(0xd8ecf5) },
  };
  const splashMat = new THREE.ShaderMaterial({
    uniforms: splashUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      uniform vec3 uFocus;
      uniform float uTime;
      uniform float uRain;
      uniform vec2 uBox;
      uniform float uPointScale;
      uniform vec4 uPool;
      uniform float uWaterY;
      varying float vAlpha;

      void main() {
        float cycle = fract(uTime * (1.15 + position.z * 1.1) + position.y);
        vec2 rel = vec2(position.x - 0.5, position.z - 0.5) * uBox;
        vec3 world = uFocus + vec3(rel.x, 0.0, rel.y);
        vec2 pd = (world.xz - uPool.xy) / uPool.zw;
        float inPool = step(dot(pd, pd), 1.0);
        world.y = mix(0.03, uWaterY + 0.02, inPool);

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        float dist = length(world - cameraPosition);
        float sizeWorld = 0.06 + cycle * 0.26;
        gl_PointSize = clamp(uPointScale * sizeWorld / max(dist, 0.5), 1.0, 56.0);
        vAlpha = uRain * (1.0 - cycle) * (1.0 - cycle) *
                 smoothstep(26.0, 5.0, dist) * smoothstep(0.6, 2.0, dist);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float ring = smoothstep(1.0, 0.78, d) * smoothstep(0.22, 0.6, d);
        float a = ring * vAlpha * 0.75;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const splashPoints = new THREE.Points(splashGeo, splashMat);
  splashPoints.name = 'splash';
  splashPoints.frustumCulled = false;
  splashPoints.visible = false;
  splashPoints.renderOrder = 6;
  group.add(splashPoints);

  /* ================================================================ *
   * 4. 环境轻雾（实例化 billboard，泉池正上方淡化）
   * ================================================================ */
  const mistGeo = makeQuadGeometry();
  const mistSeeds = new Float32Array(MIST_MAX * 4);
  for (let i = 0; i < mistSeeds.length; i++) mistSeeds[i] = rand();
  mistGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(mistSeeds, 4));
  const mistPhase = new Float32Array(MIST_MAX);
  for (let i = 0; i < MIST_MAX; i++) mistPhase[i] = rand();
  mistGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(mistPhase, 1));
  mistGeo.instanceCount = MIST_MAX;
  mistGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mistTex = softGlowTexture({ size: 128, color: '#ffffff', falloff: 2.6 });
  mistTex.wrapS = mistTex.wrapT = THREE.ClampToEdgeWrapping;

  const mistUniforms = {
    uFocus: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uMist: { value: 0 },
    uPool: { value: new THREE.Vector4(mainPool.cx, mainPool.cz, mainPool.rx, mainPool.rz) },
    uColor: { value: new THREE.Color(0xdfe6e5) },
    uMap: { value: mistTex },
  };
  const mistMat = new THREE.ShaderMaterial({
    uniforms: mistUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform vec3 uFocus;
      uniform float uTime;
      uniform float uMist;
      uniform vec4 uPool;
      attribute vec4 aSeed;
      attribute float aPhase;
      varying float vAlpha;
      varying vec2 vUv;

      void main() {
        float ang = aSeed.x * 6.2831853 + uTime * 0.014 * (0.4 + aSeed.y);
        float radius = 12.0 + aSeed.y * 36.0;
        float bob = sin(uTime * (0.06 + aSeed.z * 0.05) + aPhase * 6.28) * 1.0;
        vec3 world = vec3(
          uFocus.x + cos(ang) * radius,
          0.55 + aSeed.z * 2.5 + bob,
          uFocus.z + sin(ang) * radius
        );
        float size = 7.0 + aSeed.w * 13.0;
        vec3 toCam = normalize(cameraPosition - world);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 up = cross(toCam, right);
        vec3 pos = world + right * position.x * size + up * position.y * size * 0.42;
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        vUv = uv;

        float dist = length(cameraPosition - world);
        vec2 pd = (world.xz - uPool.xy) / uPool.zw;
        float poolMask = mix(0.22, 1.0, smoothstep(1.0, 2.4, length(pd)));
        vAlpha = uMist * poolMask * 0.42 * smoothstep(62.0, 18.0, dist) *
                 smoothstep(2.0, 7.5, dist) * (0.4 + 0.6 * aSeed.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vAlpha;
      varying vec2 vUv;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        float a = tex.a * vAlpha;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * (0.92 + 0.16 * a), a);
      }
    `,
  });
  const mistMesh = new THREE.Mesh(mistGeo, mistMat);
  mistMesh.name = 'mist';
  mistMesh.frustumCulled = false;
  mistMesh.visible = false;
  mistMesh.renderOrder = 5;
  group.add(mistMesh);

  /* ================================================================ *
   * 5. 夜间萤火（点精灵）
   * ================================================================ */
  const fireflyGeo = new THREE.BufferGeometry();
  const fireflyPos = new Float32Array(FIREFLY_MAX * 3);
  const fireflyPhase = new Float32Array(FIREFLY_MAX);
  for (let i = 0; i < FIREFLY_MAX; i++) {
    fireflyPos[i * 3] = rand();
    fireflyPos[i * 3 + 1] = rand();
    fireflyPos[i * 3 + 2] = rand();
    fireflyPhase[i] = rand();
  }
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
  fireflyGeo.setAttribute('aPhase', new THREE.BufferAttribute(fireflyPhase, 1));
  fireflyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const fireflyUniforms = {
    uFocus: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uPointScale: { value: pointScale },
    uColor: { value: new THREE.Color(0xffd27a) },
  };
  const fireflyMat = new THREE.ShaderMaterial({
    uniforms: fireflyUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3 uFocus;
      uniform float uTime;
      uniform float uNight;
      uniform float uPointScale;
      attribute float aPhase;
      varying float vAlpha;

      void main() {
        vec3 box = vec3(34.0, 2.6, 34.0);
        vec3 center = uFocus + vec3(0.0, 0.9, 0.0);
        float x = mod(position.x * box.x + uTime * 0.24 + sin(uTime * 0.4 + aPhase * 6.0) * 1.1, box.x);
        float z = mod(position.z * box.z + uTime * 0.18 + cos(uTime * 0.33 + aPhase * 8.0) * 1.1, box.z);
        float y = 0.35 + position.y * 2.0 + sin(uTime * (0.4 + aPhase * 0.5) + aPhase * 9.0) * 0.5;
        vec3 world = center + vec3(x - box.x * 0.5, y, z - box.z * 0.5);

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        float dist = length(world - cameraPosition);
        gl_PointSize = clamp(uPointScale * (0.03 + 0.012 * aPhase) / max(dist, 0.3), 1.0, 8.0);
        float twinkle = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (0.9 + aPhase * 1.7) + aPhase * 20.0), 3.0);
        vAlpha = uNight * twinkle * smoothstep(32.0, 8.0, dist) * smoothstep(0.5, 1.6, dist);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.5, 0.0, d);
        float glow = smoothstep(1.0, 0.25, d) * 0.35;
        gl_FragColor = vec4(uColor * (0.8 + 0.6 * core), (core + glow) * vAlpha);
      }
    `,
  });
  const fireflyPoints = new THREE.Points(fireflyGeo, fireflyMat);
  fireflyPoints.name = 'fireflies';
  fireflyPoints.frustumCulled = false;
  fireflyPoints.visible = false;
  fireflyPoints.renderOrder = 6;
  group.add(fireflyPoints);

  /* ================================================================ *
   * 6. 大风落叶（点精灵，旋转的叶片形状在片元里画）
   * ================================================================ */
  const leafGeo = new THREE.BufferGeometry();
  const leafPos = new Float32Array(LEAF_MAX * 3);
  const leafPhase = new Float32Array(LEAF_MAX);
  for (let i = 0; i < LEAF_MAX; i++) {
    leafPos[i * 3] = rand();
    leafPos[i * 3 + 1] = rand();
    leafPos[i * 3 + 2] = rand();
    leafPhase[i] = rand();
  }
  leafGeo.setAttribute('position', new THREE.BufferAttribute(leafPos, 3));
  leafGeo.setAttribute('aPhase', new THREE.BufferAttribute(leafPhase, 1));
  leafGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const leafUniforms = {
    uFocus: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uLeaf: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uPointScale: { value: pointScale },
    uColorA: { value: new THREE.Color(0xc98a3e) },
    uColorB: { value: new THREE.Color(0x9aa84f) },
  };
  const leafMat = new THREE.ShaderMaterial({
    uniforms: leafUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      uniform vec3 uFocus;
      uniform float uTime;
      uniform float uLeaf;
      uniform vec2 uWind;
      uniform float uPointScale;
      attribute float aPhase;
      varying float vAlpha;
      varying float vRot;
      varying float vPhase;

      void main() {
        vec3 box = vec3(40.0, 18.0, 40.0);
        vec3 center = uFocus + vec3(0.0, 7.0, 0.0);
        float fall = 0.9 + position.y * 1.6;
        float y = mod(position.y * box.y - uTime * fall, box.y);
        float x = mod(position.x * box.x + uTime * uWind.x * 5.0 + sin(uTime * 1.25 + aPhase * 7.0) * 2.2, box.x);
        float z = mod(position.z * box.z + uTime * uWind.y * 5.0 + cos(uTime * 1.05 + aPhase * 5.0) * 2.2, box.z);
        vec3 world = center + vec3(x - box.x * 0.5, y - box.y * 0.5, z - box.z * 0.5);

        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        float dist = length(world - cameraPosition);
        gl_PointSize = clamp(uPointScale * 0.11 / max(dist, 0.4), 2.0, 14.0);
        vAlpha = uLeaf * smoothstep(38.0, 8.0, dist) * (0.55 + 0.45 * aPhase);
        vRot = uTime * (1.4 + aPhase * 2.6) + aPhase * 12.0;
        vPhase = aPhase;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying float vAlpha;
      varying float vRot;
      varying float vPhase;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float c = cos(vRot);
        float s = sin(vRot);
        vec2 p = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
        float e = length(vec2(p.x / 0.17, p.y / 0.48));
        float a = smoothstep(1.0, 0.55, e) * vAlpha;
        if (a < 0.01) discard;
        vec3 col = mix(uColorA, uColorB, vPhase);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const leafPoints = new THREE.Points(leafGeo, leafMat);
  leafPoints.name = 'leaves';
  leafPoints.frustumCulled = false;
  leafPoints.visible = false;
  leafPoints.renderOrder = 6;
  group.add(leafPoints);

  /* ================================================================ *
   * update / dispose
   * ================================================================ */
  function update(dt, e) {
    const time = e.time;
    const windMag = e.wind;
    _windXZ.set(WIND_DIR.x * windMag, WIND_DIR.y * windMag);

    const innerHeight = window.innerHeight || 900;
    if (innerHeight !== lastInnerHeight) {
      lastInnerHeight = innerHeight;
      pointScale = computePointScale(camera);
      snowUniforms.uPointScale.value = pointScale;
      splashUniforms.uPointScale.value = pointScale;
      fireflyUniforms.uPointScale.value = pointScale;
      leafUniforms.uPointScale.value = pointScale;
    }

    /* 雨 */
    const rain = e.rain;
    rainMesh.visible = rain > 0.02;
    if (rainMesh.visible) {
      rainUniforms.uTime.value = time;
      rainUniforms.uFocus.value.copy(e.focus);
      rainUniforms.uRain.value = rain;
      rainUniforms.uWind.value.copy(_windXZ);
      const frac = Math.min(1, 0.25 + 0.75 * rain);
      rainGeo.instanceCount = Math.max(1, Math.floor(RAIN_MAX * frac));
    }

    /* 溅落 */
    const splashOn = rain > 0.08;
    splashPoints.visible = splashOn;
    if (splashOn) {
      splashUniforms.uTime.value = time;
      splashUniforms.uFocus.value.copy(e.focus);
      splashUniforms.uRain.value = rain;
    }

    /* 雪 */
    const snowOn = e.snow > 0.02;
    snowPoints.visible = snowOn;
    if (snowOn) {
      snowUniforms.uTime.value = time;
      snowUniforms.uFocus.value.copy(e.focus);
      snowUniforms.uSnow.value = e.snow;
      snowUniforms.uWind.value.copy(_windXZ);
    }

    /* 环境轻雾：雾密度为主，雨/夜略增强 */
    const mistIntensity = Math.min(
      1,
      Math.max(0, (e.fogDensity - 0.0028) * 72) * 0.85 + e.rain * 0.1 + e.night * 0.06
    );
    mistMesh.visible = mistIntensity > 0.02;
    if (mistMesh.visible) {
      mistUniforms.uTime.value = time;
      mistUniforms.uFocus.value.copy(e.focus);
      mistUniforms.uMist.value = mistIntensity;
      _mistColor.copy(e.fogColor).lerp(_white, 0.16 * (1 - e.night * 0.7));
      mistUniforms.uColor.value.copy(_mistColor);
    }

    /* 萤火 */
    const fireflyOn = e.night > 0.15;
    fireflyPoints.visible = fireflyOn;
    if (fireflyOn) {
      fireflyUniforms.uTime.value = time;
      fireflyUniforms.uFocus.value.copy(e.focus);
      fireflyUniforms.uNight.value = Math.min(1, e.night);
    }

    /* 落叶：大风时 */
    const leafOn = e.wind > 0.5;
    leafPoints.visible = leafOn;
    if (leafOn) {
      const leaf = Math.min(1, (e.wind - 0.5) / 0.4);
      leafUniforms.uTime.value = time;
      leafUniforms.uFocus.value.copy(e.focus);
      leafUniforms.uLeaf.value = leaf;
      leafUniforms.uWind.value.copy(_windXZ);
    }
  }

  function dispose() {
    rainGeo.dispose();
    rainMat.dispose();
    snowGeo.dispose();
    snowMat.dispose();
    splashGeo.dispose();
    splashMat.dispose();
    mistGeo.dispose();
    mistMat.dispose();
    mistTex.dispose();
    fireflyGeo.dispose();
    fireflyMat.dispose();
    leafGeo.dispose();
    leafMat.dispose();
    group.removeFromParent();
  }

  // 首帧前用 env 初始化一次（粒子系统只读 env）
  update(0, env);

  return { object: group, update, dispose };
}

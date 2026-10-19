/**
 * 泉眼与水汽特效（A · 泉与地形 / water 子模块）
 * ------------------------------------------------------------------
 * 全部使用 instanced billboard 四边形（世界尺寸，不依赖 DPR / 视口）：
 *  - spray：趵突泉三股水的白色翻涌水花（沸腾上升的泡沫 + 抛物线碎沫）1 draw call
 *  - bubbles：主池 / 小泉池底涌上的气泡 1 draw call
 *  - steam：趵突泉水温常年 ~18℃，雪雾夜晨时泉池上方的“云雾润蒸” 1 draw call
 * 动画全部在顶点着色器里由 uTime 驱动，update 只写 uniform，不分配对象。
 */

import * as THREE from 'three';
import { SPRING_JETS, WATER_LEVEL, WATER_SHAPES } from '../../layout.js';
import { mulberry32 } from '../../utils/random.js';
import { softGlowTexture } from '../../utils/tex.js';

/* ------------------------------------------------------------------ *
 * billboard 基础设施
 */

function makeQuadGeometry(instanceCount, attributes) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  for (const key of Object.keys(attributes)) {
    geo.setAttribute(key, attributes[key]);
  }
  geo.instanceCount = instanceCount;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 400);
  base.dispose();
  return geo;
}

const PARTICLE_VERT_NORMAL = /* glsl */ `
  precision highp float;
  attribute vec3 aOrigin;
  attribute vec4 aSeed;
  attribute vec4 aParams;

  uniform float uTime;
  uniform float uWind;
  uniform float uIntensity;
  uniform float uSteam;

  varying vec2 vUv;
  varying float vAlpha;
  varying float vTint;

  mat2 rot2(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
  }

  void main() {
    vUv = uv;
    float t = fract(uTime * aParams.z + aSeed.x);
    float ang = aSeed.y * 6.2831853;

    vec3 pos;
    float size;
    float alpha;
    float tint = aSeed.w;

#if defined(PARTICLE_SPRAY)
    float rise = aParams.x * (0.35 + 0.65 * aSeed.w);
    float spread = aParams.y * (0.18 + 0.5 * aSeed.z);
    if (aParams.w < 0.5) {
      // 沸腾上涌的泡沫团：升到顶再落下
      float up = sin(3.14159 * pow(t, 0.65));
      pos = aOrigin;
      pos.x += cos(ang) * (0.2 + t * 0.9) * spread;
      pos.z += sin(ang) * (0.2 + t * 0.9) * spread;
      pos.y += up * rise * 0.72 + 0.06;
      size = (0.30 + aSeed.z * 0.55) * (0.85 + 0.65 * t);
      alpha = pow(sin(3.14159 * t), 0.55) * 1.0;
    } else {
      // 下落的碎沫（抛物线）
      float y = rise * (1.0 - pow(2.0 * t - 1.0, 2.0));
      pos = aOrigin;
      pos.x += cos(ang) * spread * (0.3 + t * 1.5);
      pos.z += sin(ang) * spread * (0.3 + t * 1.5);
      pos.y += y * 0.9 + 0.05;
      size = (0.055 + aSeed.z * 0.11) * (1.0 - 0.30 * t);
      alpha = (1.0 - t) * 0.9;
    }
    tint = aSeed.w * 0.35 + 0.55;
#elif defined(PARTICLE_BUBBLE)
    pos = aOrigin;
    pos.y += t * aParams.x;
    float wob = t * 6.2831853 * (0.5 + aSeed.z);
    pos.x += sin(wob + ang) * aParams.y;
    pos.z += cos(wob * 0.8 + ang * 1.7) * aParams.y;
    size = aParams.z * (0.6 + aSeed.w * 0.6);
    alpha = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.8, 1.0, t)) * 0.55;
    tint = 0.9;
#elif defined(PARTICLE_STEAM)
    float life = pow(t, 0.85);
    pos = aOrigin;
    pos.y += life * aParams.x;
    pos.x += cos(ang) * aParams.y * (0.4 + life * 2.2) + uWind * life * life * 5.0;
    pos.z += sin(ang) * aParams.y * (0.4 + life * 2.2);
    size = aParams.z * (0.55 + life * 2.1);
    alpha = smoothstep(0.0, 0.16, t) * pow(1.0 - t, 1.35) * 0.28 * uSteam;
    tint = 0.5 + 0.5 * aSeed.w;
    // 缓慢旋转 UV，弱化 billboard 感
    vUv = rot2(ang + uTime * 0.12 * (0.5 + aSeed.w)) * (uv - 0.5) + 0.5;
#else
    pos = aOrigin;
    size = 0.1;
    alpha = 0.0;
#endif

    // 相机朝向的 billboard
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = pos + (camRight * position.x + camUp * position.y) * size;

    vAlpha = alpha * uIntensity;
    vTint = tint;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTint;

  void main() {
    float a = texture2D(uMap, clamp(vUv, 0.001, 0.999)).a * vAlpha * uOpacity;
    if (a < 0.004) discard;
    vec3 col = uColor * (0.72 + 0.28 * vTint);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makeParticleMaterial(define) {
  return new THREE.ShaderMaterial({
    defines: define ? { [define]: 1 } : {},
    uniforms: {
      uTime: { value: 0 },
      uWind: { value: 0.2 },
      uIntensity: { value: 1 },
      uSteam: { value: 0 },
      uMap: { value: null },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 1 },
    },
    vertexShader: PARTICLE_VERT_NORMAL,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: true,
    fog: false,
  });
}

/* ------------------------------------------------------------------ *
 * 主入口
 */

export function createSpringEffects({ env, quality = 1 }) {
  const group = new THREE.Group();
  group.name = 'spring-effects';
  const hi = quality >= 0.9;

  const map = softGlowTexture({ size: 128, color: '#ffffff', falloff: 2.4 });
  const rand = mulberry32(778899);

  const mainJets = SPRING_JETS.main.jets;
const SPRING_POOLS = WATER_SHAPES.filter((s) => s.kind === 'ellipse');

  /* ---------- 1. 三股水的水花 ---------- */
  const jetList = [];
  for (const key of Object.keys(SPRING_JETS)) {
    for (const j of SPRING_JETS[key].jets) {
      jetList.push({ ...j, spring: key });
    }
  }
  const boilPerJet = hi ? 180 : 100;
  const dropPerJet = hi ? 90 : 52;
  const sprayCount = mainJets.length * (boilPerJet + dropPerJet) + (hi ? 5 * 26 : 5 * 16);
  const sOrigin = new Float32Array(sprayCount * 3);
  const sSeed = new Float32Array(sprayCount * 4);
  const sParams = new Float32Array(sprayCount * 4);
  let si = 0;
  const pushSpray = (x, z, height, radius, speed, size, kind) => {
    sOrigin[si * 3] = x;
    sOrigin[si * 3 + 1] = WATER_LEVEL;
    sOrigin[si * 3 + 2] = z;
    sSeed[si * 4] = rand();
    sSeed[si * 4 + 1] = rand();
    sSeed[si * 4 + 2] = rand();
    sSeed[si * 4 + 3] = rand();
    sParams[si * 4] = height;
    sParams[si * 4 + 1] = radius;
    sParams[si * 4 + 2] = speed;
    sParams[si * 4 + 3] = kind;
    si++;
  };
  // 主泉三股：泡沫团 + 下落碎沫
  for (const j of mainJets) {
    for (let k = 0; k < boilPerJet; k++) pushSpray(j.x, j.z, j.height, j.radius * 0.9, 1.1 + rand() * 0.7, 1, 0);
    for (let k = 0; k < dropPerJet; k++) pushSpray(j.x, j.z, j.height, j.radius * 1.05, 1.3 + rand() * 0.9, 1, 1);
  }
  // 小泉的细碎水花
  const smallSprings = [];
  for (const key of Object.keys(SPRING_JETS)) {
    if (key === 'main') continue;
    for (const j of SPRING_JETS[key].jets) smallSprings.push(j);
  }
  for (const j of smallSprings) {
    const n = hi ? 26 : 16;
    for (let k = 0; k < n; k++) pushSpray(j.x, j.z, j.height, j.radius * 0.8, 0.7 + rand() * 0.5, 1, 0);
  }
  const sprayGeo = makeQuadGeometry(sprayCount, {
    aOrigin: new THREE.InstancedBufferAttribute(sOrigin, 3),
    aSeed: new THREE.InstancedBufferAttribute(sSeed, 4),
    aParams: new THREE.InstancedBufferAttribute(sParams, 4),
  });
  const sprayMat = makeParticleMaterial('PARTICLE_SPRAY');
  sprayMat.uniforms.uMap.value = map;
  const spray = new THREE.Mesh(sprayGeo, sprayMat);
  spray.renderOrder = 6;
  spray.frustumCulled = false;
  group.add(spray);

  /* ---------- 1.5 三股水的"水丘"（实心翻涌体） ---------- */
  const moundGroup = new THREE.Group();
  moundGroup.name = 'spring-mounds';
  const moundMats = [];
  const moundGeos = [];
  for (const j of mainJets) {
    const domeGeo = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0xcfeae4,
      roughness: 0.16,
      metalness: 0.02,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      emissive: 0x86c3ba,
      emissiveIntensity: 0.05,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(j.x, WATER_LEVEL + 0.02, j.z);
    dome.scale.set(j.radius * 1.15, j.height * 0.52, j.radius * 1.15);
    dome.renderOrder = 5;
    moundGroup.add(dome);
    moundMats.push(domeMat);
    moundGeos.push(domeGeo);

    // 泡沫环（水丘根部）
    const ringGeo = new THREE.RingGeometry(j.radius * 1.35, j.radius * 2.35, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(j.x, WATER_LEVEL + 0.035, j.z);
    ring.renderOrder = 4;
    moundGroup.add(ring);
    moundMats.push(ringMat);
    moundGeos.push(ringGeo);
  }
  group.add(moundGroup);

  /* ---------- 2. 池底气泡 ---------- */
  const bubbleSpecs = [];
  for (const s of SPRING_POOLS) {
    const isMain = s.id === 'main-spring';
    const n = isMain ? (hi ? 130 : 80) : (hi ? 26 : 16);
    for (let k = 0; k < n; k++) {
      // 靠近泉眼更密
      let x;
      let z;
      if (isMain && rand() < 0.65) {
        const j = mainJets[Math.floor(rand() * mainJets.length)];
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 2.6;
        x = j.x + Math.cos(a) * r;
        z = j.z + Math.sin(a) * r;
      } else {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 0.85;
        x = s.cx + Math.cos(a) * s.rx * r;
        z = s.cz + Math.sin(a) * s.rz * r;
      }
      const dx = (x - s.cx) / s.rx;
      const dz = (z - s.cz) / s.rz;
      const rr = Math.hypot(dx, dz);
      const floorY = WATER_LEVEL - s.depth + 0.28 * rr * rr;
      const rise = WATER_LEVEL - floorY - 0.25;
      bubbleSpecs.push({ x, z, floorY, rise, speed: 0.14 + rand() * 0.18, size: 0.035 + rand() * 0.07, swirl: 0.1 + rand() * 0.22 });
    }
  }
  const bubbles = new Float32Array(bubbleSpecs.length * 3);
  const bSeed = new Float32Array(bubbleSpecs.length * 4);
  const bParams = new Float32Array(bubbleSpecs.length * 4);
  bubbleSpecs.forEach((b, i) => {
    bubbles[i * 3] = b.x;
    bubbles[i * 3 + 1] = b.floorY + 0.05;
    bubbles[i * 3 + 2] = b.z;
    bSeed[i * 4] = rand();
    bSeed[i * 4 + 1] = rand();
    bSeed[i * 4 + 2] = 0.4 + rand() * 0.9;
    bSeed[i * 4 + 3] = rand();
    bParams[i * 4] = b.rise;
    bParams[i * 4 + 1] = b.swirl;
    bParams[i * 4 + 2] = b.size;
    bParams[i * 4 + 3] = 1;
  });
  const bubbleGeo = makeQuadGeometry(bubbleSpecs.length, {
    aOrigin: new THREE.InstancedBufferAttribute(bubbles, 3),
    aSeed: new THREE.InstancedBufferAttribute(bSeed, 4),
    aParams: new THREE.InstancedBufferAttribute(bParams, 4),
  });
  const bubbleMat = makeParticleMaterial('PARTICLE_BUBBLE');
  bubbleMat.uniforms.uMap.value = map;
  bubbleMat.uniforms.uColor.value.setRGB(0.72, 0.86, 0.9);
  bubbleMat.uniforms.uOpacity.value = 0.9;
  bubbleMat.blending = THREE.AdditiveBlending;
  const bubbleMesh = new THREE.Mesh(bubbleGeo, bubbleMat);
  bubbleMesh.renderOrder = 1;
  bubbleMesh.frustumCulled = false;
  group.add(bubbleMesh);

  /* ---------- 3. 水汽（云雾润蒸） ---------- */
  const steamSpecs = [];
  // 主池：三股水上方为主
  for (const j of mainJets) {
    for (let k = 0; k < (hi ? 16 : 10); k++) {
      steamSpecs.push({
        x: j.x + (rand() - 0.5) * 4.5,
        z: j.z + (rand() - 0.5) * 4.5,
        rise: 1.6 + rand() * 2.6,
        radius: 0.5 + rand() * 1.2,
        speed: 0.028 + rand() * 0.03,
        size: 1.5 + rand() * 2.6,
      });
    }
  }
  // 主池水面其它位置少量
  for (let k = 0; k < (hi ? 18 : 10); k++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.85;
    steamSpecs.push({
      x: Math.cos(a) * 18 * r,
      z: Math.sin(a) * 13 * r,
      rise: 1.2 + rand() * 2.4,
      radius: 0.6 + rand() * 1.4,
      speed: 0.024 + rand() * 0.026,
      size: 1.6 + rand() * 2.8,
    });
  }
  // 小泉池上方
  for (const j of smallSprings) {
    for (let k = 0; k < (hi ? 8 : 5); k++) {
      steamSpecs.push({
        x: j.x + (rand() - 0.5) * 3.2,
        z: j.z + (rand() - 0.5) * 3.2,
        rise: 1.0 + rand() * 1.8,
        radius: 0.4 + rand() * 0.8,
        speed: 0.03 + rand() * 0.03,
        size: 0.9 + rand() * 1.8,
      });
    }
  }
  const stOrigin = new Float32Array(steamSpecs.length * 3);
  const stSeed = new Float32Array(steamSpecs.length * 4);
  const stParams = new Float32Array(steamSpecs.length * 4);
  steamSpecs.forEach((s, i) => {
    stOrigin[i * 3] = s.x;
    stOrigin[i * 3 + 1] = WATER_LEVEL + 0.2;
    stOrigin[i * 3 + 2] = s.z;
    stSeed[i * 4] = rand();
    stSeed[i * 4 + 1] = rand();
    stSeed[i * 4 + 2] = rand();
    stSeed[i * 4 + 3] = rand();
    stParams[i * 4] = s.rise;
    stParams[i * 4 + 1] = s.radius;
    stParams[i * 4 + 2] = s.speed;
    stParams[i * 4 + 3] = s.size;
  });
  const steamGeo = makeQuadGeometry(steamSpecs.length, {
    aOrigin: new THREE.InstancedBufferAttribute(stOrigin, 3),
    aSeed: new THREE.InstancedBufferAttribute(stSeed, 4),
    aParams: new THREE.InstancedBufferAttribute(stParams, 4),
  });
  const steamMat = makeParticleMaterial('PARTICLE_STEAM');
  steamMat.uniforms.uMap.value = map;
  steamMat.uniforms.uColor.value.setRGB(0.92, 0.95, 0.97);
  steamMat.uniforms.uOpacity.value = 1.0;
  const steamMesh = new THREE.Mesh(steamGeo, steamMat);
  steamMesh.renderOrder = 7;
  steamMesh.frustumCulled = false;
  group.add(steamMesh);

  /* ---------- 颜色 / 天气更新 ---------- */
  const _c = new THREE.Color();
  const _c2 = new THREE.Color();
  const WHITE = new THREE.Color(0.96, 0.98, 1.0);
  const NIGHT_TINT = new THREE.Color(0.8, 0.86, 1.0);

  function update(dt, e) {
    const uTime = e.time;
    // 水丘呼吸翻涌
    for (let i = 0; i < moundGroup.children.length; i += 2) {
      const dome = moundGroup.children[i];
      const j = mainJets[i / 2];
      if (!dome || !j) continue;
      const pulse = 0.86 + 0.14 * Math.sin(uTime * 2.1 + j.phase) + 0.06 * Math.sin(uTime * 3.7 + j.phase * 2.0);
      dome.scale.set(j.radius * 1.15 * (0.92 + 0.08 * pulse), j.height * 0.52 * pulse, j.radius * 1.15 * (0.92 + 0.08 * pulse));
      const ring = moundGroup.children[i + 1];
      if (ring) ring.material.opacity = 0.34 + 0.2 * pulse;
    }
    const moundLight = 0.5 + 0.5 * Math.max(e.dayFactor, 0.25);
    for (const m of moundMats) {
      if (m.emissive) m.emissiveIntensity = 0.10 * moundLight + e.night * 0.16;
    }
    sprayMat.uniforms.uTime.value = uTime;
    sprayMat.uniforms.uWind.value = e.wind;
    sprayMat.uniforms.uIntensity.value = 1.0;
    // 水花受光：环境色 + 一点太阳
    _c.copy(e.ambientColor).multiplyScalar(0.45 + e.ambientIntensity * 0.5);
    _c.lerp(WHITE, 0.55);
    _c.multiplyScalar(0.9 + e.sunIntensity * 0.16 + e.moonIntensity * 0.1);
    sprayMat.uniforms.uColor.value.copy(_c);

    bubbleMat.uniforms.uTime.value = uTime;
    bubbleMat.uniforms.uIntensity.value = 0.9;
    bubbleMat.uniforms.uColor.value.copy(e.ambientColor).lerp(WHITE, 0.45).multiplyScalar(0.9);

    steamMat.uniforms.uTime.value = uTime;
    steamMat.uniforms.uWind.value = e.wind;
    steamMat.uniforms.uSteam.value = e.steam;
    steamMat.uniforms.uIntensity.value = e.steam > 0.015 ? 1.0 : 0.0;
    steamMesh.visible = e.steam > 0.015;
    // 水汽颜色：天光/环境 + 太阳暖色，夜间偏冷
    _c.copy(e.ambientColor).lerp(WHITE, 0.62);
    _c.lerp(e.sunColor, 0.18 * e.dayFactor);
    _c.multiplyScalar(0.92 + e.dayFactor * 0.18);
    _c2.copy(_c).multiply(NIGHT_TINT);
    _c.lerp(_c2, e.night * 0.55);
    steamMat.uniforms.uColor.value.copy(_c);
  }

  function dispose() {
    for (const g of moundGeos) g.dispose();
    for (const m of moundMats) m.dispose();
    map.dispose();
    sprayGeo.dispose();
    bubbleGeo.dispose();
    steamGeo.dispose();
    sprayMat.dispose();
    bubbleMat.dispose();
    steamMat.dispose();
    group.removeFromParent();
  }

  return { object: group, update, dispose };
}

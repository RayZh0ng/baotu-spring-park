import * as THREE from 'three';

/**
 * 全局环境状态 env：天气系统每帧写入，其它模块只读。
 * 详见 docs/CONTRACT.md §3。
 */
export function createEnv() {
  return {
    time: 0,
    dt: 0,

    /* 光照 */
    sunDir: new THREE.Vector3(0.38, 0.72, 0.34).normalize(),
    sunColor: new THREE.Color(0xfff2d6),
    sunIntensity: 2.9,
    moonIntensity: 0,
    ambientColor: new THREE.Color(0xd7e6f0),
    ambientIntensity: 0.52,
    hemiSky: new THREE.Color(0xa9c8e8),
    hemiGround: new THREE.Color(0x7c835c),
    hemiIntensity: 0.82,

    /* 天空 */
    skyTop: new THREE.Color(0x2c6cad),
    skyHorizon: new THREE.Color(0xdcecf5),
    skyBottom: new THREE.Color(0xb3c5cc),
    cloudCover: 0.12,
    cloudSpd: 0.32,
    cloudTint: new THREE.Color(0xffffff),
    starOpacity: 0,

    /* 大气 */
    fogColor: new THREE.Color(0xcadce9),
    fogDensity: 0.0026,
    exposure: 1.0,

    /* 天气强度 */
    rain: 0,
    snow: 0,
    wind: 0.22,
    wetness: 0,
    puddle: 0,
    lightning: 0,
    steam: 0.22,
    temperature: 0.55,

    /* 阶段 */
    night: 0,
    golden: 0,
    dayFactor: 1,

    /* 运行时 */
    focus: new THREE.Vector3(0, 1, 0),
    quality: 1,
  };
}

/** 数值/颜色/数组混合插值（天气过渡用） */
export function lerpEnvValue(current, target, t) {
  if (typeof current === 'number' && typeof target === 'number') {
    return current + (target - current) * t;
  }
  if (current && current.isColor && typeof target === 'number') {
    current.lerp(_tmpColor.setHex(target), t);
    return current;
  }
  if (Array.isArray(current) && Array.isArray(target)) {
    // 只支持长度为 3 的数组（如 sunDir）
    current[0] += (target[0] - current[0]) * t;
    current[1] += (target[1] - current[1]) * t;
    current[2] += (target[2] - current[2]) * t;
    return current;
  }
  return current;
}

const _tmpColor = new THREE.Color();

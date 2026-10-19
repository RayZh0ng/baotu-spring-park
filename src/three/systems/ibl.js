import * as THREE from 'three';

/**
 * 基于天空穹顶的 IBL 环境光照
 * ------------------------------------------------------------
 * 把 sky.js 的天空穹顶单独渲染到 cube RT，再用 PMREM 卷积成 irradiance/prefilter，
 * 作为 scene.environment 供所有 MeshStandardMaterial 使用。
 *
 * 效果：
 *  - 建筑石材/琉璃瓦/水面有真实的环境反射与高光层次（而不是只靠平行光）
 *  - 阴天/黄昏/夜晚的环境色会正确地"染"到材质上
 *  - 与 fog/天气完全同步：只在天空色变化明显时重算（节流），不每帧重烘
 *
 * 实现：独立 scene + 只含穹顶的渲染，避免把整个公园烘进环境贴图。
 */

const CUBE_SIZE = 128;

export function createSkyIBL({ renderer, skyObject, env }) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const cubeRT = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(0.5, 1000, cubeRT);

  // 独立小场景：只放一份穹顶克隆（穹顶材质由 sky.js 每帧更新 uniforms，克隆共享同一材质）
  const iblScene = new THREE.Scene();
  let dome = null;
  if (skyObject) {
    dome = skyObject.clone(true);
    dome.position.set(0, 0, 0);
    iblScene.add(dome);
  }

  let envRT = null;
  let dirty = true;
  let lastKey = '';
  let lastBake = -1;
  let bakeCooldown = 0;

  const _sky = new THREE.Color();
  const _fog = new THREE.Color();

  /** 天空状态是否发生了值得重烘的变化 */
  function needsBake(e, force) {
    if (force) return true;
    // 用几个关键量做签名：天空三色 + 太阳方向/强度 + 云量 + 夜色
    _sky.copy(e.skyTop);
    _fog.copy(e.skyHorizon);
    const key = [
      _sky.getHexString(),
      _fog.getHexString(),
      e.sunDir.x.toFixed(3),
      e.sunDir.y.toFixed(3),
      e.sunDir.z.toFixed(3),
      e.sunIntensity.toFixed(2),
      e.cloudCover.toFixed(2),
      e.night.toFixed(2),
      e.golden.toFixed(2),
      e.lightning.toFixed(1),
    ].join('|');
    if (key !== lastKey) {
      lastKey = key;
      return true;
    }
    return false;
  }

  function bake(e) {
    if (!dome) return;
    // 让穹顶居中于 cube 相机
    dome.position.set(0, 0, 0);
    cubeCamera.update(renderer, iblScene);
    if (envRT) envRT.dispose();
    envRT = pmrem.fromCubemap(cubeRT.texture);
    dirty = false;
    lastBake = e.time;
  }

  /**
   * @param {number} dt
   * @param {object} e env
   * @param {number} interval 最小重烘间隔（秒），默认 1.2s
   */
  let enabled = true;

  function update(dt, e, interval = 1.2) {
    if (!dome) return;
    bakeCooldown -= dt;
    const changed = needsBake(e, dirty);
    if (!changed) return;
    if (bakeCooldown > 0) return;
    if (e.time - lastBake < interval && lastBake >= 0) return;
    bake(e);
    bakeCooldown = 0.35;
  }

  function forceBake(e) {
    bake(e);
  }

  function dispose() {
    if (envRT) envRT.dispose();
    cubeRT.dispose();
    pmrem.dispose();
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = Boolean(v);
    },
    get environment() {
      return envRT ? envRT.texture : null;
    },
    update,
    forceBake,
    dispose,
    get texture() {
      return envRT ? envRT.texture : null;
    },
  };
}

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/**
 * 渲染引擎：renderer / scene / camera / resize / 自适应 DPR / 后处理。
 *
 * 后处理链（质量可分级）：
 *   RenderPass → GTAOPass（环境光遮蔽：檐下、石阶、树根、亭柱的接触阴影）
 *              → UnrealBloomPass（高光溢出：阳光、水面波光、灯笼、匾额金漆）
 *              → OutputPass（ACES 色调映射 + sRGB，只做一次）
 *
 * 注意：启用 composer 后场景渲染到 HalfFloat RT，tone mapping 由 OutputPass 完成；
 * renderer.toneMapping 只影响直出路径（反射 RT 采样时不应二次 tonemap）。
 */

export function createEngine({ canvas, mobile, quality = 1 }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: true,
  });

  const maxDpr = mobile ? 1.5 : 2.0;
  let currentDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  let userQuality = quality;
  let postEnabled = quality >= 0.8 && !mobile;

  renderer.setPixelRatio(currentDpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.info.autoReset = false; // 由 experience 每帧手动 reset，累计全部 pass

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 800);
  camera.rotation.order = 'YXZ';

  /* ------------------------------------------------------------------ *
   * 后处理
   * ------------------------------------------------------------------ */
  // 关键：EffectComposer 默认 RT 不带 MSAA，导致几何边缘有明显锯齿。
  // 给主 RT 开 4x MSAA（WebGL2），再在 OutputPass 之后叠加 SMAA 处理着色器边缘。
  const msaaSamples = mobile ? 0 : 4;
  const composerRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: msaaSamples,
    stencilBuffer: false,
  });
  const composer = new EffectComposer(renderer, composerRT);
  composer.setPixelRatio(currentDpr);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 环境光遮蔽（SSAO）：给檐下、石阶、树根、亭柱补上接触阴影
  // 注：不用 GTAOPass —— 它基于 GBuffer 法线，会与透明水面产生放射状楔形伪影。
  let aoPass = null;
  const ENABLE_AO = !mobile;
  if (ENABLE_AO) try {
    aoPass = new SSAOPass(scene, camera, 1, 1);
    aoPass.kernelRadius = 0.55;
    aoPass.minDistance = 0.0012;
    aoPass.maxDistance = 0.075;
    aoPass.output = SSAOPass.OUTPUT.Default;
    composer.addPass(aoPass);
  } catch (err) {
    console.warn('[engine] SSAO 不可用，跳过', err);
    aoPass = null;
  }

  // 高光溢出：阳光、水面波光、灯笼、匾额金漆的柔和辉光
  let bloomPass = null;
  try {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.30, 0.70, 0.86);
    composer.addPass(bloomPass);
  } catch (err) {
    console.warn('[engine] Bloom 不可用，跳过', err);
    bloomPass = null;
  }

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // SMAA：在 tone mapping + sRGB 之后做边缘检测与混合，进一步消除几何/植被边缘锯齿
  let smaaPass = null;
  if (!mobile) {
    try {
      smaaPass = new SMAAPass();
      composer.addPass(smaaPass);
    } catch (err) {
      console.warn('[engine] SMAA 不可用，跳过', err);
      smaaPass = null;
    }
  }

  const size = { width: 1, height: 1 };
  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    size.width = width;
    size.height = height;
    renderer.setPixelRatio(currentDpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(currentDpr);
    composer.setSize(width, height);
    if (smaaPass) smaaPass.setSize(width * currentDpr, height * currentDpr);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  /** 自适应分辨率：帧率低时降 DPR */
  let frameSamples = 0;
  let frameTimeSum = 0;
  let cooldown = 0;
  function adapt(dt, fps) {
    if (dt <= 0) return;
    frameSamples++;
    frameTimeSum += dt;
    if (cooldown > 0) {
      cooldown -= dt;
      return;
    }
    if (frameSamples >= 90) {
      const avg = frameTimeSum / frameSamples;
      const target = 1 / 50; // 目标 50fps
      let next = currentDpr;
      if (avg > target * 1.45 && currentDpr > 0.8) next = Math.max(0.8, currentDpr - 0.12);
      else if (avg < target * 0.72 && currentDpr < maxDpr) next = Math.min(maxDpr, currentDpr + 0.1);
      if (Math.abs(next - currentDpr) > 0.04) {
        currentDpr = next;
        renderer.setPixelRatio(currentDpr);
        renderer.setSize(size.width, size.height, false);
        composer.setPixelRatio(currentDpr);
        composer.setSize(size.width, size.height);
        cooldown = 2.2;
      }
      frameSamples = 0;
      frameTimeSum = 0;
    }
  }

  function setQuality(q) {
    userQuality = q;
    const target = q >= 0.99 ? maxDpr : Math.max(0.72, maxDpr * q);
    currentDpr = Math.min(target, maxDpr);
    renderer.setPixelRatio(currentDpr);
    renderer.setSize(size.width, size.height, false);
    composer.setPixelRatio(currentDpr);
    composer.setSize(size.width, size.height);
    setPostEnabled(q >= 0.8 && !mobile);
  }

  function setPostEnabled(on) {
    postEnabled = Boolean(on);
    if (aoPass) aoPass.enabled = postEnabled;
    if (bloomPass) bloomPass.enabled = postEnabled;
    if (smaaPass) smaaPass.enabled = postEnabled;
  }

  /** 反射等需要"直出"的渲染路径（绕过后处理与 tonemap） */
  function renderDirect(targetScene, targetCamera) {
    renderer.render(targetScene || scene, targetCamera || camera);
  }

  function beginFrame() {
    renderer.info.reset();
  }

  function render() {
    if (postEnabled) composer.render();
    else renderer.render(scene, camera);
  }

  /** 按天气/时间调整 bloom 参数（每帧调用，开销极小） */
  function updatePost(env) {
    if (!bloomPass) return;
    const nightBoost = 1 + env.night * 0.9;
    const goldenBoost = 1 + env.golden * 0.35;
    const rainCut = 1 - env.rain * 0.4;
    const fogCut = 1 - Math.min(0.5, env.fogDensity * 18);
    bloomPass.strength = 0.34 * nightBoost * goldenBoost * rainCut * fogCut;
    bloomPass.threshold = 0.82 - env.night * 0.24 - env.golden * 0.05;
    bloomPass.radius = 0.70;
  }

  function dispose() {
    window.removeEventListener('resize', resize);
    composer.dispose();
    renderer.dispose();
  }

  return {
    renderer,
    scene,
    camera,
    composer,
    resize,
    render,
    beginFrame,
    renderDirect,
    adapt,
    setQuality,
    setPostEnabled,
    updatePost,
    dispose,
    get postEnabled() {
      return postEnabled;
    },
    get aoPass() {
      return aoPass;
    },
    get bloomPass() {
      return bloomPass;
    },
    get dpr() {
      return currentDpr;
    },
    get quality() {
      return userQuality;
    },
    get size() {
      return size;
    },
    info: renderer.info,
  };
}

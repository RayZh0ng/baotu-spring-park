import * as THREE from 'three';

/**
 * 水面镜面反射（planar reflection）
 * ------------------------------------------------------------
 * 用一台镜像虚拟相机把场景渲染到半分辨率 RT，水面 shader 按屏幕坐标采样，
 * 得到真实倒影（亭台、树木、天空、灯笼都会映在水里）。
 *
 * 实现要点（参考 three/examples/jsm/objects/Reflector，但改成"一个模块服务多个水面"）：
 *  - 只有一个反射平面（y = WATER_LEVEL），全园水面共用一个 RT
 *  - 反射相机使用斜裁剪平面（oblique clip），只渲染水面以上部分，避免水下物体穿帮
 *  - 半分辨率 + 每帧一次（可配置跳帧），开销可控
 *  - 反射层用 `layers` 排除水面自身、粒子与 UI 辅助物体，防止递归与鬼影
 */

const REFLECT_LAYER = 2; // 只在反射相机里渲染的层（本模块不使用，保留语义）
const NO_REFLECT_LAYER = 3; // 水面自身、雨雪粒子等不参与反射

export function createPlanarReflection({ renderer, scene, waterLevel, quality = 1, mobile = false }) {
  const scale = mobile ? 0.26 : quality >= 0.9 ? 0.40 : 0.32;
  const maxW = mobile ? 384 : 768;

  let width = 2;
  let height = 2;
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
  });
  renderTarget.texture.name = 'water-reflection';

  const textureMatrix = new THREE.Matrix4();
  const virtualCamera = new THREE.PerspectiveCamera();

  const reflectorPlane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const reflectorWorldPosition = new THREE.Vector3();
  const cameraWorldPosition = new THREE.Vector3();
  const rotationMatrix = new THREE.Matrix4();
  const lookAtPosition = new THREE.Vector3(0, 0, -1);
  const clipPlane = new THREE.Vector4();
  const view = new THREE.Vector3();
  const target = new THREE.Vector3();
  const q = new THREE.Vector4();
  const projectionMatrix = new THREE.Matrix4();
  const _clipBias = 0.006;

  let enabled = true;
  let skipFrames = 1; // 每 2 帧更新一次反射
  let frameCounter = 0;

  function setSize(w, h) {
    width = Math.max(2, Math.floor(Math.min(maxW, w * scale)));
    height = Math.max(2, Math.floor(Math.min(maxW, h * scale)));
    renderTarget.setSize(width, height);
  }

  setSize(window.innerWidth, window.innerHeight);

  /**
   * 渲染反射。必须在主渲染之前调用。
   * @param {THREE.Camera} camera 主相机
   */
  function update(camera) {
    if (!enabled) return;
    frameCounter++;
    if (skipFrames > 0 && frameCounter % (skipFrames + 1) !== 0) return;

    reflectorWorldPosition.set(0, waterLevel, 0);
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

    // 水面法线（向上）
    rotationMatrix.extractRotation(new THREE.Matrix4().identity());
    normal.set(0, 1, 0);
    view.subVectors(reflectorWorldPosition, cameraWorldPosition);

    // 相机在水面下方（不该发生，但保险）
    if (view.dot(normal) > 0) return;

    view.reflect(normal).negate();
    view.add(reflectorWorldPosition);

    rotationMatrix.extractRotation(camera.matrixWorld);
    lookAtPosition.set(0, 0, -1);
    lookAtPosition.applyMatrix4(rotationMatrix);
    lookAtPosition.add(cameraWorldPosition);

    target.subVectors(reflectorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(reflectorWorldPosition);

    virtualCamera.position.copy(view);
    virtualCamera.up.set(0, 1, 0);
    virtualCamera.up.applyMatrix4(rotationMatrix);
    virtualCamera.up.reflect(normal);
    virtualCamera.lookAt(target);
    virtualCamera.far = camera.far;
    virtualCamera.near = camera.near;
    virtualCamera.fov = camera.fov;
    virtualCamera.aspect = camera.aspect;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

    // 反射纹理矩阵（世界坐标 → 反射相机屏幕 UV）
    textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    textureMatrix.multiply(virtualCamera.projectionMatrix);
    textureMatrix.multiply(virtualCamera.matrixWorldInverse);

    // 斜裁剪：只渲染水面以上，防止水下几何在倒影里穿帮
    reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
    reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);
    clipPlane.set(
      reflectorPlane.normal.x,
      reflectorPlane.normal.y,
      reflectorPlane.normal.z,
      reflectorPlane.constant
    );

    projectionMatrix.copy(virtualCamera.projectionMatrix);
    q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
    q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
    q.z = -1.0;
    q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    projectionMatrix.elements[2] = clipPlane.x;
    projectionMatrix.elements[6] = clipPlane.y;
    projectionMatrix.elements[10] = clipPlane.z + 1.0 - _clipBias;
    projectionMatrix.elements[14] = clipPlane.w;

    // 渲染反射
    virtualCamera.projectionMatrix.copy(projectionMatrix);

    const prevRenderTarget = renderer.getRenderTarget();
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevXr = renderer.xr.enabled;

    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false; // 复用主渲染阴影，省一半 shadow pass
    renderer.setRenderTarget(renderTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();

    // 反射相机只渲染默认层：水面/粒子/泉眼/锦鲤已标记到 NO_REFLECT_LAYER
    virtualCamera.layers.set(0);
    renderer.render(scene, virtualCamera);

    renderer.setRenderTarget(prevRenderTarget);
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
  }

  function dispose() {
    renderTarget.dispose();
  }

  return {
    renderTarget,
    textureMatrix,
    update,
    setSize,
    dispose,
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = Boolean(v);
    },
    /** 每 N 帧更新一次反射（0 = 每帧） */
    setSkipFrames(n) {
      skipFrames = Math.max(0, n | 0);
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
  };
}

/** 需要排除在反射之外的层（水面自身、雨雪粒子、泉眼泡沫等） */
export const WATER_LAYERS = {
  NO_REFLECT: NO_REFLECT_LAYER,
  REFLECT_ONLY: REFLECT_LAYER,
};

/** 把物体标记为"不参与反射" */
export function markNoReflect(object) {
  object.traverse((o) => {
    o.layers.enable(NO_REFLECT_LAYER);
  });
}

import * as THREE from 'three';
import { BOUNDS, WATER_LEVEL } from '../layout.js';
import { mulberry32, fbm2 } from '../utils/random.js';

/**
 * 园外远景（Lead 补充）
 * ------------------------------------------------------------
 * 围墙外不能是虚空：补一圈园外地形 + 济南"一城山色"的远山剪影 + 远处的树线，
 * 让所有视角（包括东门门洞、墙头）都有自然的层次与天际线。
 * 全部静态几何，2~4 draw calls，不参与碰撞。
 */

const OUTER = 900;

export function createOuterWorld(ctx) {
  const group = new THREE.Group();
  group.name = 'outer-world';
  const rand = mulberry32(0x0c17);

  /* ---------------- 园外地面（环形，中间挖掉公园范围，避免遮住园内水面） ---------------- */
  const holeMinX = BOUNDS.minX - 6;
  const holeMaxX = BOUNDS.maxX + 6;
  const holeMinZ = BOUNDS.minZ - 6;
  const holeMaxZ = BOUNDS.maxZ + 6;
  const outerShape = new THREE.Shape();
  outerShape.moveTo(-OUTER, -OUTER);
  outerShape.lineTo(OUTER, -OUTER);
  outerShape.lineTo(OUTER, OUTER);
  outerShape.lineTo(-OUTER, OUTER);
  outerShape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(holeMinX, holeMinZ);
  hole.lineTo(holeMinX, holeMaxZ);
  hole.lineTo(holeMaxX, holeMaxZ);
  hole.lineTo(holeMaxX, holeMinZ);
  hole.closePath();
  outerShape.holes.push(hole);
  const groundGeo = new THREE.ShapeGeometry(outerShape, 12);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.getAttribute('position');
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // 园外地面略低于园内（-0.12），远处轻微起伏
    const dist = Math.hypot(x, z);
    const h = (fbm2(x * 0.004 + 3.1, z * 0.004 + 7.7, 4) - 0.5) * 10 * Math.min(1, Math.max(0, (dist - 160) / 240));
    pos.setY(i, -0.12 + h);
    const n = fbm2(x * 0.02, z * 0.02, 3);
    c.setHSL(0.24 + n * 0.05, 0.16 + n * 0.08, 0.26 + n * 0.06);
    colors.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(0, -0.02, 0);
  ground.receiveShadow = true;
  ground.name = 'outer-ground';
  group.add(ground);

  /* ---------------- 远山（多圈剪影，雾中层层退远） ---------------- */
  const mountainMats = [];
  const ringSpecs = [
    { radius: 340, height: 62, base: 34, segs: 72, color: 0x53685a, opacity: 1, jitter: 0.55 },
    { radius: 480, height: 105, base: 48, segs: 64, color: 0x667a6e, opacity: 0.96, jitter: 0.6 },
    { radius: 680, height: 165, base: 68, segs: 52, color: 0x81928b, opacity: 0.86, jitter: 0.65 },
    { radius: 880, height: 235, base: 92, segs: 44, color: 0x9aa7a5, opacity: 0.7, jitter: 0.7 },
  ];

  for (let r = 0; r < ringSpecs.length; r++) {
    const spec = ringSpecs[r];
    const segs = spec.segs;
    const verts = [];
    const idx = [];
    const phase = rand() * 100;
    // 一圈起伏的山脊：底部一圈 + 顶部一圈
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const ridge =
        (fbm2(Math.cos(a) * 2.2 + phase, Math.sin(a) * 2.2 + phase, 4) - 0.35) *
        spec.height *
        spec.jitter;
      const peak = spec.base + Math.max(0, ridge);
      const r0 = spec.radius + Math.cos(a * 3 + phase) * 18;
      // 底部（外圈）与顶部（内圈），形成倾斜山坡
      verts.push(nx * (r0 + 70), -2, nz * (r0 + 70));
      verts.push(nx * (r0 - 40), peak, nz * (r0 - 40));
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: spec.opacity < 1,
      opacity: spec.opacity,
      depthWrite: spec.opacity >= 1,
      side: THREE.DoubleSide,
      fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = `distant-mountains-${r}`;
    group.add(mesh);
    mountainMats.push(mat);
  }

  /* ---------------- 园外树线（低模树团，遮挡地平线） ---------------- */
  const treeGeos = [];
  const treeCount = 340;
  const crownCount = treeCount * 3;
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.9, 5.5, 5);
  const crownGeo = new THREE.IcosahedronGeometry(3.4, 1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b3527, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x465c42, roughness: 1, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, crownCount);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  let ci = 0;
  for (let i = 0; i < treeCount; i++) {
    const a = rand() * Math.PI * 2;
    const dist = 150 + Math.pow(rand(), 0.55) * 300;
    const x = Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    const s = 0.85 + rand() * 1.4;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    p.set(x, -0.1 + 2.75 * s, z);
    scl.set(s, s, s);
    m.compose(p, q, scl);
    trunks.setMatrixAt(i, m);
    // 每棵树 3 个交叠的冠，形成蓬松剪影
    for (let k = 0; k < 3; k++) {
      const ox = (rand() - 0.5) * 3.2 * s;
      const oz = (rand() - 0.5) * 3.2 * s;
      const oy = (5.6 + rand() * 1.8) * s + (k === 2 ? 1.6 * s : 0);
      p.set(x + ox, -0.1 + oy, z + oz);
      const cs = s * (0.75 + rand() * 0.55);
      scl.set(cs * (0.9 + rand() * 0.35), cs * (0.75 + rand() * 0.4), cs * (0.9 + rand() * 0.35));
      m.compose(p, q, scl);
      crowns.setMatrixAt(ci, m);
      color.setHSL(0.25 + rand() * 0.05, 0.16 + rand() * 0.12, 0.17 + rand() * 0.09);
      crowns.setColorAt(ci, color);
      ci++;
    }
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.castShadow = false;
  trunks.receiveShadow = false;
  crowns.castShadow = false;
  crowns.receiveShadow = false;
  trunks.name = 'outer-trunks';
  crowns.name = 'outer-crowns';
  group.add(trunks, crowns);

  /* ---------------- 天气响应 ---------------- */
  const _base = [];
  for (const mat of mountainMats) {
    _base.push({ color: mat.color.clone(), opacity: mat.opacity });
  }
  const groundBase = groundMat.color.clone();
  let lastNight = -1;
  let lastSnow = -1;

  function update(dt, env) {
    if (Math.abs(env.night - lastNight) < 0.004 && Math.abs(env.snow - lastSnow) < 0.004) return;
    lastNight = env.night;
    lastSnow = env.snow;
    // 远山随夜色/雪色/雾变化
    for (let i = 0; i < mountainMats.length; i++) {
      const mat = mountainMats[i];
      const b = _base[i];
      mat.color.copy(b.color);
      mat.color.multiplyScalar(1 - env.night * 0.72);
      mat.color.lerp(env.fogColor, 0.42 + i * 0.1);
      if (env.snow > 0.02) mat.color.lerp(new THREE.Color(0.86, 0.89, 0.93), env.snow * 0.3);
      mat.opacity = b.opacity;
    }
    // 园外草地略压暗
    groundMat.color.copy(groundBase).multiplyScalar(1 - env.night * 0.55);
    if (env.snow > 0.02) groundMat.color.lerp(new THREE.Color(0.82, 0.86, 0.88), env.snow * 0.5);
  }

  return {
    object: group,
    colliders: [],
    update,
    dispose() {
      groundGeo.dispose();
      groundMat.dispose();
      for (const mat of mountainMats) mat.dispose();
      trunkGeo.dispose();
      crownGeo.dispose();
      trunkMat.dispose();
      crownMat.dispose();
      group.removeFromParent();
    },
  };
}

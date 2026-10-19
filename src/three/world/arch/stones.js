import * as THREE from 'three';
import { makeSteleFaceTexture } from '../../utils/labels.js';
import { deformRock } from './kit.js';
import { mulberry32 } from '../../utils/random.js';

/**
 * 碑刻 / 假山 / 龟石（B 号补充）
 */

const _m = new THREE.Matrix4();

function steleMesh(site, text, w, h, vertical = true, position, ry = 0) {
  const tex = makeSteleFaceTexture({ text, vertical, size: 512 });
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.88,
    metalness: 0.02,
    color: 0xffffff,
  });
  const geo = new THREE.PlaneGeometry(w, h);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  if (position) mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.y = ry;
  site.B.addMesh(mesh);
  return mesh;
}

/** 单通石碑（带碑座、碑帽） */
export function buildStele(site, s, opts = {}) {
  const B = site.B;
  const h = s.height || 3.2;
  const w = opts.width || 1.15;
  const d = opts.depth || 0.34;
  const rot = s.rotY || 0;
  B.push(s.pos[0], 0, s.pos[1], rot);

  /* 碑座：双层须弥座 */
  B.box('stoneDark', w + 1.15, 0.26, d + 1.15, 0, 0.13, 0, { uv: 0.6 });
  B.box('stone', w + 0.75, 0.3, d + 0.8, 0, 0.41, 0, { uv: 0.6 });
  B.box('stoneLight', w + 0.5, 0.16, d + 0.55, 0, 0.64, 0, { uv: 0.6 });

  /* 碑身 */
  const bodyH = h - 1.1;
  B.box('stoneLight', w, bodyH, d, 0, 0.72 + bodyH / 2, 0, { uv: 0.55 });
  /* 碑面（前后贴字） */
  const faceH = bodyH * 0.82;
  const faceW = w * 0.74;
  steleMesh(
    site, s.text || '', faceW, faceH,
    (s.textStyle || 'vertical') === 'vertical',
    [0, 0.72 + bodyH / 2 + 0.02, d / 2 + 0.012], 0
  );
  steleMesh(
    site, s.text || '', faceW, faceH,
    (s.textStyle || 'vertical') === 'vertical',
    [0, 0.72 + bodyH / 2 + 0.02, -d / 2 - 0.012], Math.PI
  );

  /* 碑帽（螭首 / 庑殿顶） */
  const capY = 0.72 + bodyH;
  B.box('stone', w + 0.55, 0.22, d + 0.4, 0, capY + 0.11, 0, { uv: 0.55 });
  B.box('stoneDark', w + 0.28, 0.18, d + 0.18, 0, capY + 0.31, 0, { uv: 0.5 });
  B.cyl('stone', 0.06, 0.2, 0.36, 8, 0, capY + 0.55, 0, {});

  B.pop();

  site.addCircle(s.pos[0], s.pos[1], 0.95);
}

/** 双御碑：两通并立 + 碑亭额枋 */
export function buildDoubleStele(site, s) {
  const B = site.B;
  const texts = ['康熙御题', '乾隆御题'];
  const rot = s.rotY || 0;
  B.push(s.pos[0], 0, s.pos[1], rot);
  for (let i = 0; i < 2; i++) {
    const off = (i - 0.5) * 2.1;
    B.push(off, 0, 0, 0);
    const w = 1.0;
    const h = s.height || 3.0;
    B.box('stoneDark', w + 1.0, 0.24, 1.05, 0, 0.12, 0, { uv: 0.6 });
    B.box('stone', w + 0.62, 0.28, 0.72, 0, 0.38, 0, { uv: 0.6 });
    B.box('stoneLight', w, h - 0.9, 0.3, 0, 0.52 + (h - 0.9) / 2, 0, { uv: 0.55 });
    const faceH = (h - 0.9) * 0.8;
    steleMesh(site, texts[i], w * 0.7, faceH, true, [0, 0.52 + (h - 0.9) / 2 + 0.02, 0.16], 0);
    steleMesh(site, texts[i], w * 0.7, faceH, true, [0, 0.52 + (h - 0.9) / 2 + 0.02, -0.16], Math.PI);
    const capY = 0.52 + (h - 0.9);
    B.box('stone', w + 0.46, 0.2, 0.5, 0, capY + 0.1, 0, { uv: 0.55 });
    B.box('stoneDark', w + 0.2, 0.16, 0.34, 0, capY + 0.28, 0, { uv: 0.5 });
    B.pop();
    site.addCircle(s.pos[0] + off * Math.cos(rot), s.pos[1] - off * Math.sin(rot), 0.8);
  }
  // 双碑上方小披檐
  B.box('woodDark', 3.6, 0.16, 0.5, 0, (s.height || 3.0) + 0.35, 0, {});
  B.box('tileB', 3.9, 0.1, 1.1, 0, (s.height || 3.0) + 0.47, 0, { rx: 0.12 });
  B.pop();
}

/** 假山：太湖石堆叠，含洞壑与蹬道 */
export function buildRockery(site, s) {
  const B = site.B;
  const [w, d] = s.size;
  const h = s.height || 6;
  const rand = mulberry32(0x5a17);
  const rot = s.rotY || 0;

  B.push(s.pos[0], 0, s.pos[1], rot);

  /* 底座 */
  B.box('stoneDark', w * 0.92, 0.7, d * 0.82, 0, 0.35, 0, { uv: 0.4 });

  /* 主峰与群石 */
  const rocks = 22;
  for (let i = 0; i < rocks; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = Math.cos(a) * r * w * 0.4;
    const z = Math.sin(a) * r * d * 0.36;
    const baseR = 1.1 + rand() * 2.1;
    const y = 0.5 + rand() * h * 0.62;
    const geo = new THREE.DodecahedronGeometry(baseR, 0);
    deformRock(geo, rand, 0.55, 1.35);
    geo.scale(1, 1.25 + rand() * 0.7, 1);
    _m.makeRotationY(rand() * Math.PI * 2);
    _m.setPosition(x, y, z);
    B.addGeo('rock', geo, _m.clone());
  }

  /* 峰顶小石 */
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.DodecahedronGeometry(1.2 + rand() * 0.8, 0);
    deformRock(geo, rand, 0.5, 1.2);
    _m.makeRotationY(rand() * Math.PI * 2);
    _m.setPosition((rand() - 0.5) * w * 0.35, h * 0.82 + rand() * 1.2, (rand() - 0.5) * d * 0.3);
    B.addGeo('rock', geo, _m.clone());
  }

  B.pop();

  /* 碰撞：底座 + 主峰 */
  site.addCircle(s.pos[0], s.pos[1], Math.min(w, d) * 0.34);
  site.addCircle(s.pos[0] - w * 0.22, s.pos[1] + d * 0.12, Math.min(w, d) * 0.22);
  site.addCircle(s.pos[0] + w * 0.24, s.pos[1] - d * 0.1, Math.min(w, d) * 0.22);
}

/** 龟石：形似神龟的太湖石 */
export function buildGuiStone(site, s) {
  const B = site.B;
  const rand = mulberry32(0x9e11);
  const rot = s.rotY || 0;
  B.push(s.pos[0], 0, s.pos[1], rot);
  B.box('stoneDark', 2.6, 0.3, 2.0, 0, 0.15, 0, { uv: 0.5 });
  const geo = new THREE.IcosahedronGeometry(1.5, 1);
  deformRock(geo, rand, 0.42, 0.92);
  geo.scale(1.05, 1.0, 1.35);
  _m.makeRotationY(0.4);
  _m.setPosition(0, 1.45, 0);
  B.addGeo('rock', geo, _m.clone());
  // 龟首
  const head = new THREE.IcosahedronGeometry(0.5, 1);
  deformRock(head, rand, 0.2, 0.8);
  _m.makeRotationY(-0.3);
  _m.setPosition(1.15, 1.2, 0.95);
  B.addGeo('rock', head, _m.clone());
  B.pop();
  site.addCircle(s.pos[0], s.pos[1], 1.6);
}

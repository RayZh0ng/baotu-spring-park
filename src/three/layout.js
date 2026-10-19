/**
 * 趵突泉公园 · 权威布局（唯一坐标来源）
 * ------------------------------------------------------------
 * 单位：米。+X 向东，+Z 向南（北 = -Z）。地面 y=0，水面 y=WATER_LEVEL。
 * 所有模块都必须使用本文件的坐标；不要在别处另建一套。
 *
 * 主要地标：
 *   东门 (109,0) → 牌坊 (88,0) → 主轴线 → 来鹤桥 (26,0) → 趵突泉 (0,0)
 *   趵突泉西岸观澜亭 (-24,0)；北岸泺源堂 (0,-25)、娥英祠 (0,-38)
 *   东侧溪流 x≈26 自北向南，经来鹤桥、南石板桥，注入荷花池 (18,62)
 *   东南：漱玉泉 (52,32)、李清照纪念堂 (60,35~53)
 *   东北：望鹤亭 (42,-12)、马跑泉 (70,-22)、金线泉 (78,16)、假山 (86,-30)
 *   西：万竹园 (-84,-18)；南：沧园 (-56,56)；荷风亭在荷花池心 (18,62)
 */

export const BOUNDS = { minX: -114, maxX: 114, minZ: -84, maxZ: 84 };
export const WATER_LEVEL = -0.42;
export const EYE_HEIGHT = 1.65;
export const SPAWN = { x: 34.5, z: 0, yaw: Math.PI / 2 }; // 来鹤桥东侧第一观泉点，面朝西（泉池方向）

/* ---------------------------------------------------------------- 水系 */

/** 泉眼（主泉三股水 + 各泉冒泡强度） */
export const SPRING_JETS = {
  main: {
    name: '趵突泉',
    // [x, z]，相对世界坐标
    jets: [
      { x: -3.0, z: -1.6, height: 0.95, radius: 0.95, phase: 0.0 },
      { x: 0.2, z: 0.9, height: 1.15, radius: 1.05, phase: 1.7 },
      { x: 3.2, z: -1.4, height: 0.9, radius: 0.9, phase: 3.1 },
    ],
  },
  shuyu: { name: '漱玉泉', jets: [{ x: 52, z: 32, height: 0.22, radius: 1.2, phase: 0.5 }] },
  goldenLine: { name: '金线泉', jets: [{ x: 78, z: 16, height: 0.14, radius: 0.9, phase: 2.2 }] },
  marun: { name: '马跑泉', jets: [{ x: 70, z: -22, height: 0.18, radius: 1.0, phase: 1.1 }] },
  wangshui: { name: '望水泉', jets: [{ x: -75, z: -8, height: 0.12, radius: 0.8, phase: 3.4 }] },
  cangquan: { name: '沧泉', jets: [{ x: -50, z: 63, height: 0.1, radius: 0.7, phase: 0.9 }] },
};

/** 所有水面形状（地形负责下挖，水面模块负责铺水） */
export const WATER_SHAPES = [
  {
    id: 'main-spring',
    name: '趵突泉',
    kind: 'ellipse',
    cx: 0, cz: 0, rx: 18, rz: 13,
    rimWidth: 1.9, rimHeight: 0.34, depth: 1.9,
    hasRailing: true,
    railingGaps: [
      { angle: -Math.PI / 2, width: 5.2 }, // 北岸泺源堂前
      { angle: Math.PI * 0.5, width: 4.4 }, // 南岸
      { angle: Math.PI, width: 4.6 }, // 西岸观澜亭
      { angle: 0, width: 3.6 }, // 东岸
    ],
  },
  {
    id: 'channel',
    name: '溪流',
    kind: 'polyline',
    width: 3.4, depth: 1.2, rimWidth: 0.5, rimHeight: 0.16,
    points: [
      [26.4, -36], [25.6, -26], [26.2, -16], [25.8, -8], [26.2, 0],
      [27.2, 10], [30.2, 22], [35.2, 32], [40.2, 40], [44.2, 46],
      [42.2, 52], [36.2, 58], [26.4, 62],
    ],
  },
  { id: 'lotus-pond', name: '荷花池', kind: 'ellipse', cx: 18, cz: 62, rx: 9, rz: 8.4, rimWidth: 1.2, rimHeight: 0.24, depth: 1.3, hasRailing: false },
  { id: 'shuyu-spring', name: '漱玉泉', kind: 'ellipse', cx: 52, cz: 32, rx: 4.6, rz: 3.8, rimWidth: 1.0, rimHeight: 0.3, depth: 1.2, hasRailing: true },
  { id: 'golden-line', name: '金线泉', kind: 'ellipse', cx: 78, cz: 16, rx: 3.6, rz: 3.1, rimWidth: 0.9, rimHeight: 0.28, depth: 1.1, hasRailing: true },
  { id: 'marun-spring', name: '马跑泉', kind: 'ellipse', cx: 70, cz: -22, rx: 5.0, rz: 4.2, rimWidth: 1.0, rimHeight: 0.28, depth: 1.2, hasRailing: true },
  { id: 'wangshui-spring', name: '望水泉', kind: 'ellipse', cx: -75, cz: -8, rx: 3.6, rz: 3.0, rimWidth: 0.8, rimHeight: 0.26, depth: 1.0, hasRailing: true },
  { id: 'cangquan-spring', name: '沧泉', kind: 'ellipse', cx: -50, cz: 63, rx: 3.2, rz: 2.8, rimWidth: 0.8, rimHeight: 0.26, depth: 1.0, hasRailing: true },
];

/* ---------------------------------------------------------------- 道路 */

const P = (points, width, type = 'stone', extra = {}) => ({ points, width, type, ...extra });

export const PATHS = [
  // 东门主轴线（东段，至来鹤桥东端）
  P([[106, 0], [96, 0], [88, 0], [76, 0], [66, 0], [56, 0], [46, 0], [36, 0], [30.5, 0], [28.9, 0]], 7, 'paving', { id: 'axis-east' }),
  // 主轴线（西段，桥西端至泉池东岸）
  P([[23.5, 0], [21.4, 0], [18.6, 0]], 7, 'paving', { id: 'axis-west' }),
  // 环泉步道（椭圆闭合）
  {
    id: 'pool-ring', width: 4.2, type: 'stone', closed: true,
    points: ellipsePoints(0, 0, 20.6, 15.6, 48),
  },
  // 泺源堂前庭
  P([[0, -15.2], [0, -20.2]], 7, 'paving', { id: 'hall-forecourt' }),
  // 泺源堂两侧绕行
  P([[-12.5, -18], [-15, -24], [-15, -32], [-14, -40], [-10, -45], [-6, -47.5]], 3.4, 'stone', { id: 'north-bypass-w' }),
  P([[12.5, -18], [15, -24], [15, -32], [14, -40], [10, -45], [6, -47.5]], 3.4, 'stone', { id: 'north-bypass-e' }),
  // 娥英祠前
  P([[-12, -32], [12, -32]], 2.8, 'stone', { id: 'shrine-forecourt' }),
  // 北园路（至北门）
  P([[0, -47.5], [0, -56], [0, -66], [0, -74], [0, -79]], 4.6, 'stone', { id: 'north-axis' }),
  // 长廊西端下路
  P([[-40, -19.5], [-40, -12], [-41, -5]], 3.0, 'stone', { id: 'corridor-link' }),
  // 西园路（至万竹园东门）
  P([[-21.2, 2], [-30, 0], [-40, -3], [-52, -8], [-60, -13], [-65.6, -17]], 4.0, 'stone', { id: 'west-path' }),
  // 南园路（泉池南 → 沧园东门）
  P([[0, 17], [-4, 24], [-12, 32], [-22, 38], [-32, 42], [-42, 46], [-42, 51], [-41, 55]], 4.0, 'stone', { id: 'south-path' }),
  // 南门路
  P([[-24, 80], [-24, 72], [-26, 62], [-30, 54], [-33, 47], [-38, 43.5]], 3.6, 'stone', { id: 'south-gate-path' }),
  // 南园至荷花池
  P([[0, 17], [-4, 24], [2, 34], [8, 42], [10, 49], [10, 53]], 3.2, 'stone', { id: 'south-garden-path' }),
  // 东园北支（望鹤亭 → 马跑泉 → 假山）
  P([[36, 0], [36, -5], [38.5, -9], [41.5, -11.2]], 3.6, 'stone', { id: 'wanghe-path' }),
  P([[41.5, -11.2], [48, -14], [56, -18], [62, -20], [66.5, -21]], 3.2, 'stone', { id: 'marun-path' }),
  P([[66.5, -21], [72, -24], [78, -27], [82, -29]], 3.0, 'stone', { id: 'rockery-path' }),
  // 东南支路（漱玉泉）
  P([[30.5, 0.5], [33, 8], [37, 15], [42, 21], [47, 27], [50.5, 30]], 3.6, 'stone', { id: 'shuyu-path' }),
  // 漱玉泉 → 李清照纪念堂
  P([[50.5, 30], [54, 32], [58, 33], [60, 31]], 3.2, 'stone', { id: 'liqingzhao-path' }),
  // 李清照纪念堂 → 荷花池（跨溪石板桥）
  P([[52, 37], [50, 42], [46, 46], [43, 48], [39, 51], [34, 54], [30, 56.5], [26.5, 57]], 3.0, 'stone', { id: 'pond-path' }),
  // 金线泉路
  P([[46, 0.5], [54, 4], [62, 8], [70, 12], [74, 14.5]], 3.2, 'stone', { id: 'goldenline-path' }),
  // 荷花池环道
  { id: 'lotus-ring', width: 3.2, type: 'stone', closed: true, points: ellipsePoints(18, 62, 11.5, 10.8, 40) },
  // 万竹园内径
  P([[-67.2, -18], [-74, -19], [-82, -20], [-87, -20]], 3.0, 'stone', { id: 'wanzhu-path' }),
  // 沧园内径
  P([[-41.2, 56], [-48, 54], [-54, 52], [-58, 51.5]], 2.8, 'stone', { id: 'cang-path' }),
];

/* ---------------------------------------------------------------- 高差与可行走区域 */

/**
 * 可行走高差区域。heightAt() 会把它们合成一个平滑高度场。
 * kind: capsule | rect | circle
 */
export const ELEVATED = [
  // 来鹤桥：东西向拱桥，跨溪
  { id: 'laihe-bridge', kind: 'capsule', points: [[23.6, 0], [28.8, 0]], r: 2.9, h: 0.62, arch: true, blend: 0.55 },
  // 观澜亭石台
  { id: 'guanlan-platform', kind: 'rect', minX: -28, maxX: -20, minZ: -4, maxZ: 4, h: 0.5, blend: 1.2 },
  // 望鹤亭茶台
  { id: 'wanghe-terrace', kind: 'rect', minX: 37, maxX: 47, minZ: -16.5, maxZ: -7.5, h: 0.35, blend: 1.0 },
  // 荷风亭小岛
  { id: 'lotus-island', kind: 'circle', cx: 18, cz: 62, r: 4.6, h: 0.3, blend: 1.0 },
  // 九曲桥（通向小岛）
  { id: 'zigzag-bridge', kind: 'capsule', points: [[7.4, 57.7], [10, 59.5], [12.5, 61], [14.5, 61.5]], r: 1.15, h: 0.28, blend: 0.4, ramp: 0.8 },
  // 南石板桥（跨溪）
  { id: 'south-slab-bridge', kind: 'capsule', points: [[45.6, 45.5], [40.6, 49.6]], r: 1.7, h: 0.22, blend: 0.35, ramp: 0.5 },
];

/* ---------------------------------------------------------------- 围墙 */

export const WALL_SEGMENTS = [
  // 东墙（x=113，留东门 z∈[-7,7]）
  { id: 'wall-e-n', x: 113, z: -45, hx: 0.5, hz: 38 },
  { id: 'wall-e-s', x: 113, z: 45, hx: 0.5, hz: 38 },
  // 北墙（z=-83，留北门 x∈[-5,5]）
  { id: 'wall-n-w', x: -59, z: -83, hx: 54, hz: 0.5 },
  { id: 'wall-n-e', x: 59, z: -83, hx: 54, hz: 0.5 },
  // 南墙（z=83，留南门 x∈[-29,-19]）
  { id: 'wall-s-w', x: -71, z: 83, hx: 42, hz: 0.5 },
  { id: 'wall-s-e', x: 47, z: 83, hx: 66, hz: 0.5 },
  // 西墙
  { id: 'wall-w', x: -113, z: 0, hx: 0.5, hz: 83 },
];

/** 宫门（对应围墙缺口） */
export const GATEWAYS = [
  { id: 'gate-east', x: 109, z: 0, width: 14, depth: 7, height: 11, facing: 'west', main: true },
  { id: 'gate-north', x: 0, z: -81.5, width: 10, depth: 6, height: 8.5, facing: 'south' },
  { id: 'gate-south', x: -24, z: 81.5, width: 10, depth: 6, height: 8.5, facing: 'north' },
];

/* ---------------------------------------------------------------- 建筑与构筑物 */

/**
 * rotY：0 = 正面朝南(+Z)；π/2 = 正面朝东(+X)；π = 朝北；-π/2 = 朝西。
 * size: [进深沿轴线 X / 宽沿轴线 Z]（按 rotY 旋转后的本地尺寸：x=宽、z=深？）
 * 为便于建筑模块实现，统一为 local size [width(x), depth(z)]，front = local +Z 方向。
 */
export const STRUCTURES = [
  {
    id: 'east-gate', type: 'gate', name: '东门', pos: [109, 0], rotY: -Math.PI / 2,
    size: [15, 7], height: 11, base: 0.5, plaque: '趵突泉', main: true,
  },
  {
    id: 'paifang', type: 'paifang', name: '牌坊', pos: [88, 0], rotY: -Math.PI / 2,
    size: [13, 2.2], height: 8.6, base: 0.25, plaque: '天下第一泉',
  },
  {
    id: 'north-gate', type: 'gate', name: '北门', pos: [0, -81.5], rotY: 0,
    size: [10, 6], height: 8.5, base: 0.4, plaque: '趵突泉',
  },
  {
    id: 'south-gate', type: 'gate', name: '南门', pos: [-24, 81.5], rotY: Math.PI,
    size: [10, 6], height: 8.5, base: 0.4, plaque: '趵突泉',
  },
  {
    id: 'luoyuan-hall', type: 'hall', name: '泺源堂', pos: [0, -25], rotY: 0,
    size: [20, 10], height: 8.4, base: 0.9, plaque: '泺源堂', bays: 3,
    entrance: 'south',
  },
  {
    id: 'eying-shrine', type: 'hall', name: '娥英祠', pos: [0, -38], rotY: 0,
    size: [22, 9], height: 8.0, base: 1.0, plaque: '娥英祠', bays: 3,
    entrance: 'south',
  },
  {
    id: 'guanlan-pavilion', type: 'pavilion', name: '观澜亭', pos: [-24, 0], rotY: Math.PI / 2,
    size: [7, 7], height: 6.4, base: 0.5, plaque: '观澜亭', open: true,
  },
  {
    id: 'wanghe-pavilion', type: 'pavilion', name: '望鹤亭', pos: [42, -12], rotY: 0,
    size: [9, 7], height: 6.2, base: 0.35, plaque: '望鹤亭', open: true, tea: true,
  },
  {
    id: 'lotus-pavilion', type: 'hexpavilion', name: '荷风亭', pos: [18, 62], rotY: 0,
    size: [5.4, 5.4], height: 5.2, base: 0.3, plaque: '荷风亭', open: true,
  },
  {
    id: 'li-qingzhao-compound', type: 'compound', name: '李清照纪念堂', pos: [60, 44],
    rect: [48, 35, 72, 53], gate: [60, 35], gateFacing: 'north', wallHeight: 3.0,
    plaque: '李清照纪念堂',
    halls: [
      { id: 'li-qingzhao-hall', type: 'hall', name: '李清照纪念堂', pos: [60, 46], rotY: Math.PI, size: [16, 9], height: 7.4, base: 0.8, plaque: '李清照纪念堂', bays: 3 },
      { id: 'liqingzhao-side-e', type: 'wing', name: '东厢', pos: [70, 41], rotY: -Math.PI / 2, size: [10, 4], height: 4.6, base: 0.4 },
      { id: 'liqingzhao-side-w', type: 'wing', name: '西厢', pos: [50, 41], rotY: Math.PI / 2, size: [10, 4], height: 4.6, base: 0.4 },
    ],
  },
  {
    id: 'wanzhu-compound', type: 'compound', name: '万竹园', pos: [-84, -18],
    rect: [-101, -32, -67, -4], gate: [-67, -18], gateFacing: 'east', wallHeight: 3.2,
    plaque: '万竹园',
    halls: [
      { id: 'likuchan-hall', type: 'hall', name: '李苦禅纪念馆', pos: [-90, -20], rotY: Math.PI / 2, size: [10, 16], height: 7.2, base: 0.7, plaque: '李苦禅纪念馆', bays: 3 },
      { id: 'wanzhu-wing', type: 'wing', name: '竹林精舍', pos: [-78, -28], rotY: 0, size: [14, 4], height: 4.4, base: 0.35 },
    ],
  },
  {
    id: 'cang-compound', type: 'compound', name: '沧园', pos: [-56, 56],
    rect: [-71, 44, -41, 68], gate: [-41, 56], gateFacing: 'east', wallHeight: 3.0,
    plaque: '沧园',
    halls: [
      { id: 'baixue-tower', type: 'tower', name: '白雪楼', pos: [-58, 52], rotY: 0, size: [14, 8], height: 10.5, base: 0.6, plaque: '白雪楼' },
      { id: 'cang-wing', type: 'wing', name: '沧园水榭', pos: [-64, 62], rotY: Math.PI, size: [12, 4.5], height: 4.8, base: 0.4 },
    ],
  },
  // 长廊（从泺源堂西侧向西）
  {
    id: 'corridor', type: 'corridor', name: '长廊', pos: [-29.5, -19.5], rotY: 0,
    length: 32, width: 3.4, height: 5.4, bays: 8, base: 0.25,
  },
  // 来鹤桥（拱桥，跨溪）
  {
    id: 'laihe-bridge', type: 'archbridge', name: '来鹤桥', pos: [26.2, 0], rotY: Math.PI / 2,
    span: 5.4, deckWidth: 5.6, arch: 0.62, deckY: 0.1, railH: 0.95,
  },
  // 南石板桥（平桥，跨溪）
  {
    id: 'south-slab-bridge', type: 'slabbridge', name: '石板桥', pos: [43.1, 47.6], rotY: -0.95,
    span: 6.2, deckWidth: 3.4, deckY: 0.24, railH: 0.45,
  },
  // 九曲桥（通向荷风亭小岛）
  {
    id: 'zigzag-bridge', type: 'zigzagbridge', name: '九曲桥',
    points: [[7.4, 57.7], [10, 59.5], [12.5, 61], [14.5, 61.5]],
    width: 2.2, deckY: 0.28, railH: 0.55,
  },
  // 碑刻
  { id: 'baotu-stele', type: 'stele', name: '趵突泉碑', pos: [20.5, -7.5], rotY: -Math.PI / 2, height: 3.4, text: '趵突泉', textStyle: 'vertical' },
  { id: 'diyiquan-stele', type: 'stele', name: '第一泉碑', pos: [-17, 6], rotY: Math.PI / 2, height: 3.2, text: '第一泉', textStyle: 'vertical' },
  { id: 'shuangyu-bei', type: 'steles', name: '双御碑', pos: [14, -16], rotY: Math.PI / 2, height: 3.0, plaque: '双御碑', count: 2 },
  // 假山
  { id: 'rockery', type: 'rockery', name: '假山', pos: [86, -30], rotY: 0.3, size: [18, 12], height: 6.5 },
  { id: 'gui-stone', type: 'rock', name: '龟石', pos: [44, 25], rotY: 1.1, size: [3.2, 2.4], height: 2.6 },
];

/* ---------------------------------------------------------------- 园林种植分区（给植被模块） */

/**
 * 每个 zone：在椭圆/矩形范围里按确定性随机撒树；
 * avoidWater/avoidStructures/avoidPaths 由植被模块结合本文件的辅助函数处理。
 * kind: willow | pine | bamboo | blossom | maple | mixed
 */
export const PLANTING_ZONES = [
  // 泉池四周垂柳（"四面荷花三面柳"）
  { id: 'willow-pool', kind: 'willow', count: 14, area: { kind: 'ring', cx: 0, cz: 0, rx: 19.8, rz: 14.8, band: 7 }, seed: 11 },
  // 溪流沿岸
  { id: 'willow-channel', kind: 'willow', count: 8, area: { kind: 'line', points: [[26.4, -34], [26.2, 0], [30.2, 22], [40.2, 40], [42.2, 52], [30, 60]], band: 3.6, side: 1 }, seed: 23 },
  { id: 'willow-south', kind: 'willow', count: 6, area: { kind: 'ellipse', cx: -6, cz: 30, rx: 26, rz: 20 }, seed: 37 },
  // 松柏（北岸与东北）
  { id: 'pine-north', kind: 'pine', count: 9, area: { kind: 'ellipse', cx: -2, cz: -52, rx: 30, rz: 16 }, seed: 41 },
  { id: 'pine-east', kind: 'pine', count: 7, area: { kind: 'ellipse', cx: 74, cz: -44, rx: 26, rz: 20 }, seed: 43 },
  { id: 'pine-west', kind: 'pine', count: 5, area: { kind: 'ellipse', cx: -50, cz: -30, rx: 24, rz: 16 }, seed: 47 },
  // 竹林
  { id: 'bamboo-wanzhu', kind: 'bamboo', count: 26, area: { kind: 'rect', minX: -99, maxX: -69, minZ: -30, maxZ: -6 }, seed: 53 },
  { id: 'bamboo-west', kind: 'bamboo', count: 18, area: { kind: 'rect', minX: -110, maxX: -98, minZ: -60, maxZ: 50 }, seed: 59 },
  { id: 'bamboo-north', kind: 'bamboo', count: 12, area: { kind: 'rect', minX: 30, maxX: 70, minZ: -74, maxZ: -56 }, seed: 61 },
  { id: 'bamboo-cang', kind: 'bamboo', count: 10, area: { kind: 'rect', minX: -65, maxX: -46, minZ: 58, maxZ: 66 }, seed: 67 },
  { id: 'bamboo-liqingzhao', kind: 'bamboo', count: 8, area: { kind: 'rect', minX: 64, maxX: 71, minZ: 37, maxZ: 51 }, seed: 71 },
  // 海棠 / 花木
  { id: 'blossom-south', kind: 'blossom', count: 10, area: { kind: 'ellipse', cx: 2, cz: 40, rx: 28, rz: 16 }, seed: 73 },
  { id: 'blossom-liqingzhao', kind: 'blossom', count: 4, area: { kind: 'ellipse', cx: 60, cz: 30, rx: 10, rz: 6 }, seed: 79 },
  { id: 'blossom-east', kind: 'blossom', count: 6, area: { kind: 'ellipse', cx: 62, cz: 26, rx: 18, rz: 12 }, seed: 83 },
  // 红枫 / 秋色
  { id: 'maple-rockery', kind: 'maple', count: 5, area: { kind: 'ellipse', cx: 84, cz: -22, rx: 16, rz: 12 }, seed: 89 },
  { id: 'maple-cang', kind: 'maple', count: 4, area: { kind: 'ellipse', cx: -54, cz: 44, rx: 14, rz: 8 }, seed: 97 },
];

/** 荷 / 芦苇 / 水草等水生植物 */
export const AQUATIC_ZONES = [
  { id: 'lotus-main', kind: 'lotus', shape: 'ellipse', cx: 18, cz: 62, rx: 7.6, rz: 7.0, count: 34, seed: 101 },
  { id: 'lotus-cang', kind: 'lotus', shape: 'ellipse', cx: -50, cz: 63, rx: 2.6, rz: 2.3, count: 8, seed: 103 },
  { id: 'lotus-wanzhu', kind: 'lotus', shape: 'ellipse', cx: -75, cz: -8, rx: 2.9, rz: 2.4, count: 9, seed: 107 },
  { id: 'reed-channel', kind: 'reed', shape: 'line', points: [[35.2, 32], [40.2, 40], [42.2, 52]], band: 1.8, count: 40, seed: 109 },
  { id: 'reed-pond', kind: 'reed', shape: 'ellipse', cx: 18, cz: 62, rx: 8.4, rz: 7.8, count: 26, seed: 113, edgeOnly: true },
];

/* ---------------------------------------------------------------- 路径点 / 小地名 */

export const LANDMARKS = {
  eastGate: { x: 109, z: 0 },
  paifang: { x: 88, z: 0 },
  bridge: { x: 26.2, z: 0 },
  mainSpring: { x: 0, z: 0 },
  guanlan: { x: -24, z: 0 },
  luoyuan: { x: 0, z: -25 },
  eying: { x: 0, z: -38 },
  corridor: { x: -29.5, z: -19.5 },
  wanghe: { x: 42, z: -12 },
  marun: { x: 70, z: -22 },
  goldenLine: { x: 78, z: 16 },
  rockery: { x: 86, z: -30 },
  guiStone: { x: 44, z: 25 },
  shuyu: { x: 52, z: 32 },
  liQingzhao: { x: 60, z: 44 },
  lotusPond: { x: 18, z: 62 },
  wanzhu: { x: -84, z: -18 },
  cang: { x: -56, z: 56 },
};

/* ---------------------------------------------------------------- 辅助函数 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成椭圆上的点（含首尾闭合） */
export function ellipsePoints(cx, cz, rx, rz, count = 40) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  pts.push(pts[0].slice());
  return pts;
}

/** 点到线段距离 */
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t;
  const qz = az + dz * t;
  return Math.hypot(px - qx, pz - qz);
}

/** 点到折线的最近距离与参数 */
export function distToPolyline(px, pz, points) {
  let best = Infinity;
  let bestT = 0;
  let acc = 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const segLen = Math.hypot(bx - ax, bz - az);
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
    if (d < best) {
      best = d;
      bestT = (acc + segLen * t) / (total || 1);
    }
    acc += segLen;
  }
  return { dist: best, t: bestT };
}

export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function elevatedHeightAt(x, z, region) {
  if (region.kind === 'circle') {
    const r = region.r;
    const d = Math.hypot(x - region.cx, z - region.cz);
    if (d >= r) return 0;
    return region.h * smoothstep(0, region.blend, r - d);
  }
  if (region.kind === 'rect') {
    const { minX, maxX, minZ, maxZ } = region;
    if (x < minX || x > maxX || z < minZ || z > maxZ) return 0;
    const d = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
    return region.h * smoothstep(0, region.blend, d);
  }
  if (region.kind === 'capsule') {
    const { dist, t } = distToPolyline(x, z, region.points);
    const r = region.r;
    if (dist >= r) return 0;
    let edge = smoothstep(0, region.blend, r - dist);
    let along = 1;
    if (region.arch) {
      along = Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
    } else if (region.ramp) {
      const total = capsuleLength(region.points);
      const rampT = Math.min(0.49, region.ramp / (total || 1));
      along = smoothstep(0, rampT, t) * smoothstep(0, rampT, 1 - t);
    }
    return region.h * edge * along;
  }
  return 0;
}

function capsuleLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  return total;
}

/** 世界任意点的高度（可步行区域） */
export function heightAt(x, z) {
  let h = 0;
  for (let i = 0; i < ELEVATED.length; i++) {
    const v = elevatedHeightAt(x, z, ELEVATED[i]);
    if (v > h) h = v;
  }
  return h;
}

/** 是否位于某个水面形状内（含少量外扩 margin） */
export function isWaterAt(x, z, margin = 0) {
  for (const s of WATER_SHAPES) {
    if (s.kind === 'ellipse') {
      const dx = (x - s.cx) / (s.rx + margin);
      const dz = (z - s.cz) / (s.rz + margin);
      if (dx * dx + dz * dz <= 1) return s;
    } else if (s.kind === 'polyline') {
      if (distToPolyline(x, z, s.points).dist <= s.width / 2 + margin) return s;
    }
  }
  return null;
}

/** 是否在建筑（含院落/围墙）范围内（可加 margin 外扩） */
export function isStructureAt(x, z, margin = 0) {
  for (const s of STRUCTURES) {
    if (s.type === 'compound') {
      const [x0, z0, x1, z1] = s.rect;
      if (x >= x0 - margin && x <= x1 + margin && z >= z0 - margin && z <= z1 + margin) return s;
      continue;
    }
    if (s.type === 'rockery') {
      const [w, d] = s.size;
      const c = Math.cos(-s.rotY);
      const sn = Math.sin(-s.rotY);
      const lx = (x - s.pos[0]) * c - (z - s.pos[1]) * sn;
      const lz = (x - s.pos[0]) * sn + (z - s.pos[1]) * c;
      if (Math.abs(lx) <= w / 2 + margin && Math.abs(lz) <= d / 2 + margin) return s;
      continue;
    }
    if (s.type === 'zigzagbridge' || s.type === 'archbridge' || s.type === 'slabbridge') continue;
    if (s.type === 'stele' || s.type === 'steles' || s.type === 'rock' || s.type === 'corridor') continue;
    if (!s.size) continue;
    const [w, d] = s.size;
    const c = Math.cos(-(s.rotY || 0));
    const sn = Math.sin(-(s.rotY || 0));
    const lx = (x - s.pos[0]) * c - (z - s.pos[1]) * sn;
    const lz = (x - s.pos[0]) * sn + (z - s.pos[1]) * c;
    if (Math.abs(lx) <= w / 2 + margin && Math.abs(lz) <= d / 2 + margin) return s;
  }
  return null;
}

/** 点到最近道路中心线的距离 */
export function pathDistance(x, z) {
  let best = Infinity;
  for (const p of PATHS) {
    const { dist } = distToPolyline(x, z, p.points);
    const d = dist - p.width / 2;
    if (d < best) best = d;
  }
  return best;
}

/** 是否可以种树/摆小品（不在水面、建筑、道路、围墙里，且在园内） */
export function isPlantable(x, z, opts = {}) {
  const { marginWater = 0.8, marginPath = 1.0, marginStructure = 0.8, marginWall = 2.5 } = opts;
  if (x < BOUNDS.minX + 2 || x > BOUNDS.maxX - 2 || z < BOUNDS.minZ + 2 || z > BOUNDS.maxZ - 2) return false;
  if (isWaterAt(x, z, marginWater)) return false;
  if (isStructureAt(x, z, marginStructure)) return false;
  if (pathDistance(x, z) < marginPath) return false;
  for (const w of WALL_SEGMENTS) {
    if (Math.abs(x - w.x) < w.hx + marginWall && Math.abs(z - w.z) < w.hz + marginWall) return false;
  }
  return true;
}

/** 把点从水面/建筑/道路里推出去，用于确定性的撒点 */
export function findPlantableSpot(rand, area, opts = {}) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let x;
    let z;
    if (area.kind === 'ellipse') {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand());
      x = area.cx + Math.cos(a) * area.rx * r;
      z = area.cz + Math.sin(a) * area.rz * r;
    } else if (area.kind === 'rect') {
      x = area.minX + rand() * (area.maxX - area.minX);
      z = area.minZ + rand() * (area.maxZ - area.minZ);
    } else if (area.kind === 'ring') {
      const a = rand() * Math.PI * 2;
      const r = area.rx + (rand() - 0.5) * area.band * 2;
      x = area.cx + Math.cos(a) * r;
      z = area.cz + Math.sin(a) * (area.rz / area.rx) * r;
    } else if (area.kind === 'line') {
      const pts = area.points;
      const seg = Math.floor(rand() * (pts.length - 1));
      const t = rand();
      const [ax, az] = pts[seg];
      const [bx, bz] = pts[seg + 1];
      const nx = (bz - az) / (Math.hypot(bx - ax, bz - az) || 1);
      const nz = -(bx - ax) / (Math.hypot(bx - ax, bz - az) || 1);
      const off = (rand() * 2 - 1) * area.band * (area.side ? 1 : 1);
      x = ax + (bx - ax) * t + nx * off;
      z = az + (bz - az) * t + nz * off;
    } else {
      x = 0;
      z = 0;
    }
    if (isPlantable(x, z, opts)) return [x, z];
  }
  return null;
}

export const LAYOUT = {
  BOUNDS,
  WATER_LEVEL,
  EYE_HEIGHT,
  SPAWN,
  SPRING_JETS,
  WATER_SHAPES,
  PATHS,
  ELEVATED,
  WALL_SEGMENTS,
  GATEWAYS,
  STRUCTURES,
  PLANTING_ZONES,
  AQUATIC_ZONES,
  LANDMARKS,
  heightAt,
  isWaterAt,
  isStructureAt,
  pathDistance,
  isPlantable,
  findPlantableSpot,
  distToPolyline,
  distToSegment,
  ellipsePoints,
  smoothstep,
  mulberry32,
};

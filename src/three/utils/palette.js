/**
 * 园林统一色板 —— 所有模块从这里取色，避免色彩跑偏。
 */
export const COLORS = {
  // 建筑
  vermilion: 0x9e3b2e,
  vermilionDark: 0x7e2d24,
  vermilionBright: 0xb44a36,
  tile: 0x4b5a63,
  tileDark: 0x394750,
  tileEdge: 0x2f3a42,
  plaster: 0xe6e2d6,
  plasterWarm: 0xd9d2bf,
  wood: 0x3d2f26,
  woodLight: 0x6b503a,
  woodRed: 0x6e3a2c,
  stone: 0x8a938e,
  stoneDark: 0x6a726d,
  stoneLight: 0x9fa7a2,
  stoneWarm: 0x9a958a,
  marble: 0xcfcabe,
  gold: 0xc8a25e,
  goldDim: 0x9b7b41,
  bronze: 0x6d5a3c,
  ink: 0x1f2622,
  paper: 0xe8dfc8,
  lanternRed: 0xc0472f,

  // 植物
  willow: 0x8aa65a,
  willowDark: 0x6d8b47,
  bamboo: 0x5d7d4c,
  bambooDark: 0x455f39,
  pine: 0x3f5240,
  pineDark: 0x2f4033,
  blossom: 0xe6b7bd,
  maple: 0xb05a3a,
  grass: 0x6f7f4a,
  grassDry: 0x8b8557,
  lotusPink: 0xe0a3ad,
  lotusLeaf: 0x5f7d49,
  reed: 0x9a9364,

  // 水 / 天 / 石
  waterDeep: 0x1e4f4d,
  waterShallow: 0x7fbfb0,
  waterSurface: 0x5aa79c,
  skyFallback: 0x2c6cad,
  groundWet: 0x5f6752,
  snowTint: 0xf2f5f7,
};

export const FONT_SERIF =
  '"Songti SC", "STSong", "Noto Serif SC", "Hiragino Sans GB", "SimSun", serif';
export const FONT_SANS =
  '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

/** 常用材质构造（不要在循环里创建） */
export function mat(color, opts = {}) {
  const { roughness = 0.86, metalness = 0.02, ...rest } = opts;
  const { MeshStandardMaterial } = opts.THREE || {};
  return new MeshStandardMaterial({ color, roughness, metalness, ...rest });
}

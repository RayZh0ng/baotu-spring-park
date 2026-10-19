# 趵突泉 3D 公园 — 协作契约（所有成员必读）

> 项目：可游览的 3D 趵突泉公园 + 可选天气系统。
> 技术栈：Vite + React 19 + Three.js 0.186，纯程序化资产（不下载任何外部模型/纹理/字体/图片）。
> 目标：一座**可信、好看、能走**的中国北方古典园林：泉、堂、亭、桥、廊、碑、竹、柳、石。

---

## 0. 运行与自检

- 依赖已安装，**不要执行 `pnpm install`**，不要改 `package.json`。
- 主开发服务器（Lead 维护）：`http://127.0.0.1:5174`。页面开启 HMR，改文件后重新截图即可。
- 截图/自检命令（任意目录执行）：

```bash
node scripts/shot.mjs --url "http://127.0.0.1:5174/?weather=sunny" --out /tmp/qa/x.png --wait 2200
```

截图脚本会打印浏览器 console 错误；**你的工作验收标准之一是没有 error**。脚本会自动等待 `window.__PARK_READY__`。

- URL 调试参数（QA 专用，全部可选）：
  - `weather=sunny|cloudy|overcast|drizzle|storm|mist|snow|dusk|night`
  - `mode=walk|tour`
  - `poi=<poiId>`：把玩家/导览瞬移到该景点（见 `src/data/pois.js`）
  - `cam=x,y,z&look=x,y,z`：覆盖渲染相机（截图用，仍显示 UI；可配合 `ui=0`）
  - `ui=0` 隐藏全部 HTML UI（纯净 3D 截图）
  - `t=<秒>` 预置环境时间（让动画进入稳定状态）
  - `quality=high|low` 强制质量档
- 语法自检：`node --check <file>`（仅 .js；.jsx 由 vite 编译）。
- 同一时间只有一个共享开发服务器。截图是独立 Chrome 进程，可并发。

**禁止**：改别人的文件；改 `src/three/layout.js`、`src/data/*`、`src/three/utils/*`、`src/App.jsx`、`src/styles.css`、`scripts/*`、`docs/*`（这些是 Lead 的契约文件）。若契约不够用，直接给 Lead 发消息。

---

## 1. 文件所有权（严格遵守，只写自己的文件）

| 成员 | 负责文件 |
| --- | --- |
| **Lead** | `src/App.jsx`、`src/main.jsx`、`src/styles.css`、`src/ui/**`、`src/three/engine.js`、`src/three/experience.js`、`src/three/park.js`、`src/three/layout.js`、`src/three/core/env.js`、`src/three/utils/**`、`src/data/**`、`scripts/**`、`docs/**`、`index.html`、`README.md` |
| **A 泉与地形** | `src/three/world/terrain.js`、`src/three/world/water.js`、`src/three/world/springs.js`、`src/three/world/koi.js`（可自建 `src/three/world/water/` 子目录） |
| **B 建筑** | `src/three/world/buildings.js` 及 `src/three/world/arch/**`（可自建子目录） |
| **C 植被小品** | `src/three/world/vegetation.js`、`src/three/world/props.js` 及 `src/three/world/plants/**` |
| **D 天气** | `src/three/world/sky.js`、`src/three/systems/weather.js`、`src/three/systems/particles.js` |
| **E 控制与导览** | `src/three/controls/walker.js`、`src/three/controls/tour.js` |

每个 world 模块只允许 import：`three`、`./layout.js`、`../layout.js`、`../core/env.js`、`../utils/*`、`../data/*`，以及**自己子目录**内的文件。跨模块协作一律通过下文的 `env` / `layout` / `colliders` / `anchors` 契约完成。

---

## 2. 世界坐标与单位

- 1 单位 = 1 米；Y 轴向上；**+X 向东，+Z 向南**（即北 = -Z）。
- 地面 y = 0（全园平坦；水底为负）。**水面 y = -0.42**（`layout.waterLevel`）。
- 公园范围：x ∈ [-114, 114]，z ∈ [-84, 84]；四周有围墙，东/北/南三门。
- 主泉池（趵突泉）为椭圆，中心 (0,0)，半径 18 × 13 米。
- 详细坐标/道路/建筑位置见 `src/three/layout.js`——**这是唯一权威布局**，不要另造一套。
- 高差：只有 `layout.heightAt(x,z)` 返回 >0 的地方（来鹤桥拱面、曲桥、亭台基座坡道）。行走和导览相机都必须使用它。

---

## 3. 环境状态 env（每帧由天气系统写入，所有模块只读）

`src/three/core/env.js`：

```js
env = {
  time, dt,                        // 秒
  sunDir: Vector3,                 // 由原点指向太阳的方向（单位向量）
  sunColor: Color, sunIntensity,   // 主光（白天太阳 / 夜晚月光复用）
  moonIntensity,                   // 月光补光强度
  ambientColor: Color, ambientIntensity,
  hemiSky: Color, hemiGround: Color, hemiIntensity,
  // 天空
  skyTop, skyHorizon, skyBottom: Color,
  cloudCover, cloudSpd, cloudTint: Color,
  starOpacity,
  // 大气
  fogColor: Color, fogDensity, exposure,
  // 天气强度 0..1
  rain, snow, wind, wetness, puddle, lightning, steam, temperature,
  // 光照阶段（天气系统算好）
  night, golden, dayFactor,        // 0..1
  focus: Vector3,                  // 玩家/相机焦点（阴影跟随）
  quality,                         // 0.5..1
}
```

**约定**：
- 天气系统（D）是 env 的**唯一写入者**；其它模块只读，不得修改灯光/雾/背景色。
- 场景灯光由 `sky.js` 创建并更新；其它模块不要加 DirectionalLight/AmbientLight。
- 天气对材质的影响请各自在 `update(dt, env)` 中处理，例如：
  - 地面/石材：`env.wetness` → 变深、粗糙度下降；`env.snow` → 逐渐泛白（用材质 color lerp，勿每帧 new Color）。
  - 树木：`env.wind` → 摇曳幅度；`env.snow` → 叶/枝积雪色。
  - 灯笼/窗纸：`env.night` → emissiveIntensity 提升。
  - 水面：`env.rain` → 雨点涟漪；`env.wind` → 波纹；`env.snow` → 边缘冰色；`env.steam` → 水汽。

---

## 4. 模块工厂契约

每个 world 模块导出一个工厂：

```js
export function createXxx(ctx) {
  const group = new THREE.Group();
  // ... 构建（一次性）
  return {
    object: group,       // 必须：挂到场景里的根（不要直接 add 到 scene）
    colliders: [],       // 可选：静态碰撞体数组，见 §5
    anchors: {},         // 可选：具名坐标 THREE.Vector3，供特效/导览使用
    update(dt, env) {},  // 可选：每帧（只在需要动画时实现）
    dispose() {},        // 可选：释放 geometry/material/texture
  };
}
```

`ctx` = `{ env, layout, heightAt(x,z), waterLevel, quality }`（`layout` 即 `layout.js` 的导出对象）。

- **对象必须挂在返回的 `object` 下**，场景由 Lead 统一挂载。
- 禁止 `requestAnimationFrame`、禁止监听 window 事件（输入由 E 负责）、禁止 `console.log`（调试完成后删除；保留 `console.warn` 汇报问题）。
- 用 `mulberry32(seed)` 做确定性随机（`src/three/utils/random.js`），保证每次截图一致。
- 材质尽量共享实例；几何要 `dispose`。
- 3D 文字/匾额：用 `src/three/utils/labels.js` 的 canvas 贴图（系统中文字体可用）。

---

## 5. 碰撞体 colliders（静态，供 E 的 walker 解析）

```js
{ type: 'circle', x, z, r, tag: 'solid' | 'water' | 'soft' }
{ type: 'ellipse', x, z, rx, rz, rot: number, tag }
{ type: 'box', x, z, hx, hz, rot: number, tag }
```

- `solid`：建筑、墙、树干、石栏、碑等实体（玩家被推开）。
- `water`：不可下水区域；**当脚下 `heightAt > waterLevel + 0.25`（如在桥上）时忽略**。
- `soft`：花木/低矮石，不阻挡或弱阻挡（walker 可忽略）。
- 水面池沿、石栏、建筑柱础、树干（r≈0.45）、围墙、假山底座都必须给碰撞体，否则玩家会穿模。
- 碰撞体总数控制 < 400（walker 每帧遍历）。

---

## 6. 天气系统（D）

- 预设数据在 `src/data/weather.js`（Lead 编写）：9 种天气 `sunny/cloudy/overcast/drizzle/storm/mist/snow/dusk/night`，每种含中文名、英文名、图标、描述、UI 强调色、以及 `targets`（env 目标值，数字或 0xRRGGBB）。
- `src/three/systems/weather.js` 导出：

```js
export function createWeather({ env, sky, particles, renderer, scene }) {
  return {
    presets, currentId, transition,       // transition 0..1 进度
    setPreset(id, { instant = false } = {}),
    next(), prev(), update(dt, env),
  };
}
```

- 切换时在 ~2.2s 内对 env 中所有数值/颜色平滑插值；`instant` 直接到位。
- 雷雨：随机闪电（写入 `env.lightning`，配合 sky 天空闪光/增亮），可听到视觉即可，无音频硬性要求。
- 阴雨雪天：`env.steam` 在泉池上方水汽（趵突泉水温常年 ~18℃，雪天"云雾润蒸"是灵魂）。
- `src/three/world/sky.js`：天空穹顶（渐变 + 太阳/月亮 + 云 + 星空）、主光（带阴影）、环境光。导览/行走时阴影相机跟随 `env.focus`（Lead 每帧写入）。
- `src/three/systems/particles.js`：雨（带速度的线/点）、雪、水汽/雾粒子、地面雨圈、夜间萤火（可选）。粒子数量按 `ctx.quality` 与设备自适应，GPU 上传要一次性（不要在 update 里重建 BufferGeometry）。
- 性能红线：整体 draw calls < 320，桌面三角面 < 900k（中端机可降级）。天空+粒子合计 draw calls < 20。

---

## 7. 控制与导览（E）

```js
export function createWalker({ camera, domElement, colliders, heightAt, spawn, waterLevel, getEnv }) {
  return {
    update(dt, env),
    setEnabled(on),
    getPosition(),              // THREE.Vector3
    getYaw(), getPitch(),
    teleport(x, z, yaw),
    setMoveInput(x, y),         // 触屏摇杆 -1..1（x 左右，y 前后）
    addLookDelta(dx, dy),       // 触屏拖动视角（像素）
    isLocked(),
    dispose(),
  };
}
```

- 键鼠：WASD/方向键移动，Shift 加速，鼠标拖动或 Pointer Lock 转视角，Space 无跳跃。
- 移动速度：步行 3.2 m/s，加速 6.0 m/s；移动带加速度与轻微头部起伏；y = `heightAt(x,z) + 1.65`。
- 碰撞：圆半径 0.4，逐帧解析 colliders（water 在桥上忽略），越界钳制在公园范围内。
- 触屏：左下虚拟摇杆由 UI 调用 `setMoveInput`；空白区域拖动调用 `addLookDelta`。
- 导览相机（tour）：

```js
export function createTour({ camera, pois, heightAt, onPoiChange }) {
  return {
    start(index = 0), stop(), next(), prev(), goTo(poiId), setPaused(v),
    update(dt, env),
    isActive, isPaused, currentPoiId, progress,   // progress 0..1
  };
}
```

- 导览沿 `src/data/pois.js` 的 `TOUR_ROUTE` 顺序：相机在相邻景点之间做**航拍式弧线运镜**（抬高、缓入缓出），到达后停留 `hold` 秒并触发 `onPoiChange(poi)`。
- 相机看的目标用平滑阻尼，避免突变；进入/退出导览要淡入淡出由 UI 负责。
- 导览中禁用 walker；退出导览时由 Lead 把玩家传送到当前景点附近（E 提供 `tour.getGroundPose()` 可选）。

---

## 8. 美术方向（统一审美）

- 中国北方古典园林 + 现代数字展陈：写意、克制、有空气感。
- 色板（`src/three/utils/palette.js`）：
  - 建筑：朱红柱 `#9e3b2e`，青灰瓦 `#4b5a63`，白墙 `#e6e2d6`，深木 `#3d2f26`，石青 `#8a938e`
  - 自然：柳绿 `#8aa65a`，竹青 `#5d7d4c`，松墨 `#3f5240`，荷粉 `#e0a3ad`，池水 `#5aa8a0`→`#2f6f72`
  - 点缀：金黄 `#c8a25e`，灯笼红 `#c0472f`
- 造型：低多边形写意 + 细部剪影（翘角、灰瓦垄、木格窗、石栏、匾额）；避免卡通大色块与过度卡通。
- 光线：晴天暖阳 + 冷调天空补光；阴雨低饱和；黄昏金色侧逆光；夜有月与暖灯笼。
- 所有文字内容用**简体中文**，风格典雅克制，请勿长段堆砌。

---

## 9. 性能与验收

1. 无 console error/warning（three 的弃用警告也要避免）。
2. 截图（默认 1600×900）在 swiftshader 下 3~5s 内可出画面，场景结构正确、无明显穿模/漂浮。
3. `node scripts/shot.mjs --url "http://127.0.0.1:5174/?poi=<你的重点区域>&cam=..."` 自查局部：亭子/桥/树/泉水要有细节，贴地、尺度正确（成人视高 1.65m）。
4. 缩放/材质不能有大面积纯色平面；远景用雾与层次收边。
5. 每个模块 `update` 内不得分配新对象（可复用的 Vector3/Color 放模块顶层）。

---

## 10. 沟通

- 进度/阻塞/契约变更请求：用 `send_message` 发给 `lead`，消息中包含**文件、现象、截图路径**。
- 完成时报告：改动的文件、自查截图路径、已知限制。
- 发现契约文件（layout/data/env）有误：**不要自己改**，立刻通知 Lead。

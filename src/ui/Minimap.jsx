import React, { useEffect, useRef } from 'react';
import { BOUNDS, WATER_SHAPES, PATHS, STRUCTURES, WALL_SEGMENTS } from '../three/layout.js';
import { POIS } from '../data/pois.js';

const B = BOUNDS;
const VIEW = { x: B.minX, y: B.minZ, w: B.maxX - B.minX, h: B.maxZ - B.minZ };

function pathD(points, closed) {
  if (!points || points.length < 2) return '';
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += `L${points[i][0].toFixed(1)},${points[i][1].toFixed(1)}`;
  }
  if (closed) d += 'Z';
  return d;
}

/**
 * 园景小地图：直接用 layout 坐标绘制 SVG 平面图。
 * 玩家/镜头的定位每帧通过 DOM 更新，不触发 React 重渲染。
 */
export default function Minimap({ activePoiId, onSelect }) {
  const playerRef = useRef(null);
  const coneRef = useRef(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const exp = window.__park;
      if (!exp) return;
      const g = playerRef.current;
      const cone = coneRef.current;
      if (!g) return;
      let x;
      let z;
      let yaw;
      if (exp.player.mode === 'tour') {
        const cam = exp.engine.camera;
        x = cam.position.x;
        z = cam.position.z;
        // 相机朝向：从四元数取 yaw
        const q = cam.quaternion;
        yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
        g.setAttribute('data-tour', '1');
      } else {
        x = exp.player.x;
        z = exp.player.z;
        yaw = exp.player.yaw;
        g.setAttribute('data-tour', '0');
      }
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      // 三角形默认朝上（-y 即北），朝向向量 (dx,dz)=(-sin,-cos)
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      const angle = (Math.atan2(dx, -dz) * 180) / Math.PI;
      g.setAttribute('transform', `translate(${x.toFixed(1)} ${z.toFixed(1)}) rotate(${angle.toFixed(1)})`);
      if (cone) {
        cone.setAttribute('transform', `translate(${x.toFixed(1)} ${z.toFixed(1)}) rotate(${angle.toFixed(1)})`);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      className="minimap-svg"
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="趵突泉公园平面图"
    >
      <defs>
        <linearGradient id="mm-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6fae9f" stopOpacity="0.62" />
          <stop offset="100%" stopColor="#3f7f79" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id="mm-glow">
          <stop offset="0%" stopColor="#c8a25e" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c8a25e" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 园区边界 */}
      <rect
        x={B.minX}
        y={B.minZ}
        width={VIEW.w}
        height={VIEW.h}
        fill="rgba(120,150,130,0.045)"
        stroke="rgba(236,229,211,0.16)"
        strokeWidth="1.2"
      />

      {/* 围墙 */}
      {WALL_SEGMENTS.map((w) => (
        <rect
          key={w.id}
          x={w.x - w.hx}
          y={w.z - w.hz}
          width={w.hx * 2}
          height={w.hz * 2}
          fill="rgba(236,229,211,0.16)"
        />
      ))}

      {/* 道路 */}
      {PATHS.map((p) => (
        <path
          key={p.id}
          d={pathD(p.points, p.closed)}
          fill="none"
          stroke="rgba(236,229,211,0.22)"
          strokeWidth={Math.max(1.6, p.width * 0.82)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {/* 水面 */}
      {WATER_SHAPES.map((s) =>
        s.kind === 'ellipse' ? (
          <ellipse
            key={s.id}
            cx={s.cx}
            cy={s.cz}
            rx={s.rx}
            ry={s.rz}
            fill="url(#mm-water)"
            stroke="rgba(196,232,222,0.32)"
            strokeWidth="0.7"
          />
        ) : (
          <path
            key={s.id}
            d={pathD(s.points)}
            fill="none"
            stroke="url(#mm-water)"
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
        )
      )}

      {/* 建筑 */}
      {STRUCTURES.map((s) => {
        if (s.type === 'compound') {
          const [x0, z0, x1, z1] = s.rect;
          return (
            <g key={s.id}>
              <rect
                x={x0}
                y={z0}
                width={x1 - x0}
                height={z1 - z0}
                fill="rgba(200,162,94,0.06)"
                stroke="rgba(200,162,94,0.42)"
                strokeWidth="0.8"
              />
              {(s.halls || []).map((h) => (
                <rect
                  key={h.id}
                  x={h.pos[0] - h.size[0] / 2}
                  y={h.pos[1] - h.size[1] / 2}
                  width={h.size[0]}
                  height={h.size[1]}
                  fill="rgba(200,162,94,0.45)"
                  transform={`rotate(${(-(h.rotY || 0) * 180) / Math.PI} ${h.pos[0]} ${h.pos[1]})`}
                />
              ))}
            </g>
          );
        }
        if (['corridor', 'archbridge', 'slabbridge', 'zigzagbridge'].includes(s.type)) {
          if (s.type === 'corridor') {
            return (
              <rect
                key={s.id}
                x={s.pos[0] - s.length / 2}
                y={s.pos[1] - s.width / 2}
                width={s.length}
                height={s.width}
                fill="rgba(200,162,94,0.3)"
              />
            );
          }
          if (s.type === 'zigzagbridge') {
            return (
              <path
                key={s.id}
                d={pathD(s.points)}
                fill="none"
                stroke="rgba(200,162,94,0.7)"
                strokeWidth={s.width * 0.9}
                strokeLinecap="round"
              />
            );
          }
          return (
            <line
              key={s.id}
              x1={s.pos[0] - Math.cos(s.rotY) * s.span * 0.5}
              y1={s.pos[1] + Math.sin(s.rotY) * s.span * 0.5}
              x2={s.pos[0] + Math.cos(s.rotY) * s.span * 0.5}
              y2={s.pos[1] - Math.sin(s.rotY) * s.span * 0.5}
              stroke="rgba(200,162,94,0.7)"
              strokeWidth={s.deckWidth * 0.85}
              strokeLinecap="round"
            />
          );
        }
        if (s.type === 'rockery') {
          return (
            <ellipse
              key={s.id}
              cx={s.pos[0]}
              cy={s.pos[1]}
              rx={s.size[0] * 0.42}
              ry={s.size[1] * 0.42}
              fill="rgba(160,168,158,0.35)"
              stroke="rgba(236,229,211,0.18)"
              strokeWidth="0.6"
            />
          );
        }
        if (s.type === 'rock') {
          return <circle key={s.id} cx={s.pos[0]} cy={s.pos[1]} r="1.6" fill="rgba(160,168,158,0.5)" />;
        }
        if (s.type === 'stele' || s.type === 'steles') {
          return <circle key={s.id} cx={s.pos[0]} cy={s.pos[1]} r="1.1" fill="rgba(200,162,94,0.65)" />;
        }
        if (!s.size) return null;
        return (
          <rect
            key={s.id}
            x={s.pos[0] - s.size[0] / 2}
            y={s.pos[1] - s.size[1] / 2}
            width={s.size[0]}
            height={s.size[1]}
            fill="rgba(200,162,94,0.5)"
            transform={`rotate(${(-(s.rotY || 0) * 180) / Math.PI} ${s.pos[0]} ${s.pos[1]})`}
          />
        );
      })}

      {/* 景点 */}
      {POIS.map((poi) => (
        <g
          key={poi.id}
          className={`mm-poi ${activePoiId === poi.id ? 'is-active' : ''}`}
          onClick={() => onSelect?.(poi)}
          role="button"
          aria-label={poi.name}
        >
          <title>{poi.name}</title>
          <circle cx={poi.pos[0]} cy={poi.pos[1]} r="5.4" fill="transparent" />
          <circle className="mm-poi-halo" cx={poi.pos[0]} cy={poi.pos[1]} r="4.2" />
          <circle className="mm-poi-dot" cx={poi.pos[0]} cy={poi.pos[1]} r="1.9" />
          {activePoiId === poi.id && (
            <text className="mm-poi-label" x={poi.pos[0] + 4} y={poi.pos[1] + 1.4}>
              {poi.name}
            </text>
          )}
        </g>
      ))}

      {/* 玩家 / 镜头 */}
      <g ref={coneRef} className="mm-cone">
        <path d="M0,0 L-7,-16 L7,-16 Z" fill="url(#mm-glow)" />
      </g>
      <g ref={playerRef} className="mm-player" data-tour="0">
        <circle r="5.4" className="mm-player-halo" />
        <path d="M0,-4.6 L3.1,3.4 L0,2.1 L-3.1,3.4 Z" className="mm-player-arrow" />
      </g>
    </svg>
  );
}

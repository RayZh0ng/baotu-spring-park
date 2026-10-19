import React, { useRef, useState } from 'react';

/**
 * 移动端虚拟摇杆：输出 x（左右）/ y（前后）到 walker.setMoveInput。
 */
export default function Joystick({ onMove }) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const pointerId = useRef(null);
  const [active, setActive] = useState(false);

  const MAX = 38;

  function updateFromEvent(e) {
    const el = baseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    const max = rect.width * 0.34;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    const nx = dx / max;
    const ny = -dy / max;
    const n = Math.hypot(nx, ny);
    if (n > 1) onMove(nx / n, ny / n);
    else onMove(nx, ny);
  }

  function onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    pointerId.current = e.pointerId;
    baseRef.current?.setPointerCapture?.(e.pointerId);
    setActive(true);
    updateFromEvent(e);
  }

  function onPointerMove(e) {
    if (pointerId.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    updateFromEvent(e);
  }

  function end(e) {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    setActive(false);
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
    onMove(0, 0);
  }

  return (
    <div className={`joystick ${active ? 'is-active' : ''}`}>
      <div
        ref={baseRef}
        className="joystick-base"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <span className="joystick-ring" />
        <span className="joystick-ring inner" />
        <div ref={knobRef} className="joystick-knob" />
      </div>
      <span className="joystick-label">行走</span>
    </div>
  );
}

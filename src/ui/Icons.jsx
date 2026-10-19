import React from 'react';

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function SunIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4.1" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </svg>
  );
}

export function CloudSunIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="8.4" cy="8.4" r="3" />
      <path d="M8.4 2.8v1.6M2.8 8.4h1.6M4.4 4.4l1.1 1.1M12.4 4.4l-1.1 1.1" />
      <path d="M8.8 18.6h8.2a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.5 1.1 3.1 3.1 0 0 0 .9 6.1z" />
    </svg>
  );
}

export function CloudIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7.4 18.4h9.4a3.7 3.7 0 0 0 .4-7.4 5.2 5.2 0 0 0-9.9 1.1 3.2 3.2 0 0 0 .1 6.3z" />
    </svg>
  );
}

export function RainIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7.4 14.6h9.4a3.6 3.6 0 0 0 .4-7.2 5.1 5.1 0 0 0-9.7 1.1 3.1 3.1 0 0 0 -.1 6.1z" />
      <path d="M8.4 17.2l-.8 2.2M12 17.2l-.8 2.2M15.6 17.2l-.8 2.2" />
    </svg>
  );
}

export function StormIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7.4 14.2h9.4a3.6 3.6 0 0 0 .3-7.2 5.1 5.1 0 0 0-9.6 1.1 3.1 3.1 0 0 0 -.1 6.1z" />
      <path d="M12.8 14.6l-2.3 3.4h2.4l-1.4 3.2 3.5-3.9h-2.3l1.6-2.7z" />
      <path d="M7.2 17.2l-.7 1.8M16.6 17.2l-.5 1.5" />
    </svg>
  );
}

export function FogIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7.6 12.4h9a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.2 1 3 3 0 0 0 -.1 5.8z" />
      <path d="M4.6 15.6h14.8M6.6 18.4h10.8M8.6 21.2h6.8" />
    </svg>
  );
}

export function SnowIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7.4 13.6h9.4a3.6 3.6 0 0 0 .4-7.2 5.1 5.1 0 0 0-9.7 1.1 3.1 3.1 0 0 0 -.1 6.1z" />
      <path d="M8.2 17.4v4.6M6.2 18.6l4 2.4M10.2 18.6l-4 2.4M15.8 17.4v4.6M13.8 18.6l4 2.4M17.8 18.6l-4 2.4" />
    </svg>
  );
}

export function DuskIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.4 17.4h17.2" />
      <path d="M6.8 17.4a5.2 5.2 0 0 1 10.4 0" />
      <path d="M12 5.4v2.2M7.2 7.6l1.5 1.5M16.8 7.6l-1.5 1.5M2.8 13.4h2.1M19.1 13.4h2.1" />
    </svg>
  );
}

export function MoonIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M19.4 14.6A8 8 0 0 1 9 4.2a8.2 8.2 0 1 0 10.4 10.4z" />
      <path d="M17.2 4.2l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" />
    </svg>
  );
}

export const WEATHER_ICONS = {
  sun: SunIcon,
  cloudsun: CloudSunIcon,
  cloud: CloudIcon,
  rain: RainIcon,
  storm: StormIcon,
  fog: FogIcon,
  snow: SnowIcon,
  dusk: DuskIcon,
  moon: MoonIcon,
};

export function CompassIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.4 8.6l-2.1 4.7-4.7 2.1 2.1-4.7z" />
    </svg>
  );
}

export function WalkIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="13.4" cy="4.8" r="1.7" />
      <path d="M12.6 8.2l-2.2 3.6 2 1.6-1.4 5.6M10.4 11.8l-2.9 1.4-1.5 3M12.4 13.4l2.4 1.5 1.2 4.1" />
    </svg>
  );
}

export function TourIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10.2 8.4l5.4 3.6-5.4 3.6z" />
    </svg>
  );
}

export function PlayIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8 5.6l10 6.4-10 6.4z" />
    </svg>
  );
}

export function PauseIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 5.4v13.2M15 5.4v13.2" />
    </svg>
  );
}

export function PrevIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M14.6 6l-6 6 6 6M19 6v12" />
    </svg>
  );
}

export function NextIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9.4 6l6 6-6 6M5 6v12" />
    </svg>
  );
}

export function CloseIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function HelpIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.8 2.2c-.8.5-1.4 1.1-1.4 2.1" />
      <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SpringIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.4 8.2c2.5-2.2 5-2.2 7.6 0s5 2.2 7.6 0M4.4 12.4c2.5-2.2 5-2.2 7.6 0s5 2.2 7.6 0M4.4 16.6c2.5-2.2 5-2.2 7.6 0s5 2.2 7.6 0" />
      <path d="M12 3.4c-1.9 2.3-3 3.8-3 5.4a3 3 0 0 0 6 0c0-1.6-1.1-3.1-3-5.4z" />
    </svg>
  );
}

export function PavilionIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.2 9.4L12 3.6l8.8 5.8M5.2 9.4h13.6M7 9.4v8M17 9.4v8M5.4 17.8h13.2M9.6 17.8v2M14.4 17.8v2" />
      <path d="M12 3.4v-1.6" />
    </svg>
  );
}

export function HallIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M2.6 8.2L12 3.4l9.4 4.8M4.4 8.2h15.2M6.4 8.2v9.4M17.6 8.2v9.4M4.2 17.6h15.6M10 17.6v2.6M14 17.6v2.6" />
      <path d="M9.2 12.4h5.6" />
    </svg>
  );
}

export function BridgeIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 16.4h18M6.2 16.4c0-3.6 2.6-6.4 5.8-6.4s5.8 2.8 5.8 6.4M3.4 16.4v2.2M20.6 16.4v2.2M3.4 13.4c1.6-1.2 3.2-1.2 4.8 0M15.8 13.4c1.6-1.2 3.2-1.2 4.8 0" />
    </svg>
  );
}

export function GateIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3.6 20.4h16.8M4.6 20.4V7.2L12 3.4l7.4 3.8v13.2M8.6 20.4v-6.2h6.8v6.2M9.4 8.6h5.2" />
    </svg>
  );
}

export function RockIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.2 18.8l2.6-7.4 3.2-4 4.4-.6 4.2 4.4 1.2 7.6z" />
      <path d="M9.2 7.8l1.8 3.2M15.6 11.2l2.4-2.2M11.4 14.6l-1.8 4.2" />
    </svg>
  );
}

export function GardenIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.4 12.2c0-4.2 3.4-7.6 7.6-7.6s7.6 3.4 7.6 7.6-3.4 7.6-7.6 7.6" />
      <path d="M12 4.6v14.8M4.4 12.2h15.2M6.6 6.6l10.8 11.2M17.4 6.6L6.6 17.8" />
    </svg>
  );
}

export function TeaIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.6 9.4h11.2v4.4a5.2 5.2 0 0 1-5.2 5.2h-.8a5.2 5.2 0 0 1-5.2-5.2z" />
      <path d="M15.8 10.6h2.2a2.6 2.6 0 0 1 0 5.2h-2.2M3.4 21.2h14.6M7.4 6.2c0-1.2 1-1.6 1-2.8M11 6.2c0-1.2 1-1.6 1-2.8" />
    </svg>
  );
}

export const CATEGORY_ICONS = {
  spring: SpringIcon,
  hall: HallIcon,
  pavilion: PavilionIcon,
  bridge: BridgeIcon,
  gate: GateIcon,
  rock: RockIcon,
  garden: GardenIcon,
  tea: TeaIcon,
};

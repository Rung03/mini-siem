// ไอคอน SVG ที่ใช้ในเมนูและการ์ด และโลโก้ลูกบาศก์ 3D

import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconDashboard = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="9" rx="2" />
    <rect x="14" y="3" width="7" height="5" rx="2" />
    <rect x="14" y="12" width="7" height="9" rx="2" />
    <rect x="3" y="16" width="7" height="5" rx="2" />
  </Svg>
);

export const IconSearch = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const IconAlert = () => (
  <Svg>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 21h4" />
  </Svg>
);

export const IconAdmin = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);

export const IconShieldCheck = () => (
  <Svg>
    <path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

export const IconShieldAlert = () => (
  <Svg>
    <path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z" />
    <path d="M12 8v5M12 16h.01" />
  </Svg>
);

export const IconActivity = () => (
  <Svg>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Svg>
);

export const IconUsers = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
  </Svg>
);

export const IconLogout = () => (
  <Svg>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 17l-5-5 5-5M5 12h11" />
  </Svg>
);

export function LogoCube({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="logo-cube">
      <defs>
        <linearGradient id="cube-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#6f63e8" />
        </linearGradient>
        <linearGradient id="cube-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f46c8" />
          <stop offset="1" stopColor="#2e2a86" />
        </linearGradient>
        <linearGradient id="cube-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b9fcf" />
          <stop offset="1" stopColor="#0e5d86" />
        </linearGradient>
      </defs>
      <path d="M32 6 56 19 32 32 8 19z" fill="url(#cube-top)" />
      <path d="M8 19 32 32v26L8 45z" fill="url(#cube-left)" />
      <path d="M56 19 32 32v26l24-13z" fill="url(#cube-right)" />
      <path d="M32 6 56 19 32 32 8 19z" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1" />
    </svg>
  );
}

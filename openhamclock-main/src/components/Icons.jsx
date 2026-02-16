/**
 * SVG Icons for OpenHamClock
 * 
 * Cross-platform icons that render identically on all browsers and operating systems.
 * Replaces emoji which render as tofu/boxes on Linux Chromium without emoji fonts.
 * 
 * All icons accept: size (default 14), color (default 'currentColor'), style, className
 */
import React from 'react';

const defaults = { size: 14, color: 'currentColor' };

// Magnifying glass / Search / Filter
export const IconSearch = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" {...props}>
    <circle cx="6.5" cy="6.5" r="4.5" />
    <line x1="10" y1="10" x2="14" y2="14" />
  </svg>
);

// Refresh / Reload
export const IconRefresh = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M13.5 2.5v4h-4" />
    <path d="M2.5 13.5v-4h4" />
    <path d="M3.5 5.5a5.5 5.5 0 0 1 9.1-1l.9.9" />
    <path d="M12.5 10.5a5.5 5.5 0 0 1-9.1 1l-.9-.9" />
  </svg>
);

// Map
export const IconMap = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M1 3.5l4.5-2 5 2.5 4.5-2v11l-4.5 2-5-2.5L1 14.5z" />
    <line x1="5.5" y1="1.5" x2="5.5" y2="12" />
    <line x1="10.5" y1="4" x2="10.5" y2="14.5" />
  </svg>
);

// Gear / Settings
export const IconGear = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5l.7 1.8a4.5 4.5 0 0 1 1.6.9l1.9-.4 1 1.7-1.2 1.4c.1.4.1.7 0 1.1l1.2 1.4-1 1.7-1.9-.4a4.5 4.5 0 0 1-1.6.9L8 14.5l-.7-1.8a4.5 4.5 0 0 1-1.6-.9l-1.9.4-1-1.7 1.2-1.4c-.1-.4-.1-.7 0-1.1L3.8 6.6l1-1.7 1.9.4a4.5 4.5 0 0 1 1.6-.9z" />
  </svg>
);

// Globe / World
export const IconGlobe = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" {...props}>
    <circle cx="8" cy="8" r="6.5" />
    <ellipse cx="8" cy="8" rx="2.8" ry="6.5" />
    <line x1="1.5" y1="8" x2="14.5" y2="8" />
  </svg>
);

// Satellite
export const IconSatellite = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="5" y="5" width="6" height="6" rx="1" transform="rotate(45 8 8)" />
    <line x1="2" y1="2" x2="4.5" y2="4.5" />
    <line x1="11.5" y1="11.5" x2="14" y2="14" />
    <path d="M3.5 6.5 A4 4 0 0 0 6.5 3.5" />
  </svg>
);

// Antenna / Radio
export const IconAntenna = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <line x1="8" y1="6" x2="8" y2="15" />
    <line x1="5" y1="15" x2="11" y2="15" />
    <path d="M4 4a5.5 5.5 0 0 1 8 0" />
    <path d="M2 2a9 9 0 0 1 12 0" />
    <circle cx="8" cy="6" r="1" fill={color} stroke="none" />
  </svg>
);

// Sun
export const IconSun = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" {...props}>
    <circle cx="8" cy="8" r="3" />
    <line x1="8" y1="1" x2="8" y2="3" />
    <line x1="8" y1="13" x2="8" y2="15" />
    <line x1="1" y1="8" x2="3" y2="8" />
    <line x1="13" y1="8" x2="15" y2="8" />
    <line x1="3.05" y1="3.05" x2="4.46" y2="4.46" />
    <line x1="11.54" y1="11.54" x2="12.95" y2="12.95" />
    <line x1="3.05" y1="12.95" x2="4.46" y2="11.54" />
    <line x1="11.54" y1="4.46" x2="12.95" y2="3.05" />
  </svg>
);

// Moon
export const IconMoon = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M13.5 8.5a6 6 0 1 1-6-6 4.5 4.5 0 0 0 6 6z" />
  </svg>
);

// Trophy / Contest
export const IconTrophy = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 2h6v5a3 3 0 0 1-6 0z" />
    <path d="M5 4H3a1.5 1.5 0 0 0 0 3h2" />
    <path d="M11 4h2a1.5 1.5 0 0 1 0 3h-2" />
    <line x1="8" y1="10" x2="8" y2="12" />
    <line x1="5.5" y1="14" x2="10.5" y2="14" />
    <line x1="6" y1="12" x2="10" y2="12" />
  </svg>
);

// Tent / POTA / Camping
export const IconTent = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M8 2L1.5 14h13z" />
    <path d="M8 2v12" />
    <path d="M6 14l2-5 2 5" />
  </svg>
);

// Earth / DXpedition
export const IconEarth = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" {...props}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M1.5 6h13M1.5 10h13" />
    <ellipse cx="8" cy="8" rx="3" ry="6.5" />
  </svg>
);

// Pin / Location
export const IconPin = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6c0 3.5 4.5 8.5 4.5 8.5s4.5-5 4.5-8.5A4.5 4.5 0 0 0 8 1.5z" />
    <circle cx="8" cy="6" r="1.5" />
  </svg>
);

// Tag / Label
export const IconTag = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M1.5 1.5h6l7 7-6 6-7-7z" />
    <circle cx="5" cy="5" r="1" fill={color} stroke="none" />
  </svg>
);

// Fullscreen expand
export const IconExpand = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polyline points="10,1 15,1 15,6" />
    <polyline points="6,15 1,15 1,10" />
    <line x1="15" y1="1" x2="9.5" y2="6.5" />
    <line x1="1" y1="15" x2="6.5" y2="9.5" />
  </svg>
);

// Fullscreen shrink
export const IconShrink = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polyline points="5,10 0,15" />
    <polyline points="11,6 16,1" />
    <polyline points="6,11 6,15 2,15" />
    <polyline points="10,5 10,1 14,1" />
  </svg>
);

export default {
  IconSearch, IconRefresh, IconMap, IconGear, IconGlobe, IconSatellite,
  IconAntenna, IconSun, IconMoon, IconTrophy, IconTent, IconEarth,
  IconPin, IconTag, IconExpand, IconShrink,
};

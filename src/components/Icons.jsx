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
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    {...props}
  >
    <circle cx="6.5" cy="6.5" r="4.5" />
    <line x1="10" y1="10" x2="14" y2="14" />
  </svg>
);

// Refresh / Reload
export const IconRefresh = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M13.5 2.5v4h-4" />
    <path d="M2.5 13.5v-4h4" />
    <path d="M3.5 5.5a5.5 5.5 0 0 1 9.1-1l.9.9" />
    <path d="M12.5 10.5a5.5 5.5 0 0 1-9.1 1l-.9-.9" />
  </svg>
);

// Map
export const IconMap = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M1 3.5l4.5-2 5 2.5 4.5-2v11l-4.5 2-5-2.5L1 14.5z" />
    <line x1="5.5" y1="1.5" x2="5.5" y2="12" />
    <line x1="10.5" y1="4" x2="10.5" y2="14.5" />
  </svg>
);

// Gear / Settings
export const IconGear = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5l.7 1.8a4.5 4.5 0 0 1 1.6.9l1.9-.4 1 1.7-1.2 1.4c.1.4.1.7 0 1.1l1.2 1.4-1 1.7-1.9-.4a4.5 4.5 0 0 1-1.6.9L8 14.5l-.7-1.8a4.5 4.5 0 0 1-1.6-.9l-1.9.4-1-1.7 1.2-1.4c-.1-.4-.1-.7 0-1.1L3.8 6.6l1-1.7 1.9.4a4.5 4.5 0 0 1 1.6-.9z" />
  </svg>
);

// Globe / World
export const IconGlobe = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    {...props}
  >
    <circle cx="8" cy="8" r="6.5" />
    <ellipse cx="8" cy="8" rx="2.8" ry="6.5" />
    <line x1="1.5" y1="8" x2="14.5" y2="8" />
  </svg>
);

// Satellite
export const IconSatellite = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="5" y="5" width="6" height="6" rx="1" transform="rotate(45 8 8)" />
    <line x1="2" y1="2" x2="4.5" y2="4.5" />
    <line x1="11.5" y1="11.5" x2="14" y2="14" />
    <path d="M3.5 6.5 A4 4 0 0 0 6.5 3.5" />
  </svg>
);

// Antenna / Radio
export const IconAntenna = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <line x1="8" y1="6" x2="8" y2="15" />
    <line x1="5" y1="15" x2="11" y2="15" />
    <path d="M4 4a5.5 5.5 0 0 1 8 0" />
    <path d="M2 2a9 9 0 0 1 12 0" />
    <circle cx="8" cy="6" r="1" fill={color} stroke="none" />
  </svg>
);

// Sun
export const IconSun = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    {...props}
  >
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
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M13.5 8.5a6 6 0 1 1-6-6 4.5 4.5 0 0 0 6 6z" />
  </svg>
);

// Trophy / Contest
export const IconTrophy = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
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
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M8 2L1.5 14h13z" />
    <path d="M8 2v12" />
    <path d="M6 14l2-5 2 5" />
  </svg>
);

// Earth / DXpedition
export const IconEarth = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    {...props}
  >
    <circle cx="8" cy="8" r="6.5" />
    <path d="M1.5 6h13M1.5 10h13" />
    <ellipse cx="8" cy="8" rx="3" ry="6.5" />
  </svg>
);

// Pin / Location
export const IconPin = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6c0 3.5 4.5 8.5 4.5 8.5s4.5-5 4.5-8.5A4.5 4.5 0 0 0 8 1.5z" />
    <circle cx="8" cy="6" r="1.5" />
  </svg>
);

// Tag / Label
export const IconTag = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M1.5 1.5h6l7 7-6 6-7-7z" />
    <circle cx="5" cy="5" r="1" fill={color} stroke="none" />
  </svg>
);

// Fullscreen expand
export const IconExpand = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <polyline points="10,1 15,1 15,6" />
    <polyline points="6,15 1,15 1,10" />
    <line x1="15" y1="1" x2="9.5" y2="6.5" />
    <line x1="1" y1="15" x2="6.5" y2="9.5" />
  </svg>
);

// Trash / Clear
export const IconTrash = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M2.5 4h11" />
    <path d="M6 4V2.5h4V4" />
    <path d="M3.5 4l.8 9.5a1 1 0 0 0 1 .9h5.4a1 1 0 0 0 1-.9L12.5 4" />
    <line x1="6.5" y1="7" x2="6.5" y2="12" />
    <line x1="9.5" y1="7" x2="9.5" y2="12" />
  </svg>
);

// Fullscreen shrink
export const IconShrink = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <polyline points="5,10 0,15" />
    <polyline points="11,6 16,1" />
    <polyline points="6,11 6,15 2,15" />
    <polyline points="10,5 10,1 14,1" />
  </svg>
);

// External link (arrow pointing up-right)
export const IconExternalLink = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M6 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" strokeDasharray="0" />
    <polyline points="8 5 12 5 12 9" />
    <line x1="9" y1="12" x2="14" y2="7" />
  </svg>
);

// ── QTH / Home icon ────────────────────────────────────────────────
// House with radio antenna on roof — for QTH with signal
export const IconQth = ({ size = defaults.size, color = defaults.color, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {/* House body */}
    <path d="M2 8.5l6-5.5L14 8.5V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    {/* Door */}
    <path d="M6 15v-4h4v4" />
    {/* Antenna */}
    <line x1="10" y1="3" x2="10" y2="1" />
    {/* Signal arcs */}
    <path d="M11.5 2a3 3 0 0 1 0 2.5" />
    <path d="M13 1a5 5 0 0 1 0 4.5" />
  </svg>
);

/* ────────────────────────────────────────────────────────────────────
 * Line-icon set — the chrome icon redesign.
 *
 * Stroke-based icons on a single 24×24 grid, 1.65px stroke, round
 * caps/joins, `currentColor`. Approved sizing: 20px in lists/pickers/
 * tabs, 22px in square control buttons. These replace emoji in the app
 * CHROME only (panel picker, dockable tabs, settings tabs, sidebar,
 * map/globe control clusters, tabset toolbar). Emoji stay as data in
 * panelDefs (WhatsNew, docs, and the plugin contract reference them),
 * and plugin panels keep rendering their emoji string — that fallback
 * is the documented contract (see PanelIcon below).
 * ──────────────────────────────────────────────────────────────────── */

// Wrapper: one svg shell shared by every 24-grid glyph.
const Icon24 = ({ size = 20, strokeWidth = 1.65, children, ...props }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {children}
  </svg>
);

const glyph = (children) => {
  const Cmp = (props) => <Icon24 {...props}>{children}</Icon24>;
  return Cmp;
};

// ── Approved mockup glyphs (geometry is owner-approved — do not tweak) ──
export const LiBook = glyph(
  <>
    <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z" transform="translate(1,-1.5) scale(.85)" />
    <path d="M5 3.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 0-3 2.5V3.5z" />
    <line x1="8.5" y1="8" x2="14.5" y2="8" />
  </>,
);
export const LiAward = glyph(
  <>
    <circle cx="12" cy="9" r="5" />
    <path d="M9 13.5 7.5 21l4.5-2.5L16.5 21 15 13.5" />
  </>,
);
export const LiFreq = glyph(
  <>
    <line x1="12" y1="21" x2="12" y2="9.5" />
    <circle cx="12" cy="7.8" r="1.6" />
    <path d="M8.6 11.4a5.2 5.2 0 0 1 0-7.2M15.4 4.2a5.2 5.2 0 0 1 0 7.2" />
    <path d="M5.8 14.2a9.2 9.2 0 0 1 0-12.8M18.2 1.4a9.2 9.2 0 0 1 0 12.8" />
  </>,
);
export const LiClock = glyph(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);
export const LiSearch = glyph(
  <>
    <circle cx="10.5" cy="10.5" r="6" />
    <line x1="15" y1="15" x2="20" y2="20" />
  </>,
);
export const LiNews = glyph(
  <>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <line x1="7.5" y1="9.5" x2="16.5" y2="9.5" />
    <line x1="7.5" y1="13" x2="16.5" y2="13" />
    <line x1="7.5" y1="16.5" x2="12.5" y2="16.5" />
  </>,
);
export const LiCycle = glyph(
  <>
    <polyline points="4,17 8,10 12,14 16,6 20,11" />
    <line x1="4" y1="20" x2="20" y2="20" />
  </>,
);
export const LiBars = glyph(
  <>
    <line x1="6" y1="20" x2="6" y2="12" />
    <line x1="11" y1="20" x2="11" y2="6" />
    <line x1="16" y1="20" x2="16" y2="15" />
    <line x1="21" y1="20" x2="21" y2="9" />
    <line x1="3" y1="20" x2="21" y2="20" />
  </>,
);
export const LiSked = glyph(
  <>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <line x1="4" y1="10" x2="20" y2="10" />
    <line x1="9" y1="3.5" x2="9" y2="6.5" />
    <line x1="15" y1="3.5" x2="15" y2="6.5" />
    <circle cx="14.5" cy="15" r="2.6" />
    <path d="M14.5 13.6v1.4l1 .8" />
  </>,
);
export const LiIono = glyph(
  <>
    <path d="M4 20a8 8 0 0 1 16 0" />
    <path d="M8 20a4 4 0 0 1 8 0" />
    <line x1="12" y1="20" x2="12" y2="13" />
    <circle cx="12" cy="11.5" r="1.4" />
  </>,
);
export const LiTarget = glyph(
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r=".8" />
  </>,
);
export const LiContest = glyph(
  <>
    <path d="M6 4h12v3a6 6 0 0 1-12 0z" />
    <path d="M6 5H4a3 3 0 0 0 3 4M18 5h2a3 3 0 0 1-3 4" />
    <line x1="12" y1="13" x2="12" y2="17" />
    <line x1="8.5" y1="20" x2="15.5" y2="20" />
    <line x1="12" y1="17" x2="12" y2="20" />
  </>,
);
export const LiLeaf = glyph(
  <>
    <path d="M12 3.5l1.6 3.1 2.6-1-.6 2.9 3.9 2.8-2.1 1 1.4 3.2-3.6-.6-.5 2.6-2.7-2-2.7 2-.5-2.6-3.6.6 1.4-3.2-2.1-1 3.9-2.8-.6-2.9 2.6 1z" />
    <line x1="12" y1="16.5" x2="12" y2="21" />
  </>,
);
export const LiSat = glyph(
  <>
    <g transform="rotate(45 12 12)">
      <rect x="9.1" y="9.1" width="5.8" height="5.8" rx="1" />
      <rect x="9.6" y="2.2" width="4.8" height="4.4" rx="1" />
      <rect x="9.6" y="17.4" width="4.8" height="4.4" rx="1" />
      <line x1="12" y1="6.9" x2="12" y2="9.1" />
      <line x1="12" y1="14.9" x2="12" y2="17.1" />
    </g>
    <path d="M17.8 3.2a7.6 7.6 0 0 1 3 3" />
  </>,
);
export const LiZap = glyph(<path d="M13 3 5 13.5h5L11 21l8-10.5h-5z" />);
export const LiComet = glyph(
  <>
    <circle cx="7.5" cy="16.5" r="3.2" />
    <path d="M10.5 13.5 20 4M13.5 15 19 9.5M12 12l4-4" />
  </>,
);
export const LiActivity = glyph(<polyline points="3,12 7.5,12 10,6 14,18 16.5,12 21,12" />);
export const LiImage = glyph(
  <>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l5-4 4 3 3.5-2.5L20 16" />
  </>,
);
export const LiHelp = glyph(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.8c-.8.35-1 .95-1 1.7" />
    <circle cx="12" cy="16.8" r=".5" />
  </>,
);
export const LiEyeOff = glyph(
  <>
    <path d="M4 4l16 16" />
    <path d="M9.9 5.6A9.4 9.4 0 0 1 12 5.4c5 0 8.5 4.2 9.5 6.6-.35.85-1.1 2.1-2.25 3.3M6.6 6.9C4.6 8.2 3.2 10.2 2.5 12c1 2.4 4.5 6.6 9.5 6.6 1.3 0 2.5-.28 3.6-.74" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </>,
);
export const LiEye = glyph(
  <>
    <path d="M2.5 12C3.5 9.6 7 5.4 12 5.4s8.5 4.2 9.5 6.6c-1 2.4-4.5 6.6-9.5 6.6S3.5 14.4 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const LiLock = glyph(
  <>
    <rect x="6" y="11" width="12" height="9" rx="2" />
    <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </>,
);
export const LiLayers = glyph(
  <>
    <path d="M12 3.5 21 8.5 12 13.5 3 8.5z" />
    <path d="M4.5 12.5 12 16.7l7.5-4.2" />
    <path d="M4.5 16.2 12 20.4l7.5-4.2" />
  </>,
);
export const LiRotate = glyph(
  <>
    <path d="M4.5 9a8 8 0 0 1 14.8-1.5M19.5 15a8 8 0 0 1-14.8 1.5" />
    <polyline points="19.6,3.6 19.6,7.8 15.4,7.8" />
    <polyline points="4.4,20.4 4.4,16.2 8.6,16.2" />
  </>,
);
export const LiHome = glyph(<path d="M4.5 10.5 12 4l7.5 6.5V20h-5.2v-5h-4.6v5H4.5z" />);
export const LiPlus = glyph(
  <>
    <line x1="12" y1="5.5" x2="12" y2="18.5" />
    <line x1="5.5" y1="12" x2="18.5" y2="12" />
  </>,
);

// ── Companion glyphs drawn for panels the mockup didn't cover ──
// Same grid, same stroke rules, a few primitives each.
export const LiMinus = glyph(<line x1="5.5" y1="12" x2="18.5" y2="12" />);
export const LiUnlock = glyph(
  <>
    <rect x="6" y="11" width="12" height="9" rx="2" />
    <path d="M8.5 11V8a3.5 3.5 0 0 1 6.9-.9" />
  </>,
);
export const LiMapFold = glyph(
  <>
    <path d="M4 5.5 9.3 3.5l5.4 2 5.3-2v15l-5.3 2-5.4-2-5.3 2z" />
    <line x1="9.3" y1="3.5" x2="9.3" y2="18.5" />
    <line x1="14.7" y1="5.5" x2="14.7" y2="20.5" />
  </>,
);
export const LiPin = glyph(
  <>
    <path d="M12 21s-6.5-6.6-6.5-11a6.5 6.5 0 0 1 13 0c0 4.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.2" />
  </>,
);
export const LiSun = glyph(
  <>
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2.5" x2="12" y2="4.8" />
    <line x1="12" y1="19.2" x2="12" y2="21.5" />
    <line x1="2.5" y1="12" x2="4.8" y2="12" />
    <line x1="19.2" y1="12" x2="21.5" y2="12" />
    <line x1="5.3" y1="5.3" x2="6.9" y2="6.9" />
    <line x1="17.1" y1="17.1" x2="18.7" y2="18.7" />
    <line x1="5.3" y1="18.7" x2="6.9" y2="17.1" />
    <line x1="17.1" y1="6.9" x2="18.7" y2="5.3" />
  </>,
);
export const LiMoon = glyph(<path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5z" />);
export const LiHop = glyph(
  <>
    <path d="M3.5 19.5c1.2-6.5 4.8-10 8.5-10s7.3 3.5 8.5 10" />
    <line x1="5" y1="4.5" x2="19" y2="4.5" strokeDasharray="2.5 3" />
  </>,
);
export const LiSignal = glyph(
  <>
    <line x1="4.5" y1="19.5" x2="4.5" y2="16" />
    <line x1="9.5" y1="19.5" x2="9.5" y2="13" />
    <line x1="14.5" y1="19.5" x2="14.5" y2="9.5" />
    <line x1="19.5" y1="19.5" x2="19.5" y2="5.5" />
  </>,
);
export const LiFlame = glyph(
  <path d="M12 3.5c2.2 2.8 5.5 5.6 5.5 9.5a5.5 5.5 0 0 1-11 0c0-1.6.6-3.1 1.6-4.6.5 1 1.2 1.9 2.2 2.6C9.7 8.3 10.6 5.8 12 3.5z" />,
);
export const LiNodes = glyph(
  <>
    <circle cx="12" cy="5.8" r="2.3" />
    <circle cx="5.8" cy="17.8" r="2.3" />
    <circle cx="18.2" cy="17.8" r="2.3" />
    <line x1="10.9" y1="7.8" x2="6.9" y2="15.8" />
    <line x1="13.1" y1="7.8" x2="17.1" y2="15.8" />
    <line x1="8.1" y1="17.8" x2="15.9" y2="17.8" />
  </>,
);
export const LiLink = glyph(
  <>
    <path d="M10.5 13.5a4 4 0 0 0 6 .4l2.5-2.5a4 4 0 0 0-5.7-5.7l-1.4 1.4" />
    <path d="M13.5 10.5a4 4 0 0 0-6-.4l-2.5 2.5a4 4 0 0 0 5.7 5.7l1.4-1.4" />
  </>,
);
export const LiTriangle = glyph(<path d="M12 4.5 20.2 19.5H3.8z" />);
export const LiTriangleDown = glyph(<path d="M3.8 4.5h16.4L12 19.5z" />);
export const LiDiamond = glyph(<path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />);
export const LiSquare = glyph(<rect x="5" y="5" width="14" height="14" rx="1.5" />);
export const LiCompass = glyph(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M15.5 8.5l-2.2 5-4.8 2 2.2-5z" />
  </>,
);
export const LiCloud = glyph(<path d="M17.5 18.5H7a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17.2 9.6a4.5 4.5 0 0 1 .3 8.9z" />);
export const LiRadio = glyph(
  <>
    <rect x="3.5" y="9.5" width="17" height="10" rx="2" />
    <line x1="7" y1="9.5" x2="17.5" y2="4.5" />
    <circle cx="8.6" cy="14.5" r="2.1" />
    <line x1="13.5" y1="13" x2="17.4" y2="13" />
    <line x1="13.5" y1="16" x2="17.4" y2="16" />
  </>,
);
export const LiTimer = glyph(
  <>
    <circle cx="12" cy="13.5" r="7" />
    <line x1="12" y1="13.5" x2="12" y2="10" />
    <line x1="9.8" y1="3.5" x2="14.2" y2="3.5" />
    <line x1="12" y1="3.5" x2="12" y2="6.5" />
  </>,
);
export const LiKeyboard = glyph(
  <>
    <rect x="3" y="7" width="18" height="11" rx="2" />
    <line x1="6.5" y1="10.5" x2="6.6" y2="10.5" />
    <line x1="10" y1="10.5" x2="10.1" y2="10.5" />
    <line x1="13.5" y1="10.5" x2="13.6" y2="10.5" />
    <line x1="17" y1="10.5" x2="17.1" y2="10.5" />
    <line x1="8.5" y1="14.5" x2="15.5" y2="14.5" />
  </>,
);
// Terminal window — Cluster Console panel (raw telnet session text)
export const LiTerminal = glyph(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 9.5 10 12l-3 2.5" />
    <line x1="12" y1="15" x2="17" y2="15" />
  </>,
);
export const LiMail = glyph(
  <>
    <rect x="3.5" y="6" width="17" height="13" rx="2" />
    <path d="M4.5 7.5 12 13.5l7.5-6" />
  </>,
);
export const LiGlobeAlt = glyph(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <ellipse cx="12" cy="12" rx="3.8" ry="8.5" />
    <line x1="3.5" y1="12" x2="20.5" y2="12" />
  </>,
);
export const LiPlug = glyph(
  <>
    <path d="M8.5 7.5h7V11a3.5 3.5 0 0 1-7 0z" />
    <line x1="10" y1="7.5" x2="10" y2="4" />
    <line x1="14" y1="7.5" x2="14" y2="4" />
    <line x1="12" y1="14.5" x2="12" y2="20" />
  </>,
);
export const LiSliders = glyph(
  <>
    <line x1="4" y1="6" x2="20" y2="6" />
    <circle cx="9" cy="6" r="2" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <circle cx="15" cy="12" r="2" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="11" cy="18" r="2" />
  </>,
);
export const LiUser = glyph(
  <>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </>,
);
export const LiBell = glyph(
  <>
    <path d="M12 4a5 5 0 0 0-5 5v3.8L5.5 16h13L17 12.8V9a5 5 0 0 0-5-5z" />
    <path d="M10.3 19a1.8 1.8 0 0 0 3.4 0" />
  </>,
);
export const LiOnAir = glyph(
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
  </>,
);

export const LiSatPass = glyph(
  <>
    <line x1="3" y1="18.5" x2="21" y2="18.5" />
    <path d="M4.5 18.5a8.5 8.5 0 0 1 15 0" />
    <circle cx="12" cy="10" r="1.6" />
    <line x1="12" y1="5.5" x2="12" y2="8.4" />
  </>,
);
export const LiSatCheck = glyph(
  <>
    <ellipse cx="12" cy="10" rx="8.5" ry="3.6" />
    <circle cx="12" cy="6.4" r="1.5" />
    <polyline points="8.5,16.5 11,19 15.5,14.5" />
  </>,
);
export const LiSunMoon = glyph(
  <>
    <circle cx="8.5" cy="12" r="3.2" />
    <path d="M8.5 5.5v1.8M8.5 16.7v1.8M2.5 12h1.8M4 7.5l1.3 1.3M4 16.5l1.3-1.3" />
    <path d="M16 6.5a6.2 6.2 0 1 0 5.5 9.2 7 7 0 0 1-5.5-9.2z" />
  </>,
);
// Planners (P4): gray-line sunrise over a horizon, moon with a timeline, satellite over DE/DX
export const LiGraylinePlan = glyph(
  <>
    <line x1="3" y1="15.5" x2="21" y2="15.5" />
    <path d="M7 15.5a5 5 0 0 1 10 0" />
    <path d="M12 5.5v2M5.5 8.5l1.4 1.4M18.5 8.5l-1.4 1.4" />
    <line x1="4" y1="19.5" x2="20" y2="19.5" strokeDasharray="2 2" />
  </>,
);
export const LiEmePlan = glyph(
  <>
    <path d="M15 4a6 6 0 1 0 5.5 8.5A6.8 6.8 0 0 1 15 4z" />
    <polyline points="3,19 6,13 9,17 12,10 15,16" />
  </>,
);
export const LiSatPlan = glyph(
  <>
    <circle cx="12" cy="8" r="1.8" />
    <path d="M6.5 8h3.7M13.8 8h3.7" />
    <polyline points="3,20 7,13 11,18 15,12 19,17 21,15" />
  </>,
);
export const LiTrendWave = glyph(
  <>
    <polyline points="3,7.5 7,12 10,9 14.5,16.5 17.5,13 21,16" />
    <polyline points="21,11.5 21,16 16.5,16" />
  </>,
);
export const LiHeardBy = glyph(
  <>
    <line x1="12" y1="21" x2="12" y2="11" />
    <circle cx="12" cy="8.6" r="1.7" />
    <path d="M6.5 4.5a8.2 8.2 0 0 0 0 8.2M17.5 4.5a8.2 8.2 0 0 1 0 8.2" />
    <path d="M9 6.2a4.4 4.4 0 0 0 0 4.8M15 6.2a4.4 4.4 0 0 1 0 4.8" />
  </>,
);
export const LiRipple = glyph(
  <>
    <circle cx="5" cy="19" r="1.3" fill="currentColor" stroke="none" />
    <path d="M5 13.8a5.2 5.2 0 0 1 5.2 5.2" />
    <path d="M5 9.2a9.8 9.8 0 0 1 9.8 9.8" />
    <path d="M5 4.6a14.4 14.4 0 0 1 14.4 14.4" />
  </>,
);
export const LiTriangleSpot = glyph(
  <>
    <path d="M10 6.5 17 19H3z" />
    <line x1="19" y1="4" x2="19" y2="8.5" />
    <line x1="16.7" y1="6.2" x2="21.3" y2="6.2" />
  </>,
);
export const LiTower = glyph(
  <>
    <path d="M9 21 12 6.5 15 21" />
    <line x1="10.2" y1="14" x2="13.8" y2="14" />
    <line x1="9.5" y1="18" x2="14.5" y2="18" />
    <circle cx="12" cy="5" r="1.3" />
    <path d="M8.2 3.4a6 6 0 0 1 7.6 0" />
  </>,
);
export const LiGlobeClock = glyph(
  <>
    <circle cx="10" cy="10.5" r="6.8" />
    <path d="M3.2 10.5h13.6M10 3.7a10.5 10.5 0 0 1 0 13.6M10 3.7a10.5 10.5 0 0 0 0 13.6" />
    <circle cx="17.6" cy="17.6" r="4" />
    <path d="M17.6 15.9v1.7l1.3 1" />
  </>,
);
export const LiPlane = glyph(
  <path d="M12 2.8 13 9l7.5 4v2L13 13v4.6l2.2 1.9V21L12 20l-3.2 1v-1.5L11 17.6V13l-7.5 2v-2L11 9z" />,
);
export const LiStopwatch = glyph(
  <>
    <circle cx="12" cy="13.5" r="7" />
    <line x1="12" y1="13.5" x2="12" y2="9.7" />
    <line x1="9.8" y1="3.5" x2="14.2" y2="3.5" />
    <line x1="12" y1="3.5" x2="12" y2="6.5" />
  </>,
);
// Net Control: a desk microphone
export const LiMic = glyph(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0" />
    <line x1="12" y1="17" x2="12" y2="20.5" />
    <line x1="8.5" y1="20.5" x2="15.5" y2="20.5" />
  </>,
);
// Rover: a car on a grid line
export const LiRover = glyph(
  <>
    <path d="M4 15.5 5.5 10.5h13l1.5 5" />
    <rect x="3" y="15.5" width="18" height="3.5" rx="1" />
    <circle cx="7.5" cy="19.5" r="1.6" />
    <circle cx="16.5" cy="19.5" r="1.6" />
    <line x1="2" y1="7" x2="22" y2="7" strokeDasharray="2 2" />
  </>,
);
// Environment sensors: thermometer
export const LiThermometer = glyph(
  <>
    <path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" />
    <line x1="12" y1="9" x2="12" y2="16" />
    <circle cx="12" cy="17" r="1.2" />
  </>,
);

// Horseshoe magnet — Dst (ring current)
export const LiMagnet = glyph(
  <>
    <path d="M6 4v8a6 6 0 0 0 12 0V4" />
    <line x1="6" y1="8" x2="9.5" y2="8" />
    <line x1="14.5" y1="8" x2="18" y2="8" />
    <line x1="9.5" y1="4" x2="9.5" y2="12" />
    <line x1="14.5" y1="4" x2="14.5" y2="12" />
  </>,
);
// Partially covered disk — eclipse
export const LiEclipse = glyph(
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16 6 6 0 0 0 0-16z" fill="currentColor" stroke="none" />
  </>,
);
// Ringed planet
export const LiPlanet = glyph(
  <>
    <circle cx="12" cy="12" r="5" />
    <path d="M3.5 15.5c3-1 8.5-3.5 12.5-6.5s6-5.5 4.5-6.5-7 .5-11 3.5-8 7-6 9.5z" />
  </>,
);
// Rocket — space launches
export const LiRocket = glyph(
  <>
    <path d="M12 3c3 2.5 4.5 6 4.5 10l-1.5 3h-6L7.5 13C7.5 9 9 5.5 12 3z" />
    <circle cx="12" cy="10.5" r="1.5" />
    <path d="M7.5 13 5 16.5h3M16.5 13 19 16.5h-3M10.5 16v4l1.5-1.5 1.5 1.5v-4" />
  </>,
);

// Weather, marine and hazards panels (v26.11)
export const LiCyclone = glyph(
  <>
    <circle cx="12" cy="12" r="2.6" />
    <path d="M12 9.4c0-3.4 2.4-5.6 5.6-6.2" />
    <path d="M14.6 12c3.4 0 5.6 2.4 6.2 5.6" />
    <path d="M12 14.6c0 3.4-2.4 5.6-5.6 6.2" />
    <path d="M9.4 12c-3.4 0-5.6-2.4-6.2-5.6" />
  </>,
);
export const LiFlag = glyph(
  <>
    <line x1="5" y1="21" x2="5" y2="3" />
    <path d="M5 4h12l-2.5 4 2.5 4H5" />
  </>,
);
export const LiBuoy = glyph(
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="4" x2="12" y2="9" />
    <line x1="12" y1="15" x2="12" y2="20" />
    <line x1="4" y1="12" x2="9" y2="12" />
    <line x1="15" y1="12" x2="20" y2="12" />
  </>,
);
export const LiWind = glyph(
  <>
    <path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5" />
    <path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5" />
    <path d="M3 16h8a2 2 0 1 1-2 2" />
  </>,
);
export const LiFax = glyph(
  <>
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <path d="M7 7V4h10v3" />
    <line x1="7" y1="12" x2="17" y2="12" />
    <line x1="7" y1="15" x2="13" y2="15" />
  </>,
);

/**
 * PANEL_ICONS — panel id → line-icon component.
 *
 * Covers every built-in id in src/panelDefs.js (including the
 * conditional `rotator` and `ambient` entries). Plugin panel ids are
 * deliberately absent: plugins keep their emoji string (documented
 * contract) via the PanelIcon fallback below.
 */
// Balloon on a string — HAB / pico-balloon panel and layer
export const LiBalloon = glyph(
  <>
    <path d="M12 3.5a5.5 6.5 0 0 1 5.5 6.5c0 3.6-3 6.5-5.5 7.5-2.5-1-5.5-3.9-5.5-7.5A5.5 6.5 0 0 1 12 3.5z" />
    <path d="M11 17.5h2l-.6 1.3h-.8z" />
    <path d="M12 18.8c-.8 1 .8 1.6 0 2.7" />
  </>,
);
export const LiClipboard = glyph(
  <>
    <rect x="5" y="4.5" width="14" height="17" rx="2" />
    <path d="M9 4.5V3h6v1.5" />
    <line x1="8.5" y1="10" x2="15.5" y2="10" />
    <line x1="8.5" y1="13.5" x2="15.5" y2="13.5" />
    <line x1="8.5" y1="17" x2="12.5" y2="17" />
  </>,
);

export const LiHeadphones = glyph(
  <>
    <path d="M4.5 15.5V12a7.5 7.5 0 0 1 15 0v3.5" />
    <rect x="3.5" y="14" width="4" height="6.5" rx="1.5" />
    <rect x="16.5" y="14" width="4" height="6.5" rx="1.5" />
  </>,
);

export const PANEL_ICONS = {
  'world-map': LiMapFold,
  'map-list-view': LiEye,
  'de-location': LiPin,
  'dx-location': LiTarget,
  'analog-clock': LiClock,
  solar: LiSun,
  'solar-image': LiSun,
  'solar-indices': LiBars,
  'solar-xray': LiZap,
  lunar: LiMoon,
  propagation: LiHop,
  'propagation-chart': LiCycle,
  'propagation-bars': LiBars,
  'band-conditions': LiSignal,
  'band-health': LiSignal,
  'band-activity': LiFlame,
  'psk-bands': LiSignal,
  ibp: LiFreq,
  'sked-planner': LiSked,
  ionosonde: LiIono,
  'prop-verify': LiTarget,
  'dx-cluster': LiNodes,
  logbook: LiBook,
  awards: LiAward,
  'psk-reporter': LiActivity,
  dxpeditions: LiGlobeAlt,
  pota: LiTriangle,
  wwff: LiTriangleDown,
  sota: LiDiamond,
  wwbota: LiSquare,
  aprs: LiPin,
  'aprs-telemetry': LiActivity,
  rotator: LiCompass,
  contests: LiContest,
  'swpc-alerts': LiZap,
  'meteor-showers': LiComet,
  ambient: LiCloud,
  'rig-control': LiRadio,
  'freq-memories': LiFreq,
  'net-schedule': LiClock,
  'net-control': LiMic,
  'callsign-search': LiSearch,
  'dx-news': LiNews,
  'solar-cycle': LiCycle,
  'log-stats': LiBars,
  'on-air': LiOnAir,
  'id-timer': LiTimer,
  image: LiImage,
  keybindings: LiKeyboard,
  meshtastic: LiNodes,
  meshcom: LiLink,
  'digital-modes': LiActivity,
  decoder: LiHeadphones,
  winlink: LiMail,
  'sat-passes': LiSatPass,
  'amsat-status': LiSatCheck,
  'sun-moon': LiSunMoon,
  'swpc-trends': LiTrendWave,
  'rbn-mine': LiHeardBy,
  'wspr-mine': LiRipple,
  'pota-activator': LiTriangleSpot,
  repeaters: LiTower,
  'world-clocks': LiGlobeClock,
  stopwatch: LiStopwatch,
  'aircraft-nearby': LiPlane,
  'grayline-planner': LiGraylinePlan,
  'eme-planner': LiEmePlan,
  'sat-planner': LiSatPlan,
  'cluster-console': LiTerminal,
  rover: LiRover,
  'env-sensors': LiThermometer,
  opportunities: LiTarget,
  'solar-outlook': LiCycle,
  benchmark: LiHeardBy,
  'noaa-scales': LiSignal,
  dst: LiMagnet,
  eclipse: LiEclipse,
  planets: LiPlanet,
  'space-launches': LiRocket,
  tropical: LiCyclone,
  'fire-weather': LiFlag,
  marine: LiBuoy,
  windy: LiWind,
  wefax: LiFax,
  hamalert: LiBell,
  balloons: LiBalloon,
  'ics-forms': LiClipboard,
};

/**
 * SETTINGS_TAB_ICONS — settings tab id → line-icon component.
 * Shared by SettingsPanel's tab strip and SidebarMenu's MENU_ITEMS.
 */
export const SETTINGS_TAB_ICONS = {
  station: LiHome,
  integrations: LiPlug,
  display: LiSliders,
  layers: LiLayers,
  satellites: LiSat,
  profiles: LiUser,
  community: LiGlobeAlt,
  alerts: LiBell,
  'rig-bridge': LiRadio,
  help: LiHelp,
};

/**
 * PanelIcon — renders the registry icon for a panel id, falling back to
 * the panel's emoji string for ids without one (plugin panels — their
 * emoji is part of the plugin contract and keeps rendering as-is).
 *
 * @param {string} panelId  - panelDefs id
 * @param {string} [icon]   - the panel's emoji string (fallback only)
 * @param {string} [iconColor] - optional accent (POTA/SOTA marker colors)
 * @param {number} [size]   - 20 in lists/pickers/tabs (approved default)
 */
export const PanelIcon = ({ panelId, icon, iconColor, size = 20, style }) => {
  const Cmp = PANEL_ICONS[panelId];
  if (Cmp) {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          verticalAlign: 'middle',
          flexShrink: 0,
          color: iconColor || 'var(--accent-cyan, #00ffcc)',
          ...style,
        }}
      >
        <Cmp size={size} />
      </span>
    );
  }
  // Unknown id (plugin panel): keep the emoji string.
  return (
    <span aria-hidden="true" style={{ fontSize: `${Math.round(size * 0.8)}px`, color: iconColor, ...style }}>
      {icon}
    </span>
  );
};

export default {
  IconSearch,
  IconRefresh,
  IconMap,
  IconGear,
  IconGlobe,
  IconSatellite,
  IconAntenna,
  IconSun,
  IconMoon,
  IconTrophy,
  IconTent,
  IconEarth,
  IconPin,
  IconTag,
  IconExpand,
  IconShrink,
  IconTrash,
  IconExternalLink,
  IconQth,
};

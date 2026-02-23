export const THEME_COLOR_CONFIG = {
  '--bg-primary': { alpha: false, hueRestrict: null },
  '--bg-secondary': { alpha: false, hueRestrict: null },
  '--bg-tertiary': { alpha: false, hueRestrict: null },
  '--bg-panel': { alpha: false, hueRestrict: null },
  '--border-color': { alpha: true, hueRestrict: null },
  '--text-primary': { alpha: false, hueRestrict: null },
  '--text-secondary': { alpha: false, hueRestrict: null },
  '--text-muted': { alpha: false, hueRestrict: null },
  '--map-ocean': { alpha: false, hueRestrict: null },
  '--accent-amber': { alpha: false, hueRestrict: 45 },
  '--accent-amber-dim': { alpha: false, hueRestrict: 45 },
  '--accent-green': { alpha: false, hueRestrict: 120 },
  '--accent-green-dim': { alpha: false, hueRestrict: 120 },
  '--accent-red': { alpha: false, hueRestrict: 0 },
  '--accent-blue': { alpha: false, hueRestrict: 240 },
  '--accent-cyan': { alpha: false, hueRestrict: 180 },
  '--accent-purple': { alpha: false, hueRestrict: 277 },
};

export const THEME_VARS = Object.keys(THEME_COLOR_CONFIG);

export const AVAILABLE_THEMES = {
  dark: { label: 'Dark', icon: '🌙' },
  light: { label: 'Light', icon: '☀️' },
  legacy: { label: 'Legacy', icon: '💻' },
  retro: { label: 'Retro', icon: '🪟' },
  custom: { label: 'Custom', icon: '🎨' },
};

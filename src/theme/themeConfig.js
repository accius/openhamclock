export const THEME_COLOR_CONFIG = {
  '--bg-primary': { alpha: false },
  '--bg-secondary': { alpha: false },
  '--bg-tertiary': { alpha: false },
  '--bg-panel': { alpha: true },
  '--border-color': { alpha: true },
  '--text-primary': { alpha: false },
  '--text-secondary': { alpha: false },
  '--text-muted': { alpha: true },
  '--map-ocean': { alpha: false },
  '--accent-amber': { alpha: false },
  '--accent-amber-dim': { alpha: true },
  '--accent-green': { alpha: false },
  '--accent-green-dim': { alpha: true },
  '--accent-red': { alpha: false },
  '--accent-blue': { alpha: false },
  '--accent-cyan': { alpha: false },
  '--accent-purple': { alpha: false },
};

export const THEME_VARS = Object.keys(THEME_COLOR_CONFIG);

export const AVAILABLE_THEMES = {
  dark: { label: 'Dark' },
  light: { label: 'Light' },
  legacy: { label: 'Legacy' },
  retro: { label: 'Retro' },
  custom: { label: 'Custom' },
};

export const DEFAULT_THEME = 'dark';

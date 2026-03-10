import { THEME_VARS } from './themeConfig';
/* Read CSS variables from the active theme */
export function readCssVariables() {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(THEME_VARS.map((v) => [v, styles.getPropertyValue(v).trim()]));
}

/* Apply a theme object to :root */
export function applyCustomTheme(themeVars) {
  document.documentElement.removeAttribute('data-theme');
  Object.entries(themeVars).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
}

/* Switch prebuilt theme */
export function applyPrebuiltTheme(themeName) {
  document.documentElement.removeAttribute('style'); // clears custom overrides
  document.documentElement.setAttribute('data-theme', themeName);
}

/* get a theme's styles */
export function getThemeStyles(themeName) {
  document.documentElement.removeAttribute('style');
  document.documentElement.setAttribute('data-theme', themeName);

  const styles = getComputedStyle(document.documentElement);
  return Array.from(styles)
    .filter((name) => name.startsWith('--'))
    .reduce((acc, name) => {
      acc[name] = styles.getPropertyValue(name).trim();
      return acc;
    }, {});
}

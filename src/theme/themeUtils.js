import { THEME_VARS } from './themeConfig';

/* Add "active" class to theme button that is selected */
export function setActiveThemeButton(selectorString) {
  const allThemeButtons = document.querySelectorAll('.theme-select-button');
  allThemeButtons.forEach((element) => {
    element.classList.remove('active');
  });

  const activeButton = document.querySelector('.' + selectorString + '-theme-select-button');
  if (activeButton) {
    activeButton.classList.add('active');
  }
}

/* Read CSS variables from the active theme */
export function readCssVariables() {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(THEME_VARS.map((v) => [v, styles.getPropertyValue(v).trim()]));
}

/* Apply a theme object to :root */
export function applyCustomTheme(themeVars) {
  Object.entries(themeVars).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
}

/* Switch prebuilt theme */
export function applyPrebuiltTheme(themeName) {
  document.documentElement.removeAttribute('style'); // clears custom overrides
  document.documentElement.setAttribute('data-theme', themeName);
}

import { useEffect, useState } from 'react';
import { loadConfig, saveConfig } from './themeStorage';
import { DEFAULT_THEME } from '../theme/themeConfig';
import { getThemeStyles, readCssVariables, applyCustomTheme, applyPrebuiltTheme } from './themeUtils';

export function useTheme() {
  const config = loadConfig();

  const [theme, setTheme] = useState(config.theme || DEFAULT_THEME);
  const [customTheme, setCustomTheme] = useState(config.customTheme || null);

  /* Initial load */
  useEffect(() => {
    if (!config.customTheme) {
      const defaults = readCssVariables(); // from default theme
      saveConfig({ theme: DEFAULT_THEME, customTheme: defaults });
      setCustomTheme(defaults);
    }

    if (theme === 'custom' && customTheme) {
      applyCustomTheme(customTheme);
    } else {
      applyPrebuiltTheme(theme);
    }
  }, []);

  /* Custom Theme reset */
  function resetCustomToDefault() {
    const defaultStyles = getThemeStyles(DEFAULT_THEME);

    setCustomTheme(defaultStyles);
    applyCustomTheme(defaultStyles);

    saveConfig({
      theme: 'custom',
      customTheme: defaultStyles,
    });

    setTheme('custom');
  }

  /* Theme switching */
  useEffect(() => {
    if (theme === 'custom') {
      applyCustomTheme(customTheme);
    } else {
      applyPrebuiltTheme(theme);
    }
    saveConfig({ theme });
  }, [theme]);

  /* Custom edits */
  function updateCustomVar(name, value) {
    const updated = { ...customTheme, [name]: value };
    setCustomTheme(updated);
    applyCustomTheme(updated);
    saveConfig({ customTheme: updated });
  }

  return {
    theme,
    setTheme,
    customTheme,
    updateCustomVar,
    resetCustomToDefault,
  };
}

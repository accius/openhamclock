import { useEffect, useState } from 'react';
import { loadConfig, saveConfig } from './themeStorage';
import { setActiveThemeButton, readCssVariables, applyCustomTheme, applyPrebuiltTheme } from './themeUtils';

export function useTheme() {
  const config = loadConfig();

  const [theme, setTheme] = useState(config.theme || 'dark');
  const [customTheme, setCustomTheme] = useState(config.customTheme || null);

  /* Initial load */
  useEffect(() => {
    if (!config.customTheme) {
      const defaults = readCssVariables(); // from dark theme
      saveConfig({ theme: 'dark', customTheme: defaults });
      setCustomTheme(defaults);
    }

    if (theme === 'custom' && customTheme) {
      applyCustomTheme(customTheme);
    } else {
      applyPrebuiltTheme(theme);
    }
  }, []);

  /* Theme switching */
  useEffect(() => {
    if (theme === 'custom') {
      applyCustomTheme(customTheme);
    } else {
      applyPrebuiltTheme(theme);
    }
    saveConfig({ theme });

    setActiveThemeButton(theme);
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
  };
}

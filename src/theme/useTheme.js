import { useEffect, useState } from 'react';
import { loadConfig, saveConfig } from './themeStorage';
import { readCssVariables, applyCustomTheme, applyPrebuiltTheme } from './themeUtils';

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

    const allThemeButtons = document.querySelectorAll('.theme-select-button');
    allThemeButtons.forEach((element) => {
      element.classList.remove('active');
    });

    const activeButton = document.querySelector('.' + theme + '-theme-select-button');
    if (activeButton) {
      activeButton.classList.add('active');
    }
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

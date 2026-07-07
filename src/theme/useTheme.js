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
    } else {
      // Backfill variables added after this custom theme was saved
      // (e.g. the Worked Grids heatmap colors) with the current defaults
      const defaults = readCssVariables();
      const missing = Object.keys(defaults).filter((k) => !(k in config.customTheme));
      if (missing.length > 0) {
        const merged = { ...defaults, ...config.customTheme };
        saveConfig({ customTheme: merged });
        setCustomTheme(merged);
      }
    }

    if (theme === 'custom' && customTheme) {
      applyCustomTheme(customTheme);
    } else {
      applyPrebuiltTheme(theme);
    }

    // Restore saved font family (applies regardless of theme)
    try {
      const savedFont = localStorage.getItem('openhamclock_fontFamily');
      if (savedFont) {
        document.documentElement.style.setProperty('--font-body', savedFont);
        document.body.style.fontFamily = savedFont;
      }
    } catch {}

    // Restore saved monospace font (#923 — readability of 0 vs 8)
    try {
      const savedMono = localStorage.getItem('openhamclock_monoFont');
      if (savedMono) {
        document.documentElement.style.setProperty('--font-mono', savedMono);
      }
    } catch {}
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

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

  /* Follow theme changes made elsewhere (remote-control /theme command,
     config.applyTheme) so the Settings picker never writes a stale value back. */
  useEffect(() => {
    const onExternal = (e) => {
      const next = e.detail?.theme;
      if (next && next !== 'custom') setTheme((cur) => (cur === next ? cur : next));
    };
    window.addEventListener('openhamclock-theme-change', onExternal);
    return () => window.removeEventListener('openhamclock-theme-change', onExternal);
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

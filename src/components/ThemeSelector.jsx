import { useEffect } from 'react';
import { AVAILABLE_THEMES } from '../theme/themeConfig';

export default function ThemeSelector({
  id = 'theme-selector-component',
  className = 'theme-selector-component',
  theme,
  setTheme,
  selectedTheme,
  t,
}) {
  return (
    <div id={id} className={className}>
      <div className="theme-selector-control">
        <select value={theme} onChange={(e) => setTheme(e.target.value)}>
          {Object.entries(AVAILABLE_THEMES).map(([key, t]) => (
            <option value={key} key={key}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="theme-description">{t('station.settings.theme.' + theme + '.describe')}</div>
      </div>
      <div className="theme-selector-preview" data-theme={theme}>
        <h2>Theme: {AVAILABLE_THEMES[theme].label}</h2>
        <div className="preview-element">
          <h3>Secondary Text Over Secondary Background</h3>
          <div className="preview-panel">
            <h4>Primary Text Over Panel Background</h4>
            <p className="muted-text">Muted Text over panel background.</p>
            <button className="btn-primary">Button</button>
            <button className="btn-secondary">Button</button>
          </div>
          <p className="muted-text">Muted text over secondary background.</p>
          <div className="preview-panel">
            <ul>
              <li
                style={{
                  color: 'var(--accent-amber)',
                }}
              >
                Amber Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-amber-dim)',
                }}
              >
                Amber Accent (dim)
              </li>
              <li
                style={{
                  color: 'var(--accent-green)',
                }}
              >
                Green Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-green-dim)',
                }}
              >
                Green Accent (dim)
              </li>
              <li
                style={{
                  color: 'var(--accent-red)',
                }}
              >
                Red Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-blue)',
                }}
              >
                Blue Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-cyan)',
                }}
              >
                Cyan Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-purple)',
                }}
              >
                Purple Accent
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

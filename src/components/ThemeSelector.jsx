import { useEffect } from 'react';
import { setActiveThemeButton } from '../theme/themeUtils';
import { AVAILABLE_THEMES } from '../theme/themeConfig';

export default function ThemeSelector({
  id = 'theme-selector-component',
  className = 'theme-selector-component',
  theme,
  setTheme,
  selectedTheme,
  t,
}) {
  useEffect(() => {
    setActiveThemeButton(theme);
  }, []);

  return (
    <div
      id={id}
      className={className}
      style={{ display: 'flex', gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '1em' }}
    >
      <div className="theme-selector-control" style={{ flex: '1', flexBasis: '300px', boxSizing: 'border-box' }}>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            fontFamily: 'JetBrains Mono, monospace',
            cursor: 'pointer',
          }}
        >
          {Object.entries(AVAILABLE_THEMES).map(([key, t]) => (
            <option value={key} key={key}>
              {t.label}
            </option>
          ))}
        </select>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
          {t('station.settings.theme.' + theme + '.describe')}
        </div>
      </div>
      <div
        className="theme-selector-preview"
        data-theme={theme}
        style={{
          flex: '1',
          flexBasis: '300px',
          boxSizing: 'border-box',
          background: 'var(--bg-primary)',
          padding: '1em 2em 2em 2em',
        }}
      >
        <h2 style={{ color: 'var(--text-primary)', textTransform: 'capitalize', marginBottom: '.5em' }}>
          Theme: {AVAILABLE_THEMES[theme].label}
        </h2>
        <div
          className="preview-element"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            padding: '1em',
            borderRadius: '6px',
            margin: '0',
          }}
        >
          <h3 style={{ color: 'var(--text-secondary)' }}>Secondary Text Over Secondary Background</h3>
          <div
            className="preview-panel"
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              padding: '1em',
              margin: '1em 0',
              borderRadius: '6px',
            }}
          >
            <h4 style={{ color: 'var(--text-primary)' }}>Primary Text Over Panel Background</h4>
            <p className="text-secondary" style={{ margin: '1em 0', color: 'var(--text-muted)' }}>
              Muted Text Sample.
            </p>
            <button
              className="btn-primary"
              style={{
                border: 'none',
                padding: '1em',
                marginRight: '1em',
                display: 'inline-block',
                background: 'var(--accent-amber)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Button
            </button>
            <button
              className="btn-secondary"
              style={{
                border: 'none',
                padding: '1em',
                marginRight: '1em',
                display: 'inline-block',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Button
            </button>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Muted text over secondary background.</p>
          <div
            className="preview-panel"
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              padding: '1em',
              margin: '1em 0 0 0',
              borderRadius: '6px',
            }}
          >
            <ul style={{ margin: '0 1em' }}>
              <li
                style={{
                  color: 'var(--accent-amber)',
                  margin: '0 3px',
                }}
              >
                Amber Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-amber-dim)',
                  margin: '0 3px',
                }}
              >
                Amber Accent (dim)
              </li>
              <li
                style={{
                  color: 'var(--accent-green)',
                  margin: '0 3px',
                }}
              >
                Green Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-green-dim)',
                  margin: '0 3px',
                }}
              >
                Green Accent (dim)
              </li>
              <li
                style={{
                  color: 'var(--accent-red)',
                  margin: '0 3px',
                }}
              >
                Red Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-blue)',
                  margin: '0 3px',
                }}
              >
                Blue Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-cyan)',
                  margin: '0 3px',
                }}
              >
                Cyan Accent
              </li>
              <li
                style={{
                  color: 'var(--accent-purple)',
                  margin: '0 3px',
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

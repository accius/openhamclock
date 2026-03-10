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
        <h2>
          {t('station.settings.theme')}: {AVAILABLE_THEMES[theme].label}
        </h2>
        <div className="preview-element">
          <h3>
            {t('station.settings.theme.custom.--text-secondary')} / {t('station.settings.theme.custom.--bg-secondary')}
          </h3>
          <div className="preview-panel">
            <h4>
              {t('station.settings.theme.custom.--text-primary')} / {t('station.settings.theme.custom.--bg-panel')}
            </h4>
            <p className="muted-text">
              {t('station.settings.theme.custom.--text-muted')} / {t('station.settings.theme.custom.--bg-panel')}
            </p>
            <button className="btn-primary">{t('station.settings.theme.sampleButtonText')}</button>
            <button className="btn-secondary">{t('station.settings.theme.sampleButtonText')}</button>
          </div>
          <p className="muted-text">
            {t('station.settings.theme.custom.--text-muted')} / {t('station.settings.theme.custom.--bg-secondary')}
          </p>
          <div className="preview-panel">
            <ul>
              <li
                style={{
                  color: 'var(--accent-amber)',
                }}
              >
                {t('station.settings.theme.custom.--accent-amber')}
              </li>
              <li
                style={{
                  color: 'var(--accent-amber-dim)',
                }}
              >
                {t('station.settings.theme.custom.--accent-amber-dim')}
              </li>
              <li
                style={{
                  color: 'var(--accent-green)',
                }}
              >
                {t('station.settings.theme.custom.--accent-green')}
              </li>
              <li
                style={{
                  color: 'var(--accent-green-dim)',
                }}
              >
                {t('station.settings.theme.custom.--accent-green-dim')}
              </li>
              <li
                style={{
                  color: 'var(--accent-red)',
                }}
              >
                {t('station.settings.theme.custom.--accent-red')}
              </li>
              <li
                style={{
                  color: 'var(--accent-blue)',
                }}
              >
                {t('station.settings.theme.custom.--accent-blue')}
              </li>
              <li
                style={{
                  color: 'var(--accent-cyan)',
                }}
              >
                {t('station.settings.theme.custom.--accent-cyan')}
              </li>
              <li
                style={{
                  color: 'var(--accent-purple)',
                }}
              >
                {t('station.settings.theme.custom.--accent-purple')}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

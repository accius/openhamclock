import { AVAILABLE_THEMES } from '../theme/themeConfig';

export default function ThemeSelector({ id, theme, setTheme }) {
  return (
    <>
      <div id={id} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
        {Object.entries(AVAILABLE_THEMES).map(([key, t]) => (
          <button className={`${key}-theme-select-button theme-select-button`} key={key} onClick={() => setTheme(key)}>
            <span className="icon">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
    </>
  );
}

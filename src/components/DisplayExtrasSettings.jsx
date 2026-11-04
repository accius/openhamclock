/**
 * Settings → Display: Demo mode (session-only) and Grayscale display.
 * Rendered by SettingsPanel at the end of the Display tab. `grayscale` is a
 * controlled value saved by the panel; demo mode flips a session flag
 * immediately (HamClock behaviour: never persisted).
 */
import { useTranslation } from 'react-i18next';
import { getFlag, setFlag } from '../utils/sessionFlags.js';
import useSessionFlag from '../hooks/app/useSessionFlag.js';

const label = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-muted)',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '1px',
};
const describe = { fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 };

export default function DisplayExtrasSettings({ grayscale, onGrayscaleChange }) {
  const { t } = useTranslation();
  const demoMode = useSessionFlag('demoMode');
  const modes = ['off', 'map', 'all'];

  return (
    <>
      <div style={{ marginTop: '24px', marginBottom: '24px' }}>
        <label style={label}>{t('station.settings.demo.title')}</label>
        <div style={describe}>{t('station.settings.demo.describe')}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!demoMode}
            onChange={(e) => setFlag('demoMode', e.target.checked)}
            aria-label={t('station.settings.demo.enable')}
          />
          <span>
            🏃 {t('station.settings.demo.enable')}
            {getFlag('demoMode') ? '' : ''}
          </span>
        </label>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label style={label}>{t('station.settings.grayscale.title')}</label>
        <div style={describe}>{t('station.settings.grayscale.describe')}</div>
        <div
          role="radiogroup"
          aria-label={t('station.settings.grayscale.title')}
          style={{ display: 'flex', gap: '6px' }}
        >
          {modes.map((m) => {
            const active = (grayscale || 'off') === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onGrayscaleChange(m)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  border: `1px solid ${active ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                  background: active ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                  color: active ? '#000' : 'var(--text-primary)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t(`station.settings.grayscale.${m}`)}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

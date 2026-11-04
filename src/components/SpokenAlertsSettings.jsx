/**
 * SpokenAlertsSettings — the "Speak alerts" card in Settings → Alerts.
 *
 * Master toggle, voice picker, rate, ITU phonetic spelling, and a per-feed
 * speak toggle for every alert feed. Everything persists inside the shared
 * audio-alert settings blob (see utils/speechAlerts.js for the shape), so
 * the hook that plays tones (useAudioAlerts) can read it without extra
 * plumbing.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ALERT_FEEDS } from '../utils/audioAlerts';
import { getSpeechSettings, isSpeechSupported, listVoices, speakSample } from '../utils/speechAlerts';

const cardStyle = (on) => ({
  background: 'var(--bg-tertiary)',
  border: `1px solid ${on ? 'var(--accent-amber)' : 'var(--border-color)'}`,
  borderRadius: '8px',
  padding: '14px',
});

const pillStyle = (on, disabled) => ({
  background: on ? 'var(--accent-amber)' : 'var(--bg-secondary)',
  color: on ? '#000' : 'var(--text-muted)',
  border: `1px solid ${on ? 'var(--accent-amber)' : 'var(--border-color)'}`,
  borderRadius: '4px',
  padding: '4px 12px',
  fontSize: '11px',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  fontFamily: 'var(--font-mono)',
});

const selectStyle = {
  flex: 1,
  minWidth: '160px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '6px 8px',
  fontSize: '12px',
  fontFamily: 'var(--font-mono)',
};

export default function SpokenAlertsSettings({ alertSettings, updateSettings }) {
  const { t } = useTranslation();
  const supported = isSpeechSupported();
  const speech = getSpeechSettings(alertSettings);
  const [voices, setVoices] = useState(() => listVoices());

  // Chrome populates voices asynchronously.
  useEffect(() => {
    if (!supported) return undefined;
    const refresh = () => setVoices(listVoices());
    refresh();
    try {
      window.speechSynthesis.addEventListener('voiceschanged', refresh);
    } catch {}
    return () => {
      try {
        window.speechSynthesis.removeEventListener('voiceschanged', refresh);
      } catch {}
    };
  }, [supported]);

  const setSpeech = (patch) => updateSettings({ ...alertSettings, speech: { ...speech, ...patch } });
  const on = supported && speech.enabled;

  return (
    <div style={cardStyle(on)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600 }}>
          {t('station.settings.alerts.speech.title')}
        </span>
        <button
          type="button"
          onClick={() => setSpeech({ enabled: !speech.enabled })}
          disabled={!supported}
          aria-pressed={on}
          aria-label={t('station.settings.alerts.speech.title')}
          style={pillStyle(on, !supported)}
        >
          {on ? 'ON' : 'OFF'}
        </button>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5', marginTop: '6px' }}>
        {t('station.settings.alerts.speech.description')}
      </div>
      {!supported && (
        <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5', marginTop: '6px' }}>
          {t('station.settings.alerts.speech.unsupported')}
        </div>
      )}

      {on && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              {t('station.settings.alerts.speech.voice')}
            </span>
            <select
              value={speech.voice || ''}
              onChange={(e) => setSpeech({ voice: e.target.value })}
              aria-label={t('station.settings.alerts.speech.voice')}
              style={selectStyle}
            >
              <option value="">{t('station.settings.alerts.speech.voiceDefault')}</option>
              {voices.map((v) => (
                <option key={v.voiceURI || v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => speakSample(alertSettings)}
              aria-label={t('station.settings.alerts.speech.test')}
              style={pillStyle(false, false)}
            >
              {t('station.settings.alerts.speech.test')}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px', minWidth: '40px' }}>
              {t('station.settings.alerts.speech.rate')}
            </span>
            <input
              type="range"
              min="50"
              max="200"
              step="5"
              value={Math.round((speech.rate || 1) * 100)}
              onChange={(e) => setSpeech({ rate: parseInt(e.target.value, 10) / 100 })}
              aria-label={t('station.settings.alerts.speech.rate')}
              style={{ flex: 1, accentColor: 'var(--accent-amber)' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '11px', minWidth: '36px', textAlign: 'right' }}>
              {(speech.rate || 1).toFixed(2)}×
            </span>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '10px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={!!speech.phonetic}
              onChange={(e) => setSpeech({ phonetic: e.target.checked })}
              style={{ accentColor: 'var(--accent-amber)' }}
            />
            {t('station.settings.alerts.speech.phonetic')}
          </label>

          <div style={{ marginTop: '12px', color: 'var(--text-muted)', fontSize: '11px' }}>
            {t('station.settings.alerts.speech.perFeed')}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: '4px 12px',
              marginTop: '6px',
            }}
          >
            {Object.entries(ALERT_FEEDS).map(([feedId, feed]) => {
              const conf = alertSettings[feedId] || {};
              return (
                <label
                  key={feedId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: conf.enabled ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                  title={conf.enabled ? feed.label : t('station.settings.alerts.speech.feedDisabled')}
                >
                  <input
                    type="checkbox"
                    checked={!!conf.speak}
                    onChange={(e) =>
                      updateSettings({ ...alertSettings, [feedId]: { ...conf, speak: e.target.checked } })
                    }
                    aria-label={`${t('station.settings.alerts.speech.speakFeed')} ${feed.label}`}
                    style={{ accentColor: 'var(--accent-amber)' }}
                  />
                  {feed.label}
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

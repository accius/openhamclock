/**
 * Settings → Station: Remote control (display id + phone-remote QR),
 * callsign-box titles and the kiosk PIN. Rendered by SettingsPanel at the
 * end of the Station tab; the controlled values (`remoteEnabled`,
 * `callsignTitles`) are saved by the panel's normal Save path, the kiosk
 * PIN is browser-local (utils/kioskLock.js) and takes effect immediately.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getControlId, getControlSecret, rotateControlId, buildRemoteUrl } from '../utils/remoteControl.js';
import { encodeQR, qrToSvg } from '../utils/qrcode.js';
import { titlesError } from '../utils/titles.js';
import { getKioskState, setPin, clearPin, lock, isValidPin, KIOSK_LOCK_EVENT } from '../utils/kioskLock.js';
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
const input = {
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '6px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
};
const btn = {
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '6px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
};

/** Inline QR (SVG) for a URL; re-encodes only when the text changes. */
export function QrCode({ text, size = 160, ariaLabel }) {
  const svg = useMemo(() => {
    try {
      return qrToSvg(encodeQR(text), { margin: 2, size, dark: '#000', light: '#fff' });
    } catch {
      return null;
    }
  }, [text, size]);
  if (!svg) return null;
  return (
    <div
      role="img"
      aria-label={ariaLabel || text}
      style={{ width: size, height: size, borderRadius: '6px', overflow: 'hidden', background: '#fff' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function RemoteControlSettings({
  remoteEnabled,
  onRemoteEnabledChange,
  callsignTitles,
  onCallsignTitlesChange,
  isLocalInstall,
}) {
  const { t } = useTranslation();
  const [controlId, setControlId] = useState(() => getControlId());
  // Pairing secret: travels only in the QR / phone URL (never shown as plain text here).
  const [controlSecret, setControlSecret] = useState(() => getControlSecret());
  const [copied, setCopied] = useState(false);
  const [serverInfo, setServerInfo] = useState(null);
  const status = useSessionFlag('remoteStatus');

  // Kiosk PIN
  const [kiosk, setKiosk] = useState(() => getKioskState());
  const [pin, setPinInput] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [pinMsg, setPinMsg] = useState(null);

  useEffect(() => {
    const sync = () => setKiosk(getKioskState());
    window.addEventListener(KIOSK_LOCK_EVENT, sync);
    return () => window.removeEventListener(KIOSK_LOCK_EVENT, sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/control')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setServerInfo(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveEnabled = remoteEnabled === true || remoteEnabled === false ? remoteEnabled : !!isLocalInstall;
  const remoteUrl = buildRemoteUrl(window.location.origin, controlId, controlSecret);
  const titlesErr = titlesError(callsignTitles);

  const rotate = () => {
    setControlId(rotateControlId());
    setControlSecret(getControlSecret());
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(remoteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const handleSetPin = () => {
    if (!isValidPin(pin)) return setPinMsg({ error: true, key: 'invalidPin' });
    if (kiosk.hasPin && !clearPin(currentPin)) return setPinMsg({ error: true, key: 'wrongPin' });
    setPin(pin);
    setPinInput('');
    setCurrentPin('');
    setPinMsg({ error: false, key: 'pinSet' });
  };
  const handleClearPin = () => {
    if (!clearPin(currentPin)) return setPinMsg({ error: true, key: 'wrongPin' });
    setCurrentPin('');
    setPinMsg({ error: false, key: 'noPin' });
  };

  return (
    <>
      {/* ── Remote control ─────────────────────────────────────────── */}
      <div style={{ marginTop: '24px', marginBottom: '24px' }} data-testid="remote-control-settings">
        <label style={label}>{t('station.settings.remote.title')}</label>
        <div style={describe}>{t('station.settings.remote.describe')}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={effectiveEnabled}
            onChange={(e) => onRemoteEnabledChange(e.target.checked)}
            aria-label={t('station.settings.remote.enable')}
          />
          <span>{t('station.settings.remote.enable')}</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '10px',
              color:
                status === 'connected'
                  ? 'var(--accent-green)'
                  : status === 'error' || status === 'rejected'
                    ? 'var(--accent-red)'
                    : 'var(--text-muted)',
            }}
          >
            ● {t(`station.settings.remote.status.${status || 'off'}`)}
          </span>
        </label>

        {effectiveEnabled && (
          <div style={{ display: 'flex', gap: '14px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <QrCode text={remoteUrl} size={150} ariaLabel={t('station.settings.remote.qrHint')} />
            <div style={{ flex: 1, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <div style={{ ...describe, marginBottom: '4px' }}>{t('station.settings.remote.displayId')}</div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <code style={{ ...input, flex: 1, userSelect: 'all' }} data-testid="control-id">
                    {controlId}
                  </code>
                  <button
                    type="button"
                    style={btn}
                    onClick={rotate}
                    aria-label={t('station.settings.remote.newId')}
                    title={t('station.settings.remote.newIdHint')}
                  >
                    {t('station.settings.remote.newId')}
                  </button>
                </div>
              </div>
              <div>
                <div style={{ ...describe, marginBottom: '4px' }}>{t('station.settings.remote.phoneUrl')}</div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    value={remoteUrl}
                    style={{ ...input, flex: 1 }}
                    aria-label={t('station.settings.remote.phoneUrl')}
                  />
                  <button type="button" style={btn} onClick={copy} aria-label={t('station.settings.remote.copy')}>
                    {copied ? t('station.settings.remote.copied') : t('station.settings.remote.copy')}
                  </button>
                  <a
                    href={remoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...btn, textDecoration: 'none', color: 'var(--accent-cyan)' }}
                  >
                    {t('station.settings.remote.open')}
                  </a>
                </div>
              </div>
              <div style={describe}>{t('station.settings.remote.qrHint')}</div>
              <div style={describe} data-testid="pairing-hint">
                {t('station.settings.remote.pairingHint')}
                {serverInfo?.writeKeyRequired ? ` ${t('station.settings.remote.pairingHintKeyed')}` : ''}
              </div>
              {status === 'rejected' && (
                <div style={{ ...describe, color: 'var(--accent-red)' }}>
                  {t('station.settings.remote.rejectedHint')}
                </div>
              )}
              <a
                href="https://github.com/accius/openhamclock/blob/main/docs/API.md#remote-control-api"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '11px', color: 'var(--accent-cyan)' }}
              >
                {t('station.settings.remote.apiDocs')} ↗
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Callsign box titles ────────────────────────────────────── */}
      <div style={{ marginBottom: '24px' }}>
        <label style={label} htmlFor="callsign-titles">
          {t('station.settings.titles.title')}
        </label>
        <div style={describe}>{t('station.settings.titles.describe')}</div>
        <input
          id="callsign-titles"
          type="text"
          value={callsignTitles || ''}
          onChange={(e) => onCallsignTitlesChange(e.target.value)}
          placeholder={t('station.settings.titles.placeholder')}
          maxLength={400}
          style={{ ...input, width: '100%', borderColor: titlesErr ? 'var(--accent-red)' : undefined }}
          aria-invalid={!!titlesErr}
        />
        {titlesErr && (
          <div style={{ ...describe, color: 'var(--accent-red)', marginTop: '4px' }}>
            {t(`station.settings.titles.error.${titlesErr}`)}
          </div>
        )}
      </div>

      {/* ── Kiosk lock ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: '24px' }}>
        <label style={label}>{t('station.settings.kiosk.title')}</label>
        <div style={describe}>{t('station.settings.kiosk.describe')}</div>
        <div
          style={{
            fontSize: '11px',
            marginBottom: '8px',
            color: kiosk.hasPin ? 'var(--accent-green)' : 'var(--text-muted)',
          }}
        >
          {kiosk.hasPin ? '🔐 ' + t('station.settings.kiosk.pinSet') : t('station.settings.kiosk.noPin')}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {kiosk.hasPin && (
            <input
              type="password"
              inputMode="numeric"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder={t('station.settings.kiosk.currentPin')}
              aria-label={t('station.settings.kiosk.currentPin')}
              style={{ ...input, width: '120px' }}
            />
          )}
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder={t('station.settings.kiosk.pin')}
            aria-label={t('station.settings.kiosk.pin')}
            style={{ ...input, width: '120px' }}
          />
          <button type="button" style={btn} onClick={handleSetPin}>
            {kiosk.hasPin ? t('station.settings.kiosk.changePin') : t('station.settings.kiosk.setPin')}
          </button>
          {kiosk.hasPin && (
            <>
              <button type="button" style={btn} onClick={handleClearPin}>
                {t('station.settings.kiosk.clearPin')}
              </button>
              <button
                type="button"
                style={{ ...btn, color: 'var(--accent-amber)', borderColor: 'var(--accent-amber)' }}
                onClick={() => lock()}
                disabled={kiosk.locked}
              >
                🔒 {t('station.settings.kiosk.lockNow')}
              </button>
            </>
          )}
        </div>
        {pinMsg && (
          <div
            style={{ ...describe, marginTop: '6px', color: pinMsg.error ? 'var(--accent-red)' : 'var(--accent-green)' }}
          >
            {t(`station.settings.kiosk.${pinMsg.key}`)}
          </div>
        )}
      </div>
    </>
  );
}

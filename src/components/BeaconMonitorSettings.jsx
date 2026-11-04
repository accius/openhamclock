/**
 * BeaconMonitorSettings — Settings → Rig Bridge → "Beacon monitor (KiwiSDR)"
 *
 * Configures the Rig Bridge kiwi-beacon-monitor plugin from the browser:
 * on/off, a KiwiSDR picked from the public directory (nearest to DE, via
 * /api/websdr/receivers) or entered by hand, password, bands, and a
 * "Push to Rig Bridge" button that POSTs the section to the bridge's
 * /api/config (which restarts the monitor live). The OHC-side copy of the
 * settings (saved with the main Save button) tells the browser to start
 * polling for measurements.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IBP_BANDS } from '../utils/ibp.js';
import { DEFAULT_BAND_COLORS } from '../utils/bandColors.js';
import { latLonToMaidenhead } from '../utils/geo.js';

export const DEFAULT_BEACON_MONITOR = {
  enabled: false,
  host: '',
  port: 8073,
  password: '',
  bands: IBP_BANDS.map((b) => b.label),
  kiwiName: '',
};

/** "http://host:8073" → { host, port, secure } (directory entries carry a URL). */
export function parseKiwiUrl(url) {
  try {
    const u = new URL(url);
    const secure = u.protocol === 'https:';
    const port = u.port ? parseInt(u.port, 10) : secure ? 443 : 80;
    return { host: u.hostname, port, secure };
  } catch {
    return null;
  }
}

const inputStyle = {
  width: '100%',
  padding: '8px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--accent-cyan)',
  fontSize: '13px',
  fontFamily: 'var(--font-mono)',
  boxSizing: 'border-box',
};
const labelStyle = { display: 'block', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '10px' };

export default function BeaconMonitorSettings({
  value,
  onChange,
  rigEnabled,
  rigHost,
  rigPort,
  rigApiToken,
  callsign,
  deLat,
  deLon,
}) {
  const { t } = useTranslation();
  const v = { ...DEFAULT_BEACON_MONITOR, ...(value || {}) };
  const set = (patch) => onChange({ ...v, ...patch });

  const [receivers, setReceivers] = useState(null); // null = not loaded, [] = none
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState(false);
  const [pushState, setPushState] = useState(null); // null | 'pushing' | 'ok' | 'error'

  const bridgeUrl = (() => {
    const host = (rigHost || 'http://localhost').replace(/\/$/, '');
    const port = parseInt(String(rigPort ?? ''), 10);
    if (String(rigPort).trim() === '0') return host;
    return `${host}:${Number.isFinite(port) && port > 0 ? port : 5555}`;
  })();

  const findNearest = async () => {
    if (deLat == null || deLon == null) return;
    setFinding(true);
    setFindError(false);
    try {
      const res = await fetch(`/api/websdr/receivers?lat=${deLat}&lon=${deLon}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setReceivers(Array.isArray(json.receivers) ? json.receivers : []);
    } catch {
      setReceivers([]);
      setFindError(true);
    } finally {
      setFinding(false);
    }
  };

  const pickReceiver = (url) => {
    const r = (receivers || []).find((x) => x.url === url);
    if (!r) return;
    const parsed = parseKiwiUrl(r.url);
    if (!parsed) return;
    set({ host: parsed.host, port: parsed.port, kiwiName: r.name || '' });
  };

  const toggleBand = (label) => {
    const has = v.bands.includes(label);
    const next = has ? v.bands.filter((b) => b !== label) : [...v.bands, label];
    set({ bands: IBP_BANDS.map((b) => b.label).filter((l) => next.includes(l)) });
  };

  const pushToBridge = async () => {
    setPushState('pushing');
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (rigApiToken) headers['X-RigBridge-Token'] = rigApiToken;
      let grid = '';
      try {
        if (deLat != null && deLon != null) grid = latLonToMaidenhead({ lat: deLat, lon: deLon }, 6);
      } catch {}
      const body = {
        beaconMonitor: {
          enabled: !!v.enabled,
          host: v.host.trim(),
          port: parseInt(String(v.port), 10) || 8073,
          password: v.password || '',
          bands: v.bands,
          name: v.kiwiName || '',
          callsign: callsign && callsign !== 'N0CALL' ? callsign.toUpperCase() : '',
          grid,
          lat: deLat ?? '',
          lon: deLon ?? '',
          serverForward: true,
          ohcUrl: window.location.origin,
        },
      };
      const res = await fetch(`${bridgeUrl}/api/config`, { method: 'POST', headers, body: JSON.stringify(body) });
      setPushState(res.ok ? 'ok' : 'error');
    } catch {
      setPushState('error');
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-tertiary)',
        padding: '12px',
        borderRadius: '6px',
        border: '1px solid var(--border-color)',
        marginTop: '16px',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          marginBottom: '8px',
        }}
      >
        {t('station.settings.beaconMonitor.title')}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '10px' }}>
        {t('station.settings.beaconMonitor.intro')}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!v.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          style={{ marginRight: '8px' }}
        />
        <span style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
          {t('station.settings.beaconMonitor.enable')}
        </span>
      </label>

      {v.enabled && (
        <>
          {!rigEnabled && (
            <div style={{ fontSize: '11px', color: 'var(--accent-amber)', marginBottom: '10px' }}>
              {t('station.settings.beaconMonitor.needsBridge')}
            </div>
          )}

          {/* Nearest-receiver picker */}
          <div style={{ marginBottom: '10px' }}>
            <button
              type="button"
              onClick={findNearest}
              disabled={finding || deLat == null || deLon == null}
              aria-label={t('station.settings.beaconMonitor.findNearest')}
              style={{
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '600',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--accent-cyan)',
                cursor: finding ? 'wait' : 'pointer',
              }}
            >
              {finding ? t('station.settings.beaconMonitor.finding') : t('station.settings.beaconMonitor.findNearest')}
            </button>
            {receivers && (
              <div style={{ marginTop: '8px' }}>
                <label style={labelStyle} htmlFor="beacon-monitor-kiwi-picker">
                  {t('station.settings.beaconMonitor.pickerLabel')}
                </label>
                {receivers.length ? (
                  <select
                    id="beacon-monitor-kiwi-picker"
                    onChange={(e) => pickReceiver(e.target.value)}
                    defaultValue=""
                    style={{ ...inputStyle, color: 'var(--text-primary)' }}
                  >
                    <option value="">{t('station.settings.beaconMonitor.pickerPlaceholder')}</option>
                    {receivers.map((r) => (
                      <option key={r.url} value={r.url}>
                        {r.name} · {r.dist_km} km · {r.users}/{r.users_max}
                        {r.snr ? ` · SNR ${r.snr}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {findError
                      ? t('station.settings.beaconMonitor.pickerError')
                      : t('station.settings.beaconMonitor.pickerNone')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={labelStyle} htmlFor="beacon-monitor-host">
                {t('station.settings.beaconMonitor.host')}
              </label>
              <input
                id="beacon-monitor-host"
                type="text"
                value={v.host}
                onChange={(e) => set({ host: e.target.value.replace(/^https?:\/\//, '').replace(/\/.*$/, '') })}
                placeholder="kiwisdr.example.org"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="beacon-monitor-port">
                {t('station.settings.beaconMonitor.port')}
              </label>
              <input
                id="beacon-monitor-port"
                type="number"
                min="1"
                max="65535"
                value={v.port}
                onChange={(e) => set({ port: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>
          {v.kiwiName && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '-6px', marginBottom: '8px' }}>
              {v.kiwiName}
            </div>
          )}

          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle} htmlFor="beacon-monitor-password">
              {t('station.settings.beaconMonitor.password')}
            </label>
            <input
              id="beacon-monitor-password"
              type="password"
              autoComplete="off"
              value={v.password}
              onChange={(e) => set({ password: e.target.value })}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <span style={labelStyle}>{t('station.settings.beaconMonitor.bands')}</span>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {IBP_BANDS.map((b) => (
                <label
                  key={b.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                    color: DEFAULT_BAND_COLORS[b.label] || 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={v.bands.includes(b.label)} onChange={() => toggleBand(b.label)} />
                  {b.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '10px' }}>
            {t('station.settings.beaconMonitor.etiquette')}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={pushToBridge}
              disabled={pushState === 'pushing' || !v.host.trim()}
              aria-label={t('station.settings.beaconMonitor.push')}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                color: 'var(--accent-green, #22c55e)',
                cursor: pushState === 'pushing' ? 'wait' : 'pointer',
              }}
            >
              {pushState === 'pushing'
                ? t('station.settings.beaconMonitor.pushing')
                : t('station.settings.beaconMonitor.push')}
            </button>
            {pushState === 'ok' && (
              <span style={{ fontSize: '11px', color: 'var(--accent-green, #22c55e)' }}>
                {t('station.settings.beaconMonitor.pushOk')}
              </span>
            )}
            {pushState === 'error' && (
              <span style={{ fontSize: '11px', color: 'var(--accent-amber)' }}>
                {t('station.settings.beaconMonitor.pushError', { url: bridgeUrl })}
              </span>
            )}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5 }}>
            {t('station.settings.beaconMonitor.pushHint')}
          </div>
        </>
      )}
    </div>
  );
}

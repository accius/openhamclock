/**
 * LogSyncSettings — "Logbook Sync" section of Settings → Integrations.
 *
 * Three collapsible cards (Wavelog/Cloudlog push, QRZ Logbook push, LoTW
 * confirmations pull). All credentials are stored ONLY in this browser
 * (localStorage `ohc-logsync-auth`, excluded from backups and settings sync —
 * see utils/logsyncConfig.js) and sent per-request to the /api/logsync/*
 * server proxies, which never persist them.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseAdif } from '../utils/adif.js';
import { getLogsyncConfig, getLogsyncState, setLogsyncServiceConfig } from '../utils/logsyncConfig.js';
import {
  getPendingCount,
  lotwCooldownRemainingMs,
  processQueue,
  subscribeLogsync,
  syncLotwConfirmations,
  syncWavelogQsos,
  testLotw,
  testQrz,
  testWavelog,
} from '../utils/logsync.js';

const inputStyle = {
  flex: '1 1 180px',
  minWidth: 0,
  padding: '6px 10px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};

const btnStyle = (primary) => ({
  padding: '6px 12px',
  fontSize: '11px',
  borderRadius: '4px',
  border: '1px solid var(--border-color)',
  cursor: 'pointer',
  background: primary ? 'var(--accent-amber)' : 'transparent',
  color: primary ? '#000' : 'var(--text-secondary)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
});

const Message = ({ msg }) =>
  msg ? (
    <div
      style={{
        marginTop: 6,
        fontSize: 11,
        padding: '6px 10px',
        borderRadius: 4,
        background: msg.type === 'success' ? 'rgba(46, 204, 113, 0.1)' : 'rgba(231, 76, 60, 0.1)',
        color: msg.type === 'success' ? '#2ecc71' : '#e74c3c',
      }}
    >
      {msg.type === 'success' ? '✓' : '✗'} {msg.text}
    </div>
  ) : null;

const Card = ({ icon, title, enabled, onToggle, children, statusLine }) => (
  <details
    style={{
      borderTop: '1px solid rgba(255,255,255,0.08)',
      paddingTop: 10,
      marginTop: 8,
    }}
  >
    <summary style={{ cursor: 'pointer', userSelect: 'none', listStyle: 'none' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
          {icon} {title}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 999,
            border: `1px solid ${enabled ? 'var(--accent-green)' : 'rgba(255,255,255,0.18)'}`,
            color: enabled ? 'var(--accent-green)' : 'var(--text-muted)',
          }}
        >
          {enabled ? 'ON' : 'OFF'}
        </span>
        {statusLine && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{statusLine}</span>}
      </span>
    </summary>
    <div style={{ marginTop: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Enable
      </label>
      {children}
    </div>
  </details>
);

const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString() : null);

export const LogSyncSettings = () => {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState(() => getLogsyncConfig());
  const [state, setState] = useState(() => getLogsyncState());
  const [pending, setPending] = useState({
    wavelog: getPendingCount('wavelog'),
    qrz: getPendingCount('qrz'),
  });
  const [cooldownMs, setCooldownMs] = useState(() => lotwCooldownRemainingMs());
  const [busy, setBusy] = useState({}); // { wavelog|qrz|lotw|lotwSync|push: bool }
  const [messages, setMessages] = useState({}); // { service: {type, text} }
  const [wavelogStations, setWavelogStations] = useState([]);

  useEffect(() => {
    const refresh = () => {
      setPending({ wavelog: getPendingCount('wavelog'), qrz: getPendingCount('qrz') });
      setState(getLogsyncState());
      setCooldownMs(lotwCooldownRemainingMs());
    };
    const unsub = subscribeLogsync(refresh);
    const timer = setInterval(() => setCooldownMs(lotwCooldownRemainingMs()), 15000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const setService = (service, fields) => {
    setLogsyncServiceConfig(service, fields);
    setCfg(getLogsyncConfig());
  };

  const flash = (service, type, text) => {
    setMessages((m) => ({ ...m, [service]: { type, text } }));
  };

  const run = async (name, fn) => {
    setBusy((b) => ({ ...b, [name]: true }));
    try {
      await fn();
    } finally {
      setBusy((b) => ({ ...b, [name]: false }));
    }
  };

  const pushAll = (service) =>
    run('push', async () => {
      const { pushed, failed } = await processQueue();
      flash(
        service,
        failed ? 'error' : 'success',
        t('station.settings.logsync.pushResult', {
          defaultValue: 'Pushed {{pushed}}, {{failed}} failed (kept for retry)',
          pushed,
          failed,
        }),
      );
    });

  const cooldownMin = Math.ceil(cooldownMs / 60000);

  return (
    <div
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        padding: '14px 16px',
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>🔄 {t('station.settings.logsync.title', 'Logbook Sync')}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 6, lineHeight: 1.45 }}>
        {t(
          'station.settings.logsync.describe',
          'Push QSOs you log in OpenHamClock to Wavelog/Cloudlog or your QRZ Logbook, and pull LoTW confirmations into your local log. All credentials are stored only in this browser — never on the server, never in backups — and each request carries your own keys, so this works per-user on shared/hosted instances.',
        )}
      </div>

      {/* Wavelog / Cloudlog */}
      <Card
        icon="🌊"
        title={t('station.settings.logsync.wavelog.title', 'Wavelog / Cloudlog push')}
        enabled={!!cfg.wavelog.enabled}
        onToggle={(v) => setService('wavelog', { enabled: v })}
        statusLine={
          pending.wavelog > 0
            ? t('station.settings.logsync.pending', { defaultValue: '{{count}} pending', count: pending.wavelog })
            : fmtTime(state.wavelogLastPushAt)
              ? t('station.settings.logsync.lastPush', {
                  defaultValue: 'last push {{time}}',
                  time: fmtTime(state.wavelogLastPushAt),
                })
              : null
        }
      >
        <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 8, lineHeight: 1.45 }}>
          {t(
            'station.settings.logsync.wavelog.describe',
            'New QSOs are pushed automatically (with a retry queue). The Station Profile ID is shown by the Test button, or in the URL when editing a station profile in Wavelog.',
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <input
            type="text"
            value={cfg.wavelog.url}
            onChange={(e) => setService('wavelog', { url: e.target.value })}
            placeholder={t('station.settings.logsync.wavelog.url', 'Wavelog URL (https://log.example.com)')}
            aria-label={t('station.settings.logsync.wavelog.url', 'Wavelog URL (https://log.example.com)')}
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, flex: '2 1 240px' }}
          />
          <input
            type="password"
            value={cfg.wavelog.apiKey}
            onChange={(e) => setService('wavelog', { apiKey: e.target.value })}
            placeholder={t('station.settings.logsync.wavelog.key', 'API key')}
            aria-label={t('station.settings.logsync.wavelog.key', 'API key')}
            autoComplete="off"
            style={inputStyle}
          />
          <input
            type="text"
            value={cfg.wavelog.stationProfileId}
            onChange={(e) => setService('wavelog', { stationProfileId: e.target.value.replace(/[^\d]/g, '') })}
            placeholder={t('station.settings.logsync.wavelog.station', 'Station Profile ID')}
            aria-label={t('station.settings.logsync.wavelog.station', 'Station Profile ID')}
            autoComplete="off"
            style={{ ...inputStyle, flex: '0 1 130px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy.wavelog || !cfg.wavelog.url || !cfg.wavelog.apiKey}
            onClick={() =>
              run('wavelog', async () => {
                try {
                  const r = await testWavelog({ url: cfg.wavelog.url, key: cfg.wavelog.apiKey });
                  setWavelogStations(r.stations || []);
                  const list = (r.stations || [])
                    .map((s) => `#${s.station_id} ${s.station_callsign || ''} (${s.station_profile_name || ''})`)
                    .join(', ');
                  flash(
                    'wavelog',
                    'success',
                    t('station.settings.logsync.wavelog.testOk', {
                      defaultValue: 'Connected — station profiles: {{list}}',
                      list: list || '—',
                    }),
                  );
                } catch (err) {
                  flash('wavelog', 'error', String(err?.message || err));
                }
              })
            }
            style={btnStyle(false)}
          >
            {busy.wavelog ? '…' : t('station.settings.logsync.test', 'Test')}
          </button>
          <button
            type="button"
            disabled={busy.push || pending.wavelog === 0}
            onClick={() => pushAll('wavelog')}
            style={btnStyle(pending.wavelog > 0)}
          >
            {t('station.settings.logsync.pushAll', {
              defaultValue: 'Push all unsynced ({{count}})',
              count: pending.wavelog,
            })}
          </button>
        </div>
        <Message msg={messages.wavelog} />

        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              marginBottom: 6,
            }}
          >
            <input
              type="checkbox"
              checked={!!cfg.wavelog.pullEnabled}
              onChange={(e) => setService('wavelog', { pullEnabled: e.target.checked })}
            />
            {t('station.settings.logsync.wavelog.pullEnable', 'Pull QSOs from Wavelog into this logbook')}
          </label>

          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: 11,
              marginBottom: 8,
              lineHeight: 1.45,
            }}
          >
            {t(
              'station.settings.logsync.wavelog.pullDescribe',
              'Imports new Wavelog QSOs into the native OpenHamClock logbook. Use Test above to load your station profiles, then choose which profiles to include.',
            )}
          </div>

          {wavelogStations.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {wavelogStations.map((station) => {
                const id = Number(station.station_id);
                const selected = (cfg.wavelog.pullStationIds || []).map(Number).includes(id);

                return (
                  <label
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 11,
                      marginBottom: 4,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = (cfg.wavelog.pullStationIds || [])
                          .map(Number)
                          .filter((n) => Number.isInteger(n) && n > 0);

                        const next = e.target.checked
                          ? [...new Set([...current, id])]
                          : current.filter((n) => n !== id);

                        setService('wavelog', { pullStationIds: next });
                      }}
                    />
                    #{id} {station.station_callsign || ''}
                    {station.station_profile_name ? ` — ${station.station_profile_name}` : ''}
                  </label>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              disabled={
                busy.wavelogPull ||
                !cfg.wavelog.pullEnabled ||
                !cfg.wavelog.url ||
                !cfg.wavelog.apiKey ||
                !(cfg.wavelog.pullStationIds || []).length
              }
              onClick={() =>
                run('wavelogPull', async () => {
                  try {
                    const r = await syncWavelogQsos({ parseAdif });
                    flash(
                      'wavelogPull',
                      'success',
                      t('station.settings.logsync.wavelog.pullResult', {
                        defaultValue: 'Fetched {{fetched}} — imported {{imported}}, skipped {{skipped}}',
                        fetched: r.fetched,
                        imported: r.imported,
                        skipped: r.skipped,
                      }),
                    );
                  } catch (err) {
                    flash('wavelogPull', 'error', String(err?.message || err));
                  }
                })
              }
              style={btnStyle(true)}
            >
              {busy.wavelogPull ? '…' : t('station.settings.logsync.wavelog.syncNow', 'Sync now')}
            </button>

            {fmtTime(state.wavelogLastPullAt) && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {t('station.settings.logsync.wavelog.lastPull', {
                  defaultValue: 'last pull {{time}}',
                  time: fmtTime(state.wavelogLastPullAt),
                })}
              </span>
            )}
          </div>

          <Message msg={messages.wavelogPull} />
        </div>
      </Card>

      {/* QRZ Logbook */}
      <Card
        icon="📕"
        title={t('station.settings.logsync.qrz.title', 'QRZ Logbook push')}
        enabled={!!cfg.qrz.enabled}
        onToggle={(v) => setService('qrz', { enabled: v })}
        statusLine={
          pending.qrz > 0
            ? t('station.settings.logsync.pending', { defaultValue: '{{count}} pending', count: pending.qrz })
            : fmtTime(state.qrzLastPushAt)
              ? t('station.settings.logsync.lastPush', {
                  defaultValue: 'last push {{time}}',
                  time: fmtTime(state.qrzLastPushAt),
                })
              : null
        }
      >
        <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 8, lineHeight: 1.45 }}>
          {t(
            'station.settings.logsync.qrz.describe',
            'Uses a QRZ Logbook API key (Logbook → Settings → API on qrz.com; requires an XML subscription). This is NOT your QRZ username/password used for callsign lookups.',
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <input
            type="password"
            value={cfg.qrz.apiKey}
            onChange={(e) => setService('qrz', { apiKey: e.target.value })}
            placeholder={t('station.settings.logsync.qrz.key', 'QRZ Logbook API key')}
            aria-label={t('station.settings.logsync.qrz.key', 'QRZ Logbook API key')}
            autoComplete="off"
            style={inputStyle}
          />
          <button
            type="button"
            disabled={busy.qrz || !cfg.qrz.apiKey}
            onClick={() =>
              run('qrz', async () => {
                try {
                  const r = await testQrz({ key: cfg.qrz.apiKey });
                  flash(
                    'qrz',
                    'success',
                    t('station.settings.logsync.qrz.testOk', {
                      defaultValue: 'Connected — logbook has {{count}} QSOs',
                      count: r.data?.COUNT ?? r.count ?? '?',
                    }),
                  );
                } catch (err) {
                  flash('qrz', 'error', String(err?.message || err));
                }
              })
            }
            style={btnStyle(false)}
          >
            {busy.qrz ? '…' : t('station.settings.logsync.test', 'Test')}
          </button>
          <button
            type="button"
            disabled={busy.push || pending.qrz === 0}
            onClick={() => pushAll('qrz')}
            style={btnStyle(pending.qrz > 0)}
          >
            {t('station.settings.logsync.pushAll', {
              defaultValue: 'Push all unsynced ({{count}})',
              count: pending.qrz,
            })}
          </button>
        </div>
        <Message msg={messages.qrz} />
      </Card>

      {/* LoTW */}
      <Card
        icon="🏛️"
        title={t('station.settings.logsync.lotw.title', 'LoTW confirmations')}
        enabled={!!cfg.lotw.enabled}
        onToggle={(v) => setService('lotw', { enabled: v })}
        statusLine={
          state.lotwLastResult
            ? t('station.settings.logsync.lotw.lastResult', {
                defaultValue: 'last sync: {{matched}} matched, {{unmatched}} unmatched',
                matched: state.lotwLastResult.matched,
                unmatched: state.lotwLastResult.unmatched,
              })
            : null
        }
      >
        <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 8, lineHeight: 1.45 }}>
          {t(
            'station.settings.logsync.lotw.describe',
            'Pulls confirmed QSLs from Logbook of The World and marks matching QSOs in your local log (call + band + mode + time within 30 minutes). Uses your LoTW website login. LoTW is slow — syncs are limited to once every 5 minutes.',
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <input
            type="text"
            value={cfg.lotw.username}
            onChange={(e) => setService('lotw', { username: e.target.value })}
            placeholder={t('station.settings.logsync.lotw.user', 'LoTW username (usually your call)')}
            aria-label={t('station.settings.logsync.lotw.user', 'LoTW username (usually your call)')}
            autoComplete="off"
            spellCheck={false}
            style={inputStyle}
          />
          <input
            type="password"
            value={cfg.lotw.password}
            onChange={(e) => setService('lotw', { password: e.target.value })}
            placeholder={t('station.settings.logsync.lotw.pass', 'LoTW password')}
            aria-label={t('station.settings.logsync.lotw.pass', 'LoTW password')}
            autoComplete="off"
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy.lotw || !cfg.lotw.username || !cfg.lotw.password}
            onClick={() =>
              run('lotw', async () => {
                try {
                  await testLotw({ username: cfg.lotw.username, password: cfg.lotw.password });
                  flash('lotw', 'success', t('station.settings.logsync.lotw.testOk', 'LoTW login OK'));
                } catch (err) {
                  flash('lotw', 'error', String(err?.message || err));
                }
              })
            }
            style={btnStyle(false)}
          >
            {busy.lotw ? '…' : t('station.settings.logsync.test', 'Test')}
          </button>
          <button
            type="button"
            disabled={busy.lotwSync || !cfg.lotw.enabled || !cfg.lotw.username || !cfg.lotw.password || cooldownMs > 0}
            onClick={() =>
              run('lotwSync', async () => {
                try {
                  const r = await syncLotwConfirmations({ parseAdif });
                  flash(
                    'lotw',
                    'success',
                    t('station.settings.logsync.lotw.syncResult', {
                      defaultValue: '{{matched}} confirmations matched, {{unmatched}} unmatched',
                      matched: r.matched,
                      unmatched: r.unmatched,
                    }),
                  );
                } catch (err) {
                  flash('lotw', 'error', String(err?.message || err));
                }
              })
            }
            style={btnStyle(true)}
          >
            {busy.lotwSync
              ? '…'
              : cooldownMs > 0
                ? t('station.settings.logsync.lotw.cooldown', {
                    defaultValue: 'Sync (wait {{min}} min)',
                    min: cooldownMin,
                  })
                : t('station.settings.logsync.lotw.sync', 'Sync LoTW confirmations')}
          </button>
          {state.lotwLastSyncAt && (
            <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
              {t('station.settings.logsync.lastSync', {
                defaultValue: 'last sync {{time}}',
                time: fmtTime(state.lotwLastSyncAt),
              })}
            </span>
          )}
        </div>
        <Message msg={messages.lotw} />
      </Card>
    </div>
  );
};

export default LogSyncSettings;

/**
 * Lightning guard settings.
 *
 *  • LightningGuardSettings — Settings → Alerts card: enable, warning/alarm
 *    radii, all-clear time, strikes needed, alert channels (tone, spoken,
 *    browser notification, Web Push), the Rig Bridge relay, live status with
 *    the manual relay override, and "Simulate strike" buttons. Persists in
 *    the shared alert-settings blob (`lightningGuard`), handed in by
 *    AudioAlertsTab like the spoken-alerts card so the two never overwrite
 *    each other.
 *  • LightningRelayPinSettings — Settings → Rig Bridge card: which GPIO line
 *    drives the relay (lightningOut), fail-safe polarity and hold-when-quiet,
 *    pushed to the bridge's /api/config.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TONE_PRESETS, playTone } from '../utils/audioAlerts';
import { getNotificationPermission } from '../utils/notifications';
import { getPushSubscription, getServerPushStatus, isPushSupported, subscribeToPush } from '../utils/push';
import { getAlertSettings } from '../utils/audioAlerts';
import { GUARD_DEFAULTS, normalizeGuardSettings } from '../utils/lightningGuard.js';
import { simulateStrike, useLightningGuardStatus } from '../hooks/useLightningGuard.js';
import { buildRigUrl } from '../contexts/RigContext.jsx';
import { LightningGuardDetails } from './LightningGuardIndicator.jsx';

const cardStyle = (on) => ({
  background: 'var(--bg-tertiary)',
  border: `1px solid ${on ? 'var(--accent-amber)' : 'var(--border-color)'}`,
  borderRadius: '8px',
  padding: '14px',
});

const pillStyle = (on, disabled = false) => ({
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

const inputStyle = {
  width: '72px',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '5px 6px',
  fontSize: '12px',
  fontFamily: 'var(--font-mono)',
};

const noteStyle = { color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' };
const warnBoxStyle = {
  border: '1px solid var(--accent-red, #ef4444)',
  background: 'rgba(239, 68, 68, 0.08)',
  borderRadius: '6px',
  padding: '8px 10px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  lineHeight: '1.5',
};

/** Number input that commits on blur / Enter, so typing "5" on the way to "50" doesn't clamp anything. */
function NumberField({ value, onCommit, label, min, max, step = 1, suffix }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-primary)' }}
    >
      <span style={{ minWidth: '150px', color: 'var(--text-muted)' }}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-label={label}
        style={inputStyle}
      />
      {suffix && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{suffix}</span>}
    </label>
  );
}

const kmHint = (km, imperial) => (imperial ? `km (≈ ${Math.round(km * 0.621371)} mi)` : 'km');

export function LightningGuardSettings({ alertSettings, updateSettings, imperial = false, hasLocation = true }) {
  const { t } = useTranslation();
  const g = normalizeGuardSettings(alertSettings?.lightningGuard);
  const status = useLightningGuardStatus();
  const [pushStatus, setPushStatus] = useState(null); // null = checking; { available, broadcast }
  const [pushError, setPushError] = useState(null);
  const notifGranted = getNotificationPermission() === 'granted';
  const pushAvailable = pushStatus ? pushStatus.available : null;

  useEffect(() => {
    let alive = true;
    getServerPushStatus().then(
      (s) =>
        alive &&
        setPushStatus({
          available: isPushSupported() && !!(s.configured && s.lightning),
          broadcast: !!s.lightningBroadcast,
        }),
    );
    return () => {
      alive = false;
    };
  }, []);

  // Ticking Web Push subscribes this browser first if needed (inside the click:
  // the permission prompt needs a user gesture). The engine then opts the
  // subscription in with the station location and radii.
  const togglePush = async (on) => {
    setPushError(null);
    if (!on) return setChannel('push', false);
    if (!(await getPushSubscription())) {
      const r = await subscribeToPush();
      if (!r.ok) {
        setPushError(r.reason || 'failed');
        return undefined;
      }
    }
    // Re-read: the subscribe flow may have taken a while
    const latest = getAlertSettings();
    const cur = normalizeGuardSettings(latest.lightningGuard);
    updateSettings({
      ...latest,
      lightningGuard: normalizeGuardSettings({ ...cur, channels: { ...cur.channels, push: true } }),
    });
    return undefined;
  };

  const set = (patch) =>
    updateSettings({ ...alertSettings, lightningGuard: normalizeGuardSettings({ ...g, ...patch }) });
  const setChannel = (k, v) => set({ channels: { ...g.channels, [k]: v } });
  const setRelay = (patch) => set({ relay: { ...g.relay, ...patch } });

  const check = (checked, onChange, label, disabled = false, hint = null) => (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        fontSize: '12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      title={hint || undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--accent-amber)' }}
      />
      {label}
    </label>
  );

  return (
    <div style={cardStyle(g.enabled)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600 }}>
          ⚡ {t('lightningGuard.settings.title', { defaultValue: 'Lightning guard' })}
        </span>
        <button
          type="button"
          onClick={() => set({ enabled: !g.enabled })}
          aria-pressed={g.enabled}
          aria-label={t('lightningGuard.settings.title', { defaultValue: 'Lightning guard' })}
          style={pillStyle(g.enabled)}
        >
          {g.enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <div style={{ ...noteStyle, marginTop: '6px' }}>
        {t('lightningGuard.settings.description', {
          defaultValue:
            'Watches real-time lightning (Blitzortung.org) around your station — also while the Lightning map layer is off. A strike inside the warning radius raises a warning, one inside the alarm radius an alarm; the all-clear comes after the set time without strikes nearby. Optional: a Rig Bridge relay disconnects the antenna during the alarm. (This replaces the former Lightning Proximity tone.)',
        })}
      </div>
      {g.enabled && !hasLocation && (
        <div style={{ ...noteStyle, color: 'var(--accent-red, #ef4444)', marginTop: '6px' }}>
          {t('lightningGuard.settings.noLocation', {
            defaultValue: 'Set your station location (Settings → Station) — distances are measured from DE.',
          })}
        </div>
      )}

      {g.enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
          <NumberField
            label={t('lightningGuard.settings.warnRadius', { defaultValue: 'Warning radius' })}
            value={g.warnKm}
            min={2}
            max={500}
            onCommit={(v) => set({ warnKm: v })}
            suffix={kmHint(g.warnKm, imperial)}
          />
          <NumberField
            label={t('lightningGuard.settings.alarmRadius', { defaultValue: 'Alarm radius' })}
            value={g.alarmKm}
            min={1}
            max={500}
            onCommit={(v) => set({ alarmKm: v })}
            suffix={kmHint(g.alarmKm, imperial)}
          />
          <NumberField
            label={t('lightningGuard.settings.allClear', { defaultValue: 'All-clear after' })}
            value={g.allClearMin}
            min={1}
            max={240}
            onCommit={(v) => set({ allClearMin: v })}
            suffix="min"
          />
          <NumberField
            label={t('lightningGuard.settings.minStrikes', { defaultValue: 'Strikes needed' })}
            value={g.minStrikes}
            min={1}
            max={50}
            onCommit={(v) => set({ minStrikes: v })}
            suffix={t('lightningGuard.settings.minStrikesSuffix', { defaultValue: 'within 10 min' })}
          />
          <NumberField
            label={t('lightningGuard.settings.hysteresis', { defaultValue: 'Hysteresis' })}
            value={g.hysteresisPct}
            min={0}
            max={100}
            onCommit={(v) => set({ hysteresisPct: v })}
            suffix="%"
          />
          <div style={noteStyle}>
            {t('lightningGuard.settings.hysteresisNote', {
              defaultValue:
                'A level starts at its radius but is held by strikes out to {{warnExit}} km (warning) and {{alarmExit}} km (alarm), so a storm on the edge does not flap the alarm. 0 % turns this off. Defaults: {{defaultWarn}} km warning, {{defaultAlarm}} km alarm, {{defaultPct}} %.',
              warnExit: Math.round(g.warnKm * (1 + g.hysteresisPct / 100)),
              alarmExit: Math.round(g.alarmKm * (1 + g.hysteresisPct / 100)),
              defaultWarn: GUARD_DEFAULTS.warnKm,
              defaultAlarm: GUARD_DEFAULTS.alarmKm,
              defaultPct: GUARD_DEFAULTS.hysteresisPct,
            })}
          </div>
          {check(
            g.repeatCloser,
            (v) => set({ repeatCloser: v }),
            t('lightningGuard.settings.repeatCloser', {
              defaultValue:
                'Alert again during an alarm when lightning comes much closer (half the distance, or inside 10 km; at most every 2 min)',
            }),
          )}

          <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>
            {t('lightningGuard.settings.channels', { defaultValue: 'Alert with' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {check(
              g.channels.tone,
              (v) => setChannel('tone', v),
              t('lightningGuard.settings.channelTone', { defaultValue: 'Tone' }),
            )}
            <select
              value={g.tone}
              onChange={(e) => set({ tone: e.target.value })}
              aria-label={t('lightningGuard.settings.tone', { defaultValue: 'Lightning guard tone' })}
              style={{ ...inputStyle, width: 'auto' }}
            >
              {Object.entries(TONE_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => playTone(g.tone, alertSettings.volume ?? 0.5)}
              aria-label={t('lightningGuard.settings.previewTone', { defaultValue: 'Preview tone' })}
              title={t('lightningGuard.settings.previewTone', { defaultValue: 'Preview tone' })}
              style={pillStyle(false)}
            >
              🔊
            </button>
          </div>
          {check(
            g.channels.speech,
            (v) => setChannel('speech', v),
            t('lightningGuard.settings.channelSpeech', { defaultValue: 'Spoken alert' }),
          )}
          {check(
            g.channels.notify,
            (v) => setChannel('notify', v),
            t('lightningGuard.settings.channelNotify', { defaultValue: 'Browser notification' }),
            false,
            notifGranted
              ? null
              : t('lightningGuard.settings.notifyNeedsPermission', {
                  defaultValue: 'Turn on Browser Notifications at the top of this tab to allow notifications.',
                }),
          )}
          {g.channels.notify && !notifGranted && (
            <div style={noteStyle}>
              {t('lightningGuard.settings.notifyNeedsPermission', {
                defaultValue: 'Turn on Browser Notifications at the top of this tab to allow notifications.',
              })}
            </div>
          )}
          {check(
            g.channels.push && !!pushAvailable,
            (v) => togglePush(v),
            t('lightningGuard.settings.channelPush', { defaultValue: 'Web Push (also with the browser closed)' }),
            !pushAvailable,
          )}
          {pushAvailable === false && (
            <div style={noteStyle}>
              {t('lightningGuard.settings.pushUnavailable', {
                defaultValue:
                  'Web Push is not available here — it needs HTTPS and a server with Web Push keys (self-hosters: see the manual).',
              })}
            </div>
          )}
          {pushAvailable && g.channels.push && (
            <div style={noteStyle}>
              {pushStatus?.broadcast
                ? t('lightningGuard.settings.pushBroadcast', {
                    defaultValue:
                      'This server sends lightning pushes to every subscriber (PUSH_LIGHTNING_BROADCAST) — meant for a server only you use.',
                  })
                : t('lightningGuard.settings.pushNote', {
                    defaultValue:
                      "Your station location (rounded to about 1 km) and radii are stored with this browser's push subscription on this server, so it can push strikes near you — also ones reported by other stations nearby. Untick to remove them.",
                  })}
            </div>
          )}
          {pushError && (
            <div style={{ ...noteStyle, color: 'var(--accent-red, #ef4444)' }}>
              {t('lightningGuard.settings.pushSubscribeFailed', {
                defaultValue: 'Could not subscribe this browser to push ({{reason}}).',
                reason: pushError,
              })}
            </div>
          )}

          <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>
            {t('lightningGuard.settings.relayTitle', { defaultValue: 'Antenna relay' })}
          </div>
          {check(
            g.relay.enabled,
            (v) => setRelay({ enabled: v }),
            t('lightningGuard.settings.relayEnable', {
              defaultValue: 'Drive the Rig Bridge lightning relay (GPIO lightningOut)',
            }),
          )}
          {g.relay.enabled && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <span style={{ minWidth: '150px', color: 'var(--text-muted)' }}>
                  {t('lightningGuard.settings.relayOn', { defaultValue: 'Engage the relay at' })}
                </span>
                <select
                  value={g.relay.on}
                  onChange={(e) => setRelay({ on: e.target.value })}
                  aria-label={t('lightningGuard.settings.relayOn', { defaultValue: 'Engage the relay at' })}
                  style={{ ...inputStyle, width: 'auto' }}
                >
                  <option value="alarm">{t('lightningGuard.settings.relayOnAlarm', { defaultValue: 'Alarm' })}</option>
                  <option value="warn">{t('lightningGuard.settings.relayOnWarn', { defaultValue: 'Warning' })}</option>
                </select>
              </label>
              <div style={noteStyle}>
                {t('lightningGuard.settings.relayHowTo', {
                  defaultValue:
                    'Needs Rig Bridge enabled (local or Cloud Relay) with the GPIO plugin running and a relay line assigned in Settings → Rig Bridge. The relay releases automatically at the all-clear; if this browser goes away, Rig Bridge holds it for the all-clear time. With several displays it stays engaged while any of them wants it. The header ⚡ menu has a manual override.',
                })}
              </div>
            </>
          )}
          <div style={warnBoxStyle}>
            <strong>{t('lightningGuard.settings.safetyTitle', { defaultValue: 'Not a safety device.' })}</strong>{' '}
            {t('lightningGuard.settings.safetyText', {
              defaultValue:
                'The guard is a convenience. Lightning data can be late, incomplete or missing, and the browser or network can fail. It does not replace proper grounding, bonding, surge arrestors and disconnecting by hand when a storm is coming.',
            })}
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border-color)',
              paddingTop: '8px',
              marginTop: '4px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {status.enabled ? (
              <LightningGuardDetails status={status} />
            ) : (
              <div style={noteStyle}>
                {t('lightningGuard.settings.statusOff', { defaultValue: 'Waiting for the station location.' })}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={noteStyle}>{t('lightningGuard.settings.test', { defaultValue: 'Test:' })}</span>
            <button
              type="button"
              disabled={!status.enabled}
              onClick={() => simulateStrike(Math.max(0.5, g.alarmKm * 0.6), 45)}
              style={pillStyle(false, !status.enabled)}
            >
              {t('lightningGuard.settings.simulateAlarm', { defaultValue: 'Simulate alarm strike' })}
            </button>
            <button
              type="button"
              disabled={!status.enabled}
              onClick={() => simulateStrike((g.alarmKm * (1 + g.hysteresisPct / 100) + g.warnKm) / 2, 270)}
              style={pillStyle(false, !status.enabled)}
            >
              {t('lightningGuard.settings.simulateWarn', { defaultValue: 'Simulate warning strike' })}
            </button>
          </div>
          <div style={noteStyle}>
            {t('lightningGuard.settings.testNote', {
              defaultValue:
                'A simulated strike runs the whole chain — alerts, banner, EmComm log, the relay and a test push to this browser only — and shows on the Lightning map layer. With "Strikes needed" above 1, click more than once.',
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings → Rig Bridge: GPIO line for the lightning relay. */
/**
 * Does this Rig Bridge know the multi-display relay rules and take the guard
 * settings from the indicators? Older bridges have no `features` list in
 * /api/gpio/status (or no GPIO plugin at all).
 */
export function bridgeNeedsUpdate(gpioStatus) {
  if (!gpioStatus) return true;
  const f = Array.isArray(gpioStatus.features) ? gpioStatus.features : [];
  return !f.includes('lightning-arbiter') || !f.includes('lightning-guard-settings');
}

export function LightningRelayPinSettings({ rigEnabled, rigHost, rigPort, rigApiToken }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [failSafe, setFailSafe] = useState(false);
  const [hold, setHold] = useState(true);
  const [headless, setHeadless] = useState(false);
  const [loadState, setLoadState] = useState(null); // null | 'ok' | 'error'
  const [pushState, setPushState] = useState(null); // null | 'pushing' | 'ok' | 'error'
  const [gpioStatus, setGpioStatus] = useState(null);
  const [bridgeVersion, setBridgeVersion] = useState(null);
  const bridgeUrl = buildRigUrl({ host: rigHost, port: rigPort });
  const headers = { 'Content-Type': 'application/json', ...(rigApiToken ? { 'X-RigBridge-Token': rigApiToken } : {}) };

  const load = async () => {
    try {
      const [cfgRes, stRes, rootRes] = await Promise.all([
        fetch(`${bridgeUrl}/api/config`, { headers, signal: AbortSignal.timeout(4000) }),
        fetch(`${bridgeUrl}/api/gpio/status`, { headers, signal: AbortSignal.timeout(4000) }).catch(() => null),
        fetch(`${bridgeUrl}/`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) }).catch(
          () => null,
        ),
      ]);
      try {
        const root = rootRes && rootRes.ok ? await rootRes.json() : null;
        setBridgeVersion(typeof root?.version === 'string' ? root.version : null);
      } catch {
        setBridgeVersion(null);
      }
      if (!cfgRes.ok) throw new Error(`HTTP ${cfgRes.status}`);
      const cfg = await cfgRes.json();
      const g = cfg?.gpio || {};
      const p = g.pins?.lightningOut;
      setPin(p == null || p === -1 || p === '-1' ? '' : String(p));
      setFailSafe(!!g.lightningFailSafe);
      setHold(g.lightningHoldWhenStale !== false);
      setHeadless(!!g.lightningHeadless?.enabled);
      setGpioStatus(stRes && stRes.ok ? await stRes.json() : null);
      setLoadState('ok');
    } catch {
      setLoadState('error');
    }
  };

  useEffect(() => {
    if (rigEnabled) load();
  }, [rigEnabled, bridgeUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = async () => {
    setPushState('pushing');
    const raw = pin.trim();
    const pinValue = raw === '' ? -1 : /^\d+$/.test(raw) ? parseInt(raw, 10) : raw;
    try {
      const res = await fetch(`${bridgeUrl}/api/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          gpio: {
            pins: { lightningOut: pinValue },
            lightningFailSafe: failSafe,
            lightningHoldWhenStale: hold,
            // Location and guard settings reach the headless guard with the
            // indicators every display sends; only the switch is set here.
            lightningHeadless: { enabled: headless },
          },
        }),
      });
      setPushState(res.ok ? 'ok' : 'error');
      if (res.ok) setTimeout(load, 1500);
    } catch {
      setPushState('error');
    }
  };

  const running = gpioStatus?.running;
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
        ⚡ {t('lightningGuard.pin.title', { defaultValue: 'Lightning relay (GPIO)' })}
      </div>
      <div style={{ ...noteStyle, marginBottom: '10px' }}>
        {t('lightningGuard.pin.description', {
          defaultValue:
            "Which Raspberry Pi GPIO line drives the lightning relay (the GPIO plugin's lightningOut). The browser asks for the relay through the same connection as the other indicator lines (directly or through Cloud Relay); switch the relay on under Settings → Alerts → Lightning guard. In Cloud Relay mode set these on the Rig Bridge setup page instead.",
        })}
      </div>
      {!rigEnabled ? (
        <div style={noteStyle}>
          {t('lightningGuard.pin.needsBridge', { defaultValue: 'Enable Rig Bridge above to assign the relay line.' })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <span style={{ minWidth: '150px', color: 'var(--text-muted)' }}>
              {t('lightningGuard.pin.pin', { defaultValue: 'Relay GPIO (BCM)' })}
            </span>
            <input
              type="text"
              value={pin}
              placeholder={t('lightningGuard.pin.placeholder', { defaultValue: 'off' })}
              onChange={(e) => setPin(e.target.value)}
              aria-label={t('lightningGuard.pin.pin', { defaultValue: 'Relay GPIO (BCM)' })}
              style={{ ...inputStyle, width: '90px' }}
            />
            <span style={noteStyle}>
              {t('lightningGuard.pin.pinHint', {
                defaultValue: 'empty = off · suggested 25 (header pin 22) · "P22" also works',
              })}
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={failSafe}
              onChange={(e) => setFailSafe(e.target.checked)}
              style={{ accentColor: 'var(--accent-amber)' }}
            />
            {t('lightningGuard.pin.failSafe', {
              defaultValue: 'Fail-safe: energise the relay to keep the antenna connected',
            })}
          </label>
          <div style={noteStyle}>
            {t('lightningGuard.pin.failSafeHint', {
              defaultValue:
                'With fail-safe on, power loss, a crash or a stopped Rig Bridge releases the relay and the antenna is disconnected. Wire the antenna through the contacts that close when the coil is energised (NO).',
            })}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hold}
              onChange={(e) => setHold(e.target.checked)}
              style={{ accentColor: 'var(--accent-amber)' }}
            />
            {t('lightningGuard.pin.hold', {
              defaultValue: 'Hold the relay for the all-clear time when a display goes quiet',
            })}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
              style={{ accentColor: 'var(--accent-amber)' }}
            />
            {t('lightningGuard.pin.headless', {
              defaultValue: 'Also run the guard inside Rig Bridge (protects with no browser open)',
            })}
          </label>
          <div style={noteStyle}>
            {t('lightningGuard.pin.headlessHint', {
              defaultValue:
                "Rig Bridge then watches Blitzortung itself. Your station's location and the radii, all-clear time, hysteresis, repeat-alert and relay settings from Settings → Alerts → Lightning guard reach it with the indicators this display sends and are kept by the bridge — no need to push again after changing them. It counts as one more display: the relay is engaged while it or any open display wants it.",
            })}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={push} disabled={pushState === 'pushing'} style={pillStyle(true)}>
              {t('lightningGuard.pin.push', { defaultValue: 'Push to Rig Bridge' })}
            </button>
            <button type="button" onClick={load} style={pillStyle(false)}>
              {t('lightningGuard.pin.reload', { defaultValue: 'Reload' })}
            </button>
            {pushState === 'ok' && (
              <span style={{ color: 'var(--accent-green, #22c55e)', fontSize: '11px' }}>
                {t('lightningGuard.pin.pushed', { defaultValue: 'Saved in Rig Bridge' })}
              </span>
            )}
            {(pushState === 'error' || loadState === 'error') && (
              <span style={{ color: 'var(--accent-red, #ef4444)', fontSize: '11px' }}>
                {t('lightningGuard.pin.unreachable', { defaultValue: 'Rig Bridge not reachable' })}
              </span>
            )}
          </div>
          {loadState === 'ok' && bridgeNeedsUpdate(gpioStatus) && (
            <div role="status" style={{ ...warnBoxStyle, borderColor: 'var(--accent-amber)' }}>
              {t('lightningGuard.pin.updateBridge', {
                defaultValue:
                  'Update Rig Bridge: this bridge (version {{version}}) does not have the multi-display relay rules \u2014 it follows only the most recent display, does not hold the relay itself when a display goes quiet, and its headless guard does not pick up your guard settings. Download the current Rig Bridge from this tab, or run the updater.',
                version: bridgeVersion || '?',
              })}
            </div>
          )}
          {loadState === 'ok' && (
            <div style={noteStyle}>
              {running
                ? t('lightningGuard.pin.gpioRunning', {
                    defaultValue:
                      'GPIO plugin running ({{backend}}) · lightning relay: {{relay}} · displays reporting: {{displays}}',
                    backend: gpioStatus.backend || '?',
                    relay: gpioStatus.lightning?.pin != null ? (gpioStatus.lightning.relay ? 'ON' : 'OFF') : '—',
                    displays: (gpioStatus.lightning?.reporters || []).filter((r) => r.id !== 'bridge').length,
                  })
                : t('lightningGuard.pin.gpioOff', {
                    defaultValue:
                      'The GPIO plugin is not running — enable "Raspberry Pi GPIO" on the Rig Bridge setup page (Plugins).',
                  })}
              {running && gpioStatus.lightning?.headless && (
                <>
                  {' · '}
                  {t('lightningGuard.pin.headlessStatus', {
                    defaultValue: 'headless guard: {{level}} (feed {{feed}})',
                    level: gpioStatus.lightning.headless.level,
                    feed: gpioStatus.lightning.headless.connected ? 'OK' : '…',
                  })}
                </>
              )}
            </div>
          )}
          <div style={warnBoxStyle}>
            <strong>{t('lightningGuard.settings.safetyTitle', { defaultValue: 'Not a safety device.' })}</strong>{' '}
            {t('lightningGuard.pin.wiring', {
              defaultValue:
                'A Pi pin gives 3.3 V and a few mA: drive a relay MODULE (transistor + flyback diode on board), never a bare coil. Use a relay or coax switch rated for your RF power, and disconnect only on receive. This is a convenience, not lightning protection — it does not replace grounding, bonding and surge arrestors.',
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default LightningGuardSettings;

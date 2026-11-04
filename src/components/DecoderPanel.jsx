/**
 * DecoderPanel — "what my receiver actually hears".
 *
 * Listens to the receiver's audio in the browser — a sound-card / line input
 * (getUserMedia) or a KiwiSDR via Rig Bridge (directly or through the Cloud
 * Relay) — shows it on a live waterfall, and decodes it:
 *   CW   AudioWorklet decoder (src/utils/cwDecoder.js), with an off-tune
 *        warning when the passband sits beside a signal
 *   FT8  ft8_lib WebAssembly in a Web Worker (src/services/ft8/), one decode
 *        per 15 s UTC slot
 * Callsigns are clickable (callsign popup, set DX), FT8 rows carry the
 * worked-before / needed badge, and either can be kept in "My decodes".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRig } from '../contexts/RigContext.jsx';
import { useCallsignPopup } from './CallsignPopupManager.jsx';
import CallsignLink, { extractBaseCall } from './CallsignLink.jsx';
import DecoderWaterfall from './DecoderWaterfall.jsx';
import DecoderFt8Table from './DecoderFt8Table.jsx';
import { DecoderAudioEngine, audioDecoderSupported, listAudioInputs } from '../utils/decoderAudio.js';
import { findCallsigns, tokenizeCallsigns } from '../utils/cwDecoder.js';
import { kiwiTuneRequest, KIWI_CW_PITCH_HZ } from '../utils/kiwiAudioClient.js';
import { createFt8Client } from '../services/ft8/client.js';
import { sendRelayCommand } from '../utils/relaySign.js';
import { FT8_DIALS, ReceiverDelayTracker } from '../utils/ft8Dsp.js';
import {
  MY_DECODES_EVENT,
  addMyDecode,
  clearMyDecodes,
  loadMyDecodes,
  myDecodeToSpot,
  removeMyDecode,
} from '../utils/myDecodes.js';
import { apiFetch } from '../utils/apiFetch.js';
import { callbookAuthHeaders } from '../utils/callbookAuth.js';
import { openHelp } from '../utils/helpTopics.js';
import { useWorkedBefore } from '../hooks/useWorkedBefore.js';
import { useAwards } from '../hooks/useAwards.js';
import { spotBadge } from '../utils/awards.js';

const SETTINGS_KEY = 'ohc_decoder_settings';
const COPY_MAX = 4000;
const FT8_SLOTS_KEPT = 40;
const BANDWIDTHS = ['auto', 50, 100, 200, 300];
const DEFAULTS = {
  mode: 'cw', // 'cw' | 'ft8'
  source: 'mic',
  deviceId: '',
  tone: 600,
  bandwidth: 'auto',
  squelch: 'normal',
  kiwiFreqKhz: 14025,
  kiwiFt8Khz: 14074,
  kiwiMode: 'cw',
  monitor: false,
  cqOnly: false,
};

const loadSettings = () => {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}) };
  } catch {
    return { ...DEFAULTS };
  }
};

const btn = (accent, disabled) => ({
  padding: '3px 9px',
  fontSize: 11,
  borderRadius: 4,
  border: `1px solid ${accent || 'var(--border-color)'}`,
  background: accent ? `color-mix(in srgb, ${accent} 18%, transparent)` : 'var(--bg-tertiary)',
  color: disabled ? 'var(--text-muted)' : accent || 'var(--text-primary)',
  cursor: disabled ? 'default' : 'pointer',
  fontFamily: 'inherit',
  opacity: disabled ? 0.6 : 1,
});

const field = {
  padding: '2px 4px',
  fontSize: 11,
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 3,
  fontFamily: 'var(--font-mono)',
};

const fmtTime = (ms) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}z`;
};

/** Notice for plain-http pages: why, and where the HTTPS address is. */
function InsecureNotice({ t }) {
  const [httpsPort, setHttpsPort] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => alive && c?.lanHttpsPort && setHttpsPort(c.lanHttpsPort))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const httpsUrl =
    httpsPort && typeof window !== 'undefined'
      ? `https://${window.location.hostname}:${httpsPort}${window.location.pathname}`
      : null;
  return (
    <div className="panel" style={{ padding: 12, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 6 }}>
        🎧 {t('decoder.title', { defaultValue: 'DECODER' })}
      </div>
      <div>
        {t('decoder.needsSecure', {
          defaultValue:
            'Listening to audio in the browser needs a secure page: open OpenHamClock over HTTPS, on localhost, or in the desktop app.',
        })}
      </div>
      {httpsUrl ? (
        <div style={{ marginTop: 8 }}>
          {t('decoder.httpsAvailable', { defaultValue: 'This server also answers on HTTPS:' })}{' '}
          <a href={httpsUrl} style={{ color: 'var(--accent-cyan)' }}>
            {httpsUrl}
          </a>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => openHelp('decoder-https')}
        style={{ ...btn('var(--accent-cyan)'), marginTop: 8 }}
      >
        {t('decoder.httpsHelp', { defaultValue: 'How to listen from another computer on the LAN' })}
      </button>
    </div>
  );
}

export default function DecoderPanel({ onSetDX, dxLocked = false, onSpotClick, apiToken = '' }) {
  const { t } = useTranslation();
  const rig = useRig();
  const { showPopup } = useCallsignPopup();
  const { getStatus: getWorkedStatus } = useWorkedBefore();
  const { getSpotStatus: getAwardStatus } = useAwards();

  const [settings, setSettings] = useState(loadSettings);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [copy, setCopy] = useState('');
  const [meter, setMeter] = useState({ wpm: 0, snrDb: 0, keyed: false, bandwidth: null, finding: false, offTuneHz: 0 });
  const [devices, setDevices] = useState([]);
  const [tab, setTab] = useState(() => (loadSettings().mode === 'ft8' ? 'ft8' : 'copy'));
  const [myDecodes, setMyDecodes] = useState(loadMyDecodes);
  const [kiwiStatus, setKiwiStatus] = useState(null);
  const [sampleRate, setSampleRate] = useState(0);
  const [ft8Slots, setFt8Slots] = useState([]);
  const [ft8State, setFt8State] = useState({ status: null, message: '', lastDecodeMs: 0 });
  const [now, setNow] = useState(() => Date.now());

  const engineRef = useRef(null);
  const ft8Ref = useRef(null);
  const delayRef = useRef(null);
  const copyRef = useRef(null);
  const noteTimer = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const supported = audioDecoderSupported();
  const secure = typeof window === 'undefined' || window.isSecureContext !== false;
  const relaySession = rig?.isCloudRelay ? rig?.relaySession || null : null;
  const bridgeUrl = rig?.enabled && !rig?.isCloudRelay ? rig?.rigUrl : null;
  const isFt8 = settings.mode === 'ft8';
  const kiwiFreq = isFt8 ? Number(settings.kiwiFt8Khz) : Number(settings.kiwiFreqKhz);
  const kiwiMode = isFt8 ? 'usb' : settings.kiwiMode || 'cw';

  const flash = useCallback((msg) => {
    setNote(msg);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 3000);
  }, []);

  const update = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable — settings just won't persist
      }
      return next;
    });
  }, []);

  // ── devices ──
  const refreshDevices = useCallback(async () => setDevices(await listAudioInputs()), []);
  useEffect(() => {
    refreshDevices();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refreshDevices);
    return () => md?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  // ── my decodes list ──
  useEffect(() => {
    const onChange = () => setMyDecodes(loadMyDecodes());
    window.addEventListener(MY_DECODES_EVENT, onChange);
    return () => window.removeEventListener(MY_DECODES_EVENT, onChange);
  }, []);

  // ── FT8 slot clock (only while listening in FT8) ──
  useEffect(() => {
    if (!running || !isFt8) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running, isFt8]);

  // ── Kiwi relay status (direct bridge only; the relay has no status route) ──
  useEffect(() => {
    if (settings.source !== 'kiwi' || !bridgeUrl) {
      setKiwiStatus(null);
      return undefined;
    }
    const ctrl = new AbortController();
    fetch(`${bridgeUrl}/api/kiwi-audio/status`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setKiwiStatus(s || { enabled: false }))
      .catch(() => setKiwiStatus({ unreachable: true }));
    return () => ctrl.abort();
  }, [settings.source, bridgeUrl]);

  // ── engine ──
  const stop = useCallback(async () => {
    const eng = engineRef.current;
    engineRef.current = null;
    ft8Ref.current?.terminate();
    ft8Ref.current = null;
    setRunning(false);
    setStatus('');
    setMeter((m) => ({ ...m, keyed: false, finding: false, offTuneHz: 0 }));
    if (eng) await eng.stop();
  }, []);

  useEffect(() => () => void stop(), [stop]);

  const onUpdate = useCallback(
    (msg) => {
      if (msg?.type !== 'update') return;
      if (msg.text) setCopy((prev) => (prev + msg.text).slice(-COPY_MAX));
      if (msg.state) setMeter(msg.state);
      if (msg.found) {
        if (msg.found.freq) {
          setSettings((prev) => {
            const next = { ...prev, tone: msg.found.freq };
            try {
              localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
            } catch {
              // ignore
            }
            return next;
          });
          flash(t('decoder.find.locked', { defaultValue: 'Locked to {{hz}} Hz', hz: msg.found.freq }));
        } else {
          flash(t('decoder.find.none', { defaultValue: 'No clear tone found — click a trace instead' }));
        }
      }
    },
    [flash, t],
  );

  const onFt8Slot = useCallback((r) => {
    const decodes = r.decodes || [];
    const trk = delayRef.current;
    // KiwiSDR: learn the receive-path delay from the decodes; the audio is
    // re-timed by it (see onPcm below) so DT reads true and slots line up.
    if (trk) trk.add(decodes.map((d) => d.dt));
    setFt8State((s) => ({ ...s, lastDecodeMs: r.decodeMs, message: r.error || '', delayS: trk ? trk.delayS : 0 }));
    setFt8Slots((prev) => [{ slotStartMs: r.slotStartMs, decodes }, ...prev].slice(0, FT8_SLOTS_KEPT));
  }, []);

  const start = useCallback(async () => {
    setError('');
    setBusy(true);
    const s = settingsRef.current;
    const ft8 = s.mode === 'ft8';
    if (ft8) {
      delayRef.current = s.source === 'kiwi' ? new ReceiverDelayTracker() : null;
      ft8Ref.current = createFt8Client({
        emitAtSec: s.source === 'kiwi' ? 15.4 : undefined,
        onSlot: onFt8Slot,
        onStatus: (st, message) => setFt8State((prev) => ({ ...prev, status: st, message: message || '' })),
      });
    }
    const eng = new DecoderAudioEngine({
      onUpdate,
      onPcm: (samples, rate, endTimeMs) =>
        ft8Ref.current?.push(samples, rate, endTimeMs - (delayRef.current?.delayS || 0) * 1000),
      onStatus: setStatus,
      onError: (err) => {
        setError(err?.message || String(err));
        stop();
      },
    });
    engineRef.current = eng;
    try {
      await eng.start({
        source: s.source,
        mode: ft8 ? 'ft8' : 'cw',
        deviceId: s.deviceId,
        tone: s.tone,
        bandwidth: s.bandwidth,
        squelch: s.squelch,
        kiwi: {
          bridgeUrl,
          token: apiToken,
          relaySession,
          freqKhz: ft8 ? Number(s.kiwiFt8Khz) : Number(s.kiwiFreqKhz),
          mode: ft8 ? 'usb' : s.kiwiMode || 'cw',
        },
      });
      if (engineRef.current !== eng) return;
      eng.setMonitor(s.monitor);
      setSampleRate(eng.sampleRate);
      setRunning(true);
      if (s.source === 'mic') refreshDevices(); // labels appear once permission is granted
      // A KiwiSDR in CW mode puts the station on the entered frequency at a
      // known pitch — start there; Find is still one click away.
      if (!ft8 && s.source === 'kiwi') {
        const pitch = eng.kiwiCwPitch || KIWI_CW_PITCH_HZ;
        update({ tone: pitch });
        eng.setTone(pitch);
      }
    } catch (err) {
      engineRef.current = null;
      ft8Ref.current?.terminate();
      ft8Ref.current = null;
      let msg = err?.message || String(err);
      if (err?.name === 'NotAllowedError')
        msg = t('decoder.error.permission', { defaultValue: 'Microphone permission was denied.' });
      else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError')
        msg = t('decoder.error.noDevice', { defaultValue: 'That audio input is not available.' });
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [apiToken, bridgeUrl, relaySession, onUpdate, onFt8Slot, refreshDevices, stop, t, update]);

  // Live changes while running
  const setTone = (hz) => {
    const v = Math.max(150, Math.min(3000, Math.round(Number(hz) || 0)));
    update({ tone: v });
    engineRef.current?.setTone(v);
  };
  const setBandwidth = (v) => {
    const value = v === 'auto' ? 'auto' : Number(v);
    update({ bandwidth: value });
    engineRef.current?.setBandwidth(value);
  };
  const setSquelch = (level) => {
    update({ squelch: level });
    engineRef.current?.setSquelch(level);
  };
  const setMonitor = (on) => {
    update({ monitor: on });
    engineRef.current?.setMonitor(on);
  };
  const retuneKiwi = async (freqKhz) => {
    update(isFt8 ? { kiwiFt8Khz: freqKhz } : { kiwiFreqKhz: freqKhz });
    if (!running || settings.source !== 'kiwi') return;
    const req = kiwiTuneRequest({ bridgeUrl, token: apiToken, relaySession, freqKhz, mode: kiwiMode });
    if (!req) return;
    try {
      if (req.relayCommand) {
        const r = await sendRelayCommand(relaySession, req.relayCommand.type, req.relayCommand.payload);
        if (!r.ok) throw new Error(r.error || 'Cloud Relay refused the retune');
      } else await fetch(req.url, req.init);
      if (isFt8) setFt8Slots([]);
      else engineRef.current?.resetDecoder();
    } catch (err) {
      setError(err?.message || String(err));
    }
  };
  const setMode = (mode) => {
    update({ mode });
    setTab(mode === 'ft8' ? 'ft8' : 'copy');
  };

  // ── frequency context for spots/log (kHz of the dial / Kiwi) ──
  const dialKhz = useMemo(() => {
    if (settings.source === 'kiwi') return kiwiFreq || null;
    return rig?.enabled && rig?.freq > 0 ? rig.freq / 1000 : null;
  }, [settings.source, kiwiFreq, rig?.enabled, rig?.freq]);
  const spotCtx = useMemo(() => (dialKhz ? { freq: dialKhz, mode: 'CW' } : undefined), [dialKhz]);

  // ── copy + callsigns ──
  useEffect(() => {
    const el = copyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [copy]);
  const runs = useMemo(() => tokenizeCallsigns(copy), [copy]);
  const heard = useMemo(
    () =>
      findCallsigns(copy.slice(-800))
        .map((c) => c.call)
        .reverse()
        .slice(0, 8),
    [copy],
  );

  const ft8Badge = useCallback(
    (call, freqMHz) => spotBadge(getAwardStatus(call, freqMHz), getWorkedStatus(call, freqMHz, 'FT8')),
    [getAwardStatus, getWorkedStatus],
  );

  const setDX = async (call) => {
    if (!onSetDX || dxLocked) return;
    const base = extractBaseCall(call);
    try {
      const res = await apiFetch(`/api/callsign/${encodeURIComponent(base)}`, { headers: callbookAuthHeaders() });
      const data = res?.ok ? await res.json() : null;
      if (data?.lat != null && data?.lon != null) {
        onSetDX({ lat: data.lat, lon: data.lon, callsign: call });
        flash(t('decoder.dxSet', { defaultValue: 'DX set to {{call}}', call }));
      } else flash(t('decoder.dxNotFound', { defaultValue: 'No location for {{call}}', call }));
    } catch {
      flash(t('decoder.dxNotFound', { defaultValue: 'No location for {{call}}', call }));
    }
  };

  const logCall = (call) => {
    const idx = copy.lastIndexOf(call);
    const context = idx >= 0 ? copy.slice(Math.max(0, idx - 40), idx + call.length + 20) : '';
    addMyDecode({
      call,
      freqKhz: dialKhz,
      mode: 'CW',
      wpm: meter.wpm,
      snrDb: meter.snrDb,
      text: context.replace(/\s+/g, ' '),
      source: settings.source === 'kiwi' ? 'kiwisdr' : 'audio',
    });
    flash(t('decoder.logged', { defaultValue: '{{call}} added to My decodes', call }));
  };

  const logFt8 = (d) => {
    addMyDecode({
      call: d.de,
      freqKhz: dialKhz ? dialKhz + d.freq / 1000 : null,
      mode: 'FT8',
      snrDb: d.snr,
      text: d.text,
      source: settings.source === 'kiwi' ? 'kiwisdr' : 'audio',
    });
    flash(t('decoder.logged', { defaultValue: '{{call}} added to My decodes', call: d.de }));
  };

  // ── render ──
  const kiwiBlocked = !bridgeUrl && !relaySession;
  const maxHz = isFt8 ? 3000 : settings.source === 'kiwi' && kiwiMode === 'cw' ? 1500 : 2500;
  const snrPct = Math.max(0, Math.min(100, (meter.snrDb / 30) * 100));
  const slotSec = Math.floor((now / 1000) % 15);
  const ft8Count = ft8Slots.reduce((a, s) => a + s.decodes.length, 0);

  if (!supported) {
    return (
      <div className="panel" style={{ padding: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
        <div style={{ fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 6 }}>
          🎧 {t('decoder.title', { defaultValue: 'DECODER' })}
        </div>
        {t('decoder.unsupported', {
          defaultValue: 'This browser does not support AudioWorklet, which the decoder needs.',
        })}
      </div>
    );
  }
  if (!secure) return <InsecureNotice t={t} />;

  return (
    <div
      className="panel"
      style={{
        padding: 8,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 11,
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--accent-amber)' }}>
          🎧 {t('decoder.title', { defaultValue: 'DECODER' })}
          <select
            aria-label={t('decoder.mode', { defaultValue: 'Decoder mode' })}
            value={settings.mode}
            disabled={running}
            onChange={(e) => setMode(e.target.value)}
            style={{ ...field, fontWeight: 400 }}
          >
            <option value="cw">CW</option>
            <option value="ft8">FT8</option>
          </select>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {status && running && <span style={{ color: 'var(--text-muted)' }}>{status}</span>}
          <button
            type="button"
            onClick={running ? stop : start}
            disabled={busy || (settings.source === 'kiwi' && kiwiBlocked)}
            style={btn(running ? 'var(--accent-red)' : 'var(--accent-green)', busy)}
          >
            {busy
              ? '…'
              : running
                ? t('decoder.stop', { defaultValue: 'Stop' })
                : t('decoder.start', { defaultValue: 'Start' })}
          </button>
        </span>
      </div>

      {/* Source */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {t('decoder.source', { defaultValue: 'Source' })}
          <select
            value={settings.source}
            disabled={running}
            onChange={(e) => update({ source: e.target.value })}
            style={field}
          >
            <option value="mic">{t('decoder.source.mic', { defaultValue: 'Sound input' })}</option>
            <option value="kiwi">{t('decoder.source.kiwi', { defaultValue: 'KiwiSDR (Rig Bridge)' })}</option>
          </select>
        </label>
        {settings.source === 'mic' ? (
          <select
            aria-label={t('decoder.device', { defaultValue: 'Audio input device' })}
            value={settings.deviceId}
            disabled={running}
            onChange={(e) => update({ deviceId: e.target.value })}
            style={{ ...field, maxWidth: 190 }}
          >
            <option value="">{t('decoder.device.default', { defaultValue: 'Default input' })}</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `${t('decoder.device.input', { defaultValue: 'Input' })} ${i + 1}`}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="number"
              aria-label={t('decoder.kiwiFreq', { defaultValue: 'KiwiSDR frequency (kHz)' })}
              value={isFt8 ? settings.kiwiFt8Khz : settings.kiwiFreqKhz}
              min={10}
              max={32000}
              step={0.1}
              onChange={(e) => update(isFt8 ? { kiwiFt8Khz: e.target.value } : { kiwiFreqKhz: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && retuneKiwi(kiwiFreq)}
              onBlur={() => running && retuneKiwi(kiwiFreq)}
              style={{ ...field, width: 78 }}
            />
            <span style={{ color: 'var(--text-muted)' }}>kHz</span>
            {isFt8 && (
              <select
                aria-label={t('decoder.ft8.dials', { defaultValue: 'FT8 dial frequencies' })}
                value={FT8_DIALS.includes(kiwiFreq) ? kiwiFreq : ''}
                onChange={(e) => e.target.value && retuneKiwi(Number(e.target.value))}
                style={field}
              >
                <option value="">FT8…</option>
                {FT8_DIALS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
            {rig?.freq > 0 && (
              <button
                type="button"
                onClick={() => retuneKiwi(Math.round(rig.freq / 100) / 10)}
                style={btn()}
                title={t('decoder.fromRig', { defaultValue: 'Use the rig frequency' })}
              >
                {t('decoder.fromRigShort', { defaultValue: '← rig' })}
              </button>
            )}
          </>
        )}
      </div>
      {settings.source === 'kiwi' && (
        <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>
          {kiwiBlocked
            ? t('decoder.kiwi.noBridge', {
                defaultValue: 'Enable Rig Bridge in Settings → Rig Bridge to listen through a KiwiSDR.',
              })
            : relaySession
              ? t('decoder.kiwi.viaRelay', {
                  defaultValue:
                    'Through the Cloud Relay (~12 kB/s while listening) — turn on “Relay KiwiSDR audio” in the bridge’s Cloud Relay plugin; this browser must be paired (Connect Cloud Relay).',
                })
              : kiwiStatus?.unreachable
                ? t('decoder.kiwi.unreachable', { defaultValue: 'Rig Bridge is not reachable.' })
                : kiwiStatus && !kiwiStatus.running
                  ? t('decoder.kiwi.disabled', {
                      defaultValue: 'Turn on “KiwiSDR Audio (Decoder panel)” in the Rig Bridge setup page.',
                    })
                  : kiwiStatus?.host
                    ? t('decoder.kiwi.host', { defaultValue: 'Receiver: {{host}}', host: kiwiStatus.host })
                    : null}
        </div>
      )}

      {/* Waterfall */}
      <DecoderWaterfall
        getAnalyser={() => engineRef.current?.analyser}
        sampleRate={sampleRate}
        running={running}
        tone={isFt8 ? 1500 : settings.tone}
        bandwidth={isFt8 ? 2800 : meter.bandwidth || (settings.bandwidth === 'auto' ? 100 : settings.bandwidth)}
        maxHz={maxHz}
        onTune={isFt8 ? undefined : setTone}
        height={110}
      />

      {isFt8 ? (
        /* FT8 status line */
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {running ? t('decoder.ft8.slot', { defaultValue: 'slot {{s}}/15 s', s: slotSec }) : ''}
          </span>
          {running && (
            <div
              aria-hidden="true"
              style={{ flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}
            >
              <div style={{ width: `${(slotSec / 15) * 100}%`, height: '100%', background: 'var(--accent-cyan)' }} />
            </div>
          )}
          <span style={{ color: 'var(--text-secondary)' }}>
            {ft8State.status === 'loading'
              ? t('decoder.ft8.loading', { defaultValue: 'loading decoder…' })
              : ft8State.status === 'ready' && ft8State.lastDecodeMs
                ? t('decoder.ft8.decodeTime', { defaultValue: 'decoded in {{ms}} ms', ms: ft8State.lastDecodeMs })
                : ''}
            {ft8State.delayS
              ? ` · ${t('decoder.ft8.delay', {
                  defaultValue: 'receiver delay {{s}} s corrected',
                  s: ft8State.delayS.toFixed(1),
                })}`
              : ''}
          </span>
        </div>
      ) : (
        <>
          {/* Decoder controls */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {t('decoder.tone', { defaultValue: 'Tone' })}
              <input
                type="number"
                value={settings.tone}
                min={150}
                max={3000}
                step={10}
                onChange={(e) => setTone(e.target.value)}
                style={{ ...field, width: 54 }}
              />
              Hz
            </label>
            <button
              type="button"
              onClick={() => engineRef.current?.findTone(3)}
              disabled={!running || meter.finding}
              style={btn('var(--accent-cyan)', !running || meter.finding)}
              title={t('decoder.find.title', {
                defaultValue: 'Listen for 3 seconds and lock onto the strongest keyed tone',
              })}
            >
              {meter.finding ? '…' : t('decoder.find', { defaultValue: 'Find' })}
            </button>
            <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {t('decoder.filter', { defaultValue: 'Filter' })}
              <select value={settings.bandwidth} onChange={(e) => setBandwidth(e.target.value)} style={field}>
                {BANDWIDTHS.map((b) => (
                  <option key={b} value={b}>
                    {b === 'auto' ? t('decoder.filter.auto', { defaultValue: 'Auto' }) : `${b} Hz`}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {t('decoder.squelch', { defaultValue: 'Squelch' })}
              <select value={settings.squelch} onChange={(e) => setSquelch(e.target.value)} style={field}>
                <option value="low">{t('decoder.squelch.low', { defaultValue: 'Low' })}</option>
                <option value="normal">{t('decoder.squelch.normal', { defaultValue: 'Normal' })}</option>
                <option value="high">{t('decoder.squelch.high', { defaultValue: 'High' })}</option>
              </select>
            </label>
            <label
              style={{ display: 'flex', gap: 3, alignItems: 'center' }}
              title={t('decoder.monitor.title', { defaultValue: 'Play the audio through your speakers' })}
            >
              <input type="checkbox" checked={!!settings.monitor} onChange={(e) => setMonitor(e.target.checked)} />
              🔊
            </label>
          </div>

          {/* Meters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)' }}>
            <span
              aria-label={meter.keyed ? 'key down' : 'key up'}
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: running && meter.keyed ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                flexShrink: 0,
              }}
            />
            <span style={{ color: 'var(--accent-cyan)', minWidth: 52 }}>
              {running && meter.wpm ? `${meter.wpm} WPM` : '-- WPM'}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>S/N</span>
            <div
              role="meter"
              aria-label={t('decoder.signal', { defaultValue: 'Signal to noise' })}
              aria-valuemin={0}
              aria-valuemax={30}
              aria-valuenow={Math.round(meter.snrDb || 0)}
              style={{
                flex: 1,
                height: 8,
                background: 'var(--bg-tertiary)',
                borderRadius: 4,
                overflow: 'hidden',
                minWidth: 40,
              }}
            >
              <div
                style={{
                  width: `${running ? snrPct : 0}%`,
                  height: '100%',
                  background:
                    snrPct > 40 ? 'var(--accent-green)' : snrPct > 20 ? 'var(--accent-amber)' : 'var(--accent-red)',
                  transition: 'width 0.1s',
                }}
              />
            </div>
            <span style={{ color: 'var(--text-secondary)', minWidth: 38, textAlign: 'right' }}>
              {running ? `${Math.round(meter.snrDb || 0)} dB` : ''}
            </span>
          </div>

          {running && meter.offTuneHz ? (
            <div
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 6px',
                borderRadius: 3,
                background: 'rgba(245,158,11,0.15)',
                color: 'var(--accent-amber)',
              }}
            >
              <span style={{ flex: 1 }}>
                {t('decoder.offTune', {
                  defaultValue: 'Off tune — the signal is about {{hz}} Hz {{dir}}. Copy paused.',
                  hz: Math.abs(meter.offTuneHz),
                  dir:
                    meter.offTuneHz > 0
                      ? t('decoder.offTune.higher', { defaultValue: 'higher' })
                      : t('decoder.offTune.lower', { defaultValue: 'lower' }),
                })}
              </span>
              <button
                type="button"
                onClick={() => {
                  setTone(settings.tone + meter.offTuneHz);
                  engineRef.current?.resetDecoder(); // fresh levels for the new signal
                }}
                style={btn('var(--accent-amber)')}
              >
                {t('decoder.offTune.retune', { defaultValue: 'Retune' })}
              </button>
              <button type="button" onClick={() => engineRef.current?.findTone(3)} style={btn('var(--accent-cyan)')}>
                {t('decoder.find', { defaultValue: 'Find' })}
              </button>
            </div>
          ) : null}
        </>
      )}

      {(error || note || (isFt8 && ft8State.status === 'unavailable')) && (
        <div
          role={error || ft8State.status === 'unavailable' ? 'alert' : 'status'}
          style={{
            padding: '3px 6px',
            borderRadius: 3,
            background: error || ft8State.status === 'unavailable' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)',
            color: error || ft8State.status === 'unavailable' ? 'var(--accent-red)' : 'var(--accent-green)',
          }}
        >
          {error ||
            (isFt8 && ft8State.status === 'unavailable'
              ? t('decoder.ft8.unavailable', {
                  defaultValue:
                    'The FT8 decoder is not installed on this server (run "node scripts/fetch-wasm.js" and rebuild).',
                })
              : note)}
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-color)' }}>
        {[
          ['copy', t('decoder.tab.copy', { defaultValue: 'Copy' })],
          ['ft8', `FT8${ft8Count ? ` (${ft8Count})` : ''}`],
          ['log', `${t('decoder.tab.myDecodes', { defaultValue: 'My decodes' })} (${myDecodes.length})`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            style={{
              ...btn(),
              border: 'none',
              borderBottom: tab === id ? '2px solid var(--accent-amber)' : '2px solid transparent',
              borderRadius: 0,
              background: 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'copy' && (
        <>
          {heard.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {heard.map((call) => (
                <span
                  key={call}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '1px 4px',
                    border: '1px solid var(--border-color)',
                    borderRadius: 3,
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <CallsignLink
                    call={call}
                    onPopup={showPopup}
                    spot={spotCtx}
                    color="var(--accent-cyan)"
                    fontWeight={700}
                  />
                  {onSetDX && (
                    <button
                      type="button"
                      onClick={() => setDX(call)}
                      disabled={dxLocked}
                      title={
                        dxLocked
                          ? t('decoder.dxLocked', { defaultValue: 'DX is locked' })
                          : t('decoder.setDx', { defaultValue: 'Set as DX target' })
                      }
                      style={{ ...btn(null, dxLocked), padding: '0 4px', border: 'none' }}
                    >
                      🎯
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => logCall(call)}
                    title={t('decoder.log', { defaultValue: 'Add to My decodes' })}
                    style={{ ...btn(), padding: '0 4px', border: 'none' }}
                  >
                    ＋
                  </button>
                </span>
              ))}
            </div>
          )}
          <div
            ref={copyRef}
            aria-live="off"
            style={{
              flex: 1,
              minHeight: 60,
              overflowY: 'auto',
              padding: 6,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text-primary)',
            }}
          >
            {copy ? (
              runs.map((r, i) =>
                r.call ? (
                  <CallsignLink
                    key={i}
                    call={r.call}
                    onPopup={showPopup}
                    spot={spotCtx}
                    color="var(--accent-cyan)"
                    fontWeight={700}
                  >
                    {r.text}
                  </CallsignLink>
                ) : (
                  <span key={i}>{r.text}</span>
                ),
              )
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {running && !isFt8
                  ? t('decoder.waiting', {
                      defaultValue: 'Listening… tune a CW signal into the yellow passband, or press Find.',
                    })
                  : t('decoder.hint', {
                      defaultValue:
                        'Feed the receiver audio into a sound input (or pick a KiwiSDR), press Start, then click a trace on the waterfall.',
                    })}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setCopy('')} disabled={!copy} style={btn(null, !copy)}>
              {t('decoder.clear', { defaultValue: 'Clear' })}
            </button>
          </div>
        </>
      )}

      {tab === 'ft8' && (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <input
                type="checkbox"
                checked={!!settings.cqOnly}
                onChange={(e) => update({ cqOnly: e.target.checked })}
              />
              {t('decoder.ft8.cqOnly', { defaultValue: 'CQ only' })}
            </label>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setFt8Slots([])} disabled={!ft8Count} style={btn(null, !ft8Count)}>
              {t('decoder.clear', { defaultValue: 'Clear' })}
            </button>
          </div>
          {ft8Count ? (
            <DecoderFt8Table
              slots={ft8Slots}
              onPopup={showPopup}
              dialKhz={dialKhz}
              badgeFor={ft8Badge}
              onLog={logFt8}
              cqOnly={!!settings.cqOnly}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: 6 }}>
              {isFt8 && running
                ? t('decoder.ft8.waiting', {
                    defaultValue: 'Listening… decodes appear at the end of each 15-second slot (:00 :15 :30 :45 UTC).',
                  })
                : t('decoder.ft8.hint', {
                    defaultValue:
                      'Choose FT8 next to DECODER, tune the receiver to an FT8 frequency in USB (e.g. 14074 kHz) and press Start. Your computer clock must be accurate.',
                  })}
            </div>
          )}
        </div>
      )}

      {tab === 'log' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {myDecodes.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: 6 }}>
              {t('decoder.myDecodes.empty', {
                defaultValue: 'Nothing logged yet. Press ＋ next to a callsign in the copy to keep it here.',
              })}
            </div>
          ) : (
            <>
              {myDecodes.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 2px',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtTime(d.time)}</span>
                  <CallsignLink
                    call={d.call}
                    onPopup={showPopup}
                    spot={d.freqKhz ? { freq: d.freqKhz, mode: d.mode } : undefined}
                    color="var(--accent-cyan)"
                    fontWeight={700}
                  />
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {d.freqKhz ? d.freqKhz.toFixed(1) : ''}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {[
                      d.mode && d.mode !== 'CW' ? d.mode : null,
                      d.wpm ? `${d.wpm}wpm` : null,
                      d.snrDb != null ? `${d.snrDb}dB` : null,
                      d.count > 1 ? `×${d.count}` : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </span>
                  <span
                    title={d.text}
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {d.text}
                  </span>
                  {onSpotClick && d.freqKhz && (
                    <button
                      type="button"
                      onClick={() => onSpotClick(myDecodeToSpot(d))}
                      title={t('decoder.myDecodes.tune', { defaultValue: 'Tune / show on map' })}
                      style={{ ...btn(), padding: '0 4px' }}
                    >
                      📻
                    </button>
                  )}
                  {onSetDX && (
                    <button
                      type="button"
                      onClick={() => setDX(d.call)}
                      disabled={dxLocked}
                      title={t('decoder.setDx', { defaultValue: 'Set as DX target' })}
                      style={{ ...btn(null, dxLocked), padding: '0 4px' }}
                    >
                      🎯
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeMyDecode(d.id)}
                    title={t('decoder.myDecodes.remove', { defaultValue: 'Remove' })}
                    style={{ ...btn(), padding: '0 4px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(t('decoder.myDecodes.confirmClear', { defaultValue: 'Clear all of My decodes?' }))
                    )
                      clearMyDecodes();
                  }}
                  style={btn()}
                >
                  {t('decoder.myDecodes.clear', { defaultValue: 'Clear all' })}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

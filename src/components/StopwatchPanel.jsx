/**
 * StopwatchPanel — shack stopwatch + countdown timer (HamClock parity).
 * Running state persists in localStorage as absolute timestamps, so the
 * clock keeps counting across panel remounts, layout switches, and reloads.
 * The countdown fires a tone and flashes when it reaches zero.
 */
import { useEffect, useRef, useState } from 'react';
import { playTone } from '../utils/audioAlerts';

const SW_KEY = 'ohc_stopwatch'; // { startAt: ms|null, accumulated: ms }
const CD_KEY = 'ohc_countdown'; // { endsAt: ms|null, remaining: ms, duration: ms }

const loadState = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {}
  return fallback;
};
const saveState = (key, state) => {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {}
};

const pad = (n) => String(n).padStart(2, '0');
function formatMs(ms, showTenths = false) {
  const clamped = Math.max(0, ms);
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (!showTenths) return base;
  return `${base}.${Math.floor((clamped % 1000) / 100)}`;
}

const QUICK_MINUTES = [5, 10, 15, 60];

const btnStyle = (accent) => ({
  padding: '5px 12px',
  background: 'var(--bg-tertiary)',
  border: `1px solid ${accent}`,
  borderRadius: '4px',
  color: accent,
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
});

export const StopwatchPanel = () => {
  const [tab, setTab] = useState('stopwatch');
  const [sw, setSw] = useState(() => loadState(SW_KEY, { startAt: null, accumulated: 0 }));
  const [cd, setCd] = useState(() => loadState(CD_KEY, { endsAt: null, remaining: 0, duration: 10 * 60000 }));
  const [, setTick] = useState(0);
  const firedRef = useRef(false);

  const swRunning = sw.startAt != null;
  const cdRunning = cd.endsAt != null;
  const now = Date.now();
  const swElapsed = sw.accumulated + (swRunning ? now - sw.startAt : 0);
  const cdRemaining = cdRunning ? cd.endsAt - now : cd.remaining;
  const cdExpired = cdRunning && cdRemaining <= 0;

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), swRunning || cdRunning ? 100 : 1000);
    return () => clearInterval(id);
  }, [swRunning, cdRunning]);

  // Countdown alarm: fire once at zero, keep flashing until reset
  useEffect(() => {
    if (cdExpired && !firedRef.current) {
      firedRef.current = true;
      try {
        playTone('two-tone', 0.6);
        setTimeout(() => playTone('two-tone', 0.6), 400);
        setTimeout(() => playTone('two-tone', 0.6), 800);
      } catch {}
    }
    if (!cdExpired) firedRef.current = false;
  }, [cdExpired]);

  const updateSw = (next) => {
    setSw(next);
    saveState(SW_KEY, next);
  };
  const updateCd = (next) => {
    setCd(next);
    saveState(CD_KEY, next);
  };

  const startPauseSw = () => {
    if (swRunning) updateSw({ startAt: null, accumulated: swElapsed });
    else updateSw({ startAt: Date.now(), accumulated: sw.accumulated });
  };
  const resetSw = () => updateSw({ startAt: null, accumulated: 0 });

  const startPauseCd = () => {
    if (cdExpired) return;
    if (cdRunning) updateCd({ ...cd, endsAt: null, remaining: Math.max(0, cdRemaining) });
    else if (cdRemaining > 0) updateCd({ ...cd, endsAt: Date.now() + cdRemaining, remaining: 0 });
  };
  const resetCd = () => updateCd({ endsAt: null, remaining: cd.duration, duration: cd.duration });
  const setDuration = (ms) => updateCd({ endsAt: null, remaining: ms, duration: ms });

  // Remote control: `ohc:stopwatch` {action: reset|run|stop|lap|countdown, minutes?}
  // (POST /api/control/stopwatch). `lap` has no lap list here — it pauses,
  // which freezes the reading like a lap button would.
  const remoteRef = useRef(null);
  remoteRef.current = { sw, cd, swRunning, cdRunning, swElapsed, cdRemaining };
  useEffect(() => {
    const onRemote = (e) => {
      const { action, minutes } = e.detail || {};
      const s = remoteRef.current;
      const now = Date.now();
      switch (action) {
        case 'reset':
          updateSw({ startAt: null, accumulated: 0 });
          updateCd({ endsAt: null, remaining: s.cd.duration, duration: s.cd.duration });
          break;
        case 'run':
          setTab('stopwatch');
          if (!s.swRunning) updateSw({ startAt: now, accumulated: s.sw.accumulated });
          break;
        case 'stop':
        case 'lap':
          if (s.swRunning) updateSw({ startAt: null, accumulated: s.swElapsed });
          if (s.cdRunning) updateCd({ ...s.cd, endsAt: null, remaining: Math.max(0, s.cdRemaining) });
          break;
        case 'countdown': {
          const ms = Math.round((Number(minutes) || 0) * 60000);
          if (ms > 0) {
            setTab('countdown');
            updateCd({ endsAt: now + ms, remaining: 0, duration: ms });
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('ohc:stopwatch', onRemote);
    return () => window.removeEventListener('ohc:stopwatch', onRemote);
  }, []);

  const tabBtn = (id, label) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        padding: '3px 10px',
        background: tab === id ? 'var(--bg-tertiary)' : 'transparent',
        border: `1px solid ${tab === id ? 'var(--accent-amber)' : 'var(--border-color)'}`,
        borderRadius: '4px',
        color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
        fontSize: '10px',
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        <span>TIMER</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {tabBtn('stopwatch', 'STOPWATCH')}
          {tabBtn('countdown', 'COUNTDOWN')}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {tab === 'stopwatch' ? (
          <>
            <div
              style={{
                fontSize: '34px',
                fontWeight: 700,
                color: swRunning ? 'var(--accent-cyan)' : 'var(--text-primary)',
              }}
            >
              {formatMs(swElapsed, true)}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={startPauseSw} style={btnStyle(swRunning ? '#fbbf24' : '#4ade80')}>
                {swRunning ? 'PAUSE' : swElapsed > 0 ? 'RESUME' : 'START'}
              </button>
              <button type="button" onClick={resetSw} style={btnStyle('var(--text-muted)')}>
                RESET
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: '34px',
                fontWeight: 700,
                color: cdExpired ? '#ef4444' : cdRunning ? 'var(--accent-cyan)' : 'var(--text-primary)',
                animation: cdExpired ? 'pulse 1s infinite' : 'none',
              }}
            >
              {cdExpired ? 'TIME UP' : formatMs(cdRemaining)}
            </div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {QUICK_MINUTES.map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setDuration(min * 60000)}
                  style={{
                    padding: '3px 8px',
                    background: cd.duration === min * 60000 && !cdRunning ? 'var(--bg-tertiary)' : 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    fontSize: '10px',
                    cursor: 'pointer',
                  }}
                >
                  {min}m
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={startPauseCd}
                disabled={cdExpired || (!cdRunning && cdRemaining <= 0)}
                style={{
                  ...btnStyle(cdRunning ? '#fbbf24' : '#4ade80'),
                  opacity: cdExpired || (!cdRunning && cdRemaining <= 0) ? 0.4 : 1,
                }}
              >
                {cdRunning ? 'PAUSE' : 'START'}
              </button>
              <button type="button" onClick={resetCd} style={btnStyle('var(--text-muted)')}>
                RESET
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StopwatchPanel;

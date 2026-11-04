/**
 * Alarm clock UI: the header bell (green when armed, red while ringing)
 * with a small popover editor, the ringing banner with Dismiss, and the
 * settings section reused by Settings → Alerts. All state comes from
 * utils/alarmClock.js through useAlarmState — no prop plumbing.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAlarmState } from '../hooks/app/useAlarmClock.js';
import { formatCountdown, parseHHMM } from '../utils/alarmClock.js';

const GREEN = '#4ade80';
const RED = '#ff4d4d';

const fmtAt = (ms, utc) =>
  utc
    ? `${new Date(ms).toISOString().slice(11, 16)}z`
    : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const inputStyle = {
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '3px 6px',
  fontSize: '12px',
  fontFamily: 'var(--font-mono)',
};

const smallBtn = (active) => ({
  background: active ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
  color: active ? '#000' : 'var(--text-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '3px 8px',
  fontSize: '11px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
});

/** One alarm row: time, UTC/local, armed toggle. */
function AlarmRow({ kind, state, timeZone, onChange }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(state.time || '');
  useEffect(() => setDraft(state.time || ''), [state.time]);
  const valid = !!parseHHMM(draft);
  const commit = () => {
    const hm = parseHHMM(draft);
    if (!hm) return;
    const time = `${String(hm.h).padStart(2, '0')}:${String(hm.m).padStart(2, '0')}`;
    onChange(kind, { time, ...(kind === 'once' ? { at: null } : {}) });
  };
  const zoneLabel = state.utc ? 'UTC' : timeZone || t('alarm.local');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ minWidth: '44px', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 600 }}>
          {t(kind === 'daily' ? 'alarm.daily' : 'alarm.once')}
        </span>
        <input
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-label={t(kind === 'daily' ? 'alarm.dailyTime' : 'alarm.onceTime')}
          style={{ ...inputStyle, width: '92px' }}
        />
        <button
          type="button"
          onClick={() => onChange(kind, { utc: !state.utc, ...(kind === 'once' ? { at: null } : {}) })}
          aria-label={t('alarm.zoneToggle')}
          title={t('alarm.zoneToggle')}
          style={smallBtn(false)}
        >
          {zoneLabel}
        </button>
        <button
          type="button"
          onClick={() => valid && onChange(kind, { armed: !state.armed })}
          disabled={!valid}
          aria-pressed={state.armed}
          aria-label={t(state.armed ? 'alarm.disarm' : 'alarm.arm')}
          style={{
            ...smallBtn(state.armed),
            background: state.armed ? GREEN : 'var(--bg-tertiary)',
            opacity: valid ? 1 : 0.5,
            cursor: valid ? 'pointer' : 'default',
          }}
        >
          {t(state.armed ? 'alarm.armed' : 'alarm.off')}
        </button>
      </div>
      {kind === 'once' && state.at && state.armed && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
          {state.label ? `${state.label} · ` : ''}
          {new Date(state.at).toUTCString().replace(' GMT', 'z')}
        </div>
      )}
    </div>
  );
}

/** Editor shared by the header popover and Settings → Alerts. */
export function AlarmSettingsSection({ timeZone, compact = false }) {
  const { t } = useTranslation();
  const { alarm, nextAt, update } = useAlarmState(timeZone);
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '8px' : '10px' }}>
      {!compact && (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.5 }}>{t('alarm.help')}</div>
      )}
      <AlarmRow kind="daily" state={alarm.daily} timeZone={timeZone} onChange={update} />
      <AlarmRow kind="once" state={alarm.once} timeZone={timeZone} onChange={update} />
      <div style={{ fontSize: '11px', color: nextAt ? GREEN : 'var(--text-muted)' }}>
        {nextAt
          ? t('alarm.next', {
              when: fmtAt(nextAt.at, alarm[nextAt.kind]?.utc),
              countdown: formatCountdown(nextAt.at - Date.now()),
            })
          : t('alarm.none')}
      </div>
    </div>
  );
}

/** Header / Clock-layout bell. */
export function AlarmIndicator({ timeZone, size = 'small' }) {
  const { t } = useTranslation();
  const { alarm, ringing, nextAt, dismiss } = useAlarmState(timeZone);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const armed = alarm.daily.armed || alarm.once.armed;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const color = ringing ? RED : armed ? GREEN : 'var(--text-muted)';
  const title = ringing
    ? t('alarm.ringing')
    : nextAt
      ? t('alarm.next', {
          when: fmtAt(nextAt.at, alarm[nextAt.kind]?.utc),
          countdown: formatCountdown(nextAt.at - Date.now()),
        })
      : t('alarm.none');
  const px = size === 'large' ? '1em' : '14px';

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => (ringing ? dismiss() : setOpen((v) => !v))}
        aria-label={`${t('alarm.title')} — ${title}`}
        aria-expanded={open}
        title={title}
        style={{
          background: 'none',
          border: 'none',
          padding: '2px',
          cursor: 'pointer',
          color,
          display: 'inline-flex',
          alignItems: 'center',
          animation: ringing ? 'pulse 1s infinite' : 'none',
          lineHeight: 1,
        }}
      >
        <svg
          width={px}
          height={px}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          {!armed && !ringing && <path d="M3 3l18 18" />}
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('alarm.title')}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '6px',
            zIndex: 3000,
            minWidth: '280px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            padding: '10px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-primary)',
            textAlign: 'left',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--accent-cyan)', marginBottom: '8px', fontSize: '11px' }}>
            🔔 {t('alarm.title')}
          </div>
          <AlarmSettingsSection timeZone={timeZone} compact />
        </div>
      )}
    </div>
  );
}

/** Full-width banner while an alarm sounds. Mount once near the app root. */
export function AlarmBanner({ timeZone }) {
  const { t } = useTranslation();
  const { ringing, dismiss } = useAlarmState(timeZone);
  if (!ringing) return null;
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '10px 16px',
        background: RED,
        color: '#fff',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: '15px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
      }}
    >
      <span style={{ animation: 'pulse 1s infinite' }}>🔔</span>
      <span>
        {t(ringing.kind === 'once' ? 'alarm.bannerOnce' : 'alarm.bannerDaily')}
        {ringing.label ? ` — ${ringing.label}` : ''}
      </span>
      <button
        type="button"
        onClick={dismiss}
        autoFocus
        aria-label={t('alarm.dismiss')}
        style={{
          background: '#fff',
          color: RED,
          border: 'none',
          borderRadius: '4px',
          padding: '6px 14px',
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {t('alarm.dismiss')}
      </button>
    </div>
  );
}

export default AlarmIndicator;

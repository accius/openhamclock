/**
 * Clock Layout — a big digital clock and nothing else.
 *
 * For shack TVs and club-room displays during down time: UTC very large with
 * seconds, local time beneath it (or the other way round — tap the big time
 * to swap, the choice is remembered), the date, and the station callsign and
 * grid in a corner. Theme colours and the user's monospace font, so it looks
 * like the rest of the dashboard. Selectable like any layout, usable as a
 * Scene Rotation scene, and what the Idle Clock setting switches to
 * (src/hooks/app/useIdleClock.js).
 */
import { useEffect, useState } from 'react';
import { displayNow, isTimeShifted } from '../utils/displayTime.js';
import { AlarmIndicator } from '../components/AlarmIndicator.jsx';

const PRIMARY_KEY = 'openhamclock_clockPrimary'; // 'utc' | 'local'

const readPrimary = () => {
  try {
    return localStorage.getItem(PRIMARY_KEY) === 'local' ? 'local' : 'utc';
  } catch {
    return 'utc';
  }
};

const pad = (n) => String(n).padStart(2, '0');

/** { time: 'HH:MM:SS' | 'h:MM:SS', suffix: 'AM'|'PM'|'' } for a Date in the given zone. */
function formatTime(date, { timeZone, use12Hour }) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: !!use12Hour,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = use12Hour ? get('hour') : pad(get('hour') === '24' ? 0 : get('hour'));
  return { time: `${hour}:${get('minute')}:${get('second')}`, suffix: use12Hour ? get('dayPeriod') : '' };
}

function formatDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** Short zone name ("EDT", "GMT+2") for the local clock's label. */
function zoneLabel(date, timeZone) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName');
    return part?.value || 'LOCAL';
  } catch {
    return 'LOCAL';
  }
}

export default function ClockLayout({ config, use12Hour = false, deGrid }) {
  const [now, setNow] = useState(() => displayNow());
  const [primary, setPrimary] = useState(readPrimary);
  const shifted = isTimeShifted();

  // One tick per second, aligned to the second boundary so the display never
  // lags a whole second behind the wall clock.
  useEffect(() => {
    let timer;
    const tick = () => {
      const d = displayNow(); // follows the display-time shift, like the header clocks
      setNow(d);
      timer = setTimeout(tick, 1000 - d.getMilliseconds());
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  const swap = () => {
    const next = primary === 'utc' ? 'local' : 'utc';
    setPrimary(next);
    try {
      localStorage.setItem(PRIMARY_KEY, next);
    } catch {
      /* per-browser convenience only */
    }
  };

  // The configured station time zone when set, else the browser's.
  let localZone;
  try {
    localZone = config?.timezone && config.timezone !== 'auto' ? config.timezone : undefined;
    new Intl.DateTimeFormat('en-US', { timeZone: localZone }); // validate
  } catch {
    localZone = undefined;
  }

  const utc = formatTime(now, { timeZone: 'UTC', use12Hour });
  const local = formatTime(now, { timeZone: localZone, use12Hour });
  const big = primary === 'utc' ? utc : local;
  const small = primary === 'utc' ? local : utc;
  const bigLabel = primary === 'utc' ? 'UTC' : zoneLabel(now, localZone);
  const smallLabel = primary === 'utc' ? zoneLabel(now, localZone) : 'UTC';
  const dateLine = formatDate(now, primary === 'utc' ? 'UTC' : localZone);
  const callsign = config?.callsign && config.callsign !== 'N0CALL' ? config.callsign : '';

  return (
    <div
      className="clock-layout"
      role="timer"
      aria-live="off"
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'clamp(8px, 2vh, 24px)',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'none',
        overflow: 'hidden',
        padding: '2vh 2vw',
      }}
    >
      <div
        style={{
          fontSize: 'clamp(12px, 2.2vw, 28px)',
          letterSpacing: '0.3em',
          color: 'var(--accent-cyan)',
          fontWeight: 600,
        }}
      >
        {bigLabel}
        {shifted && (
          <span
            style={{
              marginLeft: '1em',
              padding: '0.1em 0.5em',
              borderRadius: '4px',
              background: '#ff4d4d',
              color: '#fff',
              fontSize: '0.7em',
              letterSpacing: '0.1em',
            }}
          >
            NOT REAL TIME
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={swap}
        title={`Show ${primary === 'utc' ? 'local time' : 'UTC'} large`}
        aria-label={`${bigLabel} ${big.time}${big.suffix ? ' ' + big.suffix : ''}. Tap to show ${
          primary === 'utc' ? 'local time' : 'UTC'
        } large`}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
          // Width-limited so HH:MM:SS always fits; height-limited for short wide screens.
          fontSize: use12Hour ? 'min(17vw, 42vh)' : 'min(19vw, 46vh)',
          fontWeight: 700,
          letterSpacing: '0.02em',
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.15em',
        }}
      >
        {big.time}
        {big.suffix && <span style={{ fontSize: '0.28em', color: 'var(--text-secondary)' }}>{big.suffix}</span>}
      </button>
      <div style={{ fontSize: 'clamp(14px, 3vw, 40px)', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
        {dateLine}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.5em',
          fontSize: 'clamp(18px, 5vw, 72px)',
          color: 'var(--text-primary)',
          marginTop: 'clamp(4px, 2vh, 20px)',
        }}
      >
        <span style={{ fontSize: '0.45em', letterSpacing: '0.25em', color: 'var(--accent-amber)', fontWeight: 600 }}>
          {smallLabel}
        </span>
        <span style={{ fontWeight: 600 }}>{small.time}</span>
        {small.suffix && <span style={{ fontSize: '0.4em', color: 'var(--text-secondary)' }}>{small.suffix}</span>}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 'clamp(12px, 2vw, 32px)',
          bottom: 'clamp(10px, 2vh, 28px)',
          fontSize: 'clamp(12px, 2vw, 28px)',
        }}
      >
        <AlarmIndicator size="large" />
      </div>
      {(callsign || deGrid) && (
        <div
          style={{
            position: 'absolute',
            right: 'clamp(12px, 2vw, 32px)',
            bottom: 'clamp(10px, 2vh, 28px)',
            fontSize: 'clamp(12px, 2vw, 28px)',
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
          }}
        >
          {callsign}
          {callsign && deGrid ? ' · ' : ''}
          {deGrid}
        </div>
      )}
    </div>
  );
}

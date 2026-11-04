/**
 * SunMoonPanel — sunrise/sunset, twilight state, moonrise/moonset for DE
 * and the DX target, plus current moon phase and pointing. All computed
 * locally from utils/geo.js — no API calls.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  calculateSunTimes,
  calculateSolarElevation,
  classifyTwilight,
  getMoonTimes,
  getMoonPhase,
  getMoonPhaseEmoji,
  getMoonAzEl,
} from '../utils/geo.js';
import { displayNow, subscribeDisplayTime } from '../utils/displayTime.js';

const TWILIGHT_LABELS = {
  day: { label: 'Daylight', color: '#fbbf24' },
  civil: { label: 'Civil twilight', color: '#ff9632' },
  nautical: { label: 'Nautical twilight', color: 'var(--accent-purple)' },
  astronomical: { label: 'Astro twilight', color: 'var(--accent-blue)' },
  night: { label: 'Night', color: 'var(--text-secondary)' },
  unknown: { label: '—', color: 'var(--text-muted)' },
};

const fmtLocal = (date) => (date ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');

function phaseName(phase) {
  if (phase < 0.03 || phase > 0.97) return 'New Moon';
  if (phase < 0.22) return 'Waxing Crescent';
  if (phase < 0.28) return 'First Quarter';
  if (phase < 0.47) return 'Waxing Gibbous';
  if (phase < 0.53) return 'Full Moon';
  if (phase < 0.72) return 'Waning Gibbous';
  if (phase < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}

function stationAstro(lat, lon, now) {
  if (lat == null || lon == null) return null;
  const sun = calculateSunTimes(lat, lon, now);
  const solarEl = calculateSolarElevation(lat, lon, now);
  const moon = getMoonTimes(now, lat, lon);
  const moonAzEl = getMoonAzEl(now, lat, lon);
  return {
    sunrise: sun.sunrise,
    sunset: sun.sunset,
    twilight: classifyTwilight(solarEl),
    solarEl,
    moonRise: moon.rise,
    moonSet: moon.set,
    moonEl: moonAzEl.elevation,
    moonAz: moonAzEl.azimuth,
  };
}

const Row = ({ label, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ color: 'var(--text-primary)' }}>{children}</span>
  </div>
);

const StationColumn = ({ title, astro }) => {
  if (!astro) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--accent-cyan)', fontWeight: 700, marginBottom: '4px' }}>{title}</div>
        <div style={{ color: 'var(--text-muted)' }}>No location</div>
      </div>
    );
  }
  const tw = TWILIGHT_LABELS[astro.twilight] || TWILIGHT_LABELS.unknown;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '4px',
        }}
      >
        <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{title}</span>
        <span style={{ color: tw.color, fontSize: '9px', fontWeight: 700 }}>{tw.label.toUpperCase()}</span>
      </div>
      <Row label="☀ Rise">
        {astro.sunrise} {astro.sunset ? 'z' : ''}
      </Row>
      <Row label="☀ Set">{astro.sunset ? `${astro.sunset} z` : '—'}</Row>
      <Row label="☾ Rise">{fmtLocal(astro.moonRise)}</Row>
      <Row label="☾ Set">{fmtLocal(astro.moonSet)}</Row>
      <Row label="☾ Az/El">
        <span style={{ color: astro.moonEl >= 0 ? '#4ade80' : 'var(--text-muted)' }}>
          {Math.round(astro.moonAz)}° / {Math.round(astro.moonEl)}°
        </span>
      </Row>
    </div>
  );
};

export const SunMoonPanel = ({ deLocation, dxLocation }) => {
  // Display time (utils/displayTime.js): follows the time-shift scrubber.
  const [now, setNow] = useState(() => displayNow());
  useEffect(() => {
    const id = setInterval(() => setNow(displayNow()), 60_000);
    const unsub = subscribeDisplayTime(() => setNow(displayNow()));
    return () => {
      clearInterval(id);
      unsub();
    };
  }, []);

  const de = useMemo(
    () => stationAstro(deLocation?.lat ?? null, deLocation?.lon ?? null, now),
    [deLocation?.lat, deLocation?.lon, now],
  );
  const dx = useMemo(
    () => stationAstro(dxLocation?.lat ?? null, dxLocation?.lon ?? null, now),
    [dxLocation?.lat, dxLocation?.lon, now],
  );

  const phase = getMoonPhase(now);
  const illum = Math.round((1 - Math.cos(phase * 2 * Math.PI)) * 50);

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
        <span>SUN &amp; MOON</span>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
          {getMoonPhaseEmoji(phase)} {phaseName(phase)} · {illum}%
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <StationColumn title="DE" astro={de} />
          <div style={{ width: '1px', background: 'var(--border-color)' }} />
          <StationColumn title="DX" astro={dx} />
        </div>
        <div
          style={{
            marginTop: '8px',
            paddingTop: '6px',
            borderTop: '1px solid var(--border-color)',
            color: 'var(--text-muted)',
            fontSize: '9px',
          }}
        >
          Sun times UTC · moon times local · moon Az/El updates each minute
        </div>
      </div>
    </div>
  );
};

export default SunMoonPanel;

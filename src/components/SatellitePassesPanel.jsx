/**
 * SatellitePassesPanel — upcoming passes for every tracked satellite over
 * the DE station, computed locally with the same Orbit propagator the
 * satellite layer uses. Recomputed every 30 minutes (and when the tracked
 * list changes); countdowns tick locally between recomputes.
 *
 * Three tabs:
 *   Passes — the table, plus Doppler-tune / rotator-track switches for the
 *            satellite you pick (a row click picks it).
 *   Sky    — polar sky plot of that satellite's next pass, TLE age and the
 *            "Refresh TLEs" button.
 *   Alerts — upcoming alerted passes from hams.at with co-visibility from DE.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Orbit from '../utils/orbit.js';
import { displayNowMs, subscribeDisplayTime } from '../utils/displayTime.js';
import { satrecFor } from '../utils/satRelay.js';
import { observerFromLocation, lookAnglesAt, computePassSkyPath } from '../utils/satelliteSkyPath.js';
import { formatTleAge } from '../utils/tleAge.js';
import { annotateCoVisibility } from '../utils/hamsAtAlerts.js';
import { useSatAutomation, setAutomationSat } from '../utils/satAutomationStore.js';
import useHamsAtAlerts from '../hooks/useHamsAtAlerts.js';
import SatelliteSkyView from './SatelliteSkyView.jsx';
import SatelliteAutomationControls from './SatelliteAutomationControls.jsx';

const RECOMPUTE_MS = 30 * 60 * 1000;
const WINDOW_HOURS = 24;
const MAX_ROWS = 30;
const MAX_PASSES_PER_SAT = 6;
const MAX_ALERT_ROWS = 40;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function countdown(ms) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (ms) =>
  new Date(ms).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function computePasses(sats, groundStation, minElevation, nowMs = displayNowMs()) {
  const start = new Date(nowMs - 30 * 60 * 1000); // catch in-progress passes
  const end = new Date(nowMs + WINDOW_HOURS * 3600 * 1000);
  const passes = [];
  for (const sat of sats) {
    if (!sat?.omm) continue;
    try {
      const orbit = new Orbit(sat.name, sat.omm);
      const satPasses = orbit.computePassesElevation(groundStation, start, end, minElevation, MAX_PASSES_PER_SAT);
      for (const p of satPasses) passes.push({ ...p, tleStale: !!sat.tleStale, tleAgeDays: sat.tleAgeDays });
    } catch {
      // bad/stale OMM for one bird shouldn't empty the whole table
    }
  }
  const now = nowMs;
  return passes
    .filter((p) => p.end > now)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_ROWS);
}

const tabBtn = (active) => ({
  background: 'transparent',
  border: 'none',
  borderBottom: `2px solid ${active ? 'var(--accent-primary)' : 'transparent'}`,
  color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
  fontSize: '10px',
  fontWeight: 700,
  padding: '2px 6px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
});

const smallBtn = {
  background: 'transparent',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  color: 'var(--text-secondary)',
  fontSize: 10,
  padding: '2px 8px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
};

export const SatellitePassesPanel = ({ satellites, config, rotatorAvailable = false }) => {
  const { t } = useTranslation();
  // "now" is the display time, so a time shift re-plans the pass list.
  const [now, setNow] = useState(() => displayNowMs());
  const [passTick, setPassTick] = useState(0);
  const [tab, setTab] = useState('passes');
  const [refreshState, setRefreshState] = useState(null); // { ok, text }
  const auto = useSatAutomation();
  const satsRef = useRef([]);
  satsRef.current = satellites?.data || [];

  useEffect(() => {
    const id = setInterval(() => setNow(displayNowMs()), 15_000);
    const recompute = setInterval(() => setPassTick((t) => t + 1), RECOMPUTE_MS);
    const unsub = subscribeDisplayTime(() => {
      setNow(displayNowMs());
      setPassTick((t) => t + 1);
    });
    return () => {
      clearInterval(id);
      clearInterval(recompute);
      unsub();
    };
  }, []);

  const lat = config?.location?.lat ?? 0;
  const lon = config?.location?.lon ?? 0;
  const height = config?.location?.stationAlt ?? 100;
  const minElev = config?.satellite?.minElev ?? 5;
  const maxTleAge = config?.satellite?.maxTleAgeDays ?? 7;

  // Key on WHICH satellites have orbital data — not on the 5-second
  // position refresh — so the (expensive) propagation runs only when the
  // tracked list or station actually changes, or on the 30-min tick.
  const trackedKey = (satellites?.data || [])
    .filter((s) => s.omm)
    .map((s) => s.name)
    .sort()
    .join(',');

  const passes = useMemo(
    () => computePasses(satsRef.current, { latitude: lat, longitude: lon, height }, minElev),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackedKey, passTick, lat, lon, height, minElev],
  );

  const upcoming = passes.filter((p) => p.end > now);
  const tracked = (satellites?.data || []).filter((s) => s.omm);
  const staleCount = tracked.filter((s) => s.tleStale).length;

  // Satellite under automation — defaults to the first upcoming pass's bird.
  const selectedName = auto.satName && tracked.some((s) => s.name === auto.satName) ? auto.satName : null;
  const selectedSat = tracked.find((s) => s.name === selectedName) || null;

  // Sky view: next (or current) pass of the selected satellite.
  const skyData = useMemo(() => {
    if (!selectedSat?.omm) return null;
    const pass = upcoming.find((p) => p.name === selectedSat.name);
    if (!pass) return null;
    const satrec = satrecFor(selectedSat.omm);
    const obs = observerFromLocation({ lat, lon, stationAlt: height });
    const sky = computePassSkyPath(satrec, obs, pass.start, pass.end, 20);
    return sky ? { sky, pass } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSat?.name, selectedSat?.omm?.EPOCH, trackedKey, passTick, lat, lon, height]);

  const skyNow = useMemo(() => {
    if (!selectedSat?.omm || tab !== 'sky') return null;
    const la = lookAnglesAt(
      satrecFor(selectedSat.omm),
      observerFromLocation({ lat, lon, stationAlt: height }),
      new Date(now),
    );
    return la ? { az: la.azimuth, el: la.elevation } : null;
  }, [selectedSat, tab, now, lat, lon, height]);

  // hams.at alerts — polled only while the Alerts tab is open (the audio feed
  // in App polls on its own when that alert is enabled).
  const apiKey = config?.satellite?.hamsAtApiKey || '';
  const alertsFeed = useHamsAtAlerts(apiKey, { enabled: tab === 'alerts' });
  const alerts = useMemo(
    () =>
      annotateCoVisibility(alertsFeed.alerts, satellites?.data || [])
        .filter((a) => (a.losMs ?? a.aosMs) >= now)
        .slice(0, MAX_ALERT_ROWS),
    [alertsFeed.alerts, satellites?.data, now],
  );

  const refreshTles = async () => {
    setRefreshState({ ok: null, text: '…' });
    try {
      const res = await fetch('/api/satellites/refresh', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429)
        setRefreshState({ ok: false, text: t('satAuto.refreshTooSoon', { sec: j.retryAfterSec ?? '?' }) });
      else if (!res.ok || j.ok === false) setRefreshState({ ok: false, text: j.error || `HTTP ${res.status}` });
      else setRefreshState({ ok: true, text: t('satAuto.refreshQueued') });
    } catch (e) {
      setRefreshState({ ok: false, text: String(e?.message || e) });
    }
  };

  const stalePill = (sat) =>
    sat?.tleStale ? (
      <span
        title={t('satAuto.tleStaleTitle', { age: formatTleAge(sat.tleAgeDays), max: maxTleAge })}
        aria-label={t('satAuto.tleStaleTitle', { age: formatTleAge(sat.tleAgeDays), max: maxTleAge })}
        style={{ color: 'var(--accent-amber)', marginLeft: 4, fontSize: '9px' }}
      >
        ⚠ {formatTleAge(sat.tleAgeDays)}
      </span>
    ) : null;

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
          gap: 6,
        }}
      >
        <span>SATELLITE PASSES</span>
        <div role="tablist" aria-label={t('satAuto.tabsAria')} style={{ display: 'flex', gap: 2 }}>
          {['passes', 'sky', 'alerts'].map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              style={tabBtn(tab === id)}
            >
              {t(`satAuto.tab.${id}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Satellite picker for automation / sky view */}
      {tab !== 'alerts' && tracked.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, fontSize: 10 }}>
          <label htmlFor="sat-passes-pick" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            🛰
          </label>
          <select
            id="sat-passes-pick"
            value={selectedName || ''}
            onChange={(e) => setAutomationSat(e.target.value || null)}
            aria-label={t('satAuto.pickSatellite')}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              padding: '2px 4px',
            }}
          >
            <option value="">{t('satAuto.pickSatellite')}</option>
            {tracked.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
                {s.tleStale ? ' ⚠' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {tab !== 'alerts' && selectedSat && (
        <div style={{ marginBottom: 6 }}>
          <SatelliteAutomationControls sat={selectedSat} rotatorAvailable={rotatorAvailable} />
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {tab === 'passes' &&
          (satellites?.loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
              <div className="loading-spinner" />
            </div>
          ) : upcoming.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
              {trackedKey
                ? 'No passes in the next 24 hours'
                : 'No satellites tracked — pick some in Settings → Satellites'}
            </div>
          ) : (
            <>
              <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginBottom: 4, textAlign: 'right' }}>
                next {WINDOW_HOURS}h · el ≥ {minElev}°
                {staleCount > 0 ? ` · ${t('satAuto.staleCount', { count: staleCount })}` : ''}
              </div>
              {upcoming.map((pass) => {
                const live = pass.start <= now && now <= pass.end;
                const selected = pass.name === selectedName;
                return (
                  <div
                    key={`${pass.name}-${pass.start}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setAutomationSat(pass.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAutomationSat(pass.name);
                      }
                    }}
                    aria-label={`${pass.name} ${fmtTime(pass.start)}`}
                    style={{
                      padding: '5px 6px',
                      marginBottom: '3px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: live ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255,255,255,0.03)',
                      border: live
                        ? '1px solid rgba(74, 222, 128, 0.4)'
                        : selected
                          ? '1px solid var(--accent-primary)'
                          : '1px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: live ? '#4ade80' : 'var(--text-primary)', fontWeight: 600 }}>
                        {live && (
                          <span style={{ fontSize: '8px', animation: 'pulse 1.5s infinite', marginRight: '4px' }}>
                            ●
                          </span>
                        )}
                        {pass.name}
                        {stalePill(pass)}
                      </span>
                      <span style={{ color: live ? '#4ade80' : 'var(--accent-cyan)', fontWeight: 600 }}>
                        {live ? `LOS in ${countdown(pass.end - now)}` : countdown(pass.start - now)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: '2px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span>
                        {fmtTime(pass.start)}–{fmtTime(pass.end)} · {Math.round(pass.duration / 60000)} min
                      </span>
                      <span>
                        {compass(pass.azimuthStart)}→{compass(pass.azimuthEnd)} · max{' '}
                        <span
                          style={{
                            color:
                              pass.maxElevation >= 60
                                ? '#4ade80'
                                : pass.maxElevation >= 30
                                  ? '#fbbf24'
                                  : 'var(--text-secondary)',
                            fontWeight: 600,
                          }}
                        >
                          {Math.round(pass.maxElevation)}°
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          ))}

        {tab === 'sky' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {!selectedSat ? (
              <div style={{ color: 'var(--text-muted)', padding: 10, fontSize: 11, textAlign: 'center' }}>
                {t('satAuto.pickSatellite')}
              </div>
            ) : skyData ? (
              <>
                <SatelliteSkyView
                  sky={skyData.sky}
                  now={skyNow}
                  size={200}
                  dashed={!!selectedSat.tleStale}
                  title={`${selectedSat.name} · ${fmtDateTime(skyData.pass.start)} · ${compass(skyData.pass.azimuthStart)}→${compass(skyData.pass.azimuthEnd)} · max ${Math.round(skyData.pass.maxElevation)}°`}
                />
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', padding: 10, fontSize: 11, textAlign: 'center' }}>
                {t('satAuto.noPassForSky', { sat: selectedSat.name })}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              {selectedSat && (
                <span style={{ color: selectedSat.tleStale ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                  {t('satAuto.tleAge')}: {selectedSat.tleStale ? '⚠ ' : ''}
                  {formatTleAge(selectedSat.tleAgeDays)} / {maxTleAge}d
                </span>
              )}
              <button type="button" onClick={refreshTles} style={smallBtn} aria-label={t('satAuto.refreshTles')}>
                ⟳ {t('satAuto.refreshTles')}
              </button>
              {refreshState && (
                <span
                  style={{
                    color:
                      refreshState.ok === false
                        ? 'var(--accent-red)'
                        : refreshState.ok
                          ? 'var(--accent-green)'
                          : 'var(--text-muted)',
                  }}
                >
                  {refreshState.text}
                </span>
              )}
            </div>
          </div>
        )}

        {tab === 'alerts' && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'var(--text-muted)',
                fontSize: 9,
                marginBottom: 4,
              }}
            >
              <span>
                hams.at · {alertsFeed.keyed ? t('satAuto.alertsKeyed') : t('satAuto.alertsPublic')}
                {alertsFeed.fetchedAt ? ` · ${fmtTime(alertsFeed.fetchedAt)}` : ''}
              </span>
              <button
                type="button"
                onClick={alertsFeed.refresh}
                style={smallBtn}
                aria-label={t('satAuto.refreshAlerts')}
              >
                ⟳
              </button>
            </div>
            {alertsFeed.error && (
              <div style={{ color: 'var(--accent-red)', padding: 6, textAlign: 'center' }}>
                {alertsFeed.errorStatus === 401 ? t('satAuto.alertsBadKey') : alertsFeed.error}
              </div>
            )}
            {alertsFeed.loading && alerts.length === 0 && !alertsFeed.error && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
                <div className="loading-spinner" />
              </div>
            )}
            {!alertsFeed.loading && !alertsFeed.error && alerts.length === 0 && (
              <div style={{ color: 'var(--text-muted)', padding: 10, textAlign: 'center', fontSize: 11 }}>
                {t('satAuto.noAlerts')}
              </div>
            )}
            {alerts.map((a) => {
              const live = a.aosMs <= now && (a.losMs ?? a.aosMs) >= now;
              const cv = a.coVisible;
              return (
                <div
                  key={a.id}
                  style={{
                    padding: '5px 6px',
                    marginBottom: '3px',
                    borderRadius: '4px',
                    background: live ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255,255,255,0.03)',
                    border: cv ? '1px solid var(--accent-cyan)' : '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {a.satName}
                      {a.callsign && <span style={{ color: 'var(--accent-cyan)', marginLeft: 6 }}>{a.callsign}</span>}
                      {a.mode && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{a.mode}</span>}
                    </span>
                    <span style={{ color: live ? '#4ade80' : 'var(--accent-cyan)', fontWeight: 600 }}>
                      {live ? t('satAuto.alertLive') : countdown(a.aosMs - now)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: 2,
                      color: 'var(--text-muted)',
                      gap: 6,
                    }}
                  >
                    <span>
                      {fmtDateTime(a.aosMs)}
                      {a.losMs ? `–${fmtTime(a.losMs)}` : ''}
                      {a.maxElevation != null ? ` · max ${Math.round(a.maxElevation)}°` : ''}
                    </span>
                    <span>{a.grids.join(' ')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, gap: 6 }}>
                    <span
                      style={{
                        color: 'var(--text-secondary)',
                        fontStyle: 'italic',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.comment}
                    </span>
                    <span
                      style={{
                        color: cv ? 'var(--accent-green)' : a.tracked ? 'var(--text-muted)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cv
                        ? t('satAuto.coVisible', {
                            min: Math.round(cv.overlapMs / 60000),
                            el: cv.maxElevation != null ? Math.round(cv.maxElevation) : '?',
                          })
                        : a.tracked
                          ? t('satAuto.notCoVisible')
                          : t('satAuto.notTracked')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SatellitePassesPanel;

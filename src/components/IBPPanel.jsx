/**
 * IBPPanel — International Beacon Project live schedule + listening log
 *
 * LIVE view: which NCDXF/IARU beacon is transmitting on each of the 5 IBP
 * bands right now, with a per-slot countdown and bearing/distance from the
 * operator's QTH.  The schedule is fully deterministic; no network calls.
 *
 * LOG view (Phase 4): a listening-log timeline — 18 beacon rows × the last
 * HISTORY_MAX_CYCLES 3-minute cycles, each cell marking whether RBN skimmers
 * heard that beacon during that cycle.  History accumulates client-side for
 * the session (useIBPHistory), giving an at-a-glance propagation picture
 * from DE to the 18 beacon sites over the last ~30 minutes.
 *
 * MEASURED view: SNR of every beacon on every band as actually measured by
 * a KiwiSDR beacon monitor (Rig Bridge plugin kiwi-beacon-monitor, data via
 * useIBPMeasurements) — latest SNR per (beacon, band) as a coloured cell, a
 * 24-hour heat strip per beacon, and a "vs P.533" tally comparing each
 * measurement with the browser WASM beacon→DE prediction (ibpMeasured.js).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIBP } from '../hooks/useIBP';
import { useIBPRBN } from '../hooks/useIBPRBN';
import { useIBPHistory } from '../hooks/useIBPHistory';
import { useIBPMeasurements } from '../hooks/useIBPMeasurements';
import { useRig } from '../contexts/RigContext';
import { formatDistance } from '../utils/geo';
import { formatBearing as formatBearingDeg, useBearingMode } from '../utils/bearing.js';
import { DEFAULT_BAND_COLORS } from '../utils/bandColors';
import {
  IBP_BEACONS,
  IBP_BANDS,
  SLOT_SECONDS,
  CYCLE_SECONDS,
  HISTORY_MAX_CYCLES,
  getCycleStartMs,
  getUpcomingSchedule,
} from '../utils/ibp';
import {
  HEARD_SNR_DB,
  NOT_HEARD_COLOR,
  SNR_SCALE_MIN,
  SNR_SCALE_MAX,
  snrColor,
  latestByPair,
  pairKey,
  heatStrip,
  heatStripGradient,
  ibpBandForFreq,
  agreementByBeacon,
  ageLabel,
} from '../utils/ibpMeasured';
import { predictInWorker } from '../services/p533/predictInWorker.js';
import { modeRequiredSNR } from '../utils/propagationAdjust.js';

/** How often the beacon→DE P.533 predictions behind the MEASURED view refresh. */
const PREDICT_REFRESH_MS = 10 * 60 * 1000;
/** Measurements older than this are shown faded in the MEASURED grid. */
const STALE_MS = 60 * 60 * 1000;

/** Format a bearing in degrees as a compact cardinal+degrees string ("NE 47°", or "NE 40°M" in magnetic mode). */
const formatBearing = (deg, deLat, deLon, mode) => {
  if (deg == null) return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const card = dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  return `${card} ${formatBearingDeg(deg, deLat, deLon, mode)}`;
};

/** Format seconds as m:ss. */
const formatCountdown = (secs) => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** UTC HH:MM label for a cycle-start timestamp. */
const formatCycleTime = (ms) => new Date(ms).toISOString().slice(11, 16);

/** Cell opacity scaled by best SNR (−10 dB → faint, +30 dB → solid). */
const snrOpacity = (snr) => {
  if (snr == null) return 0.6;
  return 0.35 + Math.max(0, Math.min(1, (snr + 10) / 40)) * 0.65;
};

const VIEWS = ['live', 'log', 'measured'];

const fmtSnr = (snr) => (Number.isFinite(snr) ? `${snr >= 0 ? '+' : ''}${Math.round(snr)}` : '?');

export const IBPPanel = ({ deLat = null, deLon = null, units = 'metric' }) => {
  const { t } = useTranslation();
  const { slot, schedule, secondsLeft, cycleSecondsLeft, slotProgress } = useIBP(deLat, deLon);
  const bearingMode = useBearingMode();
  const { enabled: rigEnabled, tuneTo } = useRig();
  const rbnData = useIBPRBN();
  // Accumulate regardless of active view so the log is populated on switch.
  const history = useIBPHistory(rbnData);
  // Measured SNR from a KiwiSDR beacon monitor (Rig Bridge plugin). Shared
  // page-wide poller, configured by App.jsx; empty unless enabled in Settings.
  const measured = useIBPMeasurements();

  const [view, setView] = useState(() => {
    try {
      const saved = localStorage.getItem('openhamclock_ibpView');
      return VIEWS.includes(saved) ? saved : 'live';
    } catch {
      return 'live';
    }
  });

  const handleViewChange = (v) => {
    setView(v);
    try {
      localStorage.setItem('openhamclock_ibpView', v);
    } catch {}
  };

  const hasQTH = deLat != null && deLon != null;

  // ── Timeline (log view) data ────────────────────────────────────────────
  // Two cycles of schedule always contain every beacon's next 20 m run.
  // Recomputed once per 10-second slot, not per second.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const upcoming = useMemo(() => getUpcomingSchedule(new Date(), 2), [slot]);

  const nowMs = Date.now();
  const currentCycleStartMs = getCycleStartMs(new Date(nowMs));

  // Columns: last HISTORY_MAX_CYCLES cycle starts, oldest → newest (= now).
  const columns = useMemo(() => {
    const byStart = new Map(history.map((h) => [h.cycleStartMs, h]));
    const cols = [];
    for (let k = HISTORY_MAX_CYCLES - 1; k >= 0; k--) {
      const startMs = currentCycleStartMs - k * CYCLE_SECONDS * 1000;
      cols.push({ startMs, record: byStart.get(startMs) ?? null });
    }
    return cols;
  }, [history, currentCycleStartMs]);

  // callsign → band currently transmitting (5 beacons active at any moment).
  const txBandByCallsign = useMemo(() => {
    const m = new Map();
    for (const { band, beacon } of schedule) m.set(beacon.callsign, band);
    return m;
  }, [schedule]);

  // callsign → seconds until the beacon's next (or current) 20 m run starts.
  const next20mByCallsign = useMemo(() => {
    const m = new Map();
    for (const entry of upcoming) {
      const startMs = entry.startDate.getTime();
      if (startMs + SLOT_SECONDS * 1000 <= nowMs) continue; // already finished
      const cs = entry.bands[0].beacon.callsign; // bands[0] = 20 m (offset 0)
      if (!m.has(cs)) m.set(cs, Math.max(0, (startMs - nowMs) / 1000));
    }
    return m;
    // nowMs changes every render (1 s tick) — countdown is meant to be live.
  }, [upcoming, nowMs]);

  const oldestWithData = columns.find((c) => c.record);
  const logIsEmpty = history.every((h) => h.heard.size === 0);

  // ── MEASURED view data ──────────────────────────────────────────────────
  const latestMeasured = useMemo(() => latestByPair(measured.measurements), [measured.measurements]);
  const strips = useMemo(() => {
    if (view !== 'measured' || !measured.measurements.length) return null;
    const out = {};
    for (const b of IBP_BEACONS) out[b.callsign] = heatStrip(measured.measurements, b.callsign, { now: nowMs });
    return out;
    // nowMs ticks every second; the strips only need to move once per measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, measured.measurements]);

  // Beacon → DE P.533 reliability per band (100 W CW, the beacons' real
  // power and mode), refreshed every 10 min while the MEASURED view is open.
  const [predicted, setPredicted] = useState(null); // { beacon: { band: reliability } } | null
  const [predictState, setPredictState] = useState('idle'); // idle | running | ok | error
  const predictRunning = useRef(false);
  const haveMeasurements = measured.measurements.length > 0;
  useEffect(() => {
    if (view !== 'measured' || !hasQTH || !haveMeasurements) return;
    let cancelled = false;
    const run = async () => {
      if (predictRunning.current) return;
      predictRunning.current = true;
      setPredictState((s) => (s === 'ok' ? s : 'running'));
      try {
        let ssn = 100;
        try {
          const res = await fetch('/api/solar-indices');
          if (res.ok) {
            const j = await res.json();
            const v = j?.data?.ssn?.current ?? j?.ssn?.current ?? j?.ssn;
            if (Number.isFinite(Number(v))) ssn = Number(v);
          }
        } catch {}
        const now = new Date();
        const requiredSNR = modeRequiredSNR('CW');
        const out = {};
        for (const beacon of IBP_BEACONS) {
          const result = await predictInWorker({
            txLat: beacon.lat,
            txLon: beacon.lon,
            rxLat: deLat,
            rxLon: deLon,
            year: now.getUTCFullYear(),
            month: now.getUTCMonth() + 1,
            hour: now.getUTCHours(),
            ssn,
            txPower: 100,
            txGain: 0,
            requiredSNR,
          });
          if (cancelled) return;
          const byBand = {};
          for (const f of result?.frequencies || []) {
            const band = ibpBandForFreq(f.freq);
            if (band) byBand[band] = Math.max(0, Math.min(99, Math.round(f.reliability)));
          }
          out[beacon.callsign] = byBand;
        }
        if (!cancelled) {
          setPredicted(out);
          setPredictState('ok');
        }
      } catch (err) {
        console.warn('[IBP] P.533 prediction for the MEASURED view unavailable:', err?.message);
        if (!cancelled) setPredictState('error');
      } finally {
        predictRunning.current = false;
      }
    };
    run();
    const id = setInterval(run, PREDICT_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view, hasQTH, deLat, deLon, haveMeasurements]);

  const agreementRows = useMemo(
    () => (predicted ? agreementByBeacon(latestMeasured, predicted) : null),
    [predicted, latestMeasured],
  );

  const viewBtnStyle = (v) => ({
    padding: '1px 7px',
    background: view === v ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '3px',
    color: view === v ? 'var(--accent-blue)' : 'var(--text-muted)',
    fontSize: '9px',
    fontFamily: 'var(--font-mono)',
    fontWeight: view === v ? '700' : '400',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  });

  return (
    <div className="panel" style={{ padding: '12px' }}>
      {/* Header */}
      <div
        className="panel-header"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}
      >
        <span>{t('ibp.title')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button style={viewBtnStyle('live')} onClick={() => handleViewChange('live')}>
            {t('ibp.view.live')}
          </button>
          <button style={viewBtnStyle('log')} onClick={() => handleViewChange('log')}>
            {t('ibp.view.log')}
          </button>
          <button
            style={viewBtnStyle('measured')}
            onClick={() => handleViewChange('measured')}
            aria-label={t('ibp.view.measured')}
          >
            {t('ibp.view.measured')}
          </button>
          <span
            title={t('ibp.cycleCountdown.tooltip', { secs: cycleSecondsLeft })}
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              marginLeft: '4px',
            }}
          >
            {t('ibp.cycleCountdown', { secs: String(cycleSecondsLeft).padStart(3, ' ') })}
          </span>
        </span>
      </div>

      {/* Slot progress bar */}
      <div
        title={t('ibp.slotProgress.tooltip', { secs: secondsLeft })}
        style={{
          height: '3px',
          background: 'var(--border-color)',
          borderRadius: '2px',
          marginBottom: '10px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${slotProgress * 100}%`,
            background: 'var(--accent-blue)',
            borderRadius: '2px',
            transition: 'width 0.9s linear',
          }}
        />
      </div>

      {view === 'measured' ? (
        /* ── MEASURED view: KiwiSDR beacon monitor SNR grid ───────────── */
        <div>
          {/* Source / status line */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '6px',
              fontSize: '9px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              marginBottom: '4px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {measured.source && (
                <span
                  style={{
                    border: '1px solid var(--accent-cyan)',
                    color: 'var(--accent-cyan)',
                    borderRadius: '3px',
                    padding: '0 3px',
                    marginRight: '4px',
                  }}
                >
                  {measured.source === 'bridge' ? t('ibp.measured.source.bridge') : t('ibp.measured.source.server')}
                </span>
              )}
              {measured.station?.kiwiName || measured.station?.kiwi || measured.station?.callsign || ''}
              {measured.bridge && !measured.bridge.connected && (
                <span style={{ color: 'var(--accent-amber)', marginLeft: '4px' }}>
                  {t('ibp.measured.kiwiDisconnected')}
                </span>
              )}
            </span>
            <span>{measured.updatedAt ? ageLabel(measured.updatedAt, nowMs) : ''}</span>
          </div>

          {!measured.enabled ? (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '8px 2px', lineHeight: 1.5 }}>
              {t('ibp.measured.notConfigured')}
            </div>
          ) : measured.status === 'unavailable' ? (
            <div style={{ fontSize: '10px', color: 'var(--accent-amber)', padding: '8px 2px', lineHeight: 1.5 }}>
              {t('ibp.measured.unavailable')}
            </div>
          ) : !measured.measurements.length ? (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '8px 2px', lineHeight: 1.5 }}>
              {t('ibp.measured.empty')}
            </div>
          ) : (
            <>
              {/* Column header: band labels + strip + agreement */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `52px repeat(${IBP_BANDS.length}, minmax(14px, 1fr)) minmax(40px, 1.6fr) 30px`,
                  gap: '2px',
                  alignItems: 'end',
                  fontSize: '8px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  marginBottom: '2px',
                }}
              >
                <span />
                {IBP_BANDS.map((b) => (
                  <span
                    key={b.label}
                    style={{ textAlign: 'center', color: DEFAULT_BAND_COLORS[b.label] ?? 'var(--text-muted)' }}
                  >
                    {b.label.replace('m', '')}
                  </span>
                ))}
                <span style={{ textAlign: 'center' }}>24h</span>
                <span
                  style={{ textAlign: 'right' }}
                  title={
                    predictState === 'error'
                      ? t('ibp.measured.vsUnavailable')
                      : predictState === 'running'
                        ? t('ibp.measured.vsPending')
                        : t('ibp.measured.vsHeader')
                  }
                >
                  P.533
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `52px repeat(${IBP_BANDS.length}, minmax(14px, 1fr)) minmax(40px, 1.6fr) 30px`,
                  gap: '2px',
                  alignItems: 'center',
                }}
              >
                {IBP_BEACONS.map((beacon) => {
                  const txBand = txBandByCallsign.get(beacon.callsign);
                  const txColor = txBand ? (DEFAULT_BAND_COLORS[txBand.label] ?? 'var(--text-muted)') : null;
                  const strip = strips?.[beacon.callsign];
                  const heardBins = strip ? strip.filter((b) => b.n && b.maxSnr >= HEARD_SNR_DB).length : 0;
                  const agree = agreementRows?.[beacon.callsign];

                  return [
                    <div
                      key={`${beacon.callsign}-m-cs`}
                      title={`${beacon.callsign} — ${beacon.location}`}
                      style={{
                        fontSize: '10px',
                        fontWeight: '700',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.3,
                      }}
                    >
                      {txColor && (
                        <span
                          title={t('ibp.log.txNow', { band: txBand.label })}
                          style={{ color: txColor, marginRight: '2px' }}
                        >
                          ●
                        </span>
                      )}
                      {beacon.callsign}
                    </div>,

                    ...IBP_BANDS.map((band) => {
                      const m = latestMeasured.get(pairKey(beacon.callsign, band.label));
                      const age = m ? ageLabel(m.t, nowMs) : '';
                      let title;
                      let style;
                      if (!m) {
                        title = t('ibp.measured.noDataTooltip', { callsign: beacon.callsign, band: band.label });
                        style = { background: 'transparent', border: '1px dashed var(--border-color)', opacity: 0.3 };
                      } else if (m.snrDb >= HEARD_SNR_DB) {
                        title = t('ibp.measured.cellTooltip', {
                          callsign: beacon.callsign,
                          band: band.label,
                          snr: fmtSnr(m.snrDb),
                          age,
                          level: m.levelDbm ?? '?',
                          noise: m.noiseDbm ?? '?',
                        });
                        style = { background: snrColor(m.snrDb), opacity: nowMs - m.t > STALE_MS ? 0.45 : 1 };
                      } else {
                        title = t('ibp.measured.notHeardTooltip', {
                          callsign: beacon.callsign,
                          band: band.label,
                          snr: fmtSnr(m.snrDb),
                          age,
                        });
                        style = { background: NOT_HEARD_COLOR, opacity: nowMs - m.t > STALE_MS ? 0.3 : 0.7 };
                      }
                      return (
                        <div
                          key={`${beacon.callsign}-m-${band.label}`}
                          title={title}
                          style={{
                            height: '11px',
                            borderRadius: '2px',
                            boxSizing: 'border-box',
                            fontSize: '7px',
                            lineHeight: '11px',
                            textAlign: 'center',
                            color: '#000',
                            fontFamily: 'var(--font-mono)',
                            overflow: 'hidden',
                            ...style,
                          }}
                        >
                          {m && m.snrDb >= HEARD_SNR_DB ? fmtSnr(m.snrDb) : ''}
                        </div>
                      );
                    }),

                    <div
                      key={`${beacon.callsign}-m-strip`}
                      title={t('ibp.measured.stripTooltip', {
                        callsign: beacon.callsign,
                        heard: heardBins,
                        bins: strip ? strip.length : 0,
                      })}
                      style={{
                        height: '11px',
                        borderRadius: '2px',
                        border: '1px solid var(--border-color)',
                        boxSizing: 'border-box',
                        background: strip ? heatStripGradient(strip) : 'transparent',
                      }}
                    />,

                    <div
                      key={`${beacon.callsign}-m-vs`}
                      title={
                        agree && agree.total
                          ? t('ibp.measured.vsTooltip', {
                              callsign: beacon.callsign,
                              agrees: agree.agrees,
                              total: agree.total,
                              worse: agree.worse,
                              better: agree.better,
                            })
                          : predictState === 'running'
                            ? t('ibp.measured.vsPending')
                            : t('ibp.measured.vsUnavailable')
                      }
                      style={{
                        fontSize: '8px',
                        fontFamily: 'var(--font-mono)',
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                        color:
                          agree && agree.total
                            ? agree.worse > agree.agrees
                              ? 'var(--accent-amber)'
                              : agree.better > agree.agrees
                                ? 'var(--accent-cyan)'
                                : 'var(--accent-green, #4caf50)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {agree && agree.total ? `${agree.agrees}/${agree.total}` : '—'}
                    </div>,
                  ];
                })}
              </div>

              {/* Legend: SNR scale */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '6px',
                  fontSize: '8px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                }}
              >
                <span>{SNR_SCALE_MIN}</span>
                <span
                  aria-hidden="true"
                  style={{
                    flex: 1,
                    height: '5px',
                    borderRadius: '2px',
                    background: `linear-gradient(to right, ${NOT_HEARD_COLOR} 0 ${Math.round(
                      ((HEARD_SNR_DB - SNR_SCALE_MIN) / (SNR_SCALE_MAX - SNR_SCALE_MIN)) * 100,
                    )}%, ${snrColor(HEARD_SNR_DB)}, ${snrColor((HEARD_SNR_DB + SNR_SCALE_MAX) / 2)}, ${snrColor(SNR_SCALE_MAX)})`,
                  }}
                />
                <span>+{SNR_SCALE_MAX} dB</span>
                <span style={{ marginLeft: '4px' }}>{t('ibp.measured.legend')}</span>
              </div>
            </>
          )}
        </div>
      ) : view === 'live' ? (
        /* ── LIVE view: band rows ─────────────────────────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {schedule.map(({ band, beacon, bearing, distanceKm }) => {
            const bandColor = DEFAULT_BAND_COLORS[band.label] ?? 'var(--text-muted)';
            const rbn = rbnData.get(beacon.callsign);

            return (
              <div
                key={band.mhz}
                onClick={rigEnabled ? () => tuneTo(band.mhz, 'CW') : undefined}
                title={rigEnabled ? t('ibp.tune', { mhz: band.mhz.toFixed(3) }) : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: hasQTH ? '52px 1fr auto' : '52px 1fr',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '5px 8px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '4px',
                  borderLeft: `3px solid ${bandColor}`,
                  cursor: rigEnabled ? 'pointer' : 'default',
                }}
              >
                {/* Band label + frequency */}
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: '700',
                      color: bandColor,
                      fontFamily: 'var(--font-mono)',
                      lineHeight: 1.2,
                    }}
                  >
                    {band.label}
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {band.mhz.toFixed(3)}
                  </div>
                </div>

                {/* Callsign + location */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {beacon.callsign}
                  </div>
                  <div
                    style={{
                      fontSize: '9px',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {beacon.location}
                  </div>
                  {rbn && (
                    <div
                      title={t('ibp.rbn.tooltip', { count: rbn.count, snr: rbn.maxSNR ?? '?' })}
                      style={{
                        fontSize: '9px',
                        color: 'var(--accent-green, #4caf50)',
                        fontFamily: 'var(--font-mono)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('ibp.rbn.heard', {
                        count: rbn.count,
                        snr: rbn.maxSNR != null ? (rbn.maxSNR >= 0 ? `+${rbn.maxSNR}` : `${rbn.maxSNR}`) : '?',
                      })}
                    </div>
                  )}
                </div>

                {/* Bearing + distance (only when QTH is known) */}
                {hasQTH && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: '10px',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatBearing(bearing, deLat, deLon, bearingMode)}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDistance(distanceKm, units)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── LOG view: listening-log timeline ─────────────────────────── */
        <div>
          {/* Time axis: oldest column with data → now */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '8px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              marginBottom: '3px',
            }}
          >
            <span>{oldestWithData ? `${formatCycleTime(oldestWithData.startMs)}z` : ''}</span>
            <span>{t('ibp.log.now')}</span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `52px repeat(${HISTORY_MAX_CYCLES}, minmax(6px, 1fr)) 34px`,
              gap: '2px',
              alignItems: 'center',
            }}
          >
            {IBP_BEACONS.map((beacon) => {
              const txBand = txBandByCallsign.get(beacon.callsign);
              const txColor = txBand ? (DEFAULT_BAND_COLORS[txBand.label] ?? 'var(--text-muted)') : null;
              const nextSecs = next20mByCallsign.get(beacon.callsign);

              return [
                /* Callsign + currently-transmitting band dot */
                <div
                  key={`${beacon.callsign}-cs`}
                  title={`${beacon.callsign} — ${beacon.location}`}
                  style={{
                    fontSize: '10px',
                    fontWeight: '700',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.3,
                  }}
                >
                  {txColor && (
                    <span
                      title={t('ibp.log.txNow', { band: txBand.label })}
                      style={{ color: txColor, marginRight: '2px' }}
                    >
                      ●
                    </span>
                  )}
                  {beacon.callsign}
                </div>,

                /* One heard/not-heard cell per cycle */
                ...columns.map(({ startMs, record }) => {
                  const heard = record?.heard.get(beacon.callsign) ?? null;
                  const timeLabel = `${formatCycleTime(startMs)}z`;

                  let cellStyle;
                  let title;
                  if (heard) {
                    cellStyle = {
                      background: 'var(--accent-green, #4caf50)',
                      opacity: snrOpacity(heard.maxSNR),
                    };
                    title = t('ibp.log.heardTooltip', {
                      callsign: beacon.callsign,
                      count: heard.count,
                      snr: heard.maxSNR ?? '?',
                      time: timeLabel,
                    });
                  } else if (record) {
                    cellStyle = {
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                    };
                    title = t('ibp.log.notHeardTooltip', { callsign: beacon.callsign, time: timeLabel });
                  } else {
                    cellStyle = {
                      background: 'transparent',
                      border: '1px dashed var(--border-color)',
                      opacity: 0.3,
                    };
                    title = t('ibp.log.noDataTooltip', { time: timeLabel });
                  }

                  return (
                    <div
                      key={`${beacon.callsign}-${startMs}`}
                      title={title}
                      style={{ height: '9px', borderRadius: '2px', boxSizing: 'border-box', ...cellStyle }}
                    />
                  );
                }),

                /* Countdown to next 20 m run */
                <div
                  key={`${beacon.callsign}-next`}
                  title={t('ibp.log.nextTooltip', {
                    callsign: beacon.callsign,
                    time: formatCountdown(nextSecs ?? 0),
                  })}
                  style={{
                    fontSize: '8px',
                    fontFamily: 'var(--font-mono)',
                    color: txColor ?? 'var(--text-muted)',
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {nextSecs != null ? formatCountdown(nextSecs) : ''}
                </div>,
              ];
            })}
          </div>

          {logIsEmpty && (
            <div
              style={{
                marginTop: '6px',
                fontSize: '9px',
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}
            >
              {t('ibp.log.empty')}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          marginTop: '8px',
          fontSize: '9px',
          color: 'var(--text-muted)',
          textAlign: 'right',
        }}
      >
        {t('ibp.footer')}
      </div>
    </div>
  );
};

export default IBPPanel;

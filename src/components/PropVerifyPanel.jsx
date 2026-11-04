/**
 * PropVerifyPanel — "Prediction Check": what the P.533 model says about the
 * DE → DX path right now, against what is actually happening on it.
 *
 * Three pieces of evidence per HF band, all for the path you are pointing at:
 *   • predicted — ITU-R P.533 circuit reliability DE → DX for this UTC hour,
 *     with your mode / power / antenna (one WASM call; REST fallback)
 *   • observed  — DX cluster + PSKReporter spots in the last 15 minutes whose
 *     two ends sit on the DE and DX continents (activity, not reliability)
 *   • beacons   — measured NCDXF beacon SNR near DX from a KiwiSDR beacon
 *     monitor (only when the Rig Bridge plugin is running)
 * and a plain-language status per band: OPEN (confirmed / unconfirmed),
 * MARGINAL, CLOSED, or OPEN though the model says closed.
 *
 * Re-predicts whenever DE, DX, mode, power, antenna or the sunspot number
 * change, and every 10 minutes. The pure scoring lives in utils/propVerify.js.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { predictInWorker } from '../services/p533/predictInWorker.js';
import { useIBPMeasurements } from '../hooks/useIBPMeasurements.js';
import { measuredBandSummary } from '../utils/ibpMeasured.js';
import { IBP_BEACONS } from '../utils/ibp.js';
import { ANTENNA_PROFILES, modeRequiredSNR } from '../utils/propagationAdjust.js';
import { calculateBearing, calculateDistance, latLonToMaidenhead, maidenheadToLatLon } from '../utils/geo.js';
import { formatBearing } from '../utils/bearing.js';
import {
  VERIFY_BANDS,
  OBSERVED_WINDOW_MS,
  PATH_CONFIRM_COUNT,
  BEACON_NEAR_DX_KM,
  continentOf,
  countPathSpotsByBand,
  buildPathComparison,
  measurementsNear,
} from '../utils/propVerify.js';

const BAND_FREQ_MHZ = { '80m': 3.5, '40m': 7, '30m': 10, '20m': 14, '17m': 18, '15m': 21, '12m': 24, '10m': 28 };
const PREDICT_REFRESH_MS = 10 * 60 * 1000;
const OBSERVED_TICK_MS = 30 * 1000;

/** Map a P.533 frequency (MHz) to the nearest verify band, or null. */
function freqToVerifyBand(freq) {
  let best = null;
  let bestD = Infinity;
  for (const [band, f] of Object.entries(BAND_FREQ_MHZ)) {
    const d = Math.abs(freq - f);
    if (d < bestD) {
      bestD = d;
      best = band;
    }
  }
  return bestD <= 1.5 ? best : null;
}

const STATUS_STYLE = {
  'open-confirmed': { color: 'var(--accent-green)', glyph: '●' },
  'open-unconfirmed': { color: 'var(--accent-cyan)', glyph: '◐' },
  'open-surprise': { color: 'var(--accent-amber)', glyph: '▲' },
  marginal: { color: 'var(--accent-amber)', glyph: '◔' },
  closed: { color: 'var(--text-muted)', glyph: '○' },
  nodata: { color: 'var(--text-muted)', glyph: '–' },
};

const gridToLatLon = (grid) => {
  try {
    const p = grid ? maidenheadToLatLon(grid) : null;
    return p && Number.isFinite(p.lat) ? p : null;
  } catch {
    return null;
  }
};

export const PropVerifyPanel = ({
  deLocation,
  deCallsign,
  dxLocation,
  dxCallsign,
  dxSpots = [],
  pskReporter,
  solarIndices,
  propConfig = {},
  units = 'imperial',
}) => {
  const { t } = useTranslation();
  const mode = propConfig.mode || 'SSB';
  const power = propConfig.power || 100;
  const antenna = propConfig.antenna || 'isotropic';
  const ssn = solarIndices?.data?.ssn?.current ?? 100;

  const deOk = !!deLocation && Number.isFinite(deLocation.lat) && Number.isFinite(deLocation.lon);
  const dxOk = !!dxLocation && Number.isFinite(dxLocation.lat) && Number.isFinite(dxLocation.lon);

  // ── Predicted side: one P.533 run for the DE → DX circuit, this UTC hour ──
  const [prediction, setPrediction] = useState(null); // { byBand, engine, hour, at }
  const [predError, setPredError] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const genRef = useRef(0);

  useEffect(() => {
    if (!deOk || !dxOk) return undefined;
    // Each (re)run gets its own generation; an older run that finishes late
    // is discarded instead of blocking the newer one (the old runningRef guard
    // left the panel on "loading" for ten minutes after a config change).
    const run = async () => {
      const gen = ++genRef.current;
      const now = new Date();
      const hour = now.getUTCHours();
      setPredicting(true);
      try {
        const txGain = (ANTENNA_PROFILES[antenna] || ANTENNA_PROFILES.isotropic).gain;
        const result = await predictInWorker({
          txLat: deLocation.lat,
          txLon: deLocation.lon,
          rxLat: dxLocation.lat,
          rxLon: dxLocation.lon,
          year: now.getUTCFullYear(),
          month: now.getUTCMonth() + 1,
          hour,
          ssn,
          txPower: parseFloat(power) || 100,
          txGain,
          requiredSNR: modeRequiredSNR(mode),
        });
        if (gen !== genRef.current) return;
        const byBand = {};
        for (const f of result.frequencies || []) {
          const band = freqToVerifyBand(f.freq);
          if (band) byBand[band] = Math.max(0, Math.min(99, Math.round(f.reliability)));
        }
        setPrediction({ byBand, engine: 'wasm', hour, at: Date.now() });
        setPredError(false);
      } catch (err) {
        // Fallback: the server's point-to-point estimate (self-hosters
        // without the WASM bundle, or a worker that failed to start).
        console.warn('[PropVerify] WASM engine unavailable, asking the server:', err.message);
        try {
          const params = new URLSearchParams({
            deLat: deLocation.lat,
            deLon: deLocation.lon,
            dxLat: dxLocation.lat,
            dxLon: dxLocation.lon,
            mode,
            power,
            antenna,
          });
          const res = await fetch(`/api/propagation?${params}`);
          if (gen !== genRef.current) return;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const byBand = {};
          for (const b of data.currentBands || []) {
            if (VERIFY_BANDS.includes(b.band) && Number.isFinite(b.reliability)) {
              byBand[b.band] = Math.max(0, Math.min(99, Math.round(b.reliability)));
            }
          }
          if (gen !== genRef.current) return;
          setPrediction(Object.keys(byBand).length ? { byBand, engine: 'est', hour, at: Date.now() } : null);
          setPredError(Object.keys(byBand).length === 0);
        } catch (err2) {
          console.error('[PropVerify] Prediction fallback failed:', err2);
          if (gen === genRef.current) setPredError(true);
        }
      } finally {
        if (gen === genRef.current) setPredicting(false);
      }
    };

    run();
    const interval = setInterval(run, PREDICT_REFRESH_MS);
    return () => {
      genRef.current++; // invalidate any run still in flight
      clearInterval(interval);
    };
  }, [deOk, dxOk, deLocation?.lat, deLocation?.lon, dxLocation?.lat, dxLocation?.lon, mode, power, antenna, ssn]);

  // ── Observed side: 15-min spots across the DE↔DX continent pair ──
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), OBSERVED_TICK_MS);
    return () => clearInterval(iv);
  }, []);

  const deContinent = useMemo(
    () => continentOf(deCallsign, deLocation?.lat, deLocation?.lon),
    [deCallsign, deLocation?.lat, deLocation?.lon],
  );
  const dxContinent = useMemo(
    () => continentOf(dxCallsign, dxLocation?.lat, dxLocation?.lon),
    [dxCallsign, dxLocation?.lat, dxLocation?.lon],
  );

  const { counts, totalSpots } = useMemo(() => {
    const psk = [
      ...(pskReporter?.txReports || []).map((r) => ({ r, other: r.receiver, grid: r.receiverGrid })),
      ...(pskReporter?.rxReports || []).map((r) => ({ r, other: r.sender, grid: r.senderGrid })),
    ].map(({ r, other, grid }) => {
      const p = gridToLatLon(grid);
      return {
        band: r.band,
        timestamp: r.timestamp,
        deContinentEnd: true,
        otherCall: other,
        otherLat: p?.lat,
        otherLon: p?.lon,
      };
    });
    const c = countPathSpotsByBand([...dxSpots, ...psk], { deContinent, dxContinent, now: nowTick });
    return { counts: c, totalSpots: Object.values(c).reduce((s, n) => s + n, 0) };
  }, [dxSpots, pskReporter?.txReports, pskReporter?.rxReports, deContinent, dxContinent, nowTick]);

  // ── Third source: measured beacon SNR near the DX end (KiwiSDR monitor) ──
  const ibpMeasured = useIBPMeasurements();
  const { beaconsByBand, beaconNames } = useMemo(() => {
    if (!dxOk || !ibpMeasured.measurements.length) return { beaconsByBand: null, beaconNames: [] };
    const near = measurementsNear(ibpMeasured.measurements, IBP_BEACONS, dxLocation.lat, dxLocation.lon);
    if (!near.length) return { beaconsByBand: null, beaconNames: [] };
    return {
      beaconsByBand: measuredBandSummary(near, { now: nowTick }),
      beaconNames: [...new Set(near.map((m) => m.beacon))],
    };
  }, [ibpMeasured.measurements, dxOk, dxLocation?.lat, dxLocation?.lon, nowTick]);
  const hasBeacons = !!beaconsByBand && Object.keys(beaconsByBand).length > 0;

  const rows = useMemo(
    () => buildPathComparison(prediction?.byBand, counts, beaconsByBand),
    [prediction, counts, beaconsByBand],
  );

  // ── Path description for the header ──
  const path = useMemo(() => {
    if (!deOk || !dxOk) return null;
    const km = calculateDistance(deLocation.lat, deLocation.lon, dxLocation.lat, dxLocation.lon);
    const bearing = calculateBearing(deLocation.lat, deLocation.lon, dxLocation.lat, dxLocation.lon);
    const dist =
      units === 'metric' ? `${Math.round(km).toLocaleString()} km` : `${Math.round(km * 0.621371).toLocaleString()} mi`;
    return {
      deGrid: latLonToMaidenhead({ lat: deLocation.lat, lon: deLocation.lon }, 4),
      dxGrid: latLonToMaidenhead({ lat: dxLocation.lat, lon: dxLocation.lon }, 4),
      dist,
      bearing: formatBearing(bearing, deLocation.lat, deLocation.lon),
    };
  }, [deOk, dxOk, deLocation?.lat, deLocation?.lon, dxLocation?.lat, dxLocation?.lon, units]);

  const statusLabel = (key) =>
    ({
      'open-confirmed': t('propVerify.status.openConfirmed', { defaultValue: 'OPEN · confirmed' }),
      'open-unconfirmed': t('propVerify.status.openUnconfirmed', { defaultValue: 'OPEN · no spots yet' }),
      'open-surprise': t('propVerify.status.openSurprise', { defaultValue: 'OPEN · model said closed' }),
      marginal: t('propVerify.status.marginal', { defaultValue: 'MARGINAL' }),
      closed: t('propVerify.status.closed', { defaultValue: 'CLOSED' }),
      nodata: t('propVerify.status.nodata', { defaultValue: 'no prediction' }),
    })[key] || key;

  const statusExplain = (row) => {
    const pred = row.predicted != null ? `${row.predicted}%` : '—';
    const pair = deContinent && dxContinent ? `${deContinent}↔${dxContinent}` : '';
    const parts = [
      t('propVerify.explain.predicted', { defaultValue: 'P.533 {{pred}}', pred }),
      t('propVerify.explain.spots', { defaultValue: '{{count}} spots {{pair}}', count: row.count, pair }),
    ];
    if (row.beacon) {
      const snr = row.beacon.maxSnr >= 0 ? `+${Math.round(row.beacon.maxSnr)}` : Math.round(row.beacon.maxSnr);
      parts.push(t('propVerify.explain.beacon', { defaultValue: 'beacon {{snr}} dB', snr }));
    }
    return parts.join(' · ');
  };

  const barStyle = { position: 'relative', height: '5px', background: 'var(--bg-tertiary)', borderRadius: '2px' };
  const fillStyle = (pct, color) => ({
    position: 'absolute',
    inset: '0 auto 0 0',
    width: `${Math.max(0, Math.min(99, pct || 0))}%`,
    background: color,
    borderRadius: '2px',
    opacity: 0.85,
  });

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '4px',
          fontSize: '11px',
          color: 'var(--accent-primary)',
          fontWeight: '700',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span>🎯 {t('propVerify.title', { defaultValue: 'PREDICTION CHECK' })}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', fontWeight: '400' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {mode} {power}W
          </span>
          {prediction?.engine && (
            <span
              title={
                prediction.engine === 'wasm'
                  ? t('propVerify.engineWasm', { defaultValue: 'ITU-R P.533-14, computed in your browser' })
                  : t('propVerify.engineEst', { defaultValue: 'Solar-indices estimation (WASM engine unavailable)' })
              }
              style={{
                border: `1px solid ${prediction.engine === 'wasm' ? 'var(--accent-cyan)' : 'var(--accent-amber)'}`,
                color: prediction.engine === 'wasm' ? 'var(--accent-cyan)' : 'var(--accent-amber)',
                borderRadius: '3px',
                padding: '0 4px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {prediction.engine === 'wasm' ? 'P.533' : 'EST'}
            </span>
          )}
        </span>
      </div>

      {/* Path line: who → where, how far, which way */}
      <div
        style={{
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          marginBottom: '4px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 10px',
          alignItems: 'baseline',
        }}
      >
        {path ? (
          <>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>{deCallsign || 'DE'}</span> {path.deGrid}
              <span style={{ color: 'var(--accent-cyan)' }}> → </span>
              <span style={{ color: 'var(--accent-amber)' }}>{dxCallsign || 'DX'}</span> {path.dxGrid}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {path.dist} · {path.bearing}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {prediction
                ? t('propVerify.hour', { defaultValue: '{{hour}}:00z', hour: String(prediction.hour).padStart(2, '0') })
                : ''}
              {predicting ? ' ⟳' : ''}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>
            {t('propVerify.noPath', { defaultValue: 'Set your station location and a DX target to check a path.' })}
          </span>
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 10px',
          fontSize: '9px',
          color: 'var(--text-muted)',
          marginBottom: '4px',
        }}
      >
        <span>
          <span style={{ color: 'var(--accent-cyan)' }}>▬</span>{' '}
          {t('propVerify.legendPath', { defaultValue: 'predicted (P.533, this path)' })}
        </span>
        <span>
          <span style={{ color: 'var(--accent-green)' }}>▬</span>{' '}
          {t('propVerify.legendPathSpots', {
            defaultValue: 'spots {{pair}} (15 min)',
            pair: deContinent && dxContinent ? `${deContinent}↔${dxContinent}` : '',
          })}
        </span>
        {hasBeacons && (
          <span>
            <span style={{ color: 'var(--accent-amber)' }}>▬</span>{' '}
            {t('propVerify.legendBeaconsNear', {
              defaultValue: 'beacons near DX ({{names}})',
              names: beaconNames.join(', '),
            })}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {path && !prediction && !predError && (
          <div style={{ color: 'var(--text-muted)', fontSize: '10px', padding: '4px 0 6px' }}>
            {t('propVerify.loadingPath', { defaultValue: 'Running the P.533 prediction for this path…' })}
          </div>
        )}
        {rows.map((row) => {
          const st = STATUS_STYLE[row.status] || STATUS_STYLE.nodata;
          return (
            <div
              key={row.band}
              title={statusExplain(row)}
              style={{
                display: 'grid',
                gridTemplateColumns: '30px 1fr 26px minmax(92px, auto)',
                gap: '6px',
                alignItems: 'center',
                padding: '3px 0',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                {row.band}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <span style={barStyle}>
                  <span style={fillStyle(row.predicted, 'var(--accent-cyan)')} />
                </span>
                <span style={barStyle}>
                  <span style={fillStyle(row.observed, 'var(--accent-green)')} />
                </span>
                {row.beacon && (
                  <span style={barStyle}>
                    <span style={fillStyle(row.beacon.score, 'var(--accent-amber)')} />
                  </span>
                )}
                <span
                  style={{
                    fontSize: '8px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {statusExplain(row)}
                </span>
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--text-muted)',
                  textAlign: 'right',
                }}
                aria-label={t('propVerify.spotsAria', {
                  defaultValue: '{{count}} spots across this path',
                  count: row.count,
                })}
              >
                {row.count}✦
              </span>
              <span
                style={{
                  fontSize: '8px',
                  fontFamily: 'var(--font-mono)',
                  color: st.color,
                  border: `1px solid ${st.color}`,
                  borderRadius: '3px',
                  padding: '1px 4px',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  opacity: row.status === 'nodata' || row.status === 'closed' ? 0.7 : 1,
                }}
              >
                {st.glyph} {statusLabel(row.status)}
              </span>
            </div>
          );
        })}
        {predError && (
          <div style={{ color: 'var(--accent-amber)', fontSize: '9px', padding: '4px' }}>
            {t('propVerify.predError', {
              defaultValue: 'Prediction engine unavailable — showing observed activity only.',
            })}
          </div>
        )}
      </div>

      {/* What am I looking at? */}
      <details
        style={{
          borderTop: '1px solid var(--border-color)',
          paddingTop: '3px',
          fontSize: '9px',
          color: 'var(--text-muted)',
          lineHeight: 1.45,
        }}
      >
        <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
          {t('propVerify.help.summary', { defaultValue: 'What am I looking at?' })}{' '}
          <span style={{ color: 'var(--text-muted)' }}>
            ·{' '}
            {t('propVerify.help.spotsInWindow', {
              defaultValue: '{{n}} spots on this path in {{min}} min',
              n: totalSpots,
              min: Math.round(OBSERVED_WINDOW_MS / 60000),
            })}
          </span>
        </summary>
        <div style={{ paddingTop: '4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div>
            <span style={{ color: 'var(--accent-cyan)' }}>▬</span>{' '}
            {t('propVerify.help.predicted', {
              defaultValue:
                'Predicted: ITU-R P.533 circuit reliability from your station to the DX target for this UTC hour, with your mode, power and antenna — the percentage of days the band supports the path at this hour. Recomputed when you change DX.',
            })}
          </div>
          <div>
            <span style={{ color: 'var(--accent-green)' }}>▬</span>{' '}
            {t('propVerify.help.observed', {
              defaultValue:
                'Spots: DX cluster and PSKReporter reports from the last 15 minutes whose two ends are on your continent and the DX continent. This measures who is on the air, not path quality — a quiet band on a weekday morning is not a wrong model.',
            })}
          </div>
          <div>
            <span style={{ color: 'var(--accent-amber)' }}>▬</span>{' '}
            {t('propVerify.help.beacons', {
              defaultValue:
                'Beacons: with the Rig Bridge KiwiSDR beacon monitor running, the best measured SNR of NCDXF beacons within {{km}} km of DX in the last 20 minutes — a real receiver on the far end of the path.',
              km: BEACON_NEAR_DX_KM.toLocaleString(),
            })}
          </div>
          <div>
            {t('propVerify.help.status', {
              defaultValue:
                'Status: OPEN · confirmed = model ≥ 50 % and activity seen; OPEN · no spots yet = model open, nothing heard; MARGINAL = model 15–50 %; CLOSED = model < 15 % and nothing heard; OPEN · model said closed = model < 15 % but {{n}}+ spots on the path, so trust the air over the model.',
              n: PATH_CONFIRM_COUNT,
            })}
          </div>
        </div>
      </details>
    </div>
  );
};

export default PropVerifyPanel;

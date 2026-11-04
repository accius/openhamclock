/**
 * useOpportunities — the ranked "worth working right now" feed.
 *
 * Inputs (all already fetched elsewhere in App.jsx — this hook adds no
 * network traffic of its own):
 *   - raw DX cluster accumulator + POTA/SOTA/WWFF/WWBOTA spots (last 15 min)
 *   - logbook-derived needs via useAwards (new DXCC / band / zone / grid / state)
 *   - /api/band-openings payload (fallback when no prediction is available)
 *   - browser-side P.533 engine (predictInWorker) for DE → spot reliability,
 *     run serially, capped at the top 40 candidates, cached 10 min per
 *     station+band. One worker call returns every HF band for that path, so
 *     a single prediction fills the cache for all of a station's bands.
 *
 * Predictions only run while something consumes the feed (the panel is
 * mounted, or the Opportunities alert feed is enabled) — otherwise the hook
 * just ranks on the band-opening fallback, which is free.
 *
 * Pure scoring lives in utils/opportunityScore.js (tested).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAwards } from './useAwards.js';
import { ctyLookup } from '../utils/ctyLookup.js';
import { getAlertSettings, ALERT_SETTINGS_EVENT } from '../utils/audioAlerts.js';
import { ANTENNA_PROFILES, modeRequiredSNR } from '../utils/propagationAdjust.js';
import {
  aggregateSpots,
  mergeCandidates,
  evaluateNeeds,
  rankOpportunities,
  selectForPrediction,
  nearestFrequencyReliability,
  PREDICTION_TTL_MS,
  MAX_PREDICTION_CANDIDATES,
} from '../utils/opportunityScore.js';

const TICK_MS = 30 * 1000;
const ENGINE_RETRY_MS = 10 * 60 * 1000;
const HF_BAND_FREQS = {
  '160m': 1.8,
  '80m': 3.5,
  '40m': 7.1,
  '30m': 10.1,
  '20m': 14.1,
  '17m': 18.1,
  '15m': 21.1,
  '12m': 24.9,
  '10m': 28.1,
};

// ── Consumer registry: the panel announces itself so predictions only run
// when someone is looking (or listening via the alert feed).
const consumers = { count: 0, listeners: new Set() };
export function registerOpportunityConsumer() {
  consumers.count += 1;
  consumers.listeners.forEach((cb) => cb(consumers.count));
  return () => {
    consumers.count = Math.max(0, consumers.count - 1);
    consumers.listeners.forEach((cb) => cb(consumers.count));
  };
}

function alertFeedEnabled() {
  try {
    return !!getAlertSettings().opportunity?.enabled;
  } catch {
    return false;
  }
}

export function useOpportunities({
  rawSpots,
  potaSpots,
  sotaSpots,
  wwffSpots,
  wwbotaSpots,
  deLocation,
  openings,
  myZone = null,
  myContinent = null,
  propagationConfig = {},
  ssn = 100,
} = {}) {
  const { awards, hasData: hasLog } = useAwards();
  const [tick, setTick] = useState(0);
  const [predVersion, setPredVersion] = useState(0);
  const [active, setActive] = useState(() => consumers.count > 0 || alertFeedEnabled());
  const [engine, setEngine] = useState('idle'); // idle | p533 | unavailable
  const cacheRef = useRef(new Map()); // `${call}|${band}` → { reliability, at }
  const queueRef = useRef({ running: false, pending: [] });
  const engineDownUntilRef = useRef(0);

  // Re-aggregate every 30 s so ages/decay stay current between polls.
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // Track consumers + alert-feed setting.
  useEffect(() => {
    const update = () => setActive(consumers.count > 0 || alertFeedEnabled());
    consumers.listeners.add(update);
    window.addEventListener(ALERT_SETTINGS_EVENT, update);
    update();
    return () => {
      consumers.listeners.delete(update);
      window.removeEventListener(ALERT_SETTINGS_EVENT, update);
    };
  }, []);

  // 1. Candidates = aggregated spots + needs.
  const candidates = useMemo(() => {
    const now = Date.now();
    const lists = [
      aggregateSpots(rawSpots, { now, source: 'cluster' }),
      aggregateSpots(potaSpots, { now, source: 'pota' }),
      aggregateSpots(sotaSpots, { now, source: 'sota' }),
      aggregateSpots(wwffSpots, { now, source: 'wwff' }),
      aggregateSpots(wwbotaSpots, { now, source: 'wwbota' }),
    ];
    return mergeCandidates(...lists).map((c) => ({ ...c, ...evaluateNeeds(c, { awards, resolve: ctyLookup }) }));
    // tick forces a periodic re-aggregation (ages change)
  }, [rawSpots, potaSpots, sotaSpots, wwffSpots, wwbotaSpots, awards, tick]);

  // 2. Serial prediction queue (top 40, 10-min cache per station+band).
  useEffect(() => {
    if (!active || !deLocation || !Number.isFinite(deLocation.lat) || !Number.isFinite(deLocation.lon)) return;
    if (Date.now() < engineDownUntilRef.current) return;
    const now = Date.now();
    const wanted = selectForPrediction(candidates, { max: MAX_PREDICTION_CANDIDATES }).filter((c) => {
      const hit = cacheRef.current.get(c.key);
      return !(hit && now - hit.at < PREDICTION_TTL_MS);
    });
    // Dedupe by station — one worker call covers all of a station's bands.
    const seen = new Set();
    const jobs = [];
    for (const c of wanted) {
      if (seen.has(c.call)) continue;
      seen.add(c.call);
      jobs.push(c);
    }
    if (!jobs.length) return;

    const q = queueRef.current;
    const pendingCalls = new Set(q.pending.map((j) => j.call));
    for (const j of jobs) if (!pendingCalls.has(j.call)) q.pending.push(j);
    if (q.running) return;

    let cancelled = false;
    const power = parseFloat(propagationConfig.power) || 100;
    const antenna = ANTENNA_PROFILES[propagationConfig.antenna] || ANTENNA_PROFILES.isotropic;
    const requiredSNR = modeRequiredSNR(propagationConfig.mode || 'SSB');

    const run = async () => {
      q.running = true;
      let predictInWorker = null;
      try {
        ({ predictInWorker } = await import('../services/p533/predictInWorker.js'));
      } catch {
        engineDownUntilRef.current = Date.now() + ENGINE_RETRY_MS;
        setEngine('unavailable');
        q.pending = [];
        q.running = false;
        return;
      }
      while (q.pending.length && !cancelled) {
        const job = q.pending.shift();
        const d = new Date();
        try {
          const result = await predictInWorker({
            txLat: deLocation.lat,
            txLon: deLocation.lon,
            rxLat: job.lat,
            rxLon: job.lon,
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            hour: d.getUTCHours(),
            ssn: Number.isFinite(ssn) ? ssn : 100,
            txPower: power,
            txGain: antenna.gain,
            requiredSNR,
          });
          const at = Date.now();
          // Fill every HF band for this station from the one result.
          for (const [band, f] of Object.entries(HF_BAND_FREQS)) {
            const rel = nearestFrequencyReliability(result?.frequencies, f);
            if (rel != null) cacheRef.current.set(`${job.call}|${band}`, { reliability: rel, at });
          }
          // The spot's actual frequency (covers non-HF bands gracefully → null)
          const relSpot = nearestFrequencyReliability(result?.frequencies, job.freq);
          if (relSpot != null) cacheRef.current.set(job.key, { reliability: relSpot, at });
          setEngine('p533');
          setPredVersion((v) => v + 1);
        } catch {
          // WASM bundle missing / worker crash → fall back to band openings
          // and retry in 10 min instead of hammering a dead engine.
          engineDownUntilRef.current = Date.now() + ENGINE_RETRY_MS;
          setEngine('unavailable');
          q.pending = [];
          break;
        }
      }
      // Bound the cache (old entries expire by TTL; this is a hard cap).
      if (cacheRef.current.size > 600) {
        const cutoff = Date.now() - PREDICTION_TTL_MS;
        for (const [k, v] of cacheRef.current) if (v.at < cutoff) cacheRef.current.delete(k);
      }
      q.running = false;
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    candidates,
    active,
    deLocation?.lat,
    deLocation?.lon,
    ssn,
    propagationConfig.mode,
    propagationConfig.power,
    propagationConfig.antenna,
  ]);

  // 3. Rank.
  const rows = useMemo(() => {
    const now = Date.now();
    return rankOpportunities(candidates, {
      reliabilityFor: (c) => {
        const hit = cacheRef.current.get(c.key);
        return hit && now - hit.at < PREDICTION_TTL_MS ? hit.reliability : null;
      },
      openings,
      myZone,
      myContinent,
      limit: 30,
    });
    // predVersion re-ranks when a prediction lands
  }, [candidates, openings, myZone, myContinent, predVersion]);

  // Alert feed: a new top-5 entry that is at least a new DXCC.
  const alertItems = useMemo(
    () =>
      rows
        .slice(0, 5)
        .filter((r) => r.needs?.includes('dxcc'))
        .map((r) => ({
          call: r.call,
          band: r.band,
          freq: r.freq != null ? r.freq.toFixed(3) : '',
          mode: r.mode || '',
          needs: r.needs,
          reliability: r.reliability,
        })),
    [rows],
  );

  return { rows, alertItems, hasLog, engine, active, candidateCount: candidates.length };
}

export default useOpportunities;

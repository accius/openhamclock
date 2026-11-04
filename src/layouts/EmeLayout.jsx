/**
 * EmeLayout — Earth-Moon-Earth (moonbounce) operating dashboard.
 *
 * The 3D globe is pinned (the user's saved projection is untouched) and
 * framed so Earth and Moon share the view, with the DE→Moon and Moon→DX legs
 * drawn between them. The rail carries what a moonbounce operator plans by:
 * where the moon is from both ends right now, the next mutual windows, the
 * sky tracks for both stations on one dial, a DX entry, and cluster spots
 * that look like EME traffic.
 *
 * SAT mode swaps the moon for a relay satellite: legs go DE→satellite→DX,
 * only that satellite is drawn (with its footprint), and the rail lists the
 * tracked satellites that carry a repeater/transponder, ranked by their next
 * mutual pass, with the selected pass's timing and live Doppler for DE.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { WorldMap } from '../components';
import { DXGridInput } from '../components/DXGridInput.jsx';
import { MoonSkyChart } from '../components/MoonSkyChart.jsx';
import { latLonToMaidenhead, maidenheadToLatLon } from '../utils/geo.js';
import {
  computeEmeSnapshot,
  computeMutualWindows,
  computeSkyTracks,
  isEmeSpot,
  formatDurationShort,
} from '../utils/eme.js';
import {
  satrecFor,
  makeObserver,
  relayGeometry,
  computeMutualPasses,
  rankRelayCandidates,
  dopplerCorrected,
  formatMHz,
  matchSatSpot,
  findAmsatRow,
} from '../utils/satRelay.js';
import { apiFetch } from '../utils/apiFetch.js';
import { displayNow, displayNowMs, subscribeDisplayTime } from '../utils/displayTime.js';
import { EmePlannerPanel } from '../components/EmePlannerPanel.jsx';
import { findDXPathForSpot } from '../utils/dxClusterSpotMatcher';

const ACCENT = '#c9d1e6'; // moonlight
const SAT_ACCENT = '#ffb432';
const DE_COLOR = '#4488ff';
const DX_COLOR = '#00ddff';
const MODE_KEY = 'openhamclock_emeMode';
const RELAY_SAT_KEY = 'openhamclock_emeRelaySat';
const ACTIVITY_ON_GLOBE_KEY = 'openhamclock_emeActivityOnGlobe';

const readStored = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const writeStored = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
};

const fmtUtc = (d) => (d ? d.toISOString().substring(11, 16) + 'z' : '—');
const fmtDay = (d) => (d ? d.toISOString().substring(5, 10) : '');

export default function EmeLayout(props) {
  const {
    config,
    utcTime,
    isLocalInstall,
    dxLocation,
    dxCallsign,
    dxGrid,
    dxLocked,
    handleDXChange,
    handleToggleDxLock,
    dxClusterData,
    dxFilters,
    mapBandFilter,
    setMapBandFilter,
    mapLayers,
    toggleDXLabels,
    hoveredSpot,
    setShowSettings,
    filteredSatellites,
  } = props;

  const [seconds, setSeconds] = useState(() => String(new Date().getUTCSeconds()).padStart(2, '0'));
  const [minuteTick, setMinuteTick] = useState(0);
  const [frameKey, setFrameKey] = useState(0);
  const [minElev, setMinElev] = useState(0);
  // MOON (EME) or SAT (relay through a repeater/transponder satellite)
  const [mode, setModeState] = useState(() => (readStored(MODE_KEY, 'moon') === 'sat' ? 'sat' : 'moon'));
  const setMode = (m) => {
    setModeState(m);
    writeStored(MODE_KEY, m);
    setFrameKey((k) => k + 1);
  };
  const [relaySatName, setRelaySatState] = useState(() => readStored(RELAY_SAT_KEY, ''));
  const setRelaySat = (name) => {
    setRelaySatState(name);
    writeStored(RELAY_SAT_KEY, name);
  };
  const [secondTick, setSecondTick] = useState(0);
  const satMinElev = Number.isFinite(config.satellite?.minElev) ? config.satellite.minElev : 5;

  useEffect(() => {
    const timer = setInterval(() => {
      const now = displayNow();
      setSeconds(String(now.getUTCSeconds()).padStart(2, '0'));
      setSecondTick((t) => t + 1);
      if (now.getUTCSeconds() === 0) setMinuteTick((t) => t + 1);
    }, 1000);
    // A display-time shift re-plans everything (snapshot, windows, tracks) at once.
    const unsub = subscribeDisplayTime(() => setMinuteTick((t) => t + 10));
    return () => {
      clearInterval(timer);
      unsub();
    };
  }, []);

  const de = config.location;
  const dxLat = dxLocation?.lat;
  const dxLon = dxLocation?.lon;

  // Moon now, both ends — one-minute cadence (the moon moves ≤0.25°/min).
  const snap = useMemo(
    () => computeEmeSnapshot(displayNow(), de, dxLocation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [de?.lat, de?.lon, dxLat, dxLon, minuteTick],
  );

  // Mutual windows and sky tracks are heavier scans; every 10 minutes or on
  // a DX / threshold change is plenty.
  const tenMinTick = Math.floor(minuteTick / 10);
  const windows = useMemo(
    () => computeMutualWindows(displayNow(), de, dxLocation, { hours: 48, minElev }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [de?.lat, de?.lon, dxLat, dxLon, minElev, tenMinTick],
  );
  const tracks = useMemo(
    () => computeSkyTracks(displayNow(), de, dxLocation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [de?.lat, de?.lon, dxLat, dxLon, tenMinTick],
  );

  const emeSpots = useMemo(() => (dxClusterData?.spots || []).filter(isEmeSpot), [dxClusterData?.spots]);

  // ── Satellite relay mode ───────────────────────────────────────────────
  const satMode = mode === 'sat';
  const trackedSats = useMemo(
    () => (Array.isArray(filteredSatellites) ? filteredSatellites : []),
    [filteredSatellites],
  );

  // Candidates ranked by next mutual pass — a 24 h scan per relay-capable
  // satellite at a one-minute step; recomputed every 10 minutes or when the
  // DX / tracked list / threshold changes. Runs only in SAT mode.
  const candidates = useMemo(() => {
    if (!satMode || !de) return [];
    return rankRelayCandidates(trackedSats, new Date(), de, dxLocation, {
      hours: 24,
      stepSec: 60,
      minElev: satMinElev,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satMode, trackedSats, de?.lat, de?.lon, dxLat, dxLon, satMinElev, tenMinTick]);

  // Default the selection to the best candidate when nothing (valid) is chosen
  const relaySat = useMemo(() => trackedSats.find((s) => s.name === relaySatName) || null, [trackedSats, relaySatName]);
  useEffect(() => {
    if (!satMode || relaySat || !candidates.length) return;
    const first = candidates.find((c) => c.relay) || candidates[0];
    if (first) setRelaySat(first.sat.name);
  }, [satMode, relaySat, candidates]);

  // Selected satellite's passes at a finer step
  const relayPasses = useMemo(() => {
    if (!satMode || !relaySat?.omm || !de || !dxLocation) return [];
    return computeMutualPasses(relaySat.omm, new Date(), de, dxLocation, {
      hours: 24,
      stepSec: 30,
      minElev: satMinElev,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satMode, relaySat?.name, relaySat?.omm, de?.lat, de?.lon, dxLat, dxLon, satMinElev, tenMinTick]);

  // Live geometry every second: position for the globe legs, look angles for
  // both ends, Doppler for DE.
  const live = useMemo(() => {
    if (!satMode || !relaySat?.omm || !de) return null;
    const g = relayGeometry(satrecFor(relaySat.omm), new Date(), makeObserver(de), makeObserver(dxLocation));
    if (!g) return null;
    return { ...g, deUp: g.de.elevation >= satMinElev, dxUp: !!g.dx && g.dx.elevation >= satMinElev };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satMode, relaySat?.name, relaySat?.omm, de?.lat, de?.lon, dxLat, dxLon, satMinElev, secondTick]);

  const relayTarget = useMemo(
    () => (live ? { lat: live.lat, lon: live.lon, altKm: live.altKm, deUp: live.deUp, dxUp: live.dxUp } : null),
    [live],
  );
  const relayTx = relaySat?.relayTransmitters?.[0] || null;
  const doppler = live && relayTx ? dopplerCorrected(relayTx, live.de.dopplerFactor) : null;
  const common = !!(live?.deUp && live?.dxUp);

  // ── Activity feeds ─────────────────────────────────────────────────────
  // MOON: PSK Reporter Q65/JT65 reports at 50 MHz+ (band-wide, via the
  // server's MQTT proxy) — where digital EME activity is actually visible.
  const [emeActivity, setEmeActivity] = useState({ spots: [], connected: null });
  useEffect(() => {
    if (satMode) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const res = await apiFetch('/api/pskreporter/eme?minutes=120', { cache: 'no-store' });
        if (!res?.ok) return;
        const data = await res.json();
        if (alive) setEmeActivity({ spots: Array.isArray(data.spots) ? data.spots : [], connected: !!data.connected });
      } catch {
        /* keep the last list */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [satMode]);

  // SAT: AMSAT status board (already proxied for the AMSAT panel) — who has
  // been heard on which bird over the last few days.
  const [amsat, setAmsat] = useState({ satellites: [], hours: null });
  useEffect(() => {
    if (!satMode) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const res = await apiFetch('/api/amsat/status');
        if (!res?.ok) return;
        const data = await res.json();
        if (alive) setAmsat({ satellites: Array.isArray(data.satellites) ? data.satellites : [], hours: data.hours });
      } catch {
        /* keep the last board */
      }
    };
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [satMode]);

  // SAT: satellite contacts in the cluster feed ("via SO-50", "AO-91 FM"…)
  const trackedNames = useMemo(() => trackedSats.map((s) => s.name), [trackedSats]);
  const satSpots = useMemo(
    () =>
      (dxClusterData?.spots || [])
        .map((spot) => {
          const m = matchSatSpot(spot, trackedNames);
          return m ? { spot, satName: m.satName } : null;
        })
        .filter(Boolean),
    [dxClusterData?.spots, trackedNames],
  );

  // Show the PSK Reporter reports on the globe: every station involved as a
  // clickable band-coloured dot, and each report as a faint
  // sender→Moon→receiver path (both ends bounce off the same moon).
  const [activityOnGlobe, setActivityOnGlobeState] = useState(() => readStored(ACTIVITY_ON_GLOBE_KEY, '1') !== '0');
  const setActivityOnGlobe = (on) => {
    setActivityOnGlobeState(on);
    writeStored(ACTIVITY_ON_GLOBE_KEY, on ? '1' : '0');
  };
  const emeMapSpots = useMemo(() => {
    if (satMode || !activityOnGlobe) return [];
    const byCall = new Map();
    for (const r of emeActivity.spots) {
      const add = (call, lat, lon, grid) => {
        if (!call || byCall.has(call)) return;
        const loc = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : maidenheadToLatLon(grid || '');
        if (!loc) return;
        // Shaped like a PSK Reporter RX spot so the globe labels the dot with
        // the station's own call and colours it by band.
        byCall.set(call, {
          lat: loc.lat,
          lon: loc.lon,
          sender: call,
          call,
          direction: 'rx',
          band: r.band,
          mode: r.mode,
          freqMHz: r.freqMHz,
          freq: r.freq,
          snr: r.snr,
          timestamp: r.timestamp,
        });
      };
      add(r.sender, r.senderLat, r.senderLon, r.senderGrid);
      add(r.receiver, r.receiverLat, r.receiverLon, r.receiverGrid);
    }
    return [...byCall.values()];
  }, [emeActivity.spots, satMode, activityOnGlobe]);
  const emeActivityPaths = useMemo(() => {
    if (satMode || !activityOnGlobe) return null;
    return emeActivity.spots
      .map((r) => {
        const a = Number.isFinite(r.senderLat)
          ? { lat: r.senderLat, lon: r.senderLon }
          : maidenheadToLatLon(r.senderGrid || '');
        const b = Number.isFinite(r.receiverLat)
          ? { lat: r.receiverLat, lon: r.receiverLon }
          : maidenheadToLatLon(r.receiverGrid || '');
        return a && b ? { aLat: a.lat, aLon: a.lon, bLat: b.lat, bLon: b.lon, freqMHz: r.freqMHz } : null;
      })
      .filter(Boolean);
  }, [emeActivity.spots, satMode, activityOnGlobe]);
  const handleGlobeSpotClick = useCallback(
    (raw) => {
      if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return;
      handleDXChange({ lat: raw.lat, lon: raw.lon, callsign: raw.call || raw.sender || null });
    },
    [handleDXChange],
  );

  const handleEmeActivityClick = useCallback(
    (r) => {
      const loc =
        Number.isFinite(r.senderLat) && Number.isFinite(r.senderLon)
          ? { lat: r.senderLat, lon: r.senderLon }
          : maidenheadToLatLon(r.senderGrid || '');
      if (loc) handleDXChange({ lat: loc.lat, lon: loc.lon, callsign: r.sender ?? null });
    },
    [handleDXChange],
  );

  const handleSpotClick = useCallback(
    (spot) => {
      const path = findDXPathForSpot(dxClusterData?.paths || [], spot);
      if (path && Number.isFinite(path.dxLat) && Number.isFinite(path.dxLon)) {
        handleDXChange({ lat: path.dxLat, lon: path.dxLon, callsign: spot.call ?? null });
      }
    },
    [dxClusterData?.paths, handleDXChange],
  );

  const nextWindow = windows.find((w) => !w.open);
  const openWindow = windows.find((w) => w.open);
  const deGridStr = (config.locator || (de ? latLonToMaidenhead(de, 6) : '') || '').toUpperCase();

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'grid',
        gridTemplateRows: '44px 1fr',
        background: '#05060a',
        fontFamily: 'var(--font-mono)',
        overflow: 'hidden',
        color: '#ccc',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: '#0b0d14',
          borderBottom: '1px solid #232838',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{ color: ACCENT, fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
            onClick={() => setShowSettings(true)}
            title="Open settings"
          >
            {config.callsign || 'N0CALL'}
          </span>
          <span style={{ color: '#667', fontSize: '11px' }}>{deGridStr}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>{satMode ? '🛰️' : snap?.moon.phaseEmoji || '🌙'}</span>
          <span
            style={{ color: satMode ? SAT_ACCENT : ACCENT, fontWeight: 700, fontSize: '16px', letterSpacing: '2px' }}
          >
            {satMode ? 'SAT RELAY' : 'EME · MOONBOUNCE'}
          </span>
          <div
            role="tablist"
            aria-label="Relay mode"
            style={{
              display: 'flex',
              marginLeft: '10px',
              border: '1px solid #333',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            {[
              ['moon', '🌙 MOON'],
              ['sat', '🛰️ SAT'],
            ].map(([m, label]) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? (m === 'sat' ? SAT_ACCENT : ACCENT) : 'transparent',
                  color: mode === m ? '#000' : '#888',
                  border: 'none',
                  padding: '3px 9px',
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span
            style={{
              color: '#888',
              fontSize: '9px',
              border: '1px solid #555',
              borderRadius: '3px',
              padding: '1px 4px',
              marginLeft: '4px',
            }}
          >
            BETA
          </span>
          {(() => {
            const good = satMode ? common : !!snap?.mutual;
            let text = null;
            if (satMode) {
              text = !relaySat
                ? 'PICK A SATELLITE'
                : common
                  ? 'COMMON FOOTPRINT'
                  : live?.dx
                    ? 'NOT IN COMMON VIEW'
                    : 'SET A DX TARGET';
            } else if (snap) {
              text = snap.mutual ? 'MUTUAL WINDOW OPEN' : snap.dx ? 'NO COMMON MOON' : 'SET A DX TARGET';
            }
            if (!text) return null;
            return (
              <span
                style={{
                  marginLeft: '10px',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '10px',
                  background: good ? 'rgba(34,197,94,0.15)' : 'rgba(136,136,136,0.12)',
                  color: good ? '#22c55e' : '#888',
                  border: `1px solid ${good ? '#22c55e' : '#444'}`,
                }}
              >
                {text}
              </span>
            );
          })()}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>
            {utcTime}:{seconds}
          </span>
          <span style={{ color: '#888', marginLeft: '6px', fontSize: '11px' }}>UTC</span>
        </div>
      </div>

      {/* MAIN: GLOBE + SIDEBAR */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', overflow: 'hidden' }}>
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <WorldMap
            config={config}
            isLocalInstall={isLocalInstall}
            deLocation={config.location}
            dxLocation={dxLocation}
            onDXChange={handleDXChange}
            dxLocked={dxLocked}
            projectionOverride="globe3d"
            emeMode={true}
            emeFrameKey={frameKey}
            relaySatName={satMode ? relaySat?.name || null : null}
            relayTarget={satMode ? relayTarget : null}
            potaSpots={[]}
            sotaSpots={[]}
            wwbotaSpots={[]}
            mySpots={[]}
            dxPaths={[]}
            dxFilters={dxFilters}
            mapBandFilter={mapBandFilter}
            onMapBandFilterChange={setMapBandFilter}
            satellites={satMode ? trackedSats : []}
            pskReporterSpots={emeMapSpots}
            emeActivityPaths={emeActivityPaths}
            onSpotClick={handleGlobeSpotClick}
            showDeDxMarkers={mapLayers?.showDeDxMarkers ?? true}
            showDXPaths={false}
            showDXLabels={false}
            onToggleDXLabels={toggleDXLabels}
            showPOTA={false}
            showSOTA={false}
            showWWBOTA={false}
            showSatellites={satMode}
            showPSKReporter={!satMode && activityOnGlobe}
            showPSKPaths={false}
            wsjtxSpots={[]}
            showWSJTX={false}
            showDXNews={false}
            showAPRS={false}
            showMeshCom={false}
            hoveredSpot={hoveredSpot}
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
            allUnits={config.allUnits}
            mouseZoom={config.mouseZoom}
          />
          <button
            onClick={() => setFrameKey((k) => k + 1)}
            title="Frame Earth and Moon"
            style={{
              position: 'absolute',
              left: '12px',
              bottom: '12px',
              zIndex: 1000,
              background: 'rgba(11,13,20,0.85)',
              color: ACCENT,
              border: `1px solid ${ACCENT}55`,
              borderRadius: '4px',
              padding: '5px 10px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
          >
            {satMode ? '🛰️ Frame satellite' : '🌙 Frame Earth + Moon'}
          </button>
        </div>

        {/* SIDEBAR */}
        <div
          style={{
            background: '#0b0d14',
            borderLeft: '1px solid #232838',
            overflowY: 'auto',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {satMode && (
            <>
              {/* RELAY CANDIDATES */}
              <PanelSection
                title="Relay Satellites"
                count={candidates.filter((c) => c.relay).length}
                color={SAT_ACCENT}
              >
                {trackedSats.length === 0 ? (
                  <EmptyState text="No satellites tracked — pick some in Settings → Satellites" />
                ) : (
                  candidates.map(({ sat, relay, nextPass }) => {
                    const sel = sat.name === relaySat?.name;
                    const tx = sat.relayTransmitters?.[0];
                    return (
                      <div
                        key={sat.name}
                        onClick={() => setRelaySat(sat.name)}
                        title={relay ? 'Select for relay' : 'No repeater/transponder data in SatNOGS'}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          marginBottom: '2px',
                          borderLeft: `2px solid ${sel ? SAT_ACCENT : relay ? '#2a3040' : 'transparent'}`,
                          background: sel ? 'rgba(255,180,50,0.08)' : '#0d1117',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          opacity: relay ? 1 : 0.55,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: sel ? SAT_ACCENT : '#ddd', fontWeight: 600 }}>{sat.name}</span>
                          <span style={{ color: nextPass ? '#22c55e' : '#667', fontSize: '10px' }}>
                            {nextPass
                              ? nextPass.open
                                ? 'in common view now'
                                : `mutual in ${formatDurationShort(nextPass.start - Date.now())}`
                              : relay
                                ? 'no mutual pass in 24h'
                                : 'no relay data'}
                          </span>
                        </div>
                        {tx && (
                          <div style={{ color: '#888', fontSize: '10px' }}>
                            {tx.mode} · ↑ {tx.uplink} · ↓ {tx.downlink}
                            {tx.tone ? ` · ${tx.tone}` : ''}
                            {sat.relayTransmitters.length > 1 ? ` · +${sat.relayTransmitters.length - 1}` : ''}
                          </div>
                        )}
                        <AmsatLine row={findAmsatRow(sat.name, amsat.satellites)} hours={amsat.hours} />
                      </div>
                    );
                  })
                )}
              </PanelSection>

              {/* LIVE */}
              <PanelSection title={relaySat ? `Live · ${relaySat.name}` : 'Live'} color={SAT_ACCENT}>
                {!live ? (
                  <EmptyState text={relaySat ? 'Waiting for orbital elements' : 'Select a satellite above'} />
                ) : (
                  <div style={{ padding: '4px 8px', fontSize: '11px' }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', marginBottom: '6px' }}
                    >
                      <span>
                        {live.lat.toFixed(1)}°, {live.lon.toFixed(1)}°
                      </span>
                      <span>{Math.round(live.altKm)} km alt</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <SatCard label="DE" color={DE_COLOR} view={live.de} up={live.deUp} minElev={satMinElev} />
                      <SatCard
                        label={dxCallsign ? `DX · ${dxCallsign}` : 'DX'}
                        color={DX_COLOR}
                        view={live.dx}
                        up={live.dxUp}
                        minElev={satMinElev}
                      />
                    </div>
                    {relayTx && (
                      <div style={{ marginTop: '8px', background: '#0d1117', borderRadius: '4px', padding: '6px 8px' }}>
                        <div style={{ color: '#888', fontSize: '10px', marginBottom: '3px' }}>
                          {relayTx.mode}
                          {relayTx.invert ? ' · inverting' : ''} · Doppler-corrected at DE
                        </div>
                        <DopplerRow label="↑ TX" hz={doppler?.uplinkHz} shift={doppler?.uplinkShiftHz} />
                        <DopplerRow label="↓ RX" hz={doppler?.downlinkHz} shift={doppler?.downlinkShiftHz} />
                      </div>
                    )}
                  </div>
                )}
              </PanelSection>

              {/* MUTUAL PASSES */}
              <PanelSection title="Mutual Passes · 24h" count={relayPasses.length} color="#22c55e">
                {!relaySat ? (
                  <EmptyState text="Select a satellite" />
                ) : !live?.dx ? (
                  <EmptyState text="Set a DX target to see when you both see it" />
                ) : relayPasses.length === 0 ? (
                  <EmptyState text={`No pass with both ends ≥ ${satMinElev}° in the next 24 hours`} />
                ) : (
                  <div style={{ padding: '2px 4px' }}>
                    {relayPasses.map((p, i) => (
                      <PassRow key={i} p={p} />
                    ))}
                  </div>
                )}
              </PanelSection>

              {/* SAT SPOTS (cluster) */}
              <PanelSection title="Sat Spots · cluster" count={satSpots.length} color="#a855f7">
                {satSpots.length === 0 ? (
                  <EmptyState text="No satellite contacts in the cluster feed right now (spots like “via SO-50” on 2 m / 70 cm)" />
                ) : (
                  satSpots.map(({ spot, satName }, i) => (
                    <div
                      key={`${spot.call}-${spot.freq}-${spot.spotter}-${i}`}
                      onClick={() => {
                        if (satName) setRelaySat(satName);
                        handleSpotClick(spot);
                      }}
                      title={satName ? `Select ${satName} and set DX` : 'Set as DX target'}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        marginBottom: '2px',
                        borderLeft: `2px solid ${satName ? SAT_ACCENT : '#a855f7'}`,
                        background: '#0d1117',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#161b2a')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#0d1117')}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>
                          <b style={{ color: '#a855f7' }}>{spot.call}</b>
                          <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>{spot.freq} MHz</span>
                          {satName && (
                            <span style={{ color: SAT_ACCENT, marginLeft: '6px', fontSize: '10px' }}>{satName}</span>
                          )}
                        </span>
                        <span style={{ color: '#667', fontSize: '10px' }}>
                          {spot.time} · {spot.spotter}
                        </span>
                      </div>
                      {spot.comment && (
                        <div
                          style={{
                            color: '#aaa',
                            fontSize: '10px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {spot.comment}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </PanelSection>
            </>
          )}

          {/* MOON NOW */}
          {!satMode && (
            <PanelSection title="Moon Now" color={ACCENT}>
              {!snap ? (
                <EmptyState text="Set your station location in Settings" />
              ) : (
                <div style={{ padding: '4px 8px', fontSize: '11px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', marginBottom: '6px' }}>
                    <span>
                      {snap.moon.phaseEmoji} {phaseName(snap.moon.phase)}
                    </span>
                    <span>{Math.round(snap.moon.distanceKm).toLocaleString()} km</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', marginBottom: '8px' }}>
                    <span>
                      Dec{' '}
                      <b style={{ color: snap.moon.declination >= 0 ? '#22c55e' : '#f59e0b' }}>
                        {snap.moon.declination >= 0 ? '+' : ''}
                        {snap.moon.declination.toFixed(1)}°
                      </b>
                    </span>
                    <span>
                      Path{' '}
                      <b style={{ color: snap.moon.pathDeltaDb <= 0 ? '#22c55e' : '#f59e0b' }}>
                        {snap.moon.pathDeltaDb >= 0 ? '+' : ''}
                        {snap.moon.pathDeltaDb.toFixed(1)} dB
                      </b>
                      <span style={{ color: '#667' }}> vs mean</span>
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <StationCard label="DE" color={DE_COLOR} view={snap.de} grid={deGridStr} />
                    <StationCard
                      label={dxCallsign ? `DX · ${dxCallsign}` : 'DX'}
                      color={DX_COLOR}
                      view={snap.dx}
                      grid={dxGrid}
                    />
                  </div>
                </div>
              )}
            </PanelSection>
          )}

          {/* SKY TRACKS */}
          {!satMode && (
            <PanelSection title="Sky Tracks · next 24h" color={ACCENT}>
              {!snap ? (
                <EmptyState text="No station location" />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 8px' }}>
                  <MoonSkyChart
                    size={150}
                    ariaLabel="Moon sky tracks for DE and DX"
                    tracks={[
                      { points: tracks.de, color: DE_COLOR },
                      { points: tracks.dx, color: DX_COLOR, dash: '3,2' },
                    ]}
                    markers={[
                      { az: snap.de?.azimuth, el: snap.de?.elevation, color: DE_COLOR, label: 'DE' },
                      ...(snap.dx
                        ? [{ az: snap.dx.azimuth, el: snap.dx.elevation, color: DX_COLOR, label: 'DX' }]
                        : []),
                    ]}
                  />
                  <div style={{ fontSize: '10px', color: '#aaa', lineHeight: 1.7 }}>
                    <div>
                      <span style={{ color: DE_COLOR }}>━━</span> DE track
                    </div>
                    <div>
                      <span style={{ color: DX_COLOR }}>┄┄</span> DX track
                    </div>
                    <div style={{ color: '#667', marginTop: '4px' }}>
                      Centre = zenith
                      <br />
                      Edge = horizon
                      <br />
                      Hollow = below
                    </div>
                  </div>
                </div>
              )}
            </PanelSection>
          )}

          {/* MUTUAL WINDOWS */}
          {!satMode && (
            <PanelSection
              title="Mutual Windows · 48h"
              count={windows.length}
              color="#22c55e"
              extra={
                <select
                  value={minElev}
                  onChange={(e) => setMinElev(Number(e.target.value))}
                  title="Minimum elevation at both ends"
                  style={{
                    background: '#141826',
                    border: '1px solid #2a3040',
                    borderRadius: '3px',
                    color: '#aaa',
                    fontSize: '9px',
                    padding: '1px 4px',
                    marginLeft: '6px',
                  }}
                >
                  {[0, 5, 10, 15, 20, 30].map((v) => (
                    <option key={v} value={v}>
                      ≥ {v}°
                    </option>
                  ))}
                </select>
              }
            >
              {!snap?.dx ? (
                <EmptyState text="Set a DX target to see when you both see the moon" />
              ) : windows.length === 0 ? (
                <EmptyState text={`No shared moon above ${minElev}° in the next 48 hours`} />
              ) : (
                <div style={{ padding: '2px 4px' }}>
                  {nextWindow && !openWindow && (
                    <div style={{ fontSize: '10px', color: '#667', padding: '2px 4px 6px' }}>
                      Next window opens in {formatDurationShort(nextWindow.start - displayNowMs())}
                    </div>
                  )}
                  {windows.map((w, i) => (
                    <WindowRow key={i} w={w} />
                  ))}
                </div>
              )}
            </PanelSection>
          )}

          {/* EME PLANNER — 48 h elevation plot at both ends */}
          {!satMode && (
            <PanelSection title="EME Planner · 48h" color={ACCENT}>
              <EmePlannerPanel deLocation={de} dxLocation={dxLocation} dxCallsign={dxCallsign} embedded />
            </PanelSection>
          )}

          {/* DX TARGET */}
          <PanelSection title="DX Target" color={DX_COLOR}>
            <div style={{ padding: '4px 8px', fontSize: '11px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ color: '#888', fontSize: '10px', minWidth: '34px' }}>GRID</span>
                <DXGridInput
                  dxGrid={dxGrid || ''}
                  onDXChange={handleDXChange}
                  dxLocked={dxLocked}
                  style={{ color: DX_COLOR, fontWeight: 600, fontSize: '13px' }}
                />
                <button
                  onClick={handleToggleDxLock}
                  title={dxLocked ? 'Unlock DX target' : 'Lock DX target'}
                  style={{
                    background: 'none',
                    border: '1px solid #333',
                    borderRadius: '3px',
                    color: dxLocked ? '#f59e0b' : '#888',
                    fontSize: '11px',
                    padding: '1px 6px',
                    cursor: 'pointer',
                  }}
                >
                  {dxLocked ? '🔒' : '🔓'}
                </button>
              </div>
              <div style={{ color: '#667', fontSize: '10px' }}>
                {dxCallsign ? `${dxCallsign} · ` : ''}
                {Number.isFinite(dxLat)
                  ? `${dxLat.toFixed(2)}°, ${dxLon.toFixed(2)}°`
                  : 'Type a grid, click the globe, or pick a spot'}
              </div>
            </div>
          </PanelSection>

          {/* EME ACTIVITY (PSK Reporter) */}
          {!satMode && (
            <PanelSection
              title="EME Activity · PSK Reporter"
              count={emeActivity.spots.length}
              color="#38bdf8"
              extra={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginLeft: '6px' }}>
                  <span style={{ color: '#667', fontSize: '9px' }}>
                    Q65 / JT65 · 50 MHz+ · 2h
                    {emeActivity.connected === false ? ' · feed offline' : ''}
                  </span>
                  <label
                    title="Plot the reporting stations on the globe with their sender→Moon→receiver paths"
                    style={{ color: activityOnGlobe ? '#38bdf8' : '#667', fontSize: '9px', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={activityOnGlobe}
                      onChange={(e) => setActivityOnGlobe(e.target.checked)}
                      style={{ verticalAlign: 'middle', marginRight: '3px' }}
                    />
                    globe
                  </label>
                </span>
              }
            >
              {emeActivity.spots.length === 0 ? (
                <EmptyState
                  text={
                    emeActivity.connected === false
                      ? 'PSK Reporter feed not connected'
                      : 'No Q65 / JT65 reports above 50 MHz in the last two hours'
                  }
                />
              ) : (
                emeActivity.spots.slice(0, 60).map((r, i) => (
                  <div
                    key={`${r.sender}-${r.receiver}-${r.freq}-${r.timestamp}-${i}`}
                    onClick={() => handleEmeActivityClick(r)}
                    title="Set the sender as DX target"
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      marginBottom: '2px',
                      borderLeft: '2px solid #38bdf8',
                      background: '#0d1117',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#161b2a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#0d1117')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        <b style={{ color: '#38bdf8' }}>{r.sender}</b>
                        <span style={{ color: '#667', margin: '0 5px' }}>→</span>
                        <span style={{ color: '#ddd' }}>{r.receiver}</span>
                        <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>
                          {r.mode} · {r.freqMHz} MHz
                        </span>
                      </span>
                      <span style={{ color: '#667', fontSize: '10px' }}>
                        {Number.isFinite(r.snr) ? `${r.snr >= 0 ? '+' : ''}${r.snr} dB · ` : ''}
                        {fmtUtc(new Date(r.timestamp))}
                      </span>
                    </div>
                    <div style={{ color: '#667', fontSize: '10px' }}>
                      {r.senderGrid || '?'} → {r.receiverGrid || '?'}
                    </div>
                  </div>
                ))
              )}
            </PanelSection>
          )}

          {/* EME SPOTS (cluster) */}
          {!satMode && (
            <PanelSection title="EME Spots · cluster" count={emeSpots.length} color="#a855f7">
              {emeSpots.length === 0 ? (
                <EmptyState text="No cluster spots on EME bands mentioning EME / JT65 / Q65 right now" />
              ) : (
                emeSpots.map((spot, i) => (
                  <div
                    key={`${spot.call}-${spot.freq}-${spot.spotter}-${i}`}
                    onClick={() => handleSpotClick(spot)}
                    title="Set as DX target"
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      marginBottom: '2px',
                      borderLeft: '2px solid #a855f7',
                      background: '#0d1117',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#161b2a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#0d1117')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        <b style={{ color: '#a855f7' }}>{spot.call}</b>
                        <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>{spot.freq} MHz</span>
                      </span>
                      <span style={{ color: '#667', fontSize: '10px' }}>
                        {spot.time} · {spot.spotter}
                      </span>
                    </div>
                    {spot.comment && (
                      <div
                        style={{
                          color: '#aaa',
                          fontSize: '10px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {spot.comment}
                      </div>
                    )}
                  </div>
                ))
              )}
            </PanelSection>
          )}
        </div>
      </div>
    </div>
  );
}

/** Per-station satellite look-angle card. */
function SatCard({ label, color, view, up, minElev }) {
  return (
    <div style={{ background: '#0d1117', borderRadius: '4px', padding: '6px 8px', borderTop: `2px solid ${color}` }}>
      <div style={{ color, fontWeight: 700, fontSize: '10px', marginBottom: '4px' }}>{label}</div>
      {!view ? (
        <div style={{ color: '#667', fontSize: '10px' }}>no target</div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#888' }}>AZ</span>
            <b style={{ color: '#ddd' }}>{Math.round(view.azimuth)}°</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#888' }}>EL</span>
            <b style={{ color: up ? '#22c55e' : '#888' }} title={`workable at ≥ ${minElev}°`}>
              {up ? '▲' : '▼'} {view.elevation.toFixed(1)}°
            </b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#888' }}>Range</span>
            <span style={{ color: '#aaa' }}>{Math.round(view.rangeKm).toLocaleString()} km</span>
          </div>
        </>
      )}
    </div>
  );
}

/** AMSAT status board line for a relay candidate. */
function AmsatLine({ row, hours }) {
  if (!row) return null;
  const heard = row.status === 'Heard' || row.status === 'Crew Active';
  const ago = row.lastHeard ? formatDurationShort(Date.now() - Date.parse(row.lastHeard)) : null;
  return (
    <div style={{ color: '#667', fontSize: '10px' }}>
      AMSAT: <span style={{ color: heard ? '#22c55e' : '#888' }}>{row.status}</span>
      {ago && heard ? ` ${ago} ago` : ''}
      {row.total ? ` · ${row.total} reports${hours ? ` / ${hours}h` : ''}` : ''}
    </div>
  );
}

function DopplerRow({ label, hz, shift }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <b style={{ color: '#ddd' }}>{formatMHz(hz)} MHz</b>
      <span style={{ color: '#667', fontSize: '10px', minWidth: '58px', textAlign: 'right' }}>
        {Number.isFinite(shift) ? `${shift >= 0 ? '+' : ''}${Math.round(shift)} Hz` : ''}
      </span>
    </div>
  );
}

function PassRow({ p }) {
  const now = Date.now();
  const active = p.start.getTime() <= now && p.end.getTime() > now;
  return (
    <div
      style={{
        padding: '4px 8px',
        fontSize: '11px',
        marginBottom: '2px',
        borderLeft: `2px solid ${active ? '#22c55e' : '#2a3040'}`,
        background: active ? 'rgba(34,197,94,0.08)' : '#0d1117',
        borderRadius: '4px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: active ? '#22c55e' : '#ddd', fontWeight: 600 }}>
          {fmtDay(p.start)} {fmtUtc(p.start)} → {fmtUtc(p.end)}
          {p.truncated ? '+' : ''}
        </span>
        <span style={{ color: '#888' }}>{formatDurationShort(p.end - p.start)}</span>
      </div>
      <div style={{ color: '#667', fontSize: '10px' }}>
        {active ? `open · closes in ${formatDurationShort(p.end - now)} · ` : ''}
        peak common {p.peakCommonEl.toFixed(0)}° at {fmtUtc(p.peakAt)}
      </div>
      <div style={{ color: '#667', fontSize: '10px' }}>
        <span style={{ color: DE_COLOR }}>DE</span> {fmtUtc(p.de.aos)}–{fmtUtc(p.de.los)} ·{' '}
        <span style={{ color: DX_COLOR }}>DX</span> {fmtUtc(p.dx.aos)}–{fmtUtc(p.dx.los)}
      </div>
    </div>
  );
}

function phaseName(phase) {
  if (phase < 0.0625 || phase >= 0.9375) return 'New Moon';
  if (phase < 0.1875) return 'Waxing Crescent';
  if (phase < 0.3125) return 'First Quarter';
  if (phase < 0.4375) return 'Waxing Gibbous';
  if (phase < 0.5625) return 'Full Moon';
  if (phase < 0.6875) return 'Waning Gibbous';
  if (phase < 0.8125) return 'Last Quarter';
  return 'Waning Crescent';
}

/** Per-station az/el card. `view` null → no position yet. */
function StationCard({ label, color, view, grid }) {
  return (
    <div style={{ background: '#0d1117', borderRadius: '4px', padding: '6px 8px', borderTop: `2px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ color, fontWeight: 700, fontSize: '10px' }}>{label}</span>
        <span style={{ color: '#667', fontSize: '10px' }}>{grid || ''}</span>
      </div>
      {!view ? (
        <div style={{ color: '#667', fontSize: '10px' }}>no target</div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#888' }}>AZ</span>
            <b style={{ color: '#ddd' }}>{Math.round(view.azimuth)}°</b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#888' }}>EL</span>
            <b style={{ color: view.up ? '#22c55e' : '#888' }}>
              {view.up ? '▲' : '▼'} {Math.abs(view.elevation).toFixed(1)}°
            </b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#888' }}>{view.up ? 'Set' : 'Rise'}</span>
            <span style={{ color: '#aaa' }}>{fmtUtc(view.up ? view.set : view.rise)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function WindowRow({ w }) {
  const now = displayNowMs();
  const active = w.start.getTime() <= now && w.end.getTime() > now;
  return (
    <div
      style={{
        padding: '4px 8px',
        fontSize: '11px',
        marginBottom: '2px',
        borderLeft: `2px solid ${active ? '#22c55e' : '#2a3040'}`,
        background: active ? 'rgba(34,197,94,0.08)' : '#0d1117',
        borderRadius: '4px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: active ? '#22c55e' : '#ddd', fontWeight: 600 }}>
          {fmtDay(w.start)} {fmtUtc(w.start)} → {fmtUtc(w.end)}
          {w.truncated ? '+' : ''}
        </span>
        <span style={{ color: '#888' }}>{formatDurationShort(w.end - w.start)}</span>
      </div>
      <div style={{ color: '#667', fontSize: '10px' }}>
        {active ? `open · closes in ${formatDurationShort(w.end - now)}` : w.open ? 'in progress' : ''}
        {active ? ' · ' : ''}peak common elevation {w.peakMinEl.toFixed(0)}° at {fmtUtc(w.peakAt)}
      </div>
    </div>
  );
}

/** Collapsible panel section wrapper (EmComm sibling) */
function PanelSection({ title, count, color, extra, children }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ background: '#080a10', borderRadius: '6px', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid #1c2130',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#888', fontSize: '10px' }}>{collapsed ? '▶' : '▼'}</span>
          <span
            style={{
              color: color || '#ccc',
              fontWeight: 600,
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {title}
          </span>
          {extra && <span onClick={(e) => e.stopPropagation()}>{extra}</span>}
        </div>
        {count > 0 && (
          <span
            style={{
              background: color || '#888',
              color: '#000',
              fontSize: '10px',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '8px',
              minWidth: '18px',
              textAlign: 'center',
            }}
          >
            {count}
          </span>
        )}
      </div>
      {!collapsed && <div style={{ padding: '4px 2px', maxHeight: '320px', overflowY: 'auto' }}>{children}</div>}
    </div>
  );
}

function EmptyState({ text }) {
  return <div style={{ padding: '12px 8px', color: '#556', fontSize: '11px', textAlign: 'center' }}>{text}</div>;
}

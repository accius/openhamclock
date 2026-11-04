import React, { useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { displayBearing, useBearingMode } from '../utils/bearing.js';
import useRotator from '../hooks/useRotator';
import { useSatAutomation, setRotatorMode, setLongPath, setAutomationSat } from '../utils/satAutomationStore.js';

/**
 * Rotator Panel V1
 * - Compass rose + needle
 * - Digital bearing readout
 * - Source + LIVE/STALE indicator
 * - Mock-friendly via useRotator()
 */
export default function RotatorPanel({
  // Optional props for later when we wire PstRotatorAz
  endpointUrl,
  pollMs,
  staleMs,
  overlayEnabled,
  onToggleOverlay,
  state,
  onTurnAzimuth,
  onStop,
  controlsEnabled = true,
  // Auto-track: names of satellites with orbital elements, for the SAT target picker
  satOptions = [],
  // Station location — lets the digital readout show a magnetic bearing
  // (Settings → Station → Bearings) via the WMM2025 declination at DE.
  deLat = null,
  deLon = null,
}) {
  const bearingMode = useBearingMode();
  // Hooks must run on every render in the same order, so useRotator is always
  // called. When the parent owns the rotator state we pass no endpointUrl, which
  // keeps the hook idle (no polling) and we read from `state` instead.
  const ownState = useRotator({ endpointUrl: state ? undefined : endpointUrl, pollMs, staleMs });
  const { azimuth, lastGoodAzimuth, isStale, status = 'disconnected', lastError = null, reconnect } = state ?? ownState;

  const displayAngleRef = useRef(null); // continuous angle
  const prevAzRef = useRef(null);

  const displayAngle = useMemo(() => {
    const az = lastGoodAzimuth ?? azimuth;
    if (az == null) return null;

    if (prevAzRef.current == null) {
      prevAzRef.current = az;
      displayAngleRef.current = az;
      return az;
    }

    const prevAz = prevAzRef.current;

    // shortest signed delta in [-180, 180]
    const delta = ((az - prevAz + 540) % 360) - 180;

    prevAzRef.current = az;
    displayAngleRef.current = (displayAngleRef.current ?? az) + delta;

    return displayAngleRef.current;
  }, [lastGoodAzimuth, azimuth]);

  const bearingText = useMemo(() => {
    if (status !== 'connected') return '---';
    if (azimuth == null || Number.isNaN(azimuth)) return '--';
    // Rotators report true azimuth; in magnetic mode show it corrected by
    // the local declination (suffix M on the degree sign below).
    const shown = displayBearing(azimuth, deLat, deLon, bearingMode);
    const a = shown ? shown.deg : ((Math.round(azimuth) % 360) + 360) % 360;
    return String(a).padStart(3, '0');
  }, [azimuth, status, deLat, deLon, bearingMode]);
  const magneticReadout = bearingMode === 'magnetic' && Number.isFinite(deLat) && Number.isFinite(deLon);

  const [showCompass, setShowCompass] = React.useState(() => {
    try {
      const v = localStorage.getItem('ohc_rotator_showCompass');
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });

  const toggleCompass = () => {
    setShowCompass((v) => {
      const next = !v;
      try {
        localStorage.setItem('ohc_rotator_showCompass', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  return (
    <div className="ohc-rotator-panel">
      <div className="ohc-rotator-header">
        <div className="ohc-rotator-meta">
          <div
            className="ohc-rotator-conn"
            title={
              status === 'connected'
                ? 'Rotator connected'
                : status === 'connecting'
                  ? 'Rotator connecting…'
                  : lastError
                    ? `Rotator disconnected: ${lastError}`
                    : 'Rotator disconnected'
            }
            aria-label="Rotator connection status"
          >
            <span className={`ohc-led ohc-led--${status}`} />

            {status !== 'connected' && (
              <button
                onClick={() => reconnect?.()}
                disabled={typeof reconnect !== 'function'}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  cursor: typeof reconnect === 'function' ? 'pointer' : 'not-allowed',
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: 'rgba(255,255,255,0.75)',
                }}
                title="Reconnect to rotator"
              >
                RECONNECT
              </button>
            )}
          </div>
          <button
            onClick={toggleCompass}
            style={{
              marginLeft: 10,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              background: showCompass ? 'rgba(0,255,255,0.15)' : 'rgba(0,0,0,0.35)',
              border: `1px solid ${showCompass ? '#00ffff' : 'rgba(255,255,255,0.18)'}`,
              color: showCompass ? '#00ffff' : 'rgba(255,255,255,0.65)',
            }}
            title={showCompass ? 'Hide compass' : 'Show compass'}
          >
            COMPASS {showCompass ? 'ON' : 'OFF'}
          </button>

          {typeof onToggleOverlay === 'function' && (
            <button
              onClick={onToggleOverlay}
              style={{
                marginLeft: 10,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                background: overlayEnabled ? 'rgba(0,255,255,0.15)' : 'rgba(0,0,0,0.35)',
                border: `1px solid ${overlayEnabled ? '#00ffff' : 'rgba(255,255,255,0.18)'}`,
                color: overlayEnabled ? '#00ffff' : 'rgba(255,255,255,0.65)',
              }}
              title={overlayEnabled ? 'Hide rotator bearing on map' : 'Show rotator bearing on map'}
            >
              MAP {overlayEnabled ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
      </div>

      {typeof onTurnAzimuth === 'function' && (
        <AutoTrackControls satOptions={satOptions} disabled={!controlsEnabled} elevation={state?.elevation} />
      )}

      {typeof onTurnAzimuth === 'function' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
          }}
        >
          {/* Row 1: Nudge + Stop */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              disabled={!controlsEnabled}
              onClick={() => onTurnAzimuth((((Number(azimuth ?? lastGoodAzimuth ?? 0) - 10) % 360) + 360) % 360)}
              style={btnStyle(!controlsEnabled)}
            >
              -10
            </button>

            <button
              disabled={!controlsEnabled}
              onClick={() => onTurnAzimuth((((Number(azimuth ?? lastGoodAzimuth ?? 0) - 5) % 360) + 360) % 360)}
              style={btnStyle(!controlsEnabled)}
            >
              -5
            </button>

            <button
              disabled={!controlsEnabled || typeof onStop !== 'function'}
              onClick={() => {
                // STOP always leaves Auto — a halted rotator must stay halted.
                setRotatorMode('off');
                onStop?.();
              }}
              style={btnStyle(!controlsEnabled)}
              aria-label="Stop rotator and leave auto-track"
            >
              STOP
            </button>

            <button
              disabled={!controlsEnabled}
              onClick={() => onTurnAzimuth((((Number(azimuth ?? lastGoodAzimuth ?? 0) + 5) % 360) + 360) % 360)}
              style={btnStyle(!controlsEnabled)}
            >
              +5
            </button>

            <button
              disabled={!controlsEnabled}
              onClick={() => onTurnAzimuth((((Number(azimuth ?? lastGoodAzimuth ?? 0) + 10) % 360) + 360) % 360)}
              style={btnStyle(!controlsEnabled)}
            >
              +10
            </button>
          </div>

          {/* Row 2: AZ input centered */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <AzGoto disabled={!controlsEnabled} onGo={(v) => onTurnAzimuth(v)} />
          </div>

          {/* Row 3: Tip centered */}
          <div
            style={{
              fontSize: 11,
              opacity: 0.65,
              textAlign: 'center',
            }}
          >
            Tip: <b>Shift-click</b> the map to turn
          </div>
        </div>
      )}
      <div className="ohc-rotator-body">
        {showCompass && (
          <Compass
            azimuth={azimuth ?? lastGoodAzimuth}
            displayAngle={displayAngle}
            isStale={isStale || status !== 'connected'}
          />
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: showCompass ? 16 : 10,
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              width: 'fit-content',
              alignItems: 'baseline',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 16px',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.10)',
              background: 'rgba(255,255,255,0.03)',
              minWidth: 160,
            }}
          >
            <span
              style={{
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: 1,
                lineHeight: 1,
                color: 'rgba(255,255,255,0.85)',
              }}
            >
              {bearingText}
            </span>
            <span
              style={{
                fontSize: 20,
                opacity: 0.65,
                fontWeight: 700,
                position: 'relative',
                top: -4, // optional: nudges ° up
              }}
              title={magneticReadout ? 'Magnetic bearing (WMM2025)' : 'True bearing'}
            >
              °{magneticReadout ? 'M' : ''}
            </span>
          </div>
        </div>
      </div>

      <style>{css}</style>
    </div>
  );
}

function Compass({ azimuth, displayAngle, isStale }) {
  const safeAngle = azimuth == null ? null : azimuth;
  return (
    <div className={'ohc-compass ' + (isStale ? 'ohc-compass--stale' : '')}>
      <svg viewBox="0 0 200 200" className="ohc-compass-svg" aria-label="Compass">
        {/* Outer ring */}
        <circle cx="100" cy="100" r="92" className="ohc-compass-ring" />
        <circle cx="100" cy="100" r="80" className="ohc-compass-inner" />

        {/* Tick marks */}
        <g className="ohc-compass-ticks">
          {Array.from({ length: 60 }).map((_, i) => {
            const deg = i * 6;
            const isMajor = deg % 30 === 0;
            const r1 = isMajor ? 74 : 76;
            const r2 = 80;
            return (
              <line
                key={i}
                x1="100"
                y1={100 - r1}
                x2="100"
                y2={100 - r2}
                transform={`rotate(${deg} 100 100)`}
                className={isMajor ? 'ohc-tick ohc-tick--major' : 'ohc-tick'}
              />
            );
          })}
        </g>

        {/* Cardinal labels */}
        <g className="ohc-compass-labels">
          <text x="100" y="34" textAnchor="middle" className="ohc-cardinal">
            N
          </text>
          <text x="166" y="106" textAnchor="middle" className="ohc-cardinal">
            E
          </text>
          <text x="100" y="182" textAnchor="middle" className="ohc-cardinal">
            S
          </text>
          <text x="34" y="106" textAnchor="middle" className="ohc-cardinal">
            W
          </text>
        </g>

        {/* Needle group (rotated) */}
        <g
          className="ohc-needle-wrap"
          style={{
            transform: displayAngle == null ? 'none' : `rotate(${displayAngle}deg)`,
            transition: 'transform 250ms linear',
            opacity: safeAngle == null ? 0.25 : 1,
          }}
        >
          {/* Needle body */}
          <path d="M100 40 L106 100 L100 160 L94 100 Z" className="ohc-needle" />
          {/* Red direction tip */}
          <path d="M100 34 L106 54 L94 54 Z" className="ohc-needle-tip-red" />
          {/* Needle tip highlight */}
          <path d="M100 40 L104 98 L100 100 Z" className="ohc-needle-tip" />
        </g>

        {/* Center cap */}
        <circle cx="100" cy="100" r="6.5" className="ohc-center" />
        <circle cx="100" cy="100" r="2.5" className="ohc-center-dot" />
      </svg>
    </div>
  );
}
function btnStyle(disabled) {
  return {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.18)',
    color: disabled ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.75)',
  };
}

/**
 * Auto-track row: OFF / DX / SAT, long-path toggle for DX, satellite picker
 * for SAT, and the commanded target. The planning and sending happen in
 * useRotatorAutoTrack (DockableApp); this just flips the store.
 */
function AutoTrackControls({ satOptions, disabled, elevation }) {
  const { t } = useTranslation();
  const auto = useSatAutomation();
  const mode = auto.rotatorMode;
  const target = auto.rotatorTarget;
  const pill = (active, color = '#00ffff') => ({
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'rgba(0,0,0,0.35)',
    border: `1px solid ${active ? color : 'rgba(255,255,255,0.18)'}`,
    color: active ? color : 'rgba(255,255,255,0.65)',
    fontWeight: active ? 700 : 400,
  });
  const trueAz = target && Number.isFinite(target.az) ? (target.flip ? (target.az + 180) % 360 : target.az) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <div
        role="group"
        aria-label={t('satAuto.autoGroupAria')}
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}
      >
        <span style={{ fontSize: 11, opacity: 0.7, alignSelf: 'center', fontFamily: 'var(--font-mono)' }}>AUTO</span>
        <button
          disabled={disabled}
          aria-pressed={mode === 'off'}
          onClick={() => setRotatorMode('off')}
          style={pill(mode === 'off', 'rgba(255,255,255,0.85)')}
        >
          OFF
        </button>
        <button
          disabled={disabled}
          aria-pressed={mode === 'dx'}
          onClick={() => setRotatorMode('dx')}
          style={pill(mode === 'dx')}
          title={t('satAuto.autoDxTitle')}
        >
          DX
        </button>
        <button
          disabled={disabled || satOptions.length === 0}
          aria-pressed={mode === 'sat'}
          onClick={() => setRotatorMode('sat', auto.satName || satOptions[0])}
          style={pill(mode === 'sat', '#ffbf00')}
          title={satOptions.length === 0 ? t('satAuto.noTrackedSats') : t('satAuto.autoSatTitle')}
        >
          SAT
        </button>
        {mode === 'dx' && (
          <button
            disabled={disabled}
            aria-pressed={auto.longPath}
            onClick={() => setLongPath(!auto.longPath)}
            style={pill(auto.longPath, '#b388ff')}
            title={t('satAuto.longPathTitle')}
          >
            {auto.longPath ? 'LP' : 'SP'}
          </button>
        )}
        {mode === 'sat' && (
          <select
            value={auto.satName || ''}
            onChange={(e) => setAutomationSat(e.target.value || null)}
            aria-label={t('satAuto.pickSatellite')}
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              background: 'rgba(0,0,0,0.35)',
              color: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 8,
              padding: '3px 6px',
              maxWidth: 140,
            }}
          >
            {!auto.satName && <option value="">{t('satAuto.pickSatellite')}</option>}
            {satOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      {mode !== 'off' && (
        <div
          style={{ fontSize: 11, opacity: 0.8, fontFamily: 'var(--font-mono)', textAlign: 'center' }}
          aria-live="polite"
        >
          {trueAz != null ? (
            <>
              → <b>{String(Math.round(trueAz)).padStart(3, '0')}°</b>
              {target.el != null && (target.phase === 'tracking' || target.flip) ? ` / ${Math.round(target.el)}°` : ''}
              {target.flip ? ` · ${t('satAuto.flip')}` : ''}
              {' · '}
              {target.phase === 'preposition'
                ? t('satAuto.phasePreposition')
                : target.phase === 'tracking'
                  ? t('satAuto.phaseTracking')
                  : t('satAuto.phaseIdle')}
              {!target.rotatorAvailable ? ` · ${t('satAuto.rotatorOffline')}` : ''}
            </>
          ) : mode === 'sat' ? (
            target?.nextAos ? (
              t('satAuto.waitingForPass', {
                time: new Date(target.nextAos).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              })
            ) : (
              t('satAuto.phaseIdle')
            )
          ) : (
            t('satAuto.noDx')
          )}
          {Number.isFinite(elevation) ? ` · EL ${Math.round(elevation)}°` : ''}
        </div>
      )}
    </div>
  );
}

function AzGoto({ disabled, onGo }) {
  const [val, setVal] = React.useState('');

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        disabled={disabled}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="AZ"
        style={{
          width: 56,
          padding: '4px 8px',
          borderRadius: 8,
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          background: 'rgba(0,0,0,0.35)',
          border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(255,255,255,0.85)',
          outline: 'none',
        }}
      />
      <button
        disabled={disabled}
        onClick={() => {
          const n = Number(val);
          if (!Number.isFinite(n)) return;
          const az = ((Math.round(n) % 360) + 360) % 360;
          onGo?.(az);
        }}
        style={btnStyle(disabled)}
      >
        GO
      </button>
    </div>
  );
}
const css = `
.ohc-rotator-conn{
  display:flex;
  align-items:center;
  gap:10px;
}

.ohc-led{
  width:10px;
  height:10px;
  border-radius:999px;
  display:inline-block;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.12) inset;
}

.ohc-led--connected{
  background: rgba(0, 255, 140, 0.85);
  box-shadow:
    0 0 0 1px rgba(0, 255, 140, 0.35) inset,
    0 0 10px rgba(0, 255, 140, 0.22);
}

.ohc-led--disconnected{
  background: rgba(255, 70, 70, 0.75);
  box-shadow:
    0 0 0 1px rgba(255, 70, 70, 0.28) inset,
    0 0 10px rgba(255, 70, 70, 0.10);
}

.ohc-led--connecting{
  background: rgba(255, 205, 60, 0.85);
  box-shadow:
    0 0 0 1px rgba(255, 205, 60, 0.30) inset,
    0 0 10px rgba(255, 205, 60, 0.12);
  animation: ohcPulse 900ms ease-in-out infinite;
}

@keyframes ohcPulse{
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.25); opacity: 1; }
}
  
.ohc-rotator-panel{
  height:100%;
  width:100%;
  display:flex;
  flex-direction:column;
  padding:12px;
  box-sizing:border-box;
  gap:10px;
}

.ohc-rotator-header{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:10px;
  flex-wrap:wrap;
}

.ohc-rotator-meta{
  display:flex;
  align-items:center;
  gap:10px;
  font-size:12px;
  opacity:0.9;
  flex-wrap:wrap;
  justify-content:center;
  max-width:100%;
}

.ohc-rotator-source{
  opacity:0.75;
}

.ohc-rotator-status{
  padding:3px 8px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,0.12);
  font-weight:600;
  letter-spacing:0.5px;
}

.ohc-rotator-status--live{
  box-shadow: 0 0 0 1px rgba(0,255,255,0.16) inset;
}

.ohc-rotator-status--stale{
  opacity:0.75;
  filter:saturate(0.7);
}

.ohc-rotator-body{
  display:flex;
  flex-direction:column;
  align-items:center;
}

.ohc-compass{
  display:flex;
  align-items:center;
  justify-content:center;
  min-height:0;
}

.ohc-compass-svg{
  width: clamp(170px, 70%, 360px);
  height:auto;
  max-height:100%;
}

.ohc-compass-ring{
  fill: rgba(255,255,255,0.02);
  stroke: rgba(255,255,255,0.12);
  stroke-width:2;
}

.ohc-compass-inner{
  fill: rgba(0,0,0,0.12);
  stroke: rgba(255,255,255,0.08);
  stroke-width:1.5;
}

.ohc-tick{
  stroke: rgba(255,255,255,0.18);
  stroke-width:1;
}

.ohc-tick--major{
  stroke: rgba(255,255,255,0.28);
  stroke-width:1.6;
}

.ohc-cardinal{
  fill: rgba(255,255,255,0.85);
  font-size:14px;
  font-weight:700;
}

.ohc-needle-wrap{
  transform-origin: 100px 100px;
  transition: transform 240ms ease-out;
  filter: drop-shadow(0px 0px 4px rgba(0,255,255,0.22));
}

.ohc-needle{
  fill: rgba(0,255,255,0.35);
  stroke: rgba(0,255,255,0.65);
  stroke-width:1;
}

.ohc-needle-tip{
  fill: rgba(255,255,255,0.18);
}

.ohc-needle-tip-red{
  fill: rgba(255, 60, 60, 0.85);
  filter: drop-shadow(0px 0px 3px rgba(255, 60, 60, 0.35));
}

.ohc-center{
  fill: rgba(255,255,255,0.10);
  stroke: rgba(0,255,255,0.35);
  stroke-width:1;
}

.ohc-center-dot{
  fill: rgba(0,255,255,0.65);
}

.ohc-compass--stale .ohc-needle-wrap{
  opacity:0.6;
  filter: drop-shadow(0px 0px 2px rgba(0,255,255,0.10));
}

.ohc-rotator-readoutBox{
  display:inline-flex;
  align-items:baseline;
  justify-content:center;
  gap:6px;
  padding:10px 16px;
  border-radius:12px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.03);
  min-width:160px;
  width:fit-content;
}

.ohc-rotator-bearing{
  display:flex;
  align-items:baseline;
  gap:4px;
}

.ohc-rotator-bearing-value{
  font-size:42px;
  font-weight:800;
  letter-spacing:1px;
  line-height:1;
  text-shadow: 0 0 10px rgba(0,255,255,0.10);
}

.ohc-rotator-bearing-deg{
  font-size:18px;
  opacity:0.9;
  position: relative;
  top: -6px;  /* tweak: -4 to -8 depending on your bearing font size */
}

.ohc-rotator-sub{
  font-size:12px;
  opacity:0.75;
  margin-left:auto;
  white-space:nowrap;
}
`;

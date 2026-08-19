/**
 * SatelliteInfoPanel
 * Telemetry window for the selected satellites in the 3D globe.
 *
 * The Leaflet satellite layer builds the equivalent window as an HTML string
 * against a Leaflet container, which the globe has no counterpart for. Both
 * read the same fields and share deriveSatelliteTelemetry, so the figures and
 * the i18n keys stay in step even though the markup differs.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { deriveSatelliteTelemetry } from '../utils/satelliteTelemetry.js';

const rowStyle = (bg, fg) => ({
  background: bg,
  color: fg,
});

const PANEL_TOP = 50;
const PANEL_RIGHT = 10;

const cellLeft = { padding: '0 2px' };
const cellRight = { padding: '0 2px', textAlign: 'right' };

function Row({ label, value, bg, fg }) {
  return (
    <tr style={rowStyle(bg, fg)}>
      <td style={cellLeft}>{label}:</td>
      <td style={cellRight}>{value}</td>
    </tr>
  );
}

export default function SatelliteInfoPanel({ satellites, selected, allUnits, onDeselect, onClearAll }) {
  const { t } = useTranslation();
  const [minimized, setMinimized] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  const active = (satellites || []).filter((s) => selected.includes(s.name));

  // Drag by the title bar, matching the Leaflet window's affordance.
  const onPointerDown = useCallback(
    (ev) => {
      ev.preventDefault();
      dragRef.current = { startX: ev.clientX, startY: ev.clientY, baseX: offset.x, baseY: offset.y };
    },
    [offset],
  );

  useEffect(() => {
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      setOffset({ x: d.baseX + (ev.clientX - d.startX), y: d.baseY + (ev.clientY - d.startY) });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  if (!active.length) return null;

  const openPredict = (name, omm) => {
    // Provided globally by the satellite plugin; absent if that layer never mounted.
    if (name && omm && window.openSatellitePredict) window.openSatellitePredict(name, omm);
  };

  return (
    <div
      style={{
        position: 'absolute',
        // Same default as the Leaflet window (top: 50, right: 10), which sits
        // clear of the projection toggle and style dropdown above it.
        top: `${PANEL_TOP + offset.y}px`,
        right: `${PANEL_RIGHT - offset.x}px`,
        zIndex: 1200,
        width: '260px',
        maxHeight: 'calc(100% - 80px)',
        overflowY: 'auto',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        fontFamily: 'var(--font-mono)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
      }}
    >
      <div
        onPointerDown={onPointerDown}
        title={t('station.settings.satellites.dragTitle', 'Drag title to move')}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-color)',
          cursor: 'move',
          color: 'var(--accent-cyan)',
          fontSize: '12px',
          fontWeight: 'bold',
          userSelect: 'none',
        }}
      >
        <span>
          🛰 {active.length}{' '}
          {active.length !== 1 ? t('station.settings.satellites.name_plural') : t('station.settings.satellites.name')}
        </span>
        <button
          onClick={() => setMinimized((v) => !v)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '0 4px',
          }}
        >
          {minimized ? '▲' : '▼'}
        </button>
      </div>

      {!minimized && (
        <div>
          <button
            onClick={onClearAll}
            style={{
              display: 'block',
              width: 'calc(100% - 20px)',
              margin: '8px 10px 4px',
              padding: '3px 0',
              background: 'var(--bg-primary)',
              border: '1px solid var(--accent-red)',
              borderRadius: '3px',
              color: 'var(--accent-red)',
              fontSize: '10px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            {t('station.settings.satellites.clearFootprints')}
          </button>

          <div style={{ padding: '0 12px 8px' }}>
            {active.map((sat) => {
              const d = deriveSatelliteTelemetry(sat, allUnits);
              const lit = d.isVisible;
              const posBg = 'var(--bg-tertiary)';
              const posFg = 'var(--text-secondary)';
              const relBg = lit ? 'var(--accent-green)' : 'var(--bg-primary)';
              const relFg = lit ? '#000' : 'var(--text-secondary)';
              const metaBg = 'var(--bg-secondary)';
              const metaFg = 'var(--text-muted)';

              return (
                <div
                  key={sat.name}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    marginBottom: '10px',
                    paddingBottom: '8px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '4px',
                    }}
                  >
                    <strong style={{ color: 'var(--text-primary)', fontSize: '14px' }}>{d.name}</strong>
                    <button
                      onClick={() => onDeselect(sat.name)}
                      title={d.name}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-red)',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '20px',
                        padding: '0 5px',
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                    <tbody>
                      <Row
                        label={t('station.settings.satellites.latitude')}
                        value={`${d.lat}°`}
                        bg={posBg}
                        fg={posFg}
                      />
                      <Row
                        label={t('station.settings.satellites.longitude')}
                        value={`${d.lon}°`}
                        bg={posBg}
                        fg={posFg}
                      />
                      <Row label={t('station.settings.satellites.altitude')} value={d.altitude} bg={posBg} fg={posFg} />
                      <Row label={t('station.settings.satellites.speed')} value={d.speed} bg={posBg} fg={posFg} />

                      <Row
                        label={t('station.settings.satellites.azimuth_elevation')}
                        value={d.azEl}
                        bg={relBg}
                        fg={relFg}
                      />
                      {lit && (
                        <>
                          <Row label={t('station.settings.satellites.range')} value={d.range} bg={relBg} fg={relFg} />
                          <Row
                            label={t('station.settings.satellites.rangeRate')}
                            value={d.rangeRate}
                            bg={relBg}
                            fg={relFg}
                          />
                          <Row
                            label={t('station.settings.satellites.dopplerFactor')}
                            value={d.dopplerFactor}
                            bg={relBg}
                            fg={relFg}
                          />
                        </>
                      )}
                      <Row
                        label={t('station.settings.satellites.status')}
                        value={t(`station.settings.satellites.${d.status}`)}
                        bg={relBg}
                        fg={relFg}
                      />
                      {!lit && d.nextPass && (
                        <Row
                          label={t('station.settings.satellites.nextPass')}
                          value={d.nextPass}
                          bg="var(--bg-primary)"
                          fg="var(--text-secondary)"
                        />
                      )}
                      {lit && d.endingIn && <Row label="Ending" value={d.endingIn} bg={relBg} fg={relFg} />}

                      <Row label={t('station.settings.satellites.mode')} value={d.mode} bg={metaBg} fg={metaFg} />
                      {d.downlink && (
                        <Row
                          label={t('station.settings.satellites.downlink')}
                          value={d.downlink}
                          bg={metaBg}
                          fg={metaFg}
                        />
                      )}
                      {d.uplink && (
                        <Row label={t('station.settings.satellites.uplink')} value={d.uplink} bg={metaBg} fg={metaFg} />
                      )}
                      {d.tone && (
                        <Row label={t('station.settings.satellites.tone')} value={d.tone} bg={metaBg} fg={metaFg} />
                      )}

                      <tr>
                        <td colSpan={2}>
                          <button
                            onClick={() => openPredict(d.name, d.omm)}
                            style={{
                              width: '100%',
                              padding: '2px 0',
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--accent-red)',
                              borderRadius: '3px',
                              color: 'var(--accent-red)',
                              fontSize: '10px',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                            }}
                          >
                            {t('station.settings.satellites.predict')}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {d.notes && (
                    <div
                      style={{
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        marginTop: '4px',
                        fontStyle: 'italic',
                      }}
                    >
                      {d.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

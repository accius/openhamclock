/**
 * VoacapGlobeControl — the VOACAP Propagation Map's settings panel on the 3D
 * globe. The flat map has its own (Leaflet) panel in useVOACAPHeatmap.js; the
 * globe has no Leaflet, so WorldMap mounts this React overlay instead when the
 * projection is 3D and the layer is on.
 *
 * Both panels read and write the same settings (utils/voacapHeatmap.js), so a
 * band picked here is still selected after switching back to Flat. Globe3D
 * refetches on every change and reports the response's mode / power / solar
 * figures for the status line.
 */
import { useEffect, useRef, useState } from 'react';
import { makeDraggable } from '../plugins/layers/makeDraggable.js';
import { addMinimizeToggle } from '../plugins/layers/addMinimizeToggle.js';
import {
  BANDS,
  GRID_SIZES,
  MODES,
  POWERS,
  VOACAP_DATA_EVENT,
  getVoacapSettings,
  setVoacapSettings,
  subscribeVoacapSettings,
} from '../utils/voacapHeatmap.js';

const STORAGE_KEY = 'voacap-globe-position';

const selectStyle = {
  width: '100%',
  marginTop: '2px',
  padding: '4px',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
};
const labelStyle = { color: 'var(--text-secondary)', fontSize: '10px' };
const swatch = (background) => ({
  display: 'inline-block',
  width: '12px',
  height: '12px',
  background,
  borderRadius: '2px',
});

export function VoacapGlobeControl({ onClose }) {
  const [settings, setSettings] = useState(getVoacapSettings);
  const [status, setStatus] = useState(null);
  const elRef = useRef(null);

  useEffect(() => subscribeVoacapSettings(setSettings), []);
  useEffect(() => {
    const onData = (e) => setStatus(e.detail || null);
    window.addEventListener(VOACAP_DATA_EVENT, onData);
    return () => window.removeEventListener(VOACAP_DATA_EVENT, onData);
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    // Keep drags/scrolls on the panel from reaching the globe underneath.
    const stop = (e) => e.stopPropagation();
    const events = ['pointerdown', 'mousedown', 'wheel', 'dblclick', 'touchstart'];
    for (const evt of events) el.addEventListener(evt, stop);
    makeDraggable(el, STORAGE_KEY, { snap: 5 });
    addMinimizeToggle(el, STORAGE_KEY, {
      contentClassName: 'voacap-globe-panel-content',
      buttonClassName: 'voacap-globe-minimize-btn',
    });
    return () => {
      for (const evt of events) el.removeEventListener(evt, stop);
    };
  }, []);

  const set = (partial) => setSettings(setVoacapSettings(partial));

  return (
    <div
      className="panel-wrapper"
      // Top left, clear of the globe's own DE / DX / rotate / zoom column
      // (10–40 px from the left edge); Time Shift owns the top right.
      style={{ position: 'absolute', top: '10px', left: '50px', zIndex: 1000, pointerEvents: 'none' }}
    >
      <div
        ref={elRef}
        className="voacap-globe-control"
        role="group"
        aria-label="VOACAP Heatmap"
        style={{ pointerEvents: 'auto', minWidth: '200px' }}
      >
        <div
          className="floating-panel-header"
          data-drag-handle="true"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}
        >
          <span>🌐 VOACAP Heatmap</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Hide VOACAP heatmap"
                title="Hide VOACAP heatmap"
                style={{ fontSize: '1em' }}
              >
                ×
              </button>
            )}
            <button type="button" className="voacap-globe-minimize-btn" aria-label="Minimize panel">
              ▶
            </button>
          </span>
        </div>
        <div className="voacap-globe-panel-content" style={{ padding: '0 10px 10px' }}>
          <div style={{ marginBottom: '6px' }}>
            <label style={labelStyle}>
              Band
              <select
                value={settings.bandIndex}
                onChange={(e) => set({ bandIndex: parseInt(e.target.value) })}
                style={selectStyle}
              >
                {BANDS.map((b, i) => (
                  <option key={b.label} value={i}>
                    {b.label} ({b.freq} MHz)
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
            <label style={{ ...labelStyle, flex: 1 }}>
              Mode
              <select value={settings.mode} onChange={(e) => set({ mode: e.target.value })} style={selectStyle}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>
              Power
              <select
                value={settings.power}
                onChange={(e) => set({ power: parseFloat(e.target.value) })}
                style={selectStyle}
              >
                {POWERS.map((p) => (
                  <option key={p} value={p}>
                    {p}W
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={labelStyle}>
              Grid Resolution
              <select
                value={settings.grid}
                onChange={(e) => set({ grid: parseInt(e.target.value) })}
                style={selectStyle}
              >
                {GRID_SIZES.map((g) => (
                  <option key={g} value={g}>
                    {g}°
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-tertiary)',
              borderRadius: '4px',
              padding: '4px 6px',
            }}
          >
            <span style={swatch('rgba(40,30,80,0.5)')} title="< 10% reliability" />
            <span style={{ ...labelStyle, fontSize: '9px' }}>Poor</span>
            <span style={swatch('rgba(255,80,0,0.9)')} />
            <span style={{ ...labelStyle, fontSize: '9px' }}>Low</span>
            <span style={swatch('rgba(255,255,0,0.9)')} />
            <span style={{ ...labelStyle, fontSize: '9px' }}>Fair</span>
            <span style={swatch('rgba(0,220,0,0.9)')} />
            <span style={{ ...labelStyle, fontSize: '9px' }}>Good</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '9px', marginTop: '6px', textAlign: 'center' }}>
            {status
              ? `${status.mode || settings.mode} ${status.power || settings.power}W | SFI: ${status.solarData?.sfi ?? '–'} K: ${status.solarData?.kIndex ?? '–'}`
              : 'Loading...'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VoacapGlobeControl;

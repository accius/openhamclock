/**
 * TimeShiftControl — the floating "display time" scrubber on the map.
 *
 * Shown when the Time Shift map layer is on (any projection — it floats over
 * the map container rather than attaching to Leaflet). Drives the global
 * offset in utils/displayTime.js: ±1 h / ±1 day / ±1 week nudges, a slider
 * spanning ±30 days, and Now. Draggable and minimisable like the other
 * floating layer panels (makeDraggable / addMinimizeToggle).
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useDisplayTime from '../hooks/app/useDisplayTime.js';
import { HOUR_MS, DAY_MS, WEEK_MS, MAX_OFFSET_MS, formatOffset } from '../utils/displayTime.js';
import { makeDraggable } from '../plugins/layers/makeDraggable.js';
import { addMinimizeToggle } from '../plugins/layers/addMinimizeToggle.js';

const STORAGE_KEY = 'time-shift-panel-position';

const pad = (n) => String(n).padStart(2, '0');
const fmtUtc = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}z`;

const btnStyle = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  padding: '3px 0',
  cursor: 'pointer',
  flex: 1,
  minWidth: 0,
};

export function TimeShiftControl({ onClose }) {
  const { t } = useTranslation();
  const { offsetMs, shifted, shift, setOffsetMs, reset } = useDisplayTime();
  const elRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    // Keep drags/scrolls on the control from reaching the map underneath.
    const stop = (e) => e.stopPropagation();
    for (const evt of ['pointerdown', 'mousedown', 'wheel', 'dblclick', 'touchstart']) {
      el.addEventListener(evt, stop);
    }
    makeDraggable(el, STORAGE_KEY, { snap: 5 });
    addMinimizeToggle(el, STORAGE_KEY, {
      contentClassName: 'time-shift-panel-content',
      buttonClassName: 'time-shift-minimize-btn',
    });
    return () => {
      for (const evt of ['pointerdown', 'mousedown', 'wheel', 'dblclick', 'touchstart']) {
        el.removeEventListener(evt, stop);
      }
    };
  }, []);

  const display = new Date(Date.now() + offsetMs);
  const sliderHours = Math.round(offsetMs / HOUR_MS);

  const nudge = (label, delta, aria) => (
    <button type="button" style={btnStyle} onClick={() => shift(delta)} aria-label={aria} title={aria}>
      {label}
    </button>
  );

  return (
    <div
      className="panel-wrapper"
      style={{ position: 'absolute', top: '52px', right: '10px', zIndex: 1000, pointerEvents: 'none' }}
    >
      <div
        ref={elRef}
        className="time-shift-control"
        role="group"
        aria-label={t('timeShift.title')}
        style={{ pointerEvents: 'auto', minWidth: '220px' }}
      >
        <div
          className="floating-panel-header"
          data-drag-handle="true"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}
        >
          <span>⏱ {t('timeShift.title')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={t('timeShift.close')}
                title={t('timeShift.close')}
                style={{ fontSize: '1em' }}
              >
                ×
              </button>
            )}
            <button type="button" className="time-shift-minimize-btn" aria-label="Minimize panel">
              ▶
            </button>
          </span>
        </div>
        <div className="time-shift-panel-content" style={{ padding: '0 10px 10px' }}>
          <div
            style={{
              padding: '6px 8px',
              marginBottom: '8px',
              borderRadius: '3px',
              background: 'var(--bg-tertiary)',
              border: `1px solid ${shifted ? '#ff4d4d' : 'var(--border-color)'}`,
              textAlign: 'center',
            }}
            aria-live="polite"
          >
            <div style={{ fontSize: '9px', opacity: 0.7, letterSpacing: '0.5px' }}>
              {shifted ? t('timeShift.notRealTime') : t('timeShift.realTime')}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: shifted ? '#ff4d4d' : 'var(--accent-cyan)' }}>
              {fmtUtc(display)}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{formatOffset(offsetMs)}</div>
          </div>

          <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
            {nudge('−1w', -WEEK_MS, t('timeShift.minusWeek'))}
            {nudge('−1d', -DAY_MS, t('timeShift.minusDay'))}
            {nudge('−1h', -HOUR_MS, t('timeShift.minusHour'))}
            {nudge('+1h', HOUR_MS, t('timeShift.plusHour'))}
            {nudge('+1d', DAY_MS, t('timeShift.plusDay'))}
            {nudge('+1w', WEEK_MS, t('timeShift.plusWeek'))}
          </div>

          <input
            type="range"
            min={-MAX_OFFSET_MS / HOUR_MS}
            max={MAX_OFFSET_MS / HOUR_MS}
            step={1}
            value={sliderHours}
            onChange={(e) => setOffsetMs(Number(e.target.value) * HOUR_MS)}
            aria-label={t('timeShift.slider')}
            aria-valuetext={formatOffset(offsetMs)}
            style={{ width: '100%', margin: '4px 0' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', opacity: 0.6 }}>
            <span>−30d</span>
            <span>{t('timeShift.now')}</span>
            <span>+30d</span>
          </div>

          <button
            type="button"
            onClick={reset}
            disabled={!shifted}
            aria-label={t('timeShift.resetAria')}
            style={{
              ...btnStyle,
              width: '100%',
              marginTop: '6px',
              fontWeight: 700,
              color: shifted ? '#000' : 'var(--text-muted)',
              background: shifted ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
              cursor: shifted ? 'pointer' : 'default',
            }}
          >
            {t('timeShift.now')}
          </button>
          <div style={{ marginTop: '6px', fontSize: '9px', opacity: 0.6, lineHeight: 1.4 }}>{t('timeShift.hint')}</div>
        </div>
      </div>
    </div>
  );
}

export default TimeShiftControl;

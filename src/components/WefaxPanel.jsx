/**
 * WefaxPanel — browse the NWS/USCG HF radiofax (WEFAX) charts that the five
 * US stations broadcast, straight from tgftp.nws.noaa.gov via the server
 * proxy (/api/wefax). Pick a station and a chart, zoom the image, and
 * click a broadcast frequency to tune the rig (USB, 1.9 kHz below carrier).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../utils/apiFetch';

const STATION_KEY = 'ohc_wefax_station';
const CHART_KEY = 'ohc_wefax_chart';
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];
const REFRESH_MS = 30 * 60 * 1000;

let catalogPromise = null;
const loadCatalog = () => {
  if (!catalogPromise) {
    catalogPromise = apiFetch('/api/wefax/catalog')
      .then((r) => {
        if (!r?.ok) throw new Error(`HTTP ${r?.status}`);
        return r.json();
      })
      .catch((err) => {
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
};

const small = {
  padding: '2px 4px',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-secondary)',
  fontSize: '9px',
  fontFamily: 'var(--font-mono)',
  maxWidth: '100%',
};
const iconBtn = {
  ...small,
  cursor: 'pointer',
  minWidth: '22px',
};

export const WefaxPanel = ({ onTune = null, rigEnabled = false }) => {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [stationId, setStationId] = useState(() => {
    try {
      return localStorage.getItem(STATION_KEY) || 'NMF';
    } catch {
      return 'NMF';
    }
  });
  const [chartId, setChartId] = useState(() => {
    try {
      return localStorage.getItem(CHART_KEY) || '';
    } catch {
      return '';
    }
  });
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [stamp, setStamp] = useState(() => Date.now());
  const [imgState, setImgState] = useState('loading');
  const scrollRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((c) => alive && setCatalog(c))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  // Charts are reissued a few times a day — re-pull the current one every 30 min
  useEffect(() => {
    const id = setInterval(() => setStamp(Date.now()), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const station = useMemo(
    () => catalog?.stations.find((s) => s.id === stationId) || catalog?.stations[0] || null,
    [catalog, stationId],
  );
  const chart = useMemo(
    () => station?.charts.find((c) => c.id === chartId) || station?.charts[0] || null,
    [station, chartId],
  );
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of station?.charts || []) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group).push(c);
    }
    return [...m.entries()];
  }, [station]);

  const pickStation = (id) => {
    setStationId(id);
    const st = catalog?.stations.find((s) => s.id === id);
    const first = st?.charts[0]?.id || '';
    setChartId(first);
    try {
      localStorage.setItem(STATION_KEY, id);
      localStorage.setItem(CHART_KEY, first);
    } catch {}
  };
  const pickChart = (id) => {
    setChartId(id);
    setImgState('loading');
    try {
      localStorage.setItem(CHART_KEY, id);
    } catch {}
  };
  const stepZoom = (dir) => {
    setFit(false);
    setZoom((z) => {
      const i = ZOOM_STEPS.indexOf(z);
      const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 2 : i) + dir))];
      return next;
    });
  };

  // Drag to pan when zoomed
  const onPointerDown = (e) => {
    if (fit || !scrollRef.current) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sl: scrollRef.current.scrollLeft, st: scrollRef.current.scrollTop };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || !scrollRef.current) return;
    scrollRef.current.scrollLeft = d.sl - (e.clientX - d.x);
    scrollRef.current.scrollTop = d.st - (e.clientY - d.y);
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const tune = (dialKHz) => {
    if (!onTune) return;
    // freq in MHz (RigContext's toHz treats numbers < 1000 as MHz); radiofax is USB
    onTune({ freq: dialKHz / 1000, mode: 'USB' });
  };

  const imgSrc = chart ? `/api/wefax/chart/${chart.id}?t=${stamp}` : null;

  return (
    <div
      className="panel"
      style={{ padding: '6px', height: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          color: 'var(--accent-primary)',
          fontWeight: 700,
        }}
      >
        <span>📠 WEFAX</span>
        <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <button
            type="button"
            style={iconBtn}
            onClick={() => stepZoom(-1)}
            aria-label={t('wefax.zoomOut', { defaultValue: 'Zoom out' })}
          >
            −
          </button>
          <button
            type="button"
            style={{
              ...iconBtn,
              color: fit ? 'var(--accent-green)' : 'var(--text-secondary)',
              borderColor: fit ? 'var(--accent-green)' : 'var(--border-color)',
            }}
            onClick={() => {
              setFit(true);
              setZoom(1);
            }}
            aria-pressed={fit}
            aria-label={t('wefax.fit', { defaultValue: 'Fit to panel' })}
          >
            {t('wefax.fit', { defaultValue: 'Fit' })}
          </button>
          <button
            type="button"
            style={iconBtn}
            onClick={() => stepZoom(1)}
            aria-label={t('wefax.zoomIn', { defaultValue: 'Zoom in' })}
          >
            +
          </button>
          <button
            type="button"
            style={iconBtn}
            onClick={() => setStamp(Date.now())}
            aria-label={t('wefax.refresh', { defaultValue: 'Reload chart' })}
            title={t('wefax.refresh', { defaultValue: 'Reload chart' })}
          >
            ↻
          </button>
        </span>
      </div>

      {error && !catalog ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', padding: '10px' }}>
          {t('wefax.unavailable', { defaultValue: 'WEFAX catalogue unavailable' })}
        </div>
      ) : !catalog ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
          <div className="loading-spinner" />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <select
              value={station?.id || ''}
              onChange={(e) => pickStation(e.target.value)}
              aria-label={t('wefax.station', { defaultValue: 'Station' })}
              style={{ ...small, flex: '1 1 120px' }}
            >
              {catalog.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              value={chart?.id || ''}
              onChange={(e) => pickChart(e.target.value)}
              aria-label={t('wefax.chart', { defaultValue: 'Chart' })}
              style={{ ...small, flex: '2 1 180px' }}
            >
              {groups.map(([group, charts]) => (
                <optgroup key={group} label={group}>
                  {charts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.id})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div
            ref={scrollRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: fit ? 'hidden' : 'auto',
              background: '#fff',
              borderRadius: '4px',
              position: 'relative',
              cursor: fit ? 'default' : dragRef.current ? 'grabbing' : 'grab',
              display: fit ? 'flex' : 'block',
              alignItems: 'center',
              justifyContent: 'center',
              touchAction: fit ? 'auto' : 'none',
            }}
          >
            {imgSrc && (
              <img
                key={imgSrc}
                src={imgSrc}
                alt={chart ? `${chart.title} (${chart.id})` : ''}
                draggable={false}
                onLoad={() => setImgState('ok')}
                onError={() => setImgState('error')}
                style={
                  fit
                    ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'auto' }
                    : { width: `${zoom * 100}%`, maxWidth: 'none', display: 'block' }
                }
              />
            )}
            {imgState === 'error' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#333',
                  fontSize: '11px',
                  background: 'rgba(255,255,255,0.9)',
                }}
              >
                {t('wefax.chartUnavailable', { defaultValue: 'Chart not available right now' })}
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
              fontSize: '9px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span title={t('wefax.dialHint', { defaultValue: 'USB dial frequency = assigned carrier − 1.9 kHz' })}>
                {t('wefax.tuneUsb', { defaultValue: 'USB dial' })}:
              </span>
              {station?.dialKHz.map((f, i) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => tune(f)}
                  disabled={!rigEnabled}
                  title={
                    rigEnabled
                      ? t('wefax.tuneTitle', {
                          defaultValue: 'Tune rig to {{f}} kHz USB (carrier {{c}} kHz)',
                          f,
                          c: station.frequenciesKHz[i],
                        })
                      : t('wefax.rigOff', { defaultValue: 'Enable rig control to tune' })
                  }
                  aria-label={`${f} kHz`}
                  style={{
                    ...iconBtn,
                    color: rigEnabled ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    cursor: rigEnabled ? 'pointer' : 'default',
                  }}
                >
                  {f}
                </button>
              ))}
              <span>kHz</span>
            </span>
            <a
              href={station?.scheduleUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
            >
              {t('wefax.schedule', { defaultValue: 'schedule' })} ↗
            </a>
          </div>
        </>
      )}
    </div>
  );
};

export default WefaxPanel;

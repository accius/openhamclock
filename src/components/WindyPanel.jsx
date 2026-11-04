/**
 * WindyPanel — an embedded Windy.com map (embed.windy.com iframe) centred on
 * DE or the DX target, with an overlay selector (wind, rain, clouds,
 * temperature, pressure, waves) and zoom buttons. The iframe is created only
 * once the panel is actually visible on screen (IntersectionObserver), so a
 * hidden tab never loads Windy's assets.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildWindyEmbedUrl,
  WINDY_OVERLAYS,
  DEFAULT_WINDY_OVERLAY,
  WINDY_ZOOM_MIN,
  WINDY_ZOOM_MAX,
  isWindyOverlay,
} from '../utils/windyEmbed.js';

const OVERLAY_KEY = 'ohc_windy_overlay';
const ZOOM_KEY = 'ohc_windy_zoom';
const CENTER_KEY = 'ohc_windy_center';

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
};

const btn = (active) => ({
  padding: '2px 6px',
  background: active ? 'rgba(0,255,136,0.15)' : 'var(--bg-tertiary)',
  border: `1px solid ${active ? 'var(--accent-green)' : 'var(--border-color)'}`,
  borderRadius: '4px',
  color: active ? 'var(--accent-green)' : 'var(--text-secondary)',
  fontSize: '9px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
});

export const WindyPanel = ({ deLocation = null, dxLocation = null, units = 'metric' }) => {
  const { t } = useTranslation();
  const [overlay, setOverlay] = useState(() => {
    const v = read(OVERLAY_KEY, DEFAULT_WINDY_OVERLAY);
    return isWindyOverlay(v) ? v : DEFAULT_WINDY_OVERLAY;
  });
  const [zoom, setZoom] = useState(() => {
    const z = Number(read(ZOOM_KEY, 5));
    return Number.isFinite(z) ? Math.max(WINDY_ZOOM_MIN, Math.min(WINDY_ZOOM_MAX, z)) : 5;
  });
  const [center, setCenter] = useState(() => (read(CENTER_KEY, 'de') === 'dx' ? 'dx' : 'de'));
  const [visible, setVisible] = useState(false);
  const hostRef = useRef(null);

  // Lazy: only build the iframe once the panel has been on screen
  useEffect(() => {
    const el = hostRef.current;
    if (!el || visible) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);

  const loc = center === 'dx' && dxLocation?.lat != null ? dxLocation : deLocation;
  const src = useMemo(
    () => (loc ? buildWindyEmbedUrl({ lat: loc.lat, lon: loc.lon, overlay, zoom, units }) : null),
    [loc?.lat, loc?.lon, overlay, zoom, units], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pick = (id) => {
    setOverlay(id);
    write(OVERLAY_KEY, id);
  };
  const changeZoom = (d) => {
    setZoom((z) => {
      const n = Math.max(WINDY_ZOOM_MIN, Math.min(WINDY_ZOOM_MAX, z + d));
      write(ZOOM_KEY, n);
      return n;
    });
  };
  const pickCenter = (c) => {
    setCenter(c);
    write(CENTER_KEY, c);
  };

  return (
    <div
      className="panel"
      style={{ padding: '6px', height: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}
      ref={hostRef}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '4px',
          flexWrap: 'wrap',
          fontSize: '11px',
          color: 'var(--accent-primary)',
          fontWeight: 700,
        }}
      >
        <span>🌬️ WINDY</span>
        <span style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          <button
            type="button"
            style={btn(center === 'de')}
            onClick={() => pickCenter('de')}
            aria-pressed={center === 'de'}
            aria-label={t('windy.centerDe', { defaultValue: 'Centre on DE' })}
          >
            DE
          </button>
          <button
            type="button"
            style={{ ...btn(center === 'dx'), opacity: dxLocation?.lat != null ? 1 : 0.5 }}
            onClick={() => pickCenter('dx')}
            disabled={dxLocation?.lat == null}
            aria-pressed={center === 'dx'}
            aria-label={t('windy.centerDx', { defaultValue: 'Centre on DX' })}
          >
            DX
          </button>
          <button
            type="button"
            style={btn(false)}
            onClick={() => changeZoom(-1)}
            aria-label={t('windy.zoomOut', { defaultValue: 'Zoom out' })}
            disabled={zoom <= WINDY_ZOOM_MIN}
          >
            −
          </button>
          <button
            type="button"
            style={btn(false)}
            onClick={() => changeZoom(1)}
            aria-label={t('windy.zoomIn', { defaultValue: 'Zoom in' })}
            disabled={zoom >= WINDY_ZOOM_MAX}
          >
            +
          </button>
        </span>
      </div>
      <div
        style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}
        role="tablist"
        aria-label={t('windy.overlay', { defaultValue: 'Overlay' })}
      >
        {WINDY_OVERLAYS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={overlay === o.id}
            style={btn(overlay === o.id)}
            onClick={() => pick(o.id)}
          >
            {t(`windy.overlays.${o.id}`, { defaultValue: o.label })}
          </button>
        ))}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          background: 'var(--bg-tertiary)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        {!loc ? (
          <div style={{ padding: '10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
            {t('windy.noLocation', { defaultValue: 'Set your location in Settings → Station' })}
          </div>
        ) : visible && src ? (
          <iframe
            key={src}
            title="Windy"
            src={src}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-scripts allow-same-origin allow-popups"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <div style={{ padding: '10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>…</div>
        )}
      </div>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'right' }}>
        <a
          href={
            loc
              ? `https://www.windy.com/?${loc.lat.toFixed(3)},${loc.lon.toFixed(3)},${zoom}`
              : 'https://www.windy.com/'
          }
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          windy.com ↗
        </a>
      </div>
    </div>
  );
};

export default WindyPanel;

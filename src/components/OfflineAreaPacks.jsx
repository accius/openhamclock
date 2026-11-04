/**
 * OfflineAreaPacks — "Download area for offline" control and saved-pack list.
 *
 * Shown in Settings → Map Layers and in the EmComm layout's rail. The
 * operator picks an area (a radius around DE or the current map view), a
 * basemap whose terms allow offline download, and a zoom range; sees the
 * tile count and size before starting; and can cancel. Each pack also
 * snapshots the EmComm data for the area (NWS alerts, shelters,
 * repeaters) so panels have last-known data when the internet is gone.
 *
 * Storage/download logic: utils/offlinePackStore.js. Tile math and
 * manifests: utils/offlineTiles.js, utils/offlinePackManifest.js.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { MAP_STYLES } from '../utils/config.js';
import { latLonToMaidenhead } from '../utils/geo.js';
import { requestMapFocus } from '../utils/mapFocus.js';
import { getMapViewport, subscribeMapViewport, requestBasemap } from '../utils/mapViewport.js';
import { applyCustomTileSource, useMapStylesVersion } from '../utils/mapStylesLive.js';
import {
  OFFLINE_ZOOM_MIN,
  OFFLINE_ZOOM_MAX,
  DEFAULT_MIN_ZOOM,
  DEFAULT_MAX_ZOOM,
  RADIUS_PRESETS_KM,
  DEFAULT_RADIUS_KM,
  MAX_TILES_PER_PACK,
  bboxAroundPoint,
  bboxCenter,
  bboxContains,
  normalizeBbox,
  countTiles,
  estimatePackBytes,
  formatBytes,
  offlinePackStyleIds,
} from '../utils/offlineTiles.js';
import {
  BUDGET_OPTIONS_MB,
  SNAPSHOT_KINDS,
  checkBudget,
  defaultPackName,
  formatAsOf,
  isIncomplete,
  storageNotes,
  totalPackBytes,
} from '../utils/offlinePackManifest.js';
import {
  CUSTOM_STYLE_ID,
  readCustomTileSource,
  validateCustomTileSource,
  writeCustomTileSource,
} from '../utils/customTileSource.js';
import {
  PACKS_CHANGED_EVENT,
  offlinePacksSupported,
  packServingActive,
  listPacks,
  storageStatus,
  getBudgetMB,
  setBudgetMB,
  startPackDownload,
  resumePackDownload,
  registerTileSource,
  cancelPackDownload,
  resetDownloadState,
  getDownloadState,
  subscribeDownload,
  deletePack,
  refreshPackData,
} from '../utils/offlinePackStore.js';

const MB = 1024 * 1024;

const fmtBbox = (b) => {
  if (!b) return '';
  const ns = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
  const ew = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;
  return `${ns(b.south)}–${ns(b.north)}, ${ew(b.west)}–${ew(b.east)}`;
};

const btn = (extra = {}) => ({
  padding: '3px 8px',
  borderRadius: '4px',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  cursor: 'pointer',
  ...extra,
});

const selectStyle = {
  padding: '2px 4px',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
};

export default function OfflineAreaPacks({ deLocation, compact = false }) {
  const { t, i18n } = useTranslation();
  const supported = offlinePacksSupported();
  const download = useSyncExternalStore(subscribeDownload, getDownloadState, getDownloadState);
  const [viewport, setViewport] = useState(getMapViewport);
  const [mode, setMode] = useState('radius');
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  // Re-read on live MAP_STYLES changes (operator tile source added/removed)
  const stylesVersion = useMapStylesVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- MAP_STYLES is mutated in place; the version is the signal
  const ELIGIBLE_STYLE_IDS = useMemo(() => offlinePackStyleIds(MAP_STYLES), [stylesVersion]);
  const [styleIdState, setStyleId] = useState(() => {
    const cur = getMapViewport().styleId;
    const ids = offlinePackStyleIds(MAP_STYLES);
    return ids.includes(cur) ? cur : ids[0] || null;
  });
  const styleId = ELIGIBLE_STYLE_IDS.includes(styleIdState) ? styleIdState : ELIGIBLE_STYLE_IDS[0] || null;
  const [minZoom, setMinZoom] = useState(DEFAULT_MIN_ZOOM);
  const [maxZoom, setMaxZoom] = useState(DEFAULT_MAX_ZOOM);
  const [name, setName] = useState('');
  const [budgetMB, setBudget] = useState(getBudgetMB);
  const [packs, setPacks] = useState([]);
  const [storage, setStorage] = useState({ usage: null, quota: null, persisted: null });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const reload = useCallback(async () => {
    if (!offlinePacksSupported()) return;
    const [list, st] = await Promise.all([listPacks(), storageStatus()]);
    setPacks(list);
    setStorage(st);
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(PACKS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(PACKS_CHANGED_EVENT, reload);
  }, [reload]);

  useEffect(() => subscribeMapViewport(setViewport), []);

  const style = styleId ? MAP_STYLES[styleId] : null;
  const styleMaxZoom = Math.min(OFFLINE_ZOOM_MAX, style?.offlineMaxZoom ?? OFFLINE_ZOOM_MAX);
  const hasDE = Number.isFinite(deLocation?.lat) && Number.isFinite(deLocation?.lon);

  const bbox = useMemo(() => {
    if (mode === 'radius') return hasDE ? bboxAroundPoint(deLocation.lat, deLocation.lon, radiusKm) : null;
    return normalizeBbox(viewport.bbox);
  }, [mode, hasDE, deLocation?.lat, deLocation?.lon, radiusKm, viewport.bbox]);

  const tileCount = useMemo(() => (bbox ? countTiles(bbox, minZoom, maxZoom) : 0), [bbox, minZoom, maxZoom]);
  const estimate = estimatePackBytes(tileCount, style?.offlineAvgTileBytes);
  const packsBytes = totalPackBytes(packs);
  const budget = checkBudget({
    estimateBytes: estimate,
    packsBytes,
    budgetBytes: budgetMB * MB,
    usage: storage.usage,
    quota: storage.quota,
    tileCount,
    maxTiles: MAX_TILES_PER_PACK,
  });
  const running = download.status === 'running';

  const locator = hasDE ? latLonToMaidenhead({ lat: deLocation.lat, lon: deLocation.lon }) : '';
  const suggestedName = defaultPackName({
    mode,
    radiusKm,
    locator: mode === 'radius' ? locator : '',
    center: bbox ? bboxCenter(bbox) : null,
  });

  const mapStyleId = viewport.styleId;
  const mapOnPackStyle = mapStyleId && mapStyleId === styleId;
  const mapLang = (i18n.language || 'en').split('-')[0];

  const start = () => {
    if (!style || !bbox || budget.level === 'block' || running) return;
    const center = mode === 'radius' && hasDE ? { lat: deLocation.lat, lon: deLocation.lon } : bboxCenter(bbox);
    // Snapshot data around DE when DE is inside the area, so the stored
    // requests are the very ones the EmComm panels make.
    const dataCenter =
      hasDE && bboxContains(bbox, deLocation.lat, deLocation.lon)
        ? { lat: deLocation.lat, lon: deLocation.lon }
        : center;
    startPackDownload({
      name: name.trim() || suggestedName,
      styleId,
      styleName: style.name,
      urlTemplate: style.url.replace('{lang}', mapLang),
      subdomains: style.subdomains ?? 'abc',
      lang: mapLang,
      retina: typeof window !== 'undefined' && window.devicePixelRatio > 1,
      bbox,
      minZoom,
      maxZoom,
      center,
      dataCenter,
      radiusKm: mode === 'radius' ? radiusKm : null,
    });
    setName('');
  };

  const changeBudget = (mb) => {
    setBudget(mb);
    setBudgetMB(mb);
  };

  const onDelete = async (id) => {
    setConfirmDelete(null);
    setBusyId(id);
    try {
      await deletePack(id);
    } finally {
      setBusyId(null);
      reload();
    }
  };

  const onRefresh = async (id) => {
    setBusyId(id);
    try {
      await refreshPackData(id);
    } finally {
      setBusyId(null);
    }
  };

  const showPack = (p) => {
    if (p.styleId !== mapStyleId && MAP_STYLES[p.styleId]) requestBasemap(p.styleId);
    const c = p.center || bboxCenter(p.bbox);
    if (c)
      requestMapFocus({ lat: c.lat, lon: c.lon, zoom: Math.min(p.maxZoom, Math.max(p.minZoom + 3, 9)), force: true });
  };

  const notes = storageNotes({
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    vendor: typeof navigator !== 'undefined' ? navigator.vendor : '',
    standalone:
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches) ||
      (typeof navigator !== 'undefined' && navigator.standalone === true),
    persisted: storage.persisted,
  });

  const onResume = (id) => {
    resumePackDownload(id);
  };

  const gap = compact ? '6px' : '10px';
  const muted = { fontSize: '10px', color: 'var(--text-muted)' };
  const note = (color) => ({ fontSize: '11px', color, lineHeight: 1.4 });

  if (!supported) {
    return (
      <div style={note('var(--text-muted)')}>
        {t('offlinePacks.insecure', {
          defaultValue:
            'Offline map areas need a secure connection (HTTPS or localhost). This page is on plain http, where the browser does not allow offline storage.',
        })}
      </div>
    );
  }

  const reasonText = (r) => {
    switch (r) {
      case 'empty':
        return t('offlinePacks.warn.empty', { defaultValue: 'Nothing to download — pick an area.' });
      case 'too-many-tiles':
        return t('offlinePacks.warn.tooManyTiles', {
          defaultValue: 'One pack is limited to {{max}} tiles. Lower the top zoom or pick a smaller area.',
          max: MAX_TILES_PER_PACK.toLocaleString(),
        });
      case 'over-budget':
        return t('offlinePacks.warn.overBudget', {
          defaultValue:
            'That would go over your offline storage budget of {{budget}}. Delete a pack or raise the budget.',
          budget: formatBytes(budgetMB * MB),
        });
      case 'quota-full':
        return t('offlinePacks.warn.quotaFull', {
          defaultValue: 'The browser has almost no storage left for this site.',
        });
      case 'quota-near':
        return t('offlinePacks.warn.quotaNear', {
          defaultValue: "This brings the browser's storage for this site close to its limit.",
        });
      default:
        return r;
    }
  };

  const statusLine = () => {
    if (download.status === 'done') {
      return (
        <span style={{ color: 'var(--accent-green, #22c55e)' }}>
          {t('offlinePacks.status.done', { defaultValue: 'Saved “{{name}}”.', name: download.name })}
          {download.failed > 0 &&
            ` ${t('offlinePacks.status.failedTiles', {
              defaultValue: '{{count}} tiles had no data on the server and were skipped.',
              count: download.failed,
            })}`}
        </span>
      );
    }
    if (download.status === 'cancelled') {
      return (
        <span style={{ color: 'var(--text-muted)' }}>
          {t('offlinePacks.status.paused', {
            defaultValue: 'Paused. The tiles saved so far are kept; Resume continues where it stopped.',
          })}
        </span>
      );
    }
    if (download.status === 'error') {
      return (
        <span style={{ color: 'var(--accent-red, #ef4444)' }}>
          {download.error === 'quota'
            ? t('offlinePacks.status.quotaKept', {
                defaultValue:
                  'Stopped: browser storage is full. The tiles saved so far are kept — delete another area or lower the zoom, then Resume.',
              })
            : download.error === 'network'
              ? t('offlinePacks.status.networkKept', {
                  defaultValue: 'Stopped: the tile server stopped answering. The area is kept; Resume later.',
                })
              : t('offlinePacks.status.failed', { defaultValue: 'The download stopped unexpectedly.' })}
        </span>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, fontSize: '11px', color: 'var(--text-primary)' }}>
      {!packServingActive() && (
        <div style={note('var(--accent-amber, #fbbf24)')}>
          {t('offlinePacks.noWorker', {
            defaultValue:
              'The offline worker is not active on this page yet, so saved areas are not served. It starts after one full load of the app over HTTPS or localhost; reload once, then check again.',
          })}
        </div>
      )}

      {ELIGIBLE_STYLE_IDS.length === 0 ? (
        <div style={note('var(--text-muted)')}>
          {t('offlinePacks.noStyles', { defaultValue: 'No basemap allows offline download.' })}
        </div>
      ) : (
        <>
          {/* Area */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            <span style={muted}>{t('offlinePacks.area', { defaultValue: 'Area' })}</span>
            {RADIUS_PRESETS_KM.map((km) => (
              <button
                key={km}
                type="button"
                disabled={running}
                onClick={() => {
                  setMode('radius');
                  setRadiusKm(km);
                }}
                aria-pressed={mode === 'radius' && radiusKm === km}
                style={btn(
                  mode === 'radius' && radiusKm === km
                    ? { background: 'var(--accent-amber)', color: '#000', borderColor: 'var(--accent-amber)' }
                    : {},
                )}
              >
                {t('offlinePacks.radius', { defaultValue: '{{km}} km', km })}
              </button>
            ))}
            <button
              type="button"
              disabled={running}
              onClick={() => setMode('view')}
              aria-pressed={mode === 'view'}
              style={btn(
                mode === 'view'
                  ? { background: 'var(--accent-amber)', color: '#000', borderColor: 'var(--accent-amber)' }
                  : {},
              )}
            >
              {t('offlinePacks.mapView', { defaultValue: 'Map view' })}
            </button>
          </div>
          {mode === 'radius' && !hasDE && (
            <div style={note('var(--text-muted)')}>
              {t('offlinePacks.needDE', { defaultValue: 'Set your location in Settings → Station first.' })}
            </div>
          )}
          {mode === 'view' && !bbox && (
            <div style={note('var(--text-muted)')}>
              {t('offlinePacks.needView', {
                defaultValue: 'Open the flat map to use its current view (the globe and azimuthal views do not count).',
              })}
            </div>
          )}

          {/* Basemap + zoom */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            <span style={muted}>{t('offlinePacks.basemap', { defaultValue: 'Basemap' })}</span>
            <select
              value={styleId || ''}
              disabled={running}
              onChange={(e) => setStyleId(e.target.value)}
              aria-label={t('offlinePacks.basemap', { defaultValue: 'Basemap' })}
              style={selectStyle}
            >
              {ELIGIBLE_STYLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {MAP_STYLES[id].name}
                </option>
              ))}
            </select>
            <span style={muted}>{t('offlinePacks.zoom', { defaultValue: 'Zoom' })}</span>
            <select
              value={minZoom}
              disabled={running}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMinZoom(v);
                if (v > maxZoom) setMaxZoom(v);
              }}
              aria-label={t('offlinePacks.minZoom', { defaultValue: 'Lowest zoom' })}
              style={selectStyle}
            >
              {Array.from({ length: styleMaxZoom - OFFLINE_ZOOM_MIN + 1 }, (_, i) => OFFLINE_ZOOM_MIN + i).map((z) => (
                <option key={z} value={z}>
                  z{z}
                </option>
              ))}
            </select>
            <span style={muted}>–</span>
            <select
              value={Math.min(maxZoom, styleMaxZoom)}
              disabled={running}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMaxZoom(v);
                if (v < minZoom) setMinZoom(v);
              }}
              aria-label={t('offlinePacks.maxZoom', { defaultValue: 'Highest zoom' })}
              style={selectStyle}
            >
              {Array.from({ length: styleMaxZoom - OFFLINE_ZOOM_MIN + 1 }, (_, i) => OFFLINE_ZOOM_MIN + i).map((z) => (
                <option key={z} value={z}>
                  z{z}
                </option>
              ))}
            </select>
          </div>
          <div style={muted}>
            {t('offlinePacks.styleNote', {
              defaultValue:
                'Only basemaps whose terms allow saving an area for offline use are offered: USGS Topo (United States), Plan IGN (France), GSI (Japan), Kartverket (Norway), GA Base Map (Australia), and your own tile server if you add one below. Each is detailed only in its own country.',
            })}
          </div>
          {mapStyleId && !mapOnPackStyle && style && (
            <div style={{ ...note('var(--text-secondary)'), display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <span>
                {t('offlinePacks.switchHint', {
                  defaultValue: 'The map is on {{current}}. Saved areas show when the map uses {{style}}.',
                  current: MAP_STYLES[mapStyleId]?.name || mapStyleId,
                  style: style.name,
                })}
              </span>
              <button type="button" onClick={() => requestBasemap(styleId)} style={btn({ fontSize: '10px' })}>
                {t('offlinePacks.switchMap', { defaultValue: 'Switch map to {{style}}', style: style.name })}
              </button>
            </div>
          )}

          {/* Name */}
          <input
            type="text"
            value={name}
            disabled={running}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggestedName}
            maxLength={60}
            aria-label={t('offlinePacks.name', { defaultValue: 'Pack name' })}
            style={{ ...selectStyle, padding: '4px 6px' }}
          />

          {/* Estimate + warnings */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
            {t('offlinePacks.estimate', {
              defaultValue: '{{tiles}} tiles · about {{size}}',
              tiles: tileCount.toLocaleString(),
              size: formatBytes(estimate),
            })}
            {bbox && <div style={muted}>{fmtBbox(bbox)}</div>}
          </div>
          {budget.reasons
            .filter((r) => !(r === 'empty' && !bbox))
            .map((r) => (
              <div
                key={r}
                style={note(budget.level === 'block' ? 'var(--accent-red, #ef4444)' : 'var(--accent-amber, #fbbf24)')}
              >
                {reasonText(r)}
              </div>
            ))}

          {/* Download / progress */}
          {running ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={download.total || 0}
                aria-valuenow={download.done}
                style={{ height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}
              >
                <div
                  style={{
                    width: `${download.total ? Math.round((download.done / download.total) * 100) : 0}%`,
                    height: '100%',
                    background: 'var(--accent-amber)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                  {t('offlinePacks.progress', {
                    defaultValue: '{{done}} / {{total}} tiles · {{size}}',
                    done: download.done.toLocaleString(),
                    total: download.total.toLocaleString(),
                    size: formatBytes(download.bytes),
                  })}
                </span>
                <button type="button" onClick={cancelPackDownload} style={btn()}>
                  {t('offlinePacks.cancel', { defaultValue: 'Cancel' })}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={start}
                disabled={!bbox || !style || budget.level === 'block'}
                style={btn({
                  background: 'var(--accent-amber)',
                  color: '#000',
                  fontWeight: 700,
                  borderColor: 'var(--accent-amber)',
                  opacity: !bbox || budget.level === 'block' ? 0.5 : 1,
                  cursor: !bbox || budget.level === 'block' ? 'not-allowed' : 'pointer',
                })}
              >
                {t('offlinePacks.download', { defaultValue: 'Download area for offline' })}
              </button>
              {download.status !== 'idle' && (
                <span style={{ fontSize: '11px' }}>
                  {statusLine()}{' '}
                  <button
                    type="button"
                    onClick={resetDownloadState}
                    aria-label={t('offlinePacks.dismiss', { defaultValue: 'Dismiss' })}
                    style={btn({ padding: '0 5px', fontSize: '10px' })}
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
          )}
          <div style={muted}>
            {t('offlinePacks.dataNote', {
              defaultValue:
                'Each pack also saves the NWS alerts, shelters, repeaters, and (in the US) FEMA disaster declarations for the area, so the EmComm panels show last-known data (with an "as of" time) when offline.',
            })}
          </div>
        </>
      )}

      {/* Storage */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', ...muted }}>
        <span>
          {t('offlinePacks.budgetUse', {
            defaultValue: 'Packs use {{used}} of',
            used: formatBytes(packsBytes),
          })}
        </span>
        <select
          value={budgetMB}
          onChange={(e) => changeBudget(Number(e.target.value))}
          aria-label={t('offlinePacks.budget', { defaultValue: 'Offline storage budget' })}
          style={selectStyle}
        >
          {BUDGET_OPTIONS_MB.map((mb) => (
            <option key={mb} value={mb}>
              {formatBytes(mb * MB)}
            </option>
          ))}
        </select>
        {storage.quota != null && (
          <span>
            {t('offlinePacks.siteStorage', {
              defaultValue: '· site storage {{usage}} of {{quota}}',
              usage: formatBytes(storage.usage || 0),
              quota: formatBytes(storage.quota),
            })}
            {storage.persisted === true && ` · ${t('offlinePacks.persistent', { defaultValue: 'persistent' })}`}
          </span>
        )}
      </div>
      {notes.includes('webkit-7day') && (
        <div style={note('var(--accent-amber, #fbbf24)')}>
          {t('offlinePacks.webkit7day', {
            defaultValue:
              'Safari (and every browser on iPhone/iPad) deletes saved areas if this site is not opened for 7 days of browser use, and may cap storage around 1 GB. Add OpenHamClock to the Home Screen (iOS) or Dock (macOS) and open it from there to keep them; check your areas before relying on them.',
          })}
        </div>
      )}
      {notes.includes('not-persistent') && !notes.includes('webkit-7day') && (
        <div style={muted}>
          {t('offlinePacks.notPersistent', {
            defaultValue:
              'The browser has not granted persistent storage, so it may clear saved areas if the disk gets full. Installing the app usually grants it.',
          })}
        </div>
      )}

      {/* Saved packs */}
      <div>
        <div style={{ ...muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
          {t('offlinePacks.saved', { defaultValue: 'Saved areas ({{count}})', count: packs.length })}
        </div>
        {packs.length === 0 ? (
          <div style={{ ...muted, fontStyle: 'italic' }}>
            {t('offlinePacks.none', { defaultValue: 'No offline areas saved yet.' })}
          </div>
        ) : (
          packs.map((p) => (
            <div
              key={p.id}
              style={{
                padding: '5px 6px',
                marginBottom: '4px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-color)',
                opacity: busyId === p.id ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                <span style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {isIncomplete(p) && !(running && download.packId === p.id) && (
                    <button
                      type="button"
                      disabled={running || busyId === p.id}
                      onClick={() => onResume(p.id)}
                      style={btn({
                        fontSize: '10px',
                        padding: '1px 6px',
                        background: 'var(--accent-amber)',
                        color: '#000',
                        borderColor: 'var(--accent-amber)',
                      })}
                    >
                      {t('offlinePacks.resume', { defaultValue: 'Resume' })}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => showPack(p)}
                    style={btn({ fontSize: '10px', padding: '1px 6px' })}
                  >
                    {t('offlinePacks.show', { defaultValue: 'Show' })}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === p.id}
                    onClick={() => onRefresh(p.id)}
                    title={t('offlinePacks.refreshTitle', {
                      defaultValue: 'Save fresh alerts, shelters, repeaters, and disaster declarations for this area',
                    })}
                    style={btn({ fontSize: '10px', padding: '1px 6px' })}
                  >
                    {t('offlinePacks.refresh', { defaultValue: 'Refresh data' })}
                  </button>
                  {confirmDelete === p.id ? (
                    <button
                      type="button"
                      onClick={() => onDelete(p.id)}
                      style={btn({
                        fontSize: '10px',
                        padding: '1px 6px',
                        background: 'var(--accent-red, #ef4444)',
                        color: '#fff',
                      })}
                    >
                      {t('offlinePacks.confirmDelete', { defaultValue: 'Really delete?' })}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => setConfirmDelete(p.id)}
                      style={btn({ fontSize: '10px', padding: '1px 6px' })}
                    >
                      {t('offlinePacks.delete', { defaultValue: 'Delete' })}
                    </button>
                  )}
                </span>
              </div>
              {isIncomplete(p) && (
                <div style={{ fontSize: '10px', color: 'var(--accent-amber, #fbbf24)' }}>
                  {t('offlinePacks.incomplete', {
                    defaultValue: 'Incomplete — {{saved}} of {{total}} tiles saved',
                    saved: p.tileCount.toLocaleString(),
                    total: (p.totalTiles || p.tileCount).toLocaleString(),
                  })}
                </div>
              )}
              <div style={{ ...muted, fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                {p.styleName} · z{p.minZoom}–{p.maxZoom} · {p.tileCount.toLocaleString()}{' '}
                {t('offlinePacks.tiles', { defaultValue: 'tiles' })} · {formatBytes(p.bytes)} ·{' '}
                {new Date(p.createdAt).toISOString().slice(0, 10)}
              </div>
              <div style={{ ...muted, fontFamily: 'var(--font-mono)' }}>{fmtBbox(p.bbox)}</div>
              <div style={muted}>
                {SNAPSHOT_KINDS.filter((k) => p.data?.[k])
                  .map((k) =>
                    k === 'disasters' && p.data[k].state
                      ? `${p.data[k].count} ${t('offlinePacks.kind.disastersIn', {
                          defaultValue: 'declarations ({{state}})',
                          state: p.data[k].state,
                        })}`
                      : `${p.data[k].count} ${t(`offlinePacks.kind.${k}`, { defaultValue: k })}`,
                  )
                  .join(' · ') || t('offlinePacks.noData', { defaultValue: 'No EmComm data saved' })}
                {p.data &&
                  Object.values(p.data).some((d) => d?.fetchedAt) &&
                  ` · ${t('offlinePacks.asOf', {
                    defaultValue: 'as of {{time}}',
                    time: formatAsOf(Math.max(...Object.values(p.data).map((d) => d?.fetchedAt || 0))),
                  })}`}
              </div>
            </div>
          ))
        )}
      </div>

      <CustomTileSourceForm t={t} muted={muted} note={note} />
    </div>
  );
}

const inputStyle = { ...selectStyle, padding: '3px 6px', width: '100%', boxSizing: 'border-box' };

/**
 * "Use my own tile server" — an operator-supplied tile URL template (their
 * own tile server, a LAN/Pi mbtiles server) that offline areas can be
 * saved from. The operator confirms the source's terms allow it.
 */
function CustomTileSourceForm({ t, muted, note }) {
  const saved = readCustomTileSource();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({
    name: saved?.name || '',
    url: saved?.url || '',
    maxZoom: saved?.maxZoom ?? 18,
    attribution: saved?.attribution || '',
    confirmed: !!saved?.confirmed,
  }));
  const [error, setError] = useState(null);
  const [changed, setChanged] = useState(false);
  const active = !!MAP_STYLES[CUSTOM_STYLE_ID];

  const errorText = {
    url: t('offlinePacks.custom.err.url', { defaultValue: 'Enter a full http:// or https:// tile URL.' }),
    placeholders: t('offlinePacks.custom.err.placeholders', {
      defaultValue: 'The URL needs {z}, {x} and {y} placeholders.',
    }),
    forbidden: t('offlinePacks.custom.err.forbidden', {
      defaultValue: "That public tile server's terms do not allow saving areas for offline use.",
    }),
    confirm: t('offlinePacks.custom.err.confirm', {
      defaultValue: 'Tick the box to confirm this source allows offline storage.',
    }),
  };

  const save = async () => {
    const v = validateCustomTileSource(draft);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setError(null);
    writeCustomTileSource(v.source);
    applyCustomTileSource(v.source); // basemap list updates at once
    await registerTileSource(v.source.url, { subdomains: v.source.subdomains });
    setChanged(true);
  };

  const remove = async () => {
    writeCustomTileSource(null);
    applyCustomTileSource(null);
    await registerTileSource(null);
    setDraft({ name: '', url: '', maxZoom: 18, attribution: '', confirmed: false });
    setChanged(true);
  };

  const set = (k) => (e) =>
    setDraft((d) => ({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '6px' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ ...btn({ border: 'none', background: 'transparent', padding: 0 }), ...muted, cursor: 'pointer' }}
      >
        {open ? '▼' : '▶'} {t('offlinePacks.custom.title', { defaultValue: 'Use my own tile server' })}
        {saved ? ` · ${saved.name}` : ''}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
          <div style={muted}>
            {t('offlinePacks.custom.intro', {
              defaultValue:
                'For your own tile server (for example an mbtiles server on the shack Pi or the LAN) or a provider whose terms allow offline storage. It is added to the basemap list and offered for offline areas. You are responsible for following the source’s terms. The server must send CORS headers, and a plain-http server only works when OpenHamClock itself is opened over http on localhost.',
            })}
          </div>
          <input
            type="text"
            value={draft.name}
            onChange={set('name')}
            placeholder={t('offlinePacks.custom.namePh', { defaultValue: 'Name (e.g. Shack Pi tiles)' })}
            aria-label={t('offlinePacks.custom.name', { defaultValue: 'Source name' })}
            maxLength={40}
            style={inputStyle}
          />
          <input
            type="text"
            value={draft.url}
            onChange={set('url')}
            placeholder="https://tiles.example.net/osm/{z}/{x}/{y}.png"
            aria-label={t('offlinePacks.custom.url', { defaultValue: 'Tile URL template' })}
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          />
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={muted}>{t('offlinePacks.custom.maxZoom', { defaultValue: 'Highest zoom it serves' })}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.maxZoom}
              onChange={set('maxZoom')}
              aria-label={t('offlinePacks.custom.maxZoom', { defaultValue: 'Highest zoom it serves' })}
              style={{ ...selectStyle, width: '56px' }}
            />
          </div>
          <input
            type="text"
            value={draft.attribution}
            onChange={set('attribution')}
            placeholder={t('offlinePacks.custom.attributionPh', {
              defaultValue: 'Attribution shown on the map (e.g. © OpenStreetMap contributors)',
            })}
            aria-label={t('offlinePacks.custom.attribution', { defaultValue: 'Attribution' })}
            maxLength={200}
            style={inputStyle}
          />
          <label style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '11px', cursor: 'pointer' }}>
            <input type="checkbox" checked={draft.confirmed} onChange={set('confirmed')} />
            <span>
              {t('offlinePacks.custom.confirm', {
                defaultValue:
                  'I run this tile server, or its terms allow downloading areas for offline use. I am responsible for following them.',
              })}
            </span>
          </label>
          {error && <div style={note('var(--accent-red, #ef4444)')}>{errorText[error]}</div>}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={save} style={btn({ fontWeight: 700 })}>
              {t('offlinePacks.custom.save', { defaultValue: 'Save source' })}
            </button>
            {saved && (
              <button type="button" onClick={remove} style={btn()}>
                {t('offlinePacks.custom.remove', { defaultValue: 'Remove source' })}
              </button>
            )}
            {changed && (
              <span style={muted}>
                {active
                  ? t('offlinePacks.custom.savedLive', {
                      defaultValue: 'Saved — it is in the basemap list now.',
                    })
                  : t('offlinePacks.custom.removedLive', { defaultValue: 'Removed.' })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

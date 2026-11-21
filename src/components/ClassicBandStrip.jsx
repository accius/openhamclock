/**
 * ClassicBandStrip — the compact band legend under the Classic layout's maps,
 * as buttons that filter the map by band (#1269).
 *
 * Classic hides WorldMap's own legend (hideOverlays) and draws this strip
 * instead; it used to be plain labels, so clicking a band did nothing there
 * while it filtered the map in every other layout. Same behaviour as
 * WorldMap's legend: click bands to show only those (several at once), click
 * again to drop one, ALL clears the filter. The filter is the shared
 * `mapBandFilter` setting, so it carries over to the other layouts.
 */
import { getBandColorForBand } from '../utils';

/** '20', '20m', ' 20M ' → '20m' — the keys WorldMap's legend writes. */
export function bandKey(band) {
  const raw = String(band ?? '')
    .trim()
    .toLowerCase();
  if (!raw || raw === 'other') return null;
  if (raw.endsWith('cm') || raw.endsWith('m')) return raw;
  if (/^\d+(\.\d+)?$/.test(raw)) return `${raw}m`;
  return raw;
}

/** The filter after clicking `band`: added if absent, removed if present. */
export function toggleBandFilter(filter, band) {
  const key = bandKey(band);
  const next = new Set((Array.isArray(filter) ? filter : []).map(bandKey).filter(Boolean));
  if (!key) return Array.from(next);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return Array.from(next);
}

const chip = {
  padding: '1px 4px',
  borderRadius: '2px',
  lineHeight: 1.2,
  font: 'inherit',
  cursor: 'pointer',
};

export function ClassicBandStrip({ bands, mapBandFilter, onMapBandFilterChange }) {
  const selected = new Set((Array.isArray(mapBandFilter) ? mapBandFilter : []).map(bandKey).filter(Boolean));
  const filtering = selected.size > 0;
  const canFilter = typeof onMapBandFilterChange === 'function';

  return (
    <>
      {filtering && canFilter && (
        <button
          type="button"
          onClick={() => onMapBandFilterChange([])}
          title="Show all bands"
          style={{ ...chip, background: '#00ffcc', color: '#001f1a', border: '1px solid rgba(0,0,0,0.35)' }}
        >
          ALL
        </button>
      )}
      {bands.map((band) => {
        const on = selected.has(bandKey(band));
        return (
          <button
            key={band}
            type="button"
            disabled={!canFilter}
            aria-pressed={on}
            onClick={() => onMapBandFilterChange(toggleBandFilter(mapBandFilter, band))}
            title={on ? `Stop filtering ${band}m` : `Show ${band}m on the map`}
            style={{
              ...chip,
              background: getBandColorForBand(`${band}m`),
              color: '#000',
              border: on ? '1px solid #00ffcc' : '1px solid transparent',
              opacity: filtering && !on ? 0.35 : 1,
              cursor: canFilter ? 'pointer' : 'default',
            }}
          >
            {band}
          </button>
        );
      })}
    </>
  );
}

export default ClassicBandStrip;

/**
 * Launch Library 2 → compact launch records for the Space Launches panel
 * and the launch-sites map layer.
 *
 * LL2 "normal" mode returns ~4–5 KB per launch (agency bios, pad essays…);
 * we keep the dozen fields the UI shows, so 20 launches ≈ 10 KB.
 */

const MAX_LAUNCHES = 50;

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

const trimText = (s, max = 280) => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};

/** Slim one LL2 launch object. Returns null if it has no id/name/net. */
function slimLaunch(r) {
  if (!r || !r.id || !r.name || !r.net) return null;
  const pad = r.pad || {};
  const loc = pad.location || {};
  const cfg = r.rocket?.configuration || {};
  return {
    id: String(r.id),
    name: String(r.name),
    net: r.net,
    netPrecision: r.net_precision?.abbrev || null,
    windowStart: r.window_start || null,
    windowEnd: r.window_end || null,
    status: r.status?.abbrev || null,
    statusName: r.status?.name || null,
    probability: num(r.probability),
    provider: r.launch_service_provider?.name || null,
    rocket: cfg.full_name || cfg.name || null,
    mission: r.mission?.name || null,
    missionType: r.mission?.type || null,
    orbit: r.mission?.orbit?.abbrev || r.mission?.orbit?.name || null,
    description: trimText(r.mission?.description),
    pad: pad.name || null,
    padId: pad.id ?? null,
    location: loc.name || null,
    country: loc.country_code || null,
    lat: num(pad.latitude),
    lon: num(pad.longitude),
    padWiki: pad.wiki_url || null,
    webcast: !!r.webcast_live,
    image: typeof r.image === 'string' ? r.image : r.image?.image_url || null,
  };
}

/**
 * Slim an LL2 /launch/upcoming response. Sorted by NET ascending, capped.
 * Launches with no pad coordinates are kept (the panel still lists them);
 * the map layer filters them itself.
 */
function slimLaunches(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return results
    .map(slimLaunch)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.net) - Date.parse(b.net))
    .slice(0, MAX_LAUNCHES);
}

/** Launches that still have a pad position, grouped per pad for map markers. */
function groupByPad(launches) {
  const pads = new Map();
  for (const l of launches) {
    if (l.lat == null || l.lon == null) continue;
    const key = l.padId != null ? `pad-${l.padId}` : `${l.lat.toFixed(3)},${l.lon.toFixed(3)}`;
    let entry = pads.get(key);
    if (!entry) {
      entry = { key, pad: l.pad, location: l.location, country: l.country, lat: l.lat, lon: l.lon, launches: [] };
      pads.set(key, entry);
    }
    entry.launches.push(l);
  }
  return [...pads.values()];
}

module.exports = { slimLaunch, slimLaunches, groupByPad, MAX_LAUNCHES };

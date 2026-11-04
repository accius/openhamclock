/**
 * Merge FEMA shelter data with RF-heard APRS shelter reports.
 *
 * EmComm rationale: FEMA data requires working internet at the server; APRS
 * shelter reports arrive over RF and keep flowing when infrastructure is down.
 * Both are shown side-by-side, tagged by source, and only collapsed when the
 * positions are trivially identical (same site reported by both feeds).
 */

// ~100 m at mid-latitudes — only positions this close count as the same site.
const DEDUP_DEG = 0.001;

/** Derive an OPEN/CLOSED/FULL status from free-text in an APRS shelter report. */
export function aprsShelterStatus(text) {
  if (!text) return null;
  if (/closed/i.test(text)) return 'CLOSED';
  if (/\bfull\b|no\s+(more\s+)?(beds|capacity|room)/i.test(text)) return 'FULL';
  if (/open|accepting/i.test(text)) return 'OPEN';
  return null;
}

/** Normalize an /api/aprs/shelters report into the shelter display shape. */
export function aprsReportToShelter(report) {
  const bedsToken = (report.tokens || []).find(
    (t) => (t.key === 'Beds' || t.key === 'Capacity') && t.type === 'capacity',
  );
  return {
    id: `aprs-${report.from}`,
    name: report.from,
    lat: report.lat ?? null,
    lon: report.lon ?? null,
    status: aprsShelterStatus(report.text),
    currentPopulation: bedsToken ? bedsToken.current : undefined,
    evacuationCapacity: bedsToken ? bedsToken.max : undefined,
    source: report.source === 'rf' ? 'aprs-rf' : 'aprs',
    from: report.from,
    text: report.text,
    tokens: report.tokens || [],
    timestamp: report.timestamp,
  };
}

/**
 * Merge FEMA shelters with APRS shelter reports.
 * - FEMA entries are tagged source: 'fema'.
 * - Only the latest report per sending station is kept.
 * - An APRS report positioned within ~100 m of a FEMA shelter is attached to
 *   that shelter as `aprsReport` instead of producing a duplicate pin.
 */
export function mergeShelters(femaShelters, aprsReports) {
  const fema = (femaShelters || []).map((s) => ({ ...s, source: 'fema' }));

  const latestByFrom = new Map();
  for (const r of aprsReports || []) {
    if (!r || !r.from) continue;
    const prev = latestByFrom.get(r.from);
    if (!prev || (r.timestamp || 0) > (prev.timestamp || 0)) latestByFrom.set(r.from, r);
  }

  const merged = [...fema];
  for (const report of latestByFrom.values()) {
    const shelter = aprsReportToShelter(report);
    if (shelter.lat != null && shelter.lon != null) {
      const dup = fema.find(
        (f) =>
          f.lat != null &&
          f.lon != null &&
          Math.abs(f.lat - shelter.lat) < DEDUP_DEG &&
          Math.abs(f.lon - shelter.lon) < DEDUP_DEG,
      );
      if (dup) {
        dup.aprsReport = shelter;
        continue;
      }
    }
    merged.push(shelter);
  }
  return merged;
}

/**
 * Roll up resource tokens from every EmComm station into one entry per key
 * for the Resource Summary panel: capacities listed, needs and quantities
 * summed, OK / critical statuses counted.
 */
export function aggregateResourceTokens(stations) {
  const byKey = {};
  (stations || []).forEach((s) => {
    (s.tokens || []).forEach((t) => {
      if (!byKey[t.key])
        byKey[t.key] = {
          key: t.key,
          capacity: [],
          needs: 0,
          quantities: 0,
          statuses: { ok: 0, critical: 0 },
          count: 0,
        };
      const agg = byKey[t.key];
      agg.count++;
      if (t.type === 'capacity') agg.capacity.push({ current: t.current, max: t.max });
      else if (t.type === 'need') agg.needs += t.value;
      else if (t.type === 'quantity') agg.quantities += t.value;
      else if (t.type === 'status') agg.statuses.ok++;
      else if (t.type === 'critical') agg.statuses.critical++;
    });
  });
  return Object.values(byKey);
}

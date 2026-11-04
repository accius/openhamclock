/**
 * Kyoto WDC real-time Dst parser.
 *
 * https://wdc.kugi.kyoto-u.ac.jp/dst_realtime/presentmonth/index.html serves
 * the current month's hourly equatorial Dst index as a fixed-width table
 * inside a <pre class="data"> block:
 *
 *                                 Hourly Equatorial Dst Values (REAL-TIME)
 *                                             OCTOBER   2026
 *       unit=nT                                                        UT
 *       1   2   3 ... 24
 *   DAY
 *    1    7   4   5   7   9  11  12  13   10   7 ...
 *   14  -10 -11 -13 ...  -6  -8  -19999
 *   15 99999999999999999999999999999999 9999...
 *
 * Each row is the 2-column day number followed by three groups of eight
 * 4-character right-justified values (one blank between groups), so the
 * row is 2 + 3 × (1 + 8 × 4) = 101 characters wide. "9999" marks hours not
 * yet observed. Values are NOT whitespace-separated — "-19999" above is
 * -1 followed by a missing hour — hence the fixed offsets.
 *
 * Hour column h (1–24) is the value for the interval ending at h:00 UT; we
 * stamp it at the START of that hour (h−1:00 UT) to match SWPC's
 * kyoto-dst.json time_tag convention so both sources plot identically.
 */

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

const GROUPS = 3;
const PER_GROUP = 8;
const FIELD = 4;
const GROUP_WIDTH = 1 + PER_GROUP * FIELD; // leading blank + 8 values

/**
 * Parse one data row at fixed offsets.
 * @returns {{day:number, values:(number|null)[]}|null}
 */
function parseRow(line) {
  if (!/^\s?\d{1,2}\s/.test(line)) return null;
  const day = parseInt(line.slice(0, 2), 10);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  const values = [];
  for (let g = 0; g < GROUPS; g++) {
    for (let j = 0; j < PER_GROUP; j++) {
      const idx = 2 + g * GROUP_WIDTH + 1 + j * FIELD;
      const raw = line.slice(idx, idx + FIELD).trim();
      if (!raw || raw === '9999' || raw === '999') {
        values.push(null);
        continue;
      }
      const v = parseInt(raw, 10);
      // Kyoto's fill is 9999; anything that large is never a real Dst
      values.push(Number.isFinite(v) && Math.abs(v) < 2000 ? v : null);
    }
  }
  return { day, values };
}

/**
 * Parse the Kyoto real-time Dst page (or just its <pre> text).
 * @param {string} html
 * @returns {{ year:number, month:number, updatedAt:string|null, series:{t:number,dst:number}[] }}
 */
function parseKyotoDst(html) {
  if (typeof html !== 'string' || !html) throw new Error('empty Kyoto Dst document');
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const text = preMatch ? preMatch[1] : html;

  // Month/year header, e.g. "OCTOBER   2026"
  const monthMatch = text.match(
    /\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{4})\b/i,
  );
  if (!monthMatch) throw new Error('Kyoto Dst: month header not found');
  const month = MONTHS.indexOf(monthMatch[1].toUpperCase()) + 1;
  const year = parseInt(monthMatch[2], 10);

  const updMatch = html.match(/Updated at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})\s*UT/i);
  const updatedAt = updMatch ? `${updMatch[1]}T${updMatch[2]}:${updMatch[3]}:00Z` : null;

  const series = [];
  let sawDayHeader = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!sawDayHeader) {
      if (/^\s*DAY\s*$/.test(line)) sawDayHeader = true;
      continue;
    }
    const row = parseRow(line);
    if (!row) continue;
    row.values.forEach((v, h) => {
      if (v == null) return;
      series.push({ t: Date.UTC(year, month - 1, row.day, h), dst: v });
    });
  }
  if (series.length === 0) throw new Error('Kyoto Dst: no data rows parsed');
  series.sort((a, b) => a.t - b.t);
  return { year, month, updatedAt, series };
}

/**
 * Normalise SWPC's mirror (https://services.swpc.noaa.gov/products/kyoto-dst.json,
 * [{ time_tag: "2026-10-08T00:00:00", dst: -6 }, ...]) to the same series shape.
 */
function parseSwpcDst(json) {
  if (!Array.isArray(json)) throw new Error('SWPC Dst: not an array');
  const series = [];
  for (const r of json) {
    const tag = r?.time_tag;
    if (typeof tag !== 'string') continue;
    const t = Date.parse(tag.endsWith('Z') ? tag : tag + 'Z');
    const dst = Number(r.dst);
    if (!Number.isFinite(t) || !Number.isFinite(dst)) continue;
    series.push({ t, dst });
  }
  if (series.length === 0) throw new Error('SWPC Dst: no rows');
  series.sort((a, b) => a.t - b.t);
  return { series };
}

/** Keep the last `hours` of a series relative to its newest point. */
function trimSeries(series, hours = 72) {
  if (!series.length) return [];
  const cutoff = series[series.length - 1].t - hours * 3600 * 1000;
  return series.filter((p) => p.t >= cutoff);
}

module.exports = { parseKyotoDst, parseSwpcDst, parseRow, trimSeries };

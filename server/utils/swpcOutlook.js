/**
 * SWPC 27-day Space Weather Outlook parser.
 *
 * Source: https://services.swpc.noaa.gov/text/27-day-outlook.txt
 *
 *   :Product: 27-day Space Weather Outlook Table 27DO.txt
 *   :Issued: 2026 Oct 12 0345 UTC
 *   #   UTC      Radio Flux   Planetary   Largest
 *   #  Date       10.7 cm      A Index    Kp Index
 *   2026 Oct 12     120          16          4
 *
 * Pure: text in, { issued, days } out. The browser-side helpers that turn a
 * day list into a per-contest verdict live in src/utils/solarOutlook.js.
 */

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {string} text raw outlook table
 * @returns {{ issued: string|null, days: Array<{ date: string, sfi: number, ap: number, kp: number }> }}
 */
function parse27DayOutlook(text) {
  const out = { issued: null, days: [] };
  if (typeof text !== 'string') return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(':Issued:')) {
      // ":Issued: 2026 Oct 12 0345 UTC"
      const m = line.match(/:Issued:\s*(\d{4})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2})(\d{2})\s*UTC/i);
      if (m && MONTHS[m[2]]) {
        out.issued = `${m[1]}-${pad2(MONTHS[m[2]])}-${pad2(m[3])}T${m[4]}:${m[5]}:00Z`;
      }
      continue;
    }
    if (line.startsWith(':') || line.startsWith('#')) continue;
    const m = line.match(/^(\d{4})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)$/);
    if (!m) continue;
    const month = MONTHS[m[2]];
    if (!month) continue;
    out.days.push({
      date: `${m[1]}-${pad2(month)}-${pad2(m[3])}`,
      sfi: parseInt(m[4], 10),
      ap: parseInt(m[5], 10),
      kp: parseInt(m[6], 10),
    });
  }
  return out;
}

module.exports = { parse27DayOutlook, MONTHS };

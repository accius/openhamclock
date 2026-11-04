// Build src/assets/geodata/us-states.json from us-atlas states-10m (ISC;
// derived from the U.S. Census Bureau cartographic boundary files).
//
//   curl -sLo /tmp/states-10m.json https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json
//   node scripts/build-us-states.cjs src/assets/geodata/us-states.json 0.02 /tmp/states-10m.json
// Output: { "v":1, "scale":100, "states": { "CO": [ring, ...] } } where each
// ring is a flat [lon*100, lat*100, ...] integer array, simplified with
// Douglas–Peucker at TOL degrees.
const fs = require('fs');
const OUT = process.argv[2];
const TOL = Number(process.argv[3] || 0.02);
const topo = JSON.parse(fs.readFileSync(process.argv[4] || '/tmp/states-10m.json', 'utf8'));
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});
const arcPts = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
const ringOf = (idx) => {
  const pts = [];
  idx.forEach((i, k) => {
    const a = arcPts(i);
    pts.push(...(k ? a.slice(1) : a));
  });
  return pts;
};
const NAMES = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  'Puerto Rico': 'PR',
  Guam: 'GU',
  'United States Virgin Islands': 'VI',
  'American Samoa': 'AS',
  'Commonwealth of the Northern Mariana Islands': 'MP',
};
function dp(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
const states = {};
const missing = [];
for (const g of topo.objects.states.geometries) {
  const code = NAMES[g.properties.name];
  if (!code) {
    missing.push(g.properties.name);
    continue;
  }
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  const rings = [];
  for (const poly of polys) {
    for (const r of poly) {
      const raw = ringOf(r);
      // Closed ring: split at the point farthest from the start so
      // Douglas–Peucker has a real baseline on each half.
      let far = 0;
      let fd = -1;
      raw.forEach(([x, y], i) => {
        const d = Math.hypot(x - raw[0][0], y - raw[0][1]);
        if (d > fd) {
          fd = d;
          far = i;
        }
      });
      const pts = [...dp(raw.slice(0, far + 1), TOL), ...dp(raw.slice(far), TOL).slice(1)];
      if (pts.length < 4) continue; // tiny island below tolerance
      const flat = [];
      for (const [x, y] of pts) flat.push(Math.round(x * 100), Math.round(y * 100));
      rings.push(flat);
    }
  }
  states[code] = rings;
}
const out = {
  v: 1,
  source: 'us-atlas 3.0.1 states-10m (ISC), from U.S. Census Bureau cartographic boundaries; simplified ' + TOL + '°',
  scale: 100,
  states,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('bytes', fs.statSync(OUT).size, 'states', Object.keys(states).length, 'missing', missing);

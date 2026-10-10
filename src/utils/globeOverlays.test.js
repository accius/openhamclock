import { describe, it, expect } from 'vitest';
import {
  lonToX,
  latToY,
  normLon,
  fieldLabel,
  squareLabel,
  drapCmap,
  auroraCmap,
  paintMaidenhead,
  paintZones,
  paintDrap,
  paintAurora,
  paintWorkedGrids,
  normalizeGrid4,
  gridToRect,
  workedGridCounts,
  workedGridsBucket,
  GLOBE_OVERLAY_PAINTERS,
  GLOBE_OVERLAY_LAYER_IDS,
  ZONE_SOURCES,
  decimateAircraft,
} from './globeOverlays.js';

// Mock 2D context that records every draw call (and style assignment) in
// order, so painter output can be asserted without a real canvas.
function mockCtx() {
  const calls = [];
  const ctx = { calls };
  for (const m of [
    'save',
    'restore',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'fill',
    'fillRect',
    'clearRect',
    'fillText',
    'arc',
    'closePath',
    'translate',
    'rotate',
    'setLineDash',
    'drawImage',
  ]) {
    ctx[m] = (...args) => calls.push([m, ...args]);
  }
  for (const p of [
    'strokeStyle',
    'fillStyle',
    'globalAlpha',
    'lineWidth',
    'font',
    'textAlign',
    'textBaseline',
    'shadowColor',
    'shadowBlur',
  ]) {
    Object.defineProperty(ctx, p, {
      set(v) {
        calls.push([`set:${p}`, v]);
      },
    });
  }
  return ctx;
}

const of = (ctx, name) => ctx.calls.filter((c) => c[0] === name);

describe('equirectangular projection helpers', () => {
  it('maps longitude to x across the full canvas width', () => {
    expect(lonToX(-180, 2048)).toBe(0);
    expect(lonToX(0, 2048)).toBe(1024);
    expect(lonToX(180, 2048)).toBe(2048);
    expect(lonToX(90, 360)).toBe(270);
  });

  it('maps latitude to y with north at the top', () => {
    expect(latToY(90, 1024)).toBe(0);
    expect(latToY(0, 1024)).toBe(512);
    expect(latToY(-90, 1024)).toBe(1024);
    expect(latToY(45, 180)).toBe(45);
  });

  it('normalizes world-wrapped longitudes into [-180, 180)', () => {
    expect(normLon(210)).toBe(-150);
    expect(normLon(-190)).toBe(170);
    expect(normLon(180)).toBe(-180);
    expect(normLon(0)).toBe(0);
  });
});

describe('Maidenhead helpers', () => {
  it('produces the field for a known locator (San Diego = DM)', () => {
    expect(fieldLabel(32.9, -117.1)).toBe('DM');
    expect(squareLabel(32.9, -117.1)).toBe('DM12');
  });

  it('handles the equator / prime meridian cell (JJ)', () => {
    expect(fieldLabel(0, 0)).toBe('JJ');
    expect(squareLabel(0, 0)).toBe('JJ00');
  });

  it('rejects out-of-range latitudes', () => {
    expect(fieldLabel(95, 0)).toBeNull();
  });
});

describe('paintMaidenhead', () => {
  it('draws every field line and a label per field', () => {
    const ctx = mockCtx();
    paintMaidenhead(ctx, { width: 360, height: 180, opacity: 0.5 });
    // 19 meridians + 19 parallels, one moveTo+lineTo pair each.
    expect(of(ctx, 'moveTo')).toHaveLength(38);
    expect(of(ctx, 'lineTo')).toHaveLength(38);
    expect(of(ctx, 'stroke')).toHaveLength(1);
    // 18 × 18 field labels.
    expect(of(ctx, 'fillText')).toHaveLength(324);
  });

  it('places grid lines and labels at projected lat/lon positions', () => {
    const ctx = mockCtx();
    paintMaidenhead(ctx, { width: 360, height: 180, opacity: 0.5 });
    // Meridian at lon 0 → x=180; parallel at lat 0 → y=90.
    expect(ctx.calls).toContainEqual(['moveTo', 180, 0]);
    expect(ctx.calls).toContainEqual(['moveTo', 0, 90]);
    // JJ field (lat 0..10, lon 0..20) labeled at its center (lon 10, lat 5).
    expect(ctx.calls).toContainEqual(['fillText', 'JJ', lonToX(10, 360), latToY(5, 180)]);
    // AA field (lat -90..-80, lon -180..-160) at (lon -170, lat -85).
    expect(ctx.calls).toContainEqual(['fillText', 'AA', lonToX(-170, 360), latToY(-85, 180)]);
  });
});

describe('drapCmap', () => {
  it('is transparent below 1 MHz', () => {
    expect(drapCmap(0)).toBeNull();
    expect(drapCmap(0.9)).toBeNull();
    expect(drapCmap(undefined)).toBeNull();
  });

  it('saturates to dark red at 30+ MHz', () => {
    expect(drapCmap(30)).toEqual({ r: 180, g: 0, b: 40, a: 1 });
    expect(drapCmap(99)).toEqual(drapCmap(30));
  });

  it('ramps alpha upward with frequency', () => {
    expect(drapCmap(2).a).toBeLessThan(drapCmap(10).a);
    expect(drapCmap(10).a).toBeLessThan(drapCmap(25).a);
  });
});

describe('paintDrap', () => {
  const grid = {
    lats: [45, -45],
    lons: [-90, 90],
    freqs: [
      [30, 0],
      [0, 15],
    ],
  };

  it('paints nothing without data', () => {
    const ctx = mockCtx();
    paintDrap(ctx, { width: 360, height: 180, opacity: 1, data: null });
    paintDrap(ctx, { width: 360, height: 180, opacity: 1, data: {} });
    paintDrap(ctx, { width: 360, height: 180, opacity: 1, data: { lats: [], lons: [], freqs: [] } });
    expect(ctx.calls).toHaveLength(0);
  });

  it('maps grid cells to rects centered on their lat/lon', () => {
    const ctx = mockCtx();
    paintDrap(ctx, { width: 360, height: 180, opacity: 1, data: grid });
    const rects = of(ctx, 'fillRect');
    // Only the two non-transparent cells are drawn. 2×2 grid → 180×90 cells.
    expect(rects).toHaveLength(2);
    // (lat 45, lon -90) center → (90, 45); cell top-left = (0, 0).
    expect(rects[0]).toEqual(['fillRect', 0, 0, 180.5, 90.5]);
    // (lat -45, lon 90) center → (270, 135); cell top-left = (180, 90).
    expect(rects[1]).toEqual(['fillRect', 180, 90, 180.5, 90.5]);
  });

  it('applies the shared color ramp scaled by layer opacity', () => {
    const ctx = mockCtx();
    paintDrap(ctx, { width: 360, height: 180, opacity: 0.5, data: grid });
    const fills = of(ctx, 'set:fillStyle');
    expect(fills[0][1]).toBe('rgba(180,0,40,0.5)'); // 30 MHz cell at half opacity
    expect(fills[1][1]).toBe(`rgba(255,140,0,${0.65 * 0.5})`); // 15 MHz cell
  });

  it('wraps cells that spill across the antimeridian', () => {
    const ctx = mockCtx();
    paintDrap(ctx, {
      width: 360,
      height: 180,
      opacity: 1,
      data: { lats: [0], lons: [-180], freqs: [[30]] },
    });
    const rects = of(ctx, 'fillRect');
    // One cell spans the whole world here (1×1 grid) but its center at
    // lon -180 puts its left half off-canvas — a wrapped copy is drawn.
    expect(rects).toHaveLength(2);
    expect(rects[0][1]).toBeLessThan(0);
    expect(rects[1][1]).toBe(rects[0][1] + 360);
  });
});

describe('auroraCmap', () => {
  it('is transparent below 4% probability', () => {
    expect(auroraCmap(0)).toBeNull();
    expect(auroraCmap(3.9)).toBeNull();
  });

  it('saturates to red at 84%+', () => {
    expect(auroraCmap(100)).toEqual({ r: 255, g: 0, b: 30, a: 1 });
  });

  it('starts green at low probability', () => {
    const c = auroraCmap(4);
    expect(c.r).toBe(0);
    expect(c.g).toBeGreaterThan(0);
  });
});

describe('paintAurora', () => {
  it('paints nothing without data', () => {
    const ctx = mockCtx();
    paintAurora(ctx, { width: 360, height: 181, opacity: 1, data: null });
    paintAurora(ctx, { width: 360, height: 181, opacity: 1, data: [] });
    expect(ctx.calls).toHaveLength(0);
  });

  it('maps NOAA 0-359 longitudes onto the -180-centered canvas', () => {
    const ctx = mockCtx();
    // Height 181 → 1 px per 1° cell, so positions come out integral.
    paintAurora(ctx, {
      width: 360,
      height: 181,
      opacity: 1,
      data: [
        [210, 65, 100], // lon 210 → -150 → x=30; lat 65 → row 25
        [0, -90, 2], // below threshold — skipped
      ],
    });
    const rects = of(ctx, 'fillRect');
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual(['fillRect', 30, 25, 1.5, 1.5]);
    expect(of(ctx, 'set:fillStyle')[0][1]).toBe('rgba(255,0,30,1)');
  });
});

describe('paintZones', () => {
  const geojson = {
    features: [
      {
        properties: { cq_zone_number: 5, cq_zone_name_loc: [20, 150] },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [170, 10],
              [-170, 10], // crosses the antimeridian
              [-170, -10],
            ],
          ],
        },
      },
    ],
  };

  it('paints nothing without data', () => {
    const ctx = mockCtx();
    paintZones(ctx, { width: 360, height: 180, opacity: 1, data: null });
    paintZones(ctx, { width: 360, height: 180, opacity: 1, data: { geojson: { features: [] } } });
    expect(ctx.calls).toHaveLength(0);
  });

  it('strokes boundaries, breaking the path at the antimeridian', () => {
    const ctx = mockCtx();
    paintZones(ctx, { width: 360, height: 180, opacity: 1, data: { geojson, color: '#e6a23c' } });
    // First point starts the path; the ±170 jump forces a second moveTo.
    expect(of(ctx, 'moveTo')).toEqual([
      ['moveTo', lonToX(170, 360), latToY(10, 180)],
      ['moveTo', lonToX(-170, 360), latToY(10, 180)],
    ]);
    expect(of(ctx, 'lineTo')).toEqual([['lineTo', lonToX(-170, 360), latToY(-10, 180)]]);
    expect(of(ctx, 'stroke')).toHaveLength(1);
  });

  it('labels the zone number at its label point ([lat, lon] order)', () => {
    const ctx = mockCtx();
    paintZones(ctx, { width: 360, height: 180, opacity: 1, data: { geojson, color: '#e6a23c' } });
    expect(ctx.calls).toContainEqual(['fillText', '5', lonToX(150, 360), latToY(20, 180)]);
  });

  it('uses the zone-set color for strokes and labels', () => {
    const ctx = mockCtx();
    paintZones(ctx, { width: 360, height: 180, opacity: 1, data: { geojson, color: ZONE_SOURCES.itu.color } });
    expect(of(ctx, 'set:strokeStyle')[0][1]).toBe('#4fc3f7');
    expect(of(ctx, 'set:fillStyle')[0][1]).toBe('#4fc3f7');
  });
});

describe('worked grids helpers', () => {
  it('normalizes gridsquares to valid 4-char squares', () => {
    expect(normalizeGrid4('EN34')).toBe('EN34');
    expect(normalizeGrid4('en34ab')).toBe('EN34'); // 6-char, lowercase
    expect(normalizeGrid4(' dm12 ')).toBe('DM12'); // whitespace
    expect(normalizeGrid4('ZZ99')).toBeNull(); // field letters stop at R
    expect(normalizeGrid4('E1')).toBeNull(); // too short / malformed
    expect(normalizeGrid4('1234')).toBeNull();
    expect(normalizeGrid4('')).toBeNull();
    expect(normalizeGrid4(null)).toBeNull();
    expect(normalizeGrid4(1234)).toBeNull();
  });

  it('maps squares to their SW corner (2° × 1° cells)', () => {
    expect(gridToRect('JJ00')).toEqual({ south: 0, west: 0 });
    expect(gridToRect('AA00')).toEqual({ south: -90, west: -180 });
    expect(gridToRect('RR99')).toEqual({ south: 89, west: 178 });
    expect(gridToRect('en34xx')).toEqual({ south: 44, west: -94 });
    expect(gridToRect('bogus')).toBeNull();
  });

  it('counts QSOs per square, dropping invalid or missing grids', () => {
    const counts = workedGridCounts([
      { gridsquare: 'EN34' },
      { gridsquare: 'en34ab' }, // same square after normalization
      { gridsquare: 'DM12' },
      { gridsquare: 'not-a-grid' },
      { gridsquare: '' },
      {},
      null,
    ]);
    expect(counts).toEqual({ EN34: 2, DM12: 1 });
    expect(workedGridCounts(null)).toEqual({});
  });

  it('filters by band, falling back to freq when the band tag is missing', () => {
    const qsos = [
      { gridsquare: 'EN34', band: '20M' }, // tag case-insensitive
      { gridsquare: 'EN34', freq: 14.074 }, // no tag → bandFromFreq → 20m
      { gridsquare: 'DM12', band: '40m' },
      { gridsquare: 'FN31' }, // no band, no freq → dropped by filter
    ];
    expect(workedGridCounts(qsos, '20m')).toEqual({ EN34: 2 });
    expect(workedGridCounts(qsos, '40m')).toEqual({ DM12: 1 });
    expect(workedGridCounts(qsos)).toEqual({ EN34: 2, DM12: 1, FN31: 1 });
  });

  it('buckets counts as 1 / 2-4 / 5+ with rising alpha', () => {
    expect(workedGridsBucket(0)).toBeNull();
    expect(workedGridsBucket(undefined)).toBeNull();
    const one = workedGridsBucket(1);
    const few = workedGridsBucket(2);
    const many = workedGridsBucket(5);
    expect(workedGridsBucket(4)).toEqual(few);
    expect(workedGridsBucket(100)).toEqual(many);
    expect(one.a).toBeLessThan(few.a);
    expect(few.a).toBeLessThan(many.a);
    // Same hue in every bucket — only alpha steps.
    expect([few.r, few.g, few.b]).toEqual([one.r, one.g, one.b]);
    expect([many.r, many.g, many.b]).toEqual([one.r, one.g, one.b]);
  });
});

describe('paintWorkedGrids', () => {
  it('paints nothing without data', () => {
    const ctx = mockCtx();
    paintWorkedGrids(ctx, { width: 360, height: 180, opacity: 1, data: null });
    paintWorkedGrids(ctx, { width: 360, height: 180, opacity: 1, data: {} });
    expect(ctx.calls).toHaveLength(0);
  });

  it('fills each worked square at its projected cell', () => {
    const ctx = mockCtx();
    paintWorkedGrids(ctx, { width: 360, height: 180, opacity: 1, data: { EN34: 1, JJ00: 1 } });
    const rects = of(ctx, 'fillRect');
    expect(rects).toHaveLength(2);
    // EN34 SW corner = (44, -94) → NW corner (45, -94) → x=86, y=45; 2°×1° cell.
    expect(rects).toContainEqual(['fillRect', 86, 45, 2, 1]);
    // JJ00 SW corner = (0, 0) → NW (1, 0) → x=180, y=89.
    expect(rects).toContainEqual(['fillRect', 180, 89, 2, 1]);
  });

  it('applies bucket colors scaled by layer opacity', () => {
    const ctx = mockCtx();
    paintWorkedGrids(ctx, { width: 360, height: 180, opacity: 0.5, data: { EN34: 1, DM12: 3, FN31: 7 } });
    const fills = of(ctx, 'set:fillStyle').map((c) => c[1]);
    expect(fills).toContain(`rgba(46,204,113,${0.25 * 0.5})`); // 1 QSO
    expect(fills).toContain(`rgba(46,204,113,${0.42 * 0.5})`); // 2-4 QSOs
    expect(fills).toContain(`rgba(46,204,113,${0.6 * 0.5})`); // 5+ QSOs
  });

  it('skips invalid grid keys instead of throwing', () => {
    const ctx = mockCtx();
    paintWorkedGrids(ctx, { width: 360, height: 180, opacity: 1, data: { nope: 3, EN34: 1 } });
    expect(of(ctx, 'fillRect')).toHaveLength(1);
  });
});

describe('painter registry', () => {
  it('registers every globe-capable layer under its plugin id, rasters first', () => {
    expect(GLOBE_OVERLAY_LAYER_IDS).toEqual([
      'wxradar',
      'drap',
      'aurora',
      'worked-grids',
      'maidenhead',
      'zones',
      'atc-sectors',
      'tornado-warnings',
      'earthquakes',
      'wildfires',
      'floods',
      'history-playback',
      'lightning',
      // aircraft and logbook-qsos have no painter — Globe3D renders them
      // natively — but the ids must stay in the list for state plumbing +
      // suppression note
      'aircraft',
      'logbook-qsos',
    ]);
    for (const id of Object.keys(GLOBE_OVERLAY_PAINTERS)) {
      expect(typeof GLOBE_OVERLAY_PAINTERS[id]).toBe('function');
    }
    expect(GLOBE_OVERLAY_PAINTERS.aircraft).toBeUndefined();
    expect(GLOBE_OVERLAY_PAINTERS['logbook-qsos']).toBeUndefined();
  });

  it('registered painters are the exported ones', () => {
    expect(GLOBE_OVERLAY_PAINTERS.maidenhead).toBe(paintMaidenhead);
    expect(GLOBE_OVERLAY_PAINTERS.zones).toBe(paintZones);
    expect(GLOBE_OVERLAY_PAINTERS.drap).toBe(paintDrap);
    expect(GLOBE_OVERLAY_PAINTERS.aurora).toBe(paintAurora);
    expect(GLOBE_OVERLAY_PAINTERS['worked-grids']).toBe(paintWorkedGrids);
  });
});

describe('new painters (globe parity batch)', () => {
  const W = 2048;
  const H = 1024;
  const {
    wxradar: paintWxRadar,
    lightning: paintLightning,
    earthquakes: paintEarthquakes,
    wildfires: paintWildfires,
    floods: paintFloods,
    'tornado-warnings': paintTornadoWarnings,
    'atc-sectors': paintATCSectors,
  } = GLOBE_OVERLAY_PAINTERS;

  it('all paint nothing without data (the shared contract)', () => {
    for (const painter of [
      paintWxRadar,
      paintLightning,
      paintEarthquakes,
      paintWildfires,
      paintFloods,
      paintTornadoWarnings,
      paintATCSectors,
    ]) {
      const ctx = mockCtx();
      painter(ctx, { width: W, height: H, opacity: 0.8, data: null });
      expect(ctx.calls.filter((c) => !['save', 'restore'].includes(c[0]))).toEqual([]);
    }
  });

  it('wxradar draws the pre-fetched image full-canvas at layer opacity', () => {
    const ctx = mockCtx();
    const img = { width: 2048, height: 1024 };
    paintWxRadar(ctx, { width: W, height: H, opacity: 0.6, data: img });
    expect(of(ctx, 'drawImage')[0]).toEqual(['drawImage', img, 0, 0, W, H]);
    expect(of(ctx, 'set:globalAlpha')[0][1]).toBe(0.6);
  });

  it('lightning ages strikes white → yellow → fading, drops >30 min', () => {
    const now = Date.now();
    const ctx = mockCtx();
    paintLightning(ctx, {
      width: W,
      height: H,
      opacity: 1,
      data: [
        { lat: 0, lon: 0, timestamp: now - 30_000 }, // fresh → white
        { lat: 10, lon: 10, timestamp: now - 5 * 60_000 }, // → yellow
        { lat: 20, lon: 20, timestamp: now - 60 * 60_000 }, // too old → dropped
      ],
    });
    const fills = of(ctx, 'set:fillStyle').map((c) => c[1]);
    expect(fills).toHaveLength(2);
    expect(fills[0]).toContain('255,255,255');
    expect(fills[1]).toContain('255,221,64');
    expect(of(ctx, 'arc')).toHaveLength(2);
  });

  it('earthquakes scale ring radius with magnitude and go red at M5+', () => {
    const ctx = mockCtx();
    paintEarthquakes(ctx, {
      width: W,
      height: H,
      opacity: 1,
      data: [
        { geometry: { coordinates: [0, 0, 10] }, properties: { mag: 2 } },
        { geometry: { coordinates: [10, 10, 10] }, properties: { mag: 6 } },
      ],
    });
    const arcs = of(ctx, 'arc');
    expect(arcs).toHaveLength(2);
    expect(arcs[1][3]).toBeGreaterThan(arcs[0][3]); // bigger mag → bigger ring
    const strokes = of(ctx, 'set:strokeStyle').map((c) => c[1]);
    expect(strokes[1]).toContain('255,68,68');
  });

  it('EONET painters use the LAST geometry entry (current position)', () => {
    const ctx = mockCtx();
    paintWildfires(ctx, {
      width: W,
      height: H,
      opacity: 1,
      data: [{ geometry: [{ coordinates: [0, 0] }, { coordinates: [90, 45] }] }],
    });
    // glow arc + core arc, both at the projected position of [90, 45]
    const arcs = of(ctx, 'arc');
    expect(arcs).toHaveLength(2);
    expect(arcs[0][1]).toBeCloseTo(((90 + 180) / 360) * W, 0);
    expect(arcs[0][2]).toBeCloseTo(((90 - 45) / 180) * H, 0);

    const ctx2 = mockCtx();
    paintFloods(ctx2, { width: W, height: H, opacity: 1, data: [{ geometry: [{ coordinates: [10, -20] }] }] });
    expect(of(ctx2, 'arc')).toHaveLength(2);
  });

  it('tornado warnings fill AND stroke each polygon', () => {
    const ctx = mockCtx();
    paintTornadoWarnings(ctx, {
      width: W,
      height: H,
      opacity: 1,
      data: [
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-97, 35],
                [-96, 35],
                [-96, 36],
                [-97, 35],
              ],
            ],
          },
        },
      ],
    });
    expect(of(ctx, 'fill')).toHaveLength(1);
    expect(of(ctx, 'stroke')).toHaveLength(1);
    expect(of(ctx, 'closePath')).toHaveLength(1);
  });

  it('decimateAircraft keeps one plane per cell (highest altitude) and skips null positions', () => {
    const out = decimateAircraft(
      [
        { lat: 40, lon: -100, alt_ft: 10000 }, // same cell, lower
        { lat: 40.01, lon: -100.01, alt_ft: 38000 }, // same cell, higher — kept
        { lat: -30, lon: 140, alt_ft: 30000 }, // far away — kept
        { lat: null, lon: 5 }, // no position — dropped
      ],
      1,
    );
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.lat === 40.01).alt_ft).toBe(38000);
    expect(decimateAircraft(null)).toEqual([]);
  });

  it('ATC sectors dash oceanic boundaries and stroke the rest solid', () => {
    const ctx = mockCtx();
    const square = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
      ],
    };
    paintATCSectors(ctx, {
      width: W,
      height: H,
      opacity: 1,
      data: {
        sectors: [
          { geometry: square, oceanic: false },
          { geometry: square, oceanic: true },
        ],
      },
    });
    const dashes = of(ctx, 'setLineDash').map((c) => c[1]);
    expect(dashes).toEqual([[], [6, 5]]);
    expect(of(ctx, 'stroke')).toHaveLength(2);
  });
});

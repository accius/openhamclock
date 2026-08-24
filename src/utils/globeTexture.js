/**
 * Globe Texture Builder
 * Fetches Web Mercator raster tiles and composites them into an
 * equirectangular (plate carrée) canvas suitable for wrapping a sphere.
 *
 * three.js SphereGeometry maps texture V linearly to latitude, so Mercator
 * tiles cannot be applied directly — every row has to be remapped first.
 * tileReproject.js does the equivalent remap per-pixel while sampling for the
 * azimuthal canvas; here we bake it once into a texture the GPU can reuse.
 */

const DEG = Math.PI / 180;
const MAX_MERCATOR_LAT = 85.0511287798066;

// Widest horizontal blur applied inside a polar cap, as a fraction of texture
// width — reached at the pole, zero at the boundary. 1/64 is about 5.6° of
// longitude at the equator, which is enough to erase the repeated row's fine
// detail while keeping its broad light and dark areas.
const CAP_BLUR_MAX_FRACTION = 1 / 64;
const MAX_CONCURRENT = 6;

const subdomains = ['a', 'b', 'c'];
let subIdx = 0;

function resolveTileUrl(template, z, x, y, lang) {
  const s = subdomains[subIdx++ % subdomains.length];
  return template
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{s}', s)
    .replace('{r}', '')
    .replace('{lang}', lang || 'en');
}

// Mercator pixel Y for a given latitude, on a dim×dim world mosaic.
function latToMercatorY(lat, dim) {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const mercN = Math.log(Math.tan(Math.PI / 4 + (clamped * DEG) / 2));
  return dim / 2 - (dim * mercN) / (2 * Math.PI);
}

function loadTile(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous'; // required, or the canvas taints and WebGL upload fails

    // Checking the signal only up front would let every in-flight download run
    // to completion after an abort, competing with the next style's burst.
    const onAbort = () => {
      img.onload = null;
      img.onerror = null;
      img.src = ''; // cancels the in-flight request in every major browser
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    img.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`tile failed: ${url}`));
    };
    img.src = url;
  });
}

/**
 * Build an equirectangular texture canvas from a Leaflet-style tile template.
 *
 * @param {object}   opts
 * @param {string}   opts.tileUrlTemplate - Leaflet URL template ({z}/{x}/{y})
 * @param {object}   [opts.polar]         - { north, south } ArcGIS MapServer URLs for
 *                                        real polar imagery; omit for sources that
 *                                        publish Mercator only
 * @param {number}   [opts.tileZoom=3]    - Zoom level; 2^z × 2^z tiles are fetched
 * @param {string}   [opts.lang]          - Language for {lang} templates
 * @param {Function} [opts.onProgress]    - Called with 0..1 as tiles land
 * @param {AbortSignal} [opts.signal]     - Cancels in-flight work
 * @returns {Promise<HTMLCanvasElement>}  - 2:1 equirectangular canvas
 */
export async function buildGlobeTexture({ tileUrlTemplate, tileZoom = 3, lang, baseColor, polar, onProgress, signal }) {
  const numTiles = Math.pow(2, tileZoom);
  const dim = numTiles * 256;

  // Stage 1 — composite the raw Mercator mosaic.
  const merc = document.createElement('canvas');
  merc.width = dim;
  merc.height = dim;
  const mctx = merc.getContext('2d');

  // Backdrop for failed tiles, and for styles whose tiles are a transparent
  // overlay (e.g. Countries) rather than a full basemap — those would otherwise
  // be nothing but holes.
  mctx.fillStyle = baseColor || '#0b1a2b';
  mctx.fillRect(0, 0, dim, dim);

  const queue = [];
  for (let ty = 0; ty < numTiles; ty++) {
    for (let tx = 0; tx < numTiles; tx++) {
      queue.push({ tx, ty });
    }
  }

  let loaded = 0;
  const total = queue.length;
  let next = 0;

  // Firing all 64-256 tile requests at once gets us rate-limited (HTTP 429) by
  // the tile providers, and a throttled tile is a hole in the texture. Match
  // the concurrency tileReproject.js settled on.
  async function worker() {
    while (next < queue.length) {
      if (signal?.aborted) return;
      const { tx, ty } = queue[next++];
      const url = resolveTileUrl(tileUrlTemplate, tileZoom, tx, ty, lang);
      try {
        const img = await loadTile(url, signal);
        if (!signal?.aborted) mctx.drawImage(img, tx * 256, ty * 256, 256, 256);
      } catch {
        // Missing tile — the base fill already covers it. An abort, though,
        // means a newer run owns the progress bar now: reporting here would
        // overwrite its 0% and make the bar jump backwards.
        if (signal?.aborted) return;
      }
      loaded++;
      if (onProgress) onProgress(loaded / total);
    }
  }

  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
  if (signal?.aborted) throw new Error('aborted');

  // Stage 2 — remap Mercator rows to equirectangular.
  const outW = dim;
  const outH = dim / 2; // equirectangular is always 2:1
  const eq = document.createElement('canvas');
  eq.width = outW;
  eq.height = outH;
  const ectx = eq.getContext('2d');

  for (let y = 0; y < outH; y++) {
    const lat = 90 - ((y + 0.5) / outH) * 180;
    // Beyond ±85.05° Mercator has no data, so clamping repeats the last real
    // row across the cap. resolvePolarCaps() below then fades those repeats out
    // — on a sphere every column of a row converges to the pole, so a repeated
    // row of coastline becomes a pinwheel of wedges.
    const srcY = Math.max(0, Math.min(dim - 1, Math.floor(latToMercatorY(lat, dim))));
    ectx.drawImage(merc, 0, srcY, dim, 1, 0, y, outW, 1);
  }

  // Real imagery first where a polar-projected source exists, then the cosmetic
  // fallback for whatever it does not reach.
  const capRows = Math.floor(((90 - MAX_MERCATOR_LAT) / 180) * outH);
  const holeRows = await drawPolarImagery(ectx, outW, outH, capRows, polar, signal);
  resolvePolarCaps(ectx, outW, outH, holeRows);

  return { canvas: eq, meanLuma: measureMeanLuma(eq) };
}

/**
 * Average colour of one pixel row, as [r, g, b].
 */
function averageRow(ctx, width, y) {
  const { data } = ctx.getImageData(0, y, width, 1);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = data.length / 4;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * One polar cap as a plate-carrée strip, fetched from a polar-projected service.
 *
 * Web Mercator has no data past ±85.05°, but the same imagery exists in polar
 * projections. Rather than reprojecting here, the ArcGIS export endpoint is
 * asked for the strip already in EPSG:4326 (imageSR=4326) — the projection this
 * texture is in — so the result drops straight into the cap rows.
 *
 * Returns null rather than throwing: real polar imagery is an improvement on the
 * fallback, never a requirement for building a texture.
 */
async function fetchPolarStrip(serviceUrl, hemisphere, width, rows, signal) {
  if (!serviceUrl || rows < 1) return null;

  const bbox = hemisphere === 'north' ? `-180,${MAX_MERCATOR_LAT},180,90` : `-180,-90,180,${-MAX_MERCATOR_LAT}`;

  // png32 keeps an alpha channel, which is how the no-data hole over the pole
  // itself is told apart from genuinely dark ocean.
  const url =
    `${serviceUrl}/export?bbox=${bbox}&bboxSR=4326&imageSR=4326` +
    `&size=${width},${rows}&format=png32&transparent=true&f=image`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    return bitmap;
  } catch {
    return null;
  }
}

/**
 * Prepare one fetched polar strip for compositing.
 *
 * Two things have to happen before it touches the texture, both because the
 * strip is not fully opaque:
 *
 *  - The services leave a transparent sliver either side of ±180, about 11px of
 *    4096, and a hole over the pole itself. Drawing as-is lets the repeated
 *    Mercator row show through those gaps.
 *  - The colour match must be applied here, to the strip's own pixels. Applied
 *    to the texture afterwards it also scales whatever showed through the gaps,
 *    and the gain that lifts this dark imagery to match World Imagery turned
 *    those leftovers bright green.
 *
 * Returns the prepared canvas and how many rows at the pole carry no data.
 */
function preparePolarStrip(bitmap, hemisphere, target) {
  const w = bitmap.width;
  const h = bitmap.height;
  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bitmap, 0, 0);

  const img = sctx.getImageData(0, 0, w, h);
  const d = img.data;
  const alphaAt = (x, y) => d[(y * w + x) * 4 + 3];

  // Close the antimeridian sliver by interpolating between the last valid
  // column each side. The gap spans ±180, so the two edges are neighbours once
  // the texture wraps and the join is invisible.
  for (let y = 0; y < h; y++) {
    let left = 0;
    while (left < w && alphaAt(left, y) < 128) left++;
    if (left >= w) continue; // whole row is hole; the fallback covers it
    let right = w - 1;
    while (right > left && alphaAt(right, y) < 128) right--;

    const a = right * 1 * 4 + y * w * 4;
    const b = left * 4 + y * w * 4;
    const gapLeft = left;
    const gapRight = w - 1 - right;
    const total = gapLeft + gapRight;
    if (total === 0 || total > w / 8) continue; // nothing to do, or not an edge sliver

    for (let i = 0; i < total; i++) {
      // Walk across the wrapped gap: right edge first, then the left edge.
      const x = i < gapRight ? right + 1 + i : i - gapRight;
      const t = (i + 1) / (total + 1);
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        d[o + ch] = d[a + ch] * (1 - t) + d[b + ch] * t;
      }
      d[o + 3] = 255;
    }
  }

  // Rows with no data at the pole, counted from the polar end.
  const order = hemisphere === 'north' ? [...Array(h).keys()] : [...Array(h).keys()].reverse();
  let hole = 0;
  for (const y of order) {
    let opaque = 0;
    for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= 128) opaque++;
    if (opaque < w * 0.5) hole++;
    else break;
  }

  // Colour match, measured over real pixels only, on the row nearest the
  // Mercator boundary — the one that has to meet it without a step.
  const seamRow = hemisphere === 'north' ? h - 1 : 0;
  if (target) {
    let n = 0;
    const sum = [0, 0, 0];
    for (let x = 0; x < w; x++) {
      const o = (seamRow * w + x) * 4;
      if (d[o + 3] < 128) continue;
      sum[0] += d[o];
      sum[1] += d[o + 1];
      sum[2] += d[o + 2];
      n++;
    }
    if (n > 0) {
      const gain = sum.map((v, i) => {
        const mean = v / n;
        if (mean < 4) return 1; // near-black: a ratio here is meaningless
        // Wide enough to actually reach: Arctic imagery runs about half the
        // brightness of World Imagery at the same latitude.
        return Math.max(0.4, Math.min(3, target[i] / mean));
      });
      if (!gain.every((g) => Math.abs(g - 1) < 0.02)) {
        for (let i = 0; i < d.length; i += 4) {
          d[i] *= gain[0];
          d[i + 1] *= gain[1];
          d[i + 2] *= gain[2];
        }
      }
    }
  }

  // Ease the strip in across a few rows at the boundary. Matching the mean gets
  // the level right, but any residual difference still reads as a ring on a
  // sphere; ramping the strip's own alpha lets it emerge from the Mercator
  // imagery instead of starting at full strength on one row.
  const blendRows = Math.max(2, Math.round(h * 0.15));
  for (let i = 0; i < blendRows; i++) {
    const y = hemisphere === 'north' ? h - 1 - i : i;
    if (y < 0 || y >= h) break;
    const t = (i + 1) / (blendRows + 1);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      d[o + 3] = Math.round(d[o + 3] * t);
    }
  }

  sctx.putImageData(img, 0, 0);
  return { canvas: scratch, hole };
}

/**
 * Paint real polar imagery over the repeated Mercator rows.
 *
 * Returns how many rows at each pole still carry no data, so the cosmetic
 * fallback only has to cover what is left — typically the half-degree hole
 * these services leave over the pole itself.
 */
async function drawPolarImagery(ctx, width, height, capRows, polar, signal) {
  const reach = { north: null, south: null };
  if (!polar || capRows < 1) return reach;

  const [north, south] = await Promise.all([
    fetchPolarStrip(polar.north, 'north', Math.min(width, 4096), capRows, signal),
    fetchPolarStrip(polar.south, 'south', Math.min(width, 4096), capRows, signal),
  ]);

  if (north) {
    // Target is the last real Mercator row, just below the cap.
    const prepared = preparePolarStrip(north, 'north', averageRow(ctx, width, capRows));
    ctx.drawImage(prepared.canvas, 0, 0, prepared.canvas.width, prepared.canvas.height, 0, 0, width, capRows);
    reach.north = prepared.hole;
    north.close?.();
  }
  if (south) {
    const prepared = preparePolarStrip(south, 'south', averageRow(ctx, width, height - 1 - capRows));
    ctx.drawImage(
      prepared.canvas,
      0,
      0,
      prepared.canvas.width,
      prepared.canvas.height,
      0,
      height - capRows,
      width,
      capRows,
    );
    reach.south = prepared.hole;
    south.close?.();
  }

  return reach;
}

/**
 * Horizontal box blur across the rows of one polar cap.
 *
 * The stripes are horizontal variation inside a single repeated row, so only a
 * horizontal blur touches them — blurring vertically does nothing when every
 * row in the cap is a copy of the same one. The radius grows from zero at the
 * boundary, so the cap still meets the real imagery without a step, to
 * CAP_BLUR_MAX_FRACTION of the width at the pole.
 *
 * The window wraps at the antimeridian. A canvas blur filter would not, and
 * would replace the pinwheel with a seam down the 180th meridian where the
 * texture joins.
 */
function blurCapRows(ctx, width, height, edge, dir, rows) {
  const maxRadius = Math.max(1, Math.round(width * CAP_BLUR_MAX_FRACTION));

  // The whole cap is read and written once. Doing it row by row costs one GPU
  // readback per row — 112 of them for a retina texture, which is most of the
  // time this function takes and is felt on slower hardware.
  const blockTop = dir < 0 ? Math.max(0, edge - capRows) : Math.min(height - 1, edge + 1);
  const blockRows = Math.min(rows, dir < 0 ? edge : height - 1 - edge);
  if (blockRows < 1) return;

  const img = ctx.getImageData(0, blockTop, width, blockRows);
  const src = img.data;
  const out = new Uint8ClampedArray(src);

  for (let i = 1; i <= blockRows; i++) {
    const y = edge + dir * i;
    const row = y - blockTop;
    if (row < 0 || row >= blockRows) continue;

    const radius = Math.round((i / rows) * maxRadius);
    if (radius < 1) continue;

    const base = row * width * 4;
    const span = radius * 2 + 1;
    const wrap = (x) => base + (((x % width) + width) % width) * 4;

    // Running sum over a wrapped window, so cost per row is O(width) rather
    // than O(width * radius).
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let k = -radius; k <= radius; k++) {
      const q = wrap(k);
      sr += src[q];
      sg += src[q + 1];
      sb += src[q + 2];
    }

    for (let x = 0; x < width; x++) {
      const o = base + x * 4;
      out[o] = sr / span;
      out[o + 1] = sg / span;
      out[o + 2] = sb / span;

      const leaving = wrap(x - radius);
      const entering = wrap(x + radius + 1);
      sr += src[entering] - src[leaving];
      sg += src[entering + 1] - src[leaving + 1];
      sb += src[entering + 2] - src[leaving + 2];
    }
  }

  img.data.set(out);
  ctx.putImageData(img, 0, blockTop);
}

/**
 * Settle the polar caps.
 *
 * Web Mercator stops at ±85.0511°, so the rows above and below that are copies
 * of the last real row. SphereGeometry collapses every column of a row onto the
 * pole, which turns those copies into a fan of wedges radiating from the point.
 *
 * Each cap is faded toward the average colour of its own last real row —
 * Arctic sea reads blue-grey, Antarctic ice reads white — with the blend
 * starting at zero on the boundary row so nothing seams at 85°, and reaching
 * full at the pole so the wedges converge on a single flat colour instead of
 * on 4096 competing ones. Detail Mercator never carried cannot be recovered;
 * this makes the caps read as plausible rather than broken.
 */
function resolvePolarCaps(ctx, width, height, holeRows) {
  const capRows = Math.floor(((90 - MAX_MERCATOR_LAT) / 180) * height);
  if (capRows < 1) return;

  // How many rows each cap still needs covering. Without real polar imagery
  // that is the whole cap; with it, only the hole those services leave over the
  // pole itself — about half a degree.
  const north = Math.max(0, Math.min(capRows, holeRows?.north ?? capRows));
  const south = Math.max(0, Math.min(capRows, holeRows?.south ?? capRows));

  // Smoothstep keeps the ramp from showing a visible edge where it begins.
  const ease = (t) => t * t * (3 - 2 * t);

  const caps = [
    { edge: north, dir: -1, rows: north }, // north: first real row, walking up to y=0
    { edge: height - 1 - south, dir: 1, rows: south }, // south: walking down
  ];

  for (const { edge, dir, rows } of caps) {
    if (rows < 1) continue;

    // Blur first, then blend: the blur removes the stripes themselves, and the
    // blend then carries what is left toward one colour at the pole.
    blurCapRows(ctx, width, height, edge, dir, rows);

    const [r, g, b] = averageRow(ctx, width, edge);
    for (let i = 1; i <= rows; i++) {
      const y = edge + dir * i;
      if (y < 0 || y >= height) break;
      ctx.save();
      ctx.globalAlpha = ease(i / rows);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, y, width, 1);
      ctx.restore();
    }
  }
}

/**
 * Mean luminance of a texture, sampled from a small downscale.
 *
 * Basemaps vary enormously in brightness — CARTO's dark style is almost black
 * at globe zoom, where on a flat map its labels still carry the detail. The
 * caller uses this to lift dark textures back to a legible range instead of
 * hardcoding a per-style fudge factor.
 */
function measureMeanLuma(canvas) {
  const w = 64;
  const h = 32;
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(canvas, 0, 0, w, h);

  let data;
  try {
    data = sctx.getImageData(0, 0, w, h).data;
  } catch {
    return 0.5; // tainted canvas — assume mid brightness and skip the boost
  }

  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }
  return sum / (data.length / 4);
}

/**
 * Tile zoom to use for the globe texture.
 * Zoom 3 = 64 tiles / 2048², zoom 4 = 256 tiles / 4096². Anything higher costs
 * more than the sphere can show at typical panel sizes.
 */
export function chooseGlobeTileZoom({ lowMemory = false, pixelRatio = 1 } = {}) {
  if (lowMemory) return 2;
  return pixelRatio >= 2 ? 4 : 3;
}

export default { buildGlobeTexture, chooseGlobeTileZoom };

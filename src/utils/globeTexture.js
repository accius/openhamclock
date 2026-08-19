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
 * @param {number}   [opts.tileZoom=3]    - Zoom level; 2^z × 2^z tiles are fetched
 * @param {string}   [opts.lang]          - Language for {lang} templates
 * @param {Function} [opts.onProgress]    - Called with 0..1 as tiles land
 * @param {AbortSignal} [opts.signal]     - Cancels in-flight work
 * @returns {Promise<HTMLCanvasElement>}  - 2:1 equirectangular canvas
 */
export async function buildGlobeTexture({ tileUrlTemplate, tileZoom = 3, lang, baseColor, onProgress, signal }) {
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
    // Beyond ±85.05° Mercator has no data; clamping stretches the last real
    // row over the caps, which is the usual compromise for globe textures.
    const srcY = Math.max(0, Math.min(dim - 1, Math.floor(latToMercatorY(lat, dim))));
    ectx.drawImage(merc, 0, srcY, dim, 1, 0, y, outW, 1);
  }

  return { canvas: eq, meanLuma: measureMeanLuma(eq) };
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

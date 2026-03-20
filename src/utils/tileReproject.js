/**
 * Tile Reprojection Engine
 * Fetches Web Mercator tiles, composites onto an equirectangular canvas,
 * then reprojects to azimuthal equidistant projection via per-pixel sampling.
 */

const DEG = Math.PI / 180;

// ── Tile URL helpers ─────────────────────────────────────────
const subdomains = ['a', 'b', 'c'];
let subIdx = 0;

function resolveTileUrl(template, z, x, y) {
  const s = subdomains[subIdx++ % subdomains.length];
  const r = window.devicePixelRatio > 1 ? '@2x' : '';
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', s).replace('{r}', r);
}

// ── Image cache (LRU ~300) ──────────────────────────────────
const imgCache = new Map();
const MAX_CACHE = 300;

function evictCache() {
  if (imgCache.size <= MAX_CACHE) return;
  const it = imgCache.keys();
  while (imgCache.size > MAX_CACHE * 0.8) {
    const oldest = it.next().value;
    if (!oldest) break;
    imgCache.delete(oldest);
  }
}

// ── Concurrency-limited tile fetch ──────────────────────────
let activeFetches = 0;
const MAX_CONCURRENT = 6;
const fetchQueue = [];

function processQueue() {
  while (activeFetches < MAX_CONCURRENT && fetchQueue.length > 0) {
    const { url, resolve, reject } = fetchQueue.shift();
    activeFetches++;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      activeFetches--;
      imgCache.set(url, img);
      evictCache();
      resolve(img);
      processQueue();
    };
    img.onerror = (err) => {
      activeFetches--;
      reject(err);
      processQueue();
    };
    img.src = url;
  }
}

function fetchTile(url) {
  if (imgCache.has(url)) return Promise.resolve(imgCache.get(url));
  return new Promise((resolve, reject) => {
    fetchQueue.push({ url, resolve, reject });
    processQueue();
  });
}

// ── Azimuthal unproject ─────────────────────────────────────
function unproject(x, y, lat0Rad, lon0Rad, sinLat0, cosLat0) {
  const rho = Math.sqrt(x * x + y * y);
  if (rho < 1e-10) return { lat: lat0Rad / DEG, lon: lon0Rad / DEG };
  const c = rho;
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const lat = Math.asin(cosC * sinLat0 + (-y * sinC * cosLat0) / rho);
  const lon = lon0Rad + Math.atan2(x * sinC, rho * cosLat0 * cosC + y * sinLat0 * sinC);
  return { lat: lat / DEG, lon: ((lon / DEG + 540) % 360) - 180 };
}

// ── Reprojector factory ─────────────────────────────────────
export function createTileReprojector({ tileUrlTemplate, onProgress }) {
  let eqCanvas = null;
  let eqCtx = null;
  let cachedTileZoom = -1;
  let cachedTemplate = '';
  let cachedImageData = null;
  let cachedKey = '';
  let destroyed = false;
  let currentTemplate = tileUrlTemplate;
  let loading = false;
  let tilesLoaded = 0;
  let tilesTotal = 0;

  function chooseTileZoom(azZoom, lowMemory) {
    if (lowMemory) return 2;
    return azZoom > 1.5 ? 4 : 3;
  }

  async function buildEquirectangular(template, tileZoom) {
    const dim = Math.pow(2, tileZoom) * 256;
    const numTiles = Math.pow(2, tileZoom);

    if (!eqCanvas || eqCanvas.width !== dim) {
      eqCanvas = document.createElement('canvas');
      eqCanvas.width = dim;
      eqCanvas.height = dim;
      eqCtx = eqCanvas.getContext('2d', { willReadFrequently: true });
    }

    // Clear
    eqCtx.clearRect(0, 0, dim, dim);

    tilesLoaded = 0;
    tilesTotal = numTiles * numTiles;
    loading = true;

    const promises = [];
    for (let ty = 0; ty < numTiles; ty++) {
      for (let tx = 0; tx < numTiles; tx++) {
        const url = resolveTileUrl(template, tileZoom, tx, ty);
        const capturedTx = tx;
        const capturedTy = ty;
        promises.push(
          fetchTile(url)
            .then((img) => {
              if (destroyed) return;
              eqCtx.drawImage(img, capturedTx * 256, capturedTy * 256, 256, 256);
              tilesLoaded++;
              if (onProgress) onProgress(tilesLoaded / tilesTotal);
            })
            .catch(() => {
              tilesLoaded++;
              // Skip failed tiles — will show as transparent
            }),
        );
      }
    }

    await Promise.all(promises);
    loading = false;
    cachedTileZoom = tileZoom;
    cachedTemplate = template;
  }

  // Web Mercator tile grid uses Mercator Y, not equirectangular.
  // We need to convert lat → Mercator pixel Y for sampling.
  function latToMercatorY(lat, dim) {
    const latRad = lat * DEG;
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    // Mercator Y is 0 at top (lat 85.05), dim at bottom (lat -85.05)
    return dim / 2 - (dim * mercN) / (2 * Math.PI);
  }

  function reproject({ canvasWidth, canvasHeight, centerLat, centerLon, zoom, panX, panY, halfRes, lowMemory }) {
    if (!eqCanvas || !eqCtx) return null;

    const R = (Math.min(canvasWidth, canvasHeight) / 2 - 20) * zoom;
    const cxCenter = canvasWidth / 2 + panX;
    const cyCenter = canvasHeight / 2 + panY;
    const scale = R / Math.PI;

    const key = `${canvasWidth},${canvasHeight},${centerLat},${centerLon},${zoom},${panX},${panY},${halfRes},${cachedTileZoom}`;
    if (key === cachedKey && cachedImageData) return cachedImageData;

    const step = halfRes ? 2 : 1;
    const outW = canvasWidth;
    const outH = canvasHeight;
    const imageData = new ImageData(outW, outH);
    const data = imageData.data;

    const lat0Rad = centerLat * DEG;
    const lon0Rad = centerLon * DEG;
    const sinLat0 = Math.sin(lat0Rad);
    const cosLat0 = Math.cos(lat0Rad);
    const eqW = eqCanvas.width;
    const eqH = eqCanvas.height;

    // Get source pixel data
    let srcData;
    try {
      srcData = eqCtx.getImageData(0, 0, eqW, eqH).data;
    } catch (e) {
      console.warn('[TileReproject] CORS error reading tile canvas:', e);
      return null;
    }

    // Bounding box of the globe circle on canvas
    const x0 = Math.max(0, Math.floor(cxCenter - R));
    const y0 = Math.max(0, Math.floor(cyCenter - R));
    const x1 = Math.min(outW, Math.ceil(cxCenter + R));
    const y1 = Math.min(outH, Math.ceil(cyCenter + R));
    const R2 = R * R;

    for (let py = y0; py < y1; py += step) {
      for (let px = x0; px < x1; px += step) {
        const dx = px - cxCenter;
        const dy = py - cyCenter;
        if (dx * dx + dy * dy > R2) continue;

        const projX = dx / scale;
        const projY = dy / scale;

        const { lat, lon } = unproject(projX, projY, lat0Rad, lon0Rad, sinLat0, cosLat0);

        // Map to Mercator tile pixel coordinates
        // X is linear (equirectangular)
        const eqX = ((lon + 180) / 360) * eqW;
        // Y uses Mercator projection (matching the tile grid)
        const eqY = latToMercatorY(lat, eqH);

        // Clamp and nearest-neighbor sample
        const sx = Math.round(eqX) % eqW;
        const sy = Math.max(0, Math.min(eqH - 1, Math.round(eqY)));
        const srcIdx = (sy * eqW + (sx < 0 ? sx + eqW : sx)) * 4;

        const dstIdx = (py * outW + px) * 4;
        data[dstIdx] = srcData[srcIdx];
        data[dstIdx + 1] = srcData[srcIdx + 1];
        data[dstIdx + 2] = srcData[srcIdx + 2];
        data[dstIdx + 3] = srcData[srcIdx + 3];

        // Fill neighbor pixels when half-res
        if (halfRes && step === 2) {
          // Right pixel
          if (px + 1 < outW) {
            const di = (py * outW + px + 1) * 4;
            data[di] = data[dstIdx];
            data[di + 1] = data[dstIdx + 1];
            data[di + 2] = data[dstIdx + 2];
            data[di + 3] = data[dstIdx + 3];
          }
          // Bottom pixel
          if (py + 1 < outH) {
            const di = ((py + 1) * outW + px) * 4;
            data[di] = data[dstIdx];
            data[di + 1] = data[dstIdx + 1];
            data[di + 2] = data[dstIdx + 2];
            data[di + 3] = data[dstIdx + 3];
          }
          // Bottom-right pixel
          if (px + 1 < outW && py + 1 < outH) {
            const di = ((py + 1) * outW + px + 1) * 4;
            data[di] = data[dstIdx];
            data[di + 1] = data[dstIdx + 1];
            data[di + 2] = data[dstIdx + 2];
            data[di + 3] = data[dstIdx + 3];
          }
        }
      }
    }

    cachedKey = key;
    cachedImageData = imageData;
    return imageData;
  }

  return {
    async render({
      canvasWidth,
      canvasHeight,
      centerLat,
      centerLon,
      zoom,
      panX,
      panY,
      halfRes = false,
      lowMemory = false,
    }) {
      if (destroyed) return null;
      const tileZoom = chooseTileZoom(zoom, lowMemory);

      // Rebuild equirectangular canvas if needed
      if (cachedTileZoom !== tileZoom || cachedTemplate !== currentTemplate) {
        cachedKey = ''; // invalidate reprojection cache
        await buildEquirectangular(currentTemplate, tileZoom);
      }

      return reproject({ canvasWidth, canvasHeight, centerLat, centerLon, zoom, panX, panY, halfRes, lowMemory });
    },

    // Synchronous reprojection — only works if equirectangular canvas is already built
    reprojectSync(params) {
      if (destroyed || !eqCanvas || !eqCtx) return null;
      return reproject(params);
    },

    // Whether the equirectangular tile canvas has been built
    isReady() {
      return !!eqCanvas && cachedTileZoom >= 0 && !loading;
    },

    setUrl(template) {
      currentTemplate = template;
    },

    isLoading() {
      return loading;
    },

    progress() {
      return tilesTotal > 0 ? tilesLoaded / tilesTotal : 0;
    },

    destroy() {
      destroyed = true;
      eqCanvas = null;
      eqCtx = null;
      cachedImageData = null;
      cachedKey = '';
      // Drain queue
      fetchQueue.length = 0;
    },
  };
}

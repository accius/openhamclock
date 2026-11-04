/**
 * Screenshot of the running display for GET /api/control/capture.png.
 *
 * Electron: the preload exposes window.electronAPI.capturePage(), a
 * pixel-perfect webContents.capturePage() of the whole window.
 *
 * Plain browsers have no DOM-to-image API without a dependency, so the
 * fallback composites what it can: the page background, every visible
 * <canvas> (3D globe, azimuthal map, charts) and — when the browser lets us —
 * the Leaflet tile <img>s. Cross-origin tiles taint the canvas, in which
 * case the frame is retried without them. Text panels are not rendered;
 * this is documented as a limitation in docs/API.md.
 */

const PNG = 'image/png';

function base64ToBlob(b64, type = PNG) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const visible = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return null;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return null;
  return r;
};

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), PNG);
    } catch (e) {
      reject(e);
    }
  });
}

async function compositeDom({ includeImages }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(window.innerWidth));
  const h = Math.max(1, Math.floor(window.innerHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const bg = getComputedStyle(document.body).backgroundColor;
  ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#0a0e14';
  ctx.fillRect(0, 0, w, h);

  // Paint in document order so overlays land on top of the map.
  const nodes = Array.from(document.querySelectorAll(includeImages ? 'canvas, img.leaflet-tile, img' : 'canvas'));
  for (const el of nodes) {
    const r = visible(el);
    if (!r) continue;
    try {
      if (el.tagName === 'IMG') {
        if (!el.complete || !el.naturalWidth) continue;
        ctx.drawImage(el, r.left, r.top, r.width, r.height);
      } else {
        ctx.drawImage(el, r.left, r.top, r.width, r.height);
      }
    } catch {
      /* WebGL canvas without preserveDrawingBuffer etc. — skip */
    }
  }
  return toBlob(canvas);
}

/** → Blob (image/png) or null when nothing could be captured. */
export async function captureFrame() {
  try {
    if (window.electronAPI?.capturePage) {
      const b64 = await window.electronAPI.capturePage();
      if (b64) return base64ToBlob(b64);
    }
  } catch {
    /* fall through to DOM composite */
  }
  try {
    return await compositeDom({ includeImages: true });
  } catch {
    try {
      return await compositeDom({ includeImages: false });
    } catch {
      return null;
    }
  }
}

/** Capture and POST to the server for the given display id (+ its pairing secret). → true on success */
export async function uploadFrame(controlId, secret = '') {
  const blob = await captureFrame();
  if (!blob) return false;
  try {
    const headers = { 'Content-Type': PNG };
    if (secret) headers['X-Control-Secret'] = secret;
    const res = await fetch(`/api/control/capture?target=${encodeURIComponent(controlId)}`, {
      method: 'POST',
      headers,
      body: blob,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * historyPlaybackStore — shared transport state for the History Playback
 * layer, so the flat map and the 3D globe scrub the same timeline.
 *
 * One module-level store holds the scrub position, window size, play state
 * and the fetched spot window; consumers (the Leaflet layer, Globe3D's
 * overlay effect) acquire()/release() it — while at least one consumer is
 * active the store runs the playback clock, polls /api/history/meta, and
 * re-fetches the window (debounced) whenever the scrub position changes.
 *
 * buildTransportControl() returns the transport UI as a plain DOM element —
 * framework-free so the Leaflet layer can wrap it in an L.Control and the
 * globe can absolutely-position the same control over the WebGL canvas.
 */
import { apiFetch } from '../utils/apiFetch.js';

export const DAY_MIN = 24 * 60;
export const WINDOW_CHOICES = [5, 15, 30, 60];
export const SPEED_CHOICES = [
  { label: '1 min/s', minPerTick: 0.5 }, // ticks run every 500 ms
  { label: '5 min/s', minPerTick: 2.5 },
  { label: '15 min/s', minPerTick: 7.5 },
];
export const MAX_DRAWN = 500;

const state = {
  endOffsetMin: 0, // minutes before "now" where the window ENDS (0 = live edge)
  windowMin: 15,
  playing: false,
  speedIdx: 0,
  meta: null, // { earliest, latest, count }
  result: null, // last /api/history/spots response
  subscribers: new Set(),
};

let refCount = 0;
let clockTimer = null;
let metaTimer = null;
let fetchDebounce = null;

const notify = () => {
  state.subscribers.forEach((cb) => {
    try {
      cb(getSnapshot());
    } catch {
      /* consumer errors must not break the loop */
    }
  });
};

export const getSnapshot = () => ({
  active: refCount > 0,
  // True while the user is looking at the past: live DX paths hide so the
  // replayed spots are the only cluster paths on the map.
  scrubbing: refCount > 0 && state.endOffsetMin > 0,
  endOffsetMin: state.endOffsetMin,
  windowMin: state.windowMin,
  playing: state.playing,
  speedIdx: state.speedIdx,
  meta: state.meta,
  result: state.result,
});

export const subscribe = (cb) => {
  state.subscribers.add(cb);
  cb(getSnapshot());
  return () => state.subscribers.delete(cb);
};

// ── Data ────────────────────────────────────────────────────────────────────

const loadMeta = () =>
  apiFetch('/api/history/meta')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      if (m) {
        state.meta = m;
        notify();
      }
    })
    .catch(() => {});

const fetchWindow = () => {
  if (fetchDebounce) clearTimeout(fetchDebounce);
  fetchDebounce = setTimeout(() => {
    const to = Date.now() - state.endOffsetMin * 60 * 1000;
    const from = to - state.windowMin * 60 * 1000;
    apiFetch(`/api/history/spots?from=${Math.round(from)}&to=${Math.round(to)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          state.result = data;
          notify();
        }
      })
      .catch(() => {});
  }, 200);
};

// ── Transport actions ───────────────────────────────────────────────────────

export const setEndOffsetMin = (min) => {
  state.endOffsetMin = Math.max(0, Math.min(DAY_MIN, min));
  fetchWindow();
  notify();
};

export const setWindowMin = (min) => {
  state.windowMin = min;
  fetchWindow();
  notify();
};

export const setSpeedIdx = (idx) => {
  state.speedIdx = Math.max(0, Math.min(SPEED_CHOICES.length - 1, idx));
  notify();
};

export const togglePlay = () => {
  // Playing from the live edge makes no sense — rewind first.
  if (state.endOffsetMin <= 0 && !state.playing) return;
  state.playing = !state.playing;
  notify();
};

export const jumpLive = () => {
  state.playing = false;
  setEndOffsetMin(0);
};

// ── Lifecycle ───────────────────────────────────────────────────────────────

export const acquire = () => {
  refCount++;
  if (refCount > 1) return;
  loadMeta();
  metaTimer = setInterval(loadMeta, 5 * 60 * 1000);
  clockTimer = setInterval(() => {
    if (!state.playing) return;
    const next = state.endOffsetMin - SPEED_CHOICES[state.speedIdx].minPerTick;
    if (next <= 0) {
      state.playing = false;
      state.endOffsetMin = 0;
    } else {
      state.endOffsetMin = next;
    }
    fetchWindow();
    notify();
  }, 500);
  fetchWindow();
};

export const release = () => {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  clearInterval(clockTimer);
  clearInterval(metaTimer);
  clearTimeout(fetchDebounce);
  clockTimer = metaTimer = fetchDebounce = null;
  state.playing = false;
  state.endOffsetMin = 0;
  state.result = null;
  notify();
};

// ── Transport control DOM ───────────────────────────────────────────────────

const utcHHMM = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}z`;
};

/**
 * Build the transport control as a plain DOM element wired to the store.
 * Returns { el, dispose } — the caller positions the element (L.Control on
 * the flat map, absolute placement on the globe) and calls dispose() on
 * unmount to drop the store subscription.
 */
export function buildTransportControl(doc = document) {
  const div = doc.createElement('div');
  div.className = 'history-playback-control';
  div.style.minWidth = '230px';
  div.innerHTML = `
    <div class="floating-panel-header">⏪ History Playback</div>
    <div class="history-panel-content">
      <div id="hist-label" style="font-family:var(--font-mono);font-size:12px;color:var(--text-primary);margin-bottom:4px;">—</div>
      <input id="hist-slider" type="range" min="0" max="${DAY_MIN}" step="1" style="width:100%;direction:rtl;" aria-label="Playback time (minutes before now)" />
      <div style="display:flex;gap:4px;align-items:center;margin-top:6px;">
        <button id="hist-play" style="flex:0 0 auto;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:3px 10px;font-size:12px;cursor:pointer;">▶</button>
        <select id="hist-window" aria-label="Window size" style="background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);padding:3px;font-size:11px;">
          ${WINDOW_CHOICES.map((w) => `<option value="${w}">${w} min</option>`).join('')}
        </select>
        <select id="hist-speed" aria-label="Playback speed" style="background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);padding:3px;font-size:11px;">
          ${SPEED_CHOICES.map((s, i) => `<option value="${i}">${s.label}</option>`).join('')}
        </select>
        <button id="hist-live" title="Jump to now" style="background:var(--bg-tertiary);color:var(--accent-green);border:1px solid var(--border-color);border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">LIVE</button>
      </div>
      <div id="hist-stats" style="font-size:10px;color:var(--text-muted);margin-top:6px;">Loading…</div>
    </div>`;

  div.querySelector('#hist-slider').addEventListener('input', (e) => {
    state.playing = false;
    setEndOffsetMin(parseInt(e.target.value, 10) || 0);
  });
  div.querySelector('#hist-play').addEventListener('click', togglePlay);
  div.querySelector('#hist-window').value = String(state.windowMin);
  div.querySelector('#hist-window').addEventListener('change', (e) => setWindowMin(parseInt(e.target.value, 10)));
  div.querySelector('#hist-speed').value = String(state.speedIdx);
  div.querySelector('#hist-speed').addEventListener('change', (e) => setSpeedIdx(parseInt(e.target.value, 10)));
  div.querySelector('#hist-live').addEventListener('click', jumpLive);

  const render = (snap) => {
    const to = Date.now() - snap.endOffsetMin * 60 * 1000;
    const from = to - snap.windowMin * 60 * 1000;
    const label = div.querySelector('#hist-label');
    if (label) {
      let text = `${utcHHMM(from)} – ${utcHHMM(to)}`;
      if (snap.endOffsetMin <= 0) text += ' (live edge)';
      else if (snap.meta?.earliest && to < snap.meta.earliest)
        text += ` — no history before ${utcHHMM(snap.meta.earliest)}`;
      else text += ' — live spots hidden';
      label.textContent = text;
    }

    const slider = div.querySelector('#hist-slider');
    if (slider && parseInt(slider.value, 10) !== Math.round(snap.endOffsetMin)) {
      slider.value = String(Math.round(snap.endOffsetMin));
    }
    const play = div.querySelector('#hist-play');
    if (play) play.textContent = snap.playing ? '⏸' : '▶';

    const stats = div.querySelector('#hist-stats');
    if (stats) {
      const parts = [];
      if (snap.result) {
        parts.push(`${snap.result.total} spot${snap.result.total === 1 ? '' : 's'} in window`);
        if (snap.result.total > MAX_DRAWN) parts.push(`drawing newest ${MAX_DRAWN}`);
        else if (snap.result.downsampled) parts.push('downsampled');
      }
      if (snap.meta?.earliest) parts.push(`history since ${utcHHMM(snap.meta.earliest)}`);
      stats.textContent = parts.join(' · ') || 'Loading…';
    }
  };

  const unsubscribe = subscribe(render);
  return { el: div, dispose: unsubscribe };
}

export default {
  getSnapshot,
  subscribe,
  acquire,
  release,
  setEndOffsetMin,
  setWindowMin,
  setSpeedIdx,
  togglePlay,
  jumpLive,
  buildTransportControl,
};

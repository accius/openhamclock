/**
 * myDecodes.js — the operator's own decodes ("what my receiver heard").
 *
 * A small local list of stations copied by the in-browser decoder and
 * logged with one click: callsign, frequency, mode, speed, signal and the
 * line of copy it came from. Kept in localStorage on this device only —
 * nothing is sent anywhere. Every change fires MY_DECODES_EVENT so any open
 * panel re-reads the list.
 */

export const MY_DECODES_KEY = 'ohc_my_decodes';
export const MY_DECODES_EVENT = 'openhamclock:my-decodes-changed';
export const MY_DECODES_MAX = 200;
/** Logging the same call on the same frequency within this window updates the entry instead. */
export const MY_DECODES_MERGE_MS = 5 * 60 * 1000;

const read = () => {
  try {
    const raw = localStorage.getItem(MY_DECODES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((d) => d && typeof d.call === 'string') : [];
  } catch {
    return [];
  }
};

const write = (list) => {
  try {
    localStorage.setItem(MY_DECODES_KEY, JSON.stringify(list.slice(0, MY_DECODES_MAX)));
  } catch {
    // storage full / disabled — the list just won't persist
  }
  try {
    window.dispatchEvent(new CustomEvent(MY_DECODES_EVENT));
  } catch {
    // non-browser (tests without window)
  }
};

/** Newest first. */
export function loadMyDecodes() {
  return read();
}

const roundKhz = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null);

/**
 * Add a decode. Returns the stored entry.
 * @param {{call: string, freqKhz?: number|null, mode?: string, wpm?: number, snrDb?: number,
 *          text?: string, source?: string, time?: number}} d
 */
export function addMyDecode(d) {
  const call = String(d?.call || '')
    .trim()
    .toUpperCase();
  if (!call) return null;
  const time = Number.isFinite(d.time) ? d.time : Date.now();
  const freqKhz = roundKhz(Number(d.freqKhz));
  const entry = {
    id: `${time.toString(36)}-${call}`,
    call,
    freqKhz,
    mode: d.mode || 'CW',
    wpm: Number.isFinite(d.wpm) ? Math.round(d.wpm) : null,
    snrDb: Number.isFinite(d.snrDb) ? Math.round(d.snrDb) : null,
    text: typeof d.text === 'string' ? d.text.trim().slice(-120) : '',
    source: d.source || 'audio',
    time,
  };
  const list = read();
  const dup = list.findIndex(
    (e) =>
      e.call === call &&
      Math.abs(time - e.time) < MY_DECODES_MERGE_MS &&
      (e.freqKhz == null || freqKhz == null || Math.abs(e.freqKhz - freqKhz) < 1),
  );
  if (dup >= 0) {
    const merged = { ...list[dup], ...entry, id: list[dup].id, count: (list[dup].count || 1) + 1 };
    list.splice(dup, 1);
    write([merged, ...list]);
    return merged;
  }
  write([entry, ...list]);
  return entry;
}

export function removeMyDecode(id) {
  write(read().filter((e) => e.id !== id));
}

export function clearMyDecodes() {
  write([]);
}

/**
 * Shape a decode like a cluster spot so existing spot handlers (tune the
 * rig, set DX) accept it: { call, freq (kHz), mode, comment, time }.
 */
export function myDecodeToSpot(e) {
  return {
    call: e.call,
    freq: e.freqKhz ?? null,
    mode: e.mode || 'CW',
    comment: [e.wpm ? `${e.wpm} WPM` : null, e.snrDb != null ? `${e.snrDb} dB` : null, 'my decode']
      .filter(Boolean)
      .join(' · '),
    time: e.time,
    source: 'my-decodes',
  };
}

/**
 * logbookStore — client-side native logbook storage.
 *
 * QSOs persist in IndexedDB (DB `openhamclock-logbook`, store `qsos`) so logs
 * of 10k+ contacts survive reloads without any server-side per-user storage.
 * A thin adapter interface hides the backend: the IndexedDB adapter is used in
 * production, and an in-memory adapter takes over automatically in tests and
 * in environments without indexedDB (private-mode browsers, jsdom, SSR).
 *
 * All consumers share one module-level cache of the full log plus a
 * refcounted subscriber set (same pattern as useWorkedBefore): the DB is read
 * once, every mutation updates the cache and notifies subscribers
 * synchronously, and the persistence write happens in the background.
 *
 * The store also carries the "log this spot" hand-off: panels call
 * requestLogQso(prefill) and the Logbook panel (mounted or mounted later)
 * picks the prefill up via subscribePrefill/consumePendingPrefill. When no
 * Logbook panel is mounted (tracked via registerPanelMount/hasMountedPanel),
 * the app-level LogQsoPopup handles the prefill instead.
 *
 * QSO record shape (ADIF-aligned, lowercase keys):
 *   { id, call, qso_date 'YYYYMMDD', time_on 'HHMMSS', band, mode, submode?,
 *     freq (MHz number), rst_sent, rst_rcvd, gridsquare, name, comment,
 *     tx_pwr, my_gridsquare, extras: { ADIF_FIELD: value } }
 */

const DB_NAME = 'openhamclock-logbook';
const DB_VERSION = 1;
const STORE_NAME = 'qsos';

/** UUID with a fallback for environments without crypto.randomUUID. */
export const makeQsoId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `qso-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

// ── Adapters ────────────────────────────────────────────────────────────────
// Both adapters implement: open(), getAll(), put(record), putMany(records),
// remove(id), clear(). Records are keyed by `id`.

const createMemoryAdapter = () => {
  const map = new Map();
  return {
    kind: 'memory',
    async open() {},
    async getAll() {
      return [...map.values()];
    },
    async put(record) {
      map.set(record.id, record);
    },
    async putMany(records) {
      for (const r of records) map.set(r.id, r);
    },
    async remove(id) {
      map.delete(id);
    },
    async clear() {
      map.clear();
    },
  };
};

const createIndexedDbAdapter = () => {
  let db = null;

  const open = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          // Indexes are not needed by the in-memory read path today, but they
          // make the on-disk store future-proof for direct queries (e.g. a
          // worker-side dedup or per-day views) without a schema migration.
          store.createIndex('call', 'call', { unique: false });
          store.createIndex('qso_date', 'qso_date', { unique: false });
        }
      };
      req.onsuccess = () => {
        db = req.result;
        // If another tab upgrades the schema, close so it can proceed.
        db.onversionchange = () => db.close();
        resolve();
      };
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB open blocked'));
    });

  const tx = (mode, fn) =>
    new Promise((resolve, reject) => {
      if (!db) {
        reject(new Error('logbook DB not open'));
        return;
      }
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try {
        result = fn(store);
      } catch (err) {
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(result?.result !== undefined ? result.result : result);
      transaction.onerror = () => reject(transaction.error || new Error('logbook transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('logbook transaction aborted'));
    });

  return {
    kind: 'indexeddb',
    open,
    async getAll() {
      const rows = await tx('readonly', (store) => store.getAll());
      return Array.isArray(rows) ? rows : [];
    },
    async put(record) {
      await tx('readwrite', (store) => store.put(record));
    },
    async putMany(records) {
      await tx('readwrite', (store) => {
        for (const r of records) store.put(r);
      });
    },
    async remove(id) {
      await tx('readwrite', (store) => store.delete(id));
    },
    async clear() {
      await tx('readwrite', (store) => store.clear());
    },
  };
};

// ── Shared module-level store ───────────────────────────────────────────────

const state = {
  adapter: null,
  initPromise: null,
  qsos: [], // cache of the full log — the UI's source of truth
  subscribers: new Set(),
  pendingPrefill: null, // "log this spot" hand-off payload
  prefillSubscribers: new Set(),
  panelMounts: 0, // number of currently mounted LogbookPanel instances
};

const pickAdapter = () => {
  if (typeof indexedDB === 'undefined' || indexedDB == null) return createMemoryAdapter();
  return createIndexedDbAdapter();
};

const notify = () => {
  // New array identity so React state updates propagate.
  const snapshot = [...state.qsos];
  state.qsos = snapshot;
  state.subscribers.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {}
  });
};

const persistError = (op, err) => {
  // The in-memory cache stays correct even when the disk write fails; log so
  // quota/private-mode issues are at least diagnosable.
  console.error(`[logbookStore] ${op} failed to persist:`, err);
};

/**
 * Initialize the store (idempotent). Opens the backing DB and loads the full
 * log into the cache. Falls back to the in-memory adapter if IndexedDB
 * exists but cannot be opened (private mode, quota, corrupt DB).
 */
export const init = () => {
  if (!state.initPromise) {
    state.initPromise = (async () => {
      state.adapter = pickAdapter();
      try {
        await state.adapter.open();
      } catch (err) {
        console.warn('[logbookStore] indexedDB unavailable — falling back to in-memory storage:', err);
        state.adapter = createMemoryAdapter();
        await state.adapter.open();
      }
      try {
        state.qsos = await state.adapter.getAll();
      } catch (err) {
        persistError('load', err);
        state.qsos = [];
      }
      notify();
    })();
  }
  return state.initPromise;
};

/** Current cached QSO list (empty until init resolves). */
export const getAll = () => state.qsos;

/** Number of QSOs in the log. */
export const count = () => state.qsos.length;

/**
 * Dedup key: call + date + time-to-the-minute + band. Two entries of the same
 * contact exported by different loggers rarely agree on seconds, so the key
 * deliberately drops them.
 */
export const dedupKey = (qso) => {
  const call = String(qso?.call || '')
    .trim()
    .toUpperCase();
  const date = String(qso?.qso_date || '').trim();
  const minute = String(qso?.time_on || '')
    .trim()
    .slice(0, 4); // HHMM
  const band = String(qso?.band || '')
    .trim()
    .toLowerCase();
  return `${call}|${date}|${minute}|${band}`;
};

/** Add one QSO. Assigns an id when missing. Returns the stored record. */
export const add = async (fields) => {
  await init();
  const record = { ...fields, id: fields?.id || makeQsoId() };
  state.qsos.push(record);
  notify();
  try {
    await state.adapter.put(record);
  } catch (err) {
    persistError('add', err);
  }
  return record;
};

/**
 * Bulk add (ADIF import). Skips records whose dedup key matches an existing
 * QSO (or an earlier record in the same batch).
 * @returns {{ imported: number, skipped: number }}
 */
export const addMany = async (records, { strict = false } = {}) => {
  await init();
  const seen = new Set(state.qsos.map(dedupKey));
  const fresh = [];
  let skipped = 0;
  for (const fields of Array.isArray(records) ? records : []) {
    if (!fields || !fields.call) {
      skipped++;
      continue;
    }
    const key = dedupKey(fields);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    fresh.push({ ...fields, id: fields.id || makeQsoId() });
  }
  if (fresh.length > 0) {
    state.qsos.push(...fresh);
    notify();
    try {
      await state.adapter.putMany(fresh);
    } catch (err) {
      if (strict) {
        const freshIds = new Set(fresh.map((qso) => qso.id));
        state.qsos = state.qsos.filter((qso) => !freshIds.has(qso.id));
        notify();
        throw err;
      }
      persistError('addMany', err);
    }
  }
  return { imported: fresh.length, skipped };
};

/** Update a QSO by id (shallow merge; id is preserved). Returns the record or null. */
export const update = async (id, fields) => {
  await init();
  const idx = state.qsos.findIndex((q) => q.id === id);
  if (idx === -1) return null;
  const record = { ...state.qsos[idx], ...fields, id };
  state.qsos[idx] = record;
  notify();
  try {
    await state.adapter.put(record);
  } catch (err) {
    persistError('update', err);
  }
  return record;
};

/** Remove a QSO by id. Returns true when a record was removed. */
export const remove = async (id) => {
  await init();
  const idx = state.qsos.findIndex((q) => q.id === id);
  if (idx === -1) return false;
  state.qsos.splice(idx, 1);
  notify();
  try {
    await state.adapter.remove(id);
  } catch (err) {
    persistError('remove', err);
  }
  return true;
};

/** Delete every QSO. */
export const clear = async () => {
  await init();
  state.qsos = [];
  notify();
  try {
    await state.adapter.clear();
  } catch (err) {
    persistError('clear', err);
  }
};

/**
 * Subscribe to log changes. cb receives the full QSO array immediately-ish
 * (after init) and again after every mutation. Returns an unsubscribe fn.
 */
export const subscribe = (cb) => {
  state.subscribers.add(cb);
  // Deliver the current cache synchronously so late subscribers don't wait
  // for the next mutation; subscribers registered before the initial load
  // completes are covered by init()'s own notify().
  cb(state.qsos);
  init();
  return () => {
    state.subscribers.delete(cb);
  };
};

// ── Log-from-spot hand-off ──────────────────────────────────────────────────

/**
 * Ask the Logbook panel to open its New-QSO form pre-filled from a spot.
 * The prefill is kept until a panel consumes it, so it survives the panel
 * not being mounted yet — the form opens when the user adds the panel.
 *
 * @param {object} prefill { call, freq (MHz), mode, band?, gridsquare?, name?, comment? }
 */
export const requestLogQso = (prefill) => {
  if (!prefill || !prefill.call) return;
  state.pendingPrefill = { ...prefill, requestedAt: Date.now() };
  state.prefillSubscribers.forEach((cb) => {
    try {
      cb(state.pendingPrefill);
    } catch {}
  });
};

/** Read-and-clear the pending prefill (null when there is none). */
export const consumePendingPrefill = () => {
  const p = state.pendingPrefill;
  state.pendingPrefill = null;
  return p;
};

/** Subscribe to future requestLogQso calls. Returns an unsubscribe fn. */
export const subscribePrefill = (cb) => {
  state.prefillSubscribers.add(cb);
  return () => {
    state.prefillSubscribers.delete(cb);
  };
};

// ── Logbook panel mount tracking ────────────────────────────────────────────
// The app-level LogQsoPopup only opens for a "log this spot" request when no
// LogbookPanel is mounted to consume it. Panels report their presence here
// (refcounted — the dockable layout can host several Logbook tabs).

/** Called from LogbookPanel's mount effect. */
export const registerPanelMount = () => {
  state.panelMounts += 1;
};

/** Called from LogbookPanel's unmount cleanup. */
export const unregisterPanelMount = () => {
  state.panelMounts = Math.max(0, state.panelMounts - 1);
};

/** True while at least one LogbookPanel is mounted. */
export const hasMountedPanel = () => state.panelMounts > 0;

/** Test hook: wipe all module state so each test starts from a blank store. */
export const __resetLogbookForTests = () => {
  state.adapter = null;
  state.initPromise = null;
  state.qsos = [];
  state.subscribers.clear();
  state.pendingPrefill = null;
  state.prefillSubscribers.clear();
  state.panelMounts = 0;
};

export default {
  init,
  getAll,
  add,
  addMany,
  update,
  remove,
  clear,
  count,
  subscribe,
  dedupKey,
  requestLogQso,
  consumePendingPrefill,
  subscribePrefill,
  registerPanelMount,
  unregisterPanelMount,
  hasMountedPanel,
};

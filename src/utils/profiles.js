/**
 * Profile Manager for OpenHamClock
 * Allows saving/loading named layout & preference profiles
 * so multiple operators can share one HamClock with different views,
 * or a single operator can switch between saved configurations.
 *
 * A profile is a snapshot of all openhamclock_* localStorage keys.
 *
 * Profiles are keyed by display name, but each record also carries a stable
 * `id` (assigned lazily on read for pre-id profiles) so external references
 * — scene rotation's `profile#<id>` entries — survive renames.
 */

const PROFILES_KEY = 'openhamclock_profiles';
const ACTIVE_KEY = 'openhamclock_activeProfile';

/** Fired on any profile mutation so pickers can refresh live. */
export const PROFILES_CHANGED_EVENT = 'openhamclock:profiles-changed';

const newProfileId = () => `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// All localStorage keys that belong to a profile snapshot
// (everything except the profiles store itself and the active profile pointer)
const SNAPSHOT_KEYS = [
  'openhamclock_config',
  'openhamclock_dockLayout',
  'openhamclock_dockLayoutPresets',
  'openhamclock_dxFilters',
  'openhamclock_dxLocation',
  'openhamclock_dxLocked',
  'openhamclock_mapLayers',
  'openhamclock_mapSettings',
  'openhamclock_pskActiveTab',
  'openhamclock_pskFilters',
  'openhamclock_potaFilters',
  'openhamclock_sotaFilters',
  'openhamclock_wwffFilters',
  'openhamclock_wwbotaFilters',
  'openhamclock_callsignSearchHistory',
  'openhamclock_contestSession',
  'openhamclock_freqMemories',
  'openhamclock_netSchedule',
  'openhamclock_netControlScripts',
  'openhamclock_pskPanelMode',
  'openhamclock_bandColors',
  'openhamclock_satelliteFilters',
  'openhamclock_solarImageType',
  'openhamclock_solarPanelMode',
  'openhamclock_use12Hour',
  'openhamclock_voacapColorScheme',
  'openhamclock_voacapViewMode',
  'openhamclock_weatherExpanded',
];

/**
 * Get all saved profiles: { [name]: { snapshot, createdAt, updatedAt } }
 */
export function getProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const profiles = raw ? JSON.parse(raw) : {};
    // Lazy migration: assign stable ids to profiles saved before ids existed
    let migrated = false;
    for (const record of Object.values(profiles)) {
      if (record && !record.id) {
        record.id = newProfileId();
        migrated = true;
      }
    }
    if (migrated) saveProfiles(profiles);
    return profiles;
  } catch {
    return {};
  }
}

function saveProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  try {
    window.dispatchEvent(new Event(PROFILES_CHANGED_EVENT));
  } catch {}
}

/**
 * List profiles as [{ id, name, createdAt, updatedAt }], creation order.
 */
export function getProfileEntries() {
  return Object.entries(getProfiles()).map(([name, record]) => ({
    id: record.id,
    name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));
}

/** Find a profile by its stable id → { id, name } or null. */
export function getProfileById(id) {
  if (!id) return null;
  return getProfileEntries().find((p) => p.id === id) || null;
}

/**
 * Get the name of the currently active profile (or null)
 */
export function getActiveProfile() {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

/** Stable id of the active profile, or null. */
export function getActiveProfileId() {
  const name = getActiveProfile();
  if (!name) return null;
  return getProfiles()[name]?.id || null;
}

/**
 * Clear the active-profile pointer without touching any snapshot data.
 * Scene rotation calls this when it moves off a profile scene, so the
 * rotation index doesn't snap back to the profile's position.
 */
export function clearActiveProfile() {
  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

/**
 * Take a snapshot of the current localStorage state
 */
function takeSnapshot() {
  const snapshot = {};
  for (const key of SNAPSHOT_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) {
      snapshot[key] = val;
    }
  }
  // Also capture any openhamclock_ keys we might have missed
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('openhamclock_') && !snapshot[key] && key !== PROFILES_KEY && key !== ACTIVE_KEY) {
      snapshot[key] = localStorage.getItem(key);
    }
  }
  return snapshot;
}

/**
 * Restore a snapshot to localStorage (replaces all openhamclock_ keys).
 *
 * With `preserveSceneRotation`, the CURRENT config's sceneRotation block is
 * carried over into the restored config — without this, rotating into a
 * profile would overwrite the rotation list with the profile's stale copy
 * and the rotation would self-destruct on its first profile switch.
 */
function restoreSnapshot(snapshot, { preserveSceneRotation = false } = {}) {
  let carriedRotation = null;
  if (preserveSceneRotation) {
    try {
      carriedRotation = JSON.parse(localStorage.getItem('openhamclock_config'))?.sceneRotation || null;
    } catch {}
  }

  // Clear all current openhamclock_ keys (except profiles store and active pointer)
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('openhamclock_') && key !== PROFILES_KEY && key !== ACTIVE_KEY) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));

  // Write snapshot keys
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== PROFILES_KEY && key !== ACTIVE_KEY) {
      localStorage.setItem(key, value);
    }
  }

  if (carriedRotation) {
    try {
      const cfg = JSON.parse(localStorage.getItem('openhamclock_config') || '{}');
      cfg.sceneRotation = carriedRotation;
      localStorage.setItem('openhamclock_config', JSON.stringify(cfg));
    } catch {}
  }
}

/**
 * Save the current state as a named profile
 */
export function saveProfile(name) {
  if (!name || !name.trim()) return false;
  const trimmed = name.trim();
  const profiles = getProfiles();
  const now = new Date().toISOString();
  profiles[trimmed] = {
    id: profiles[trimmed]?.id || newProfileId(),
    snapshot: takeSnapshot(),
    createdAt: profiles[trimmed]?.createdAt || now,
    updatedAt: now,
  };
  saveProfiles(profiles);
  localStorage.setItem(ACTIVE_KEY, trimmed);
  return true;
}

/**
 * Load a named profile (restores its snapshot to localStorage)
 * Returns true if successful, false if profile not found.
 * Options are forwarded to restoreSnapshot (preserveSceneRotation).
 */
export function loadProfile(name, options = {}) {
  const profiles = getProfiles();
  const profile = profiles[name];
  if (!profile?.snapshot) return false;

  restoreSnapshot(profile.snapshot, options);
  localStorage.setItem(ACTIVE_KEY, name);
  return true;
}

/**
 * Load a profile by its stable id — the scene-rotation entry point
 * (`profile#<id>` scenes reference ids so renames don't orphan them).
 */
export function loadProfileById(id, options = {}) {
  const entry = getProfileById(id);
  if (!entry) return false;
  return loadProfile(entry.name, options);
}

/**
 * Activate a profile as a rotation scene: restore its snapshot with the
 * current sceneRotation block preserved, then hard-reload (profile
 * activation is reload-based). Returns false — without reloading — when the
 * profile doesn't exist in this browser.
 */
export function activateProfileScene(id) {
  if (!loadProfileById(id, { preserveSceneRotation: true })) return false;
  window.location.reload();
  return true;
}

/**
 * Delete a named profile
 */
export function deleteProfile(name) {
  const profiles = getProfiles();
  delete profiles[name];
  saveProfiles(profiles);
  // If deleting the active profile, clear active
  if (getActiveProfile() === name) {
    localStorage.removeItem(ACTIVE_KEY);
  }
  return true;
}

/**
 * Rename a profile
 */
export function renameProfile(oldName, newName) {
  if (!newName?.trim() || oldName === newName) return false;
  const profiles = getProfiles();
  if (!profiles[oldName]) return false;
  if (profiles[newName.trim()]) return false; // target name already exists

  profiles[newName.trim()] = { ...profiles[oldName], updatedAt: new Date().toISOString() };
  delete profiles[oldName];
  saveProfiles(profiles);

  if (getActiveProfile() === oldName) {
    localStorage.setItem(ACTIVE_KEY, newName.trim());
  }
  return true;
}

/**
 * Export a profile as a JSON string (for sharing / backup)
 */
export function exportProfile(name) {
  const profiles = getProfiles();
  const profile = profiles[name];
  if (!profile) return null;
  return JSON.stringify(
    {
      name,
      version: 1,
      exportedAt: new Date().toISOString(),
      ...profile,
    },
    null,
    2,
  );
}

/**
 * Export current live state as a JSON string (without needing a saved profile)
 */
export function exportCurrentState(name = 'Exported') {
  return JSON.stringify(
    {
      name,
      version: 1,
      exportedAt: new Date().toISOString(),
      snapshot: takeSnapshot(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

/**
 * Import a profile from a JSON string
 * Returns the imported profile name, or null on failure
 */
export function importProfile(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data.snapshot || !data.name) return null;

    const profiles = getProfiles();
    // Avoid overwriting - add suffix if name exists
    let name = data.name;
    let counter = 1;
    while (profiles[name]) {
      name = `${data.name} (${counter++})`;
    }

    profiles[name] = {
      id: newProfileId(), // never reuse an imported id — re-imports must not collide
      snapshot: data.snapshot,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveProfiles(profiles);
    return name;
  } catch {
    return null;
  }
}

/**
 * Update the active profile in-place with current state
 * (auto-save current changes to whichever profile is active)
 */
export function updateActiveProfile() {
  const name = getActiveProfile();
  if (!name) return false;
  return saveProfile(name);
}

// ── Share codes ─────────────────────────────────────────────────────────────
// A share code is a profile export packed into a single copy-pasteable
// string: `OHC1:` + base64url(payload bytes). The payload is the profile
// JSON, gzip-compressed via the built-in CompressionStream when the browser
// has it, or plain UTF-8 JSON otherwise. The decoder tells the two apart by
// the gzip magic bytes (0x1f 0x8b), so codes from either encoder are
// interchangeable. Pure client-side — nothing touches a server.

export const SHARE_CODE_PREFIX = 'OHC1:';

const bytesToBase64Url = (bytes) => {
  let bin = '';
  const CHUNK = 0x8000; // avoid call-stack limits on large profiles
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlToBytes = (str) => {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const hasStreamSupport = () => typeof Response === 'function' && typeof ReadableStream === 'function';
const hasCompressionStream = () => typeof CompressionStream === 'function' && hasStreamSupport();
const hasDecompressionStream = () => typeof DecompressionStream === 'function' && hasStreamSupport();

const pipeBytes = async (bytes, transform) => {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Uint8Array(await new Response(source.pipeThrough(transform)).arrayBuffer());
};

/**
 * Encode an arbitrary JSON-serializable object as an OHC1 share code.
 * Uses gzip when CompressionStream is available; falls back to plain
 * base64url JSON otherwise (feature-detected, not assumed).
 */
export async function encodeShareCode(obj) {
  const json = JSON.stringify(obj);
  const raw = new TextEncoder().encode(json);
  let payload = raw;
  if (hasCompressionStream()) {
    try {
      payload = await pipeBytes(raw, new CompressionStream('gzip'));
    } catch {
      payload = raw; // compression failed — plain JSON still round-trips
    }
  }
  return SHARE_CODE_PREFIX + bytesToBase64Url(payload);
}

/**
 * Decode an OHC1 share code back to its object.
 * Returns null for anything that is not a valid code (bad prefix, bad
 * base64, bad JSON, or a gzip payload in a browser without
 * DecompressionStream).
 */
export async function decodeShareCode(code) {
  try {
    const trimmed = String(code || '').trim();
    if (!trimmed.startsWith(SHARE_CODE_PREFIX)) return null;
    let bytes = base64UrlToBytes(trimmed.slice(SHARE_CODE_PREFIX.length));
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (!hasDecompressionStream()) return null; // gzip code, no way to inflate
      bytes = await pipeBytes(bytes, new DecompressionStream('gzip'));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Build a share code for a saved profile.
 * Returns the code string, or null if the profile doesn't exist.
 */
export async function exportProfileShareCode(name) {
  const profiles = getProfiles();
  const profile = profiles[name];
  if (!profile?.snapshot) return null;
  return encodeShareCode({ name, version: 1, snapshot: profile.snapshot });
}

/**
 * Import a profile from a share code and save it under a new name
 * (suffixed if the name is taken). Returns the saved name, or null on
 * any validation failure.
 */
export async function importProfileFromShareCode(code) {
  const data = await decodeShareCode(code);
  if (!data || typeof data !== 'object' || !data.name || !data.snapshot || typeof data.snapshot !== 'object') {
    return null;
  }
  return importProfile(JSON.stringify({ name: String(data.name), snapshot: data.snapshot }));
}

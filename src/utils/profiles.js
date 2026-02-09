/**
 * Profile Manager for OpenHamClock
 * Allows saving/loading named layout & preference profiles
 * so multiple operators can share one HamClock with different views,
 * or a single operator can switch between saved configurations.
 *
 * A profile is a snapshot of all openhamclock_* localStorage keys.
 */

const PROFILES_KEY = 'openhamclock_profiles';
const ACTIVE_KEY = 'openhamclock_activeProfile';

// All localStorage keys that belong to a profile snapshot
// (everything except the profiles store itself and the active profile pointer)
const SNAPSHOT_KEYS = [
  'openhamclock_config',
  'openhamclock_dockLayout',
  'openhamclock_dxFilters',
  'openhamclock_dxLocation',
  'openhamclock_dxLocked',
  'openhamclock_mapLayers',
  'openhamclock_mapSettings',
  'openhamclock_pskActiveTab',
  'openhamclock_pskFilters',
  'openhamclock_pskPanelMode',
  'openhamclock_satelliteFilters',
  'openhamclock_solarImageType',
  'openhamclock_solarPanelMode',
  'openhamclock_tempUnit',
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
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
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
 * Restore a snapshot to localStorage (replaces all openhamclock_ keys)
 */
function restoreSnapshot(snapshot) {
  // Clear all current openhamclock_ keys (except profiles store and active pointer)
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('openhamclock_') && key !== PROFILES_KEY && key !== ACTIVE_KEY) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));

  // Write snapshot keys
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== PROFILES_KEY && key !== ACTIVE_KEY) {
      localStorage.setItem(key, value);
    }
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
 * Returns true if successful, false if profile not found
 */
export function loadProfile(name) {
  const profiles = getProfiles();
  const profile = profiles[name];
  if (!profile?.snapshot) return false;

  restoreSnapshot(profile.snapshot);
  localStorage.setItem(ACTIVE_KEY, name);
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
  return JSON.stringify({
    name,
    version: 1,
    exportedAt: new Date().toISOString(),
    ...profile,
  }, null, 2);
}

/**
 * Export current live state as a JSON string (without needing a saved profile)
 */
export function exportCurrentState(name = 'Exported') {
  return JSON.stringify({
    name,
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshot: takeSnapshot(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, null, 2);
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

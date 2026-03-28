/**
 * relaySession — shared relay session ID for all cloud-relay-delivered data.
 *
 * The rig-bridge cloud relay plugin pushes all data types (WSJTX decodes,
 * APRS packets, MeshCom packets) under a single session ID sent in the
 * x-relay-session request header. Every hook that consumes relay data must
 * poll with this same ID so the server can return the correct per-user data.
 *
 * The canonical localStorage key is 'ohc-relay-session'. On first load the
 * function migrates any existing 'ohc-wsjtx-session' value so users do not
 * need to reconfigure rig-bridge after upgrading.
 *
 * NOTE: IDs are intentionally kept to 8–12 lowercase alphanumeric chars.
 * Longer UUIDs in query strings trigger false positives in Bitdefender and
 * similar security software that flag them as "tracking tokens".
 */

const RELAY_KEY = 'ohc-relay-session';
const LEGACY_KEY = 'ohc-wsjtx-session'; // migrated on first read

function isValidId(id) {
  // Accept 8–32 char lowercase alphanumeric strings.
  // Lower bound (8): long enough to avoid accidental collisions.
  // Upper bound (32): accommodates both the 8-char IDs generated here and
  // the 16-char hex IDs produced by the /api/rig-bridge/relay/configure
  // endpoint (crypto.randomBytes(8).toString('hex') = 16 chars).
  // Uppercase is rejected — all generators in this codebase produce lowercase.
  return typeof id === 'string' && id.length >= 8 && id.length <= 32 && /^[a-z0-9]+$/.test(id);
}

function generate() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Return the persistent relay session ID for this browser, creating one if
 * necessary. The result is stable for the lifetime of the localStorage entry.
 */
export function getRelaySessionId() {
  try {
    // 1. Prefer the canonical relay key
    const current = localStorage.getItem(RELAY_KEY);
    if (isValidId(current)) return current;

    // 2. Migrate from the legacy WSJTX key (preserves existing rig-bridge configs)
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (isValidId(legacy)) {
      localStorage.setItem(RELAY_KEY, legacy);
      return legacy;
    }

    // 3. First-time setup — generate and persist a new ID
    const id = generate();
    localStorage.setItem(RELAY_KEY, id);
    return id;
  } catch {
    // Privacy browsers that block localStorage — return a session-scoped ID
    return generate();
  }
}

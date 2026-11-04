/**
 * Session-only UI flags shared across components without prop drilling.
 *
 * Nothing here is persisted: a reload resets every flag (HamClock behaviour
 * for demo mode and the `set_title` override). Consumers read with
 * getFlag()/useSessionFlag() and are notified through a window event.
 *
 * Known flags:
 *   demoMode      boolean  – Settings → Display → Demo mode
 *   titleOverride {text,fg,bg}|null – remote `/title` command
 *   kioskLocked   boolean  – mirrors utils/kioskLock (kept here for cheap subscriptions)
 *   timeOffsetMs  number   – remote `/time` command (consumers may ignore)
 *   remoteStatus  'off'|'connecting'|'connected'|'error'|'rejected' (id paired to another browser)
 */

export const SESSION_FLAG_EVENT = 'ohc:session-flag';

const flags = {
  demoMode: false,
  titleOverride: null,
  kioskLocked: false,
  timeOffsetMs: 0,
  remoteStatus: 'off',
};

export function getFlag(name) {
  return flags[name];
}

export function getAllFlags() {
  return { ...flags };
}

export function setFlag(name, value) {
  if (!(name in flags)) return;
  if (flags[name] === value) return;
  flags[name] = value;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_FLAG_EVENT, { detail: { name, value } }));
  } catch {
    /* non-browser env */
  }
}

/** Test helper — reset everything to defaults. */
export function resetFlags() {
  flags.demoMode = false;
  flags.titleOverride = null;
  flags.kioskLocked = false;
  flags.timeOffsetMs = 0;
  flags.remoteStatus = 'off';
}

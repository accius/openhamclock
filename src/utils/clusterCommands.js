/**
 * clusterCommands (browser side) — the same rules the server enforces in
 * server/utils/clusterCommands.js, so the Settings UI and the Cluster Console
 * can flag a bad command before it is ever sent.
 */
export const CLUSTER_COMMAND_MAX_LENGTH = 120;
export const CLUSTER_COMMANDS_MAX = 10;
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;
const SESSION_ENDING_RE = /^(bye|quit|exit|logout|q)\b/i;

/** @returns {{ ok: true, command: string } | { ok: false, reason: string }} */
export const validateClusterCommand = (input) => {
  if (typeof input !== 'string') return { ok: false, reason: 'command must be text' };
  const command = input.trim();
  if (!command) return { ok: false, reason: 'command is empty' };
  if (command.length > CLUSTER_COMMAND_MAX_LENGTH) {
    return { ok: false, reason: `max ${CLUSTER_COMMAND_MAX_LENGTH} characters` };
  }
  if (/[\r\n]/.test(input)) return { ok: false, reason: 'one line only' };
  if (!PRINTABLE_ASCII_RE.test(command)) return { ok: false, reason: 'printable ASCII only' };
  if (SESSION_ENDING_RE.test(command)) return { ok: false, reason: 'session-ending commands are not allowed' };
  return { ok: true, command };
};

/**
 * Normalize the login-command list kept in config.customDxCluster.loginCommands.
 * Accepts strings or { cmd, enabled } objects; drops blanks; caps the count.
 */
export const normalizeLoginCommands = (list) => {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const cmd = typeof item === 'string' ? item : String(item?.cmd ?? '');
    const enabled = typeof item === 'string' ? true : item?.enabled !== false;
    const trimmed = cmd.replace(/[\r\n]/g, ' ').slice(0, CLUSTER_COMMAND_MAX_LENGTH);
    if (!trimmed.trim()) continue;
    out.push({ cmd: trimmed, enabled });
    if (out.length >= CLUSTER_COMMANDS_MAX) break;
  }
  return out;
};

/**
 * The `cmds` query value for /api/dxcluster/paths: a JSON array of the
 * enabled, valid commands — or '' when there is nothing to send.
 */
export const serializeLoginCommands = (list) => {
  const enabled = normalizeLoginCommands(list)
    .filter((c) => c.enabled)
    .map((c) => validateClusterCommand(c.cmd))
    .filter((v) => v.ok)
    .map((v) => v.command);
  return enabled.length ? JSON.stringify(enabled) : '';
};

export default { validateClusterCommand, normalizeLoginCommands, serializeLoginCommands };

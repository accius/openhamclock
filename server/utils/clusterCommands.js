/**
 * clusterCommands — validation for native DX-cluster commands a user asks the
 * server to type into their own telnet session (login commands sent once
 * after login, and the Cluster Console input line).
 *
 * These strings end up on a raw telnet socket, so the rules are strict:
 * one line each, printable ASCII only (no control characters, no CR/LF —
 * telnet command injection), at most 120 characters, at most 10 login
 * commands, and nothing that ends the session (bye/quit/exit) — the
 * persistent-session machinery would only reconnect and re-log, which is
 * exactly the churn sysops complain about.
 *
 * Mirrored (ESM) in src/utils/clusterCommands.js for the UI.
 */

const CLUSTER_COMMAND_MAX_LENGTH = 120;
const CLUSTER_COMMANDS_MAX = 10;
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;
const SESSION_ENDING_RE = /^(bye|quit|exit|logout|q)\b/i;

/**
 * Validate one command line.
 * @returns {{ ok: true, command: string } | { ok: false, reason: string }}
 */
function validateClusterCommand(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'command must be a string' };
  const command = input.trim();
  if (!command) return { ok: false, reason: 'command is empty' };
  if (command.length > CLUSTER_COMMAND_MAX_LENGTH) {
    return { ok: false, reason: `command longer than ${CLUSTER_COMMAND_MAX_LENGTH} characters` };
  }
  if (/[\r\n]/.test(input)) return { ok: false, reason: 'command must be a single line' };
  if (!PRINTABLE_ASCII_RE.test(command))
    return { ok: false, reason: 'command contains control or non-ASCII characters' };
  if (SESSION_ENDING_RE.test(command)) return { ok: false, reason: 'session-ending commands are not allowed' };
  return { ok: true, command };
}

/**
 * Parse and validate the `cmds` query parameter (a JSON array of strings).
 * Invalid entries are dropped, never partially sent; the list is capped.
 * @returns {{ commands: string[], errors: string[] }}
 */
function parseLoginCommands(raw) {
  if (raw == null || raw === '') return { commands: [], errors: [] };
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return { commands: [], errors: ['cmds is not a JSON array'] };
    }
  }
  if (!Array.isArray(list)) return { commands: [], errors: ['cmds is not a JSON array'] };
  const commands = [];
  const errors = [];
  for (const item of list.slice(0, CLUSTER_COMMANDS_MAX)) {
    const v = validateClusterCommand(item);
    if (v.ok) commands.push(v.command);
    else errors.push(v.reason);
  }
  if (list.length > CLUSTER_COMMANDS_MAX) errors.push(`only the first ${CLUSTER_COMMANDS_MAX} commands are used`);
  return { commands, errors };
}

module.exports = {
  CLUSTER_COMMAND_MAX_LENGTH,
  CLUSTER_COMMANDS_MAX,
  validateClusterCommand,
  parseLoginCommands,
};

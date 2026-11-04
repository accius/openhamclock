import { describe, it, expect } from 'vitest';
import {
  validateClusterCommand,
  parseLoginCommands,
  CLUSTER_COMMAND_MAX_LENGTH,
  CLUSTER_COMMANDS_MAX,
} from './clusterCommands.js';

describe('validateClusterCommand', () => {
  it('accepts ordinary cluster commands and trims them', () => {
    expect(validateClusterCommand('  set/filter dxbm/pass 20,15 ')).toEqual({
      ok: true,
      command: 'set/filter dxbm/pass 20,15',
    });
    expect(validateClusterCommand('sh/dx 10').ok).toBe(true);
    expect(validateClusterCommand('set/skimmer').ok).toBe(true);
    expect(validateClusterCommand('SH/WWV').ok).toBe(true);
  });

  it('rejects empty, non-string and over-long input', () => {
    expect(validateClusterCommand('').ok).toBe(false);
    expect(validateClusterCommand('   ').ok).toBe(false);
    expect(validateClusterCommand(null).ok).toBe(false);
    expect(validateClusterCommand(42).ok).toBe(false);
    expect(validateClusterCommand('x'.repeat(CLUSTER_COMMAND_MAX_LENGTH)).ok).toBe(true);
    expect(validateClusterCommand('x'.repeat(CLUSTER_COMMAND_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it('rejects telnet injection: newlines and control characters', () => {
    expect(validateClusterCommand('sh/dx\r\nbye').ok).toBe(false);
    expect(validateClusterCommand('sh/dx\nset/dx').ok).toBe(false);
    expect(validateClusterCommand('sh/dx\x00').ok).toBe(false);
    expect(validateClusterCommand('sh/dx\x1b[2J').ok).toBe(false);
    expect(validateClusterCommand('sh/dx\t5').ok).toBe(false);
    expect(validateClusterCommand('sh/dx é').ok).toBe(false);
  });

  it('rejects session-ending commands', () => {
    for (const c of ['bye', 'BYE', 'quit', 'exit', 'logout', 'q', 'bye now']) {
      expect(validateClusterCommand(c).ok).toBe(false);
    }
    // ...but not commands that merely start with those letters
    expect(validateClusterCommand('quiet').ok).toBe(true);
  });
});

describe('parseLoginCommands', () => {
  it('parses a JSON array and keeps only valid commands', () => {
    const r = parseLoginCommands(JSON.stringify(['set/skimmer', 'bye', 'set/filter dxbm/pass 20,15', 'bad\nline']));
    expect(r.commands).toEqual(['set/skimmer', 'set/filter dxbm/pass 20,15']);
    expect(r.errors).toHaveLength(2);
  });

  it('caps the list', () => {
    const many = Array.from({ length: CLUSTER_COMMANDS_MAX + 5 }, (_, i) => `sh/dx ${i}`);
    const r = parseLoginCommands(JSON.stringify(many));
    expect(r.commands).toHaveLength(CLUSTER_COMMANDS_MAX);
    expect(r.errors.some((e) => /first 10/.test(e))).toBe(true);
  });

  it('tolerates garbage input', () => {
    expect(parseLoginCommands('')).toEqual({ commands: [], errors: [] });
    expect(parseLoginCommands(undefined)).toEqual({ commands: [], errors: [] });
    expect(parseLoginCommands('{not json').commands).toEqual([]);
    expect(parseLoginCommands('"a string"').commands).toEqual([]);
    expect(parseLoginCommands(['set/skimmer']).commands).toEqual(['set/skimmer']);
  });
});

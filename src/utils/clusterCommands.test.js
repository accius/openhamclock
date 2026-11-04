import { describe, it, expect } from 'vitest';
import { validateClusterCommand, normalizeLoginCommands, serializeLoginCommands } from './clusterCommands.js';

describe('clusterCommands (client)', () => {
  it('validates like the server', () => {
    expect(validateClusterCommand('set/skimmer').ok).toBe(true);
    expect(validateClusterCommand('sh/dx\nbye').ok).toBe(false);
    expect(validateClusterCommand('bye').ok).toBe(false);
    expect(validateClusterCommand('x'.repeat(121)).ok).toBe(false);
  });

  it('normalizes strings and objects, drops blanks, caps at 10', () => {
    const list = normalizeLoginCommands(['set/skimmer', { cmd: ' ', enabled: true }, { cmd: 'sh/dx', enabled: false }]);
    expect(list).toEqual([
      { cmd: 'set/skimmer', enabled: true },
      { cmd: 'sh/dx', enabled: false },
    ]);
    expect(normalizeLoginCommands(Array.from({ length: 15 }, (_, i) => `c${i}`))).toHaveLength(10);
    expect(normalizeLoginCommands(null)).toEqual([]);
  });

  it('serializes only enabled, valid commands', () => {
    expect(
      serializeLoginCommands([
        { cmd: 'set/skimmer', enabled: true },
        { cmd: 'sh/dx 5', enabled: false },
        { cmd: 'bye', enabled: true },
      ]),
    ).toBe(JSON.stringify(['set/skimmer']));
    expect(serializeLoginCommands([])).toBe('');
    expect(serializeLoginCommands([{ cmd: 'bye', enabled: true }])).toBe('');
  });
});

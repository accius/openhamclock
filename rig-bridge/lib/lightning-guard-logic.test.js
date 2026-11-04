// @vitest-environment node
/**
 * The bridge's lightning guard logic is generated from the browser's single
 * source (src/utils/lightningGuard.js). These tests fail when the committed
 * copy is stale — run `npm run lightning:sync` — and check the copy behaves
 * like the source.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { generate, toCommonJs, TARGETS } from '../../scripts/lightning-guard-cjs.mjs';
import * as esm from '../../src/utils/lightningGuard.js';

const cjs = require('./lightning-guard-logic.js');

describe('lightning-guard-logic.js (generated)', () => {
  it('both copies (bridge, server) are up to date with src/utils/lightningGuard.js', async () => {
    expect(TARGETS).toHaveLength(2);
    for (const target of TARGETS) expect(fs.readFileSync(target, 'utf8')).toBe(await generate(target));
  });

  it('exports exactly what the ESM source exports', () => {
    expect(Object.keys(cjs).sort()).toEqual(Object.keys(esm).sort());
    expect(Object.keys(require('../../server/utils/lightning-guard-logic.js')).sort()).toEqual(Object.keys(esm).sort());
  });

  it('behaves the same (state machine sample)', () => {
    const de = { lat: 45, lon: 7 };
    const now = 1_800_000_000_000;
    const p = esm.destinationPoint(de.lat, de.lon, 12, 90);
    const strike = { id: 'a', lat: p.lat, lon: p.lon, timestamp: now };
    const run = (m) => {
      const r = new m.GuardRunner({ enabled: true });
      return r.step([strike], de, now).status.level;
    };
    expect(run(cjs)).toBe('alarm');
    expect(run(esm)).toBe('alarm');
  });

  it('the converter refuses imports and default exports', () => {
    expect(() => toCommonJs("import x from 'y';\nexport const a = 1;")).toThrow(/must not import/);
    expect(() => toCommonJs('export default 1;')).toThrow(/export const/);
    expect(toCommonJs('export function f() {}\nexport const B = 2;')).toContain('module.exports = {\n  f,\n  B,\n};');
  });
});

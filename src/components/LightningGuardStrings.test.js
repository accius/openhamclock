// @vitest-environment node
/**
 * Lightning guard strings: every t('lightningGuard.…', { defaultValue }) in
 * the UI and the engine matches its key in src/lang/en.json, and en.json has
 * no lightningGuard keys nobody uses. Other languages fall back to English
 * until translated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const FILES = [
  'src/components/LightningGuardIndicator.jsx',
  'src/components/LightningGuardSettings.jsx',
  'src/hooks/useLightningGuard.js',
];
const CALL = /\bt\(\s*'(lightningGuard\.[^']+)',\s*\{\s*defaultValue:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

function collect() {
  const found = new Map();
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(CALL)) {
      found.set(m[1], new Function(`return ${m[2]}`)());
    }
  }
  return found;
}

describe('lightning guard strings', () => {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lang/en.json'), 'utf8'));
  const used = collect();

  it('finds the strings', () => {
    expect(used.size).toBeGreaterThan(60);
  });

  it('every defaultValue equals its en.json entry', () => {
    const mismatched = [...used].filter(([k, v]) => en[k] !== v).map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it('en.json has no unused lightningGuard keys', () => {
    const unused = Object.keys(en).filter((k) => k.startsWith('lightningGuard.') && !used.has(k));
    expect(unused).toEqual([]);
  });

  it('no computed lightningGuard keys (they cannot be checked)', () => {
    for (const f of FILES) {
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).not.toMatch(/t\(\s*`lightningGuard/);
    }
  });
});

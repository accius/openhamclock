/**
 * Tests must never touch the user's real rig-bridge-config.json: the shared
 * vitest setup (src/test/setup.js) sets RIG_BRIDGE_CONFIG_DIR to a temp dir,
 * and core/config.js uses it outright.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

describe('rig-bridge config location under test', () => {
  it('is the RIG_BRIDGE_CONFIG_DIR temp dir, not the real config', () => {
    const { CONFIG_DIR, CONFIG_PATH } = require('./config.js');
    expect(process.env.RIG_BRIDGE_CONFIG_DIR).toBeTruthy();
    expect(CONFIG_DIR).toBe(process.env.RIG_BRIDGE_CONFIG_DIR);
    expect(CONFIG_PATH).toBe(path.join(process.env.RIG_BRIDGE_CONFIG_DIR, 'rig-bridge-config.json'));
    expect(CONFIG_PATH).not.toBe(path.join(os.homedir(), '.config', 'openhamclock', 'rig-bridge-config.json'));
  });
});

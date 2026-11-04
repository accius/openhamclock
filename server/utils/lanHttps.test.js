// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { startLanHttps, subjectAltNames, ensureSelfSignedCert } from './lanHttps.js';

const haveOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('lanHttps', () => {
  let started = null;
  let dir = null;
  afterEach(async () => {
    if (started) await new Promise((r) => started.server.close(r));
    started = null;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('lists localhost, the host name (.local) and LAN IPs as alt names', () => {
    expect(subjectAltNames('shackpi', ['192.168.1.20', 'fe80::1'])).toBe(
      'DNS:localhost,IP:127.0.0.1,DNS:shackpi,DNS:shackpi.local,IP:192.168.1.20',
    );
    expect(subjectAltNames('bad host!', [])).toBe('DNS:localhost,IP:127.0.0.1');
  });

  it('does nothing unless HTTPS_PORT is set', async () => {
    expect(await startLanHttps(express(), { env: {} })).toBeNull();
  });

  it('logs and carries on when the certificate cannot be made', async () => {
    const logs = [];
    const r = await startLanHttps(express(), {
      env: { HTTPS_PORT: '0', HTTPS_CERT: '/nonexistent/cert.pem', HTTPS_KEY: '/nonexistent/key.pem' },
      log: (m) => logs.push(m),
    });
    expect(r).toBeNull();
    expect(logs.join('\n')).toMatch(/Could not start the HTTPS listener/);
  });

  it.skipIf(!haveOpenssl)('generates a self-signed cert once and serves the app over HTTPS', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-https-'));
    const app = express();
    app.get('/ping', (req, res) => res.json({ ok: true, secure: req.secure }));
    started = await startLanHttps(app, {
      env: { HTTPS_PORT: '0', HTTPS_CERT_DIR: dir },
      host: '127.0.0.1',
      log: () => {},
    });
    expect(started).not.toBeNull();
    // listens only on the requested host (server.js passes HOST)
    expect(started.server.address().address).toBe('127.0.0.1');
    expect(fs.existsSync(path.join(dir, 'cert.pem'))).toBe(true);
    const text = execFileSync('openssl', ['x509', '-in', path.join(dir, 'cert.pem'), '-noout', '-text'], {
      encoding: 'utf8',
    });
    expect(text).toMatch(/DNS:localhost/);
    const body = await new Promise((resolve, reject) => {
      https
        .get({ host: '127.0.0.1', port: started.port, path: '/ping', rejectUnauthorized: false }, (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(JSON.parse(b)));
        })
        .on('error', reject);
    });
    expect(body).toEqual({ ok: true, secure: true });
    // second call reuses the stored pair
    expect(ensureSelfSignedCert(dir).created).toBe(false);
  });
});

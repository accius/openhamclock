// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import { getClientIP, setTrustCloudflare } from './helpers.js';

const fakeReq = (headers = {}, ip = '203.0.113.9') => ({ headers, ip, socket: { remoteAddress: ip } });
const CF = { 'cf-ray': '8a1b2c3d4e5f-LHR', 'cf-connecting-ip': '198.51.100.7' };

describe('getClientIP', () => {
  afterEach(() => setTrustCloudflare(false));

  it('ignores CF-Connecting-IP unless TRUST_CLOUDFLARE is enabled', () => {
    expect(getClientIP(fakeReq(CF))).toBe('203.0.113.9');
  });

  it('uses CF-Connecting-IP when enabled and CF-Ray is present', () => {
    setTrustCloudflare(true);
    expect(getClientIP(fakeReq(CF))).toBe('198.51.100.7');
  });

  it('ignores CF-Connecting-IP without CF-Ray even when enabled', () => {
    setTrustCloudflare(true);
    expect(getClientIP(fakeReq({ 'cf-connecting-ip': '198.51.100.7' }))).toBe('203.0.113.9');
  });

  it('only accepts a literal true', () => {
    setTrustCloudflare('true');
    expect(getClientIP(fakeReq(CF))).toBe('203.0.113.9');
  });

  it('falls back to the socket address when req.ip is missing', () => {
    expect(getClientIP({ headers: {}, socket: { remoteAddress: '192.0.2.4' } })).toBe('192.0.2.4');
    expect(getClientIP({ headers: {} })).toBe('unknown');
  });

  // X-Forwarded-For handling is Express's job (req.ip under `trust proxy`).
  async function ipSeenBy(trustProxy, headers) {
    const app = express();
    app.set('trust proxy', trustProxy);
    app.get('/', (req, res) => res.send(getClientIP(req)));
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      return await new Promise((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: server.address().port, path: '/', headers }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve(body));
          })
          .on('error', reject);
      });
    } finally {
      server.close();
    }
  }

  it('honours X-Forwarded-For via req.ip only when trust proxy is on', async () => {
    const headers = { 'x-forwarded-for': '198.51.100.20' };
    expect(await ipSeenBy(1, headers)).toBe('198.51.100.20');
    expect(await ipSeenBy(false, headers)).toMatch(/127\.0\.0\.1$/);
  });

  it('with trust proxy 1, a client-prepended X-Forwarded-For entry is ignored', async () => {
    // Client sends "spoofed"; the proxy appends the real peer address.
    const headers = { 'x-forwarded-for': '10.6.6.6, 198.51.100.20' };
    expect(await ipSeenBy(1, headers)).toBe('198.51.100.20');
  });

  it('forged Cloudflare headers do not override req.ip by default', async () => {
    expect(await ipSeenBy(false, CF)).toMatch(/127\.0\.0\.1$/);
  });
});

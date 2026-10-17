// @vitest-environment node
/**
 * wavelog-forward plugin — driven over a real UDP socket against a stub
 * Wavelog HTTP server, with the retry queue in a temp file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import dgram from 'dgram';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import plugin from './wavelog-forward.js';

const adifPacket = (call) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<QsoLoggedInfoAdif>\n<AppVersion>test</AppVersion>\n` +
  `<ADIF>&lt;call:${call.length}&gt;${call} &lt;qso_date:8&gt;20261016 &lt;time_on:6&gt;003615 ` +
  `&lt;band:3&gt;20m &lt;mode:3&gt;FT8 &lt;eor&gt;</ADIF>\n</QsoLoggedInfoAdif>`;
const contactInfo = '<?xml version="1.0"?>\n<contactinfo><call>AA1AA</call><band>14</band></contactinfo>';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

const freePort = () =>
  new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** Stub Wavelog: answers each POST with the next status in `statuses` (last one repeats). */
async function stubWavelog(statuses = [201]) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: JSON.parse(body || '{}') });
      const code = statuses.length > 1 ? statuses.shift() : statuses[0];
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(code < 300 ? { status: 'created' } : { status: 'failed', reason: 'nope' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

function start(cfg) {
  const inst = plugin.create({ wavelogForward: { enabled: true, retryBaseMs: 20, ...cfg } }, {});
  inst.connect();
  cleanups.push(async () => inst.disconnect());
  return inst;
}

const send = (port, text) =>
  new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.send(Buffer.from(text), port, '127.0.0.1', (err) => {
      s.close();
      err ? reject(err) : resolve();
    });
  });

async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const tmpQueue = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-fwd-'));
  cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'queue.json');
};

describe('wavelog-forward', () => {
  it('posts a logged QSO to the Wavelog API as ADIF', async () => {
    const wl = await stubWavelog();
    const udpPort = await freePort();
    const inst = start({ url: `${wl.url}/`, apiKey: 'k1', stationProfileId: '1', udpPort, queueFile: tmpQueue() });
    await until(() => inst.getStatus().running);

    await send(udpPort, adifPacket('AA1AA'));
    await until(() => wl.requests.length === 1);

    expect(wl.requests[0].method).toBe('POST');
    expect(wl.requests[0].url).toBe('/index.php/api/qso');
    expect(wl.requests[0].body).toEqual({
      key: 'k1',
      station_profile_id: '1',
      type: 'adif',
      string: '<call:5>AA1AA <qso_date:8>20261016 <time_on:6>003615 <band:3>20m <mode:3>FT8 <eor>',
    });
    await until(() => inst.getStatus().forwarded === 1);
    expect(inst.getStatus().queued).toBe(0);
  });

  it('ignores N1MM contact packets', async () => {
    const wl = await stubWavelog();
    const udpPort = await freePort();
    const inst = start({ url: wl.url, apiKey: 'k1', stationProfileId: '1', udpPort, queueFile: tmpQueue() });
    await until(() => inst.getStatus().running);

    await send(udpPort, contactInfo);
    await send(udpPort, adifPacket('BB2BB'));
    await until(() => wl.requests.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(wl.requests).toHaveLength(1);
    expect(wl.requests[0].body.string).toMatch(/^<call:5>BB2BB /);
  });

  it('keeps retrying while Wavelog is unavailable, then delivers', async () => {
    const wl = await stubWavelog([503, 503, 201]);
    const udpPort = await freePort();
    const inst = start({ url: wl.url, apiKey: 'k1', stationProfileId: '1', udpPort, queueFile: tmpQueue() });
    await until(() => inst.getStatus().running);

    await send(udpPort, adifPacket('AA1AA'));
    await until(() => inst.getStatus().forwarded === 1);
    expect(wl.requests).toHaveLength(3);
    expect(inst.getStatus().queued).toBe(0);
  });

  it('drops a QSO Wavelog rejects (bad key) instead of retrying forever', async () => {
    const wl = await stubWavelog([401]);
    const udpPort = await freePort();
    const inst = start({ url: wl.url, apiKey: 'wrong', stationProfileId: '1', udpPort, queueFile: tmpQueue() });
    await until(() => inst.getStatus().running);

    await send(udpPort, adifPacket('AA1AA'));
    await until(() => inst.getStatus().rejected === 1);
    await new Promise((r) => setTimeout(r, 150));
    expect(wl.requests).toHaveLength(1);
    expect(inst.getStatus().queued).toBe(0);
    expect(inst.getStatus().lastError).toMatch(/401/);
  });

  it('keeps unsent QSOs across a restart', async () => {
    const queueFile = tmpQueue();
    const udpPort = await freePort();
    // Wavelog unreachable: nothing listens on this port.
    const deadPort = await freePort();
    const first = start({
      url: `http://127.0.0.1:${deadPort}`,
      apiKey: 'k1',
      stationProfileId: '1',
      udpPort,
      queueFile,
    });
    await until(() => first.getStatus().running);
    await send(udpPort, adifPacket('AA1AA'));
    await until(() => first.getStatus().queued === 1);
    first.disconnect();

    const wl = await stubWavelog();
    const second = start({ url: wl.url, apiKey: 'k1', stationProfileId: '1', udpPort, queueFile });
    await until(() => wl.requests.length === 1);
    expect(wl.requests[0].body.string).toMatch(/^<call:5>AA1AA /);
    await until(() => second.getStatus().queued === 0);
  });

  it('does not start without url, apiKey and stationProfileId', async () => {
    const udpPort = await freePort();
    const inst = start({ url: '', apiKey: 'k1', stationProfileId: '1', udpPort, queueFile: tmpQueue() });
    await new Promise((r) => setTimeout(r, 50));
    expect(inst.getStatus().running).toBe(false);
    expect(inst.getStatus().lastError).toMatch(/url, apiKey and stationProfileId are required/);
  });
});

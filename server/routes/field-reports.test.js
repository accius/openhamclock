/**
 * Field Reports ingest — the source tag that lets the EmComm layout label
 * Winlink and NBEMS traffic apart. Handlers are captured from a stub app and
 * called directly; persistence goes to a temp file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let dir;
let routes;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-fr-'));
  process.env.FIELD_REPORTS_FILE = path.join(dir, 'field-reports.json');
  routes = {};
  const app = {
    post: (p, ...h) => (routes[`POST ${p}`] = h[h.length - 1]),
    get: (p, fn) => (routes[`GET ${p}`] = fn),
  };
  const noop = () => {};
  require('./field-reports.js')(app, { ROOT_DIR: dir, logInfo: noop, logWarn: noop, logDebug: noop });
});

afterAll(() => {
  delete process.env.FIELD_REPORTS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = (key, req) =>
  new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) {
        this.code = c;
        return this;
      },
      json(body) {
        resolve({ code: this.code, body });
      },
    };
    routes[key]({ query: {}, ...req }, res);
  });

describe('field reports source', () => {
  it('keeps the ingest path a report came through', async () => {
    const post = await call('POST /api/emcomm/field-reports', {
      body: {
        reports: [
          { id: 'n1', callsign: 'ke8plm', formType: 'ICS-213 (NBEMS)', text: 'Cots', receivedVia: 'nbems-flmsg' },
          { id: 'w1', callsign: 'n8tag', formType: 'Field Situation Report', receivedVia: 'winlink-express-csv' },
          { id: 'x1', callsign: 'w1aw', formType: 'Other', source: '<b>evil</b>' },
        ],
      },
    });
    expect(post.body).toMatchObject({ ok: true, added: 3 });
    const got = await call('GET /api/emcomm/field-reports', {});
    const byId = Object.fromEntries(got.body.reports.map((r) => [r.id, r]));
    expect(byId.n1).toMatchObject({ source: 'nbems-flmsg', callsign: 'KE8PLM', formType: 'ICS-213 (NBEMS)' });
    expect(byId.w1.source).toBe('winlink-express-csv');
    expect(byId.x1.source).toBe('bevilb');
  });
});

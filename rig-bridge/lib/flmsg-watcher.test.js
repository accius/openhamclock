/**
 * flmsg-watcher — real temp folders laid out like NBEMS.files: received
 * transfers vs the operator's drafts and sent forms, de-duplication of a
 * received form and its saved copy, old traffic, and unreadable transfers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import watcherLib from './flmsg-watcher.js';
import fmt from './flmsg-format.js';

const { createFlmsgWatcher, defaultFlmsgDirs, folderKind, classifyOrigin } = watcherLib;
const { buildIcs213, serializeFlmsg, wrapFlmsg } = fmt;

let root;
let messages;
let recv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-flmsg-'));
  messages = path.join(root, 'ICS', 'messages');
  recv = path.join(root, 'WRAP', 'recv');
  fs.mkdirSync(messages, { recursive: true });
  fs.mkdirSync(recv, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const WHEN = Date.UTC(2026, 9, 15, 12, 0);
/** A form as flmsg writes it once `call` has sent it (hdr_fm set); call '' = never sent. */
const form = (subject, call = 'N8TAG') =>
  buildIcs213({ to: 'EOC', subject, message: `${subject} body` }, { call, when: WHEN });

const make = (extra = {}) => {
  const got = [];
  const w = createFlmsgWatcher({
    dirs: [recv, messages],
    watch: false,
    stationCall: () => 'KE8PLM',
    onForm: (r, f) => got.push({ r, f }),
    ...extra,
  });
  return { w, got };
};

describe('folders and origin', () => {
  it('defaults to WRAP/recv then ICS/messages under the home directory', () => {
    expect(defaultFlmsgDirs('/home/op')).toEqual([
      path.join('/home/op', 'NBEMS.files', 'WRAP', 'recv'),
      path.join('/home/op', 'NBEMS.files', 'ICS', 'messages'),
    ]);
    expect(folderKind('/h/NBEMS.files/WRAP/recv')).toBe('received');
    expect(folderKind('C:\\Users\\op\\NBEMS.files\\ARQ\\recv\\')).toBe('received');
    expect(folderKind('/h/NBEMS.files/ICS/messages')).toBe('local');
    expect(folderKind('/mnt/share/forms')).toBe('auto');
  });

  it('classifies by hdr_fm: never sent = draft, own call = sent, other call = received', () => {
    expect(classifyOrigin({ senders: [] }, 'local', 'KE8PLM')).toBe('local');
    expect(classifyOrigin({ senders: ['KE8PLM'] }, 'local', 'ke8plm-1')).toBe('local');
    expect(classifyOrigin({ senders: ['KE8PLM', 'N8TAG'] }, 'local', 'KE8PLM')).toBe('received');
    expect(classifyOrigin({ senders: ['N8TAG'] }, 'local', '')).toBe('unknown'); // no callsign: can't tell
    expect(classifyOrigin({ senders: [] }, 'local', '')).toBe('local'); // never sent is always a draft
    expect(classifyOrigin({ senders: ['N8TAG'] }, 'auto', '')).toBe('received');
    expect(classifyOrigin({ senders: [] }, 'received', 'KE8PLM')).toBe('received');
  });
});

describe('createFlmsgWatcher', () => {
  it('reports transfers in WRAP/recv as received and drafts/sent forms in ICS/messages as local', () => {
    fs.writeFileSync(path.join(recv, 'extract-20261015-120000.wrap'), wrapFlmsg(form('Water'), 'w.213'));
    fs.writeFileSync(path.join(messages, 'draft.213'), form('Draft', ''));
    fs.writeFileSync(path.join(messages, 'sent.213'), form('Sent by me', 'KE8PLM'));
    fs.writeFileSync(path.join(messages, 'saved.213'), form('Saved received', 'W1AW'));
    fs.writeFileSync(path.join(messages, 'notes.txt'), 'not a form');
    const { w, got } = make();
    expect(w.scan()).toBe(4);
    const by = Object.fromEntries(got.map((g) => [g.r.extra.subject, g.r.origin]));
    expect(by).toEqual({ Water: 'received', Draft: 'local', 'Sent by me': 'local', 'Saved received': 'received' });
    expect(w.scan()).toBe(0);
    expect(w.getStatus()).toMatchObject({
      formsFound: 4,
      byOrigin: { received: 2, local: 2, unknown: 0 },
      skipped: { notForm: 1 },
    });
  });

  it('counts a received transfer and the copy saved from it once', () => {
    const received = form('Cots');
    fs.writeFileSync(path.join(recv, 'extract-1.wrap'), wrapFlmsg(received, 'c.213'));
    // flmsg rewrites hdr_ed when the operator saves it — same message
    const saved = received.replace(':hdr_ed:21 \nN8TAG', ':hdr_ed:22 \nKE8PLM');
    fs.writeFileSync(path.join(messages, 'c.213'), saved);
    const { w } = make();
    expect(w.scan()).toBe(1);
  });

  it('reports a received copy that turns up after a local one', () => {
    const { w, got } = make();
    fs.writeFileSync(path.join(messages, 'c.213'), form('Late', 'KE8PLM'));
    w.scan();
    fs.writeFileSync(path.join(recv, 'extract-2.wrap'), wrapFlmsg(form('Late', 'KE8PLM'), 'c.213'));
    w.scan();
    expect(got.map((g) => g.r.origin)).toEqual(['local', 'received']);
  });

  it('without a station callsign, sent forms in ICS/messages are of unknown origin (drafts stay local)', () => {
    fs.writeFileSync(path.join(messages, 'sent.213'), form('Who sent me', 'N8TAG'));
    fs.writeFileSync(path.join(messages, 'draft.213'), form('Draft', ''));
    const { w, got } = make({ stationCall: () => '' });
    w.scan();
    const by = Object.fromEntries(got.map((g) => [g.r.extra.subject, g.r.origin]));
    expect(by).toEqual({ 'Who sent me': 'unknown', Draft: 'local' });
    expect(w.getStatus().byOrigin).toEqual({ received: 0, local: 1, unknown: 1 });
    // the same form arriving as a transfer is not reported a second time
    fs.writeFileSync(path.join(recv, 'x.wrap'), wrapFlmsg(form('Who sent me', 'N8TAG'), 'x.213'));
    expect(w.scan()).toBe(0);
  });

  it('picks up new and edited files after the first scan', () => {
    const { w, got } = make();
    expect(w.scan()).toBe(0);
    const file = path.join(recv, 'x.wrap');
    fs.writeFileSync(file, wrapFlmsg(form('First'), 'x.213'));
    expect(w.scan()).toBe(1);
    fs.writeFileSync(file, wrapFlmsg(form('Second'), 'x.213'));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(w.scan()).toBe(1);
    expect(got.map((g) => g.r.extra.subject)).toEqual(['First', 'Second']);
  });

  it('on the first scan, skips (but remembers) files older than maxAge', () => {
    const old = path.join(recv, 'old.wrap');
    fs.writeFileSync(old, wrapFlmsg(form('Last year'), 'o.213'));
    const past = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    fs.utimesSync(old, past, past);
    fs.writeFileSync(path.join(recv, 'new.wrap'), wrapFlmsg(form('Today'), 'n.213'));
    const { w, got } = make();
    expect(w.scan()).toBe(1);
    expect(got[0].r.extra.subject).toBe('Today');
  });

  it('passes the date order through to the parser', () => {
    const t = serializeFlmsg({
      form: 'ics213',
      fields: { d1: '03/04/26', t1: '1200Z', mg: 'x' },
      call: 'W1AW',
      when: WHEN,
    });
    fs.writeFileSync(path.join(recv, 'd.213'), t);
    const { w, got } = make({ dateOrder: () => ({ slash: 'dmy' }) });
    w.scan();
    expect(got[0].r.timestamp).toBe(Date.UTC(2026, 3, 3, 12));
  });

  it('reports a damaged compressed transfer as an error, not a form', () => {
    const errors = [];
    fs.writeFileSync(
      path.join(recv, 'z.wrap'),
      wrapFlmsg('<flmsg>4.0.23\n<ics213>\n[b64:start]AUxaTUEAAAA[b64:end]', 'z.213'),
    );
    const { w, got } = make({ onError: (m) => errors.push(m) });
    w.scan();
    expect(got).toHaveLength(0);
    expect(errors[0]).toMatch(/could not be decoded/);
    expect(w.getStatus().skipped.corrupt).toBe(1);
  });

  it('ignores missing folders and reports which exist', () => {
    const { w } = make({ dirs: [recv, path.join(root, 'nope')] });
    expect(w.scan()).toBe(0);
    expect(w.getStatus().dirs).toEqual([
      { path: recv, kind: 'received', exists: true },
      { path: path.join(root, 'nope'), kind: 'auto', exists: false },
    ]);
  });

  it('start() scans immediately and stop() clears timers', () => {
    fs.writeFileSync(path.join(recv, 'e.wrap'), wrapFlmsg(form('Startup'), 'e.213'));
    const { w, got } = make({ pollMs: 60000 });
    w.start();
    expect(got).toHaveLength(1);
    w.stop();
    expect(w.getStatus().running).toBe(false);
  });
});

/**
 * useSharedIncident — two tabs of one browser stay in step (joining, leaving,
 * a join-key change) through storage events, and an admin learns the current
 * join key from the server. Rendered with createRoot/act; fetch is mocked and
 * EventSource is absent in jsdom, so the hook polls GET /api/incident/:id.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useSharedIncident } from './useSharedIncident.js';
import { SESSION_KEY } from '../utils/incidentSync.js';
import { _resetForTests } from '../utils/incidentDocs.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let latest;
let responses;

function Harness() {
  latest = useSharedIncident({ callsign: 'K0CJH', localRoster: [], fieldReports: [], shelterReports: [] });
  return null;
}

const snapshot = (extra = {}) => ({
  id: 'ABCDEFGH',
  seq: 3,
  full: true,
  board: { name: 'Flood', seq: 1 },
  participants: 2,
  roster: [],
  events: [],
  reports: [],
  docs: [],
  deleted: [],
  ...extra,
});

/** Another tab wrote `value` (null = removed) under `key`. */
const otherTab = async (key, value) => {
  if (value == null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
};

describe('useSharedIncident across tabs', () => {
  beforeEach(async () => {
    localStorage.clear();
    _resetForTests();
    responses = { get: snapshot() };
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/ticket') ? { ok: true, ticket: 't' } : responses.get),
    }));
    container = document.createElement('div');
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  });

  it('joins when another tab joins, and leaves when it leaves', async () => {
    expect(latest.joined).toBe(false);
    await otherTab(SESSION_KEY, { id: 'ABCDEFGH', key: 'JOINKEYJOINKEY22', role: 'operator', keyGen: 1, joinedAt: 1 });
    expect(latest.joined).toBe(true);
    expect(latest.session.id).toBe('ABCDEFGH');
    await otherTab(SESSION_KEY, null);
    expect(latest.joined).toBe(false);
    expect(latest.status).toBe('idle');
    expect(latest.error).toBeNull();
  });

  it('when the join key changed under another tab, this tab offers to rejoin too', async () => {
    await otherTab(SESSION_KEY, { id: 'ABCDEFGH', key: 'JOINKEYJOINKEY22', role: 'operator', keyGen: 1, joinedAt: 1 });
    localStorage.setItem('openhamclock_incidentRejoin', JSON.stringify({ id: 'ABCDEFGH', site: 'EOC' }));
    await otherTab(SESSION_KEY, null);
    expect(latest.joined).toBe(false);
    expect(latest.invite).toEqual({ id: 'ABCDEFGH', key: '', site: 'EOC' });
    expect(latest.error).toMatch(/join key/i);
  });

  it('follows a rotation done in another tab (admin), and learns the join key from the server', async () => {
    responses.get = snapshot({ joinKey: 'SERVERJOINKEY222' });
    await otherTab(SESSION_KEY, { id: 'ABCDEFGH', key: 'ADMINKEYADMINKEY', role: 'admin', joinKey: '', keyGen: 1 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(latest.isAdmin).toBe(true);
    expect(latest.session.joinKey).toBe('SERVERJOINKEY222'); // from GET (no EventSource in jsdom)
    expect(latest.joinUrl).toContain('key=SERVERJOINKEY222');
    await otherTab(SESSION_KEY, { ...latest.session, joinKey: 'ROTATEDKEY222222', keyGen: 2 });
    expect(latest.session.joinKey).toBe('ROTATEDKEY222222');
  });
});

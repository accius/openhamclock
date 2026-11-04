/**
 * AprsBeaconBar (#1262) — reads beacon state from Rig Bridge, pushes the
 * station location once, and switches beacons / sends one with the token.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AprsBeaconBar, { agoText, dueText } from './AprsBeaconBar.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const URL = 'http://localhost:5555';
const T0 = Date.now();

function bridge(beacon = {}, extra = {}) {
  const calls = [];
  const state = {
    running: true,
    connected: true,
    callsign: 'KE8PLM-9',
    beacon: {
      enabled: false,
      intervalSec: 600,
      comment: 'OpenHamClock',
      position: null,
      lastSent: null,
      lastHeard: null,
      nextDue: null,
      error: null,
      ...beacon,
    },
    ...extra,
  };
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body && JSON.parse(opts.body) });
    if (url.endsWith('/api/aprs-tnc/status')) return json(state);
    if (url.endsWith('/aprs/station-location')) {
      state.beacon.position = { lat: 41.5, lon: -81.7, source: 'station' };
      return json({ success: true });
    }
    if (url.endsWith('/aprs/beacon/enabled')) {
      state.beacon.enabled = calls.at(-1).body.enabled;
      if (state.beacon.enabled) state.beacon.lastSent = { at: Date.now(), source: 'station' };
      return json({ success: true, sent: true, beacon: state.beacon });
    }
    if (url.endsWith('/aprs/beacon/now')) return json({ error: 'TNC not connected', beacon: state.beacon }, 409);
    return json({}, 404);
  };
  return { calls, state, fetchImpl };
}

let host;
let root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const render = async (props) => {
  await act(async () => root.render(<AprsBeaconBar rigUrl={URL} apiToken="tok" {...props} />));
  await flush();
};
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));

describe('AprsBeaconBar', () => {
  it('renders nothing without a direct bridge, a running plugin, or beacon support', async () => {
    const b = bridge();
    await render({ rigUrl: null, fetchImpl: b.fetchImpl });
    expect(host.textContent).toBe('');
    const off = bridge({}, { running: false });
    await render({ fetchImpl: off.fetchImpl });
    expect(host.textContent).toBe('');
    const old = bridge();
    delete old.state.beacon; // Rig Bridge before #1262
    await render({ fetchImpl: old.fetchImpl });
    expect(host.textContent).toBe('');
  });

  it('pushes the station location once, with the token', async () => {
    const b = bridge();
    await render({ fetchImpl: b.fetchImpl, location: { lat: 41.5, lon: -81.7 } });
    await render({ fetchImpl: b.fetchImpl, location: { lat: 41.5, lon: -81.7 } });
    const pushes = b.calls.filter((c) => c.url.endsWith('/aprs/station-location'));
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body).toEqual({ lat: 41.5, lon: -81.7 });
    expect(pushes[0].headers['X-RigBridge-Token']).toBe('tok');
    expect(host.textContent).toContain('KE8PLM-9 at 41.5000, -81.7000 (station location)');
  });

  it('switches beacons on and shows the last one', async () => {
    const b = bridge();
    await render({ fetchImpl: b.fetchImpl });
    expect(button('Off')).toBeTruthy();
    expect(host.textContent).toContain('No beacon sent yet');
    await act(async () => button('Off').click());
    await flush();
    const call = b.calls.find((c) => c.url.endsWith('/aprs/beacon/enabled'));
    expect(call.body).toEqual({ enabled: true });
    expect(call.headers['X-RigBridge-Token']).toBe('tok');
    expect(button('On · every 10 min')).toBeTruthy();
    expect(host.textContent).toContain('Last sent just now');
    expect(host.textContent).toContain('not heard by a digipeater yet');
  });

  it('shows heard-via and the bridge error', async () => {
    const at = Date.now() - 4 * 60_000;
    const b = bridge({
      enabled: true,
      lastSent: { at },
      lastHeard: { at: at + 2000, via: 'W8DIG-1' },
      nextDue: at + 600_000,
    });
    await render({ fetchImpl: b.fetchImpl });
    expect(host.textContent).toContain('Last sent 4 min ago');
    expect(host.textContent).toContain('heard via W8DIG-1');
    expect(host.textContent).toContain('next in 6 min');
    await act(async () => button('Beacon now').click());
    await flush();
    expect(host.querySelector('[role="alert"]').textContent).toBe('TNC not connected');
  });
});

describe('time text', () => {
  it('formats ago and due', () => {
    expect(agoText(T0 - 10_000, T0)).toBe('just now');
    expect(agoText(T0 - 5 * 60_000, T0)).toBe('5 min ago');
    expect(agoText(T0 - 130 * 60_000, T0)).toBe('2 h ago');
    expect(dueText(T0 - 1, T0)).toBe('now');
    expect(dueText(T0 + 90_000, T0)).toBe('in 2 min');
  });
});

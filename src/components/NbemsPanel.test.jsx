/**
 * NbemsPanel + useFldigi — bridge events drive the status line and receive
 * pane; Send / ICS-213 / mode POST straight to Rig Bridge with the token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      let s = (opts && opts.defaultValue) || key;
      for (const [k, v] of Object.entries(opts || {})) s = s.replace(`{{${k}}}`, v);
      return s;
    },
  }),
}));

const rig = { rigUrl: 'http://localhost:5555', isCloudRelay: false, cloudRelaySession: '' };
vi.mock('../contexts/RigContext.jsx', () => ({ useRig: () => rig }));

import NbemsPanel from './NbemsPanel.jsx';

let container;
let root;
let fetchMock;

const emit = (event, data) =>
  act(() => {
    window.dispatchEvent(
      new CustomEvent('rig-plugin-data', { detail: { type: 'plugin', event, source: 'fldigi', data } }),
    );
  });

const flush = () => act(async () => {});

const type = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

// Relayed commands are posted after asynchronous signing (Web Crypto HMAC runs
// off the main thread), so they can land after act() returns, and the answer
// then updates the panel asynchronously. Poll in small act()-wrapped steps —
// each step lets pending promises and React updates settle — until the
// condition holds or a deadline passes. (One long act() would not do: React
// commits its updates only when act() exits.)
const settleUntil = async (check, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const v = check();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('condition not met in time');
  }
};

// The relay command with this action — matched by action, so a slow command
// from one test can never be mistaken for the next test's.
const relayCommand = (action) =>
  settleUntil(() =>
    fetchMock.mock.calls
      .filter(([u]) => String(u).startsWith('/api/rig-bridge/relay/command'))
      .map(([u, o]) => ({ url: u, body: JSON.parse(o.body) }))
      .find((c) => c.body.payload?.action === action),
  );

const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent === label);

const mount = async (props = {}) => {
  act(() => root.render(<NbemsPanel {...props} />));
  await flush();
};

beforeEach(() => {
  rig.isCloudRelay = false;
  rig.cloudRelaySession = '';
  localStorage.removeItem('ohc-relay-command-key');
  fetchMock = vi.fn(async (url) => {
    if (url.endsWith('/api/fldigi/status')) {
      return { ok: true, json: async () => ({ enabled: true, running: true, modes: ['BPSK31', 'MT63-2KL'] }) };
    }
    if (url.endsWith('/api/fldigi/rx')) return { ok: true, json: async () => ({ text: '' }) };
    return { ok: true, json: async () => ({ success: true, id: 1 }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('NbemsPanel', () => {
  it('shows a setup hint until the plugin answers', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    await mount();
    expect(container.textContent).toMatch(/Enable the fldigi \+ flmsg plugin/);
  });

  it('renders status and receive text from bridge events', async () => {
    await mount();
    emit('fldigi', { connected: true, freq: 7070000, mode: 'MT63-2KL', carrier: 1500, trx: 'rx', txQueued: 0 });
    emit('fldigi-rx', { text: 'CQ CQ de N8TAG\n', reset: true });
    emit('fldigi-rx', { text: 'KE8PLM de N8TAG K' });
    expect(container.textContent).toContain('7.070 MHz');
    expect(container.querySelector('select').value).toBe('MT63-2KL');
    expect(container.querySelector('pre').textContent).toBe('CQ CQ de N8TAG\nKE8PLM de N8TAG K');
    emit('fldigi-rx', { text: 'fresh', reset: true });
    expect(container.querySelector('pre').textContent).toBe('fresh');
  });

  it('shows TX state with a Stop TX button that aborts', async () => {
    await mount({ apiToken: 'tok' });
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'tx', txActive: true });
    expect(container.textContent).toContain('TX');
    await act(async () => button('Stop TX').click());
    const call = fetchMock.mock.calls.find(([u]) => u.endsWith('/api/fldigi/abort'));
    expect(call[1].headers['X-RigBridge-Token']).toBe('tok');
  });

  it('sends text with the API token and clears the box', async () => {
    await mount({ apiToken: 'tok' });
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'rx' });
    const box = container.querySelector('input[aria-label="Text to transmit through fldigi"]');
    type(box, 'CQ NBEMS');
    await act(async () => box.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const call = fetchMock.mock.calls.find(([u]) => u.endsWith('/api/fldigi/send'));
    expect(call[0]).toBe('http://localhost:5555/api/fldigi/send');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['X-RigBridge-Token']).toBe('tok');
    expect(JSON.parse(call[1].body)).toEqual({ text: 'CQ NBEMS' });
    expect(box.value).toBe('');
    expect(container.textContent).toContain('Queued for transmit');
  });

  it('sends an ICS-213 from the compact form', async () => {
    await mount();
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'rx' });
    act(() => button('ICS-213').click());
    type(container.querySelector('input[aria-label="To (name / position)"]'), 'EOC');
    type(container.querySelector('input[aria-label="Subject"]'), 'Cots');
    type(container.querySelector('textarea'), 'Need 40 cots');
    await act(async () => button('Send ICS-213').click());
    const call = fetchMock.mock.calls.find(([u]) => u.endsWith('/api/fldigi/send-ics213'));
    expect(JSON.parse(call[1].body)).toEqual({ to: 'EOC', from: '', subject: 'Cots', message: 'Need 40 cots' });
    expect(container.textContent).toContain('ICS-213 queued for transmit');
  });

  it('changes mode from the list', async () => {
    await mount();
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'rx' });
    const sel = container.querySelector('select');
    act(() => {
      sel.value = 'MT63-2KL';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    const call = fetchMock.mock.calls.find(([u]) => u.endsWith('/api/fldigi/mode'));
    expect(JSON.parse(call[1].body)).toEqual({ mode: 'MT63-2KL' });
  });

  it('explains a rejected token', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.endsWith('/send')
        ? { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }
        : { ok: true, json: async () => ({ running: true }) },
    );
    await mount();
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'rx' });
    const box = container.querySelector('input[aria-label="Text to transmit through fldigi"]');
    type(box, 'hi');
    await act(async () => box.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.textContent).toMatch(/rejected the API token/);
    expect(box.value).toBe('hi');
  });

  it('warns when no station callsign is known, and only then', async () => {
    await mount();
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'rx', stationCall: 'KE8PLM' });
    expect(container.textContent).not.toMatch(/No station callsign/);
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'rx', stationCall: '' });
    expect(container.querySelector('[role="alert"]').textContent).toMatch(/No station callsign.*ORIGIN\?/);
  });

  it('notes the last flmsg form received', async () => {
    await mount();
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'rx' });
    emit('nbems-form', { formType: 'ICS-213 (NBEMS)', callsign: 'N8TAG' });
    expect(container.textContent).toContain('Last form: ICS-213 (NBEMS) from N8TAG');
  });

  it('in cloud-relay mode, waits for relayed status without fetching the bridge', async () => {
    rig.isCloudRelay = true;
    rig.cloudRelaySession = 'sess0001';
    await mount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/through the cloud relay/);
  });

  it('in cloud-relay mode, sends a signed command through the hosted server and waits for the result', async () => {
    rig.isCloudRelay = true;
    rig.cloudRelaySession = 'sess0001';
    localStorage.setItem('ohc-relay-command-key', 'e'.repeat(64));
    await mount({ apiToken: 'tok' });
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'rx' });
    const box = container.querySelector('input[aria-label="Text to transmit through fldigi"]');
    type(box, 'QST');
    await act(async () => box.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const { url, body: sent } = await relayCommand('send');
    expect(url).toBe('/api/rig-bridge/relay/command?session=sess0001');
    expect(sent).toMatchObject({ type: 'fldigi', payload: { action: 'send', body: { text: 'QST' } } });
    expect(sent.payload.token).toBeUndefined(); // no API token through the server
    expect(sent.auth).toMatchObject({ v: 1, sig: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(container.textContent).not.toContain('Queued for transmit'); // still waiting
    emit('fldigi-cmd-result', { requestId: sent.payload.requestId, ok: true, status: 200, id: 3 });
    await settleUntil(() => container.textContent.includes('Queued for transmit'));
    expect(container.textContent).toContain('Queued for transmit');
  });

  it('in cloud-relay mode, explains a command Rig Bridge refused', async () => {
    rig.isCloudRelay = true;
    rig.cloudRelaySession = 'sess0001';
    await mount();
    emit('fldigi', { connected: true, mode: 'BPSK31', trx: 'tx', txActive: true });
    await act(async () => button('Stop TX').click());
    const { body: sent } = await relayCommand('abort');
    expect(sent.auth).toBeUndefined(); // no key in this browser: unsigned
    emit('fldigi-cmd-result', { requestId: sent.payload.requestId, ok: false, status: 401, error: 'refused' });
    await settleUntil(() => /refused an unsigned command/.test(container.textContent));
    expect(container.textContent).toMatch(/refused an unsigned command/);
  });
});

/**
 * NetControlPanel smoke test — start a net, check stations in from the
 * keyboard, survive a remount (reload), close the net and get the report,
 * with the voice roster mirrored for the EmComm Net Roster.
 * Uses react-dom/client + act (no @testing-library needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) =>
      String((opts && opts.defaultValue) || key).replace(/\{\{(\w+)\}\}/g, (_, k) => (opts?.[k] ?? '').toString()),
  }),
}));

import NetControlPanel from './NetControlPanel.jsx';
import { getNetControlRoster, NET_CONTROL_KEY } from '../utils/netControl.js';
import { getEvents, _resetForTests, activeEvents } from '../utils/emcommEventLog.js';
import { ics309RowsFromEvents } from '../utils/icsForms.js';

let container;
let root;

const render = () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<NetControlPanel callsign="K0CJH" />));
};
const unmount = () => {
  act(() => root.unmount());
  container.remove();
};

const setValue = (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
// Compare attribute values directly: jsdom's selector engine trips over some quoted labels (e.g. ones with "+")
const byLabel = (label) =>
  [...container.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === label) || null;
const buttonWithText = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const pressEnter = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null } }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('NetControlPanel', () => {
  it('runs a net from start to report', async () => {
    render();
    act(() => setValue(byLabel('Net name (e.g. County ARES Weekly Net)'), 'Tuesday ARES Net'));
    act(() => buttonWithText('Start net').click());
    expect(container.textContent).toContain('Tuesday ARES Net');
    expect(container.textContent).toContain('NCS K0CJH');

    const box = byLabel('Check in a station');
    act(() => setValue(box, 'w1aw t'));
    await act(async () => pressEnter(box));
    act(() => setValue(box, 'ke8plm/m'));
    await act(async () => pressEnter(box));
    expect(container.textContent).toContain('W1AW');
    expect(container.textContent).toContain('KE8PLM');
    expect(container.textContent).toContain('TRAFFIC (1)');

    // A reload keeps the running net
    expect(JSON.parse(localStorage.getItem(NET_CONTROL_KEY)).stations).toHaveLength(2);
    unmount();
    render();
    expect(container.textContent).toContain('KE8PLM');
    expect(getNetControlRoster()).toMatchObject({ active: true, net: 'Tuesday ARES Net' });

    // Next → Passed logs the traffic
    act(() => buttonWithText('Next').click());
    expect(container.textContent).toContain('Whiskey One Alfa Whiskey');
    act(() => buttonWithText('Passed').click());

    act(() => buttonWithText('Close net').click());
    expect(container.textContent).toContain('Unique stations');
    expect(container.textContent).toContain('Copy text');
    expect(JSON.parse(localStorage.getItem(NET_CONTROL_KEY)).closedId).toBeTruthy(); // tombstone
    expect(getNetControlRoster()).toMatchObject({ active: false });
    expect(getNetControlRoster().roster.map((r) => r.call)).toEqual(['W1AW', 'KE8PLM']);

    const types = getEvents().map((e) => e.type);
    expect(types).toEqual(['net_open', 'net_checkin', 'net_checkin', 'net_traffic', 'net_close']);
    unmount();
  });

  it('rejects input that is not a callsign', async () => {
    render();
    act(() => setValue(byLabel('Net name (e.g. County ARES Weekly Net)'), 'Test Net'));
    act(() => buttonWithText('Start net').click());
    const box = byLabel('Check in a station');
    act(() => setValue(box, 'hello'));
    await act(async () => pressEnter(box));
    expect(container.textContent).toContain('Not a callsign');
    unmount();
  });

  it('undo of a logged check-in writes a withdrawal the ICS 309 skips', async () => {
    render();
    act(() => setValue(byLabel('Net name (e.g. County ARES Weekly Net)'), 'Test Net'));
    act(() => buttonWithText('Start net').click());
    const box = byLabel('Check in a station');
    act(() => setValue(box, 'w1aw'));
    await act(async () => pressEnter(box));
    act(() => setValue(box, 'k0cjh'));
    await act(async () => pressEnter(box));
    act(() => buttonWithText('Undo').click());
    expect(container.textContent).not.toContain('K0CJH ');
    const evs = getEvents();
    expect(evs.map((e) => e.type)).toEqual(['net_open', 'net_checkin', 'net_checkin', 'net_withdrawn']);
    expect(evs[3]).toMatchObject({ callsign: 'K0CJH', ref: evs[2].id, summary: 'Check-in withdrawn (Test Net)' });
    expect(activeEvents(evs).map((e) => e.callsign)).toEqual(['K0CJH', 'W1AW']); // net_open by NCS, then W1AW
    expect(ics309RowsFromEvents(evs).map((r) => r.from)).toEqual(['K0CJH', 'W1AW']);

    // removing a mistyped call withdraws its entries; Undo reinstates them
    act(() => container.querySelector('[aria-label="Remove (mistyped call)"]').click());
    expect(activeEvents(getEvents()).filter((e) => e.type === 'net_checkin')).toHaveLength(0);
    act(() => buttonWithText('Undo').click());
    expect(
      activeEvents(getEvents())
        .filter((e) => e.type === 'net_checkin')
        .map((e) => e.callsign),
    ).toEqual(['W1AW']);
    unmount();
  });

  it('keeps two panels in step and shows the "also open" note', async () => {
    const mount = () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const r = createRoot(el);
      act(() => r.render(<NetControlPanel callsign="K0CJH" />));
      return { el, r };
    };
    const a = mount();
    const b = mount();
    const flush = () => act(async () => new Promise((res) => setTimeout(res, 30)));
    await flush();
    expect(a.el.textContent).toContain('Also open in another tab or panel (1)');

    const q = (el, label) => el.querySelector(`[aria-label="${label}"]`);
    const btn = (el, text) => [...el.querySelectorAll('button')].find((x) => x.textContent.includes(text));
    act(() => setValue(q(a.el, 'Net name (e.g. County ARES Weekly Net)'), 'Shared Net'));
    act(() => btn(a.el, 'Start net').click());
    await flush();
    expect(b.el.textContent).toContain('Shared Net');

    // B checks in; A follows
    const boxB = q(b.el, 'Check in a station');
    act(() => setValue(boxB, 'w1aw'));
    await act(async () => pressEnter(boxB));
    await flush();
    expect(a.el.textContent).toContain('W1AW');

    // A closes; B drops the net
    act(() => btn(a.el, 'Close net').click());
    await flush();
    expect(b.el.textContent).toContain('Start net');
    expect(b.el.textContent).toContain('The net was closed in another tab');
    for (const m of [a, b]) {
      act(() => m.r.unmount());
      m.el.remove();
    }
  });

  it('named script templates: pick, new, edit and use per net', async () => {
    render();
    act(() => buttonWithText('Script').click());
    const sel = byLabel('Script template');
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      'ARES weekly net',
      'SKYWARN activation',
      'Tactical net',
    ]);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'tpl-skywarn');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('severe weather reporting');
    act(() => buttonWithText('New').click());
    act(() => setValue(byLabel('Script name'), 'Hospital net'));
    const ta = byLabel('Net script');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Hello from {ncs}');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => buttonWithText('Save').click());
    expect(container.textContent).toContain('Hello from {ncs}'.replace('{ncs}', 'K0CJH'));
    const stored = JSON.parse(localStorage.getItem('openhamclock_netControlScripts'));
    expect(stored.templates.map((t) => t.name)).toContain('Hospital net');
    // starting a net uses the chosen template
    act(() => buttonWithText('Start').click());
    act(() => setValue(byLabel('Net name (e.g. County ARES Weekly Net)'), 'H Net'));
    act(() => buttonWithText('Start net').click());
    expect(JSON.parse(localStorage.getItem(NET_CONTROL_KEY)).scriptId).toBe(stored.lastId);
    unmount();
  });

  it('report times toggle adds local time to the report view', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<NetControlPanel callsign="K0CJH" timeZone="America/Chicago" />));
    act(() => setValue(byLabel('Net name (e.g. County ARES Weekly Net)'), 'T Net'));
    act(() => buttonWithText('Start net').click());
    act(() => buttonWithText('Close net').click());
    expect(container.textContent).not.toContain('Opened – closed (local)');
    const sel = byLabel('Times in the report');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'both');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Opened – closed (local)');
    expect(container.textContent).toMatch(/C[DS]T/);
    expect(localStorage.getItem('openhamclock_netControlReportTimes')).toBe('both');
    unmount();
  });

  describe('two panels changing the net at the same moment', () => {
    const mount = (props = {}) => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const r = createRoot(el);
      act(() => r.render(<NetControlPanel callsign="K0CJH" {...props} />));
      return { el, r };
    };
    const q = (el, label) => el.querySelector(`[aria-label="${label}"]`);
    const btn = (el, text) => [...el.querySelectorAll('button')].find((x) => x.textContent.includes(text));
    const flush = () => act(async () => new Promise((res) => setTimeout(res, 30)));
    const checkInOn = (el, text) => {
      const box = q(el, 'Check in a station');
      act(() => setValue(box, text));
      act(() => pressEnter(box)); // synchronous: the other panel has not heard yet
    };
    let a;
    let b;
    beforeEach(async () => {
      a = mount();
      b = mount();
      await flush();
      act(() => setValue(q(a.el, 'Net name (e.g. County ARES Weekly Net)'), 'Race Net'));
      act(() => btn(a.el, 'Start net').click());
      await flush();
    });
    afterEach(() => {
      for (const m of [a, b]) {
        act(() => m.r.unmount());
        m.el.remove();
      }
    });

    it('different calls: the later change is re-applied automatically', async () => {
      checkInOn(a.el, 'w1aw');
      checkInOn(b.el, 'k0cjh'); // B still holds the net without W1AW
      await flush();
      const stored = JSON.parse(localStorage.getItem(NET_CONTROL_KEY));
      expect(stored.stations.map((s) => s.call).sort()).toEqual(['K0CJH', 'W1AW']);
      expect(b.el.textContent).not.toContain('changed in another tab');
      expect(a.el.textContent).toContain('K0CJH');
      // both check-ins are logged once each
      expect(
        getEvents()
          .filter((e) => e.type === 'net_checkin')
          .map((e) => e.callsign)
          .sort(),
      ).toEqual(['K0CJH', 'W1AW']);
    });

    it('the same station in both: the second is refused and the operator asked', async () => {
      checkInOn(a.el, 'ke8plm t');
      checkInOn(b.el, 'ke8plm');
      expect(b.el.textContent).toContain('KE8PLM was changed in another tab too — check it and try again');
      expect(q(b.el, 'Check in a station').value).toBe('ke8plm'); // kept to press Enter again
      await flush();
      const stored = JSON.parse(localStorage.getItem(NET_CONTROL_KEY));
      expect(stored.stations.map((s) => [s.call, s.flags])).toEqual([['KE8PLM', ['traffic']]]);
    });
  });

  it('TX offset: preview, "offset?" when unknown, and an override', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<NetControlPanel callsign="K0CJH" location={{ lat: 44.4, lon: -93.2 }} />));
    const freq = byLabel('Frequency / repeater (e.g. 146.940 − PL 100.0)');
    act(() => setValue(freq, '146.940 -'));
    expect(container.textContent).toContain('TX 146.340 (−600 kHz standard)');
    act(() => setValue(freq, '53.700 -'));
    expect(container.textContent).toContain('TX 53.200 (−500 kHz usual here — check locally)');
    act(() => setValue(freq, '53.150 -')); // outside the band plan's output segments
    expect(container.textContent).toContain('TX offset? — type it here');
    act(() => setValue(byLabel('TX offset (e.g. −0.6, +5, −500k)'), '1'));
    expect(container.textContent).toContain('TX 52.150 (−1 MHz as entered)');
    act(() => setValue(byLabel('TX offset (e.g. −0.6, +5, −500k)'), ''));
    act(() => setValue(freq, '1293.000 -'));
    expect(container.textContent).toContain('TX offset? — type it here');
    act(() => setValue(byLabel('Net name (e.g. County ARES Weekly Net)'), '23 cm net'));
    act(() => buttonWithText('Start net').click());
    expect(container.textContent).toContain('offset?');
    expect(getNetControlRoster()).toMatchObject({ region: 'R2', offset: '' });
    unmount();
  });

  it('shared incident: "your change" chip after another site won; Apply mine puts it back', async () => {
    // The running net as another site left it: W1AW flagged M there…
    const net = {
      id: 'net-1',
      name: 'County ARES',
      ncs: 'K0CJH',
      frequency: '',
      startTime: 1,
      rev: 3,
      stations: [
        {
          id: 's1',
          call: 'W1AW',
          flags: ['mobile'],
          note: '',
          name: '',
          location: '',
          checkinTime: 2,
          checkoutTime: null,
          recheckCount: 0,
        },
      ],
    };
    localStorage.setItem(NET_CONTROL_KEY, JSON.stringify(net));
    // …while here we had flagged it T (kept by the incident bridge after the conflict).
    localStorage.setItem(
      'openhamclock_netControlConflicts',
      JSON.stringify({
        netId: 'net-1',
        calls: { W1AW: { mine: { ...net.stations[0], flags: ['traffic'] }, site: 'EOC South', at: 5 } },
        fields: {},
      }),
    );
    render();
    const chip = container.querySelector('[data-testid="net-conflict-W1AW"]');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('EOC South');
    expect(chip.textContent).toContain('TFC');
    await act(async () => [...chip.querySelectorAll('button')].find((b) => b.textContent === 'Apply mine').click());
    const stored = JSON.parse(localStorage.getItem(NET_CONTROL_KEY));
    expect(stored.stations.find((x) => x.call === 'W1AW').flags).toEqual(['traffic']);
    expect(container.querySelector('[data-testid="net-conflict-W1AW"]')).toBeNull();
    expect(localStorage.getItem('openhamclock_netControlConflicts')).toBeNull();
    unmount();
  });

  it('shared incident: the chip can be dismissed, and belongs to its own net only', () => {
    const net = { id: 'net-2', name: 'Other', ncs: 'K0CJH', startTime: 1, rev: 1, stations: [] };
    localStorage.setItem(NET_CONTROL_KEY, JSON.stringify(net));
    localStorage.setItem(
      'openhamclock_netControlConflicts',
      JSON.stringify({ netId: 'net-1', calls: { W1AW: { mine: null, site: 'X', at: 1 } }, fields: {} }),
    );
    render();
    expect(container.querySelector('[data-testid="net-conflict-W1AW"]')).toBeNull(); // another net's entry
    unmount();
    localStorage.setItem(
      'openhamclock_netControlConflicts',
      JSON.stringify({ netId: 'net-2', calls: {}, fields: { frequency: { mine: '147.00', site: 'X', at: 1 } } }),
    );
    render();
    const bar = container.querySelector('[data-testid="net-conflict-field-frequency"]');
    expect(bar.textContent).toContain('147.00');
    act(() => bar.querySelector('button[aria-label="Keep theirs"]').click());
    expect(container.querySelector('[data-testid="net-conflict-field-frequency"]')).toBeNull();
    unmount();
  });
});

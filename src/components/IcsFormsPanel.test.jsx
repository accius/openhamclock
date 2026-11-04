/**
 * Smoke tests for IcsFormsPanel — every form tab renders, the 309 preview is
 * built from the event log, 214 imports log rows, 205 adds simplex rows, and
 * the 213 APRS send goes through the shared send path and logs an event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import i18n from '../lang/i18n.js';
import IcsFormsPanel from './IcsFormsPanel.jsx';
import { recordEvent, getEvents, _resetForTests } from '../utils/emcommEventLog.js';
import { ICS_DRAFTS_KEY } from '../utils/icsForms.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const click = (el) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const tab = (container, id) => [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === id);
const buttonByText = (container, text) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));

function setInput(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

let fetchMock;
beforeEach(() => {
  localStorage.clear();
  _resetForTests();
  fetchMock = vi.fn(async (url) => {
    if (String(url).includes('tnc-status')) return { ok: true, status: 200, json: async () => ({ connected: true }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IcsFormsPanel', () => {
  it('renders the 309 preview from the event log and fills the operator call from config', () => {
    recordEvent('net_checkin', { callsign: 'KE8PLM', summary: 'Checked into ARES' });
    const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'k0cjh' }} initialForm="309" />);
    const paper = container.querySelector('.ics-paper');
    expect(paper.innerHTML).toContain('COMMUNICATIONS LOG');
    expect(paper.innerHTML).toContain('KE8PLM');
    expect(paper.innerHTML).toContain('K0CJH');
    expect(container.textContent).toContain('Log entries in the operational period: 1');
    unmount();
  });

  it('switches between all four forms', () => {
    const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'K0CJH' }} initialForm="309" />);
    click(tab(container, '214'));
    expect(container.querySelector('.ics-paper').innerHTML).toContain('ACTIVITY LOG');
    click(tab(container, '213'));
    expect(container.querySelector('.ics-paper').innerHTML).toContain('GENERAL MESSAGE');
    click(tab(container, '205'));
    expect(container.querySelector('.ics-paper').innerHTML).toContain('INCIDENT RADIO COMMUNICATIONS PLAN');
    unmount();
  });

  it('214 imports event-log rows and 205 adds a simplex channel; drafts persist on unmount', () => {
    recordEvent('net_checkin', { callsign: 'KE8PLM', summary: 'Checked into ARES' });
    const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'K0CJH' }} initialForm="214" />);
    click(buttonByText(container, 'Import from event log'));
    const area = container.querySelector('textarea');
    expect(area.value).toContain('KE8PLM: Checked into ARES');
    click(tab(container, '205'));
    click(buttonByText(container, 'Simplex channel'));
    expect(container.querySelector('.ics-paper').innerHTML).toContain('Simplex');
    unmount();
    const saved = JSON.parse(localStorage.getItem(ICS_DRAFTS_KEY));
    expect(saved.ics214.rows.length).toBe(1);
    expect(saved.ics205.rows.length).toBe(1);
  });

  it('309 shows message numbers, keeps row edits in the draft, and adds/removes rows', () => {
    recordEvent('net_checkin', { callsign: 'KE8PLM', summary: 'Checked into ARES' });
    const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'K0CJH' }} initialForm="309" />);
    const msgCell = () => container.querySelector('input[aria-label="Msg #"]:nth-of-type(1)');
    // TO Msg # of the check-in is the event's message number (1)
    const toMsg = [...container.querySelectorAll('input[aria-label="Msg #"]')][1];
    expect(toMsg.value).toBe('1');
    expect(msgCell()).toBeTruthy();
    const message = container.querySelector('textarea[aria-label="Message"]');
    setInput(message, 'Checked in with 2 operators');
    expect(container.querySelector('.ics-paper').innerHTML).toContain('Checked in with 2 operators');
    click(buttonByText(container, 'Add entry'));
    expect(container.querySelectorAll('textarea[aria-label="Message"]').length).toBe(2);
    click(container.querySelectorAll('button[aria-label="Remove"]')[0]);
    expect(buttonByText(container, 'Restore removed (1)')).toBeTruthy();
    unmount();
    const saved = JSON.parse(localStorage.getItem(ICS_DRAFTS_KEY));
    expect(Object.values(saved.ics309.edits)[0].message).toBe('Checked in with 2 operators');
    expect(saved.ics309.manual.length).toBe(1);
    expect(saved.ics309.removed.length).toBe(1);
  });

  it('309 shows the next message number and resets it only after confirming', () => {
    recordEvent('net_checkin', { callsign: 'KE8PLM', summary: 'Checked into ARES' });
    recordEvent('aprs_msg_sent', { callsign: 'K0CJH', summary: 'Message to KE8PLM' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'K0CJH' }} initialForm="309" />);
    expect(container.textContent).toContain('Next station message #: 3');
    click(buttonByText(container, 'Reset message numbers'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Next station message #: 3'); // cancelled
    confirm.mockReturnValue(true);
    click(buttonByText(container, 'Reset message numbers'));
    expect(container.textContent).toContain('Next station message #: 1');
    expect(buttonByText(container, 'Reset message numbers').disabled).toBe(true);
    act(() => {
      recordEvent('aprs_msg_rx', { callsign: 'KE8PLM', summary: 'Message to K0CJH' });
    });
    expect(getEvents().at(-1).msgNo).toBe(1);
    expect(container.textContent).toContain('Next station message #: 2');
    unmount();
  });

  it('prints labels in English by default and in the interface language on request', () => {
    i18n.addResourceBundle('de', 'translation', { 'icsForms.print.309.name': 'FUNKPROTOKOLL' }, true, true);
    act(() => {
      i18n.changeLanguage('de');
    });
    try {
      const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'K0CJH' }} initialForm="309" />);
      expect(container.querySelector('.ics-paper').innerHTML).toContain('COMM Log');
      const select = [...container.querySelectorAll('select')].find((s) => s.querySelector('option[value="ui"]'));
      act(() => {
        select.value = 'ui';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(container.querySelector('.ics-paper').innerHTML).toContain('FUNKPROTOKOLL');
      unmount();
    } finally {
      act(() => {
        i18n.changeLanguage('en');
      });
    }
  });

  it('205 imports a CHIRP CSV and exports the plan', async () => {
    const created = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b) => (created.push(b), 'blob:x'), revokeObjectURL: () => {} });
    const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'K0CJH' }} initialForm="205" />);
    const csv =
      'Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,Mode,TStep,Skip,Comment,URCALL,RPT1CALL,RPT2CALL\n' +
      '0,W0XYZ,146.940000,-,0.600000,Tone,100.0,88.5,023,NN,FM,5.00,,Denver,,,\n';
    const input = container.querySelector('[data-testid="chirp-import"]');
    const file = new File([csv], 'radio.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Imported 1 channel(s) from radio.csv.');
    expect(container.querySelector('.ics-paper').innerHTML).toContain('146.340 W');
    click(buttonByText(container, '⤒'));
    expect(created.length).toBe(1);
    const text = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsText(created[0]);
    });
    expect(text).toContain('W0XYZ,146.940000,-,0.600000,Tone,100.0');
    unmount();
  });

  it('213 offers "Resend remaining parts" after a partial failure and resumes from the first unsent part', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let calls = 0;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('tnc-status')) return { ok: true, status: 200, json: async () => ({ connected: true }) };
      calls++;
      if (calls === 2) return { ok: false, status: 503, json: async () => ({ error: 'TNC not connected' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'K0CJH' }} initialForm="213" />);
    setInput(
      [...container.querySelectorAll('input')].find((i) => i.maxLength === 9),
      'N0EOC',
    );
    setInput(
      container.querySelector('textarea'),
      'Shelter 3 needs 200 gallons of potable water, 50 cots, two generators and fuel for 48 hours before 2200 local tonight please.',
    );
    await act(async () => {
      buttonByText(container, 'Send as APRS message').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const states = () => [...container.querySelectorAll('[data-part-state]')].map((li) => li.dataset.partState);
    expect(states()).toEqual(['sent', 'failed', 'pending']);
    expect(container.textContent).toContain('Part 2 of 3 failed');
    const resend = buttonByText(container, 'Resend remaining parts (2–3)');
    expect(resend).toBeTruthy();
    await act(async () => {
      resend.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(states()).toEqual(['sent', 'sent', 'sent']);
    const bodies = fetchMock.mock.calls
      .filter(([url]) => url === '/api/aprs/message')
      .map(([, o]) => JSON.parse(o.body).message.slice(0, 4));
    expect(bodies).toEqual(['1/3 ', '2/3 ', '2/3 ', '3/3 ']);
    const evs = getEvents().filter((e) => e.type === 'ics213_sent');
    expect(evs.length).toBe(2);
    expect(evs[0].details).toContain('[parts 1 of 3 sent; stopped: TNC not connected]');
    expect(evs[1].summary).toContain('(resumed)');
    expect(evs[1].details).toContain('[parts 2–3 of 3 sent]');
    expect(buttonByText(container, 'Resend remaining')).toBeFalsy();
    unmount();
  });

  it('213 sends the message as APRS parts and records it in the event log', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container, unmount } = render(<IcsFormsPanel config={{ callsign: 'K0CJH' }} initialForm="213" />);
    const inputs = [...container.querySelectorAll('input')];
    const toCall = inputs.find((i) => i.maxLength === 9);
    setInput(toCall, 'n0eoc');
    const message = [...container.querySelectorAll('textarea')][0];
    setInput(message, 'Shelter 3 needs 200 gallons of potable water and 50 cots before 2200 local tonight please.');
    expect(container.textContent).toContain('2 APRS message(s)');
    await act(async () => {
      buttonByText(container, 'Send as APRS message').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const sends = fetchMock.mock.calls.filter(([url]) => url === '/api/aprs/message');
    expect(sends.length).toBe(2);
    expect(JSON.parse(sends[0][1].body)).toMatchObject({ to: 'N0EOC' });
    expect(JSON.parse(sends[0][1].body).message.startsWith('1/2 ')).toBe(true);
    const ev = getEvents().find((e) => e.type === 'ics213_sent');
    expect(ev.summary).toContain('N0EOC');
    unmount();
  });
});

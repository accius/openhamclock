/**
 * IcsDraftConflict — the banner shown when our ICS draft was refused as older
 * than another station's: differences, Apply mine, Keep theirs.
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

import IcsDraftConflict from './IcsDraftConflict.jsx';
import * as docs from '../utils/incidentDocs.js';

const button = (c, text) => [...c.querySelectorAll('button')].find((b) => b.textContent === text);

describe('IcsDraftConflict', () => {
  let container;
  let root;
  let published;

  beforeEach(() => {
    localStorage.clear();
    docs._resetForTests();
    published = [];
    docs.attach({
      docs: { 'ics-drafts': { data: { header: { incidentName: 'South' } }, docRev: 3 } },
      publish: (id, data, extra) => published.push({ id, data, ...extra }),
    });
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));

  it('shows nothing without a conflict, then offers differences and Apply mine', () => {
    act(() => root.render(<IcsDraftConflict />));
    expect(container.textContent).toBe('');
    act(() =>
      docs.docConflict(
        'ics-drafts',
        { header: { incidentName: 'North (offline)' } },
        { data: { header: { incidentName: 'South' } }, docRev: 3, by: 'W1AW' },
      ),
    );
    expect(container.textContent).toContain('W1AW saved these forms');
    act(() => button(container, 'Show differences').click());
    expect(container.textContent).toContain('header.incidentName');
    expect(container.textContent).toContain('North (offline)');
    act(() => button(container, 'Apply mine').click());
    expect(published.at(-1)).toMatchObject({ id: 'ics-drafts', baseRev: 3 });
    expect(container.textContent).toBe('');
  });

  it('Keep theirs dismisses it', () => {
    act(() => root.render(<IcsDraftConflict />));
    act(() => docs.docConflict('ics-drafts', { a: 1 }, { data: { a: 2 }, docRev: 2 }));
    act(() => button(container, 'Keep theirs').click());
    expect(container.textContent).toBe('');
    expect(docs.getDocConflict('ics-drafts')).toBeNull();
  });
});

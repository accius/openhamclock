import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadDoc,
  saveDoc,
  subscribeDocs,
  attach,
  receive,
  detach,
  isSharing,
  DOC_MAX_BYTES,
  _resetForTests,
  noteAccepted,
  docConflict,
  getDocConflict,
  applyMineDoc,
  dismissDocConflict,
  diffDocs,
  DOC_CONFLICTS_KEY,
} from './incidentDocs.js';
import { loadDrafts, ICS_DRAFTS_KEY } from './icsForms.js';

describe('incidentDocs (ICS drafts)', () => {
  let published;
  let notes;

  beforeEach(() => {
    localStorage.clear();
    _resetForTests();
    published = [];
    notes = [];
    subscribeDocs((id, reason) => notes.push(`${id}:${reason}`));
  });

  const join = (docs = {}) =>
    attach({ docs, publish: (id, data, extra = {}) => published.push({ id, data, ...extra }) });

  it('not joined: loads and saves this browser’s own drafts', () => {
    expect(isSharing()).toBe(false);
    const d = loadDoc('ics-drafts');
    saveDoc('ics-drafts', { ...d, header: { ...d.header, incidentName: 'Local' } });
    expect(loadDrafts().header.incidentName).toBe('Local');
    expect(published.filter((p) => p.id === 'ics-drafts')).toEqual([]);
  });

  it('joined: starts from blank drafts, publishes edits, and leaves the local copy alone', () => {
    localStorage.setItem(ICS_DRAFTS_KEY, JSON.stringify({ header: { incidentName: 'Local only' } }));
    join();
    expect(loadDoc('ics-drafts').header.incidentName).toBe('');
    const d = loadDoc('ics-drafts');
    saveDoc('ics-drafts', { ...d, header: { ...d.header, incidentName: 'Flood' } });
    expect(published.filter((p) => p.id === 'ics-drafts')).toHaveLength(1);
    expect(loadDrafts().header.incidentName).toBe('Local only');
    detach();
    expect(loadDoc('ics-drafts').header.incidentName).toBe('Local only');
  });

  it('shape-fixes received drafts', () => {
    join();
    receive([{ id: 'ics-drafts', data: { header: { incidentName: 'Flood' } }, docRev: 1 }]);
    const d = loadDoc('ics-drafts');
    expect(d.header.incidentName).toBe('Flood');
    expect(Array.isArray(d.ics214.rows)).toBe(true);
  });

  it('notifies on join, remote changes and leave — not on its own echo or a no-op save', () => {
    join();
    expect(notes).toEqual(['ics-drafts:mode']);
    notes = [];
    const d = { header: { incidentName: 'A' } };
    saveDoc('ics-drafts', d);
    saveDoc('ics-drafts', d); // unchanged → not republished
    expect(published.filter((p) => p.id === 'ics-drafts')).toHaveLength(1);
    receive([{ id: 'ics-drafts', data: d, docRev: 1 }]); // echo
    expect(notes).toEqual([]);
    receive([{ id: 'ics-drafts', data: { header: { incidentName: 'B' } }, docRev: 2 }]);
    expect(notes).toEqual(['ics-drafts:remote']);
    receive([{ id: 'ics-drafts', data: { header: { incidentName: 'Old' } }, docRev: 1, updatedAt: 9e12 }]); // older on the server, however fast its clock
    expect(loadDoc('ics-drafts').header.incidentName).toBe('B');
    detach();
    expect(notes.at(-1)).toBe('ics-drafts:mode');
  });

  it('refuses drafts too large to share', () => {
    join();
    expect(saveDoc('ics-drafts', { header: { notes: 'x'.repeat(DOC_MAX_BYTES + 10) } })).toBe(false);
  });

  describe('conditional writes', () => {
    const drafts = (name) => ({ header: { incidentName: name } });

    it('each save carries the revision it was made from, following accepted writes', () => {
      join({ 'ics-drafts': { data: drafts('A'), docRev: 4 } });
      saveDoc('ics-drafts', drafts('B'));
      expect(published.at(-1)).toMatchObject({ id: 'ics-drafts', baseRev: 4 });
      noteAccepted('ics-drafts', 5);
      saveDoc('ics-drafts', drafts('C'));
      expect(published.at(-1).baseRev).toBe(5);
      receive([{ id: 'ics-drafts', data: drafts('remote'), docRev: 7 }]);
      saveDoc('ics-drafts', drafts('D'));
      expect(published.at(-1).baseRev).toBe(7);
    });

    it('an hour-old offline draft refused by the server: theirs shown, ours kept, Apply mine on top of theirs', () => {
      join({ 'ics-drafts': { data: drafts('start'), docRev: 1 } });
      saveDoc('ics-drafts', drafts('north offline edit')); // made from rev 1, flushed an hour later
      notes = [];
      // The server answers 409 with South's newer copy; the hook hands both over.
      receive([{ id: 'ics-drafts', data: drafts('south'), docRev: 3, by: 'W1AW' }]);
      docConflict('ics-drafts', drafts('north offline edit'), { data: drafts('south'), docRev: 3, by: 'W1AW' });
      expect(loadDoc('ics-drafts').header.incidentName).toBe('south');
      expect(getDocConflict('ics-drafts')).toMatchObject({
        mine: drafts('north offline edit'),
        theirsRev: 3,
        by: 'W1AW',
      });
      expect(notes).toEqual(['ics-drafts:remote', 'ics-drafts:conflict']);
      expect(JSON.parse(localStorage.getItem(DOC_CONFLICTS_KEY))['ics-drafts']).toBeTruthy(); // survives a reload
      expect(diffDocs(getDocConflict('ics-drafts').mine, getDocConflict('ics-drafts').theirs)).toEqual([
        { path: 'header.incidentName', mine: 'north offline edit', theirs: 'south' },
      ]);
      published = [];
      expect(applyMineDoc('ics-drafts')).toBe(true);
      expect(published).toEqual([{ id: 'ics-drafts', data: drafts('north offline edit'), baseRev: 3 }]);
      expect(loadDoc('ics-drafts').header.incidentName).toBe('north offline edit');
      expect(getDocConflict('ics-drafts')).toBeNull();
      expect(localStorage.getItem(DOC_CONFLICTS_KEY)).toBeNull();
    });

    it('keep theirs drops ours; leaving clears pending conflicts', () => {
      join({ 'ics-drafts': { data: drafts('start'), docRev: 1 } });
      docConflict('ics-drafts', drafts('mine'), { data: drafts('theirs'), docRev: 2 });
      dismissDocConflict('ics-drafts');
      expect(getDocConflict('ics-drafts')).toBeNull();
      docConflict('ics-drafts', drafts('mine'), { data: drafts('theirs'), docRev: 2 });
      detach();
      expect(localStorage.getItem(DOC_CONFLICTS_KEY)).toBeNull();
    });

    it('diffDocs walks nested fields and rows, capped', () => {
      const a = { ics214: { rows: [{ text: 'a' }, { text: 'b' }] }, x: 1 };
      const b = { ics214: { rows: [{ text: 'a' }, { text: 'B' }, { text: 'new' }] }, x: 1 };
      expect(diffDocs(a, b).map((d) => d.path)).toEqual(['ics214.rows.1.text', 'ics214.rows.2']);
      expect(diffDocs({ a: 1, b: 2, c: 3 }, {}, 2)).toHaveLength(2);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MY_DECODES_EVENT,
  MY_DECODES_MAX,
  addMyDecode,
  clearMyDecodes,
  loadMyDecodes,
  myDecodeToSpot,
  removeMyDecode,
} from './myDecodes.js';

describe('myDecodes', () => {
  beforeEach(() => localStorage.clear());

  it('stores decodes newest first and fires a change event', () => {
    const spy = vi.fn();
    window.addEventListener(MY_DECODES_EVENT, spy);
    addMyDecode({ call: 'w1aw', freqKhz: 7030.04, wpm: 18.4, snrDb: 12.6, text: 'CQ DE W1AW K', time: 1000 });
    addMyDecode({ call: 'K1ABC', freqKhz: 14025, time: 2000 });
    window.removeEventListener(MY_DECODES_EVENT, spy);
    const list = loadMyDecodes();
    expect(list.map((d) => d.call)).toEqual(['K1ABC', 'W1AW']);
    expect(list[1]).toMatchObject({ freqKhz: 7030, wpm: 18, snrDb: 13, mode: 'CW', text: 'CQ DE W1AW K' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('merges a repeat of the same call on the same frequency', () => {
    addMyDecode({ call: 'W1AW', freqKhz: 7030, time: 1000 });
    addMyDecode({ call: 'W1AW', freqKhz: 7030.3, time: 60_000, wpm: 22 });
    const list = loadMyDecodes();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ count: 2, wpm: 22 });
    // a different band is a different entry
    addMyDecode({ call: 'W1AW', freqKhz: 14025, time: 70_000 });
    expect(loadMyDecodes()).toHaveLength(2);
  });

  it('removes, clears, caps and ignores empty calls', () => {
    const e = addMyDecode({ call: 'N0CALL', time: 1 });
    expect(addMyDecode({ call: '  ' })).toBeNull();
    removeMyDecode(e.id);
    expect(loadMyDecodes()).toHaveLength(0);
    for (let i = 0; i < MY_DECODES_MAX + 20; i++) addMyDecode({ call: `K${i}AA`, time: i * 10 * 60_000 });
    expect(loadMyDecodes()).toHaveLength(MY_DECODES_MAX);
    clearMyDecodes();
    expect(loadMyDecodes()).toHaveLength(0);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('ohc_my_decodes', '{nope');
    expect(loadMyDecodes()).toEqual([]);
  });

  it('shapes a decode like a cluster spot', () => {
    const e = addMyDecode({ call: 'W1AW', freqKhz: 7030, wpm: 20, snrDb: 15, time: 5 });
    expect(myDecodeToSpot(e)).toMatchObject({
      call: 'W1AW',
      freq: 7030,
      mode: 'CW',
      comment: '20 WPM · 15 dB · my decode',
    });
  });
});

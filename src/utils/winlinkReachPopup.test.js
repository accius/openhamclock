import { describe, it, expect } from 'vitest';
import { reachPopupLine } from './winlinkReachPopup.js';
import { STATUS_COLORS } from './winlinkReach.js';

const t = (key, opts = {}) =>
  String(opts.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : ''));

describe('reachPopupLine', () => {
  it('describes an HF prediction in the status colour', () => {
    const html = reachPopupLine(
      { kind: 'hf', status: 'good', reliability: 82, snrMargin: 6.5, freqHz: 7101200, modeLabel: 'VARA' },
      t,
    );
    expect(html).toContain(STATUS_COLORS.good);
    expect(html).toContain('Good · 82% · +6.5 dB · 7.101 VARA');
  });

  it('covers off-air, line of sight and unknown hours, and escapes text', () => {
    expect(reachPopupLine({ kind: 'hf', status: 'offair' }, t)).toContain('Off the air');
    expect(reachPopupLine({ kind: 'packet', status: 'unknown', los: 'extended' }, t)).toContain(
      'Needs height / good antenna',
    );
    const html = reachPopupLine({ kind: 'hf', status: 'closed', hoursUnknown: true, hoursText: '<b>12/7' }, t);
    expect(html).toContain('&lt;b&gt;12/7');
    expect(html).not.toContain('<b>12/7');
    expect(reachPopupLine(null, t)).toBe('');
  });
});

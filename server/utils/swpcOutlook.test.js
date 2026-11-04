import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { parse27DayOutlook } = require('./swpcOutlook.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, '__fixtures__/swpc/27-day-outlook.txt'), 'utf8');

describe('parse27DayOutlook', () => {
  it('parses the issue time and all 27 daily rows from the SWPC fixture', () => {
    const out = parse27DayOutlook(fixture);
    expect(out.issued).toBe('2026-10-12T03:45:00Z');
    expect(out.days).toHaveLength(27);
    expect(out.days[0]).toEqual({ date: '2026-10-12', sfi: 120, ap: 16, kp: 4 });
    expect(out.days[1]).toEqual({ date: '2026-10-13', sfi: 115, ap: 28, kp: 5 });
    // Month rollover is preserved
    expect(out.days[20]).toEqual({ date: '2026-11-01', sfi: 105, ap: 25, kp: 5 });
    expect(out.days[26].date).toBe('2026-11-07');
  });

  it('ignores comments, blank lines and malformed rows', () => {
    const text = [
      ':Product: 27-day Space Weather Outlook Table 27DO.txt',
      '# comment',
      '',
      '2026 Oct 12     120          16          4',
      '2026 Xyz 13     115          28          5', // bad month
      'garbage line',
      '2026 Oct 14  110  14  3',
    ].join('\n');
    const out = parse27DayOutlook(text);
    expect(out.issued).toBeNull();
    expect(out.days.map((d) => d.date)).toEqual(['2026-10-12', '2026-10-14']);
  });

  it('is defensive about non-string input', () => {
    expect(parse27DayOutlook(null)).toEqual({ issued: null, days: [] });
    expect(parse27DayOutlook(undefined).days).toEqual([]);
  });
});

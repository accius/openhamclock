/**
 * Tests for icsPrint — forms print from an isolated iframe document that
 * holds only the form, the ICS stylesheet and the page setup.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPrintDocument, printIcsHtml, printPageCss } from './icsPrint.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.querySelectorAll('iframe[data-ics-print]').forEach((f) => f.remove());
});

describe('printPageCss', () => {
  it('sets margins, and landscape only when asked', () => {
    expect(printPageCss()).toBe('@page { margin: 10mm; }');
    expect(printPageCss({ landscape: true })).toBe('@page { margin: 10mm; size: landscape; }');
  });
});

describe('buildPrintDocument', () => {
  it('contains only the form, the stylesheet and the page setup', () => {
    const doc = buildPrintDocument('<section class="ics-form">X</section>', {
      title: 'ICS-205 <test>',
      landscape: true,
      css: '.ics-form{color:#000}',
    });
    expect(doc).toContain('<title>ICS-205 &lt;test&gt;</title>');
    expect(doc).toContain('<style>.ics-form{color:#000}</style>');
    expect(doc).toContain('@page { margin: 10mm; size: landscape; }');
    expect(doc).toContain(
      '<body class="ics-printing"><div class="ics-print-root"><section class="ics-form">X</section></div></body>',
    );
    expect(buildPrintDocument('', { css: '' })).not.toContain('size: landscape');
  });
});

describe('printIcsHtml', () => {
  it('prints from a hidden iframe and removes it after printing', async () => {
    document.title = 'OpenHamClock';
    let printedFrom = null;
    const p = printIcsHtml('<section class="ics-form">X</section>', { title: 'ICS-309-test' });
    const frame = document.querySelector('iframe[data-ics-print]');
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.srcdoc).toContain('<div class="ics-print-root"><section class="ics-form">X</section></div>');
    expect(document.title).toBe('ICS-309-test');
    // jsdom does not load srcdoc — drive the load as a browser would
    vi.spyOn(frame.contentWindow, 'print').mockImplementation(() => {
      printedFrom = frame.contentWindow;
      frame.contentWindow.dispatchEvent(new Event('afterprint'));
    });
    vi.spyOn(frame.contentWindow, 'focus').mockImplementation(() => {});
    frame.onload();
    await expect(p).resolves.toBe(true);
    expect(printedFrom).toBe(frame.contentWindow);
    await new Promise((r) => setTimeout(r, 5));
    expect(document.querySelector('iframe[data-ics-print]')).toBeNull();
    expect(document.title).toBe('OpenHamClock');
  });

  it('cleans up by timer when the engine never fires afterprint', async () => {
    vi.useFakeTimers();
    const p = printIcsHtml('<p>Y</p>');
    const frame = document.querySelector('iframe[data-ics-print]');
    vi.spyOn(frame.contentWindow, 'print').mockImplementation(() => {});
    vi.spyOn(frame.contentWindow, 'focus').mockImplementation(() => {});
    frame.onload();
    await p;
    expect(document.querySelector('iframe[data-ics-print]')).not.toBeNull();
    vi.advanceTimersByTime(60 * 1000);
    expect(document.querySelector('iframe[data-ics-print]')).toBeNull();
  });
});

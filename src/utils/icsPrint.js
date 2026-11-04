/**
 * icsPrint — print an ICS form from an isolated document.
 *
 * The form HTML (built by icsForms.js, every value escaped) is printed from a
 * hidden same-origin iframe whose document holds only the form, the ICS
 * stylesheet and the page setup. Printing inside the app's own document was
 * not reliable across engines: with the dashboard hidden by print CSS,
 * Firefox printed only the first page of a multi-page ICS 309, and WebKit
 * added a blank trailing page because of the app's `min-height: 100vh`.
 * An isolated document has none of the app's CSS (theme backgrounds, the
 * fixed scanline overlay, grayscale filters, viewport-height layouts), so
 * every engine paginates just the form. No pop-up window is opened, so pop-up
 * blockers and the desktop app behave the same.
 *
 * Page setup: 10 mm margins, and for the ICS 205 `@page { size: landscape }`.
 * Where an engine ignores @page size the stylesheet's `orientation: portrait`
 * fallback compacts the 205 table to fit a portrait page.
 */
import { esc } from './escapeHtml.js';
import icsCss from '../styles/icsForms.css?inline';

/** The @page rules for the print document. */
export function printPageCss({ landscape = false } = {}) {
  return `@page { margin: 10mm;${landscape ? ' size: landscape;' : ''} }`;
}

/**
 * The complete, self-contained document that gets printed: only the form,
 * black on white. `css` defaults to the bundled ICS stylesheet.
 */
export function buildPrintDocument(html, { title = '', landscape = false, css = icsCss } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title || 'ICS form')}</title>
<style>${css || ''}</style>
<style>
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  ${printPageCss({ landscape })}
</style>
</head>
<body class="ics-printing"><div class="ics-print-root">${html}</div></body>
</html>`;
}

/**
 * Print form HTML. Resolves once the print dialog has been opened (or the
 * document could not be created). The iframe is removed after printing.
 */
export function printIcsHtml(html, { title = '', landscape = false } = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return Promise.resolve(false);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-ics-print', '');
  frame.tabIndex = -1;
  // Off-screen but laid out at page width (a display:none frame cannot print)
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;opacity:0;pointer-events:none;';
  // Browsers name the "Save as PDF" file after the document title
  const prevTitle = document.title;
  if (title) document.title = title;

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    frame.remove();
    if (title) document.title = prevTitle;
  };

  return new Promise((resolve) => {
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        resolve(false);
        return;
      }
      win.addEventListener('afterprint', () => setTimeout(cleanup, 0));
      try {
        win.focus();
        win.print();
        resolve(true);
      } catch {
        cleanup();
        resolve(false);
        return;
      }
      // print() blocks until the dialog closes in Chromium and Firefox; Safari
      // returns at once but still fires afterprint. The timer is a safety net
      // for engines that do neither.
      setTimeout(cleanup, 60 * 1000);
    };
    frame.srcdoc = buildPrintDocument(html, { title, landscape });
    document.body.appendChild(frame);
  });
}

/** Trigger a CSV download in the browser. */
export function downloadCsv(csv, filename) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

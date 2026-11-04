/**
 * Service worker registration + update UX for the PWA / offline mode.
 *
 * Rules:
 *   - Production builds only (import.meta.env.PROD) — the worker must never
 *     interfere with `vite dev`. In dev we go one step further and actively
 *     unregister any worker left behind by a previous production preview on
 *     the same origin.
 *   - Secure contexts only (https or localhost). Pi/self-host users hitting
 *     a LAN IP over plain http get a silent no-op: browsers do not expose
 *     service workers there, so offline mode simply isn't available — no
 *     errors, no console spam.
 *   - Skipped inside the Electron shell (window.electronAPI preload bridge):
 *     Electron ships its assets locally and updates via the installer.
 *
 * Versioning: the registration URL is /sw.js?v=<version>-<buildstamp>, with
 * both values injected at build time by vite.config.mjs `define`. A new
 * build changes the URL, the browser installs the new worker in the
 * background, and we show a small "Update ready — Reload" toast. Clicking
 * Reload messages the waiting worker to skipWaiting and reloads once it
 * takes control.
 *
 * Escape hatch: load the app with `?nosw` in the URL to unregister every
 * service worker on the origin and clear the ohc-* caches (offline area
 * packs excepted) — useful for digging out of a bad deploy or debugging
 * cache weirdness. Example:
 *   https://openhamclock.com/?nosw
 * The parameter is one-shot: remove it and reload to re-register.
 */

// __OHC_VERSION__ / __OHC_BUILD_TS__ are injected by vite.config.mjs `define`
// (declared as globals for src/ in eslint.config.js).

import { isPersistentCacheName } from '../utils/swPolicy.js';

const VERSION = typeof __OHC_VERSION__ !== 'undefined' ? `${__OHC_VERSION__}-${__OHC_BUILD_TS__}` : 'dev';

let userAcceptedUpdate = false;
let reloading = false;

export function setupServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof window !== 'undefined' && window.electronAPI) return; // Electron shell

  if (!import.meta.env.PROD) {
    // Dev server: make sure no stale production worker hijacks vite dev.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    return;
  }

  if (!window.isSecureContext) return; // plain-http LAN: silent no-op

  if (new URLSearchParams(window.location.search).has('nosw')) {
    teardownServiceWorker();
    return;
  }

  const swUrl = `/sw.js?v=${encodeURIComponent(VERSION)}`;

  // Reload (once) after the user accepts an update and the new worker takes
  // control. Guarded so a skipWaiting triggered from another tab can't
  // surprise-reload this one.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userAcceptedUpdate && !reloading) {
      reloading = true;
      window.location.reload();
    }
  });

  // Register after load so the worker never competes with first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        watchForUpdates(reg);
        // Long-lived shack displays: check for a new deploy hourly.
        setInterval(
          () => {
            reg.update().catch(() => {});
          },
          60 * 60 * 1000,
        );
      })
      .catch(() => {
        // Registration failures are non-fatal — the app works without it.
      });
  });
}

function watchForUpdates(reg) {
  // A worker may already be parked in waiting (e.g. the toast was dismissed
  // last session).
  if (reg.waiting && navigator.serviceWorker.controller) {
    handleWaitingWorker(reg.waiting);
  }
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // 'installed' with an existing controller = an update, not first
      // install. First installs activate silently.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        handleWaitingWorker(installing);
      }
    });
  });
}

/** A waiting worker for this page's own build is only the worker catching
 *  up: navigations are network-first, so the page already runs the new
 *  code and there is nothing to reload into. It is left to take over when
 *  the tabs close (forcing skipWaiting here was seen to stall activation
 *  and the next navigation behind it). The toast is for a worker from a
 *  different build — one a tab running newer code registered. */
function handleWaitingWorker(worker) {
  const workerVersion = new URL(worker.scriptURL).searchParams.get('v');
  if (workerVersion === VERSION) return;
  showUpdateToast(worker);
}

/** Unregister everything and clear ohc-* caches (the ?nosw escape hatch).
 *  Offline area packs (ohc-offline-*) are operator-downloaded data, inert
 *  without a worker, and are kept — they are deleted from the pack list. */
async function teardownServiceWorker() {
  const clearOhcCaches = async () => {
    if (typeof caches === 'undefined') return;
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('ohc-') && !isPersistentCacheName(n)).map((n) => caches.delete(n)),
    );
  };
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    await clearOhcCaches();
    // An unregistered worker keeps controlling this page until reload, so
    // late asset/API fetches can re-create a cache behind our back — sweep
    // again once the page has settled.
    setTimeout(() => clearOhcCaches().catch(() => {}), 3000);
    console.info('[SW] ?nosw — service worker unregistered, ohc-* caches cleared');
  } catch {
    // Best-effort teardown.
  }
}

// ── Update toast ──────────────────────────────────────────────────────────
// Deliberately plain DOM (not React) so it works no matter what state the
// component tree is in, styled with the app's theme CSS variables.

function showUpdateToast(waitingWorker) {
  if (document.getElementById('ohc-sw-update-toast')) return;

  const toast = document.createElement('div');
  toast.id = 'ohc-sw-update-toast';
  toast.setAttribute('role', 'status');
  toast.style.cssText = [
    'position:fixed',
    'bottom:16px',
    'right:16px',
    'z-index:10000',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:10px 14px',
    'background:var(--bg-panel, #16213e)',
    'color:var(--text-primary, #e0e0e0)',
    'border:1px solid var(--border-color, #2a2a4a)',
    'border-left:3px solid var(--accent-amber, #fbbf24)',
    'border-radius:6px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    'font-family:var(--font-mono, monospace)',
    'font-size:13px',
  ].join(';');

  const label = document.createElement('span');
  label.textContent = 'Update ready';

  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.textContent = 'Reload';
  reloadBtn.style.cssText = [
    'padding:4px 12px',
    'background:var(--accent-amber, #fbbf24)',
    'color:var(--bg-primary, #0a0e14)',
    'border:none',
    'border-radius:4px',
    'font-family:inherit',
    'font-size:12px',
    'font-weight:700',
    'cursor:pointer',
  ].join(';');
  reloadBtn.addEventListener('click', () => {
    userAcceptedUpdate = true;
    reloadBtn.disabled = true;
    reloadBtn.textContent = '…';
    // The waiting worker calls skipWaiting(), controllerchange fires, and
    // the listener in setupServiceWorker() reloads the page.
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.textContent = '✕';
  dismissBtn.setAttribute('aria-label', 'Dismiss update notification');
  dismissBtn.style.cssText = [
    'padding:2px 6px',
    'background:transparent',
    'color:var(--text-muted, #808080)',
    'border:none',
    'font-family:inherit',
    'font-size:13px',
    'cursor:pointer',
  ].join(';');
  dismissBtn.addEventListener('click', () => toast.remove());

  toast.append(label, reloadBtn, dismissBtn);
  document.body.appendChild(toast);
}

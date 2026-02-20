/**
 * useVersionCheck Hook
 * Polls /api/version every 60 seconds and auto-reloads when a new version is deployed.
 * Shows a brief toast notification before reloading so the user knows what happened.
 */
import { useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';

const POLL_INTERVAL = 60 * 1000; // Check every 60 seconds

export default function useVersionCheck() {
  const knownVersion = useRef(null);
  const toastRef = useRef(null);

  useEffect(() => {
    let timer = null;
    let cancelled = false;

    const check = async () => {
      try {
        const res = await apiFetch('/api/version', { cache: 'no-store' });
        if (!res?.ok) return;
        const { version } = await res.json();
        if (!version) return;

        if (knownVersion.current === null) {
          // First check — store initial version
          knownVersion.current = version;
          return;
        }

        if (version !== knownVersion.current) {
          console.log(`[VersionCheck] Update detected: ${knownVersion.current} → ${version}`);
          showUpdateToast(knownVersion.current, version);
          // Wait a moment so the user can see the toast, then reload
          setTimeout(() => {
            if (!cancelled) window.location.reload();
          }, 3000);
        }
      } catch {
        // Network error — skip silently
      }
    };

    // Initial check after a short delay (let app finish loading)
    const initialTimer = setTimeout(() => {
      if (!cancelled) {
        check();
        timer = setInterval(check, POLL_INTERVAL);
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
      if (toastRef.current) {
        try {
          document.body.removeChild(toastRef.current);
        } catch {}
      }
    };
  }, []);

  function showUpdateToast(oldVer, newVer) {
    // Remove existing toast if any
    if (toastRef.current) {
      try {
        document.body.removeChild(toastRef.current);
      } catch {}
    }

    const toast = document.createElement('div');
    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">🔄</span>
        <div>
          <div style="font-weight: 700; font-size: 13px;">OpenHamClock Updated</div>
          <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">v${oldVer} → v${newVer} — Reloading...</div>
        </div>
      </div>
    `;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'linear-gradient(135deg, rgba(0,40,20,0.95), rgba(0,20,40,0.95))',
      border: '1px solid rgba(0, 255, 136, 0.5)',
      borderRadius: '12px',
      padding: '14px 24px',
      color: '#e2e8f0',
      fontFamily: 'JetBrains Mono, monospace',
      zIndex: '999999',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,255,136,0.15)',
      animation: 'vcheck-slide-in 0.4s ease-out',
    });

    // Add animation keyframes if not present
    if (!document.getElementById('vcheck-styles')) {
      const style = document.createElement('style');
      style.id = 'vcheck-styles';
      style.textContent = `
        @keyframes vcheck-slide-in {
          from { transform: translateX(-50%) translateY(30px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    toastRef.current = toast;
  }
}

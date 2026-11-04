/**
 * LogQsoPopup — app-level modal for the "log from spot" (📓+) buttons.
 *
 * The 📓+ buttons on DX cluster / activation spots call requestLogQso(); a
 * mounted LogbookPanel consumes that prefill and opens its inline form. In
 * layouts without a Logbook panel the request used to sit in the queue and
 * nothing visible happened. LogQsoPopupController (mounted once in App.jsx)
 * fills that gap: it subscribes to prefill events and opens this modal ONLY
 * when no LogbookPanel is mounted, so the panel keeps priority everywhere it
 * exists.
 *
 * Contest layout exception: the Contest layout deliberately never gets the
 * popup. Its keyboard-first quick-log strip (ContestLogStrip) is the intended
 * logging path there — it is always visible, pre-armed with band/mode/rig
 * state, and a modal stealing keyboard focus mid-run would be worse than not
 * opening at all.
 *
 * Saving goes through the same path as LogbookPanel's new-QSO flow:
 * logbookStore.add({...record, extras:{}}) followed by the onQsoLogged
 * log-sync hand-off (Wavelog/QRZ retry queue), then a short confirmation
 * flash and auto-close.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { add as addQso, consumePendingPrefill, hasMountedPanel, subscribePrefill } from '../services/logbookStore.js';
import { onQsoLogged } from '../utils/logsync.js';
import QsoForm from './QsoForm.jsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The modal itself — rendered only while a prefill is being handled. */
export function LogQsoPopup({ prefill, myGrid, userCallsign, onClose, onDXChange, dxLocation, dxCallsign }) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const [loggedCall, setLoggedCall] = useState(null); // set → confirmation flash
  const closeTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  // Esc closes; Tab is kept inside the dialog (focus-trap-ish: enough for a
  // single small form — the QsoForm autofocuses the callsign input on mount).
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = containerRef.current?.querySelectorAll(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const handleSaved = async (record) => {
    const saved = await addQso({ ...record, extras: {} });
    // Log-sync hand-off — exactly as LogbookPanel does for a new QSO.
    onQsoLogged(saved, { myCall: userCallsign });
    setLoggedCall(saved.call);
    closeTimerRef.current = setTimeout(onClose, 1400);
  };

  return (
    <div
      onClick={onClose}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
        padding: '16px',
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('logbook.popup.title', { defaultValue: 'Log QSO' })}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--accent-green)',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          padding: '12px',
          width: 'min(94vw, 460px)',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '12px', color: 'var(--accent-green)', fontWeight: 700 }}>
            📓 {t('logbook.popup.title', { defaultValue: 'Log QSO' })}
            {prefill?.call ? (
              <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}> — {prefill.call}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('logbook.popup.close', { defaultValue: 'Close without logging' })}
            title={t('logbook.popup.close', { defaultValue: 'Close without logging' })}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '14px',
              lineHeight: 1,
              padding: '2px',
            }}
          >
            ✕
          </button>
        </div>
        {loggedCall ? (
          <div
            role="status"
            style={{
              textAlign: 'center',
              padding: '18px 8px',
              color: 'var(--accent-green)',
              fontSize: '13px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
            }}
          >
            ✓ {t('logbook.popup.logged', { defaultValue: 'QSO with {{call}} logged', call: loggedCall })}
          </div>
        ) : (
          <QsoForm
            prefill={prefill}
            myGrid={myGrid}
            onSaved={handleSaved}
            onCancel={onClose}
            autoFocusCall
            onDXChange={onDXChange}
            dxLocation={dxLocation}
            dxCallsign={dxCallsign}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Controller mounted once in App.jsx. Listens for requestLogQso() prefills
 * and opens the popup when — and only when — no LogbookPanel is mounted and
 * the current layout is not 'contest' (see file header for why).
 */
export function LogQsoPopupController({ layout, userCallsign, myGrid, onDXChange, dxLocation, dxCallsign }) {
  const [prefill, setPrefill] = useState(null);
  const [instanceKey, setInstanceKey] = useState(0);

  // Layout is read through a ref so the store subscription is set up once.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    return subscribePrefill(() => {
      // A mounted LogbookPanel consumes prefills itself — never double-handle.
      // (Note: in the dockable layout a Logbook tab hidden behind another tab
      // is not mounted, so the popup covers that case too.)
      if (hasMountedPanel()) return;
      // Contest layout: the quick-log strip is the intended path — leave the
      // prefill unconsumed rather than hijack the operator's keyboard focus.
      if (layoutRef.current === 'contest') return;
      const p = consumePendingPrefill();
      if (!p) return;
      const { requestedAt: _requestedAt, ...fields } = p;
      setPrefill(fields);
      setInstanceKey((k) => k + 1); // remount → fresh form even if already open
    });
  }, []);

  if (!prefill) return null;
  return (
    <LogQsoPopup
      key={instanceKey}
      prefill={prefill}
      userCallsign={userCallsign}
      myGrid={myGrid}
      onClose={() => setPrefill(null)}
      onDXChange={onDXChange}
      dxLocation={dxLocation}
      dxCallsign={dxCallsign}
    />
  );
}

export default LogQsoPopup;

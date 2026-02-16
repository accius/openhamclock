/**
 * CallsignLink — clickable callsign that opens QRZ.com
 * 
 * Usage:
 *   <CallsignLink call="K1ABC" color="#fff" fontWeight="700" />
 * 
 * Reads the global toggle from localStorage (ohc_qrz_links).
 * When enabled, clicking opens https://www.qrz.com/db/CALLSIGN in a new tab.
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';

// ── Extract base callsign from decorated/portable calls ──
// 5Z4/OZ6ABL → OZ6ABL, UA1TAN/M → UA1TAN, W1ABC/6 → W1ABC
// Picks the segment that looks most like a home callsign.
const MODIFIERS = new Set(['M','P','QRP','MM','AM','R','T','B','BCN','LH','A','E','J','AG','AE','KT']);
function extractBaseCall(raw) {
  if (!raw || !raw.includes('/')) return raw || '';
  const parts = raw.toUpperCase().split('/');
  const candidates = parts.filter(p => p && !MODIFIERS.has(p) && !/^\d$/.test(p));
  if (candidates.length === 0) return parts[0] || raw;
  if (candidates.length === 1) return candidates[0];
  const pat = /^[A-Z]{1,3}\d{1,4}[A-Z]{1,4}$/;
  const full = candidates.filter(c => pat.test(c));
  if (full.length === 1) return full[0];
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

// ── Context for the global QRZ toggle ──
const QRZContext = createContext({ enabled: true, toggle: () => {} });

export function QRZProvider({ children }) {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem('ohc_qrz_links') !== 'false'; } catch { return true; }
  });

  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('ohc_qrz_links', String(next)); } catch {}
      return next;
    });
  }, []);

  return (
    <QRZContext.Provider value={{ enabled, toggle }}>
      {children}
    </QRZContext.Provider>
  );
}

export function useQRZ() {
  return useContext(QRZContext);
}

// ── Toggle button for panel headers ──
export function QRZToggle({ style }) {
  const { enabled, toggle } = useQRZ();
  return (
    <span
      onClick={(e) => { e.stopPropagation(); toggle(); }}
      title={enabled ? 'Click callsigns to open QRZ.com (ON)' : 'QRZ callsign links disabled (OFF)'}
      style={{
        cursor: 'pointer',
        fontSize: '11px',
        opacity: enabled ? 1 : 0.4,
        userSelect: 'none',
        transition: 'opacity 0.2s',
        ...style
      }}
    >🔍</span>
  );
}

// ── The callsign link itself ──
export default function CallsignLink({
  call,
  color = 'inherit',
  fontWeight = 'inherit',
  fontSize = 'inherit',
  style = {},
  children
}) {
  const { enabled } = useQRZ();

  if (!call) return children || null;

  // Strip portable suffixes and prefixes for QRZ lookup (5Z4/OZ6ABL → OZ6ABL, UA1TAN/M → UA1TAN)
  const baseCall = extractBaseCall(call);

  const handleClick = (e) => {
    if (!enabled) return;
    e.stopPropagation();
    window.open(`https://www.qrz.com/db/${encodeURIComponent(baseCall)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <span
      onClick={handleClick}
      style={{
        color,
        fontWeight,
        fontSize,
        cursor: enabled ? 'pointer' : 'inherit',
        borderBottom: enabled ? '1px dotted rgba(255,255,255,0.15)' : 'none',
        transition: 'color 0.15s',
        ...style
      }}
      onMouseEnter={(e) => { if (enabled) e.target.style.color = 'var(--accent-cyan)'; }}
      onMouseLeave={(e) => { if (enabled) e.target.style.color = color; }}
      title={enabled ? `Look up ${call} on QRZ.com` : call}
    >
      {children || call}
    </span>
  );
}

// ── Global handler for Leaflet HTML popups ──
// Call setupMapQRZHandler() once on app mount.
// In popup HTML, use: <b data-qrz-call="K1ABC" style="cursor:pointer">K1ABC</b>
let _mapHandlerInstalled = false;
export function setupMapQRZHandler() {
  if (_mapHandlerInstalled) return;
  _mapHandlerInstalled = true;
  
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-qrz-call]');
    if (!el) return;
    
    // Check if QRZ links are enabled
    let enabled = true;
    try { enabled = localStorage.getItem('ohc_qrz_links') !== 'false'; } catch {}
    if (!enabled) return;
    
    const call = el.getAttribute('data-qrz-call');
    if (call) {
      const baseCall = extractBaseCall(call);
      window.open(`https://www.qrz.com/db/${encodeURIComponent(baseCall)}`, '_blank', 'noopener,noreferrer');
    }
  });
}

/**
 * KioskUnlockDialog — touch-friendly PIN pad shown when a locked kiosk
 * display is asked to open Settings, change layout or open the palette.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];

export default function KioskUnlockDialog({ open, onCancel, onSubmit }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) {
      setPin('');
      setError(false);
      return undefined;
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
      else if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') press('OK');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pin]);

  if (!open) return null;

  function press(k) {
    setError(false);
    if (k === '⌫') return setPin((p) => p.slice(0, -1));
    if (k === 'OK') {
      if (onSubmit(pin)) return setPin('');
      setError(true);
      return setPin('');
    }
    setPin((p) => (p.length < 8 ? p + k : p));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('kiosk.unlock.title')}
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '20px',
          width: 'min(320px, 92vw)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-primary)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-amber)', marginBottom: '6px' }}>
          🔒 {t('kiosk.unlock.title')}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          {t('kiosk.unlock.hint')}
        </div>
        <div
          aria-live="polite"
          style={{
            fontSize: '28px',
            letterSpacing: '8px',
            minHeight: '40px',
            color: error ? 'var(--accent-red)' : 'var(--accent-cyan)',
            marginBottom: '12px',
          }}
        >
          {error ? t('kiosk.unlock.wrong') : '•'.repeat(pin.length) || ' '}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              aria-label={k === '⌫' ? t('kiosk.unlock.backspace') : k === 'OK' ? t('kiosk.unlock.submit') : k}
              style={{
                padding: '14px 0',
                fontSize: '18px',
                fontWeight: 700,
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: k === 'OK' ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                color: k === 'OK' ? '#000' : 'var(--text-primary)',
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          style={{
            marginTop: '12px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {t('kiosk.unlock.cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * DonateButton — single "Support Us" button that opens a modal
 * with PayPal, Buy Me a Coffee, and merch store links.
 */
import React, { useState, useEffect, useCallback } from 'react';

const PAYPAL_URL = 'https://www.paypal.com/donate/?hosted_button_id=MMYPQBLA6SW68';
const COFFEE_URL = 'https://buymeacoffee.com/k0cjh';
const MERCH_URL = 'https://openhamclock.printify.me';

export default function DonateButton({ compact = false, fontSize = '12px', padding = '6px 10px' }) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Support OpenHamClock"
        style={{
          background: 'linear-gradient(135deg, #ff813f 0%, #ffdd00 100%)',
          border: 'none',
          padding,
          borderRadius: '4px',
          color: '#000',
          fontSize,
          cursor: 'pointer',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          whiteSpace: 'nowrap',
        }}
      >
        ❤️{compact ? '' : ' Support Us'}
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100000,
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-secondary, #1a1a2e)',
              border: '1px solid var(--border-color, #333)',
              borderRadius: '12px',
              padding: '28px 32px',
              minWidth: '320px',
              maxWidth: '400px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: 'var(--text-primary, #eee)', fontSize: '18px' }}>
                Support OpenHamClock
              </h3>
              <button
                onClick={close}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted, #888)',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  lineHeight: 1,
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            <p style={{ color: 'var(--text-secondary, #aaa)', fontSize: '13px', margin: '0 0 20px 0', lineHeight: 1.5 }}>
              OpenHamClock is free and open-source. Your support helps cover hosting costs and fund new features. 73!
            </p>

            {/* Donate options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a
                href={COFFEE_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #ff813f 0%, #ffdd00 100%)',
                  color: '#000',
                  textDecoration: 'none',
                  fontWeight: '600',
                  fontSize: '14px',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                <span style={{ fontSize: '22px' }}>☕</span>
                <div>
                  <div>Buy Me a Coffee</div>
                  <div style={{ fontSize: '11px', fontWeight: '400', opacity: 0.8 }}>One-time or monthly support</div>
                </div>
              </a>

              <a
                href={PAYPAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #0070ba 0%, #003087 100%)',
                  color: '#fff',
                  textDecoration: 'none',
                  fontWeight: '600',
                  fontSize: '14px',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                <span style={{ fontSize: '22px' }}>💳</span>
                <div>
                  <div>Donate via PayPal</div>
                  <div style={{ fontSize: '11px', fontWeight: '400', opacity: 0.8 }}>Secure one-time donation</div>
                </div>
              </a>

              <div style={{
                borderTop: '1px solid var(--border-color, #333)',
                margin: '6px 0 2px 0',
                paddingTop: '14px',
              }}>
                <div style={{ color: 'var(--text-muted, #888)', fontSize: '11px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Merch Store
                </div>
                <a
                  href={MERCH_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: '8px',
                    background: 'var(--bg-tertiary, #252540)',
                    border: '1px solid var(--border-color, #333)',
                    color: 'var(--text-primary, #eee)',
                    textDecoration: 'none',
                    fontWeight: '600',
                    fontSize: '14px',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-green, #00ff88)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-color, #333)')}
                >
                  <span style={{ fontSize: '22px' }}>🛍️</span>
                  <div>
                    <div>OpenHamClock Merch</div>
                    <div style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-muted, #aaa)' }}>Shirts, mugs, stickers & more</div>
                  </div>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

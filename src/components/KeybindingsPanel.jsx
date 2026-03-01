/**
 * KeybindingsPanel Component
 * Displays all current keybindings in a floating panel or dockable panel
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

export const KeybindingsPanel = ({ isOpen, onClose, keybindings, nodeId }) => {
  const { t } = useTranslation();
  const isDocked = !!nodeId;

  // Handle escape key to close (only for modal mode)
  React.useEffect(() => {
    if (!isOpen || isDocked) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, isDocked]);

  // Modal mode - only render if open
  if (!isDocked && !isOpen) return null;

  // Docked mode - render as panel content
  if (isDocked) {
    return (
      <div style={{ padding: '12px', height: '100%', overflowY: 'auto' }}>
        <div
          style={{
            fontSize: '0.85em',
            color: 'var(--text-secondary)',
            marginBottom: '12px',
            lineHeight: '1.5',
          }}
        >
          {t('keybindings.panel.description', 'Press the following keys to toggle map layers:')}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '6px',
          }}
        >
          {keybindings.map(({ key, description }) => (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
              }}
            >
              <kbd
                style={{
                  minWidth: '24px',
                  padding: '3px 6px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  fontSize: '0.85em',
                  fontWeight: '700',
                  fontFamily: 'JetBrains Mono, monospace',
                  color: 'var(--accent-amber)',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                }}
              >
                {key}
              </kbd>
              <span
                style={{
                  fontSize: '0.85em',
                  color: 'var(--text-primary)',
                  lineHeight: '1.3',
                }}
              >
                {description}
              </span>
            </div>
          ))}
          <div
            style={{
              padding: '6px 8px',
              background: 'var(--bg-panel)',
              border: '1px solid var(--accent-cyan)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <kbd
              style={{
                minWidth: '24px',
                padding: '3px 6px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--accent-cyan)',
                borderRadius: '3px',
                fontSize: '0.85em',
                fontWeight: '700',
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--accent-cyan)',
                textAlign: 'center',
              }}
            >
              ?
            </kbd>
            <span
              style={{
                fontSize: '0.85em',
                color: 'var(--text-primary)',
                lineHeight: '1.3',
              }}
            >
              {t('keybindings.panel.toggle', 'Toggle this help panel')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Modal mode - render as floating overlay
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          width: '700px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: '700',
              color: 'var(--accent-cyan)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.5px',
            }}
          >
            ⌨ {t('keybindings.panel.title', 'KEYBOARD SHORTCUTS')}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 8px',
              lineHeight: '1',
            }}
            onMouseEnter={(e) => (e.target.style.color = 'var(--accent-red)')}
            onMouseLeave={(e) => (e.target.style.color = 'var(--text-muted)')}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '20px',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          <div
            style={{
              marginBottom: '16px',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: '1.6',
            }}
          >
            {t('keybindings.panel.description', 'Press the following keys to toggle map layers:')}
          </div>

          {/* Keybindings list - 2 column grid for better space usage */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px',
            }}
          >
            {keybindings.map(({ key, description }) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '8px 12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                }}
              >
                <kbd
                  style={{
                    minWidth: '32px',
                    padding: '4px 8px',
                    background: 'var(--bg-secondary)',
                    border: '2px solid var(--border-color)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '700',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: 'var(--accent-amber)',
                    textAlign: 'center',
                    textTransform: 'uppercase',
                    boxShadow: '0 2px 0 var(--border-color)',
                  }}
                >
                  {key}
                </kbd>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                    lineHeight: '1.3',
                  }}
                >
                  {description}
                </span>
              </div>
            ))}

            {/* Special keybinding for help */}
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--accent-cyan)',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                gridColumn: 'span 2',
              }}
            >
              <kbd
                style={{
                  minWidth: '32px',
                  padding: '4px 8px',
                  background: 'var(--bg-secondary)',
                  border: '2px solid var(--accent-cyan)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '700',
                  fontFamily: 'JetBrains Mono, monospace',
                  color: 'var(--accent-cyan)',
                  textAlign: 'center',
                  boxShadow: '0 2px 0 var(--accent-cyan)',
                }}
              >
                ?
              </kbd>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                }}
              >
                {t('keybindings.panel.toggle', 'Toggle this help panel')}
              </span>
            </div>
          </div>

          {/* Footer note */}
          <div
            style={{
              marginTop: '16px',
              padding: '10px',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              fontSize: '11px',
              color: 'var(--text-muted)',
              lineHeight: '1.5',
            }}
          >
            💡 {t('keybindings.panel.note', 'Press ESC or click outside to close this panel')}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KeybindingsPanel;

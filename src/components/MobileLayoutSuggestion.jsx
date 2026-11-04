/**
 * One-time offer of the Mobile layout on a phone-sized first visit.
 * A small bottom sheet (safe-area aware) with Use / Not now; App.jsx
 * decides when to show it (utils/mobileLayout.js shouldSuggestMobileLayout)
 * and remembers the answer either way.
 */
import { useTranslation } from 'react-i18next';

export default function MobileLayoutSuggestion({ onAccept, onDismiss }) {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="ohc-mobile-suggest-title"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9000,
        padding:
          '12px max(16px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px))',
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--accent-amber)',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.45)',
        fontFamily: 'var(--font-mono)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <div
          id="ohc-mobile-suggest-title"
          style={{ color: 'var(--accent-amber)', fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}
        >
          📱 {t('mobileLayout.suggest.title', { defaultValue: 'Use the Mobile layout?' })}
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.4, marginBottom: '10px' }}>
          {t('mobileLayout.suggest.body', {
            defaultValue:
              'This screen looks like a phone. The Mobile layout puts the map on top and your panels in swipeable cards below, sized for touch. You can change layouts any time in Settings → Display.',
          })}
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              minHeight: '44px',
              padding: '0 16px',
              borderRadius: '8px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontFamily: 'inherit',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {t('mobileLayout.suggest.dismiss', { defaultValue: 'Not now' })}
          </button>
          <button
            type="button"
            onClick={onAccept}
            style={{
              minHeight: '44px',
              padding: '0 16px',
              borderRadius: '8px',
              background: 'var(--accent-amber)',
              border: '1px solid var(--accent-amber)',
              color: '#000',
              fontFamily: 'inherit',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('mobileLayout.suggest.accept', { defaultValue: 'Use Mobile layout' })}
          </button>
        </div>
      </div>
    </div>
  );
}

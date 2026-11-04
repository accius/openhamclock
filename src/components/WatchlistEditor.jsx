/**
 * WatchlistEditor — edit one HamClock-style watch list: a mode selector
 * (Off / Red / Only / Not) and the spec text, with parse errors shown as you
 * type. Shared by the DX filter dialog, the activation filter dialogs, the
 * Logbook panel and Settings, all bound to the same store.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWatchlist } from '../hooks/useWatchlists.js';
import { parseWatchlist, WATCHLIST_MODES } from '../utils/watchlistSpec.js';

const MODE_COLORS = {
  off: 'var(--text-muted)',
  red: 'var(--accent-red)',
  only: 'var(--accent-green)',
  not: 'var(--accent-amber)',
};

export const WatchlistEditor = ({ listKey, title, compact = false, placeholder }) => {
  const { t } = useTranslation();
  const [list, setList] = useWatchlist(listKey);
  const parsed = useMemo(() => parseWatchlist(list.text), [list.text]);

  const modeLabel = (mode) =>
    t(`watchlist.mode.${mode}`, { defaultValue: mode.charAt(0).toUpperCase() + mode.slice(1) });
  const modeHelp = {
    off: t('watchlist.modeHelp.off', { defaultValue: 'List is ignored' }),
    red: t('watchlist.modeHelp.red', { defaultValue: 'Highlight matches in red' }),
    only: t('watchlist.modeHelp.only', { defaultValue: 'Show only matches' }),
    not: t('watchlist.modeHelp.not', { defaultValue: 'Hide matches' }),
  };

  return (
    <div data-testid={`watchlist-editor-${listKey}`}>
      {title && (
        <div
          style={{
            fontSize: compact ? '11px' : '13px',
            fontWeight: '600',
            color: 'var(--text-primary)',
            marginBottom: '6px',
          }}
        >
          {title}
        </div>
      )}
      <div
        role="radiogroup"
        aria-label={t('watchlist.modeLabel', { defaultValue: 'Watch list mode' })}
        style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}
      >
        {WATCHLIST_MODES.map((mode) => {
          const active = list.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${modeLabel(mode)} — ${modeHelp[mode]}`}
              title={modeHelp[mode]}
              onClick={() => setList({ ...list, mode })}
              style={{
                padding: compact ? '2px 8px' : '4px 12px',
                borderRadius: '4px',
                border: `1px solid ${active ? MODE_COLORS[mode] : 'var(--border-color)'}`,
                background: active ? 'var(--bg-tertiary)' : 'transparent',
                color: active ? MODE_COLORS[mode] : 'var(--text-secondary)',
                fontSize: compact ? '10px' : '12px',
                fontWeight: active ? '700' : '400',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {modeLabel(mode)}
            </button>
          );
        })}
      </div>
      <textarea
        value={list.text}
        onChange={(e) => setList({ ...list, text: e.target.value })}
        rows={compact ? 2 : 3}
        spellCheck={false}
        aria-label={t('watchlist.textLabel', { defaultValue: 'Watch list specification' })}
        placeholder={
          placeholder || t('watchlist.placeholder', { defaultValue: 'e.g. 20M NADXCC, 40CW VP2E, 14-14.02MHZ, 3Y/' })
        }
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '6px 8px',
          background: 'var(--bg-secondary)',
          border: `1px solid ${parsed.errors.length ? 'var(--accent-red)' : 'var(--border-color)'}`,
          borderRadius: '4px',
          color: 'var(--text-primary)',
          fontSize: compact ? '11px' : '12px',
          fontFamily: 'var(--font-mono)',
          resize: 'vertical',
        }}
      />
      {parsed.errors.length > 0 && (
        <div role="alert" style={{ fontSize: '10px', color: 'var(--accent-red)', marginTop: '4px' }}>
          {parsed.errors.slice(0, 3).join(' · ')}
        </div>
      )}
      {!compact && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5 }}>
          {t('watchlist.help', {
            defaultValue:
              'Comma-separated specs; a spot matches when every part of any one spec fits. Parts: bands (40M, 20-10M), sub-bands (40CW, 20SSB, 30FT8, 160-10CW; modes CW DATA FT4 FT8 RTTY SSB), frequencies in MHz (14-14.02MHZ), logbook keywords NADXCC NAPREF NAGRID NABAND (not yet worked), and prefixes (VP2E matches VP2E/K0CJH and K0CJH/VP2E; a trailing / matches the DX portion only).',
          })}
        </div>
      )}
    </div>
  );
};

export default WatchlistEditor;

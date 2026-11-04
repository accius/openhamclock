/**
 * MotdBanner — the server admin's message of the day (GET /api/motd).
 *
 * A slim bar at the top of the app, shown until dismissed; the dismissed
 * message id is remembered per browser, so a *changed* message comes back.
 * Bare URLs in the text are clickable, plus any explicit links the server
 * sends. Re-checks every 10 minutes so a new message appears without a
 * reload. Renders nothing when the server has no message (the default on
 * self-hosted installs without MOTD set).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../utils/apiFetch';
import { linkifyMotd, shouldShowMotd, setDismissedMotdId } from '../utils/motd.js';

const REFRESH_MS = 10 * 60 * 1000;

export default function MotdBanner() {
  const { t } = useTranslation();
  const [motd, setMotd] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch('/api/motd', { signal: AbortSignal.timeout(8000) });
        if (!res?.ok) return;
        const body = await res.json();
        if (cancelled) return;
        setMotd(body);
        setVisible(shouldShowMotd(body));
      } catch {
        /* no banner on failure */
      }
    };
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!visible || !motd) return null;

  const dismiss = () => {
    setDismissedMotdId(motd.id);
    setVisible(false);
  };

  const inlineUrls = new Set();
  const segments = linkifyMotd(motd.text).map((seg) => {
    if (seg.url) inlineUrls.add(seg.url);
    return seg;
  });
  const extraLinks = (motd.links || []).filter((l) => l?.url && !inlineUrls.has(l.url));

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 12px',
        background: 'var(--bg-tertiary)',
        borderBottom: '1px solid var(--accent-amber)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        color: 'var(--text-primary)',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden="true" style={{ color: 'var(--accent-amber)' }}>
        📣
      </span>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {segments.map((seg, i) =>
          seg.url ? (
            <a
              key={i}
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}
            >
              {seg.url}
            </a>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
        {extraLinks.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginLeft: '8px',
              padding: '1px 6px',
              borderRadius: '3px',
              border: '1px solid var(--accent-cyan)',
              color: 'var(--accent-cyan)',
              textDecoration: 'none',
              fontSize: '11px',
              whiteSpace: 'nowrap',
            }}
          >
            {l.label || l.url}
          </a>
        ))}
      </span>
      <button
        type="button"
        onClick={dismiss}
        title={t('motd.dismiss', { defaultValue: 'Dismiss this message' })}
        aria-label={t('motd.dismiss', { defaultValue: 'Dismiss this message' })}
        style={{
          background: 'transparent',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '12px',
          padding: '1px 7px',
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

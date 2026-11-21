/**
 * HelpTab — Settings → Help: the full user manual (docs/MANUAL.md)
 * rendered in-app.
 *
 * The manual is lazy-loaded via a dynamic `?raw` import so it lives in
 * its own build chunk and costs nothing until the tab is first opened
 * (and works offline afterwards — the PWA caches the chunk).
 *
 * Layout: sticky TOC sidebar built from the manual's headings (with a
 * search-as-filter box), the rendered manual, and a footer link to the
 * GitHub docs. On narrow widths the TOC collapses behind a toggle.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownView, { extractHeadings } from './MarkdownView.jsx';

const MANUAL_GITHUB_URL = 'https://github.com/accius/openhamclock/blob/main/docs/MANUAL.md';
// Screenshot fallback for an image the bundle does not carry.
const MANUAL_IMAGE_RAW_BASE = 'https://raw.githubusercontent.com/accius/openhamclock/main/docs/';

// The manual's screenshots ship inside the build (hashed assets), so the
// Help tab works self-hosted and offline, and Staging previews show the
// Staging screenshots rather than whatever main has. Eager only for the
// URL strings — the JPEGs themselves load when scrolled into view.
const MANUAL_IMAGES = import.meta.glob('../../docs/images/manual/*.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});
const manualImageByName = Object.fromEntries(
  Object.entries(MANUAL_IMAGES).map(([path, url]) => [path.split('/').pop(), url]),
);
export const resolveManualImage = (src) => {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return src;
  const name = src.split('/').pop();
  return manualImageByName[name] || MANUAL_IMAGE_RAW_BASE + src.replace(/^\.\//, '');
};
const NARROW_WIDTH = 700;

// Cache across opens — the manual never changes within a session.
let manualCache = null;
const loadManual = () => import('../../docs/MANUAL.md?raw');

export const HelpTab = ({ anchor }) => {
  const { t } = useTranslation();
  const [manual, setManual] = useState(manualCache);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < NARROW_WIDTH);
  const [tocOpen, setTocOpen] = useState(true);
  const containerRef = useRef(null);

  // Lazy-load the manual on first open
  useEffect(() => {
    if (manualCache) return;
    let cancelled = false;
    loadManual()
      .then((mod) => {
        manualCache = mod.default;
        if (!cancelled) setManual(mod.default);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Collapse the TOC on narrow widths
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const scrollTo = useCallback((id) => {
    const root = containerRef.current;
    if (!root || !id) return false;
    let el = null;
    try {
      el = root.querySelector(`#${CSS.escape(id)}`);
    } catch {
      el = null;
    }
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }, []);

  // Deep-link scroll: retry briefly until the manual has rendered and
  // the anchor element exists.
  useEffect(() => {
    if (!anchor) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (scrollTo(anchor) || tries > 30) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [anchor, manual, scrollTo]);

  // TOC from headings (skip the h1 title and the manual's own Contents list)
  const headings = useMemo(() => {
    if (!manual) return [];
    return extractHeadings(manual).filter((h) => (h.level === 2 || h.level === 3) && h.id !== 'contents');
  }, [manual]);

  const filteredHeadings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return headings;
    return headings.filter((h) => h.text.toLowerCase().includes(q));
  }, [headings, search]);

  const showToc = !isNarrow || tocOpen;

  if (loadError) {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '24px', textAlign: 'center' }}>
        {t('help.error')}{' '}
        <a href={MANUAL_GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-cyan)' }}>
          {t('help.footer.github')}
        </a>
      </div>
    );
  }

  if (!manual) {
    return <div style={{ color: 'var(--text-muted)', padding: '24px', textAlign: 'center' }}>{t('help.loading')}</div>;
  }

  return (
    <div>
      {isNarrow && (
        <button
          type="button"
          onClick={() => setTocOpen((v) => !v)}
          aria-expanded={tocOpen}
          style={{
            marginBottom: '12px',
            padding: '6px 12px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {tocOpen ? t('help.toc.hide') : t('help.toc.show')}
        </button>
      )}

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        {/* Sticky TOC sidebar */}
        {showToc && (
          <nav
            aria-label={t('help.toc')}
            style={{
              position: 'sticky',
              top: 0,
              width: isNarrow ? '100%' : '230px',
              flexShrink: 0,
              maxHeight: isNarrow ? '40vh' : '70vh',
              overflowY: 'auto',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '10px',
            }}
          >
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('help.search')}
              aria-label={t('help.search')}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '6px 8px',
                marginBottom: '8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                color: 'var(--text-primary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
              }}
            />
            {filteredHeadings.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '4px' }}>{t('help.noResults')}</div>
            )}
            {filteredHeadings.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  scrollTo(h.id);
                  if (isNarrow) setTocOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: h.level === 2 ? '5px 4px' : '3px 4px 3px 16px',
                  color: h.level === 2 ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontSize: h.level === 2 ? '12px' : '11px',
                  fontWeight: h.level === 2 ? 600 : 400,
                  lineHeight: 1.35,
                  fontFamily: 'var(--font-mono)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-cyan)')}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = h.level === 2 ? 'var(--text-primary)' : 'var(--text-muted)')
                }
              >
                {h.text}
              </button>
            ))}
          </nav>
        )}

        {/* Rendered manual */}
        <div ref={containerRef} style={{ flex: 1, minWidth: 0 }}>
          <MarkdownView markdown={manual} resolveImage={resolveManualImage} />

          {/* Footer link to the GitHub docs */}
          <div
            style={{
              marginTop: '24px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-color)',
              fontSize: '12px',
              color: 'var(--text-muted)',
            }}
          >
            <a href="/badges" style={{ color: 'var(--accent-cyan)', marginRight: '16px' }}>
              Solar badge builder
            </a>
            <a
              href={MANUAL_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-cyan)' }}
            >
              {t('help.footer.github')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpTab;

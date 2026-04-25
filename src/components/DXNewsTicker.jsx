/**
 * DXNewsTicker Component
 * Scrolling news banner showing latest DX news headlines from the multi-source aggregator.
 * Respects showDXNews setting from mapLayers (reads from localStorage directly as fallback)
 *
 * D-07: Returns null when merged items array is empty
 * D-11: Dynamic per-source label that rotates as items scroll (min 5s dwell)
 * D-12: Source label opens current source's homepage in a new tab
 * D-13: Hover pauses scroll (CSS-driven); click on item opens article in new tab
 */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// Base font sizes (px) — all sizes are derived by multiplying with textScale
const BASE_LABEL_SIZE = 10; // source label, separator ◆
const BASE_TEXT_SIZE = 11; // news titles and descriptions
const BASE_HEIGHT = 28; // container height in map overlay mode (px)

// Check if DX News is enabled (reads directly from localStorage as belt-and-suspenders)
function isDXNewsEnabled() {
  try {
    const stored = localStorage.getItem('openhamclock_mapLayers');
    if (stored) {
      const layers = JSON.parse(stored);
      return layers.showDXNews !== false;
    }
  } catch {}
  return true; // default on
}

export const DXNewsTicker = ({ sidebar = false }) => {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(isDXNewsEnabled);
  const tickerRef = useRef(null);
  const contentRef = useRef(null);
  const [animDuration, setAnimDuration] = useState(120);
  // D-11: current source index for dynamic label rotation
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
  // D-13: hovered state mirrored in React for testability (CSS drives actual animation pause)
  const [hovered, setHovered] = useState(false);
  const { t } = useTranslation();

  // Text scale persisted in localStorage (0.7 – 2.0, default 1.0)
  const [textScale, setTextScale] = useState(() => {
    try {
      const stored = localStorage.getItem('openhamclock_dxNewsTextScale');
      if (stored) return parseFloat(stored);
    } catch {}
    return 1.0;
  });

  // Persist textScale whenever it changes
  useEffect(() => {
    localStorage.setItem('openhamclock_dxNewsTextScale', String(textScale));
  }, [textScale]);

  // Listen for mapLayers changes (custom event for same-tab, storage for cross-tab)
  useEffect(() => {
    const checkVisibility = () => setVisible(isDXNewsEnabled());

    window.addEventListener('mapLayersChanged', checkVisibility);
    window.addEventListener('storage', checkVisibility);
    return () => {
      window.removeEventListener('mapLayersChanged', checkVisibility);
      window.removeEventListener('storage', checkVisibility);
    };
  }, []);

  // Fetch news
  useEffect(() => {
    if (!visible) return;

    const fetchNews = async () => {
      try {
        const res = await fetch('/api/dxnews');
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            setNews(data.items);
          } else {
            setNews([]);
          }
        }
      } catch (err) {
        console.error('DX News ticker fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
    // Refresh every 30 minutes
    const interval = setInterval(fetchNews, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [visible]);

  // Calculate animation duration based on content width.
  // textScale is included so speed recalculates after a font-size change
  // (useEffect runs after paint, so scrollWidth reflects the new size).
  useEffect(() => {
    if (contentRef.current && tickerRef.current) {
      const contentWidth = contentRef.current.scrollWidth;
      const containerWidth = tickerRef.current.offsetWidth;
      // ~90px per second scroll speed
      const duration = Math.max(20, (contentWidth + containerWidth) / 90);
      setAnimDuration(duration);
    }
  }, [news, textScale]);

  // Inject keyframes animation style once, including CSS-only hover-pause (D-13)
  useEffect(() => {
    if (document.getElementById('dxnews-scroll-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'dxnews-scroll-keyframes';
    style.textContent = `
      @keyframes dxnews-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .dxnews-scroll-content:hover { animation-play-state: paused !important; }
    `;
    document.head.appendChild(style);
  }, []);

  // D-11: Rotate currentSourceIndex through items at min 5-second dwell
  // so the label doesn't flicker when adjacent items are from different sources.
  useEffect(() => {
    if (news.length === 0) return;
    const dwellMs = Math.max(5000, (animDuration * 1000) / news.length);
    const id = setInterval(() => {
      setCurrentSourceIndex((i) => (i + 1) % news.length);
    }, dwellMs);
    return () => clearInterval(id);
  }, [news, animDuration]);

  // Defensive: clamp index if news array shrinks after a refresh
  useEffect(() => {
    if (currentSourceIndex >= news.length && news.length > 0) {
      setCurrentSourceIndex(0);
    }
  }, [news, currentSourceIndex]);

  // D-07: Hide entirely when no fresh items remain
  if (!visible || loading || news.length === 0) return null;

  // D-11/D-12: current source info for the dynamic label
  const current = news[currentSourceIndex] || news[0];
  const currentSource = current?.source || 'DX NEWS';
  const currentSourceUrl = current?.sourceUrl || 'https://dxnews.com/';

  // Build ticker items including url for D-13 click-navigate
  const tickerItems = news.map((item) => ({
    title: item.title,
    desc: item.description,
    url: item.url,
  }));

  const atMin = textScale <= 0.7;
  const atMax = textScale >= 2.0;

  const handleDecrease = () => setTextScale((s) => parseFloat(Math.max(0.7, s - 0.1).toFixed(1)));
  const handleIncrease = () => setTextScale((s) => parseFloat(Math.min(2.0, s + 0.1).toFixed(1)));

  const sizeButtonStyle = (disabled) => ({
    background: 'transparent',
    border: 'none',
    color: disabled ? '#444' : '#ff8800',
    fontSize: `${BASE_LABEL_SIZE * textScale}px`,
    fontWeight: '700',
    fontFamily: 'JetBrains Mono, monospace',
    padding: `0 ${6 * textScale}px`,
    height: '100%',
    cursor: disabled ? 'default' : 'pointer',
    lineHeight: 1,
    flexShrink: 0,
  });

  return (
    <div
      ref={tickerRef}
      style={
        sidebar
          ? {
              width: '100%',
              height: '100%',
              background: 'transparent',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
            }
          : {
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              right: '8px',
              height: `${BASE_HEIGHT * textScale}px`,
              background: 'rgba(0, 0, 0, 0.85)',
              border: '1px solid #444',
              borderRadius: '6px',
              overflow: 'hidden',
              zIndex: 999,
              display: 'flex',
              alignItems: 'center',
            }
      }
    >
      {/* D-11 / D-12: Dynamic source label — rotates through sources, links to current source homepage */}
      <a
        href={currentSourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="dxnews-source-label"
        data-source={currentSource}
        style={{
          background: 'rgba(255, 136, 0, 0.9)',
          color: '#000',
          fontWeight: '700',
          fontSize: `${BASE_LABEL_SIZE * textScale}px`,
          fontFamily: 'JetBrains Mono, monospace',
          padding: '0 8px',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          borderRight: '1px solid #444',
          letterSpacing: '0.5px',
          textDecoration: 'none',
        }}
      >
        📰 {currentSource}
      </a>

      {/* Scrolling content */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          height: '100%',
          maskImage: 'linear-gradient(to right, transparent 0%, black 3%, black 97%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 3%, black 97%, transparent 100%)',
        }}
      >
        {/* D-13: Hover-pause via CSS (.dxnews-scroll-content:hover rule injected above).
            React state mirrors hover for testability (data-hovered attribute).
            onClick removed — click is now per-item navigation, not pause-toggle. */}
        <div
          ref={contentRef}
          className="dxnews-scroll-content"
          data-testid="dxnews-scroll"
          data-hovered={hovered}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '100%',
            whiteSpace: 'nowrap',
            animationName: 'dxnews-scroll',
            animationDuration: `${animDuration}s`,
            animationTimingFunction: 'linear',
            animationIterationCount: 'infinite',
            animationPlayState: 'running',
            paddingLeft: '100%',
            willChange: 'transform',
          }}
        >
          {/* D-13: Each item is an anchor — click opens article in new tab */}
          {tickerItems.map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="dxnews-item"
              data-item-index={i}
              data-item-url={item.url}
              title={t('app.dxNews.openInNewTab', { defaultValue: 'Open article in new tab' })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <span
                style={{
                  color: '#ff8800',
                  fontWeight: '700',
                  fontSize: `${BASE_TEXT_SIZE * textScale}px`,
                  fontFamily: 'JetBrains Mono, monospace',
                  marginRight: '6px',
                }}
              >
                {item.title}
              </span>
              <span
                style={{
                  color: '#aaa',
                  fontSize: `${BASE_TEXT_SIZE * textScale}px`,
                  fontFamily: 'JetBrains Mono, monospace',
                  marginRight: '12px',
                }}
              >
                {item.desc}
              </span>
              <span
                style={{
                  color: '#555',
                  fontSize: `${BASE_LABEL_SIZE * textScale}px`,
                  marginRight: '12px',
                }}
              >
                ◆
              </span>
            </a>
          ))}
          {/* Duplicate for seamless infinite-scroll loop */}
          {tickerItems.map((item, i) => (
            <a
              key={`dup-${i}`}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="dxnews-item"
              data-item-index={i}
              data-item-url={item.url}
              title={t('app.dxNews.openInNewTab', { defaultValue: 'Open article in new tab' })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <span
                style={{
                  color: '#ff8800',
                  fontWeight: '700',
                  fontSize: `${BASE_TEXT_SIZE * textScale}px`,
                  fontFamily: 'JetBrains Mono, monospace',
                  marginRight: '6px',
                }}
              >
                {item.title}
              </span>
              <span
                style={{
                  color: '#aaa',
                  fontSize: `${BASE_TEXT_SIZE * textScale}px`,
                  fontFamily: 'JetBrains Mono, monospace',
                  marginRight: '12px',
                }}
              >
                {item.desc}
              </span>
              <span
                style={{
                  color: '#555',
                  fontSize: `${BASE_LABEL_SIZE * textScale}px`,
                  marginRight: '12px',
                }}
              >
                ◆
              </span>
            </a>
          ))}
        </div>
      </div>

      {/* Text size controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          borderLeft: '1px solid #444',
          height: '100%',
        }}
      >
        <button
          onClick={handleDecrease}
          disabled={atMin}
          aria-label={t('app.dxNews.decreaseTextSize')}
          style={sizeButtonStyle(atMin)}
        >
          −
        </button>
        <button
          onClick={handleIncrease}
          disabled={atMax}
          aria-label={t('app.dxNews.increaseTextSize')}
          style={sizeButtonStyle(atMax)}
        >
          +
        </button>
      </div>
    </div>
  );
};

export default DXNewsTicker;

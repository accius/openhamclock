/**
 * DXNewsTicker Component
 * Scrolling news banner showing latest DX news headlines from dxnews.com
 * Respects showDXNews setting from mapLayers (reads from localStorage directly as fallback)
 */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// Base font sizes (px) — all sizes are derived by multiplying with textScale
const BASE_LABEL_SIZE = 10; // "📰 DX NEWS" label, separator ◆
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
  const [paused, setPaused] = useState(false);
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

  // Inject keyframes animation style once
  useEffect(() => {
    if (document.getElementById('dxnews-scroll-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'dxnews-scroll-keyframes';
    style.textContent = `@keyframes dxnews-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`;
    document.head.appendChild(style);
  }, []);

  if (!visible || loading || news.length === 0) return null;

  // Build ticker text: "TITLE — description  ★  TITLE — description  ★  ..."
  const tickerItems = news.map((item) => ({
    title: item.title,
    desc: item.description,
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
      {/* DX NEWS label */}
      <a
        href="https://dxnews.com"
        target="_blank"
        rel="noopener noreferrer"
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
        📰 DX NEWS
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
        <div
          ref={contentRef}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '100%',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            animationName: 'dxnews-scroll',
            animationDuration: `${animDuration}s`,
            animationTimingFunction: 'linear',
            animationIterationCount: 'infinite',
            animationPlayState: paused ? 'paused' : 'running',
            paddingLeft: '100%',
            willChange: 'transform',
          }}
          onClick={() => setPaused(!paused)}
          title={paused ? t('app.dxNews.resumeTooltip') : t('app.dxNews.pauseTooltip')}
        >
          {tickerItems.map((item, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
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
            </span>
          ))}
          {/* Duplicate for seamless loop */}
          {tickerItems.map((item, i) => (
            <span key={`dup-${i}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
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
            </span>
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

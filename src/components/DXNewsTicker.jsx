/**
 * DXNewsTicker Component
 * Scrolling news banner showing latest DX news headlines from dxnews.com
 * Respects showDXNews setting from mapLayers (reads from localStorage directly as fallback)
 */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// Check if DX News is enabled (reads directly from localStorage as belt-and-suspenders)
function isDXNewsEnabled() {
  try {
    const stored = localStorage.getItem('openhamclock_mapLayers');
    if (stored) {
      const layers = JSON.parse(stored);
      return layers.showDXNews !== false;
    }
  } catch { }
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

  // Calculate animation duration based on content width
  useEffect(() => {
    if (contentRef.current && tickerRef.current) {
      const contentWidth = contentRef.current.scrollWidth;
      const containerWidth = tickerRef.current.offsetWidth;
      // ~90px per second scroll speed
      const duration = Math.max(20, (contentWidth + containerWidth) / 90);
      setAnimDuration(duration);
    }
  }, [news]);

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
  const tickerItems = news.map(item => ({
    title: item.title,
    desc: item.description
  }));

  return (
    <div
      ref={tickerRef}
      style={sidebar ? {
        width: '100%',
        height: '100%',
        background: 'transparent',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center'
      } : {
        position: 'absolute',
        bottom: '8px',
        left: '8px',
        right: '8px',
        height: '28px',
        background: 'rgba(0, 0, 0, 0.85)',
        border: '1px solid #444',
        borderRadius: '6px',
        overflow: 'hidden',
        zIndex: 999,
        display: 'flex',
        alignItems: 'center'
      }}
    >
      {/* DX NEWS label */}
      <a href="https://dxnews.com" target="_blank" rel="noopener noreferrer" style={{
        background: 'rgba(255, 136, 0, 0.9)',
        color: '#000',
        fontWeight: '700',
        fontSize: '10px',
        fontFamily: 'JetBrains Mono, monospace',
        padding: '0 8px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        borderRight: '1px solid #444',
        letterSpacing: '0.5px',
        textDecoration: 'none',
      }}>
        📰 DX NEWS
      </a>

      {/* Scrolling content */}
      <div style={{
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
        height: '100%',
        maskImage: 'linear-gradient(to right, transparent 0%, black 3%, black 97%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 3%, black 97%, transparent 100%)'
      }}>
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
            willChange: 'transform'
          }}
          onClick={() => setPaused(!paused)}
          title={paused ? t("app.dxNews.resumeTooltip") : t("app.dxNews.pauseTooltip")}
        >
          {tickerItems.map((item, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span style={{
                color: '#ff8800',
                fontWeight: '700',
                fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace',
                marginRight: '6px'
              }}>
                {item.title}
              </span>
              <span style={{
                color: '#aaa',
                fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace',
                marginRight: '12px'
              }}>
                {item.desc}
              </span>
              <span style={{
                color: '#555',
                fontSize: '10px',
                marginRight: '12px'
              }}>
                ◆
              </span>
            </span>
          ))}
          {/* Duplicate for seamless loop */}
          {tickerItems.map((item, i) => (
            <span key={`dup-${i}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span style={{
                color: '#ff8800',
                fontWeight: '700',
                fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace',
                marginRight: '6px'
              }}>
                {item.title}
              </span>
              <span style={{
                color: '#aaa',
                fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace',
                marginRight: '12px'
              }}>
                {item.desc}
              </span>
              <span style={{
                color: '#555',
                fontSize: '10px',
                marginRight: '12px'
              }}>
                ◆
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DXNewsTicker;

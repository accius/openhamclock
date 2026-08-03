/**
 * PSK Reporter Band Activity Panel
 *
 * Dockable panel showing a compact horizontal bar chart of spot counts
 * per HF band from PSKReporter data.
 *
 * Data source: pskReporter prop (txReports + rxReports from usePSKReporter)
 * Filtering: user's ohc_psk_age localStorage value
 */
import React, { useState, useEffect, useMemo } from 'react';
import { DEFAULT_BAND_COLORS } from '../utils/bandColors.js';

const BAND_ORDER = [
  '160m',
  '80m',
  '60m',
  '40m',
  '30m',
  '20m',
  '17m',
  '15m',
  '12m',
  '10m',
  '8m',
  '6m',
  '4m',
  '2m',
  '70cm',
];

const PSKReporterBandActivityPanel = ({ pskReporter = {} }) => {
  const [pskAge, setPskAge] = useState(() => {
    try {
      return parseInt(localStorage.getItem('ohc_psk_age')) || 15;
    } catch {
      return 15;
    }
  });

  // Listen for localStorage changes to pskAge
  useEffect(() => {
    const sync = () => {
      try {
        const v = parseInt(localStorage.getItem('ohc_psk_age'));
        if (Number.isFinite(v) && v > 0) setPskAge(v);
      } catch {}
    };
    window.addEventListener('ohc-psk-age-changed', sync);
    return () => window.removeEventListener('ohc-psk-age-changed', sync);
  }, []);

  const { txReports = [], rxReports = [] } = pskReporter;

  // Compute band counts from reports, filtered by pskAge
  const { bandCounts, totalSpots, maxCount } = useMemo(() => {
    const cutoff = Date.now() - pskAge * 60 * 1000;
    const counts = {};
    let total = 0;

    const allReports = [...txReports, ...rxReports];
    for (const report of allReports) {
      if (report.timestamp <= cutoff) continue;
      const band = report.band;
      if (!band || band === 'Unknown') continue;
      counts[band] = (counts[band] || 0) + 1;
    }

    const entries = Object.entries(counts);
    entries.forEach(([, c]) => {
      total += c;
    });
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    const max = sorted.length > 0 ? sorted[0][1] : 0;

    return { bandCounts: sorted, totalSpots: total, maxCount: max };
  }, [txReports, rxReports, pskAge]);

  const countsMap = new Map(bandCounts);

  return (
    <div className="panel" style={{ padding: '12px 14px' }}>
      <div style={{ padding: '0 12px' }}>
        {BAND_ORDER.map((band) => {
          const count = countsMap.get(band) || 0;
          const active = count > 0;
          const color = DEFAULT_BAND_COLORS[band] || '#888888';
          const barWidth = maxCount > 0 ? Math.max((count / maxCount) * 100, 1.5) : 0;
          return (
            <div
              key={band}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '4px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                opacity: active ? 1 : 0.4,
              }}
            >
              <span
                style={{
                  width: '32px',
                  textAlign: 'right',
                  fontWeight: 700,
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {band}
              </span>
              <div
                style={{
                  flex: 1,
                  background: 'var(--bg-tertiary)',
                  borderRadius: '2px',
                  height: '12px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${barWidth}%`,
                    height: '100%',
                    background: color,
                    borderRadius: '2px',
                  }}
                />
              </div>
              <span
                style={{
                  width: '32px',
                  textAlign: 'right',
                  color: active ? 'var(--text-secondary)' : 'var(--text-muted)',
                  minWidth: '32px',
                }}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: '6px',
          padding: '8px 12px 4px',
          fontSize: '10px',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          textAlign: 'center',
        }}
      >
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid var(--border-color)',
            margin: '0 0 4px',
          }}
        />
        Total: {totalSpots} · Last {pskAge} min
      </div>
    </div>
  );
};

export default PSKReporterBandActivityPanel;

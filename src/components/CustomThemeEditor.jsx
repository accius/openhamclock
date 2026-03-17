import { useState, useEffect } from 'react';
import { HexColorPicker, RgbaColorPicker } from 'react-colorful';
import { THEME_COLOR_CONFIG } from '../theme/themeConfig';
import { useTranslation } from 'react-i18next';

// Visual descriptions of what each color variable affects
const COLOR_DESCRIPTIONS = {
  '--bg-primary': 'Main page background behind all panels',
  '--bg-secondary': 'Card and section backgrounds within panels',
  '--bg-tertiary': 'Buttons, inputs, and interactive element backgrounds',
  '--bg-panel': 'Panel and header bar background',
  '--border-color': 'Borders around panels, buttons, and dividers',
  '--text-primary': 'Main text, headings, and important labels',
  '--text-secondary': 'Secondary labels, descriptions, and button text',
  '--text-muted': 'Hints, timestamps, and less important info',
  '--map-ocean': 'Ocean/water color on the world map',
  '--accent-amber': 'Callsign, LOCAL clock, active tabs, highlights',
  '--accent-amber-dim': 'Dimmed amber for hover states and subtle indicators',
  '--accent-green': 'Good status, connected, quiet conditions',
  '--accent-green-dim': 'Dimmed green for backgrounds and subtle indicators',
  '--accent-red': 'Alerts, warnings, storm conditions, high K-index',
  '--accent-blue': 'Links, info badges, secondary highlights',
  '--accent-cyan': 'UTC clock, SFI/SSN values, frequency displays',
  '--accent-purple': 'Special tags, VHF indicators, unique highlights',
};

// Group colors by category
const COLOR_GROUPS = [
  { label: 'Backgrounds', icon: '🎨', keys: ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-panel'] },
  { label: 'Text', icon: '✏️', keys: ['--text-primary', '--text-secondary', '--text-muted'] },
  { label: 'Borders & Map', icon: '🗺️', keys: ['--border-color', '--map-ocean'] },
  {
    label: 'Accent Colors',
    icon: '💡',
    keys: [
      '--accent-amber',
      '--accent-amber-dim',
      '--accent-green',
      '--accent-green-dim',
      '--accent-red',
      '--accent-blue',
      '--accent-cyan',
      '--accent-purple',
    ],
  },
];

// Available font families — these are loaded via Google Fonts in the HTML
const FONT_OPTIONS = [
  { value: "'Space Grotesk', sans-serif", label: 'Space Grotesk', note: 'Default' },
  { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono', note: 'Monospace' },
  { value: "'Orbitron', sans-serif", label: 'Orbitron', note: 'Display' },
  { value: "'Inter', sans-serif", label: 'Inter', note: 'Clean' },
  { value: "'Fira Code', 'JetBrains Mono', monospace", label: 'Fira Code', note: 'Code' },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono', note: 'Retro' },
  { value: "'Courier New', monospace", label: 'Courier New', note: 'Classic' },
  { value: "'Segoe UI', 'Helvetica Neue', sans-serif", label: 'System UI', note: 'Native' },
  { value: "'Georgia', serif", label: 'Georgia', note: 'Serif' },
  { value: "'Tahoma', sans-serif", label: 'Tahoma', note: 'Compact' },
];

// Helper to resolve a color value to a CSS string
function colorToCSS(color) {
  if (!color) return '#000';
  if (typeof color === 'string') return color;
  return `rgba(${color.r},${color.g},${color.b},${color.a})`;
}

// ── Live mockup that renders a mini dashboard using the current custom theme colors ──
function ThemeMockup({ customTheme, fontFamily }) {
  const c = (key) => colorToCSS(customTheme[key]);
  const font = fontFamily || "'Space Grotesk', sans-serif";

  return (
    <div
      style={{
        background: c('--bg-primary'),
        borderRadius: '8px',
        border: `1px solid ${c('--border-color')}`,
        padding: '10px',
        fontFamily: font,
        fontSize: '11px',
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          background: c('--bg-panel'),
          borderRadius: '5px',
          border: `1px solid ${c('--border-color')}`,
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              fontFamily: "'Orbitron', monospace",
              fontWeight: 900,
              color: c('--accent-amber'),
              fontSize: '13px',
            }}
          >
            K0CJH
          </span>
          <span style={{ color: c('--text-muted'), fontSize: '10px' }}>v15.6</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ color: c('--accent-cyan'), fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
            UTC 14:32
          </span>
          <span style={{ color: c('--accent-amber'), fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
            LOCAL 08:32
          </span>
          <div style={{ display: 'flex', gap: '8px', fontSize: '10px' }}>
            <span>
              <span style={{ color: c('--text-muted') }}>SFI </span>
              <span style={{ color: c('--accent-amber'), fontWeight: 700 }}>158</span>
            </span>
            <span>
              <span style={{ color: c('--text-muted') }}>K </span>
              <span style={{ color: c('--accent-green'), fontWeight: 700 }}>2</span>
            </span>
            <span>
              <span style={{ color: c('--text-muted') }}>SSN </span>
              <span style={{ color: c('--accent-cyan'), fontWeight: 700 }}>112</span>
            </span>
          </div>
        </div>
      </div>

      {/* Content area — 3-column mock */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '6px' }}>
        {/* Left panel */}
        <div
          style={{
            background: c('--bg-secondary'),
            borderRadius: '5px',
            border: `1px solid ${c('--border-color')}`,
            padding: '8px',
          }}
        >
          <div style={{ color: c('--accent-cyan'), fontWeight: 700, fontSize: '10px', marginBottom: '4px' }}>
            DE Location
          </div>
          <div style={{ color: c('--accent-amber'), fontWeight: 700, fontSize: '14px' }}>DM79</div>
          <div style={{ color: c('--text-secondary'), fontSize: '9px', marginTop: '2px' }}>39.74°N, 104.99°W</div>
          <div style={{ marginTop: '6px', fontSize: '9px' }}>
            <span style={{ color: c('--text-muted') }}>Geo </span>
            <span style={{ color: c('--accent-green'), fontWeight: 600 }}>QUIET</span>
          </div>
        </div>

        {/* Center — map placeholder */}
        <div
          style={{
            background: c('--map-ocean'),
            borderRadius: '5px',
            border: `1px solid ${c('--border-color')}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '80px',
            position: 'relative',
          }}
        >
          {/* Simple land shapes */}
          <svg viewBox="0 0 200 80" style={{ width: '100%', height: '100%', opacity: 0.3 }}>
            <ellipse cx="60" cy="35" rx="25" ry="20" fill={c('--accent-green-dim')} />
            <ellipse cx="140" cy="40" rx="30" ry="18" fill={c('--accent-green-dim')} />
            <ellipse cx="100" cy="25" rx="15" ry="10" fill={c('--accent-green-dim')} />
          </svg>
          {/* Path line */}
          <svg viewBox="0 0 200 80" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <line x1="60" y1="35" x2="140" y2="40" stroke={c('--accent-red')} strokeWidth="1" strokeDasharray="3,3" />
            <circle cx="60" cy="35" r="3" fill={c('--accent-cyan')} />
            <circle cx="140" cy="40" r="3" fill={c('--accent-red')} />
          </svg>
        </div>

        {/* Right panel — DX cluster mock */}
        <div
          style={{
            background: c('--bg-secondary'),
            borderRadius: '5px',
            border: `1px solid ${c('--border-color')}`,
            padding: '8px',
          }}
        >
          <div style={{ color: c('--accent-cyan'), fontWeight: 700, fontSize: '10px', marginBottom: '4px' }}>
            DX Cluster
          </div>
          {[
            { call: 'JA1ABC', freq: '14.074', mode: 'FT8' },
            { call: 'DL5XYZ', freq: '7.012', mode: 'CW' },
            { call: 'VK3DEF', freq: '21.200', mode: 'SSB' },
          ].map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '9px',
                padding: '2px 0',
                borderBottom: `1px solid ${c('--border-color')}`,
              }}
            >
              <span style={{ color: c('--accent-amber'), fontWeight: 600 }}>{s.call}</span>
              <span style={{ color: c('--text-secondary') }}>{s.freq}</span>
              <span style={{ color: c('--accent-purple'), fontSize: '8px' }}>{s.mode}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar — tabs mock */}
      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
        {['Active', 'Inactive', 'Alert'].map((label, i) => (
          <div
            key={label}
            style={{
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '9px',
              fontWeight: 600,
              background: i === 0 ? c('--accent-amber') : c('--bg-tertiary'),
              color: i === 0 ? c('--bg-primary') : i === 2 ? c('--accent-red') : c('--text-secondary'),
              border: `1px solid ${i === 0 ? c('--accent-amber') : c('--border-color')}`,
            }}
          >
            {label}
          </div>
        ))}
        <div
          style={{
            marginLeft: 'auto',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '9px',
            background: c('--bg-tertiary'),
            border: `1px solid ${c('--border-color')}`,
            color: c('--accent-blue'),
          }}
        >
          Link
        </div>
      </div>
    </div>
  );
}

// ── Font selector ──
function FontSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {FONT_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            background: value === opt.value ? 'rgba(255,170,0,0.15)' : 'var(--bg-secondary)',
            border: `1px solid ${value === opt.value ? 'var(--accent-amber)' : 'var(--border-color)'}`,
            borderRadius: '5px',
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              fontFamily: opt.value,
              fontSize: '13px',
              color: value === opt.value ? 'var(--accent-amber)' : 'var(--text-primary)',
            }}
          >
            {opt.label}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{opt.note}</span>
        </button>
      ))}
    </div>
  );
}

export default function CustomThemeEditor({ id, customTheme, updateCustomVar }) {
  const { t } = useTranslation();
  const [expandedKey, setExpandedKey] = useState(null);

  // Font family state — persisted separately from color vars
  const [fontFamily, setFontFamily] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_fontFamily') || "'Space Grotesk', sans-serif";
    } catch {
      return "'Space Grotesk', sans-serif";
    }
  });

  // Apply font to the page
  useEffect(() => {
    document.documentElement.style.setProperty('--font-body', fontFamily);
    document.body.style.fontFamily = fontFamily;
    try {
      localStorage.setItem('openhamclock_fontFamily', fontFamily);
    } catch {}
  }, [fontFamily]);

  // Load saved font on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('openhamclock_fontFamily');
      if (saved) {
        document.documentElement.style.setProperty('--font-body', saved);
        document.body.style.fontFamily = saved;
      }
    } catch {}
  }, []);

  return (
    <div id={id} style={{ marginTop: '16px' }}>
      {/* ── Live mockup preview ── */}
      <div style={{ marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px',
            paddingBottom: '4px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <span style={{ fontSize: '14px' }}>👁️</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: '700',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            Live Preview
          </span>
        </div>
        <ThemeMockup customTheme={customTheme} fontFamily={fontFamily} />
      </div>

      {/* ── Font selector ── */}
      <div style={{ marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px',
            paddingBottom: '4px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <span style={{ fontSize: '14px' }}>🔤</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: '700',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            Font
          </span>
        </div>
        <FontSelector value={fontFamily} onChange={setFontFamily} />
      </div>

      {/* ── Color groups ── */}
      {COLOR_GROUPS.map((group) => (
        <div key={group.label} style={{ marginBottom: '16px' }}>
          {/* Group header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '8px',
              paddingBottom: '4px',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <span style={{ fontSize: '14px' }}>{group.icon}</span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: '700',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {group.label}
            </span>
          </div>

          {/* Color items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {group.keys.map((key) => {
              const cfg = THEME_COLOR_CONFIG[key];
              if (!cfg) return null;
              const Picker = cfg.alpha ? RgbaColorPicker : HexColorPicker;
              const isExpanded = expandedKey === key;
              const color = customTheme[key];

              return (
                <div
                  key={key}
                  style={{
                    background: 'var(--bg-secondary)',
                    borderRadius: '6px',
                    border: isExpanded ? '1px solid var(--accent-amber)' : '1px solid var(--border-color)',
                    overflow: 'hidden',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  {/* Color row: swatch + label — click to expand */}
                  <button
                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      width: '100%',
                      padding: '8px 10px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: '24px',
                        height: '24px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        background: colorToCSS(color),
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: '600' }}>
                        {t('station.settings.theme.custom.' + key)}
                      </div>
                      <div
                        style={{
                          fontSize: '10px',
                          color: 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {COLOR_DESCRIPTIONS[key]}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        flexShrink: 0,
                        transform: isExpanded ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.15s ease',
                      }}
                    >
                      ▼
                    </span>
                  </button>

                  {/* Expanded: color picker */}
                  {isExpanded && (
                    <div style={{ padding: '0 10px 10px 10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <Picker
                          color={color}
                          onChange={(c) => updateCustomVar(key, c)}
                          style={{ width: '100%', maxWidth: '240px' }}
                        />
                      </div>
                      {typeof color === 'string' && (
                        <div
                          style={{
                            textAlign: 'center',
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            marginTop: '4px',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          {color}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

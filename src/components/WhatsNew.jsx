/**
 * WhatsNew Component
 * Shows a changelog modal on first load of a new version.
 * Stores the last-seen version in localStorage to avoid re-showing.
 */
import { useState, useEffect } from 'react';

// ─── Changelog ──────────────────────────────────────────────
// Add new versions at the TOP of this array.
// Each entry: { version, date, heading, features: [...] }
const CHANGELOG = [
  {
    version: '15.5.3',
    date: '2026-02-17',
    heading: 'Satellites got smarter, SOTA got richer, and tuning just works.',
    features: [
      {
        icon: '🛰️',
        title: 'Satellite Tracker Overhaul',
        desc: 'Completely redesigned satellite layer with a floating data window, blinking indicators for visible passes, pinned satellite tracking, and GOES-18/19 weather satellites re-enabled.'
      },
      {
        icon: '⛰️',
        title: 'SOTA Summit Details',
        desc: 'SOTA spots now include full summit information — name, altitude, coordinates, and point values — pulled from the official SOTA summits database and refreshed daily.'
      },
      {
        icon: '📻',
        title: 'WSJT-X Rig Tuning Fix',
        desc: 'Clicking a WSJT-X decode now sends the correct dial frequency to your radio instead of the audio offset. FT8/FT4 click-to-tune works properly.'
      },
      {
        icon: '🎯',
        title: 'POTA/WWFF Click-to-Tune',
        desc: 'POTA and WWFF spots now properly trigger rig control when clicked — same one-click tuning that DX cluster spots have always had.'
      },
      {
        icon: '📊',
        title: 'Frequency Display Fix',
        desc: 'POTA, SOTA, and WWFF panels now consistently display frequencies in MHz. No more confusion between kHz and MHz values across different data sources.'
      },
      {
        icon: '🔇',
        title: 'SOTA QRT Filtering',
        desc: 'Operators who have signed off (QRT) are now automatically filtered out of the SOTA spots list — no more chasing stations that are already off the air.'
      },
      {
        icon: '🔍',
        title: 'SEO & Branding',
        desc: 'New favicon, Open Graph social sharing cards, structured data for search engines, and a canonical URL to ensure openhamclock.com is always the top result.'
      },
      {
        icon: '🤝',
        title: 'Community Tab',
        desc: 'New Community tab in Settings with links to GitHub, Facebook Group, and Reddit — plus a contributors wall thanking everyone who has helped build OpenHamClock.'
      },
    ]
  },
  {
    version: '15.5.1',
    date: '2026-02-15',
    heading: 'Better callsign lookups, better propagation maps.',
    features: [
      {
        icon: '🌍',
        title: 'cty.dat DXCC Entity Database',
        desc: 'Callsign → entity identification now uses the full AD1C cty.dat database — the same file every contest logger uses. ~400 DXCC entities, thousands of prefixes, zone overrides, and exact callsign matches. Replaces the old hand-coded 120-entry prefix table.'
      },
      {
        icon: '📡',
        title: 'MUF Layer Restored',
        desc: 'Fixed a regression where the MUF Map layer disappeared from the Map Layers list. The ionosonde-based MUF overlay is back.'
      },
      {
        icon: '🔥',
        title: 'VOACAP Power Levels Fixed',
        desc: 'Changing TX power (e.g. 5W vs 1000W) now produces dramatically different propagation maps, matching real-world behavior. Previously, power barely affected the heatmap colors.'
      },
      {
        icon: '🔎',
        title: 'Smarter DX Cluster Filtering',
        desc: 'Spotter and spot continent/zone filtering is now far more accurate thanks to the cty.dat database. Calls like 3B9WR (Rodriguez Island) and 5B4 (Cyprus) are correctly identified instead of falling through to crude single-character guesses.'
      },
    ]
  },
  {
    version: '15.5.0',
    date: '2026-02-15',
    heading: 'Click a spot. Tune your radio. Just like that.',
    features: [
      {
        icon: '📻',
        title: 'Direct Rig Control',
        desc: 'Click any DX cluster spot, POTA activation, or WSJT-X decode and your radio tunes instantly. Supports Yaesu, Kenwood, Elecraft, and Icom radios — no flrig or rigctld needed.'
      },
      {
        icon: '⬇️',
        title: 'One-Click Rig Listener Download',
        desc: 'Enable Rig Control in Settings and download the Rig Listener for Windows, Mac, or Linux. Double-click to run — it auto-installs everything. No Node.js, no command line, no setup headaches.'
      },
      {
        icon: '🔌',
        title: 'Interactive Setup Wizard',
        desc: 'The Rig Listener detects your USB serial ports, asks your radio brand and model, saves the config, and connects. First run is a 30-second wizard — after that, just double-click to start.'
      },
      {
        icon: '🔄',
        title: 'Live Frequency & Mode Display',
        desc: 'Your radio\'s current frequency and mode are shown in real time on the dashboard. Polls every 500ms over USB so the display always matches your dial.'
      },
      {
        icon: '🌙',
        title: 'Night Darkness Slider',
        desc: 'Adjust how dark the nighttime shading appears on the map. Slide from subtle to dramatic — find the look that works for your setup. Located below the map lock toggle.'
      },
      {
        icon: '👁️',
        title: 'Hosted User Cleanup',
        desc: 'Rotator panel and local-only features are now hidden for hosted users — cleaner interface, no confusing controls that don\'t apply to your setup.'
      },
    ]
  },
  {
    version: '15.4.1',
    date: '2026-02-15',
    heading: "Tonight's a big one — here's what's new:",
    features: [
      {
        icon: '📡',
        title: 'QRZ.com Callsign Lookups',
        desc: 'Precise station locations from QRZ user profiles, geocoded addresses, and grid squares. 3-tier waterfall: QRZ → HamQTH → prefix estimation. Configure credentials in Settings → Profiles.'
      },
      {
        icon: '🎯',
        title: 'Antenna Rotator Panel',
        desc: 'Real-time rotator control and bearing display. Shows current azimuth on the map with an animated bearing line. Shift+click the map to turn your antenna to any point.'
      },
      {
        icon: '🖱️',
        title: 'Mouse Wheel Zoom Sensitivity',
        desc: 'Adjustable scroll-to-zoom speed for the map. Fine-tune it in Settings → Station.'
      },
      {
        icon: '🔒',
        title: 'Map Lock',
        desc: 'Lock the map to prevent accidental panning and zooming — great for touch screens. Toggle with the lock icon below the zoom controls.'
      },
      {
        icon: '🔗',
        title: 'Clickable QRZ Callsigns',
        desc: 'Callsigns across DX Cluster, POTA, SOTA, PSK Reporter, WSJT-X, and map popups are now clickable links to QRZ.com profiles.'
      },
      {
        icon: '🏆',
        title: 'Contest Calendar Links',
        desc: 'Contest names in the Contests panel now link directly to the WA7BNM contest calendar for rules and details.'
      },
      {
        icon: '🌍',
        title: 'World Copy Replication',
        desc: 'All map markers (DE, DX, POTA, SOTA, DX cluster, WSJT-X, labels) now properly replicate across all three world copies — no more disappearing markers when scrolling east/west.'
      },
      {
        icon: '📻',
        title: 'RBN Firehose Fix',
        desc: 'Reverse Beacon Network spots are no longer lost from telnet buffer overflow. All spots for each DX station are now preserved.'
      },
      {
        icon: '📡',
        title: 'VOACAP Power Reactivity',
        desc: 'The propagation heatmap now updates immediately when you change transmit power or mode — no more stale predictions.'
      },
      {
        icon: '🗺️',
        title: 'PSK Reporter Direction Fix',
        desc: 'Map popups now correctly show the remote station callsign instead of your own for both TX and RX spots.'
      },
    ]
  }
];

const LS_KEY = 'openhamclock_lastSeenVersion';

export default function WhatsNew() {
  const [visible, setVisible] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(null);

  useEffect(() => {
    // Fetch the running version from the server
    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version');
        if (!res.ok) return;
        const { version } = await res.json();
        if (!version) return;

        setCurrentVersion(version);

        const lastSeen = localStorage.getItem(LS_KEY);
        // Show if never seen, or if the stored version differs from current
        if (!lastSeen || lastSeen !== version) {
          // Only show if we actually have changelog entries for this version
          const hasEntry = CHANGELOG.some(c => c.version === version);
          if (hasEntry) {
            setVisible(true);
          } else {
            // No changelog entry — just silently update the stored version
            localStorage.setItem(LS_KEY, version);
          }
        }
      } catch {
        // Silently fail — don't block the app
      }
    };

    // Small delay so it doesn't fight with initial render
    const timer = setTimeout(checkVersion, 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    if (currentVersion) {
      localStorage.setItem(LS_KEY, currentVersion);
    }
    setVisible(false);
  };

  if (!visible || !currentVersion) return null;

  const entry = CHANGELOG.find(c => c.version === currentVersion);
  if (!entry) return null;

  return (
    <div
      onClick={handleDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 100000,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary, #1a1a2e)',
          border: '1px solid var(--border-color, #333)',
          borderRadius: '12px',
          maxWidth: '560px',
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          animation: 'whatsNewSlideIn 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid var(--border-color, #333)',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '13px',
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--accent-cyan, #00ffcc)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}>
            OpenHamClock v{entry.version}
          </div>
          <div style={{
            fontSize: '20px',
            fontWeight: '700',
            color: 'var(--text-primary, #e0e0e0)',
          }}>
            What's New
          </div>
          <div style={{
            fontSize: '13px',
            color: 'var(--text-muted, #888)',
            marginTop: '6px',
          }}>
            {entry.heading}
          </div>
        </div>

        {/* Feature list — scrollable */}
        <div style={{
          overflowY: 'auto',
          padding: '16px 24px',
          flex: 1,
        }}>
          {entry.features.map((f, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '12px',
                padding: '10px 0',
                borderBottom: i < entry.features.length - 1
                  ? '1px solid rgba(255,255,255,0.06)'
                  : 'none',
              }}
            >
              <div style={{
                fontSize: '20px',
                lineHeight: '28px',
                flexShrink: 0,
                width: '28px',
                textAlign: 'center',
              }}>
                {f.icon}
              </div>
              <div>
                <div style={{
                  fontWeight: '600',
                  fontSize: '14px',
                  color: 'var(--text-primary, #e0e0e0)',
                  marginBottom: '3px',
                }}>
                  {f.title}
                </div>
                <div style={{
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: 'var(--text-muted, #999)',
                }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border-color, #333)',
          display: 'flex',
          justifyContent: 'center',
        }}>
          <button
            onClick={handleDismiss}
            style={{
              background: 'var(--accent-cyan, #00ffcc)',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 32px',
              fontSize: '14px',
              fontWeight: '700',
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => e.target.style.opacity = '0.85'}
            onMouseLeave={(e) => e.target.style.opacity = '1'}
          >
            Got it — 73!
          </button>
        </div>
      </div>

      <style>{`
        @keyframes whatsNewSlideIn {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

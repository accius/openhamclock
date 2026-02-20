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
    version: '15.5.9',
    date: '2026-02-20',
    heading: 'APRS tracking, wildfire & flood maps, full internationalization, and a stack of quality-of-life fixes.',
    features: [
      {
        icon: '📡',
        title: 'APRS-IS Live Tracking with Watchlist Groups',
        desc: 'Full APRS integration via a server-side APRS-IS connection (rotate.aprs2.net). Stations are parsed in real-time and rendered on the map with position, course, speed, altitude, and symbol. A watchlist system lets you tag callsigns into named groups — perfect for EmComm nets, ARES/RACES events, or tracking a group of friends during Field Day. Filter the panel by group, see all members on the map, and click any station for full details.',
      },
      {
        icon: '🔥',
        title: 'Wildfire Map Layer',
        desc: 'New map layer showing active wildfires worldwide, sourced from NASA EONET satellite detection data. Fire events are plotted as markers with size and color indicating severity. Data refreshes automatically and layers can be toggled in the Map Layers tab under Natural Hazards.',
      },
      {
        icon: '🌊',
        title: 'Floods & Storms Map Layer',
        desc: 'New map layer showing active floods and severe storms worldwide via NASA EONET. Storm events display with category, coordinates, and timestamps. Both the wildfire and flood layers are grouped under the new Natural Hazards category in Settings.',
      },
      {
        icon: '📻',
        title: 'PSKReporter TX/RX Split View',
        desc: 'The PSKReporter panel now separates spots into "Being Heard" (stations receiving your signal) and "Hearing" (stations you are receiving) with dedicated tabs showing counts for each direction. This replaces the old combined view and makes it immediately clear which direction the propagation path goes.',
      },
      {
        icon: '📂',
        title: 'Map Layers — Categorized & Sorted',
        desc: 'The Map Layers tab in Settings now groups layers by category with clear emoji headers: 📡 Propagation, 📻 Amateur Radio, 🌤️ Weather, ☀️ Space Weather, ⚠️ Natural Hazards, 🪨 Geology, and 🗺️ Map Overlays. Within each category, layers are sorted alphabetically. No more hunting through an unsorted flat list.',
      },
      {
        icon: '🌍',
        title: '100% Translation Coverage — All 10 Languages',
        desc: 'Every string in the dashboard is now fully translated across all 10 supported languages: German, Spanish, French, Italian, Japanese, Korean, Malay, Dutch, Portuguese, and Slovenian. Previously coverage ranged from 45% (Korean) to 61% (German) — 292 missing keys total. All weather conditions, wind compass directions, plugin layers, propagation views, PSKReporter/WSJT-X panels, station settings, satellite controls, and contest labels are now properly localized.',
      },
      {
        icon: '🐛',
        title: 'WSJT-X & PSK Reporter Duplicate Spots Fixed',
        desc: 'Fixed #396 — WSJT-X decodes and QSOs appeared duplicated in the panel. Decode IDs were timestamp-based, so the same message with a 1ms time difference bypassed dedup. IDs are now content-based (time + freq + message). QSO logging checks for duplicate call + frequency + mode within 60 seconds. PSK Reporter MQTT spot ingestion now deduplicates by sender + receiver + band + frequency before buffering. Client-side merge in both hooks uses content-based matching as a final safety net.',
      },
      {
        icon: '🪟',
        title: 'Windows Update Mechanism Fixed',
        desc: 'The in-app update button now works correctly on Windows deployments. Git operations use proper path resolution and the server restart sequence handles Windows process semantics.',
      },
      {
        icon: '🕐',
        title: 'DX Cluster Time Display Cleanup',
        desc: 'DX cluster spot timestamps now display as relative time ("5m ago") with the original UTC time in parentheses, replacing the inconsistent raw timestamp formats from different cluster sources.',
      },
    ],
  },
  {
    version: '15.5.8',
    date: '2026-02-19',
    heading: 'Memory leak fixes, live Moon imagery, and a major stability patch.',
    features: [
      {
        icon: '🧠',
        title: 'Memory Leak Fixes — Three Unbounded Caches Plugged',
        desc: 'Identified and fixed three server-side caches that grew without limit, pushing RSS to 384 MB+. The propagation heatmap cache now purges stale entries every 10 minutes with a 200-entry hard cap. Custom DX cluster sessions are reaped after 15 minutes of inactivity (clearing TCP sockets, timers, and spot buffers). DX spot path caches are cleaned every 5 minutes with a 100-key cap. Memory logging now tracks all three cache sizes for easier monitoring.',
      },
      {
        icon: '🌙',
        title: 'Live NASA Moon Imagery',
        desc: "The Solar panel's lunar phase display now shows real NASA Dial-A-Moon imagery instead of a static SVG. A server-side proxy fetches the current 730×730 JPG render from NASA's GSFC visualization studio with a 1-hour cache, so the Moon always matches the actual phase and libration — no more guessing from a cartoon circle.",
      },
      {
        icon: '🗺️',
        title: 'Map Legend & Band Colors Restored',
        desc: 'The clickable band color legend on the world map was accidentally removed in a bad merge. Fully restored — you can see which color maps to which band at a glance, and click any band chip to customize its color. Also restored: rotator bearing line, satellite tracks, and My Spots markers on the map.',
      },
      {
        icon: '🔧',
        title: 'Merge Conflict Cleanup',
        desc: 'Fixed a cascade of merge artifacts from a stale-branch PR: duplicate zoom buttons in panel headers (A− A− A+ → A− A+), triplicated switch/case blocks in the panel factory, duplicate variable declarations in the Solar panel, and a broken server-side cache check that crashed Node on startup. All source files now pass automated syntax and brace-balance checks.',
      },
    ],
  },
  {
    version: '15.5.7',
    date: '2026-02-19',
    heading: 'Small change, big quality-of-life improvement.',
    features: [
      {
        icon: '💾',
        title: 'Settings Export Filenames Now Include Time',
        desc: 'Exported settings and profile files now include the time in the filename (e.g. hamclock-current-2026-02-19-143022.json), not just the date. Multiple exports on the same day no longer silently overwrite each other — great for keeping a proper rollback history as you update. Applies to both the "Export Current State" button and named profile exports.',
      },
    ],
  },
  {
    version: '15.5.6',
    date: '2026-02-19',
    heading: 'Smarter satellites, cleaner maps, and icons that just work on Linux.',
    features: [
      {
        icon: '🛰️',
        title: 'Satellite Info Window — Minimize Button',
        desc: 'The floating satellite data window now has a ▼ minimize button in its title bar. Collapse it to a slim header when you want to see the footprints on the map without the info panel in the way. Click ▲ to restore. State survives the 5-second data refresh cycle without flickering.',
      },
      {
        icon: '🗺️',
        title: 'Draggable Panel Disappear Bug Fixed',
        desc: 'Map layer panels (Gray Line, RBN, Lightning, MUF Map, N3FJP Logged QSOs) were vanishing when you tried to Ctrl+drag them after switching layouts. Root cause: document-level mousemove/mouseup listeners were never cleaned up on layout change, so stale handlers fired during the next drag and teleported the panel off-screen. Fixed with AbortController — each new makeDraggable() call cancels the previous listener set before registering new ones.',
      },
      {
        icon: '📻',
        title: 'Rig Control — CW Mode Auto-Switching',
        desc: 'Clicking a spot in a CW segment of the band plan no longer forces the radio into SSB. The band plan JSON now correctly labels CW segments as CW and data segments as DATA. A rewritten mapModeToRig() passes CW/CW-R through unchanged, maps digital modes (FT8, FT4, JS8, WSPR…) to DATA-USB or DATA-LSB based on band convention, and resolves generic SSB to the correct sideband. New "Auto-set mode" toggle in Rig Control settings for operators who prefer manual mode control.',
      },
      {
        icon: '🔌',
        title: 'Rig Listener — FT-DX10 & Windows Serial Fix',
        desc: "Fixed two Rig Listener bugs: (1) FT-DX10 (and other radios using CP210x USB-serial adapters on Windows) weren't receiving data because DTR was left LOW. The listener now asserts DTR HIGH after opening the port with a 300ms stabilisation delay and hupcl:false to prevent DTR drop on reconnect. (2) Windows systems with Node.js pre-installed would fail to find npm during the bat-file setup because the system Node path wasn't being resolved correctly — fixed with \u2018where node\u2019 / \u2018where npm\u2019 full-path resolution.",
      },
      {
        icon: '📍',
        title: 'Portable Callsign Location Fix',
        desc: "Portable and mobile callsigns (e.g. PJ2/W9WI, DL/W1ABC, 5Z4/OZ6ABL) now resolve to the correct DXCC entity on the map. Previously, the operating prefix was being stripped and the home callsign's country was used instead. A new extractOperatingPrefix() function identifies which part of a compound callsign carries the DXCC information and uses that for location lookups, while still using the base callsign for QRZ lookups.",
      },
      {
        icon: '😊',
        title: 'Emoji Icons on Linux — CSS Font Stack & Docs',
        desc: "Added a proper emoji font-family stack to main.css so the browser finds whatever color emoji font is available (Noto Color Emoji, Segoe UI Emoji, Apple Color Emoji, Twemoji). The Raspberry Pi setup script now installs fonts-noto-color-emoji automatically. New FAQ entry in README.md explains the one-line fix for manual installs and clarifies it's needed on the browser machine, not the server.",
      },
      {
        icon: '✅',
        title: 'CI Formatting Fixed',
        desc: 'The GitHub Actions format check was failing because new code used double-quoted strings while the project uses single quotes (per .prettierrc). Converted all affected files to single quotes so the format:check job passes clean.',
      },
    ],
  },
  {
    version: '15.5.5',
    date: '2026-02-18',
    heading: 'Map reliability, contributor tooling, and cleaner error messages.',
    features: [
      {
        icon: '🗺️',
        title: 'Leaflet Load Reliability Fix',
        desc: "Fixed a race condition where the world map could silently fail to initialize if Leaflet's vendor script hadn't finished loading by the time the map component mounted — most likely on slower connections or after a failed vendor-download. The map now polls for up to 5 seconds and retries automatically instead of giving up on first mount.",
      },
      {
        icon: '🛠️',
        title: 'Actionable Leaflet Error',
        desc: 'If Leaflet genuinely fails to load after 5 seconds (missing vendor file, 404, network error), the console now shows a clear message with the exact fix: run bash scripts/vendor-download.sh. No more cryptic "Leaflet not loaded" with no context.',
      },
      {
        icon: '🤝',
        title: 'Contributor Self-Assign',
        desc: "Any GitHub user can now self-assign issues without needing write access. Comment /assign on any open issue and the bot will claim it for you instantly and react with 👍. Makes it easy to signal you're working on something without waiting for a maintainer.",
      },
      {
        icon: '📋',
        title: 'Updated Contributing Guide',
        desc: 'CONTRIBUTING.md now includes a dedicated "Claiming a Bug or Issue" section explaining the /assign workflow, sitting right where new contributors naturally look — between feature requests and code submission instructions.',
      },
    ],
  },
  {
    version: '15.5.4',
    date: '2026-02-18',
    heading: 'Squashing bugs, plugging leaks, and keeping your spots fresh.',
    features: [
      {
        icon: '📡',
        title: 'Stale Spots Fix',
        desc: 'Fixed a bug where WWFF spots could show data hours old due to a cache validation error. All three spot sources (POTA, SOTA, WWFF) now enforce a 60-minute age filter and a 10-minute stale cache limit — no more chasing ghosts.',
      },
      {
        icon: '🧠',
        title: 'Memory Leak Fixes',
        desc: 'Plugged several server-side memory leaks: RBN API response cache now auto-cleans, callsign and IP tracking caps tightened, and cache structures that grew unbounded over 24 hours are now properly pruned.',
      },
      {
        icon: '🔇',
        title: 'QRZ Login Spam Eliminated',
        desc: 'QRZ credential failures now properly respect the 1-hour cooldown. Previously, any user testing credentials in Settings would reset the timer for everyone, hammering QRZ with bad logins all day.',
      },
      {
        icon: '🛡️',
        title: 'Cleaner Error Handling',
        desc: 'Added proper Express error middleware to catch body-parser errors gracefully. No more stack traces in logs from clients disconnecting mid-request or sending oversized payloads.',
      },
      {
        icon: '🎨',
        title: 'Prettier for Contributors',
        desc: 'Standardized code formatting with Prettier, pre-commit hooks via Husky, and CI enforcement. No more quote style debates in pull requests — formatting is now automatic.',
      },
      {
        icon: '📻',
        title: 'Rig Control Options Restored',
        desc: 'The rig-bridge (flrig/rigctld) and rig-control (daemon mode) directories are back for power users who need more customization than the one-click Rig Listener provides.',
      },
      {
        icon: '🔎',
        title: 'DX Cluster Mode Filter Fixed',
        desc: "Filtering by SSB, FT8, or CW no longer hides everything. Mode detection now infers from frequency when the spot comment doesn't mention a mode — which is most spots. 14.074? That's FT8. 14.250? SSB. It just works now.",
      },
      {
        icon: '📡',
        title: 'RBN Skimmer Locations Fixed',
        desc: "Fixed a bug where RBN skimmer callsigns could show at wrong locations on the map. Enrichment is now sequential with cross-validation — if a lookup returns a location >5000 km from the callsign's expected country, it falls back to prefix estimation.",
      },
    ],
  },
  {
    version: '15.5.3',
    date: '2026-02-17',
    heading: 'Satellites got smarter, SOTA got richer, and tuning just works.',
    features: [
      {
        icon: '🛰️',
        title: 'Satellite Tracker Overhaul',
        desc: 'Completely redesigned satellite layer with a floating data window, blinking indicators for visible passes, pinned satellite tracking, and GOES-18/19 weather satellites re-enabled.',
      },
      {
        icon: '⛰️',
        title: 'SOTA Summit Details',
        desc: 'SOTA spots now include full summit information — name, altitude, coordinates, and point values — pulled from the official SOTA summits database and refreshed daily.',
      },
      {
        icon: '📻',
        title: 'WSJT-X Rig Tuning Fix',
        desc: 'Clicking a WSJT-X decode now sends the correct dial frequency to your radio instead of the audio offset. FT8/FT4 click-to-tune works properly.',
      },
      {
        icon: '🎯',
        title: 'POTA/WWFF Click-to-Tune',
        desc: 'POTA and WWFF spots now properly trigger rig control when clicked — same one-click tuning that DX cluster spots have always had.',
      },
      {
        icon: '📊',
        title: 'Frequency Display Fix',
        desc: 'POTA, SOTA, and WWFF panels now consistently display frequencies in MHz. No more confusion between kHz and MHz values across different data sources.',
      },
      {
        icon: '🔇',
        title: 'SOTA QRT Filtering',
        desc: 'Operators who have signed off (QRT) are now automatically filtered out of the SOTA spots list — no more chasing stations that are already off the air.',
      },
      {
        icon: '🔍',
        title: 'SEO & Branding',
        desc: 'New favicon, Open Graph social sharing cards, structured data for search engines, and a canonical URL to ensure openhamclock.com is always the top result.',
      },
      {
        icon: '🤝',
        title: 'Community Tab',
        desc: 'New Community tab in Settings with links to GitHub, Facebook Group, and Reddit — plus a contributors wall thanking everyone who has helped build OpenHamClock.',
      },
    ],
  },
  {
    version: '15.5.1',
    date: '2026-02-15',
    heading: 'Better callsign lookups, better propagation maps.',
    features: [
      {
        icon: '🌍',
        title: 'cty.dat DXCC Entity Database',
        desc: 'Callsign → entity identification now uses the full AD1C cty.dat database — the same file every contest logger uses. ~400 DXCC entities, thousands of prefixes, zone overrides, and exact callsign matches. Replaces the old hand-coded 120-entry prefix table.',
      },
      {
        icon: '📡',
        title: 'MUF Layer Restored',
        desc: 'Fixed a regression where the MUF Map layer disappeared from the Map Layers list. The ionosonde-based MUF overlay is back.',
      },
      {
        icon: '🔥',
        title: 'VOACAP Power Levels Fixed',
        desc: 'Changing TX power (e.g. 5W vs 1000W) now produces dramatically different propagation maps, matching real-world behavior. Previously, power barely affected the heatmap colors.',
      },
      {
        icon: '🔎',
        title: 'Smarter DX Cluster Filtering',
        desc: 'Spotter and spot continent/zone filtering is now far more accurate thanks to the cty.dat database. Calls like 3B9WR (Rodriguez Island) and 5B4 (Cyprus) are correctly identified instead of falling through to crude single-character guesses.',
      },
    ],
  },
  {
    version: '15.5.0',
    date: '2026-02-15',
    heading: 'Click a spot. Tune your radio. Just like that.',
    features: [
      {
        icon: '📻',
        title: 'Direct Rig Control',
        desc: 'Click any DX cluster spot, POTA activation, or WSJT-X decode and your radio tunes instantly. Supports Yaesu, Kenwood, Elecraft, and Icom radios — no flrig or rigctld needed.',
      },
      {
        icon: '⬇️',
        title: 'One-Click Rig Listener Download',
        desc: 'Enable Rig Control in Settings and download the Rig Listener for Windows, Mac, or Linux. Double-click to run — it auto-installs everything. No Node.js, no command line, no setup headaches.',
      },
      {
        icon: '🔌',
        title: 'Interactive Setup Wizard',
        desc: 'The Rig Listener detects your USB serial ports, asks your radio brand and model, saves the config, and connects. First run is a 30-second wizard — after that, just double-click to start.',
      },
      {
        icon: '🔄',
        title: 'Live Frequency & Mode Display',
        desc: "Your radio's current frequency and mode are shown in real time on the dashboard. Polls every 500ms over USB so the display always matches your dial.",
      },
      {
        icon: '🌙',
        title: 'Night Darkness Slider',
        desc: 'Adjust how dark the nighttime shading appears on the map. Slide from subtle to dramatic — find the look that works for your setup. Located below the map lock toggle.',
      },
      {
        icon: '👁️',
        title: 'Hosted User Cleanup',
        desc: "Rotator panel and local-only features are now hidden for hosted users — cleaner interface, no confusing controls that don't apply to your setup.",
      },
    ],
  },
  {
    version: '15.4.1',
    date: '2026-02-15',
    heading: "Tonight's a big one — here's what's new:",
    features: [
      {
        icon: '📡',
        title: 'QRZ.com Callsign Lookups',
        desc: 'Precise station locations from QRZ user profiles, geocoded addresses, and grid squares. 3-tier waterfall: QRZ → HamQTH → prefix estimation. Configure credentials in Settings → Profiles.',
      },
      {
        icon: '🎯',
        title: 'Antenna Rotator Panel',
        desc: 'Real-time rotator control and bearing display. Shows current azimuth on the map with an animated bearing line. Shift+click the map to turn your antenna to any point.',
      },
      {
        icon: '🖱️',
        title: 'Mouse Wheel Zoom Sensitivity',
        desc: 'Adjustable scroll-to-zoom speed for the map. Fine-tune it in Settings → Station.',
      },
      {
        icon: '🔒',
        title: 'Map Lock',
        desc: 'Lock the map to prevent accidental panning and zooming — great for touch screens. Toggle with the lock icon below the zoom controls.',
      },
      {
        icon: '🔗',
        title: 'Clickable QRZ Callsigns',
        desc: 'Callsigns across DX Cluster, POTA, SOTA, PSK Reporter, WSJT-X, and map popups are now clickable links to QRZ.com profiles.',
      },
      {
        icon: '🏆',
        title: 'Contest Calendar Links',
        desc: 'Contest names in the Contests panel now link directly to the WA7BNM contest calendar for rules and details.',
      },
      {
        icon: '🌍',
        title: 'World Copy Replication',
        desc: 'All map markers (DE, DX, POTA, SOTA, DX cluster, WSJT-X, labels) now properly replicate across all three world copies — no more disappearing markers when scrolling east/west.',
      },
      {
        icon: '📻',
        title: 'RBN Firehose Fix',
        desc: 'Reverse Beacon Network spots are no longer lost from telnet buffer overflow. All spots for each DX station are now preserved.',
      },
      {
        icon: '📡',
        title: 'VOACAP Power Reactivity',
        desc: 'The propagation heatmap now updates immediately when you change transmit power or mode — no more stale predictions.',
      },
      {
        icon: '🗺️',
        title: 'PSK Reporter Direction Fix',
        desc: 'Map popups now correctly show the remote station callsign instead of your own for both TX and RX spots.',
      },
    ],
  },
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
          const hasEntry = CHANGELOG.some((c) => c.version === version);
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

  const entry = CHANGELOG.find((c) => c.version === currentVersion);
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
        <div
          style={{
            padding: '24px 24px 16px',
            borderBottom: '1px solid var(--border-color, #333)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--accent-cyan, #00ffcc)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: '8px',
            }}
          >
            OpenHamClock v{entry.version}
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: '700',
              color: 'var(--text-primary, #e0e0e0)',
            }}
          >
            What's New
          </div>
          <div
            style={{
              fontSize: '13px',
              color: 'var(--text-muted, #888)',
              marginTop: '6px',
            }}
          >
            {entry.heading}
          </div>
        </div>

        {/* Feature list — scrollable */}
        <div
          style={{
            overflowY: 'auto',
            padding: '16px 24px',
            flex: 1,
          }}
        >
          {entry.features.map((f, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: '12px',
                padding: '10px 0',
                borderBottom: i < entry.features.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}
            >
              <div
                style={{
                  fontSize: '20px',
                  lineHeight: '28px',
                  flexShrink: 0,
                  width: '28px',
                  textAlign: 'center',
                }}
              >
                {f.icon}
              </div>
              <div>
                <div
                  style={{
                    fontWeight: '600',
                    fontSize: '14px',
                    color: 'var(--text-primary, #e0e0e0)',
                    marginBottom: '3px',
                  }}
                >
                  {f.title}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    lineHeight: '1.5',
                    color: 'var(--text-muted, #999)',
                  }}
                >
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-color, #333)',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
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
            onMouseEnter={(e) => (e.target.style.opacity = '0.85')}
            onMouseLeave={(e) => (e.target.style.opacity = '1')}
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

import { useMemo, useState } from "react";
import { useBandHealth } from "../hooks/useBandHealth.js";
import { detectMode, getBandFromFreq } from "../utils/callsign.js";

const MODE_TILES = [
  { value: "ALL", label: "All" },
  { value: "SSB", label: "SSB" },
  { value: "CW", label: "CW" },
  { value: "FT8", label: "FT8" },
  { value: "FT4", label: "FT4" },
  { value: "RTTY", label: "RTTY" },
  { value: "PSK", label: "PSK" },
  { value: "JT65", label: "JT65" },
  { value: "JS8", label: "JS8" },
  { value: "SSTV", label: "SSTV" },
  { value: "AM", label: "AM" },
  { value: "FM", label: "FM" },
];

const DIGITAL_MODES = new Set(["FT8", "FT4", "RTTY", "PSK", "JT65", "JS8", "SSTV"]);

const WINDOW_OPTIONS = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "60m" },
];

const BAND_TILES = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"];

const STORAGE_MODE_KEY = "openhamclock_bandHealth_mode";
const STORAGE_WINDOW_KEY = "openhamclock_bandHealth_window";

function activityStyle(activity) {
  switch (activity) {
    case "excellent":
    case "good":
      return { border: "1px solid rgba(74,222,128,0.55)", background: "rgba(74,222,128,0.10)", color: "#4ade80" };
    case "usable":
      return { border: "1px solid rgba(251,191,36,0.55)", background: "rgba(251,191,36,0.10)", color: "#fbbf24" };
    case "quiet":
      return { border: "1px solid rgba(148,163,184,0.45)", background: "rgba(148,163,184,0.08)", color: "var(--text-muted)" };
    case "closed":
    default:
      return { border: "1px solid rgba(239,68,68,0.40)", background: "rgba(239,68,68,0.08)", color: "#fb7185" };
  }
}

function heatFromRatio(r) {
  if (r <= 0) return { key: "cold", label: "COLD" };
  if (r < 0.25) return { key: "cool", label: "COOL" };
  if (r < 0.60) return { key: "warm", label: "WARM" };
  return { key: "hot", label: "HOT" };
}

// For ALL: 3-level summary based on average activity across included modes
function heatFromAverageRatio3(avg) {
  if (avg <= 0) return { key: "cold", label: "COLD" };
  if (avg < 0.55) return { key: "warm", label: "WARM" };
  return { key: "hot", label: "HOT" };
}

function heatStyle(heatKey) {
  switch (heatKey) {
    case "hot":
      return { border: "1px solid rgba(74,222,128,0.70)", background: "rgba(74,222,128,0.12)", color: "#4ade80" };
    case "warm":
      return { border: "1px solid rgba(251,191,36,0.65)", background: "rgba(251,191,36,0.12)", color: "#fbbf24" };
    case "cool":
      return { border: "1px solid rgba(148,163,184,0.55)", background: "rgba(148,163,184,0.10)", color: "var(--text-primary)" };
    case "cold":
    default:
      return { border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.06)", color: "var(--text-muted)" };
  }
}

function filteredStyle() {
  return {
    border: "1px dashed rgba(148,163,184,0.35)",
    background: "rgba(148,163,184,0.04)",
    color: "rgba(148,163,184,0.70)",
    opacity: 0.55,
    filter: "grayscale(0.7)",
  };
}

function trendGlyph(trend) {
  if (trend === "rising") return "▲";
  if (trend === "falling") return "▼";
  return "•";
}

/**
 * DX feeds vary:
 * - freq may be MHz ("14.074")
 * - or kHz ("14074")
 *
 * callsign.js getBandFromFreq expects kHz and also converts MHz->kHz internally.
 * So: pass the raw number (MHz or kHz). Do NOT multiply by 1000 here.
 */
function spotToBand(spot) {
  const f = parseFloat(spot?.freq);
  if (!Number.isFinite(f) || f <= 0) return null;

  const band = getBandFromFreq(f);
  return band && band !== "other" ? band : null;
}

export default function BandHealthPanel({ dxSpots = [], clusterFilters = null }) {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_MODE_KEY) || "ALL";
    } catch {
      return "ALL";
    }
  });

  const [windowMinutes, setWindowMinutes] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_WINDOW_KEY) || "15", 10);
      return Number.isFinite(v) ? v : 15;
    } catch {
      return 15;
    }
  });

  const onModeChange = (v) => {
    setMode(v);
    try {
      localStorage.setItem(STORAGE_MODE_KEY, v);
    } catch {}
  };

  const onWindowChange = (v) => {
    const n = parseInt(v, 10);
    setWindowMinutes(n);
    try {
      localStorage.setItem(STORAGE_WINDOW_KEY, String(n));
    } catch {}
  };

  // Filters come from dxFilters (same object DXClusterPanel uses)
  const includedBands = useMemo(() => {
    const arr = clusterFilters?.bands;
    if (!arr || arr.length === 0) return null;
    return new Set(arr);
  }, [clusterFilters]);

  const includedModes = useMemo(() => {
    const arr = clusterFilters?.modes;
    if (!arr || arr.length === 0) return null;
    return new Set(arr.map((m) => String(m).toUpperCase()));
  }, [clusterFilters]);

  const filtersActive = !!(includedBands || includedModes);

  // Hook gives band activity for the currently selected mode/window.
  const { bands: rawBands, updatedAt } = useBandHealth(dxSpots, { mode, windowMinutes });

  const updatedText = useMemo(() => {
    try {
      const d = new Date(updatedAt);
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [updatedAt]);

  // Build a band display list (including filtered bands, dimmed)
  const bands = useMemo(() => {
    const byBand = new Map((rawBands || []).map((b) => [b.band, b]));

    return BAND_TILES.map((bandName) => {
      const base = byBand.get(bandName) || {
        band: bandName,
        activity: "closed",
        label: "CLOSED",
        trend: "steady",
        count: 0,
        uniques: 0,
      };

      const isFiltered = includedBands ? !includedBands.has(bandName) : false;
      if (isFiltered) {
        return {
          ...base,
          filtered: true,
          label: "FILTERED",
          count: 0,
          uniques: 0,
          trend: "steady",
        };
      }

      return { ...base, filtered: false };
    });
  }, [rawBands, includedBands]);

  // Mode tiles (global activity view, respects filters and only counts classifiable band spots)
  const modeTiles = useMemo(() => {
    const now = Date.now();
    const windowMs = Math.max(5, Number(windowMinutes) || 15) * 60_000;
    const cutoff = now - windowMs;

    const counts = new Map();
    const uniques = new Map();

    for (const t of MODE_TILES) {
      if (t.value !== "ALL") {
        counts.set(t.value, 0);
        uniques.set(t.value, new Set());
      }
    }

    let allCount = 0;
    const allUniques = new Set();

    for (const s of dxSpots || []) {
      // timestamp can be number or ISO; normalize safely
      let ts = now;
      if (s?.timestamp != null) {
        const maybe = typeof s.timestamp === "number" ? s.timestamp : Date.parse(s.timestamp);
        ts = Number.isFinite(maybe) ? maybe : now;
      }
      if (ts < cutoff) continue;

      const band = spotToBand(s);
      if (!band) continue;

      // Respect band filters (if active)
      if (includedBands && !includedBands.has(band)) continue;

      const m = String(detectMode?.(s?.comment) || "").toUpperCase();

      // If mode filters active, only count spots that match included modes
      if (includedModes && (!m || !includedModes.has(m))) continue;

      // Count toward ALL (valid band + included filters)
      allCount += 1;
      if (s?.call) allUniques.add(String(s.call).toUpperCase());

      // Count toward specific modes if recognized
      if (m && counts.has(m)) {
        counts.set(m, (counts.get(m) || 0) + 1);
        if (s?.call) uniques.get(m).add(String(s.call).toUpperCase());
      }
    }

    // Compute max among INCLUDED (non-filtered) modes
    let max = 0;
    for (const [k, v] of counts.entries()) {
      if (includedModes && !includedModes.has(k)) continue;
      max = Math.max(max, v);
    }

    // Average ratio across INCLUDED modes (excluding ALL)
    let sumRatio = 0;
    let nRatio = 0;
    for (const t of MODE_TILES) {
      if (t.value === "ALL") continue;
      if (includedModes && !includedModes.has(t.value)) continue;

      const c = counts.get(t.value) || 0;
      const r = max > 0 ? c / max : 0;
      sumRatio += r;
      nRatio += 1;
    }
    const avgRatio = nRatio > 0 ? sumRatio / nRatio : 0;

    // Tooltip stats for ALL
    let digitalCount = 0;
    for (const [m, c] of counts.entries()) {
      if (includedModes && !includedModes.has(m)) continue;
      if (DIGITAL_MODES.has(m)) digitalCount += c;
    }
    const otherOrUnspecified = Math.max(0, allCount - digitalCount);

    const tiles = MODE_TILES.map((t) => {
      if (t.value === "ALL") {
        const heat = heatFromAverageRatio3(avgRatio);
        const tooltip =
          `There are ${allCount} active signals on the bands right now.\n` +
          `Of those, ${digitalCount} explicitly advertise digital modes.\n` +
          `The remaining ${otherOrUnspecified} are other or unspecified (many SSB spots omit mode tags).`;

        return {
          value: "ALL",
          label: "All",
          count: allCount,
          uniq: allUniques.size,
          heat,
          filtered: false,
          tooltip,
        };
      }

      const isFiltered = includedModes ? !includedModes.has(t.value) : false;
      if (isFiltered) {
        return {
          value: t.value,
          label: t.label,
          count: 0,
          uniq: 0,
          heat: { key: "cold", label: "FILTERED" },
          filtered: true,
        };
      }

      const c = counts.get(t.value) || 0;
      const u = uniques.get(t.value)?.size || 0;
      const ratio = max > 0 ? c / max : 0;
      const heat = heatFromRatio(ratio);

      return {
        value: t.value,
        label: t.label,
        count: c,
        uniq: u,
        heat,
        filtered: false,
      };
    });

    // Keep ALL first; then sort rest by activity
    const allTile = tiles.find((x) => x.value === "ALL");
    const rest = tiles.filter((x) => x.value !== "ALL").sort((a, b) => b.count - a.count);
    return allTile ? [allTile, ...rest] : rest;
  }, [dxSpots, windowMinutes, includedBands, includedModes]);

  return (
    <div className="panel" style={{ padding: "8px 10px", height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>HF BAND HEALTH</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{updatedText ? `upd ${updatedText}` : ""}</div>
          <div
            style={{ cursor: "help", userSelect: "none" }}
            title="HF Band Health shows real-world band usability based on recent DX Cluster spot activity. It uses a rolling time window and respects active DX Cluster filters."
          >
            ℹ️
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Window</span>
          <select
            value={windowMinutes}
            onChange={(e) => onWindowChange(e.target.value)}
            style={{
              fontSize: 11,
              padding: "2px 6px",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              outline: "none",
            }}
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{ marginLeft: "auto", fontSize: 9, color: "var(--text-muted)" }}
          title={filtersActive ? "Based on the active DX Cluster feed (filters active)" : "Based on the active DX Cluster feed"}
        >
          DX Cluster{filtersActive ? " (filtered)" : ""}
        </div>
      </div>

      {/* Mode tiles */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.04em", fontWeight: 700 }}>MODE ACTIVITY</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)" }}>(click to filter)</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {modeTiles.map((m) => {
            const isSelected = m.value === mode;
            const st = m.filtered ? filteredStyle() : heatStyle(m.heat.key);

            return (
              <div
                key={m.value}
                onClick={() => onModeChange(m.value)}
                title={
                  m.value === "ALL"
                    ? (m.tooltip || "")
                    : m.filtered
                      ? "Filtered out by DX Cluster mode filters"
                      : `spots: ${m.count}, unique: ${m.uniq} • ${m.heat.label}`
                }
                style={{
                  ...st,
                  borderRadius: 6,
                  padding: "7px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                  // Make ACTIVE unmistakable (cyan), not confused with HOT
                  outline: isSelected ? "2px solid rgba(0,255,255,0.55)" : "none",
                  boxShadow: isSelected ? "0 0 0 1px rgba(0,255,255,0.25)" : "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{m.filtered ? "—" : `${m.count}/${m.uniq}`}</div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.03em" }}>
                    {m.filtered ? "FILTERED" : m.heat.label}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{isSelected ? "ACTIVE" : ""}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bands grid */}
      <div style={{ overflow: "auto", paddingRight: 4 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {bands.map((b) => {
            const st = b.filtered ? filteredStyle() : activityStyle(b.activity);

            return (
              <div
                key={b.band}
                style={{
                  ...st,
                  borderRadius: 6,
                  padding: "7px 8px",
                  minHeight: 44,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
                title={b.filtered ? "Filtered out by DX Cluster band filters" : `spots: ${b.count}, unique: ${b.uniques}`}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{b.band}</div>
                  <div style={{ fontSize: 11, opacity: 0.9 }}>{b.filtered ? "" : trendGlyph(b.trend)}</div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.03em" }}>{b.label}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {b.filtered ? "—" : `${b.count}/${b.uniques}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 8, fontSize: 9, color: "var(--text-muted)" }}>
          {mode === "ALL"
            ? `Showing all included modes from DX Cluster spots over the last ${windowMinutes} minutes.`
            : `Showing ${mode} spots from DX Cluster over the last ${windowMinutes} minutes.`}
        </div>
      </div>
    </div>
  );
}

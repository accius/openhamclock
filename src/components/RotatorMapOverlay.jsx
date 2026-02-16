import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * RotatorMapOverlay V1
 * - Absolute SVG overlay that draws a dashed neon bearing line from DE location.
 * - Uses a simple equirectangular lon/lat -> x/y projection based on container size.
 */
export default function RotatorMapOverlay({
  enabled,
  deLocation,          // expects { lat, lon } or { latitude, longitude }
  azimuth,             // degrees (0=N, 90=E)
  lastGoodAzimuth,     // fallback when azimuth is null/stale
}) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Observe container size so overlay matches map even when resized/zoomed panels
  useEffect(() => {
    if (!wrapRef.current) return;

    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(0, r.width), h: Math.max(0, r.height) });
    });

    ro.observe(el);
    // initial
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(0, r.width), h: Math.max(0, r.height) });

    return () => ro.disconnect();
  }, []);

  const { lat, lon } = useMemo(() => normalizeLatLon(deLocation), [deLocation]);

  const usedAz = useMemo(() => {
    const a = azimuth ?? lastGoodAzimuth;
    if (!Number.isFinite(a)) return null;
    return ((a % 360) + 360) % 360;
  }, [azimuth, lastGoodAzimuth]);

  const pathD = useMemo(() => {
    if (!enabled) return "";
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
    if (!usedAz && usedAz !== 0) return "";
    if (!size.w || !size.h) return "";

    // Start pixel from DE
    const p0 = projectEquirect(lon, lat, size.w, size.h);

    // Pick a destination ~90 degrees away (quarter globe) along that bearing.
    // This gives a long line that looks like an “arc out” from DE.
    const dest = destinationPoint(lat, lon, usedAz, 90);

    // Project destination
    const p1raw = projectEquirect(dest.lon, dest.lat, size.w, size.h);

    // Handle dateline wrap: choose the shortest x distance by shifting endpoint ±W
    let p1 = { ...p1raw };
    const dx = p1.x - p0.x;
    if (Math.abs(dx) > size.w / 2) {
      p1.x = dx > 0 ? p1.x - size.w : p1.x + size.w;
    }

    return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
  }, [enabled, lat, lon, usedAz, size.w, size.h]);

  if (!enabled) return null;

  return (
    <div
      ref={wrapRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2005,
        background: "transparent",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${Math.max(1, size.w)} ${Math.max(1, size.h)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {pathD ? (
          <>
            <path className="ohc-rotator-glow" d={pathD} />
            <path className="ohc-rotator-line" d={pathD} />
          </>
        ) : null}
      </svg>

      <style>{css}</style>
    </div>
  );
}

function normalizeLatLon(loc) {
  if (!loc || typeof loc !== "object") return { lat: NaN, lon: NaN };

  const lat =
    Number.isFinite(loc.lat) ? loc.lat :
    Number.isFinite(loc.latitude) ? loc.latitude :
    NaN;

  const lon =
    Number.isFinite(loc.lon) ? loc.lon :
    Number.isFinite(loc.lng) ? loc.lng :
    Number.isFinite(loc.longitude) ? loc.longitude :
    NaN;

  return { lat, lon };
}

// Simple equirectangular projection into pixel space
function projectEquirect(lon, lat, w, h) {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return { x, y };
}

// Destination point given start lat/lon, bearing (deg), distance (deg on sphere)
function destinationPoint(latDeg, lonDeg, bearingDeg, distanceDeg) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  const φ1 = toRad(latDeg);
  const λ1 = toRad(lonDeg);
  const θ = toRad(bearingDeg);
  const δ = toRad(distanceDeg);

  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ), cosδ = Math.cos(δ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);

  const y = Math.sin(θ) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  // Normalize lon to [-180, 180]
  let lon2 = ((toDeg(λ2) + 540) % 360) - 180;
  let lat2 = toDeg(φ2);

  return { lat: lat2, lon: lon2 };
}

const css = `
.ohc-rotator-line{
  fill:none;
  stroke: rgba(0,255,255,0.78);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-dasharray: 10 10;
  animation: ohcRotDash 2.8s linear infinite, ohcRotPulse 3.2s ease-in-out infinite;
}

.ohc-rotator-glow{
  fill:none;
  stroke: rgba(0,255,255,0.18);
  stroke-width: 7.5;
  stroke-linecap: round;
  stroke-dasharray: 10 10;
  filter: blur(0.2px);
  animation: ohcRotDash 2.8s linear infinite, ohcRotGlow 3.2s ease-in-out infinite;
}

@keyframes ohcRotDash{
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: -44; }
}
@keyframes ohcRotPulse{
  0%,100% { opacity: 0.55; }
  50%     { opacity: 0.95; }
}
@keyframes ohcRotGlow{
  0%,100% { opacity: 0.10; }
  50%     { opacity: 0.24; }
}
`;

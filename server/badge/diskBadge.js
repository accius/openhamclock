/**
 * Sun and moon badges, and the side disks on the conditions badge.
 * Images are JPEG/PNG buffers from the in-process SDO and Dial-A-Moon
 * caches. resvg pulls them in by href (badge-sun / badge-moon).
 */

const { resolveBadgeTheme } = require('./themes');

const WAVELENGTHS = {
  '0193': { id: '0193', label: 'AIA 193 Å', hint: 'Hot corona' },
  '0304': { id: '0304', label: 'AIA 304 Å', hint: 'Chromosphere' },
  '0171': { id: '0171', label: 'AIA 171 Å', hint: 'Quiet corona' },
  '0094': { id: '0094', label: 'AIA 94 Å', hint: 'Flare plasma' },
  HMIIC: { id: 'HMIIC', label: 'HMI visible', hint: 'Intensitygram' },
};
const DEFAULT_WAVELENGTH = '0193';

const DISK_SIZES = {
  full: { width: 440, disk: 300, pad: 18, logo: 28, brand: 16, label: 14, radius: 14 },
  compact: { width: 300, disk: 190, pad: 12, logo: 22, brand: 13, label: 12, radius: 12 },
  wide: { width: 560, disk: 400, pad: 22, logo: 30, brand: 18, label: 16, radius: 16 },
};

const SIDE_DISK = { full: 124, compact: 96, wide: 148 };

function firstQuery(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseWavelength(raw) {
  const text = String(firstQuery(raw) ?? '').trim();
  if (/^hmiic$/i.test(text)) return 'HMIIC';
  if (WAVELENGTHS[text]) return text;
  return DEFAULT_WAVELENGTH;
}

function parsePlacement(raw) {
  const text = String(firstQuery(raw) ?? '')
    .trim()
    .toLowerCase();
  if (text === 'left' || text === 'right') return text;
  return null;
}

/**
 * sun and moon are 'left' | 'right' | null. If both ask for the same side,
 * the moon takes the other side so the row stays balanced.
 */
function resolvePlacements(sunRaw, moonRaw) {
  let sun = parsePlacement(sunRaw);
  let moon = parsePlacement(moonRaw);
  if (sun && moon && sun === moon) moon = sun === 'left' ? 'right' : 'left';
  return { sun, moon };
}

/** Phase name from Dial-A-Moon age (days) and illumination percent. */
function moonPhaseName(phasePercent, ageDays) {
  const age = Number(ageDays);
  if (ageDays != null && ageDays !== '' && Number.isFinite(age)) {
    const a = ((age % 29.530588) + 29.530588) % 29.530588;
    if (a < 1 || a >= 28.5) return 'New Moon';
    if (a < 6.4) return 'Waxing Crescent';
    if (a < 8.4) return 'First Quarter';
    if (a < 13.8) return 'Waxing Gibbous';
    if (a < 15.8) return 'Full Moon';
    if (a < 21.1) return 'Waning Gibbous';
    if (a < 23.1) return 'Last Quarter';
    return 'Waning Crescent';
  }
  if (phasePercent == null || phasePercent === '') return null;
  const p = Number(phasePercent);
  if (!Number.isFinite(p)) return null;
  if (p < 2) return 'New Moon';
  if (p > 98) return 'Full Moon';
  if (p < 45) return 'Crescent';
  if (p <= 55) return 'Quarter';
  return 'Gibbous';
}

function formatIllumination(phasePercent) {
  if (phasePercent == null || phasePercent === '') return null;
  const p = Number(phasePercent);
  if (!Number.isFinite(p)) return null;
  return `${Math.round(Math.max(0, Math.min(100, p)))}% illuminated`;
}

function formatUpdated(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch],
  );
}

/** Circular photo, or a labeled placeholder when the bytes are missing. */
function toDataUri(buffer, contentType) {
  if (!buffer) return null;
  const mime = String(contentType || 'image/jpeg')
    .split(';')[0]
    .trim();
  const type = mime.startsWith('image/') ? mime : 'image/jpeg';
  return `data:${type};base64,${Buffer.from(buffer).toString('base64')}`;
}

function diskElement(x, y, size, href, missingLabel, accent) {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  const clip = `disk-${Math.round(x)}-${Math.round(y)}`;
  if (!href) {
    return `<circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.7"/>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${accent}" font-family="IBM Plex Sans" font-size="12" font-weight="700">${esc(missingLabel)}</text>`;
  }
  return `<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r - 2}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#000" fill-opacity="0.35"/>
    <image href="${href}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>
    <circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="none" stroke="${accent}" stroke-opacity="0.85" stroke-width="2"/>`;
}

function sideDiskSize(variant) {
  return SIDE_DISK[variant] || SIDE_DISK.full;
}

function buildDiskBadgeSvg({ kind, palette, variant, title, subtitle, detail, updated, imageHref }) {
  const spec = DISK_SIZES[variant] || DISK_SIZES.full;
  const theme = palette;
  const width = spec.width;
  const disk = spec.disk;
  const header = spec.pad + spec.logo + 8;
  const captionBlock = (subtitle ? 22 : 0) + (detail ? 20 : 0) + 18;
  const height = Math.ceil(header + disk + captionBlock + spec.pad + 16);
  const diskX = (width - disk) / 2;
  const diskY = header + 4;
  const href = imageHref || null;
  let textY = diskY + disk + 22;
  const lines = [];
  if (subtitle) {
    lines.push(
      `<text x="${width / 2}" y="${textY}" text-anchor="middle" fill="${theme.text}" font-family="IBM Plex Sans" font-weight="700" font-size="${spec.label}">${esc(subtitle)}</text>`,
    );
    textY += 20;
  }
  if (detail) {
    lines.push(
      `<text x="${width / 2}" y="${textY}" text-anchor="middle" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label - 2}">${esc(detail)}</text>`,
    );
    textY += 18;
  }
  if (updated) {
    lines.push(
      `<text x="${width / 2}" y="${textY}" text-anchor="middle" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${Math.max(10, spec.label - 3)}">${esc(updated)}</text>`,
    );
  }
  const rx = spec.radius;
  const brandY = spec.pad + spec.logo * 0.68;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="ohcBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.surface}"/>
      <stop offset="1" stop-color="${theme.background}"/>
    </linearGradient>
    <radialGradient id="ohcGlow" cx="0.5" cy="0.2" r="0.8">
      <stop offset="0" stop-color="${theme.accent}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="ohcFrame"><rect width="${width}" height="${height}" rx="${rx}"/></clipPath>
  </defs>
  <g clip-path="url(#ohcFrame)">
    <rect width="${width}" height="${height}" fill="url(#ohcBg)"/>
    <rect width="${width}" height="${height}" fill="url(#ohcGlow)"/>
    <rect width="7" height="${height}" fill="${theme.accentBar || theme.accent}"/>
  </g>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${rx - 1}" fill="none" stroke="${theme.accent}" stroke-opacity="0.85" stroke-width="1.5"/>
  <text x="${spec.pad + 10}" y="${brandY}" fill="${theme.accent}" font-family="IBM Plex Sans" font-weight="700" font-size="${spec.brand}" letter-spacing="0.5">OPENHAMCLOCK</text>
  <text x="${width - spec.pad}" y="${brandY}" text-anchor="end" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label - 2}" font-weight="700" letter-spacing="1">${esc(title)}</text>
  ${diskElement(diskX, diskY, disk, href, kind === 'moon' ? 'Moon' : 'Sun', theme.accent)}
  ${lines.join('\n  ')}
  <text x="${width - spec.pad}" y="${height - spec.pad + 4}" text-anchor="end" fill="${theme.accent}" font-family="IBM Plex Sans" font-weight="700" font-size="${Math.max(10, spec.label - 3)}">openhamclock.com</text>
</svg>`;
}

module.exports = {
  WAVELENGTHS,
  DEFAULT_WAVELENGTH,
  DISK_SIZES,
  parseWavelength,
  parsePlacement,
  resolvePlacements,
  moonPhaseName,
  formatIllumination,
  formatUpdated,
  sideDiskSize,
  diskElement,
  buildDiskBadgeSvg,
  toDataUri,
  resolveBadgeTheme,
};

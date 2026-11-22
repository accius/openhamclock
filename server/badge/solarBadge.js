/**
 * OpenHamClock solar / HF conditions badge.
 *
 * SVG is drawn here and rasterized with @resvg/resvg-wasm (no native
 * addon, so Alpine, Pi, and the pkg binaries can all render it). IBM Plex
 * Sans is bundled because production images have no system fonts.
 *
 * Rendered PNGs are cached ~5 minutes per theme + fields + variant, and
 * concurrent misses share one render.
 */

const fs = require('fs');
const path = require('path');
const { mixHex } = require('./color');
const { resolveBadgeTheme } = require('./themes');
const {
  parseWavelength,
  resolvePlacements,
  sideDiskSize,
  diskElement,
  buildDiskBadgeSvg,
  moonPhaseName,
  formatIllumination,
  formatUpdated: formatDiskTime,
  WAVELENGTHS,
  DEFAULT_WAVELENGTH,
  toDataUri,
} = require('./diskBadge');
const {
  rateSfi,
  rateSsn,
  rateKp,
  rateA,
  xrayFromFlux,
  parseXrayText,
  bandColor,
  inkOn,
  segments,
  sfiBucket,
  ssnBucket,
  aBucket,
  xrayBucket,
  SEGMENT_COLORS,
  A_SEGMENT_COLORS,
  XRAY_SEGMENT_COLORS,
} = require('./status');

const FIELD_IDS = ['sfi', 'ssn', 'kp', 'a', 'k', 'xray', 'bands', 'updated', 'trend'];
const DEFAULT_FIELDS = ['sfi', 'ssn', 'kp', 'a', 'xray', 'bands', 'updated', 'trend'];
const VARIANTS = ['full', 'compact', 'wide'];

const FIELD_META = [
  { id: 'sfi', label: 'SFI', hint: '10.7 cm solar flux, with a poor-to-excellent meter' },
  { id: 'ssn', label: 'Sunspots', hint: 'Sunspot number' },
  { id: 'kp', label: 'Kp', hint: 'Planetary K, colored quiet / unsettled / storm with the NOAA G-scale' },
  { id: 'a', label: 'A index', hint: 'Planetary A index' },
  { id: 'k', label: 'K index', hint: 'K index from the N0NBH feed, when that cache is warm' },
  { id: 'xray', label: 'X-ray', hint: 'GOES X-ray class (A/B, C, M, X)' },
  { id: 'bands', label: 'HF bands', hint: 'Day and night conditions, 80–40 through 12–10' },
  { id: 'trend', label: 'Trend', hint: 'Compact SFI and Kp sparklines from the in-process history' },
  { id: 'updated', label: 'Updated', hint: 'UTC timestamp' },
];

const VARIANT_META = [
  { id: 'full', label: 'Standard', hint: '760 px' },
  { id: 'compact', label: 'Compact', hint: '580 px, tighter type' },
  { id: 'wide', label: 'Wide', hint: '980 px' },
];

const SPECS = {
  full: { width: 760, pad: 18, logo: 28, brand: 16, value: 26, label: 11, pill: 10, chip: 11, radius: 14, cardH: 104 },
  compact: {
    width: 580,
    pad: 12,
    logo: 24,
    brand: 13,
    value: 20,
    label: 10,
    pill: 9,
    chip: 10,
    radius: 12,
    cardH: 90,
  },
  wide: {
    width: 980,
    pad: 22,
    logo: 30,
    brand: 18,
    value: 30,
    label: 12,
    pill: 11,
    chip: 12,
    radius: 16,
    cardH: 116,
  },
};

const STAT_META = {
  sfi: { label: 'SFI', icon: 'sun' },
  ssn: { label: 'SSN', icon: null },
  kp: { label: 'Kp', icon: 'magnet' },
  a: { label: 'A', icon: null },
  k: { label: 'K', icon: 'magnet' },
  xray: { label: 'X-ray', icon: null },
};

const BAND_GROUPS = [
  ['80m-40m', '80-40'],
  ['30m-20m', '30-20'],
  ['17m-15m', '17-15'],
  ['12m-10m', '12-10'],
];

const N0NBH_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 48;

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

function firstQuery(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseBadgeFields(raw) {
  const text = firstQuery(raw);
  if (text == null || !String(text).trim() || String(text).trim().toLowerCase() === 'all')
    return DEFAULT_FIELDS.slice();
  const wanted = new Set();
  for (const part of String(text).split(',')) {
    const id = part.trim().toLowerCase();
    if (FIELD_IDS.includes(id)) wanted.add(id);
  }
  if (wanted.size === 0) return DEFAULT_FIELDS.slice();
  return FIELD_IDS.filter((id) => wanted.has(id));
}

function parseBadgeVariant(raw) {
  const v = String(firstQuery(raw) ?? '')
    .trim()
    .toLowerCase();
  return VARIANTS.includes(v) ? v : 'full';
}

function num(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function formatNumber(id, value) {
  if (value == null) return '--';
  if (id === 'kp' || id === 'k') {
    const rounded = Math.round(value * 100) / 100;
    return String(rounded);
  }
  return String(Math.round(value));
}

function formatUpdated(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function seriesValues(history) {
  if (!Array.isArray(history)) return [];
  return history.map((point) => num(point?.value)).filter((v) => v != null);
}

function normalizeCondition(value) {
  const upper = String(value || '')
    .trim()
    .toUpperCase();
  if (upper === 'GOOD' || upper === 'FAIR' || upper === 'POOR') return upper;
  return null;
}

function readBands(cache, now) {
  if (!cache?.data || !cache.timestamp) return null;
  if (now - cache.timestamp > N0NBH_MAX_AGE_MS) return null;
  const list = cache.data.bandConditions;
  if (!Array.isArray(list) || list.length === 0) return null;
  const map = { day: {}, night: {} };
  for (const band of list) {
    const when = String(band?.time || '').toLowerCase();
    if (when !== 'day' && when !== 'night') continue;
    const condition = normalizeCondition(band.condition);
    if (condition) map[when][String(band.name || '').toLowerCase()] = condition;
  }
  const groups = BAND_GROUPS.map(([key, label]) => ({
    label,
    day: map.day[key] || null,
    night: map.night[key] || null,
  })).filter((group) => group.day || group.night);
  return groups.length ? { source: 'N0NBH', groups } : null;
}

function readXray(flux, n0) {
  const fromFlux = xrayFromFlux(flux);
  if (fromFlux) return { ...fromFlux, source: 'NOAA' };
  const parsed = parseXrayText(n0?.solarData?.xray);
  return parsed ? { ...parsed, source: 'N0NBH' } : null;
}

function meterFor(id, value, xray) {
  if (value == null && id !== 'xray') return null;
  if (id === 'sfi') return { kind: 'segments', segments: segments(sfiBucket(value), SEGMENT_COLORS) };
  if (id === 'ssn') return { kind: 'segments', segments: segments(ssnBucket(value), SEGMENT_COLORS) };
  if (id === 'a') return { kind: 'segments', segments: segments(aBucket(value), A_SEGMENT_COLORS) };
  if (id === 'kp' || id === 'k') return { kind: 'bar', fraction: Math.max(0, Math.min(1, value / 9)) };
  if (id === 'xray' && xray)
    return { kind: 'segments', segments: segments(xrayBucket(xray.letter), XRAY_SEGMENT_COLORS) };
  return null;
}

function buildBadgeModel({ indices, n0nbh, xrayFlux, theme, fields, variant, now = Date.now() }) {
  const palette = typeof theme === 'string' ? resolveBadgeTheme(theme) : theme;
  const fieldList = Array.isArray(fields) ? fields : parseBadgeFields(fields);
  const variantId = parseBadgeVariant(variant);
  const n0 = n0nbh?.data && now - (n0nbh.timestamp || 0) <= N0NBH_MAX_AGE_MS ? n0nbh.data : null;
  const xray = readXray(num(xrayFlux), n0);

  const values = {
    sfi: num(indices?.sfi?.current),
    ssn: num(indices?.ssn?.current),
    kp: num(indices?.kp?.current),
    a: num(indices?.a?.current) != null ? num(indices?.a?.current) : num(n0?.solarData?.aIndex),
    k: num(n0?.solarData?.kIndex),
    xray: null,
  };
  const ratings = {
    sfi: rateSfi(values.sfi),
    ssn: rateSsn(values.ssn),
    kp: rateKp(values.kp),
    a: rateA(values.a),
    k: rateKp(values.k),
    xray: xray?.status || null,
  };

  const stats = fieldList
    .filter((id) => STAT_META[id])
    .map((id) => {
      const has = id === 'xray' ? !!xray : values[id] != null;
      return {
        id,
        label: STAT_META[id].label,
        icon: STAT_META[id].icon,
        valueText: id === 'xray' ? (xray ? xray.text : '--') : formatNumber(id, values[id]),
        has,
        status: has ? ratings[id] : null,
        meter: has ? meterFor(id, values[id], xray) : null,
      };
    });

  let trend = null;
  if (fieldList.includes('trend')) {
    const rows = [];
    const sfiSeries = seriesValues(indices?.sfi?.history);
    const kpSeries = seriesValues(indices?.kp?.history);
    if (sfiSeries.length >= 2)
      rows.push({
        id: 'sfi',
        label: 'SFI',
        values: sfiSeries.slice(-30),
        color: rateSfi(values.sfi)?.color || '#c6d63a',
      });
    if (kpSeries.length >= 2)
      rows.push({ id: 'kp', label: 'Kp', values: kpSeries.slice(-24), color: rateKp(values.kp)?.color || '#2fbf6a' });
    if (rows.length) trend = rows;
  }

  const bands = fieldList.includes('bands') ? readBands(n0nbh, now) : null;
  const anyValue = stats.some((stat) => stat.has);
  const asked = stats.length > 0 || fieldList.includes('bands') || fieldList.includes('trend');
  const unavailable = asked && !anyValue && !bands && !trend;

  return {
    palette,
    variant: variantId,
    fields: fieldList,
    stats: unavailable ? [] : stats,
    trend,
    trendNote: fieldList.includes('trend') && !trend ? 'Trend unavailable' : null,
    bands,
    bandsNote: fieldList.includes('bands') && !bands ? 'HF bands unavailable' : null,
    updated: fieldList.includes('updated') ? formatUpdated(indices?.timestamp) || 'Updated --' : null,
    unavailable,
  };
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch],
  );
}

function sunIcon(x, y, color, scale = 1) {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i;
    const x1 = Math.cos(angle) * 4.2;
    const y1 = Math.sin(angle) * 4.2;
    const x2 = Math.cos(angle) * 6.4;
    const y2 = Math.sin(angle) * 6.4;
    rays.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`,
    );
  }
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none">
    <circle cx="0" cy="0" r="2.7" fill="${color}"/>
    ${rays.join('')}
  </g>`;
}

function magnetIcon(x, y, color) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-linecap="round">
    <path d="M1.6 9.2 V5.6 a4.2 4.2 0 0 1 8.4 0 V9.2" stroke-width="1.5"/>
    <path d="M1.6 9.2 v2.3" stroke="${'#ff5a5a'}" stroke-width="2.2"/>
    <path d="M10 9.2 v2.3" stroke="${'#5aa2ff'}" stroke-width="2.2"/>
  </g>`;
}

function logoMark(x, y, size, accent, ink) {
  const c = size / 2;
  return `<g transform="translate(${x} ${y})">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.26)}" fill="${accent}"/>
    ${sunIcon(c, c, ink, size / 22)}
  </g>`;
}

function segmentMeter(x, y, w, h, segs, track) {
  const gap = 3;
  const sw = (w - gap * (segs.length - 1)) / segs.length;
  return segs
    .map((seg, i) => {
      const fill = seg.filled ? seg.color : track;
      const sx = x + i * (sw + gap);
      return `<rect x="${sx.toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${h}" rx="2" fill="${fill}"/>`;
    })
    .join('');
}

function barMeter(x, y, w, h, fraction, color, track) {
  const fw = Math.max(h, w * Math.max(0, Math.min(1, fraction)));
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${track}"/>
    <rect x="${x}" y="${y}" width="${fw.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color}"/>`;
}

function sparkline(values, x, y, w, h, color) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, i) => {
    const px = x + (values.length === 1 ? 0 : (i / (values.length - 1)) * w);
    const py = y + h - ((value - min) / span) * h;
    return [px, py];
  });
  const line = coords
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`)
    .join(' ');
  const area = `${line} L${(x + w).toFixed(1)} ${(y + h).toFixed(1)} L${x.toFixed(1)} ${(y + h).toFixed(1)} Z`;
  return `<path d="${area}" fill="${color}" opacity="0.18"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function pill(x, y, label, fill, fontSize) {
  const width = Math.ceil(label.length * fontSize * 0.62 + fontSize);
  const height = fontSize + 7;
  const ink = inkOn(fill);
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}"/>
    <text x="${x + width / 2}" y="${y + height - 4.5}" text-anchor="middle" fill="${ink}" font-size="${fontSize}" font-weight="700" font-family="IBM Plex Sans">${esc(label)}</text>
  </g>`;
}

function buildSolarBadgeSvg(model) {
  const spec = SPECS[model.variant] || SPECS.full;
  const theme = model.palette;
  const track = mixHex(
    theme.background,
    theme.text,
    theme.group === 'color' && theme.id === 'neutral-light' ? 0.14 : 0.16,
  );
  const disk = model.left || model.right ? sideDiskSize(model.variant) : 0;
  const col = disk ? disk + 22 : 0;
  const leftCol = model.left ? col : 0;
  const rightCol = model.right ? col : 0;
  const width = spec.width + leftCol + rightCol;
  let y = spec.pad;

  const headerY = y;
  y += spec.logo + 14;

  // Side photos sit beside the stat cards. The row is tall enough for the
  // disk and its caption, and the sparklines and HF bands start below that
  // so they are not covered by the photos.
  const captionH = disk ? 22 : 0;
  const rowH = disk ? Math.max(spec.cardH, disk + captionH) : spec.cardH;
  let cardsY = null;
  if (model.stats.length || disk) {
    cardsY = y;
    y += rowH + 12;
  }

  let unavailableY = null;
  if (model.unavailable) {
    unavailableY = y + 22;
    y += 40;
  }

  let trendY = null;
  if (model.trend || model.trendNote) {
    trendY = y;
    y += model.trend ? 40 : 22;
  }

  let bandsY = null;
  if (model.bands || model.bandsNote) {
    bandsY = y;
    y += model.bands ? 70 : 24;
  }

  const bodyTop = spec.pad + spec.logo + 14;

  const footerBaseline = y + 14;
  y = footerBaseline + spec.pad - 2;
  const height = Math.ceil(y);
  const rx = spec.radius;
  const chunks = [];

  chunks.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  chunks.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  );
  chunks.push(`<defs>
    <linearGradient id="ohcBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.surface}"/>
      <stop offset="1" stop-color="${theme.background}"/>
    </linearGradient>
    <radialGradient id="ohcGlow" cx="0" cy="0" r="1">
      <stop offset="0" stop-color="${theme.accent}" stop-opacity="0.38"/>
      <stop offset="0.55" stop-color="${theme.accent}" stop-opacity="0.05"/>
      <stop offset="1" stop-color="${theme.accent}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="ohcFrame"><rect width="${width}" height="${height}" rx="${rx}"/></clipPath>
  </defs>`);
  chunks.push(`<g clip-path="url(#ohcFrame)">
    <rect width="${width}" height="${height}" fill="url(#ohcBg)"/>
    <rect width="${Math.round(width * 0.72)}" height="${Math.round(height * 0.85)}" fill="url(#ohcGlow)"/>
    <rect width="7" height="${height}" fill="${theme.accentBar || theme.accent}"/>
  </g>`);
  chunks.push(
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${rx - 1}" fill="none" stroke="${theme.accent}" stroke-opacity="0.85" stroke-width="1.5"/>`,
  );
  chunks.push(
    `<rect x="4" y="4" width="${width - 8}" height="${height - 8}" rx="${rx - 2}" fill="none" stroke="${theme.accent}" stroke-opacity="0.18" stroke-width="5"/>`,
  );

  const ink = theme.background;
  chunks.push(logoMark(spec.pad + 4, headerY, spec.logo, theme.accent, ink));
  const brandX = spec.pad + spec.logo + 14;
  const brandY = headerY + spec.logo * 0.68;
  chunks.push(
    `<text x="${brandX}" y="${brandY}" fill="${theme.accent}" font-family="IBM Plex Sans" font-weight="700" font-size="${spec.brand}" letter-spacing="0.6">OPENHAMCLOCK</text>`,
  );
  chunks.push(
    `<text x="${width - spec.pad}" y="${brandY - spec.brand - 2}" text-anchor="end" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label}" letter-spacing="1.2">SOLAR / HF</text>`,
  );
  if (model.updated) {
    chunks.push(
      `<text x="${width - spec.pad}" y="${brandY}" text-anchor="end" fill="${theme.text}" font-family="IBM Plex Sans" font-size="${spec.label}">${esc(model.updated)}</text>`,
    );
  }

  if (cardsY != null) {
    const left = spec.pad + 6 + leftCol;
    const right = width - spec.pad - rightCol;
    const gap = 8;
    const n = model.stats.length;
    const maxCard = spec.width > 800 ? 220 : 180;
    const natural = (right - left - gap * (n - 1)) / n;
    const cardW = Math.min(maxCard, natural);
    const rowW = n * cardW + (n - 1) * gap;
    const rowX = left + (right - left - rowW) / 2;
    model.stats.forEach((stat, i) => {
      const x = rowX + i * (cardW + gap);
      chunks.push(statCard(stat, x, cardsY, cardW, spec, theme, track));
    });
  }

  if (unavailableY != null) {
    chunks.push(
      `<text x="${spec.pad + 8}" y="${unavailableY}" fill="${theme.text}" font-family="IBM Plex Sans" font-weight="700" font-size="${spec.value - 4}">Data unavailable</text>`,
    );
  }

  if (trendY != null && model.trend) {
    const trendX = spec.pad + 6 + leftCol;
    const trendW = width - spec.pad * 2 - 6 - leftCol - rightCol;
    chunks.push(trendRow(model.trend, trendX, trendY, trendW, theme, spec));
  } else if (trendY != null && model.trendNote) {
    chunks.push(
      `<text x="${spec.pad + 8}" y="${trendY + 14}" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label}">${esc(model.trendNote)}</text>`,
    );
  }

  if (bandsY != null && model.bands) {
    const bandX = spec.pad + 6 + leftCol;
    const bandW = width - spec.pad * 2 - 6 - leftCol - rightCol;
    chunks.push(bandRow(model.bands, bandX, bandsY, bandW, theme, spec));
  } else if (bandsY != null && model.bandsNote) {
    chunks.push(
      `<text x="${spec.pad + 8}" y="${bandsY + 16}" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label}">${esc(model.bandsNote)}</text>`,
    );
  }

  if (model.left) {
    chunks.push(sideColumn(model.left, spec.pad + 4, bodyTop, disk, theme));
  }
  if (model.right) {
    chunks.push(sideColumn(model.right, width - spec.pad - disk - 4, bodyTop, disk, theme));
  }

  chunks.push(
    `<text x="${width - spec.pad}" y="${footerBaseline}" text-anchor="end" fill="${theme.accent}" font-family="IBM Plex Sans" font-weight="700" font-size="${spec.label}">openhamclock.com</text>`,
  );
  chunks.push(`</svg>`);
  return chunks.join('');
}

function sideColumn(slot, x, y, size, theme) {
  return `<g>
    ${diskElement(x, y, size, slot.href, slot.missing, theme.accent)}
    <text x="${x + size / 2}" y="${y + size + 16}" text-anchor="middle" fill="${theme.text}" font-family="IBM Plex Sans" font-weight="700" font-size="11">${esc(slot.caption || '')}</text>
  </g>`;
}

function statCard(stat, x, y, w, spec, theme, track) {
  const h = spec.cardH;
  const inner = 10;
  const parts = [];
  parts.push(`<rect x="${x + 1}" y="${y + 2}" width="${w}" height="${h}" rx="10" fill="#000000" opacity="0.18"/>`);
  parts.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${theme.background}" fill-opacity="0.72" stroke="${theme.accent}" stroke-opacity="0.28"/>`,
  );
  let labelX = x + inner;
  if (stat.icon === 'sun') {
    parts.push(sunIcon(labelX + 6, y + 16, theme.accent, 0.85));
    labelX += 16;
  } else if (stat.icon === 'magnet') {
    parts.push(magnetIcon(labelX, y + 7, theme.muted));
    labelX += 16;
  }
  parts.push(
    `<text x="${labelX}" y="${y + 18}" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label}" font-weight="700" letter-spacing="0.8">${esc(stat.label)}</text>`,
  );
  const valueBaseline = y + 20 + spec.value;
  parts.push(
    `<text x="${x + inner}" y="${valueBaseline}" fill="${theme.text}" font-family="IBM Plex Sans" font-weight="700" font-size="${spec.value}">${esc(stat.valueText)}</text>`,
  );
  const pillY = valueBaseline + 8;
  if (stat.status) {
    parts.push(pill(x + inner, pillY, stat.status.label, stat.status.color, spec.pill));
  }
  const meterY = y + h - 14;
  const meterW = w - inner * 2;
  if (stat.meter?.kind === 'segments') {
    parts.push(segmentMeter(x + inner, meterY, meterW, 6, stat.meter.segments, track));
  } else if (stat.meter?.kind === 'bar') {
    parts.push(barMeter(x + inner, meterY, meterW, 6, stat.meter.fraction, stat.status.color, track));
  }
  return parts.join('');
}

function trendRow(rows, x, y, w, theme, spec) {
  const gap = 16;
  const labelW = 36;
  const each = (w - gap * (rows.length - 1)) / rows.length;
  return rows
    .map((row, i) => {
      const rx = x + i * (each + gap);
      const color = row.color || theme.accent;
      return `<text x="${rx}" y="${y + 12}" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label - 1}" font-weight="700">${esc(row.label)}</text>
      ${sparkline(row.values, rx + labelW, y + 2, each - labelW - 8, 22, color)}`;
    })
    .join('');
}

function bandRow(bands, x, y, w, theme, spec) {
  const parts = [];
  parts.push(
    `<text x="${x}" y="${y + 12}" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label}" font-weight="700" letter-spacing="0.8">HF BANDS</text>`,
  );
  parts.push(
    `<text x="${x + w}" y="${y + 12}" text-anchor="end" fill="${theme.muted}" font-family="IBM Plex Sans" font-size="${spec.label - 1}">${esc(bands.source)} · day / night</text>`,
  );
  const n = bands.groups.length;
  const gap = 8;
  const slot = (w - gap * (n - 1)) / n;
  const nameY = y + 30;
  const chipY = y + 36;
  const chipH = spec.chip + 8;
  const chipW = Math.max(40, (slot - 4) / 2);
  bands.groups.forEach((group, i) => {
    const gx = x + i * (slot + gap);
    parts.push(
      `<text x="${gx}" y="${nameY}" fill="${theme.text}" font-family="IBM Plex Sans" font-weight="700" font-size="${spec.chip}">${esc(group.label)}</text>`,
    );
    parts.push(conditionChip(gx, chipY, chipW, chipH, 'D', group.day, spec.chip, theme));
    parts.push(conditionChip(gx + chipW + 4, chipY, chipW, chipH, 'N', group.night, spec.chip, theme));
  });
  return parts.join('');
}

function conditionChip(x, y, w, h, prefix, condition, fontSize, theme) {
  const fill = bandColor(condition) || mixHex(theme.background, theme.text, 0.16);
  const ink = condition ? inkOn(fill) : theme.muted;
  const word = condition ? condition[0] + condition.slice(1).toLowerCase() : '--';
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}"/>
    <text x="${x + w / 2}" y="${y + h - 5}" text-anchor="middle" fill="${ink}" font-family="IBM Plex Sans" font-weight="700" font-size="${fontSize}">${esc(prefix)} ${esc(word)}</text>
  </g>`;
}

let fontBuffers = null;
function loadFonts() {
  if (!fontBuffers) {
    fontBuffers = ['IBMPlexSans-Regular.ttf', 'IBMPlexSans-Bold.ttf'].map(
      (name) => new Uint8Array(fs.readFileSync(path.join(FONT_DIR, name))),
    );
  }
  return fontBuffers;
}

let wasmReady = null;
function ensureWasm() {
  if (!wasmReady) {
    wasmReady = (async () => {
      const { initWasm } = require('@resvg/resvg-wasm');
      await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    })().catch((error) => {
      wasmReady = null;
      throw error;
    });
  }
  return wasmReady;
}

async function svgToPng(svg, background, images) {
  await ensureWasm();
  const { Resvg } = require('@resvg/resvg-wasm');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' },
    background: background || '#0a0e14',
    font: {
      fontBuffers: loadFonts(),
      defaultFontFamily: 'IBM Plex Sans',
      sansSerifFamily: 'IBM Plex Sans',
      serifFamily: 'IBM Plex Sans',
    },
    textRendering: 1,
    shapeRendering: 2,
  });
  try {
    if (images) {
      const pending = typeof resvg.imagesToResolve === 'function' ? resvg.imagesToResolve() : [];
      for (const item of pending) {
        const href = typeof item === 'string' ? item : item?.url || item?.href;
        const buf = href && images[href];
        if (buf) resvg.resolveImage(href, buf);
      }
    }
    const rendered = resvg.render();
    try {
      return Buffer.from(rendered.asPng());
    } finally {
      rendered.free();
    }
  } finally {
    resvg.free();
  }
}

const pngCache = new Map();
const inflight = new Map();

// Server-wide budget for cache-miss renders. theme × variant × fields has
// thousands of combinations, so a caller cycling query strings could force a
// rasterize per request. Past the budget, uncached combinations get the
// default badge (cached, cheap) instead of a fresh render.
let renderBudgetPerMin = 60;
let renderWindowStart = 0;
let rendersInWindow = 0;

function takeRenderSlot(now = Date.now()) {
  if (now - renderWindowStart >= 60_000) {
    renderWindowStart = now;
    rendersInWindow = 0;
  }
  if (rendersInWindow >= renderBudgetPerMin) return false;
  rendersInWindow++;
  return true;
}

function cacheKey(themeId, fields, variant, sun, moon, wl) {
  let key = `${themeId}|${variant}|${fields.join(',')}`;
  if (sun || moon) key += `|${sun || '-'}|${moon || '-'}|${wl || DEFAULT_WAVELENGTH}`;
  return key;
}

function touch(key, entry) {
  pngCache.delete(key);
  pngCache.set(key, entry);
  while (pngCache.size > CACHE_MAX) pngCache.delete(pngCache.keys().next().value);
}

async function loadSideImages(ctx, placements, wl) {
  let sun = null;
  let moon = null;
  if (placements.sun && ctx && typeof ctx.getSolarImage === 'function') {
    try {
      sun = await ctx.getSolarImage(wl);
    } catch (error) {
      ctx.logErrorOnce?.('Sun badge', error.message);
    }
  }
  if (placements.moon && ctx && typeof ctx.getMoonSnapshot === 'function') {
    try {
      moon = await ctx.getMoonSnapshot();
    } catch (error) {
      ctx.logErrorOnce?.('Moon badge', error.message);
    }
  }
  return { sun, moon };
}

function slotFor(kind, photo, wl) {
  const href = toDataUri(photo?.buffer, photo?.contentType);
  if (kind === 'sun') {
    return {
      href,
      missing: 'Sun',
      caption: WAVELENGTHS[wl]?.label || 'AIA 193 Å',
    };
  }
  const name = moonPhaseName(photo?.phase, photo?.age);
  return {
    href,
    missing: 'Moon',
    caption: name || 'Moon',
  };
}

async function renderFresh(themeId, fields, variant, ctx, placements, wl) {
  let indices = null;
  try {
    if (ctx && typeof ctx.getSolarIndices === 'function') indices = await ctx.getSolarIndices();
  } catch (error) {
    ctx?.logErrorOnce?.('Solar badge', error.message);
  }
  let xrayFlux = null;
  try {
    if (ctx && typeof ctx.getCachedXrayFlux === 'function') xrayFlux = ctx.getCachedXrayFlux();
  } catch {
    xrayFlux = null;
  }
  const sides = placements || { sun: null, moon: null };
  const loaded = sides.sun || sides.moon ? await loadSideImages(ctx, sides, wl) : {};
  const model = buildBadgeModel({
    indices,
    n0nbh: ctx?.n0nbhCache,
    xrayFlux,
    theme: themeId,
    fields,
    variant,
  });
  if (sides.sun === 'left' || sides.moon === 'left') {
    model.left = slotFor(sides.sun === 'left' ? 'sun' : 'moon', sides.sun === 'left' ? loaded.sun : loaded.moon, wl);
  }
  if (sides.sun === 'right' || sides.moon === 'right') {
    model.right = slotFor(sides.sun === 'right' ? 'sun' : 'moon', sides.sun === 'right' ? loaded.sun : loaded.moon, wl);
  }
  const svg = buildSolarBadgeSvg(model);
  return svgToPng(svg, model.palette.background);
}

/**
 * @param {{ theme?: string, fields?: string, variant?: string, ctx?: object }} opts
 * @returns {Promise<Buffer>}
 */
async function renderSolarBadgePng(opts) {
  const theme = resolveBadgeTheme(opts.theme);
  const fields = parseBadgeFields(opts.fields);
  const variant = parseBadgeVariant(opts.variant);
  const placements = resolvePlacements(opts.sun, opts.moon);
  const wl = parseWavelength(opts.wl);
  const key = cacheKey(theme.id, fields, variant, placements.sun, placements.moon, wl);
  const hit = pngCache.get(key);
  if (hit && Date.now() - hit.timestamp < CACHE_TTL_MS) {
    touch(key, hit);
    return hit.png;
  }
  if (inflight.has(key)) return inflight.get(key);
  const isDefault = !opts.theme && !opts.fields && !opts.variant && !opts.sun && !opts.moon;
  if (!takeRenderSlot() && !isDefault) {
    if (hit) return hit.png; // stale beats nothing
    return renderSolarBadgePng({ ctx: opts.ctx });
  }
  const job = renderFresh(theme.id, fields, variant, opts.ctx, placements, wl)
    .then((png) => {
      touch(key, { png, timestamp: Date.now() });
      return png;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

const diskCache = new Map();
const diskInflight = new Map();

async function renderDiskBadge(kind, opts) {
  const theme = resolveBadgeTheme(opts.theme);
  const variant = parseBadgeVariant(opts.variant);
  const wl = parseWavelength(opts.wl);
  const ttl = kind === 'moon' ? 60 * 60 * 1000 : 15 * 60 * 1000;
  const key = `${kind}|${theme.id}|${variant}|${kind === 'sun' ? wl : ''}`;
  const hit = diskCache.get(key);
  if (hit && Date.now() - hit.timestamp < ttl) {
    diskCache.delete(key);
    diskCache.set(key, hit);
    return hit.png;
  }
  if (diskInflight.has(key)) return diskInflight.get(key);
  // Same render budget as the conditions badge: past it, an uncached
  // combination gets its stale copy or the default sun/moon badge.
  const isDefault = !opts.theme && !opts.variant && !opts.wl;
  if (!takeRenderSlot() && !isDefault) {
    if (hit) return hit.png;
    return renderDiskBadge(kind, { ctx: opts.ctx });
  }
  const job = (async () => {
    const loaded =
      kind === 'sun'
        ? await loadSideImages(opts.ctx, { sun: 'left', moon: null }, wl)
        : await loadSideImages(opts.ctx, { sun: null, moon: 'right' }, wl);
    const photo = kind === 'sun' ? loaded.sun : loaded.moon;
    const phase = kind === 'moon' ? moonPhaseName(photo?.phase, photo?.age) : null;
    const svg = buildDiskBadgeSvg({
      kind,
      palette: theme,
      variant,
      title: kind === 'sun' ? 'SUN' : 'MOON',
      subtitle: kind === 'sun' ? WAVELENGTHS[wl].label : phase || 'Moon',
      detail: kind === 'moon' ? formatIllumination(photo?.phase) : photo?.source || null,
      updated: formatDiskTime(photo?.lastModified || photo?.timestamp) || 'Updated --',
      imageHref: toDataUri(photo?.buffer, photo?.contentType),
    });
    const png = await svgToPng(svg, theme.background);
    diskCache.set(key, { png, timestamp: Date.now() });
    while (diskCache.size > 24) diskCache.delete(diskCache.keys().next().value);
    return png;
  })().finally(() => diskInflight.delete(key));
  diskInflight.set(key, job);
  return job;
}

/** Tests only: change the per-minute render budget. */
function setRenderBudget(n) {
  renderBudgetPerMin = n;
}

function clearBadgeCache() {
  pngCache.clear();
  inflight.clear();
  diskCache.clear();
  diskInflight.clear();
  renderWindowStart = 0;
  rendersInWindow = 0;
}

module.exports = {
  FIELD_IDS,
  DEFAULT_FIELDS,
  FIELD_META,
  VARIANT_META,
  parseBadgeFields,
  parseBadgeVariant,
  buildBadgeModel,
  buildSolarBadgeSvg,
  renderSolarBadgePng,
  renderDiskBadge,
  clearBadgeCache,
  setRenderBudget,
  svgToPng,
};

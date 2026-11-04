/**
 * Message of the day — a one-line notice from the server admin that every
 * browser shows as a dismissible banner.
 *
 *   GET  /api/motd         → { text, id, links, source, updatedAt }
 *   POST /api/admin/motd   { text, links? }   (API_WRITE_KEY + write limiter)
 *                           text '' clears the admin message
 *
 * Two sources, admin wins: the MOTD environment variable (static, set at
 * deploy time) and an admin-set message persisted to motd.json (same
 * writable-path waterfall as the push store). `id` is a short hash of the
 * text so a changed message re-appears for browsers that dismissed the
 * previous one. `links` are the URLs found in the text plus any explicit
 * { label, url } pairs the admin supplied (http/https only, max 5).
 */

const fs = require('fs');
const path = require('path');

const MAX_TEXT = 1000;
const MAX_LINKS = 5;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** Stable short id for a message text (djb2, base36). */
function motdId(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function safeUrl(u) {
  try {
    const parsed = new URL(String(u));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** URLs in the text + validated explicit links, de-duplicated, capped. */
function buildLinks(text, explicit) {
  const out = [];
  const seen = new Set();
  const push = (label, url) => {
    const href = safeUrl(url);
    if (!href || seen.has(href) || out.length >= MAX_LINKS) return;
    seen.add(href);
    out.push({ label: String(label || href).slice(0, 80), url: href });
  };
  if (Array.isArray(explicit)) {
    for (const l of explicit) {
      if (l && typeof l === 'object') push(l.label, l.url);
      else if (typeof l === 'string') push(l, l);
    }
  }
  for (const m of String(text || '').match(URL_RE) || [])
    push(m.replace(/[.,;:!?)]+$/, ''), m.replace(/[.,;:!?)]+$/, ''));
  return out;
}

/** Sanitise free text: trim, collapse control characters, cap length. */
function cleanText(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_TEXT);
}

module.exports = function (app, ctx) {
  const { ROOT_DIR, logInfo, logWarn, writeLimiter, requireWriteAuth } = ctx;

  const MOTD_FILE = (() => {
    const candidates = [
      process.env.MOTD_FILE,
      '/data/motd.json',
      ROOT_DIR ? path.join(ROOT_DIR, 'data', 'motd.json') : null,
      '/tmp/openhamclock-motd.json',
    ];
    for (const p of candidates) {
      if (!p) continue;
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        return p;
      } catch {
        continue;
      }
    }
    return '/tmp/openhamclock-motd.json';
  })();

  // Admin-set message (null = none; env applies)
  let admin = null;
  try {
    if (fs.existsSync(MOTD_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MOTD_FILE, 'utf8'));
      if (raw && typeof raw.text === 'string' && raw.text.trim()) {
        admin = {
          text: cleanText(raw.text),
          links: Array.isArray(raw.links) ? raw.links : [],
          updatedAt: raw.updatedAt || null,
        };
      }
    }
  } catch (e) {
    logWarn?.(`[MOTD] Could not read ${MOTD_FILE}: ${e.message}`);
  }

  const envText = cleanText(process.env.MOTD || '');

  function current() {
    if (admin) {
      return {
        text: admin.text,
        id: motdId(admin.text),
        links: buildLinks(admin.text, admin.links),
        source: 'admin',
        updatedAt: admin.updatedAt,
      };
    }
    if (envText) {
      return { text: envText, id: motdId(envText), links: buildLinks(envText, []), source: 'env', updatedAt: null };
    }
    return { text: '', id: null, links: [], source: null, updatedAt: null };
  }

  app.get('/api/motd', (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(current());
  });

  app.post('/api/admin/motd', writeLimiter, requireWriteAuth, (req, res) => {
    const text = cleanText(req.body?.text);
    const links = Array.isArray(req.body?.links) ? req.body.links.slice(0, MAX_LINKS) : [];
    if (!text) {
      admin = null;
      try {
        if (fs.existsSync(MOTD_FILE)) fs.unlinkSync(MOTD_FILE);
      } catch {}
      logInfo?.('[MOTD] Admin message cleared');
      return res.json({ ok: true, ...current() });
    }
    admin = { text, links: buildLinks(text, links), updatedAt: new Date().toISOString() };
    try {
      fs.writeFileSync(MOTD_FILE, JSON.stringify(admin, null, 2));
    } catch (e) {
      logWarn?.(`[MOTD] Could not persist to ${MOTD_FILE}: ${e.message}`);
    }
    logInfo?.(`[MOTD] Admin message set (${text.length} chars)`);
    res.json({ ok: true, ...current() });
  });
};

module.exports.motdId = motdId;
module.exports.buildLinks = buildLinks;
module.exports.cleanText = cleanText;

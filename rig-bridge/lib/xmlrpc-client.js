'use strict';
/**
 * xmlrpc-client.js — a tiny XML-RPC client (encoder, decoder, HTTP transport)
 *
 * Just enough of the XML-RPC spec to talk to fldigi (and anything else that
 * speaks the same dialect): the scalar types, <array>, <struct>, <base64>,
 * <nil>, and <fault>. No external dependency — the whole thing is a few
 * regular expressions over the small responses these programs produce.
 *
 * Pure encode/decode functions are exported separately from the transport so
 * they can be unit-tested, and the transport accepts an injectable `request`
 * (anything shaped like http.request) so plugins can be tested without a
 * socket.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ── Encoding ────────────────────────────────────────────────────────────────

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Encode a JS value as an XML-RPC <value>. Integers → <int>, other numbers →
 * <double>, booleans → <boolean>, Buffers → <base64>, arrays → <array>,
 * plain objects → <struct>, null/undefined → <nil/>, everything else → <string>.
 */
function encodeValue(v) {
  if (v === null || v === undefined) return '<value><nil/></value>';
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 2 ** 31) return `<value><int>${v}</int></value>`;
    return `<value><double>${v}</double></value>`;
  }
  if (Buffer.isBuffer(v)) return `<value><base64>${v.toString('base64')}</base64></value>`;
  if (Array.isArray(v)) return `<value><array><data>${v.map(encodeValue).join('')}</data></array></value>`;
  if (typeof v === 'object') {
    const members = Object.entries(v)
      .map(([k, val]) => `<member><name>${escapeXml(k)}</name>${encodeValue(val)}</member>`)
      .join('');
    return `<value><struct>${members}</struct></value>`;
  }
  return `<value><string>${escapeXml(v)}</string></value>`;
}

/** Build a complete <methodCall> document. */
function encodeCall(method, params = []) {
  const ps = params.map((p) => `<param>${encodeValue(p)}</param>`).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${escapeXml(method)}</methodName><params>${ps}</params></methodCall>`;
}

// ── Decoding ────────────────────────────────────────────────────────────────

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Minimal XML tokenizer: returns the text between the opening <tag ...> and
 * its matching </tag>, honouring nesting, or null when the tag is absent.
 */
function findTag(xml, tag, from = 0) {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'g');
  open.lastIndex = from;
  const m = open.exec(xml);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  const re = new RegExp(`<(/?)${tag}(\\s[^>]*)?/?>`, 'g');
  re.lastIndex = start;
  let t;
  while ((t = re.exec(xml))) {
    if (t[0].endsWith('/>')) continue;
    depth += t[1] === '/' ? -1 : 1;
    if (depth === 0) return { inner: xml.slice(start, t.index), end: t.index + t[0].length, start: m.index };
  }
  return null;
}

/** Decode the contents of one <value>…</value> element. */
function decodeValueInner(inner) {
  const s = inner.trim();
  if (s === '') return '';
  let m;
  if ((m = s.match(/^<(i4|int)>\s*(-?\d+)\s*<\/\1>$/))) return parseInt(m[2], 10);
  if ((m = s.match(/^<double>\s*(-?[\d.eE+-]+)\s*<\/double>$/))) return parseFloat(m[1]);
  if ((m = s.match(/^<boolean>\s*([01]|true|false)\s*<\/boolean>$/i))) return m[1] === '1' || /true/i.test(m[1]);
  if ((m = s.match(/^<string>([\s\S]*)<\/string>$/))) return unescapeXml(m[1]);
  if ((m = s.match(/^<base64>([\s\S]*)<\/base64>$/))) return Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  if ((m = s.match(/^<dateTime\.iso8601>\s*([\s\S]*?)\s*<\/dateTime\.iso8601>$/))) return m[1];
  if (/^<nil\s*\/>$/.test(s)) return null;
  if (s.startsWith('<array')) {
    const data = findTag(s, 'data');
    const out = [];
    if (data) {
      let pos = 0;
      let v;
      while ((v = findTag(data.inner, 'value', pos))) {
        out.push(decodeValueInner(v.inner));
        pos = v.end;
      }
    }
    return out;
  }
  if (s.startsWith('<struct')) {
    const out = {};
    let pos = 0;
    let member;
    while ((member = findTag(s, 'member', pos))) {
      const name = findTag(member.inner, 'name');
      const value = findTag(member.inner, 'value');
      if (name) out[unescapeXml(name.inner.trim())] = value ? decodeValueInner(value.inner) : null;
      pos = member.end;
    }
    return out;
  }
  // Untyped <value>text</value> is a string per the spec.
  return unescapeXml(s);
}

/**
 * Decode a <methodResponse>. Returns the single result value, or throws an
 * Error (with .faultCode / .faultString) for a <fault> response.
 */
function decodeResponse(xml) {
  if (typeof xml !== 'string' || !xml.includes('<methodResponse')) {
    throw new Error('Not an XML-RPC response');
  }
  const fault = findTag(xml, 'fault');
  if (fault) {
    const v = findTag(fault.inner, 'value');
    const f = v ? decodeValueInner(v.inner) : {};
    const err = new Error(`XML-RPC fault ${f.faultCode ?? ''}: ${f.faultString ?? 'unknown'}`.trim());
    err.faultCode = f.faultCode;
    err.faultString = f.faultString;
    throw err;
  }
  const param = findTag(xml, 'param');
  if (!param) return null;
  const v = findTag(param.inner, 'value');
  return v ? decodeValueInner(v.inner) : null;
}

// ── Transport ───────────────────────────────────────────────────────────────

/**
 * Create a client bound to one endpoint.
 * @param {string} url            e.g. 'http://127.0.0.1:7362'
 * @param {object} [opts]
 * @param {number} [opts.timeout] per-call timeout in ms (default 3000)
 * @param {function} [opts.request] injectable http.request-compatible function
 * @param {string} [opts.label]   prefix for transport errors (default 'XML-RPC'),
 *                                e.g. 'fldigi XML-RPC main.get_frequency: read ECONNRESET'
 * @returns {{ call(method, params): Promise<any>, url: string }}
 */
function createXmlRpcClient(url, opts = {}) {
  const target = new URL(url);
  const timeout = opts.timeout ?? 3000;
  const mod = target.protocol === 'https:' ? https : http;
  const request = opts.request || mod.request.bind(mod);
  const label = opts.label || 'XML-RPC';

  // Transport errors name the method that failed; .code (ECONNRESET …) is kept.
  const transportError = (method, e) => {
    const err = new Error(`${label} ${method}: ${e?.message || e}`);
    if (e?.code) err.code = e.code;
    return err;
  };

  function call(method, params = []) {
    return new Promise((resolve, reject) => {
      const body = encodeCall(method, params);
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        fn(arg);
      };
      const req = request(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: target.pathname === '/' ? '/RPC2' : target.pathname,
          method: 'POST',
          // No pooled keep-alive socket: fldigi's XML-RPC server closes each
          // connection, and reusing one gave every other call ECONNRESET on
          // Windows / Node 24 even with "Connection: close" (#1250).
          agent: false,
          headers: {
            'Content-Type': 'text/xml',
            'Content-Length': Buffer.byteLength(body),
            Connection: 'close',
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return done(reject, transportError(method, `HTTP ${res.statusCode}`));
            }
            try {
              done(resolve, decodeResponse(text));
            } catch (e) {
              done(reject, e);
            }
          });
          res.on('error', (e) => done(reject, transportError(method, e)));
        },
      );
      req.on('error', (e) => done(reject, transportError(method, e)));
      req.setTimeout(timeout, () => {
        req.destroy(new Error(`timeout after ${timeout}ms`));
      });
      req.write(body);
      req.end();
    });
  }

  return { call, url: target.href };
}

module.exports = { encodeValue, encodeCall, decodeResponse, decodeValueInner, findTag, createXmlRpcClient };

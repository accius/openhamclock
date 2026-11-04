'use strict';
/**
 * lanHttps.js — optional HTTPS listener for LAN installs (HTTPS_PORT).
 *
 * Browsers only allow microphone / sound-card capture (the Decoder panel)
 * and some other APIs on a "secure context": HTTPS, or http://localhost. A
 * Raspberry Pi dashboard opened from another computer as
 * http://192.168.x.x:3000 is neither. Setting HTTPS_PORT=3443 makes the same
 * app also answer on https://<pi>:3443 with a self-signed certificate (accept
 * the browser warning once), or with your own cert via HTTPS_CERT/HTTPS_KEY.
 *
 * The self-signed certificate is generated once with the system `openssl`
 * (present on Raspberry Pi OS, Debian/Ubuntu, macOS and the Docker image),
 * stored under HTTPS_CERT_DIR (default <data>/lan-https), and lists
 * localhost, this host's name (and .local) and its LAN IPv4 addresses as
 * subject alternative names. No new npm dependencies.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

/** IPv4 addresses of this machine's non-internal interfaces. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const a of list || []) {
      if (a && !a.internal && (a.family === 'IPv4' || a.family === 4)) out.push(a.address);
    }
  }
  return [...new Set(out)];
}

/** subjectAltName list for the self-signed certificate. */
function subjectAltNames(hostname = os.hostname(), ips = lanAddresses()) {
  const names = new Set(['DNS:localhost', 'IP:127.0.0.1']);
  const h = String(hostname || '')
    .trim()
    .replace(/\.local$/i, '');
  if (/^[A-Za-z0-9-]{1,63}$/.test(h)) {
    names.add(`DNS:${h}`);
    names.add(`DNS:${h}.local`);
  }
  for (const ip of ips) if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) names.add(`IP:${ip}`);
  return [...names].join(',');
}

/**
 * Make sure a self-signed cert/key pair exists in `dir`; returns their paths.
 * Regenerated when missing (delete the folder after the Pi's IP changes).
 */
function ensureSelfSignedCert(dir, { hostname, ips, openssl = 'openssl' } = {}) {
  const certPath = path.join(dir, 'cert.pem');
  const keyPath = path.join(dir, 'key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return { certPath, keyPath, created: false };
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '825',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-subj',
      '/CN=OpenHamClock (LAN)',
      '-addext',
      `subjectAltName=${subjectAltNames(hostname, ips)}`,
    ],
    { stdio: 'ignore', timeout: 30000 },
  );
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch (e) {
    /* not fatal on filesystems without modes */
  }
  return { certPath, keyPath, created: true };
}

/**
 * Start the HTTPS listener when HTTPS_PORT is set. Never throws: a failure is
 * logged and the plain-HTTP server keeps running.
 * @returns {Promise<{ server: https.Server, port: number, certPath: string } | null>}
 */
async function startLanHttps(app, { env = process.env, dataDir, host = '0.0.0.0', log = console.log } = {}) {
  const port = Number(env.HTTPS_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || env.HTTPS_PORT === '' || env.HTTPS_PORT == null) {
    return null;
  }
  try {
    let certPath = env.HTTPS_CERT;
    let keyPath = env.HTTPS_KEY;
    if (!certPath || !keyPath) {
      const dir = env.HTTPS_CERT_DIR || path.join(dataDir || process.cwd(), 'lan-https');
      const r = ensureSelfSignedCert(dir);
      certPath = r.certPath;
      keyPath = r.keyPath;
      if (r.created) log(`[HTTPS] Generated a self-signed certificate in ${dir}`);
    }
    const server = https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    const actual = server.address().port;
    // Bound to one address (HOST=localhost etc.): that is the only way in.
    const allInterfaces = host === '0.0.0.0' || host === '::';
    const where = (allInterfaces ? lanAddresses() : [host]).map((ip) => `https://${ip}:${actual}`).join('  ');
    log(
      `[HTTPS] Also serving on port ${actual} (${where || `https://localhost:${actual}`}) — accept the certificate once`,
    );
    return { server, port: actual, certPath };
  } catch (err) {
    log(
      `[HTTPS] Could not start the HTTPS listener on ${env.HTTPS_PORT}: ${err.message}` +
        (err.code === 'ENOENT' ? ' (is openssl installed? or set HTTPS_CERT/HTTPS_KEY)' : ''),
    );
    return null;
  }
}

module.exports = { startLanHttps, ensureSelfSignedCert, subjectAltNames, lanAddresses };

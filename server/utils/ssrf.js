'use strict';
/**
 * SSRF helpers — shared between route modules that make outbound HTTP/TCP connections
 * based on caller-supplied hostnames (DX cluster, rig-bridge status, etc.).
 *
 * validateCustomHost resolves a hostname to its first IPv4 address and returns it so
 * callers connect to the resolved IP directly, preventing DNS-rebinding TOCTOU attacks
 * where the DNS record changes between validation and the actual connection.
 */

const dns = require('dns');

function isPrivateIP(ip) {
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
  const normalized = ip.replace(/^::ffff:/i, '');

  const parts = normalized.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => n >= 0 && n <= 255)) {
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local
    if (parts[0] === 0) return true; // 0.0.0.0/8
    if (parts[0] >= 224) return true; // multicast + reserved
  }

  const lower = normalized.toLowerCase();
  if (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fe80:') ||
    lower.startsWith('fc00:') ||
    lower.startsWith('fd00:') ||
    lower.startsWith('ff00:') ||
    lower.startsWith('::ffff:')
  ) {
    return true;
  }
  return false;
}

/**
 * Validate a caller-supplied hostname for outbound connections.
 *
 * Localhost and bare IP literals (including RFC-1918 ranges) are always allowed —
 * OHC is self-hosted software where connecting to local services is the norm.
 * SSRF is a concern only for arbitrary DNS names that could resolve to internal infra
 * on multi-user cloud deployments.
 *
 * Returns { ok: true, resolvedIP } or { ok: false, reason }.
 */
async function validateCustomHost(host) {
  if (/^localhost$/i.test(host)) return { ok: true, resolvedIP: '127.0.0.1' };

  // Bare IPv4 literal — allow directly without DNS lookup
  const ipParts = host.split('.').map(Number);
  if (ipParts.length === 4 && ipParts.every((n) => n >= 0 && n <= 255)) {
    return { ok: true, resolvedIP: host };
  }

  // Resolve hostname → IPv4. Try resolve4 first (pure DNS), fall back to OS resolver
  // which also handles /etc/hosts and search domains.
  let addresses;
  try {
    addresses = await dns.promises.resolve4(host);
  } catch {
    try {
      const result = await dns.promises.lookup(host, { family: 4 });
      if (result?.address) addresses = [result.address];
    } catch {
      return { ok: false, reason: 'Host could not be resolved (IPv4 required)' };
    }
  }

  if (!addresses || addresses.length === 0) {
    return { ok: false, reason: 'Host did not resolve to any IPv4 address' };
  }

  return { ok: true, resolvedIP: addresses[0] };
}

module.exports = { isPrivateIP, validateCustomHost };

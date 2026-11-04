/**
 * ESM mirror of the service-worker caching policy.
 *
 * The canonical implementation lives in public/sw-policy.js (a classic
 * script the worker loads via importScripts). Importing it here runs its
 * side effect — attaching OHC_SW_POLICY to globalThis — so the exact same
 * code the service worker executes is what vitest exercises. Do not
 * reimplement the logic here; edit public/sw-policy.js.
 */
import '../../public/sw-policy.js';

const policy = globalThis.OHC_SW_POLICY;

export const {
  API_CACHE_MAX_ENTRIES,
  OFFLINE_PACK_CACHE,
  OFFLINE_TILE_HOSTS,
  PACK_TILE_NETWORK_TIMEOUT_MS,
  isPersistentCacheName,
  isOfflineTileHost,
  MAX_OVERZOOM_LEVELS,
  tileUrlPrefix,
  tileUrlPrefixes,
  isLocalNetworkUrl,
  parseTileUrl,
  subdomainFor,
  buildTileUrl,
  overzoomSource,
  isCacheableVendorResponse,
  normalizeVersion,
  cacheNames,
  staleCacheNames,
  isStreamingApiPath,
  classifyRequest,
  isCacheableApiResponse,
  keysToPrune,
} = policy;

export default policy;

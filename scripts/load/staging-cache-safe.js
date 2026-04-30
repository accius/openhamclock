// Load test for OHC Staging — cache-safe API endpoints only.
//
// Hammers the four endpoints with first-class server-side caches (so 1500 RPS
// won't fan out to third parties): TLE, DX news, DX peditions, Winlink gateways.
//
// Usage:
//   k6 run scripts/load/staging-cache-safe.js                       # default ramp, default target
//   TARGET=https://stagingbranch26.openhamclock.com k6 run …        # override target
//   PROFILE=smoke   k6 run …                                         # 50 RPS / 30s — sanity check
//   PROFILE=ramp    k6 run …                                         # 50→500→1500 ramp (default)
//   PROFILE=soak    k6 run …                                         # 200 RPS / 10m
//   BUST=1          k6 run …                                         # add cache-busting query + headers
//
// Cache-bust note: BUST=1 adds a unique `?_=<rand>` query string and
// `Cache-Control: no-cache` to every request. Use this only when you want to
// measure ORIGIN behaviour (Cloudflare cache key includes query string by
// default, so a varying suffix forces miss). Without BUST you're measuring
// the edge — which is closer to real-user steady state.
//
// Environment caveats:
// - Running from one box means one IP. Cloudflare may rate-limit at high RPS.
//   If you see sudden 1015/429 spikes, that's the WAF, not the origin.
// - Open Railway dashboard before the ramp to watch CPU/memory.

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.TARGET || 'https://stagingbranch26.openhamclock.com';
const BUST = __ENV.BUST === '1';
const PROFILE = __ENV.PROFILE || 'ramp';

const trends = {
  tle: new Trend('endpoint_tle_duration', true),
  dxnews: new Trend('endpoint_dxnews_duration', true),
  winlink: new Trend('endpoint_winlink_duration', true),
  dxped: new Trend('endpoint_dxped_duration', true),
};
const errorRate = new Rate('errors');
const status5xx = new Counter('status_5xx');
const status4xx = new Counter('status_4xx');

const endpoints = [
  { name: 'tle', path: '/api/satellites/tle' },
  { name: 'dxnews', path: '/api/dxnews' },
  { name: 'winlink', path: '/api/winlink/gateways' },
  { name: 'dxped', path: '/api/dxpeditions' },
];

const profiles = {
  smoke: {
    executor: 'constant-arrival-rate',
    rate: 50,
    timeUnit: '1s',
    duration: '30s',
    preAllocatedVUs: 50,
    maxVUs: 200,
  },
  ramp: {
    // Capped at 500 RPS — single residential box bandwidth ceiling (~125 MB/s)
    // and 500 RPS already represents ~10× steady-state for 2000 concurrent users.
    // For higher RPS, run from k6 Cloud or EC2.
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 1000,
    stages: [
      { target: 50, duration: '30s' },
      { target: 50, duration: '1m' },
      { target: 200, duration: '1m' },
      { target: 200, duration: '2m' },
      { target: 500, duration: '1m' },
      { target: 500, duration: '2m' },
      { target: 0, duration: '30s' },
    ],
  },
  soak: {
    executor: 'constant-arrival-rate',
    rate: 200,
    timeUnit: '1s',
    duration: '10m',
    preAllocatedVUs: 200,
    maxVUs: 1000,
  },
};

export const options = {
  discardResponseBodies: true,
  scenarios: { run: profiles[PROFILE] },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    errors: ['rate<0.02'],
  },
};

export function setup() {
  console.log(`[load] target=${BASE} profile=${PROFILE} bust=${BUST}`);
  for (const ep of endpoints) {
    const r = http.get(`${BASE}${ep.path}`);
    console.log(`[load] preflight ${ep.path} → ${r.status} (${r.timings.duration | 0}ms)`);
  }
}

export default function () {
  const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
  const url = BUST ? `${BASE}${ep.path}?_=${Date.now()}_${Math.random()}` : `${BASE}${ep.path}`;
  const headers = BUST ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } : {};

  const res = http.get(url, { tags: { endpoint: ep.name }, headers });

  trends[ep.name].add(res.timings.duration);
  const ok = check(res, { 'status 200': (r) => r.status === 200 });
  errorRate.add(!ok);
  if (res.status >= 500) status5xx.add(1);
  else if (res.status >= 400) status4xx.add(1);
}

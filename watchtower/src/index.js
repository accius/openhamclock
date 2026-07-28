/**
 * Watchtower — Cloudflare Worker that monitors openhamclock infrastructure
 * and posts state-change alerts to a Discord webhook.
 *
 * Why CF Workers instead of another Railway service: Railway has had outages
 * in the past, and a watchdog that goes down when the thing it's watching
 * goes down is useless. CF runs the prober outside Railway's blast radius.
 *
 * Probes (every 1 min):
 *   - openhamclock.com /api/health  (also reads subsystems: fletcher,
 *                                    ohc-cluster, rbn, satellites, propagation)
 *   - proppy-production.up.railway.app /api/version
 *   - spider-production.up.railway.app /health
 *
 * State stored in KV (WATCHTOWER_STATE) per (service, subsystem). On a
 * status flip, posts a Discord embed and pings the configured role IDs on
 * any 'down' transition. Daily heartbeat at 09:00 UTC so the channel knows
 * the watchtower itself is alive.
 *
 * Env vars (set via wrangler secret / wrangler.toml):
 *   - DISCORD_WEBHOOK_URL   (secret, required)
 *   - DISCORD_PING_ROLES    (comma-separated role IDs, e.g. "A,B")
 *   - PROBE_TIMEOUT_MS      (default 8000)
 */

// Railway project + service + environment IDs. The Worker fetches logs
// from these on `down` flips so the Discord alert carries the last ~40
// lines of context. Tokens are env-scoped (RAILWAY_TOKEN_STAGING /
// RAILWAY_TOKEN_PRODUCTION) so the Worker only has access to the env
// it's actually probing.
const RAILWAY_PROJECT_ID = 'af7b55dd-fcf9-4ae3-bca2-51d2e5b31fac';
const RAILWAY_SERVICE_IDS = {
  openhamclock: '3570cbe7-1631-4341-808a-f08cbe6ecb9b',
  proppy: '0b08af50-4f0e-42cc-b6df-707815d51322',
  spider: 'ac00d18b-b85d-4892-8f4e-f3cc91acc112',
};
const RAILWAY_ENV_IDS = {
  production: '007069ba-155a-4927-8670-ac2ab9161bb0',
  staging: 'effc7eee-99b8-4af2-9679-2868a1d73f05',
};

const SERVICES = [
  {
    name: 'openhamclock',
    // Probe PRODUCTION via the Railway-direct URL — openhamclock.com sits
    // behind CF Bot Fight, which 429s worker-to-worker fetches.
    url: 'https://openhamclock.up.railway.app/api/health',
    parse: parseOpenHamClock, // returns { aggregate, subsystems: {fletcher, rbn, ...} }
    railwayEnv: 'production',
  },
  {
    name: 'proppy',
    url: 'https://proppy-production.up.railway.app/api/version',
    parse: parseSimple200,
    railwayEnv: 'production',
  },
  {
    name: 'spider',
    url: 'https://spider-production-1ec7.up.railway.app/health',
    parse: parseSimple200,
    railwayEnv: 'production',
  },
  // Direct probes for fletcher + the OHC Cluster node: the /api/health
  // subsystem checks above cover the private-network path the app uses,
  // but these keep alerting even when the main app itself is down.
  {
    name: 'fletcher',
    url: 'https://fletcher-production.up.railway.app/health',
    parse: parseSimple200,
    railwayEnv: 'production',
  },
  {
    name: 'ohc-cluster',
    // NOTE: the domain's target port must be 3002 (the HTTP API) — telnet
    // (7300) is exposed separately via the Railway TCP proxy.
    url: 'https://ohc-cluster-production.up.railway.app/health',
    parse: parseSimple200,
    railwayEnv: 'production',
  },
];

const STATUS_COLORS = {
  ok: 0x57f287, // green
  degraded: 0xfee75c, // yellow
  down: 0xed4245, // red
  unknown: 0x99aab5, // gray
};

const SEVERITY = { ok: 0, unknown: 0, degraded: 1, down: 2 };

// ── HTTP probes ────────────────────────────────────────────────────────────

async function probe(service, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Explicit User-Agent + Accept so CF and Railway don't treat the probe
    // as suspect bot traffic. Without these, openhamclock.com returns 429
    // (CF security tier) and the Railway-direct spider URL returns 404.
    const res = await fetch(service.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'OpenHamClock-Watchtower/1.0 (+https://github.com/accius/openhamclock)',
        Accept: 'application/json, */*',
      },
    });
    if (!res.ok) {
      return [{ subsystem: 'aggregate', status: 'down', detail: `HTTP ${res.status}` }];
    }
    const body = await res.text();
    return service.parse(body, res);
  } catch (err) {
    return [{ subsystem: 'aggregate', status: 'down', detail: `probe failed: ${err.message || err}` }];
  } finally {
    clearTimeout(timer);
  }
}

function parseOpenHamClock(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return [{ subsystem: 'aggregate', status: 'down', detail: 'invalid JSON response' }];
  }

  const out = [];
  out.push({
    subsystem: 'aggregate',
    status: data.subsystemStatus || 'unknown',
    detail: `version ${data.version} · uptime ${data.uptimeFormatted || ''}`.trim(),
  });

  const subs = data.subsystems || {};
  for (const key of ['fletcher', 'ohc-cluster', 'rbn', 'satellites', 'propagation']) {
    const s = subs[key];
    if (!s) continue;
    out.push({
      subsystem: key,
      status: s.status || 'unknown',
      detail: s.detail || null,
    });
  }
  return out;
}

function parseSimple200() {
  return [{ subsystem: 'aggregate', status: 'ok', detail: '2xx response' }];
}

// ── State + transitions ────────────────────────────────────────────────────

// Status must hold for this long before a flip is confirmed and posted.
// Tuned wider than a typical Railway deploy window (~30-60s) so deploy
// churn doesn't generate spurious alerts. Real outages of 2+ min still
// alert, only delayed by this much.
const DEBOUNCE_MS = 90 * 1000;

async function readState(env, service, subsystem) {
  const key = `${service}.${subsystem}`;
  const raw = await env.WATCHTOWER_STATE.get(key);
  if (!raw) return { confirmed: null, pending: null };
  const parsed = JSON.parse(raw);
  // Migrate old flat format ({status, detail, since}) to new wrapper
  // ({confirmed, pending}). Old entries are treated as already-confirmed.
  if (parsed.confirmed === undefined && parsed.status !== undefined) {
    return { confirmed: parsed, pending: null };
  }
  return { confirmed: parsed.confirmed || null, pending: parsed.pending || null };
}

async function writeState(env, service, subsystem, confirmed, pending) {
  const key = `${service}.${subsystem}`;
  await env.WATCHTOWER_STATE.put(key, JSON.stringify({ confirmed, pending }));
}

function describeFlip(prev, curr) {
  const prevSev = SEVERITY[prev.status] ?? 0;
  const currSev = SEVERITY[curr.status] ?? 0;
  if (currSev > prevSev) return 'declined';
  if (currSev < prevSev) return 'recovered';
  return 'changed';
}

// ── Railway logs ───────────────────────────────────────────────────────────
// On `down` flips we attach the last ~40 log lines from Railway's GraphQL
// API to the Discord embed so on-call has context without having to log
// in to Railway. Tokens are env-scoped so the Worker can only see logs for
// the environment it's actually monitoring.

const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';

async function railwayGraphQL(token, query, variables) {
  try {
    // Railway project tokens use the Project-Access-Token header, not
    // Authorization: Bearer (which is only for personal account tokens).
    const res = await fetch(RAILWAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Project-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return { errors: [`HTTP ${res.status}`] };
    return res.json();
  } catch (err) {
    return { errors: [err.message || String(err)] };
  }
}

async function fetchRailwayLogs(env, serviceName, railwayEnv, limit = 40) {
  const tokenKey = railwayEnv === 'staging' ? 'RAILWAY_TOKEN_STAGING' : 'RAILWAY_TOKEN_PRODUCTION';
  const token = env[tokenKey];
  const serviceId = RAILWAY_SERVICE_IDS[serviceName];
  const environmentId = RAILWAY_ENV_IDS[railwayEnv];
  if (!token || !serviceId || !environmentId) return null;

  // Step 1: find the latest deployment for this service+env.
  const deplResp = await railwayGraphQL(
    token,
    `query Latest($projectId: String!, $environmentId: String!, $serviceId: String!) {
       deployments(input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId }, first: 1) {
         edges { node { id } }
       }
     }`,
    { projectId: RAILWAY_PROJECT_ID, environmentId, serviceId },
  );
  const deploymentId = deplResp?.data?.deployments?.edges?.[0]?.node?.id;
  if (!deploymentId) {
    return { error: deplResp?.errors?.[0]?.message || deplResp?.errors?.[0] || 'no deployment found' };
  }

  // Step 2: fetch logs for that deployment.
  const logsResp = await railwayGraphQL(
    token,
    `query Logs($deploymentId: String!, $limit: Int!) {
       deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
         message
         timestamp
         severity
       }
     }`,
    { deploymentId, limit },
  );
  const lines = logsResp?.data?.deploymentLogs;
  if (!Array.isArray(lines)) {
    return { error: logsResp?.errors?.[0]?.message || logsResp?.errors?.[0] || 'no logs returned', deploymentId };
  }
  return { lines, deploymentId };
}

function railwayDashboardUrl(serviceName, railwayEnv) {
  const serviceId = RAILWAY_SERVICE_IDS[serviceName];
  const environmentId = RAILWAY_ENV_IDS[railwayEnv];
  if (!serviceId || !environmentId) return null;
  return `https://railway.com/project/${RAILWAY_PROJECT_ID}/service/${serviceId}?environmentId=${environmentId}`;
}

function formatLogTail(result) {
  if (!result) return null; // no token configured
  if (result.error) return `_Could not fetch logs: ${result.error}_`;
  const lines = result.lines || [];
  if (lines.length === 0) return '_No log lines returned_';
  // Trim each line, drop control chars, fit inside Discord's 4000-char
  // description budget once wrapped in ```.
  const body = lines
    .map(
      (l) =>
        `${l.timestamp ? l.timestamp.slice(11, 19) + ' ' : ''}${(l.message || '').replace(/\[[0-9;]*m/g, '').trimEnd()}`,
    )
    .join('\n');
  const MAX = 3800;
  const truncated = body.length > MAX ? body.slice(body.length - MAX) : body;
  return '```\n' + truncated + '\n```';
}

// ── Discord post ───────────────────────────────────────────────────────────

async function postFlip(env, service, subsystem, prev, curr, serviceConfig) {
  if (!env.DISCORD_WEBHOOK_URL) return;

  const direction = describeFlip(prev, curr);
  const pingRoles = (env.DISCORD_PING_ROLES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const mentions = curr.status === 'down' && pingRoles.length ? pingRoles.map((id) => `<@&${id}>`).join(' ') + ' ' : '';

  const symbol = direction === 'recovered' ? '✅' : direction === 'declined' ? '🚨' : '🔄';
  const subsystemTitle = subsystem === 'aggregate' ? '' : ` · ${subsystem}`;

  const embed = {
    title: `${symbol} ${service}${subsystemTitle}: ${prev.status} → ${curr.status}`,
    color: STATUS_COLORS[curr.status] ?? STATUS_COLORS.unknown,
    timestamp: new Date().toISOString(),
    fields: [
      { name: 'Previous', value: `\`${prev.status}\``, inline: true },
      { name: 'Current', value: `\`${curr.status}\``, inline: true },
    ],
  };
  if (curr.detail) embed.fields.push({ name: 'Detail', value: curr.detail.slice(0, 1024) });
  if (prev.since) embed.fields.push({ name: 'Held since', value: prev.since, inline: true });

  // Attach Railway log tail + dashboard link on down transitions for the
  // *aggregate* probe only. Subsystem flips share the parent's service so
  // logs would just be the same parent logs duplicated; skip them.
  if (curr.status === 'down' && subsystem === 'aggregate' && serviceConfig?.railwayEnv) {
    const dashUrl = railwayDashboardUrl(service, serviceConfig.railwayEnv);
    if (dashUrl) embed.fields.push({ name: 'Railway', value: `[View logs ↗](${dashUrl})`, inline: true });
    const logResult = await fetchRailwayLogs(env, service, serviceConfig.railwayEnv);
    const tail = formatLogTail(logResult);
    if (tail) embed.description = tail;
  }

  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: mentions || undefined,
      embeds: [embed],
      allowed_mentions: { roles: pingRoles },
    }),
  });
}

async function postHeartbeat(env, snapshot) {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const lines = Object.entries(snapshot)
    .filter(([k]) => k.endsWith('.aggregate'))
    .map(([k, v]) => {
      const service = k.replace('.aggregate', '');
      const emoji = v.status === 'ok' ? '🟢' : v.status === 'degraded' ? '🟡' : v.status === 'down' ? '🔴' : '⚪';
      return `${emoji} **${service}**: ${v.status}`;
    });
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: '🗼 Watchtower daily heartbeat',
          description: lines.join('\n') || 'no services configured',
          color: 0x5865f2,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}

// ── Tick ───────────────────────────────────────────────────────────────────

async function tick(env, opts = {}) {
  const timeoutMs = parseInt(env.PROBE_TIMEOUT_MS, 10) || 8000;
  const flips = [];
  const snapshot = {};

  const nowIso = new Date().toISOString();

  for (const service of SERVICES) {
    const results = await probe(service, timeoutMs);
    for (const r of results) {
      snapshot[`${service.name}.${r.subsystem}`] = r;
      const { confirmed, pending } = await readState(env, service.name, r.subsystem);

      // First observation ever: seed confirmed, no alert.
      if (!confirmed) {
        await writeState(env, service.name, r.subsystem, { status: r.status, detail: r.detail, since: nowIso }, null);
        continue;
      }

      // Stable: current observation matches the confirmed status. Clear
      // any pending candidate that was being debounced (this is the deploy
      // recovery case — pending=down, recovered to ok within 90s).
      if (r.status === confirmed.status) {
        if (pending) await writeState(env, service.name, r.subsystem, confirmed, null);
        continue;
      }

      // Differs from confirmed: either continue an existing pending or
      // start a new one.
      if (pending && pending.status === r.status) {
        const heldMs = Date.now() - new Date(pending.firstSeen).getTime();
        if (heldMs >= DEBOUNCE_MS) {
          const newConfirmed = { status: r.status, detail: r.detail, since: pending.firstSeen };
          await writeState(env, service.name, r.subsystem, newConfirmed, null);
          // Silence flips that touch 'unknown' on either side. unknown
          // is "we don't know yet", not a state worth paging on.
          if (confirmed.status !== 'unknown' && r.status !== 'unknown') {
            flips.push({
              service: service.name,
              subsystem: r.subsystem,
              prev: confirmed,
              curr: r,
              serviceConfig: service,
            });
          }
        }
        // else: still inside the debounce window, no KV write, no alert.
      } else {
        // New (or different) pending candidate. One KV write to record it.
        await writeState(env, service.name, r.subsystem, confirmed, {
          status: r.status,
          detail: r.detail,
          firstSeen: nowIso,
        });
      }
    }
  }

  for (const f of flips) {
    await postFlip(env, f.service, f.subsystem, f.prev, f.curr, f.serviceConfig);
  }

  // Daily heartbeat at 09:00 UTC. We use a KV-stored ISO date so we only
  // post once per day even if the cron fires more than once at that hour.
  const now = new Date();
  if (opts.forceHeartbeat || (now.getUTCHours() === 9 && now.getUTCMinutes() < 5)) {
    const today = now.toISOString().slice(0, 10);
    const last = await env.WATCHTOWER_STATE.get('lastHeartbeatDay');
    if (last !== today || opts.forceHeartbeat) {
      await postHeartbeat(env, snapshot);
      await env.WATCHTOWER_STATE.put('lastHeartbeatDay', today);
    }
  }

  return { flips: flips.length, snapshot };
}

// ── Worker exports ─────────────────────────────────────────────────────────

export default {
  async scheduled(controller, env) {
    await tick(env);
  },

  // GET /tick  — manual run, returns flips + snapshot
  // GET /test-flip?service=X&subsystem=Y&status=down  — force a fake flip for testing
  // GET /heartbeat  — force heartbeat now
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/tick') {
      const result = await tick(env);
      return Response.json(result);
    }

    if (url.pathname === '/heartbeat') {
      const result = await tick(env, { forceHeartbeat: true });
      return Response.json({ ok: true, ...result });
    }

    if (url.pathname === '/test-flip') {
      const service = url.searchParams.get('service') || 'watchtower';
      const subsystem = url.searchParams.get('subsystem') || 'self-test';
      const status = url.searchParams.get('status') || 'down';
      const railwayEnv = url.searchParams.get('env') || null;
      const prev = { status: 'ok', detail: 'test', since: new Date().toISOString() };
      const curr = { status, detail: 'forced via /test-flip' };
      // If ?env=staging|production is passed and we recognize the service,
      // exercise the Railway log fetch path so the test embed carries logs
      // just like a real down flip would.
      const serviceConfig = railwayEnv && RAILWAY_SERVICE_IDS[service] ? { name: service, railwayEnv } : null;
      await postFlip(env, service, subsystem, prev, curr, serviceConfig);
      return Response.json({ ok: true, posted: { service, subsystem, prev, curr, serviceConfig } });
    }

    if (url.pathname === '/state') {
      // Dump current KV state as JSON for debugging.
      const list = await env.WATCHTOWER_STATE.list();
      const state = {};
      for (const k of list.keys) {
        const raw = (await env.WATCHTOWER_STATE.get(k.name)) || 'null';
        try {
          state[k.name] = JSON.parse(raw);
        } catch {
          // Some keys hold plain strings (e.g. lastHeartbeatDay).
          state[k.name] = raw;
        }
      }
      return Response.json(state);
    }

    return new Response(
      'watchtower\n\nGET /tick — run one probe cycle now\nGET /heartbeat — post the heartbeat now\nGET /state — dump KV state\nGET /test-flip?status=down — force a Discord post\n',
      { headers: { 'Content-Type': 'text/plain' } },
    );
  },
};

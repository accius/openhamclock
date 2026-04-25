# Phase 1: Weather load time — Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Reduce client-side time-to-first-weather for DE and DX panels and the callsign hover overlay. Target: 1-3 seconds end-to-end after the trigger.

Architecture is already correct and **not changing**: each user's browser fetches direct from Open-Meteo (verified — production bundle contains literal `api.open-meteo.com` URLs; no service worker, no fetch interceptor, no server-side proxying). This phase is purely about client-side timing and rate-limit recovery.

**In scope:** debounce timing in `src/hooks/useWeather.js`, retry/backoff in same file, error UI affordances, initial-mount fetch behavior, callsign hover handling.

**Out of scope:** switching weather providers, adding a server-side proxy, redesigning the weather panel layout, batching DE+DX into a single fetch, changing the periodic 2-hour poll interval.

</domain>

<decisions>
## Implementation Decisions

### Performance target

- **D-01:** Target time-to-first-weather is **1-3 seconds** end-to-end for every trigger (initial DE load, DX tune, callsign hover, periodic refresh).
- **D-02:** Slowness affects all triggers, not one specific path — fixes must touch each.
- **D-03:** No underlying load failures — weather always eventually loads. Pure latency problem, not a bug fix.

### DX tuning behavior

- **D-04:** Replace the current 30s debounce in `src/hooks/useWeather.js:258-261` with a **1-3s settle window**. "Settle" means inactivity, not a hard timer — rapid tuning still resets, but only briefly.
- **D-05:** During fetch, show **loading spinner / skeleton** (current behavior). No stale-while-revalidate — accept brief blank panel rather than mixing old/new state.

### Initial mount

- **D-06:** DE weather fetches **immediately on app mount** with no debounce. DE location is known at startup; no tuning is happening yet, so debounce serves no purpose.

### Callsign hover overlay

- **D-07:** **Keep the 550ms hover delay** in `src/components/CallsignWeatherOverlay.jsx:88`. It prevents stray-mouseover fetches without hurting perceived snappiness. Existing 10-min cache + in-flight dedup in `src/utils/callsignWeather.js` already handles repeat hovers well.

### Rate-limit handling

- **D-08:** **No OHC-side rate gating.** Each browser fetches direct to Open-Meteo, so each user is their own per-IP rate-limit bucket. OHC must not pre-throttle on shared assumptions that don't apply.
- **D-09:** **Tighten 429 backoff** from current `[15s, 30s, 60s, 120s, 300s]` (`src/hooks/useWeather.js:174`) to roughly `[5s, 15s, 30s]` — no 5-minute cap. A single 429 should never break the panel for the rest of the session.
- **D-10:** When 429s persist (e.g., 2+ in a row), **surface a clear error UI** that tells the user they're rate-limited and points them at the paid-tier escape hatch (Open-Meteo customer API key, already wired up via `localStorage.ohc_openmeteo_apikey` at `src/hooks/useWeather.js:182` and `src/utils/callsignWeather.js:20`). Make this affordance discoverable — currently it's invisible.

### DE + DX batching

- **D-11:** **Keep DE and DX as two independent fetches.** DE rarely changes, DX changes often — batching adds complexity (coupled failure handling, more conditional logic) for near-zero real-world benefit. Open-Meteo's per-IP limit is generous enough that the doubled request count doesn't matter.

### Claude's Discretion

- Exact UX of the rate-limited error nudge (tooltip? inline banner? settings link?)
- Exact backoff numbers within the spirit of D-09 (5/15/30 vs. 3/10/30 vs. similar)
- Whether to also tighten the 2-hour poll interval (currently `POLL_INTERVAL` at `src/hooks/useWeather.js:175`) — out of explicit scope but adjacent
- Whether to log timing metrics for observability (the `[Weather]` console logs at lines 229, 231 already exist — extend or replace?)
- How to detect "settle" — pure debounce reset vs. a more nuanced inactivity heuristic

</decisions>

<canonical_refs>

## Canonical References

**No external specs** — OHC has no PROJECT.md, REQUIREMENTS.md, or ADRs. Requirements are fully captured in the decisions above plus the code context below.

External API documentation referenced during discussion:

- Open-Meteo Forecast API: `https://open-meteo.com/en/docs` — endpoint, params, free vs. paid tier limits (600/min, 5k/hour, 10k/day per IP on free tier)
- Open-Meteo Customer API: `https://customer-api.open-meteo.com/v1/forecast` — paid tier endpoint already wired up in client code

</canonical_refs>

<code_context>

## Existing Code Insights

### Files in scope

- `src/hooks/useWeather.js` — main weather hook for DE and DX panels. Contains the 30s debounce (line 258), retry delays (line 174), 2h poll (line 175), direct Open-Meteo fetch (line 179), API-key escape hatch (line 182). Two independent calls in `App.jsx:325-328`.
- `src/utils/callsignWeather.js` — hover overlay fetch with 10-min cache + in-flight dedup. Already well-tuned; only the surrounding hover delay is in scope here.
- `src/components/CallsignWeatherOverlay.jsx:88` — 550ms hover debounce (staying as-is per D-07).

### Reusable assets

- **In-flight dedup pattern** (`callsignWeather.js:63-77`): `INFLIGHT` Map prevents duplicate concurrent requests. Could be ported to `useWeather.js` if the new tighter debounce introduces dedup needs.
- **TTL-cached Map** (`callsignWeather.js:6-15`): same.
- **API key escape hatch** (`localStorage.ohc_openmeteo_apikey`): already supported in both fetch paths. Phase 1 just needs to make it discoverable when 429s hit.
- **Console logging**: `[Weather]` prefix logs at `useWeather.js:229,231` give us real perceived-load timing without instrumentation work.

### Integration points

- `/api/weather` server stub (`server/routes/config-routes.js:226-228`) returns `{ _direct: true, _source: 'client-openmeteo' }` for legacy clients. **Do not remove** — pre-v15.1.7 clients still call it.
- `App.jsx:325-328` — where the two `useWeather` hooks are instantiated.

### Architecture verification (binding for downstream agents)

- Production bundle (`dist/assets/index-DzufINzv.js`) contains literal `api.open-meteo.com` URLs in 4 places — **proves direct browser-to-API**.
- No service worker registered. No global `fetch` interceptor. Vite dev proxy (`vite.config.mjs:9-14`) only catches `/api/*`, not third-party domains.
- Server-side `grep -r open-meteo server/` returns only the localStorage key reference. No proxy.

Downstream agents must not propose architectural changes — the architecture is correct and confirmed.

</code_context>

<specifics>
## Specific Ideas

- User explicitly questioned whether the architecture might be silently shared-IP through OHC; verification was performed and the direct-browser-to-Open-Meteo claim is confirmed.
- User's framing throughout: "let the user make the call, not OHC." This is the underlying principle for D-08 (no OHC-side rate gating) and D-10 (point users at the paid-tier escape hatch when they hit limits).

</specifics>

<deferred>
## Deferred Ideas

- **DX news multi-source ticker** — separate phase (Phase 2) already on the roadmap.
- **Tightening the 2-hour `POLL_INTERVAL`** — adjacent, but no user complaint about it. Don't touch unless it surfaces during execution.
- **Telemetry / metrics on weather load time** — would make this kind of "feels slow" question objectively answerable next time. Not requested. Add to backlog if it comes up again.
- **Cancel in-flight fetches on rapid DX tuning** — a tighter debounce reduces this naturally; only revisit if the planner sees concrete need.

</deferred>

---

_Phase: 01-weather-load-time_
_Context gathered: 2026-04-24_

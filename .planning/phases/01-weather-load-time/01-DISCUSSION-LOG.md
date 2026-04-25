# Phase 1: Weather load time — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 01-weather-load-time
**Areas discussed:** Trigger source, DX tuning behavior, Rate-limit risk, DE+DX batching

---

## Area 1: Trigger source

### Q1.1 — Which scenario(s) are you experiencing?

| Option | Description                                                          | Selected |
| ------ | -------------------------------------------------------------------- | -------- |
| a      | Open the app, DE weather doesn't appear for a long time              |          |
| b      | Click/tune to a new DX spot, DX weather panel sits empty 30+ seconds |          |
| c      | Hover a callsign on the map, weather overlay takes too long          |          |
| d      | Weather panel disappears or goes blank between updates               |          |
| e      | All of the above — generally laggy                                   | ✓        |

**User's choice:** e
**Notes:** Locked the scope — this is not one bad timer; the whole stack is slow. Fixes must touch every trigger.

### Q1.2 — What does "acceptable" feel like?

| Option | Description            | Selected |
| ------ | ---------------------- | -------- |
| a      | Instant (under 1s)     |          |
| b      | Fast (1-3s)            | ✓        |
| c      | Reasonable (3-5s)      |          |
| d      | Just way less than now |          |

**User's choice:** b
**Notes:** Sets the success bar at 1-3s.

### Q1.3 — Does weather eventually load, or do you have to refresh?

| Option | Description                             | Selected |
| ------ | --------------------------------------- | -------- |
| a      | Always loads eventually, just slow      | ✓        |
| b      | Sometimes never loads, refresh fixes it |          |
| c      | Both happen                             |          |

**User's choice:** a
**Notes:** No underlying load failure. Pure latency problem — no bug fix needed.

---

## Area 2: DX tuning behavior

### Q2.1 — What do you want during spot-hopping?

| Option | Description                                                    | Selected |
| ------ | -------------------------------------------------------------- | -------- |
| a      | Weather for each spot — every change triggers a fetch          |          |
| b      | Weather only for the spot I settle on, but settle = ~1-3s      | ✓        |
| c      | Show last weather while new one loads (stale-while-revalidate) |          |
| d      | I rarely spot-hop; optimize "tuned once, want now"             |          |

**User's choice:** b

### Q2.2 — What should the panel show during the gap?

| Option | Description                                           | Selected |
| ------ | ----------------------------------------------------- | -------- |
| a      | Last weather (no flicker)                             |          |
| b      | Loading spinner / skeleton — clear that it's updating | ✓        |
| c      | Either, whichever is faster to implement              |          |

**User's choice:** b

### Q2.3 — Initial app load — debounce or immediate?

| Option | Description                       | Selected |
| ------ | --------------------------------- | -------- |
| a      | Immediate fetch on mount          | ✓        |
| b      | Same debounce as DX (consistency) |          |
| c      | Short delay (~500ms)              |          |

**User's choice:** a

### Q2.4 — Callsign hover delay (currently 550ms)

| Option | Description                                   | Selected |
| ------ | --------------------------------------------- | -------- |
| a      | Keep 550ms — prevents stray-mouseover fetches | ✓        |
| b      | Tighten to 200-300ms                          |          |
| c      | Fire immediately on hover                     |          |

**User's choice:** a

---

## Area 3: Rate-limit risk

User reframed the area mid-discussion: "I want users to make the call, not OHC. Why does OHC need to be conservative when each browser is its own IP?"

This collapsed the originally-planned trade-off question. Verified the architecture (see Architecture Verification below) to confirm the user's premise. After verification, the area resolved without needing the original Q3.1/Q3.2 forced-choice format.

### Q3 (resolved) — Tight backoff + clear error UI nudging paid API key, no OHC-side rate gating?

| Option | Description                                      | Selected |
| ------ | ------------------------------------------------ | -------- |
| a      | Yes, that's the principle                        | ✓        |
| b      | Yes, but even less backoff (e.g., 2s → 5s → 10s) |          |
| c      | No — adjust                                      |          |

**User's choice:** a
**Notes:** Confirmed: don't pre-throttle on OHC's side. Tight backoff (5s → 15s → 30s, no 5-min cap). Surface clear error UI on persistent 429s pointing users at `localStorage.ohc_openmeteo_apikey` paid-tier escape hatch.

### Architecture Verification (mid-discussion check)

User asked whether the slowness might be because all weather requests are silently sharing a single OHC IP. A thorough verification was performed before continuing:

- Production bundle (`dist/assets/index-DzufINzv.js`) contains literal `api.open-meteo.com` URLs (4 occurrences) — direct browser fetch confirmed.
- No service worker, no global fetch interceptor, no axios wrapper.
- `vite.config.mjs:9-14` proxy block only matches `/api/*`, not third-party domains.
- `/api/weather` server route is a no-op stub for legacy clients (`server/routes/config-routes.js:226-228`).
- Grep across `server/` for `open-meteo` returns only the localStorage key reference. No server-side weather proxy exists.

Verdict: TRULY DIRECT. The user's principle stands and the existing code is consistent with it.

---

## Area 4: DE + DX batching

### Q4.1 (revised) — Pick the realistic option

Original Q4.1 offered "combine when both change at once" (option c), which the user initially picked. Pushed back: in practice DE rarely changes, so that option fires almost never and adds complexity for no benefit. Reframed:

| Option | Description                                                           | Selected |
| ------ | --------------------------------------------------------------------- | -------- |
| a      | Always batch when both change in same render tick (effectively never) |          |
| b      | Just leave them as separate fetches — simpler, no edge cases          | ✓        |

**User's choice:** b
**Notes:** Keep separate independent fetches. DE caches well (rarely changes); DX refetches as needed.

### Q4.2 — Did "rate-limit halving" change your answer?

| Option | Description                               | Selected |
| ------ | ----------------------------------------- | -------- |
| a      | Yes — batching halves rate-limit pressure |          |
| b      | No — already decided in Q4.1              | ✓        |
| c      | Tell me more about the trade-off          |          |

**User's choice:** b
**Notes:** User confirmed they're committed to separation regardless of batching's rate-limit benefit.

---

## Claude's Discretion

The following were explicitly left to downstream agents (research/planning):

- Exact UX of the rate-limited error nudge (tooltip vs. inline banner vs. settings link)
- Exact backoff numbers within the spirit of "tight" (5/15/30 vs. 3/10/30 vs. similar)
- Whether to tighten the 2-hour `POLL_INTERVAL` (adjacent — not requested, but allowed)
- Whether to log timing metrics for observability
- How precisely to detect "settle" (pure debounce reset vs. inactivity heuristic)

## Deferred Ideas

- DX news multi-source ticker — already on roadmap as Phase 2
- Tightening the 2-hour poll interval — out of scope, no user complaint
- Telemetry / metrics on weather load time — would make future "feels slow" questions answerable; backlog candidate
- Cancel in-flight fetches on rapid DX tuning — defer unless planner sees concrete need

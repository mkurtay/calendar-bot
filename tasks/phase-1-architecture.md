# Phase 1 Architecture — Smart Calendar MCP

> Captured 2026-04-26. Locks the design decisions and file layout that
> [phase-1-todo.md](./phase-1-todo.md) executes against.

---

## Vision

Today the MCP exposes CRUD primitives (`add_event`, `update_event`, etc.)
and the user is forced to be the orchestrator. Phase 1 inverts this: the
MCP becomes the domain expert. The user says "create me a Champions
League 2026 calendar" or "update the F1 calendar"; the server understands
the topic, knows where to fetch authoritative data (Phase 2+), validates
against per-category models, and ships a reviewable diff before
committing.

Phase 1 is the architectural foundation: per-category models, diff
engine, reshaped tool surface, and index page auto-rendering — without
fetchers yet. Fetchers slot in during Phase 2 against an interface
defined here.

---

## Locked decisions

| # | Decision | Locked answer |
|---|---|---|
| Q1 | `update_calendar` flow | **Review-then-commit.** Two tools: `update_calendar(id)` returns a diff with a token; `apply_calendar_update(token)` commits. |
| Q2-A | Source schedule conflicts | **Source wins** for upcoming events (start, end, location, teams). |
| Q2-B | Source results vs your annotations | **Local result wins** when set. Source fills `result` only when local is `null`. |
| Q2-C | Events local-only, missing from source | **Keep, tag `local_only: true`** so future diffs ignore them. |
| Q3 | `create_calendar` topic → metadata | **Trust the LLM.** Tool input: required `category`, required `name`, optional `id` (auto-derived via `slugify`). LLM-facing guidance lives in tool description. |
| Q4-a | Editorial fields location | **Move to JSON** under `presentation: { subtitle, badge_label, accent_color, icon }` per calendar. |
| Q4-b | Index page enhancements | "Coming up next" + "Live now" badge via build-time inlined event slice + ~25 LOC client JS. Group-by-category deferred until 5+ calendars. When live, both LIVE badge and next-up line stay visible. |
| Q5-a | Unresolved teams → HTML | Show "TBD vs TBD" with venue/time. |
| Q5-b | Unresolved teams → .ics | Ship them with "(TBD vs TBD)" titles; updated in place after the draw. |
| Server | SDK Server class swap | **Path A** — `import { McpServer }`, internal handlers via `mcp.server.setRequestHandler`. Officially endorsed pattern for advanced uses. |

---

## Data source landscape (informs Phase 2+)

From research conducted 2026-04-26:

| Category | Primary | Fallback | Critical caveat |
|---|---|---|---|
| **UCL 2025-26** | football-data.org (`CL`, free 10 req/min, stage enum, ETag-friendly) | api-football.com (RapidAPI, 100 req/day free) | Leg numbers must be **derived** from match pairing — neither API has them as first-class fields. |
| **WC 2026** | football-data.org (`WC`) | api-football.com (league_id 1) | Group draw is **December 5, 2025**; before that, only slot fixtures ("Match 1: MEX vs TBD"). Hard refresh window in early Dec required. |
| **F1 2026** | jolpica-f1 (`api.jolpi.ca/ergast/f1/`, no auth, 500 req/hr) | openf1.org (live results enrichment) | Maps 1:1 to existing `formula1` typed block. CC-BY-4.0 attribution required in HTML (not .ics). |
| **NBA / NFL / Tennis** | balldontlie / SportsData.io / various | n/a | Future; not in Phase 1 scope. |

Architectural implication: the soccer model's stage normalization layer
(`models/soccer/stages.ts`) and leg derivation
(`models/soccer/legs.ts`) are not optional — they're load-bearing.
Different sources will feed normalized matches in via the
`FixtureProvider` interface; the soccer model is what produces the
normalized `stage`/`leg`/`group` shape consumed by everything
downstream.

---

## File layout

### calendar-bot (this repo)

```
src/
├── server.ts                  # McpServer entry, registers all tools (Path A)
├── config.ts                  # NEW: env-driven GitHub config, isolated for testing
│
├── github.ts                  # existing — Octokit wrapper, unchanged
├── calendar-store.ts          # existing — JSON read/write; extend w/ list-by-category
│
├── models/                    # NEW — domain layer, per-category
│   ├── types.ts               # Calendar, Event, EventStatus, EventResult base types
│   ├── soccer/
│   │   ├── index.ts           # SoccerCalendar, SoccerEvent (discriminated by stage)
│   │   ├── stages.ts          # Stage enum + normalize("LAST_16") → "R16", ordering
│   │   ├── legs.ts            # deriveLegs(events) — pairs KO ties, assigns leg 1/2
│   │   ├── tbd.ts             # TBD-slot handling for pre-draw fixtures
│   │   └── validators.ts      # required-field check w/ helpful error messages
│   ├── formula1/
│   │   ├── index.ts           # F1Calendar, F1Event
│   │   ├── sessions.ts        # FP1|FP2|FP3|Quali|Sprint|Race enum
│   │   └── validators.ts
│   └── registry.ts            # category → { model, validator, defaults, slugify }
│
├── fetchers/                  # NEW — interface in Phase 1, impls Phase 2+
│   ├── types.ts               # FixtureProvider interface, FetchResult shape
│   └── manual.ts              # Phase 1: passthrough provider — wraps user-supplied events
│
├── diff/                      # NEW — calendar diff engine
│   ├── compute.ts             # diff(currentEvents, incoming) → {added, updated, removed, conflicts}
│   ├── policy.ts              # mergePolicy: Q2 rules encoded
│   └── tokens.ts              # short-lived token storage for review-then-commit flow
│
├── tools/                     # reshaped tool surface
│   ├── list-calendars.ts      # existing — unchanged
│   ├── list-events.ts         # existing — unchanged
│   ├── create-calendar.ts     # NEW: scaffold JSON + register in index.
│   ├── update-calendar.ts     # NEW: compute diff, return token + summary
│   ├── apply-calendar-update.ts  # NEW: commit a previously-returned diff by token
│   ├── add-event.ts           # existing — kept as fallback
│   ├── update-event.ts        # existing — kept
│   ├── remove-event.ts        # existing — kept
│   └── set-result.ts          # existing — kept
│
└── __tests__/
    ├── models/soccer/legs.test.ts        # leg derivation across UCL/WC patterns
    ├── models/soccer/stages.test.ts      # API enum ↔ our stage roundtripping
    ├── diff/compute.test.ts              # detects adds/updates/removes
    ├── diff/policy.test.ts               # merge policy preserves results, local_only sticks
    └── tools/create-calendar.test.ts     # end-to-end with passthrough provider
```

### kurtays-calendar (sibling repo)

> **As implemented:** `render-index.mjs` logic landed inside `scripts/render-html.mjs` rather than as a separate script — the per-calendar page renderer and the index-card renderer share enough utilities (escapeHtml, status-aware classification, marker replacement) that consolidation was simpler. The marker pair is `<!-- BEGIN GENERATED:index-cards -->` (plus a separate `:footer` pair). deploy.yml runs `render-html.mjs` and `render-ics.mjs`; no separate index step.

```
data/*.json                    # source-of-truth calendars; gains `presentation` block + `local_only` field
index.html                     # markers: <!-- BEGIN GENERATED:index-cards --> + <!-- BEGIN GENERATED:footer -->
*.html                         # existing per-calendar pages, unchanged structure
*.ics                          # existing, regenerated in CI
scripts/
├── render-html.mjs            # per-page content AND index-card auto-rendering; Phase 4 adds standings + charts
└── render-ics.mjs             # existing
.github/workflows/deploy.yml   # render-html.mjs + render-ics.mjs steps
```

---

## Key design choices

1. **Models live in calendar-bot, renderers stay in kurtays-calendar.**
   calendar-bot owns the schema and validation; renderers consume JSON
   blindly. This already matches the current system; we're not creating
   a new boundary.

2. **`render-index.mjs` runs in kurtays-calendar's CI, not calendar-bot.**
   `create_calendar` writes JSON only. CI re-renders the index page on
   push. No HTML knowledge in the MCP server.

3. **Diff engine is fetcher-agnostic.** Same diff code runs whether
   events come from a fetcher (Phase 2+) or a user-supplied list
   (Phase 1). Lets us fully exercise the diff path before any external
   API is wired up.

4. **Granular tools (`add_event` etc.) kept but de-emphasized.** Tool
   descriptions for `create_calendar`/`update_calendar` get rich
   guidance; granular tool descriptions get a "(advanced — prefer
   high-level tools when possible)" prefix.

5. **Soccer model handles both UCL and WC; F1 model is its own thing.**
   UCL and WC share enough (stages, legs, groups, home/away) to share a
   model. F1 is structurally different. World Cup-specific quirks (R32
   round, group draw timing) are flags on the soccer model, not a
   separate model.

---

## Tool surface after Phase 1

**New (high-level, recommended):**
- `create_calendar({ name, category, id?, html_file?, presentation?, events })` — scaffolds JSON, validates against category model, returns the created calendar metadata + suggested next step.
- `update_calendar({ id, events })` — diffs incoming events against current state per the merge policy, returns `{ token, summary, diff }` for review.
- `apply_calendar_update({ token })` — applies a previously-returned diff to GitHub.

**Existing (kept, lightly de-emphasized):**
- `list_calendars()` — unchanged.
- `list_events({ calendar_id, from?, to? })` — unchanged.
- `add_event` / `update_event` / `remove_event` / `set_result` — unchanged behavior, descriptions updated to nudge LLMs toward high-level tools.

**Deferred to Phase 2+:**
- Auto-fetching variants (`update_calendar` with no events arg → triggers fetcher).
- `create_calendar` with no events arg → triggers fetcher.

---

## Index page rendering

Build-time (inside `render-html.mjs`):
- Reads `data/*.json`, sorted deterministically (by `id` ascending so animation order is stable).
- Computes per-card:
  - `presentation.subtitle` / `badge_label` / `accent_color` / `icon` (from JSON)
  - `upcoming_count` (events with `start > buildTime` and `status !== "completed"`)
  - `date_range` (next upcoming → last event in calendar)
  - `inline_events` (next 3 upcoming + any currently in-progress, lightweight slice)
- Inlines into each `<a class="card" data-events='...'>` element.
- Animation delay moved from `:nth-child` to `style="animation-delay: ..."` so order is deterministic regardless of how many cards.

Page load (~25 LOC inline JS):
- For each card, parse `data-events`, find live + next-up against `Date.now()`.
- Reveal `.card-live-badge` if a live event exists.
- Populate `.card-next` with formatted "Apr 28 · PSG vs Bayern".
- Both can be visible simultaneously when a live event is present.

Fallback: if JS is disabled/blocked, the card still shows
`presentation.subtitle` (editorial copy from JSON), so the page is fully
functional without JS — just less informative.

---

## What's NOT in Phase 1

To keep the surface area finite, these are explicitly deferred:

- **Fetchers themselves** — `FixtureProvider` interface is defined and
  `manual.ts` (passthrough) is the only impl. Phase 2 adds soccer
  fetchers; Phase 4 adds F1.
- **Standings tables and charts** in renderers. Phase 4.
- **Group-by-category index page** — defer until 5+ calendars.
- **Live HTTP transport for the MCP server** — Phase 1 stays stdio-only.
- **OAuth or other auth flows for sources** — Phase 1 only needs
  GitHub PAT (existing).
- **Periodic auto-refresh / scheduled updates** — user-triggered only
  in Phase 1.

---

## Acceptance criteria for declaring Phase 1 done

- [ ] Path A McpServer swap complete; deprecation warning gone; rebuilt
      `dist/src/server.js` validated against synthetic `initialize`.
- [ ] `models/` layer in place with passing tests for soccer
      stages/legs and F1 validators.
- [ ] `diff/` engine in place with passing tests for the merge policy
      including the `local_only` rule.
- [ ] `create_calendar` works end-to-end: dictate events to Claude →
      JSON committed → CI renders index entry.
- [ ] `update_calendar` returns a diff with a token; `apply_calendar_update`
      commits when called with that token; rejects expired/unknown
      tokens.
- [ ] `render-index.mjs` exists in kurtays-calendar; CI runs it; index
      page shows "next up" + "live now" badge correctly when relevant
      events exist.
- [ ] Both repo READMEs updated to reflect the new tool surface.
- [ ] [phase-1-todo.md](./phase-1-todo.md) all items checked.

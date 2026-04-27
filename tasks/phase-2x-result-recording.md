# Phase 2.x — Result-recording flow

> Drafted 2026-04-26 while planning the WC 2026 data migration.
> Captures the question of "how do results get into calendars at scale"
> so we can revisit when Phase 2 ships and we have actual usage data.

---

## The problem

Once `teams[]` and per-event `home_id`/`away_id` are in place (the
Phase 1.5 data migration), the renderer auto-computes standings from
`event.result.{home_score, away_score}`. But results have to *get
there* somehow.

The volume isn't trivial:
- **WC 2026** — 48 group-stage matches + 16 knockout matches = 64 results across ~one month.
- **UCL 2026-27 onwards** — League Phase has 144 matches before knockouts kick in.
- **Premier League** — 380 matches per season; ~10/week during the season.

Hand-recording each via `set_result` doesn't scale. So how do results
flow in routinely?

---

## Phase 2 baseline (already planned)

The football-data.org fetcher (Phase 2 Step 2) returns match objects
with score data for completed matches. The mapping in
`src/fetchers/soccer/football-data.ts` would set
`event.result.{home_score, away_score}` (and `status: "ft" | "aet" | "pen"`
+ `penalties` when available) as part of `fetchFixtures()`.

Routine flow during a live tournament:

1. User: *"refresh world cup"*
2. `update_calendar` no-events branch → fetcher pulls fresh data
3. Diff shows N events updated, mostly score additions for newly-completed matches
4. User reviews, approves, `apply_calendar_update` commits
5. CI re-renders `world-cup-2026.html`; standings update with new aggregates

This handles ~95% of the result-recording need: the fetcher does the
typing, the existing `update_calendar`/`apply_calendar_update` flow
does the review-then-commit, the merge policy preserves any local
notes you've already added.

---

## What Phase 2 doesn't fully cover

Three edge cases worth thinking about — not blocking, but probably
the source of friction once Phase 2 ships.

### 1. Local annotations on completed events

When a match has a memorable detail (*"rain delay"*, *"VAR-overturned penalty"*, *"hat trick from Mbappé"*), you want that recorded
alongside the score. Phase 1's merge policy already handles this:
local `result` wins when set. So the workflow is:

- Match plays; fetcher refresh writes the score
- You manually edit via `set_result` or `update_event` to add notes
- Future fetcher refreshes don't overwrite your annotated result
  (Q2-B; the diff records this as `preserved-result` for audit)

This works today. No new tools needed.

### 2. Live in-progress games

When a match is mid-game (status="live"), the renderer's
`classifyEvent` already shows it as "live" rather than upcoming or
completed. But if you `update_calendar` mid-game, the fetcher might
return partial scores or no scores — the merge policy has no rule
specifically for live matches.

Three reasonable behaviors when source has partial result + status="live":
- (a) Treat live results as fully authoritative (overwrite local)
- (b) Treat live results as informational only (don't write to result;
  surface them in the summary)
- (c) Skip in-progress matches entirely in the diff (only commit final results)

**Lean: (c)**. Live results during a 90-min window aren't worth
committing — the page is already showing "live" via status. Wait for
full-time then refresh. Could surface as a renderer hint without
committing intermediate state.

### 3. Penalty-shootout details

`SoccerResult.penalties` is a discriminated-union field that's only
populated when `status === "pen"`. Football-data.org returns penalty
results in a specific nested shape; jolpica doesn't apply (F1).
Mapping logic lives in the fetcher and might need extra care:

- football-data: `match.score.penalties.home` / `.penalties.away` →
  `result.penalties.{home, away}` and `result.status = "pen"`.
- api-football fallback (Phase 2.1): different field path,
  `score.penalty.home` (singular).

Worth a unit test in `__tests__/fetchers/football-data.test.ts` against
a canned response containing a penalty shootout (any UCL knockout-leg
shootout would do).

---

## Tools we *could* add (probably won't need to)

| Tool | Use case | Verdict |
|---|---|---|
| `record_result(calendar_id, uid, result: SoccerResult)` | Tighten schema vs current set_result which accepts `Record<string, unknown>` | Skip. set_result works; the merge policy handles edge cases. Adding a soccer-specific variant adds API surface for marginal type safety. |
| `record_results_bulk(calendar_id, results: [{uid, result}, ...])` | Manual paste from a results table when fetcher misses something | Skip unless friction proves it's needed. Phase 2 fetcher should cover this. |
| `delete_calendar(id)` | Clean up smoke-test calendars without manual repo edits | Worth ~30 min if you do this more than 2-3 times. Defer until then. |

---

## Recommendation

**Don't add tools yet.** The Phase 2 fetcher implementation handles
the bulk case; the existing `set_result`/`update_event` tools handle
the long tail. Revisit this doc after one tournament cycle (post-WC
2026) to see what *actually* hurt.

Three things worth doing during Phase 2 implementation that touch
this area:

1. **In `src/fetchers/soccer/football-data.ts`**, write a thorough
   mapper that handles the result types (regular, AET, penalties).
   Test against canned response fixtures.

2. **In Step 4 (`update_calendar` auto-fetch)**, ensure the
   `preserved-result` audit entries get surfaced in the diff summary
   so users see when source disagreed with their local annotations.
   Existing diff engine emits these; tool layer just needs to count
   them in the summary.

3. **Document in the README** (Step 8) that the routine result-update
   workflow is *"refresh weekly during a tournament"* and not
   "subscribe to live data." The MCP isn't designed for sub-hour
   freshness; CloudFront caches and human review windows mean ~hour
   granularity is the realistic floor.

---

## Out-of-scope (Phase 4+)

- **Tiebreakers** in standings (head-to-head, goal difference, fair
  play points). Renderer-side concern in kurtays-calendar.
- **Live timing data** (minute-by-minute scores, possession, xG).
  Different problem class — needs streaming, not polling. openf1.org
  for F1 telemetry is the closest existing primitive.
- **Manager / lineup changes** as event annotations. Not in current
  schema; would need event-level extension.

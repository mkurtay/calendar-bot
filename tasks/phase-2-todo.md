# Phase 2 — Step-by-step execution plan

> Companion to [phase-2-architecture.md](./phase-2-architecture.md).
> All five Q1–Q5 decisions are locked there. Each step ends in a
> commit; do not mark a step done until acceptance criteria pass.

---

## Step 1 — `FixtureProvider` interface + registry scaffold

**Files touched:** `src/fetchers/types.ts` (new), `src/fetchers/http.ts` (new), `src/fetchers/registry.ts` (new), `src/__tests__/fetchers/registry.test.ts` (new).

**Changes:**
- `types.ts`:
  - `FixtureProvider` interface (`name`, `fetchFixtures(ctx)`, optional `fetchResults(ctx, uids)`).
  - `FixtureContext` type (`calendarId`, `competition?`, `season?`).
  - Custom error classes: `NoProviderError`, `AuthError`, `TransportError`.
- `http.ts`: tiny wrapper around global `fetch` with timeout + a single retry on transient 5xx. ~40 LOC.
- `registry.ts`: empty `Map<string, FixtureProvider>`, `getProvider(calendarId)` lookup that throws `NoProviderError` on miss.
- Tests cover registry lookup hit/miss and the error class shapes.

**Acceptance:**
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test fetchers` passes
- [ ] No actual provider implementations yet — pure scaffolding

**Commit:** `Add FixtureProvider interface and registry scaffold`

---

## Step 2 — football-data UCL provider

**Files touched:** `src/fetchers/soccer/football-data.ts` (new), `src/fetchers/soccer/shared.ts` (new), `src/__tests__/fetchers/football-data.test.ts` (new), `src/config.ts` (extend with optional `FOOTBALL_DATA_TOKEN`), `src/fetchers/registry.ts` (register provider).

**Changes:**
- `shared.ts`: response → `SoccerEvent` mapper helpers (uid generation, `start`/`end` from match utcDate, location from venue.name).
- `football-data.ts`: `footballDataUCL` provider hitting `GET /v4/competitions/CL/matches?season={year}`. Maps response, runs `normalizeStage()` (Phase 1 helper) on each, runs `deriveLegs()` on the result, returns a clean `SoccerEvent[]`. Uses `X-Auth-Token` header from config; throws `AuthError` if token missing at fetch time.
- `config.ts`: add `optionalGithubFootballDataToken: string | null` field; do NOT throw on missing.
- `registry.ts`: `PROVIDERS.set("champions-league-2026", footballDataUCL)`.
- Tests use a stub HTTP fn (not real fetch) and feed in canned football-data responses; assert the resulting events have correct uids, ISO-UTC dates, normalized stages, and derived legs.

**Acceptance:**
- [ ] `pnpm test football-data` passes
- [ ] Stage normalization handles real football-data values (LAST_16, QUARTER_FINALS, …)
- [ ] Legs are derived correctly from synthetic two-leg ties
- [ ] Missing token throws `AuthError` with message naming the env var

**Commit:** `Add football-data.org UCL fetcher`

---

## Step 3 — football-data WC provider

**Files touched:** `src/fetchers/soccer/football-data.ts` (extend), `src/fetchers/registry.ts` (register), `src/__tests__/fetchers/football-data.test.ts` (extend).

**Changes:**
- Add `footballDataWC` export — same client class, different competition code (`WC`).
- Register `world-cup-2026` in registry.
- Tests cover the `R32` round (unique to WC's 48-team format) and the TBD-slot case where one or both teams are null.

**Acceptance:**
- [ ] `pnpm test football-data` passes (more tests)
- [ ] WC `R32` stage is correctly mapped (football-data's `LAST_32`)
- [ ] TBD slots produce events with `home: null` or `away: null`

**Commit:** `Add football-data.org WC fetcher`

---

## Step 4 — Auto-fetch in `update_calendar`

**Files touched:** `src/tools/update-calendar.ts`, `src/__tests__/tools/update-calendar.test.ts`.

**Changes:**
- Make `events` parameter optional in `UpdateCalendarParams` and tool schema.
- New branch in `updateCalendar()`: if `params.events` is undefined, look up the provider via `getProvider(params.id)`, call `fetchFixtures()`, and use the result as the incoming events list. Then run the existing diff path unchanged.
- Update tool description to mention the no-events auto-fetch behavior + the three error types (NoProviderError, AuthError, TransportError).
- Tests use a stubbed registry that returns a fake provider returning canned events; verify the diff path runs identically to the explicit-events path.

**Acceptance:**
- [ ] `pnpm test update-calendar` passes
- [ ] `update_calendar({ id })` (no events) produces same diff shape as `update_calendar({ id, events })` when fixtures match
- [ ] Calendar without a registered provider returns clear `NoProviderError`
- [ ] Existing 111 Phase 1 tests still pass (no regression)

**Commit:** `Auto-fetch in update_calendar via registered provider`

---

## Step 5 — Auto-fetch in `create_calendar`

**Files touched:** `src/tools/create-calendar.ts`, `src/__tests__/tools/create-calendar.test.ts`, `src/fetchers/registry.ts` (extend with helper).

**Changes:**
- Make `events` optional in `CreateCalendarParams`.
- New branch: if `params.events` undefined, look up a provider — but the calendar doesn't exist yet, so the lookup needs a different signal. Add a *category-+-season* helper to the registry (e.g. `getProviderForNewCalendar({ category, year })`) that maps to known providers. Empty fixture list is a valid result (Q4 graceful empty fallback): scaffold the calendar with `events: []` and tell the user the calendar was created empty (likely pre-draw).
- Tests cover: provider returns events → calendar scaffolded with them; provider returns empty array → calendar scaffolded with `events: []`; no matching provider → clear error.

**Acceptance:**
- [ ] `pnpm test create-calendar` passes
- [ ] Empty-events fallback works (calendar created with `events: []`)
- [ ] Unknown category+year returns helpful error suggesting explicit `events`

**Commit:** `Auto-fetch in create_calendar via registered provider`

---

## Step 6 — jolpica F1 provider

**Files touched:** `src/fetchers/formula1/jolpica.ts` (new), `src/__tests__/fetchers/jolpica.test.ts` (new), `src/fetchers/registry.ts` (register `formula-1-2026`).

**Changes:**
- `jolpica.ts`: hits `GET /ergast/f1/{year}.json` for the season schedule. Maps each Race element to an `F1Event` with `formula1.{round, gp_name, circuit, city, country, session: "Race", is_sprint_weekend}`. (Sprint sessions can be added in Phase 4 alongside richer renderer.)
- Optional `fetchResults(ctx, uids)` for completed races: hits `GET /ergast/f1/{year}/{round}/results.json` and returns winner/podium per uid.
- Tests with canned jolpica responses; verify mapping fidelity.

**Acceptance:**
- [ ] `pnpm test jolpica` passes
- [ ] `formula-1-2026` registered in registry
- [ ] Round 1 (Australian GP) maps correctly: `round: 1`, `gp_name: "Australian Grand Prix"`, `circuit: "Albert Park Circuit"`, etc.

**Commit:** `Add jolpica-f1 fetcher`

---

## Step 7 — `list_providers` diagnostic tool

**Files touched:** `src/tools/list-providers.ts` (new), `src/server.ts` (register), `src/__tests__/tools/list-providers.test.ts` (new).

**Changes:**
- New MCP tool: `list_providers()` returns each registered calendar id, the provider name, and an `auth_status: "ok" | "missing_token"` field. Useful for debugging.
- Tool description mentions it's a read-only diagnostic.
- Tests cover the auth-status logic for each provider.

**Acceptance:**
- [ ] `pnpm test list-providers` passes
- [ ] Manual smoke test in Claude Desktop: tool appears, returns sensible output
- [ ] Auth-status correctly reports missing tokens

**Commit:** `Add list_providers diagnostic tool`

---

## Step 8 — README + docs

**Files touched:** [README.md](../README.md), [phase-2-todo.md](./phase-2-todo.md) (this file — mark steps complete).

**Changes:**
- README: new "Auto-fetch flow" section under Tools explaining how omitting `events` triggers the registered fetcher. Update Setup to mention `FOOTBALL_DATA_TOKEN` as an optional env var (with a link to football-data.org's free signup). Update Categories table to show the actual fetchers (no longer "Phase 2"), with attribution requirements.
- Mark all Phase 2 steps complete in this file.

**Acceptance:**
- [ ] README accurately describes Phase 2 behavior
- [ ] No stale Phase 1 references that contradict the new flow
- [ ] All steps in this file checked off

**Commit:** `Document Phase 2 auto-fetch flow`

---

## Out of scope (Phase 2.x and Phase 3+)

Tracked here so they're not accidentally pulled in:

- **Scheduled notifications** (Phase 2.5 if useful) — a workflow that detects source-data changes and emails/Slacks the user, without committing.
- **api-football.com fallback** — defer to Phase 2.1 if rate limits become a real problem.
- **ETag-aware caching** — currently in-memory TTL is enough; ETag is Phase 2.1.
- **F1 results enrichment via openf1.org** — Phase 4 alongside richer renderer (standings tables, championship charts).
- **Standings tables, leg aggregate scores, championship charts** — Phase 4 (kurtays-calendar renderer extension).
- **HTTP transport, scheduled auto-commit, multi-user** — Phase 3+.

---

## Status legend

`[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked

# Phase 2 Architecture — Auto-fetching Fixture Data

> Drafted 2026-04-26. Builds on Phase 1
> ([phase-1-architecture.md](./phase-1-architecture.md)). The MCP/tool/diff/
> models plumbing is already in place; this phase wires real data sources
> into the existing flow.

---

## Vision

Phase 1 turned the MCP from a CRUD primitive into a domain-aware tool.
You say *"refresh UCL"* and the MCP plus Claude figures out what events
should be in the calendar — but you still have to dictate them.

Phase 2 closes that loop. The MCP becomes the *source-of-truth fetcher*:
it knows where to pull authoritative fixture data for each category and
runs that against the existing diff engine. Same review-then-commit
flow, same merge policy. Just no more typing event details by hand.

After Phase 2, *"refresh Champions League"* in Claude Desktop:
1. Calls `update_calendar("champions-league-2026")` — no `events` arg.
2. MCP looks up the provider for this calendar (football-data.org).
3. MCP fetches the current fixture list from football-data.
4. Maps response → `SoccerEvent[]` via existing models/soccer normalizers.
5. Runs the existing `diff()` against the live calendar JSON.
6. Returns the same `{ token, summary, diff }` shape as Phase 1.
7. You review, approve, `apply_calendar_update` commits.

---

## Locked decisions (from Phase 1 research)

These came from the data-source research conducted during Phase 1 design;
they're carried forward unchanged.

| # | Decision | Locked answer |
|---|---|---|
| D1 | UCL primary source | **football-data.org** (`/v4/competitions/CL`). Free 10 req/min, ETag-aware, has stage enum. |
| D2 | UCL fallback | **api-football.com**. Free 100 req/day; better leg-label ergonomics; tighter rate limit. |
| D3 | WC 2026 primary source | **football-data.org** (`/v4/competitions/WC`). Same client. |
| D4 | F1 primary source | **jolpica-f1** (`api.jolpi.ca/ergast/f1/`). No auth, 500 req/hr, 2026 calendar already published, maps 1:1 to existing F1TypedBlock. |
| D5 | F1 results enrichment | **openf1.org** (optional, for richer post-race data). |
| D6 | Stage normalization | All providers feed raw matches into `models/soccer/stages.ts:normalizeStage`. Leg numbers derived via `models/soccer/legs.ts:deriveLegs` since no API has them as a first-class field. |
| D7 | Attribution | football-data: required in HTML; jolpica (CC-BY-4.0): required in HTML. **Not** required in `.ics`. (Renderer-side concern in kurtays-calendar; Phase 4 work.) |

---

## Open questions (need answers before implementation)

These are the equivalent of Phase 1's Q1–Q5 — defer-to-implementation
decisions that meaningfully shape the architecture:

### Q1: Provider registration

When `update_calendar("ucl-2026")` runs auto-fetch, how does it pick
the provider?

| | (i) Explicit per-calendar map | (ii) Rule-based via `canServe()` |
|---|---|---|
| **How** | `PROVIDERS.set("ucl-2026", footballDataUCL)` at module load | Each provider implements `canServe(calendar)`; iterate to find a match |
| **Pros** | Trivial to reason about; no conflicts | Adapts to new calendars without code change |
| **Cons** | Every new calendar needs a code change | Edge cases: which provider wins if two match? |

**Lean: (i) explicit per-calendar map.** Calendars are added rarely
enough (a few per year) that the per-calendar map's friction is a
feature — it forces explicit choice.

### Q2: API token handling

The football-data providers need a `FOOTBALL_DATA_TOKEN`. jolpica
doesn't need anything. How do we model "this provider needs auth"?

| | (i) Required env var, fail fast | (ii) Optional env var, fall back to error at fetch time |
|---|---|---|
| **Behavior on startup with no token** | Server fails to start | Server starts; fetch errors with "set FOOTBALL_DATA_TOKEN" |
| **Pros** | Catches misconfiguration immediately | Lets you use F1 even if you haven't set up the soccer token yet |
| **Cons** | Mixed-category users (F1 only) blocked unnecessarily | Failure deferred to first soccer fetch |

**Lean: (ii) optional + fail at fetch time.** Aligns with how the GitHub
PAT works (required only when you actually mutate); separates "server
healthy" from "every provider is configured."

### Q3: Caching

Provider responses are cacheable but external services have rate limits.
Where does cache live?

| | (i) None | (ii) In-memory per server lifetime | (iii) On-disk (e.g. `.cache/`) |
|---|---|---|---|
| **Risk of rate-limit hit** | High | Low (cache survives within session) | Lowest (cache survives restart) |
| **Implementation cost** | $0 | ~50 LOC | ~150 LOC + cleanup logic |
| **Staleness window** | None | TTL'd | TTL'd |

**Lean: (ii) in-memory.** football-data's 10 req/min is plenty for
manual use. ETag is a nice-to-have for Phase 2.1; basic in-memory TTL
cache is fine.

### Q4: Auto-fetch on `create_calendar`?

Phase 1's `create_calendar` requires the user to pass events. Should
Phase 2 add a no-events variant that auto-fetches?

| | (i) Yes — auto-fetch initial event list | (ii) No — keep `create_calendar` requiring events |
|---|---|---|
| **What enables it** | A topic-or-id to provider mapping for new calendars | n/a — user dictates explicitly |
| **Friction** | Low: "create me a UCL 2026 calendar" → done | Medium: user has to first list events somewhere |
| **Risk** | Provider might have nothing yet (e.g. WC pre-draw) — partial-fixture starts | n/a |

**Lean: (i) yes, with a graceful empty-events case.** If the provider
returns nothing yet (pre-draw), the calendar is created empty and
`update_calendar` is what populates it later. Worth doing in Phase 2.

### Q5: F1 results polling

F1 results post within hours of a race. Who triggers the refresh?

| | (i) Manual: user runs `update_calendar` | (ii) Auto: scheduled GitHub Action |
|---|---|---|
| **Cost** | $0 | A daily/hourly Action against jolpica's free tier |
| **Latency** | "I want to update results" → manual call | Within an hour of a race |

**Lean: (i) manual for Phase 2.** Phase 3+ adds a scheduled refresh
once we have HTTP transport + a Lambda to run it.

---

## File layout

### calendar-bot — additions to existing structure

```
src/
├── fetchers/                  # NEW in Phase 2
│   ├── types.ts               # FixtureProvider, FixtureContext, FetchError
│   ├── http.ts                # Tiny wrapper over fetch with retry + rate-limit handling
│   ├── registry.ts            # calendarId → FixtureProvider map (Q1: explicit)
│   ├── soccer/
│   │   ├── football-data.ts   # UCL + WC adapter
│   │   ├── api-football.ts    # Fallback adapter (Phase 2.1)
│   │   └── shared.ts          # Helpers shared across soccer adapters
│   └── formula1/
│       └── jolpica.ts         # F1 schedule + results adapter
│
├── tools/                     # Existing — extended in Phase 2
│   ├── update-calendar.ts     # Add no-events branch → fetcher dispatch
│   └── create-calendar.ts     # Add no-events branch → fetcher dispatch (Q4 yes)
│
├── config.ts                  # Existing — extend with FOOTBALL_DATA_TOKEN (optional)
│
└── __tests__/
    └── fetchers/
        ├── football-data.test.ts   # Mocked fetch, response → SoccerEvent[]
        ├── jolpica.test.ts         # Mocked fetch, response → F1Event[]
        └── registry.test.ts        # Provider lookup + missing-provider error
```

### kurtays-calendar — no changes for Phase 2

The renderer doesn't care where events came from. Phase 4 adds
standings/charts; Phase 2 just ships fresher data.

---

## Key design choices

### 1. `FixtureProvider` is per-source, not per-category

```typescript
interface FixtureProvider {
  readonly name: string;
  fetchFixtures(ctx: FixtureContext): Promise<Event[]>;
  fetchResults?(
    ctx: FixtureContext,
    eventUids: string[],
  ): Promise<Map<string, EventResult>>;
}
```

One provider per *external service*, not per category. football-data
serves both UCL and WC; jolpica serves F1. The provider returns
pre-validated `Event[]` (or category-specific subtypes) so the tool
layer doesn't need to know about HTTP shapes.

### 2. The registry is the only category-aware glue

```typescript
// src/fetchers/registry.ts
const PROVIDERS = new Map<string, FixtureProvider>([
  ["champions-league-2026", footballDataUCL],
  ["world-cup-2026", footballDataWC],
  ["formula-1-2026", jolpicaF1],
]);
```

When a new calendar is added, the registry gets one new line. The
provider modules don't change. (Q1 lean.)

### 3. Auto-fetch is opt-in via omitted `events`

```typescript
// Existing Phase 1 behavior: events required
update_calendar({ id: "ucl-2026", events: [...] })

// New Phase 2 behavior: events omitted → auto-fetch
update_calendar({ id: "ucl-2026" })
```

The `events` parameter becomes optional. When present, Phase 1 behavior
is unchanged. When absent, the tool resolves a provider, fetches, and
feeds the result into the same diff path. **Same merge policy applies
either way** — this is the whole point of the Phase 1 design.

### 4. Errors surface what to fix

Each provider can fail in three ways:

```
NoProviderError("No fetcher registered for calendar 'foo-2026'")
AuthError("Set FOOTBALL_DATA_TOKEN env var; see README")
TransportError("football-data.org returned 503; retry in 60s")
```

The tool descriptions for `update_calendar` and `create_calendar` are
extended to mention these so the LLM relays them clearly to the user.

### 5. Stage normalization runs in the provider, not the tool

Football-data returns `LAST_16`; api-football returns `Round of 16`.
Both providers call `normalizeStage()` (Phase 1, models/soccer/stages.ts)
*inside* their adapter, so the tool layer always sees canonical stage
names. Same for leg derivation: provider runs `deriveLegs()` before
returning.

This keeps the tool layer dumb — it doesn't even need to know that
soccer has stages.

---

## Tool surface after Phase 2

**Existing high-level tools — same name, optional `events`:**

- `create_calendar({ name, category, id?, html_file?, presentation?, events? })` — `events` now optional. When omitted, fetches initial event list via the registered provider.
- `update_calendar({ id, events? })` — `events` now optional. When omitted, fetches the current event list.
- `apply_calendar_update({ token })` — unchanged.

**New diagnostic tool (small, useful):**

- `list_providers()` — lists each registered calendar id + provider name + whether it's available (auth check). Useful for debugging "why does refresh fail."

**Granular tools — unchanged.** The `add_event`/`update_event`/etc.
tools don't fetch; they're still the per-event manual fallback.

---

## Sequencing within Phase 2

Each step ends in a commit. Acceptance per step.

1. **Provider interface + registry scaffolding** (no providers yet).
   Commit: `Add FixtureProvider interface and registry scaffold`.
2. **football-data UCL provider** with mocked HTTP tests + stage/leg
   normalization.
   Commit: `Add football-data.org UCL fetcher`.
3. **football-data WC provider** (mostly shares code with UCL).
   Commit: `Add football-data.org WC fetcher`.
4. **Wire auto-fetch into `update_calendar`** with optional `events` param.
   Commit: `Auto-fetch in update_calendar via registered provider`.
5. **Wire auto-fetch into `create_calendar`** (Q4 yes).
   Commit: `Auto-fetch in create_calendar via registered provider`.
6. **jolpica F1 provider** with mocked tests.
   Commit: `Add jolpica-f1 fetcher`.
7. **`list_providers` diagnostic tool**.
   Commit: `Add list_providers diagnostic tool`.
8. **README updates** describing the new auto-fetch flow + env vars.
   Commit: `Document Phase 2 auto-fetch flow`.

---

## What's NOT in Phase 2

- **Standings tables, leg aggregate scores, championship charts** — kurtays-calendar renderer extension, Phase 4.
- **Scheduled auto-refresh** — needs HTTP transport + Lambda; Phase 3+.
- **Disk-persisted cache** — in-memory only (Q3 lean).
- **api-football.com fallback** — defer to Phase 2.1 if rate limits become a real problem.
- **F1 results enrichment via openf1.org** — defer to Phase 4 alongside richer renderer.
- **Cross-competition diffs** (e.g. "is this team in both UCL and WC?") — out of scope.
- **Multi-language support** (jolpica returns English by default; football-data has localization headers we don't use).

---

## Acceptance criteria for declaring Phase 2 done

- [ ] User can say *"refresh Champions League"* in Claude Desktop and watch the full flow: fetch → diff → review → commit, all without dictating event details.
- [ ] User can say *"create the World Cup 2026 calendar"* and get a scaffold (with TBD slot fixtures since the draw hasn't happened yet).
- [ ] User can say *"refresh F1"* and get the latest 2026 schedule from jolpica-f1.
- [ ] If `FOOTBALL_DATA_TOKEN` is unset, soccer fetches fail with a clear "set this env var" error; F1 still works.
- [ ] `list_providers` shows configured providers and their auth status.
- [ ] All Phase 1 tests still pass; new tests cover happy paths + error paths for each provider.
- [ ] Updated calendar-bot README covers the new auto-fetch flow + the new env var.
- [ ] [phase-2-todo.md](./phase-2-todo.md) all items checked.

---

## Estimated effort

Roughly **6-8 hours of focused work**, modulo answers to Q1–Q5:

- Steps 1–3 (provider scaffolding + first soccer adapter): ~3 hours
- Step 4 (auto-fetch wiring): ~1 hour (small change against existing tools)
- Steps 5–6 (create_calendar auto-fetch + F1 adapter): ~2 hours
- Steps 7–8 (diagnostic tool + README): ~1 hour
- Testing + smoke-testing against real APIs: ~1 hour

The bulk of the time is in step 2 — building one good adapter establishes
the pattern. Steps 3 and 6 are largely repetition.

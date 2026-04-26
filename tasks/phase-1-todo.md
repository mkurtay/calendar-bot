# Phase 1 — Step-by-step execution plan

> Companion to [phase-1-architecture.md](./phase-1-architecture.md).
> Each step ends in a commit. Acceptance criteria are explicit; do not
> mark a step done until its criteria pass.

---

## Step 1 — Path A: McpServer swap

**Files touched:** [src/server.ts](../src/server.ts) only.

**Changes:**
- `import { Server } from "@modelcontextprotocol/sdk/server/index.js"` → `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`
- `function createServer(...): Server` → `function createServer(...): McpServer`
- `new Server({...}, {...})` → `new McpServer({...}, {...})`
- `server.setRequestHandler(...)` → `mcp.server.setRequestHandler(...)` (twice)
- Local variable rename `server` → `mcp` for clarity

**Acceptance:**
- [ ] `pnpm typecheck` passes with zero errors and zero deprecation warnings on `Server`
- [ ] `pnpm build` produces `dist/src/server.js` cleanly
- [ ] Manual `initialize` test against `dist/src/server.js` returns the expected JSON-RPC response
- [ ] Restart Claude Desktop; `list_calendars` works as before

**Commit:** `Migrate to McpServer (deprecation cleanup, Path A)`

---

## Step 2 — `config.ts` extraction

**Files touched:** [src/server.ts](../src/server.ts), `src/config.ts` (new).

**Changes:**
- Move `process.env["GITHUB_TOKEN"]`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH` reads into `loadConfig(): Config` in `src/config.ts`.
- Add `__tests__/config.test.ts` covering missing-token rejection.

**Acceptance:**
- [ ] `pnpm test config` passes
- [ ] `server.ts` no longer reads `process.env` directly

**Commit:** `Extract env config into src/config.ts with tests`

---

## Step 3 — `models/` layer (types + soccer + F1)

**Files touched:** all under `src/models/` (new), tests under `src/__tests__/models/`.

**Changes:**
- `models/types.ts` — base `Calendar`, `Event`, `EventStatus`, `EventResult`, `Presentation` types.
- `models/soccer/index.ts` — discriminated `SoccerEvent` (Group | KO).
- `models/soccer/stages.ts` — `SoccerStage` enum, `normalizeStage(api: string): SoccerStage`, `stageOrder` array, tests for both football-data and api-football inputs.
- `models/soccer/legs.ts` — `deriveLegs(events): SoccerEvent[]` pairing helper, tests with synthetic UCL R16 / WC R32 fixtures.
- `models/soccer/tbd.ts` — `isTBD(event)`, `tbdTitle(event)` for pre-draw rendering hints.
- `models/soccer/validators.ts` — `validateSoccerEvent(event)` returns `{ ok, errors }`.
- `models/formula1/{index,sessions,validators}.ts` — F1 equivalents.
- `models/registry.ts` — `category → { validate, slugify, defaults }` lookup.

**Acceptance:**
- [ ] `pnpm test models` passes
- [ ] Stage normalization handles `LAST_16`, `Round of 16`, `R16` → all map to `R16`
- [ ] Leg derivation correctly assigns 1/2 across same-pair UCL ties

**Commit:** `Add per-category models with stage normalization and leg derivation`

---

## Step 4 — Diff engine + merge policy

**Files touched:** all under `src/diff/` (new), tests under `src/__tests__/diff/`.

**Changes:**
- `diff/compute.ts` — `diff(current, incoming): { added, updated, removed, conflicts }` keyed by `uid`.
- `diff/policy.ts` — implements the locked Q2 rules:
  - Source wins for upcoming `start`/`end`/`location`/teams.
  - Local `result` preserved when set; source fills only when local is `null`.
  - `local_only: true` events skip source-side updates entirely.
- `diff/tokens.ts` — short-lived (10 min) in-memory token store mapping `token → pending diff`.
- Tests cover all three Q2 sub-rules plus token expiry.

**Acceptance:**
- [ ] `pnpm test diff` passes
- [ ] Merge policy preserves a manually-set `result` when source returns a different one
- [ ] `local_only: true` events neither updated nor removed by diff

**Commit:** `Add diff engine with merge policy and review-token storage`

---

## Step 5 — `create_calendar` tool

**Files touched:** `src/tools/create-calendar.ts` (new), `src/server.ts` (registers the tool).

**Changes:**
- Tool input: `{ name, category, id?, html_file?, presentation?, events }`.
- Auto-derive `id` from `name` via `slugify` if absent.
- Validate events with the registered category validator.
- Write JSON to `data/<id>.json` via `CalendarStore.create(...)` (new method).
- Tool description includes LLM-facing examples.
- Tests with passthrough `manual.ts` provider.

**Acceptance:**
- [ ] `pnpm test create-calendar` passes
- [ ] Tool refuses to create if `id` already exists in repo
- [ ] Manual smoke test: ask Claude Desktop to create a tiny new test calendar, verify commit at `mkurtay/kurtays-calendar`

**Commit:** `Add create_calendar tool with category validation`

---

## Step 6 — `update_calendar` + `apply_calendar_update`

**Files touched:** `src/tools/update-calendar.ts` (new), `src/tools/apply-calendar-update.ts` (new), `src/server.ts`.

**Changes:**
- `update_calendar({ id, events })` — runs diff against current state, stashes pending diff in `tokens.ts`, returns `{ token, summary, diff }`.
- `apply_calendar_update({ token })` — looks up pending diff, commits to GitHub. Rejects expired/unknown tokens with helpful error.
- Tests cover round-trip and rejection paths.

**Acceptance:**
- [ ] `pnpm test update-calendar` passes
- [ ] Two-tool round-trip works: `update_calendar` → `apply_calendar_update` → commit lands
- [ ] Expired token returns clear error message

**Commit:** `Add update_calendar review-then-commit flow`

---

## Step 7 — De-emphasize granular tools

**Files touched:** [src/tools.ts](../src/tools.ts) (or wherever `add_event` etc. live), `src/server.ts`.

**Changes:**
- Prefix each granular tool description with `(advanced — prefer create_calendar / update_calendar when possible)`.
- No behavior change.

**Acceptance:**
- [ ] `pnpm typecheck` clean
- [ ] Manual smoke test: Claude Desktop tool list shows updated descriptions

**Commit:** `Nudge LLMs toward high-level calendar tools in descriptions`

---

## Step 8 — `render-index.mjs` in kurtays-calendar

**Repo:** `kurtays-calendar`. **Files touched:** `scripts/render-index.mjs` (new), `index.html` (add markers), `.github/workflows/deploy.yml` (add render step), `data/*.json` (add `presentation` blocks).

**Changes:**
- Add `<!-- BEGIN GENERATED:calendars -->` / `<!-- END GENERATED:calendars -->` markers around the existing `.grid` content in `index.html`.
- New `scripts/render-index.mjs`: read `data/*.json`, sort by `id`, compute upcoming count + date range + inline next-3 events per calendar, emit cards with `data-events`, `style="animation-delay: ..."`.
- Add inline `<script>` near end of `index.html` for live/next-up logic (~25 LOC).
- Migrate existing editorial copy from `index.html` cards into each calendar's JSON `presentation` block.
- Add `node scripts/render-index.mjs` step to `deploy.yml` between the existing render-html and AWS-config steps.

**Acceptance:**
- [ ] Local `node scripts/render-index.mjs` produces expected card markup
- [ ] Visual diff shows current cards re-rendered identically (no regression in look)
- [ ] CI deploy succeeds; live index page shows "Next: ..." text and live badge logic
- [ ] No-JS fallback: cards still show editorial subtitle with JS disabled

**Commit:** `Auto-render index page from data/*.json; add live + next-up`

---

## Step 9 — README updates

**Files touched:** [README.md](../README.md) in calendar-bot, `README.md` in kurtays-calendar.

**Changes:**
- calendar-bot README: document new tool surface (`create_calendar`, `update_calendar`, `apply_calendar_update`), mention granular tools as advanced fallback.
- kurtays-calendar README: explain that `data/*.json` is now the source of truth for *both* events *and* index card metadata; mention the new auto-render step.

**Acceptance:**
- [ ] Both READMEs accurately describe the post-Phase-1 system
- [ ] No stale references to direct `add_event` instructions

**Commit (each repo):** `Document Phase 1 tool surface and index auto-render`

---

## Out of scope (Phase 2+)

Tracked here so they're not accidentally pulled in:

- Actual `FixtureProvider` implementations (football-data.org, jolpica). **Phase 2.**
- Standings tables, leg aggregates, championship charts. **Phase 4.**
- HTTP transport, Telegram bot, OAuth. **Phase 5+.**
- Group-by-category index layout. **Defer until 5+ calendars.**

---

## Status legend

`[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked

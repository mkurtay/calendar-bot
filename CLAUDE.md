# CLAUDE.md

Project context for the `calendar-bot` repo. Sister project to [`mkurtay/kurtays-calendar`](https://github.com/mkurtay/kurtays-calendar).

## What this is

An MCP server that exposes calendar mutation tools. Tools mutate `data/*.json` files in the `mkurtay/kurtays-calendar` repo via the GitHub Contents API. Each tool call produces a real commit; the calendar repo's CI handles render + deploy.

The tool surface has two tiers: **high-level tools** (`create_calendar`, `update_calendar`, `apply_calendar_update`) handle bulk operations with category validation and review-then-commit semantics. **Granular tools** (`add_event`, `update_event`, `remove_event`, `set_result`) cover one-off cases as a fallback.

## Architecture

```
src/
├── server.ts                  MCP server wiring + stdio entry point
├── config.ts                  Env-driven config (GitHub token, owner/repo/branch)
│
├── github.ts                  Octokit wrapper (listFiles, getFile, putFile, createFile)
├── calendar-store.ts          High-level: list/get/save/create calendars
│
├── models/                    Per-category domain layer
│   ├── types.ts               Base Calendar, Event, Presentation, isISOUTC, ValidationResult
│   ├── soccer/                SoccerEvent + stages, legs, TBD slots, validators, SoccerResult
│   ├── formula1/              F1Event + sessions, validators
│   └── registry.ts            Category dispatcher (validate, validateCalendar, slugify)
│
├── diff/                      Calendar diff engine
│   ├── compute.ts             diff(current, incoming) → CalendarDiff
│   ├── policy.ts              mergeEvent + describeChanges (Q2 rules)
│   ├── tokens.ts              Generic TokenStore<T> for review-then-commit
│   └── types.ts               CalendarDiff, DiffEntry, FieldChange
│
├── tools/                     High-level MCP tools (recommended)
│   ├── create-calendar.ts
│   ├── update-calendar.ts
│   ├── apply-calendar-update.ts
│   └── update-context.ts      Shared TokenStore<PendingUpdate>
│
├── tools.ts                   Granular legacy tools (advanced/fallback)
└── __tests__/                 171 tests across config, models, diff, tools
```

The MCP server is **transport-agnostic** at the core. Phase 1 ships stdio only; Phase 3+ will add an HTTP transport in `src/http.ts` for Lambda deploy.

See [`tasks/phase-1-architecture.md`](tasks/phase-1-architecture.md) for the locked Q1–Q5 design decisions (merge policy, review-then-commit, per-category validators) and [`tasks/phase-2-architecture.md`](tasks/phase-2-architecture.md) for the next-phase plan.

## Stack

- TypeScript strict (`tsconfig.json` has `noUncheckedIndexedAccess`, `noImplicitOverride`, explicit `types: ["node", "jest"]`)
- pnpm
- Jest 30 with ts-jest ESM preset (171 tests across 12 suites)
- `@modelcontextprotocol/sdk` v1 (`McpServer` high-level API)
- `@octokit/rest` for GitHub API
- `tsc` build (output `dist/src/server.js`); `tsx` available for ad-hoc TS execution

## Important conventions

- **All commits to mkurtay/kurtays-calendar are produced by tool calls.** The commit message is generated inside the tool (e.g. *"Create calendar: Premier League Test"*, *"Update champions-league-2026: 36 updated"*).
- **SHA-based optimistic concurrency**: every `getFile` returns a SHA; `putFile` requires it. If two tool calls race on the same file, the second gets a 409 Conflict from GitHub and the tool surfaces the error.
- **The schema is owned by this repo** (under `src/models/`), validated through the registry's `validate` (per-event) and `validateCalendar` (cross-rules) hooks. The kurtays-calendar repo trusts whatever this MCP commits, but its CI (`render-html.mjs`, `render-ics.mjs`) will fail loudly if anything is malformed.
- **Date format is ISO-8601 UTC ending in 'Z'.** Validators reject anything else (offset suffixes, missing Z, non-ISO).
- **Review-then-commit (Q1)**: `update_calendar` returns a token + diff for review; `apply_calendar_update` commits the stashed diff. Tokens are one-shot and expire after 10 minutes.

## Phased rollout

- **Phase 1** — stdio MCP for Claude Desktop with high-level + granular tools, per-category models, diff engine, review-then-commit. **Shipped.**
- **Phase 1.x** — Granular tools validate via category model (catches stage/result errors before commit). **Shipped.**
- **Phase 2** — Auto-fetching fixture data from external sources: football-data.org for UCL/WC, jolpica-f1 for F1. The `events` parameter on `update_calendar`/`create_calendar` becomes optional; when omitted, a registered `FixtureProvider` populates it. See [`tasks/phase-2-todo.md`](tasks/phase-2-todo.md) for the 8-step plan.
- **Phase 3+** — HTTP transport (`src/http.ts`), Lambda deploy via Terraform, Telegram bot Lambda, scheduled refresh.
- **Phase 4** — Renderer polish in kurtays-calendar (standings tables, leg aggregates, championship charts, penalty-shootout details).

## Things to remember when working here

- **Per the user's global CLAUDE.md**: TypeScript strict, no `any`, prefer interfaces over types, explicit return types on functions, `const` by default. Run `pnpm typecheck` to verify.
- **Test discipline**: write tests as you go. Run `pnpm test` after changes; expect 171 to pass. Add tests in the matching `__tests__/` subdirectory using `.test.ts` suffix.
- **Build cycle**: after editing `src/`, run `pnpm build` to refresh `dist/src/server.js`. Then **fully quit Claude Desktop (⌘Q + reopen)** to load the rebuilt server — Claude Desktop spawns the MCP child process once at launch and keeps it alive; there is no hot-reload.
- **Shape of any new tool**: takes `(store: CalendarStore, params)`, returns a JSON-serializable result, throws on error (server.ts catches and converts to MCP `isError: true` response). For category-aware tools that mutate state, validate against `model.validateCalendar` (preferred) or `model.validate` (per-event) before saving.
- **Granular tools (advanced/fallback)** validate per-event via the category model since Phase 1.x. They cannot enforce cross-rules (type→stage compatibility, team-id refs); for that, route through `update_calendar` which uses `validateSoccerCalendar`.

## Useful kurtays-calendar conventions to know

When generating events for a calendar, follow the patterns established in the existing data:

- **UCL events** (`type: "cup_swiss"`): `uid` like `ucl-sf-1-1@cl26`, title like `UCL SF: PSG vs Bayern München (1st Leg)`, emoji `⚽` (Final uses `🏆`), typed_block `soccer: { home, away, stage, leg, matchday?, home_id?, away_id? }`. Stages: `LeaguePhase` (the league stage), then `R16`/`Quarterfinal`/`Semifinal`/`Final`.
- **WC events** (`type: "cup_groups"`): `uid` like `wc2026-gs-NNN@worldcup` (group stage) or `wc2026-ko-NNN@worldcup` (knockouts), title like `WC Group A: Mexico vs South Africa`, typed_block `soccer: { home, away, stage, group, matchday, match_number?, home_id?, away_id? }`. Group events require `group` letter and `matchday` (1/2/3).
- **F1 events**: `uid` like `f1-2026-rNN-race@formula1`, title like `Miami GP`, emoji `🏁` (season finale `🏆`), typed_block `formula1: { round, gp_name, circuit, city, country, session, is_sprint_weekend }`.
- **Locations** are `Venue, City` strings; the renderer splits on the first comma.
- **TBD pre-draw fixtures** (e.g. WC 2026 before the December 5, 2025 draw): use `home: null` / `away: null`. The validator allows null teams; `home_id`/`away_id` should be omitted, not invented.
- **Calendar metadata**: every calendar has `presentation: { subtitle, badge_label, accent_color, icon? }` for the index card. Soccer calendars also carry `type` (one of `league`/`cup_groups`/`cup_swiss`) and optional `teams: [{ id, name }]` for the standings registry.

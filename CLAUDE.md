# CLAUDE.md

Project context for the `calendar-bot` repo. Sister project to [`mkurtay/kurtays-calendar`](https://github.com/mkurtay/kurtays-calendar).

## What this is

An MCP server that exposes calendar mutation tools. Tools mutate `data/*.json` files in the `mkurtay/kurtays-calendar` repo via the GitHub Contents API. Each tool call produces a real commit; the calendar repo's CI handles render + deploy.

## Architecture

```
src/
├── github.ts          Octokit wrapper (listFiles / getFile / putFile)
├── calendar-store.ts  Higher-level: list/get/save calendars, with SHA tracking
├── tools.ts           Tool implementations: list, add, update, remove, set_result
└── server.ts          MCP server wiring + stdio entry point
```

The MCP server is **transport-agnostic** at the core (`tools.ts` knows nothing about MCP or stdio). Phase 1 ships stdio only; Phase 2 will add an HTTP transport in `src/http.ts` for Lambda deploy.

## Stack

- TypeScript strict (`tsconfig.json` has `noUncheckedIndexedAccess`, `noImplicitOverride`, etc.)
- pnpm
- Jest (TODO: add tests in next iteration)
- `@modelcontextprotocol/sdk` for the MCP server
- `@octokit/rest` for GitHub API calls
- `tsx` for dev (Phase 1 doesn't need a build step)

## Important conventions

- **All commits to mkurtay/kurtays-calendar are produced by tool calls.** The commit message is generated inside the tool (e.g. "Add event: Miami GP", "Update event ucl-sf-1-1@cl26: …").
- **SHA-based optimistic concurrency**: every `getFile` returns a SHA; `putFile` requires it. If two tool calls race on the same file, the second gets a 409 Conflict from GitHub and the tool surfaces the error.
- **The schema is owned by the kurtays-calendar repo**, not this one. This repo trusts what Claude generates against the tool descriptions. If the JSON gets corrupted, the calendar repo's CI fails (renderer crashes) and prevents a bad deploy — `verify` job runs before `deploy` in `kurtays-calendar/.github/workflows/deploy.yml`.
- **Date format is ISO-8601 UTC ending in 'Z'.** The calendar renderers reject anything else.

## Phased rollout

- **Phase 1** — stdio MCP for Claude Desktop. Local only. ← _current_
- **Phase 2** — HTTP transport, Lambda deploy via Terraform in `~/workspace/tinbee/infra-aws/terraform/agents/calendar-bot/`.
- **Phase 3** — Telegram bot Lambda that calls Claude API with this MCP server attached.

## Things to remember when working here

- **Don't add tests until iteration 2.** Phase 1 is "make it work end-to-end". Tests next pass.
- **Don't introduce a build step yet.** `tsx` runs the TS directly. Add `tsc` build in Phase 2 when shipping to Lambda.
- **Per the user's global CLAUDE.md**: TypeScript strict, no `any`, prefer interfaces over types, explicit return types on functions, `const` by default. Run `pnpm typecheck` to verify.
- **Shape of any new tool**: takes `(store: CalendarStore, params)`, returns a JSON-serializable result, throws on error (server.ts catches and converts to MCP `isError: true` response).

## Useful kurtays-calendar conventions to know

When generating events for a calendar via `add_event`, follow the patterns established in the existing data:

- **UCL events**: `uid` like `ucl-sf-1-1@cl26`, title like `UCL SF: PSG vs Bayern München (1st Leg)`, emoji `⚽` (Final uses `🏆`), `typed_block: { soccer: { home, away, stage, leg } }`.
- **WC events**: `uid` like `wc2026-gs-NNN@worldcup` (group stage) or `wc2026-ko-NNN@worldcup` (knockouts), title like `WC Group A: Mexico vs South Africa`, `typed_block: { soccer: { home, away, stage, group, match_number } }`.
- **F1 events**: `uid` like `f1-2026-rNN-race@formula1`, title like `Miami GP` (just the short name), emoji `🏁` (`🏆` for season finale), `typed_block: { formula1: { round, gp_name, circuit, city, country, session, is_sprint_weekend } }`.
- **Locations** are `Venue, City` strings; the renderer splits on the first comma.

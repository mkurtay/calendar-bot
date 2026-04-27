# calendar-bot

MCP server that mutates the [`mkurtay/kurtays-calendar`](https://github.com/mkurtay/kurtays-calendar) data files. Designed as the durable tools layer behind:

- **Phase 1** — Claude Desktop (stdio transport, local) ← *current*
- **Phase 2** — Auto-fetching from external sources (football-data.org for soccer, jolpica-f1 for F1)
- **Phase 3+** — HTTP transport (Claude.ai web, Telegram bot via AWS Lambda), standings/charts in renderer

See [`tasks/phase-1-architecture.md`](tasks/phase-1-architecture.md) for the design decisions behind the current shape, and [`tasks/phase-2-architecture.md`](tasks/phase-2-architecture.md) for the next-phase plans.

## How it works

```
You ──ask──▶ Claude Desktop ──MCP stdio──▶ this server
                                               │
                                               ├─▶ GitHub API (commit data/*.json)
                                               │
GitHub Actions in kurtays-calendar ──renders─▶ S3 + CloudFront (calendar.kurtays.com)
```

Mutations to calendar JSON go through this server; the kurtays-calendar repo's CI then re-renders the per-calendar HTML pages, the index page, and the .ics files, and pushes everything to S3.

## Setup (Phase 1, local)

### 1. Generate a GitHub PAT

Fine-grained PAT scoped to `mkurtay/kurtays-calendar`:
- https://github.com/settings/personal-access-tokens/new
- Repository access: **Only select repositories** → `mkurtay/kurtays-calendar`
- Permissions: **Contents** (Read and write), **Metadata** (Read)
- Save the `ghp_...` token somewhere secure (1Password, macOS Keychain).

### 2. Install + build

```bash
cd ~/workspace/calendar-bot
pnpm install
pnpm build
```

The build emits compiled JS to `dist/src/server.js`. Claude Desktop runs that artifact directly (faster startup than running TS source through `tsx`, and avoids PATH-resolution quirks on macOS where Claude Desktop spawns from launchd without your shell's environment).

Re-run `pnpm build` whenever you change `src/`.

### 3. Wire up Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kurtays-calendar": {
      "command": "/Users/mkurtay/.local/share/fnm/aliases/default/bin/node",
      "args": [
        "/Users/mkurtay/workspace/calendar-bot/dist/src/server.js"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Notes:
- The `command` must be an **absolute path to your `node` binary**, because Claude Desktop launches from launchd and doesn't inherit your shell's PATH. If you use `fnm` or `nvm`, the right path is something like `~/.local/share/fnm/aliases/default/bin/node` (fnm) or `~/.nvm/versions/node/<version>/bin/node` (nvm). Run `which node` in your shell to find yours, then use the *stable* alias path (not the session-specific multishells path that changes on reboot).
- Replace `ghp_xxxx...` with your real token from step 1.
- If the file doesn't exist, create it. If it has other `mcpServers` already, add the `kurtays-calendar` key alongside them.

Then **fully quit Claude Desktop** (⌘Q, not just close window) and reopen.

### 4. Verify

In a new Claude Desktop conversation:

```
What calendars do I have in my hub?
```

You should see Claude call `list_calendars` and respond with your calendars (Champions League, World Cup, Formula 1, etc.).

Try a mutation through the high-level review-then-commit flow:

```
Refresh formula-1-2026 with the latest schedule. I'll review the diff before you commit anything.
```

Claude should call `update_calendar`, return a structured diff (added / removed / updated events), and wait for your approval. After you say "go ahead," it calls `apply_calendar_update` with the token. Watch [github.com/mkurtay/kurtays-calendar/commits/main](https://github.com/mkurtay/kurtays-calendar/commits/main) — a single commit should appear with a clear message like *"Update formula-1-2026: 1 added, 2 updated."*

The kurtays-calendar repo's CI then renders + deploys (~30 seconds). Visit [calendar.kurtays.com/f1-2026.html](https://calendar.kurtays.com/f1-2026.html) to see the result.

## Tools

The high-level tools are the recommended path for most operations. The granular tools are still available for one-off cases (a single result update, an out-of-band manual event), but the high-level tools handle bulk changes more cleanly and apply the merge policy automatically.

### High-level (recommended)

| Tool | What it does |
|---|---|
| `create_calendar` | Scaffold a brand-new calendar (`data/<id>.json`) with category-validated events. Auto-derives the id from the name via slugify. Rejects if a calendar with that id already exists. |
| `update_calendar` | Compute a diff between a calendar's current events and a desired event list. Returns a token + summary. **Does not commit.** |
| `apply_calendar_update` | Commit a previously-computed update by token. One-shot; tokens expire after 10 minutes. |

The `update_calendar` → `apply_calendar_update` flow exists so the user always reviews bulk changes before they hit `main`. The diff also applies a fixed merge policy:

- **Source wins on schedule** — start, end, location, title, teams.
- **Local result wins** — if you've recorded a result on a completed event, source updates can't overwrite it.
- **`local_only` events are sticky** — events you added by hand (with `local_only: true`) survive future updates even if source omits them.

### Information

| Tool | What it does |
|---|---|
| `list_calendars` | Summary of all calendars (id, name, category, event count, upcoming count). |
| `list_events` | Events in one calendar, optionally filtered by date range. Useful for inspecting current state before calling `update_calendar`. |

### Granular (advanced — fallback)

These tools predate the high-level surface. Each is still useful for one-off changes that don't fit the bulk-update pattern, but for anything beyond a single event the high-level tools are simpler and safer.

| Tool | What it does |
|---|---|
| `add_event` | Add a single event by hand. |
| `update_event` | Shallow-merge a patch into one event. |
| `remove_event` | Delete one event by UID. |
| `set_result` | Record a result on a completed event. The result is then preserved across future `update_calendar` runs (local result wins by policy). |

Full schemas: see `TOOL_DEFINITIONS` and the per-tool modules in [src/tools/](src/tools/).

## Categories

Each calendar declares a `category` that determines event validation and (eventually) the data fetcher used by `update_calendar` to refresh from external sources.

| Category | Validator | Fetcher (Phase 2) |
|---|---|---|
| `soccer` | [src/models/soccer/validators.ts](src/models/soccer/validators.ts) | football-data.org (`/competitions/CL`, `/competitions/WC`) |
| `formula1` | [src/models/formula1/validators.ts](src/models/formula1/validators.ts) | jolpica-f1 (`api.jolpi.ca/ergast/f1/`) |

Adding a category (NBA, NFL, tennis, …) is a one-line entry in [src/models/registry.ts](src/models/registry.ts) plus the per-category model module.

## Architecture

```
src/
├── server.ts                  # McpServer entry, registers all tools
├── config.ts                  # Env-driven GitHub config (testable via injection)
│
├── github.ts                  # Octokit wrapper: getFile, putFile, createFile, listFiles
├── calendar-store.ts          # JSON read/write at data/<id>.json
│
├── models/                    # Per-category domain layer
│   ├── types.ts               # Base Calendar, Event, ValidationResult, isISOUTC
│   ├── soccer/                # SoccerEvent + stages, legs, TBD slots, validators
│   ├── formula1/              # F1Event + sessions, validators
│   └── registry.ts            # category → { validate } dispatcher; slugify
│
├── diff/                      # Calendar diff engine
│   ├── compute.ts             # diff(current, incoming) → CalendarDiff
│   ├── policy.ts              # mergeEvent + describeChanges (Q2 rules)
│   ├── tokens.ts              # TokenStore<T> for review-then-commit
│   └── types.ts               # CalendarDiff, DiffEntry, FieldChange
│
├── tools/                     # MCP tool definitions + handlers
│   ├── create-calendar.ts     # high-level: scaffold a new calendar
│   ├── update-calendar.ts     # high-level: compute diff, return token
│   ├── apply-calendar-update.ts  # high-level: commit by token
│   └── update-context.ts      # shared TokenStore<PendingUpdate>
│
├── tools.ts                   # legacy granular tools (add_event, update_event, etc.)
└── __tests__/                 # 111 tests across config, models, diff, tools
```

Phase 2 will add `src/fetchers/` (football-data, jolpica adapters) implementing a `FixtureProvider` interface, plus auto-fetch variants of `update_calendar` and `create_calendar` that don't require the user to dictate events. Phase 3+ adds an HTTP transport (`src/http.ts`) for Claude.ai web + the Telegram bot.

## Security model

For Phase 1 (this), the only secret is the GitHub PAT. It lives in your `~/Library/Application Support/Claude/claude_desktop_config.json`'s `env` block. The MCP server runs as a stdio subprocess of Claude Desktop — there is no network listener.

If you accidentally commit or share the token, **revoke it immediately** at https://github.com/settings/tokens. GitHub auto-detects `ghp_*` token leaks in public surfaces and revokes them, but the prefix is also a useful self-reminder: see one in chat or a screenshot, treat it as compromised.

For Phase 3+ (HTTP transport, deployed to Lambda), an additional `MCP_BEARER_TOKEN` will be required as a shared secret between the bot Lambda and the MCP server.

## Development

```bash
pnpm test           # Run all tests (111 across 9 suites)
pnpm test config    # Run tests for the config module only
pnpm typecheck      # tsc --noEmit
pnpm build          # Compile to dist/src/server.js
```

When iterating on the server itself: `pnpm build` after each change, then **fully quit and reopen Claude Desktop** to load the rebuilt artifact (Claude Desktop spawns the MCP server once on launch and keeps the process alive — there's no hot-reload).

For pure logic work (models, diff engine), `pnpm test` is the fast inner loop — no Claude Desktop restart needed.

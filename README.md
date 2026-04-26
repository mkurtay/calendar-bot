# calendar-bot

MCP server that mutates the [`mkurtay/kurtays-calendar`](https://github.com/mkurtay/kurtays-calendar) data files. Designed as the durable tools layer behind:

- **Phase 1** — Claude Desktop (stdio transport, local) ← *current*
- **Phase 2** — Claude.ai web + Claude API via Custom Connectors (HTTP transport, AWS Lambda)
- **Phase 3** — Telegram bot (Lambda calls Claude API with this MCP server attached)

See [`tasks/todo.md`](tasks/todo.md) for the phased rollout checklist.

## How it works

```
You ──ask──▶ Claude Desktop ──MCP stdio──▶ this server
                                               │
                                               ├─▶ GitHub API (commit data/*.json)
                                               │
GitHub Actions in mkurtays-calendar ──renders─▶ S3 + CloudFront (calendar.kurtays.com)
```

Each tool call produces a real commit. The kurtays-calendar repo's CI handles render + deploy automatically.

## Setup (Phase 1, local)

### 1. Generate a GitHub PAT

Fine-grained PAT scoped to `mkurtay/kurtays-calendar`:
- https://github.com/settings/personal-access-tokens/new
- Repository access: **Only select repositories** → `mkurtay/kurtays-calendar`
- Permissions: **Contents** (Read and write), **Metadata** (Read)
- Save the resulting `ghp_...` token somewhere secure (1Password, macOS Keychain).

### 2. Install dependencies

```bash
cd ~/workspace/calendar-bot
pnpm install
```

### 3. Wire up Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kurtays-calendar": {
      "command": "npx",
      "args": ["-y", "tsx", "/Users/mkurtay/workspace/calendar-bot/src/server.ts"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

(If the file doesn't exist, create it. If it has other `mcpServers` already, just add the `kurtays-calendar` key.)

Then **fully quit Claude Desktop** (⌘Q, not just close window) and reopen.

### 4. Verify

In a new Claude Desktop conversation:

```
What calendars do I have in my hub?
```

You should see Claude call `list_calendars` and respond with the three calendars (Champions League, World Cup, Formula 1).

Try a mutation:

```
Add a placeholder event called "Test Event" to formula-1-2026, July 4 2026 from 6 PM to 8 PM ET.
```

Watch [github.com/mkurtay/kurtays-calendar/commits/main](https://github.com/mkurtay/kurtays-calendar/commits/main) — a new commit should appear within a few seconds. Then wait ~1 min for the calendar repo's CI to render and deploy. Visit [calendar.kurtays.com/f1-2026.html](https://calendar.kurtays.com/f1-2026.html) to see the test event.

Clean up:

```
Remove the Test Event from formula-1-2026.
```

## Tools

All tools commit to `mkurtay/kurtays-calendar:main` on success. Optimistic concurrency via SHA — if a race occurs, the API returns 409 and the tool surfaces the error.

| Tool | What it does |
|---|---|
| `list_calendars` | Summary of all calendars (id, name, category, event count, upcoming count) |
| `list_events` | Events in one calendar, optionally filtered by date range |
| `add_event` | Add a new event (auto-generates UID if not provided) |
| `update_event` | Shallow-merge a patch into an existing event |
| `remove_event` | Delete an event |
| `set_result` | Record a result and mark the event completed |

Full schema: see `TOOL_DEFINITIONS` in [src/server.ts](src/server.ts).

## Security model

For Phase 1 (this), the only secret is the GitHub PAT. It lives in your `~/Library/Application Support/Claude/claude_desktop_config.json`'s `env` block (or in a `.env` file you source manually). The MCP server runs as a stdio subprocess of Claude Desktop — there is no network listener.

For Phase 2 (HTTP transport, deployed to Lambda), an additional `MCP_BEARER_TOKEN` is required as a shared secret between the bot Lambda and the MCP server. See `tasks/todo.md` for that work.

## Architecture

| File | Purpose |
|---|---|
| [src/github.ts](src/github.ts) | Octokit wrapper. `getFile`, `putFile`, `listFiles`. |
| [src/calendar-store.ts](src/calendar-store.ts) | High-level read/write of calendar JSONs. |
| [src/tools.ts](src/tools.ts) | Tool implementations (transport-agnostic). |
| [src/server.ts](src/server.ts) | MCP server wiring + stdio entry point. |

Phase 2 will add `src/http.ts` (HTTP transport entry) without changing the others.

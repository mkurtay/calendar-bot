# calendar-bot — TODO

Phased rollout. Each phase is independently shippable.

---

## Phase 1: stdio MCP server (local) — IN PROGRESS

**State after initial scaffold (this commit):** all source files in place, no tests yet, no commit history beyond the initial scaffold.

### Setup tasks (you, the human)
- [ ] Generate GitHub fine-grained PAT scoped to `mkurtay/kurtays-calendar`
  - https://github.com/settings/personal-access-tokens/new
  - Repository access: Only select repositories → `mkurtay/kurtays-calendar`
  - Permissions: Contents (Read and write), Metadata (Read)
  - Copy the resulting `ghp_...` token; you'll paste it into Claude Desktop config below.
- [ ] Run `pnpm install` in this repo
- [ ] Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add:
  ```json
  {
    "mcpServers": {
      "kurtays-calendar": {
        "command": "npx",
        "args": ["-y", "tsx", "/Users/mkurtay/workspace/calendar-bot/src/server.ts"],
        "env": { "GITHUB_TOKEN": "ghp_..." }
      }
    }
  }
  ```
- [ ] Quit Claude Desktop fully (⌘Q) and reopen
- [ ] Smoke test: ask Claude "list my calendars" → should show three calendars with event counts
- [ ] Mutation test: ask Claude to add a placeholder event, watch the commit land at https://github.com/mkurtay/kurtays-calendar/commits/main
- [ ] Mutation test: ask Claude to remove that placeholder
- [ ] If the smoke tests pass: make an initial commit in this repo and push

### Code tasks (Claude Code, when you return)
- [ ] Add Jest test setup (`jest.config.ts`, `tests/` directory)
- [ ] Write tests for `src/github.ts` (mocked Octokit)
- [ ] Write tests for `src/calendar-store.ts` (mocked GitHub)
- [ ] Write tests for each tool in `src/tools.ts` (mocked CalendarStore)
- [ ] Add a `src/__test-fixtures__/` with realistic calendar JSONs for tests
- [ ] Coverage target: 80%+

### Polish tasks (lower priority)
- [ ] Better error messages: when GitHub returns 404, surface as "Calendar 'X' not found" rather than raw API error
- [ ] Retry on 409 Conflict (SHA mismatch) — refetch and re-apply patch automatically once
- [ ] Validate ISO-8601 UTC format in tool inputs (currently trusts Claude)
- [ ] Validate `start < end` in `add_event`/`update_event`

---

## Phase 2: HTTP transport + Lambda deploy

Goal: make the MCP server reachable from Claude.ai web (via Custom Connectors) and from the Phase 3 Telegram bot Lambda.

### Code tasks
- [ ] Add `src/http.ts` — HTTP transport entry, using `StreamableHTTPServerTransport` from MCP SDK
- [ ] Add `src/lambda-mcp.ts` — Lambda handler that bridges API Gateway / Function URL events to the HTTP transport
- [ ] Add bearer-token validation middleware: read `MCP_BEARER_TOKEN` env var; reject requests where `Authorization: Bearer …` doesn't match
- [ ] Add a small build step (`tsc` → `dist/`) and a `Makefile` or `package.json` script to bundle the Lambda zip
- [ ] Add `package.json` script `pnpm build:lambda` that produces `dist/lambda.zip` ready for upload
- [ ] Local test: `curl` the HTTP server with a valid bearer token, confirm `tools/list` and `tools/call` work

### Infra tasks (in `~/workspace/tinbee/infra-aws`)
- [ ] Add `terraform/agents/calendar-bot/` mirroring `terraform/lambda/register-domain/` pattern:
  - Lambda function (Node 22.x runtime, handler = `src/lambda-mcp.handler`)
  - Function URL (or API Gateway + custom domain)
  - Secrets Manager entries: `GITHUB_TOKEN`, `MCP_BEARER_TOKEN`
  - IAM role for Lambda → Secrets Manager read access
  - GitHub OIDC role for this repo's CI to deploy
  - CloudWatch Logs group with retention
- [ ] Update `terraform/common/files/zones/tinbee.com.json` to add `mcp.tinbee.com` CNAME → Function URL host (optional; can use raw Lambda URL for v1)
- [ ] Apply Terraform: `terraform plan -out=tfplan && terraform apply tfplan`
- [ ] Note the Lambda URL and bearer token for use in Phase 3

### Repo CI tasks (this repo)
- [ ] Add `.github/workflows/deploy.yml` that builds Lambda zip, assumes the OIDC role, uploads via `aws lambda update-function-code`
- [ ] Push a commit; verify CI deploys successfully

### Verification
- [ ] Claude.ai web: register the Lambda URL as a Custom Connector with the bearer token. Verify `list_calendars` returns the three calendars.

---

## Phase 3: Telegram bot Lambda

Goal: build the public chat UI so you can text the calendar.

### Setup tasks (you)
- [ ] Talk to `@BotFather` on Telegram, create a new bot. Save the token (format: `123456:ABC-...`)
- [ ] Find your Telegram user ID: message `@userinfobot` or similar
- [ ] If you don't have an Anthropic API key yet, create one at https://console.anthropic.com
- [ ] Add the secrets to AWS Secrets Manager (in the Phase 2 Terraform): `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`. Update `TELEGRAM_ALLOWED_USER_IDS` env var with your ID.

### Code tasks
- [ ] Add `src/telegram-bot.ts` — Lambda handler that:
  1. Parses Telegram webhook payload
  2. Verifies `X-Telegram-Bot-Api-Secret-Token` header (use `setWebhook(...secret_token)`)
  3. Allowlists `message.from.id` against `TELEGRAM_ALLOWED_USER_IDS`
  4. Calls Anthropic API with the user message + `mcp_servers: [{ url: <Phase 2 URL>, authorization_token: MCP_BEARER_TOKEN }]`
  5. Returns Claude's text response via Telegram `sendMessage`
- [ ] Handle agent loop: Claude may make multiple tool calls; surface a single final text response
- [ ] Add basic rate-limit / max-iteration guard (don't let one message blow through 100 tool calls)

### Infra tasks
- [ ] Add a second Lambda in the same Terraform module (or a sibling module): `terraform/agents/telegram-bot/`
- [ ] Function URL for the Telegram webhook (Telegram needs HTTPS, valid cert, port 443)
- [ ] Secrets Manager: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `MCP_BEARER_TOKEN`, `MCP_SERVER_URL`
- [ ] IAM role with Secrets Manager read

### Configuration tasks (one-time, after deploy)
- [ ] `curl` Telegram's `setWebhook` API: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<LAMBDA_URL>&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
- [ ] Send "hi" from Telegram, verify the bot responds (echo something while testing)

### Verification
- [ ] From Telegram: "what F1 races are upcoming this month?"
- [ ] From Telegram: "mark Miami GP completed, Norris won. Set the result accordingly." Watch the commit + deploy.
- [ ] From Telegram (smoke test of allowlist): get a friend to message the bot — should be silently ignored.

---

## Open design questions

- **Concurrency / 409 retry**: should `update_event` auto-retry on SHA mismatch?
- **HTTP transport auth**: bearer token only, or also IP allowlist? Anthropic publishes egress ranges.
- **Multi-step tool plans**: Claude might issue 5+ tool calls per message. Add a `max_iterations` per request to cap costs?
- **UID generation**: `add_event` currently does `<calendar-id>-<8-hex>`. Match existing schemes per calendar instead? (e.g. `wc2026-gs-NNN@worldcup` keeps zero-padded sequence).
- **Cost cap**: what if I sleep-text the bot 50 times in a stupor? Add a daily/hourly tool-call quota?

---

## Architecture cheat-sheet

```
Tier 1 — UIs (swappable):
  Claude Desktop ────stdio─────┐
  Claude.ai web   ──Custom Connector─┐
  Telegram bot    ──Anthropic API mcp_servers─┐
                                              │
Tier 2 — durable:                             ▼
  This repo's MCP server (transport-agnostic core)
                                              │
                                              ▼
Tier 3 — state (already shipped):
  mkurtay/kurtays-calendar
  ├── data/*.json       ← what the bot mutates
  ├── scripts/render-*  ← regenerate .ics + .html
  └── .github/workflows/deploy.yml ← S3 + CloudFront
```

When in doubt: the MCP server is the durable artifact; everything else is replaceable.

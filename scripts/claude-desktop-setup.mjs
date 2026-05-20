#!/usr/bin/env node
// Prints a ready-to-paste Claude Desktop MCP config snippet for the
// calendar-bot server. Run after `pnpm --filter @calendar-bot/server
// build` succeeds — script doesn't build itself; the `pnpm
// claude:desktop` workspace script chains them.
//
// Usage: `pnpm claude:desktop`
//
// Output: instructions + a JSON block the user pastes into
//   ~/Library/Application Support/Claude/claude_desktop_config.json
// then restarts Claude Desktop.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "packages", "server", "dist", "src", "server.js");

const snippet = {
  mcpServers: {
    "calendar-bot": {
      command: "node",
      args: [serverEntry],
      env: {
        GH_TOKEN: "github_pat_REPLACE_WITH_YOUR_TOKEN",
        GITHUB_OWNER: "mkurtay",
        GITHUB_REPO: "cal",
        GITHUB_BRANCH: "main",
        FOOTBALL_DATA_TOKEN: "REPLACE_WITH_YOUR_FD_TOKEN_OR_REMOVE_LINE",
      },
    },
  },
};

const configPath =
  process.platform === "darwin"
    ? "~/Library/Application Support/Claude/claude_desktop_config.json"
    : process.platform === "win32"
      ? "%APPDATA%\\Claude\\claude_desktop_config.json"
      : "~/.config/Claude/claude_desktop_config.json";

console.log(`
✓ MCP server built at:
  ${serverEntry}

Add this block to ${configPath}
(merge with any existing "mcpServers" entries):

${JSON.stringify(snippet, null, 2)}

Notes:
  • Replace GH_TOKEN with a fine-grained PAT scoped to mkurtay/cal,
    Contents: Read and write. The same one in AWS Secrets Manager works.
  • FOOTBALL_DATA_TOKEN is optional — drop the line if you don't use
    the fetch_competition_* tools.
  • Then quit and restart Claude Desktop. The 🔌 icon at the bottom of
    the input box should list calendar-bot once it's connected.
`);

// esbuild config for the chat-lambda Lambda zip.
//
// Produces a single `dist/index.mjs` plus the MCP server's compiled JS
// (referenced as a subprocess at runtime). The zip is uploaded by the
// deploy workflow via `aws lambda update-function-code`.
//
// Externals are deliberately empty — Lambda's nodejs22.x runtime
// includes the AWS SDK, but the Agent SDK and Clerk SDK need to be
// bundled into the artifact.

import { build } from "esbuild";
import { rm, mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const serverDist = resolve(here, "..", "..", "packages", "server", "dist");

// Clean dist
if (existsSync(dist)) await rm(dist, { recursive: true });
await mkdir(dist, { recursive: true });

// Bundle the Lambda handler
await build({
  entryPoints: [resolve(here, "src", "handler.ts")],
  outfile: resolve(here, "dist", "index.mjs"),
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  minify: true,
  sourcemap: "external",
  // The MCP server is spawned as a subprocess, so we ship its compiled
  // output alongside index.mjs and reference it via $LAMBDA_TASK_ROOT.
  // Keep these unbundled.
  external: ["@calendar-bot/server"],
  // CJS deps that survive the bundle (e.g. inside @modelcontextprotocol/sdk
  // transitive chain) emit `require()` calls. esbuild's default ESM output
  // rewrites those to `__require` which throws "Dynamic require of <x>
  // is not supported" at runtime. The banner polyfills `require`,
  // `__filename`, and `__dirname` for the bundled CJS code.
  banner: {
    js: [
      "import { createRequire as _csr } from 'module';",
      "import { fileURLToPath as _ftp } from 'url';",
      "import { dirname as _dn } from 'path';",
      "const require = _csr(import.meta.url);",
      "const __filename = _ftp(import.meta.url);",
      "const __dirname = _dn(__filename);",
    ].join(""),
  },
  logLevel: "info",
});

// Stage the compiled MCP server next to index.mjs
if (!existsSync(serverDist)) {
  throw new Error(
    `Server build not found at ${serverDist}. Run \`pnpm --filter @calendar-bot/server build\` first.`,
  );
}
await mkdir(resolve(dist, "server"), { recursive: true });
await cp(serverDist, resolve(dist, "server"), { recursive: true });

// Also copy the server's package.json (subprocess needs the bin entry)
await cp(
  resolve(here, "..", "..", "packages", "server", "package.json"),
  resolve(dist, "server", "package.json"),
);

console.log("✓ chat-lambda built →", dist);

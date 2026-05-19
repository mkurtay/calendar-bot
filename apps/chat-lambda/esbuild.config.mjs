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
const serverSrc = resolve(here, "..", "..", "packages", "server", "src", "server.ts");

const esmBanner = [
  "import { createRequire as _csr } from 'module';",
  "import { fileURLToPath as _ftp } from 'url';",
  "import { dirname as _dn } from 'path';",
  "const require = _csr(import.meta.url);",
  "const __filename = _ftp(import.meta.url);",
  "const __dirname = _dn(__filename);",
].join("");

// Clean dist
if (existsSync(dist)) await rm(dist, { recursive: true });
await mkdir(dist, { recursive: true });

// Bundle the Lambda handler.
// CJS deps that survive the bundle (inside @modelcontextprotocol/sdk's
// transitive chain) emit `require()` calls. esbuild's default ESM output
// rewrites those to `__require` which throws "Dynamic require of <x>
// is not supported" at runtime. The banner polyfills `require`,
// `__filename`, and `__dirname` for the bundled CJS code.
await build({
  entryPoints: [resolve(here, "src", "handler.ts")],
  outfile: resolve(here, "dist", "index.mjs"),
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  minify: true,
  sourcemap: "external",
  // The MCP server is spawned as a subprocess from a separate bundled
  // file; it's not imported by the handler, so keep it external.
  external: ["@calendar-bot/server"],
  banner: { js: esmBanner },
  logLevel: "info",
});

// Bundle the MCP server too. It runs as its own Node subprocess, so it
// needs its own self-contained file — staging compiled tsc output would
// leave its imports (e.g. @modelcontextprotocol/sdk) unresolved at
// runtime because the Lambda zip has no node_modules. Same banner as
// the handler so any CJS deps in the server's chain work too.
await build({
  entryPoints: [serverSrc],
  outfile: resolve(here, "dist", "server", "server.js"),
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  minify: true,
  sourcemap: "external",
  banner: { js: esmBanner },
  logLevel: "info",
});

console.log("✓ chat-lambda built →", dist);

# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

MCP server for Victron Energy's **VRM cloud API**, exposing 53 tools over **Streamable HTTP**. v0.5.0.

⚠️ **npm skips 0.4.0.** v0.4.0 was tagged and GitHub-released on 2026-05-14 but never published to the registry, so npm goes 0.3.0 → 0.5.0. Check `npm view victron-vrm-mcp version` against `git tag` before assuming a tag means a release.

It is the **cloud half of a pair** — the local/LAN half is [`victron-tcp`](https://github.com/lubosstrejcek/victron-tcp) (stdio, Modbus TCP + MQTT, works offline, ~50 ms). This one needs internet, works away from the house, and inherits VRM's **~15 min sampling latency**. Choose accordingly before adding a tool here: anything needing real-time data belongs in `victron-tcp`.

## Two deployment targets from one codebase

| Target | Entry | Run |
|---|---|---|
| **stdio** (local subprocess) | `src/index.ts` → `dist/index.js` | `npm start`, bin `victron-vrm-mcp` |
| **Cloudflare Worker** (remote HTTP) | `src/worker.ts` | `npm run worker:dev` / `worker:deploy` |

`wrangler.toml` sets `MCP_PATH=/mcp`, `VRM_AUTH_SCHEME=Token`, `nodejs_compat`. The Worker build is `npm run build:worker`, which is **`tsc --noEmit`** — type-check only, since Wrangler bundles from source. Changing `build:worker` to emit would break the Worker build.

## Commands

```bash
npm ci
npm run build          # tsc -> dist/
npm test               # build + full vitest run
npm run test:unit      # fast subset: helpers, client, logger, rate_limit, http_guards
npm run test:live      # 91 live tests against VRM's demo tenant — network, not part of CI
npm run inspect        # @modelcontextprotocol/inspector
```

**415 offline tests across 16 files, plus 91 live tests, all passing** (verified 2026-08-14). `tests/handlers.test.ts` runs every tool handler in-process against a stubbed VRM (fixtures from `tests/fixtures/`); the shared tool catalog lives in `tests/tool_catalog.ts` — update it when adding or removing a tool. CI enforces coverage thresholds on `src/` (80% lines / 72% branches) via `npm run test:coverage`.

**The default run is offline by construction.** `vitest.config.ts` excludes `tests/live.test.ts`, and `npm run test:live` reaches it through its own `vitest.live.config.ts`. A CLI `--exclude` cannot express this — vitest *appends* that flag to the config's exclude list rather than replacing it, so `vitest run --exclude … tests/live.test.ts` silently runs zero tests.

## Runtime gotcha

Node on this machine resolves to Homebrew's **26.5.0**, which shadows the 24.18.0 LTS in `~/.local/share/node/bin`. CI runs a **22 / 24 matrix** — the two supported LTS lines — and `package.json` `engines` declares `>=22.11.0`. **Keep those two in step:** the matrix floor is what makes the `engines` floor a tested claim rather than an assertion. If you see a toolchain oddity locally, check `node --version` first:

```bash
export PATH="$HOME/.local/share/node/bin:$PATH"
```

## Dependencies are deliberately tiny

Runtime deps are only `@modelcontextprotocol/sdk` and `zod`. Keep it that way — this ships as an npm package *and* runs in a Worker, where bundle size and `nodejs_compat` limits both matter.

## Destructive tools are gated

`src/tools/helpers.ts` refuses any destructive operation unless called with `{ confirm: true }`:

```
Refusing to execute destructive operation "<name>" without { confirm: true }
```

Trusted automated callers may bypass with the header `x-vrm-skip-confirms: 1`. **Do not remove or weaken this gate**, and any new destructive tool must route through the same helper rather than reimplementing the check.

## CI

`.github/workflows/ci.yml` — `npm ci`, `npm run build`, `npm run test:coverage` (offline; no VRM network calls), on a Node 22 / 24 matrix, plus a separate `static` job on 24.

It includes a **token-leak sentinel** that fails the build if `src/` contains a JWT-shaped literal (`eyJ…`) or a `console.log(...token...)`. If CI fails with *"Potential token literal or token log in source"*, that is the sentinel — remove the credential, don't weaken the grep.

`tests/live.test.ts` is excluded from CI because it spawns the server and calls the real VRM API. It needs no credentials — `beforeAll` issues an anonymous demo token — which is exactly why it went unnoticed running in CI until 2026-08-14: it passed, so nothing failed to reveal that every build depended on `vrmapi.victronenergy.com` being reachable.

## Layout

```
src/
  index.ts        stdio entry
  worker.ts       Cloudflare Worker entry
  server.ts       MCP server wiring
  http_guards.ts  request guards
  rate_limit.ts   rate limiting
  logger.ts
  vrm/            client.ts, types.ts — VRM API client
  tools/          53 tools: installations, reads, site_writes, alarms, users,
                  widgets, tags, admin, admin_ops, auth, accesstokens,
                  capabilities, data_attributes, custom_widget, output_schemas,
                  user_ops, helpers
tests/            16 offline files incl. handlers, fuzz, pagination, regressions,
                  worker — plus live.test.ts, run only via npm run test:live
evals/            evaluation harness
```

## Related

`~/.claude/docs/energy.md` documents the physical system these tools read: 41.62 kWp, 3× MultiPlus-II (one per phase, not paralleled), Ekrano GX, and the constraint that **grid export is not permitted by the DSO** — relevant when interpreting or writing tools around energy flow.

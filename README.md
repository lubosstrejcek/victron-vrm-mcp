# Victron VRM MCP — MCP Server

MCP server for Victron Energy's [VRM cloud API](https://vrmapi.victronenergy.com/v2/docs). Exposes 52 VRM tools over Streamable HTTP — ready for the [Anthropic MCP Connector API](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) and any HTTP-capable MCP client.

> 52 tools | Streamable HTTP | Security-first | 208 tests | MCP Connector compatible

---

## Which package do I want?

This is the **cloud / remote** half of a pair. The local / LAN half is **[`victron-tcp`](https://github.com/lubosstrejcek/victron-tcp)**.

| | **[`victron-tcp`](https://github.com/lubosstrejcek/victron-tcp)** | **`victron-vrm-mcp`** (this repo) |
|---|---|---|
| Transport | stdio (local subprocess) | Streamable HTTP (remote) |
| Data source | Modbus TCP + MQTT on your LAN | VRM cloud API |
| Needs access to the GX on your LAN | **Yes** | No |
| Works when you're away from the boat / house | No | **Yes** |
| Works when the internet is down | **Yes** | No |
| Latency | Real-time (~50 ms) | ~15 min (VRM sampling) |
| Raw register access | **Yes** (900+ registers) | No |
| Write coverage | Read-only today; writes via MQTT planned | 24 destructive tools, all `confirm`-gated |
| MCP Connector API compatible | No (stdio) | **Yes** (HTTPS) |
| Clients | Claude Code, Claude Desktop, Cursor, Windsurf | Anthropic Messages API + anything that speaks MCP over HTTP |
| Auth | None locally (trusts LAN) | Per-request VRM personal access token |

**Use `victron-tcp` when:** you're on the same LAN as a GX device and want real-time access with raw register support.
**Use `victron-vrm-mcp` when:** you need remote access, you're building an API-backed app via the MCP Connector, or you don't want to expose anything on your LAN.

You can use **both** simultaneously — they serve different use cases.

---

## Installation

Unlike `victron-tcp`, this package is a **server you self-host**, not a process your client spawns. You run it once, put HTTPS in front of it, and connect MCP clients to its URL.

### Run from npm (recommended)

```bash
# one-off (no install)
npx victron-vrm-mcp

# or install globally
npm install -g victron-vrm-mcp
victron-vrm-mcp

# or pin in a project
npm install victron-vrm-mcp
npx victron-vrm-mcp
```

Listens on `http://127.0.0.1:3000/mcp` by default. Configure with env vars (`PORT`, `HOST`, `ALLOWED_ORIGINS`, `VRM_ALLOWED_SITES`, `VRM_AUTH_SCHEME`) — see `.env.example`.

### Run from source (development)

```bash
git clone https://github.com/lubosstrejcek/victron-vrm-mcp.git
cd victron-vrm-mcp
npm install
npm run build
npm start
```

Same default bind (`http://127.0.0.1:3000/mcp`).

### Docker

A Dockerfile is on the roadmap. For now, a minimal one-liner you can adapt:

```bash
docker run --rm -it -p 3000:3000 -e HOST=0.0.0.0 \
  -e ALLOWED_ORIGINS="https://claude.ai" \
  node:22-alpine sh -c "npx -y victron-vrm-mcp"
```

### Public HTTPS (recommended)

For remote clients you need real TLS. Easiest path without opening firewall ports: **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)**.

```bash
cloudflared tunnel create vrm
cloudflared tunnel route dns vrm victron-vrm.example.com
cloudflared tunnel run --url http://127.0.0.1:3000 vrm
```

Now `https://victron-vrm.example.com/mcp` is reachable with a real cert and no open ports. Alternatives: nginx/Caddy reverse proxy, Fly.io, Cloudflare Workers adapter (roadmap).

### Anthropic Messages API (MCP Connector)

```json
{
  "mcp_servers": [{
    "type": "url",
    "url": "https://victron-vrm.example.com/mcp",
    "name": "victron-vrm",
    "authorization_token": "<your-vrm-personal-access-token>"
  }],
  "tools": [{ "type": "mcp_toolset", "mcp_server_name": "victron-vrm" }]
}
```

### Claude Code / Cursor / Windsurf (HTTP transport)

```bash
claude mcp add-json victron-vrm '{"type":"http","url":"https://victron-vrm.example.com/mcp","headers":{"Authorization":"Bearer YOUR_VRM_TOKEN"}}'
```

### Don't know your VRM token?

Create a **personal access token** at [VRM → Preferences → Integrations → Access tokens](https://vrm.victronenergy.com/) (endpoint: `POST /users/{idUser}/accesstokens/create`). Access tokens are long-lived, revocable, and the **supported** third-party auth method going forward.

> ⚠️ **VRM Bearer tokens (`/auth/login`, `/auth/loginAsDemo`) are deprecated from 2026-06-01** (now in the official OpenAPI spec). This server still supports them via `x-vrm-auth-scheme: Bearer` for testing, but new integrations **must** use access tokens. A warning is logged whenever the Bearer scheme is used.

For quick smoke testing before you have an access token, `GET https://vrmapi.victronenergy.com/v2/auth/loginAsDemo` returns a short-lived Bearer token against the Victron demo tenant.

### Don't know your idSite?

Call `vrm_list_installations` first — it returns every site the token can access. Or if you have a 12-char portal ID, call `vrm_get_site_id` to resolve it.

### Requirements

- **Node.js 18+**
- **A VRM personal access token** (or a demo-login Bearer for testing)
- **Public HTTPS** if you want the MCP Connector API to reach it

---

## Tools

52 tools covering 88 VRM operations (52 direct + 35+ widget endpoints via the generic `vrm_widget` dispatcher). Every destructive tool is `confirm: true` gated; every tool declares `inputSchema`, `outputSchema`, and MCP annotations.

<details>
<summary><strong>Discovery & Lookup (4 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_list_installations` | List all sites the token can access (supports `limit` for markdown truncation) |
| `vrm_search_sites` | Search by site ID, email, username, serial number, site identifier, or email domain |
| `vrm_get_site_id` | Resolve a 12-char portal ID to a numeric `idSite` |
| `vrm_list_invites` | List invitations issued/received by the user |

</details>

<details>
<summary><strong>Monitoring — reads (11 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_get_system_overview` | Connected devices + roles for a site |
| `vrm_get_diagnostics` | Per-device last-known attribute values |
| `vrm_get_stats` | Time-series stats (15min/hours/days/weeks/months/years) |
| `vrm_get_overallstats` | Lifetime aggregate stats |
| `vrm_get_alarms` | Configured alarms, devices, notification users, available attributes |
| `vrm_get_site_users` | Users + invites + access requests + group links on a site |
| `vrm_get_tags` | Tags grouped by source (user/team/group/predefined) |
| `vrm_get_dynamic_ess_settings` | Current Dynamic ESS configuration |
| `vrm_get_gps_download` | GPS position history |
| `vrm_get_forecasts_last_reset` | Timestamp of the last forecasts reset (0 if never) |
| `vrm_get_custom_widgets` | Custom widgets configured on a site |

</details>

<details>
<summary><strong>Widgets (3 tools — 35+ widget endpoints covered)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_widget` | Generic dispatcher for any VRM widget name (BatterySummary, SolarChargerSummary, TankSummary, VeBusState, MPPTState, InputState, InverterState, PVInverterStatus, MotorSummary, GlobalLinkSummary, MeteorologicalSensorOverview, Status, HoursOfAc, LithiumBMS, DCMeter, FuelCellState, BatteryRelayState, ChargerRelayState, GatewayRelayState, SolarChargerRelayState, BatteryMonitorWarningsAndAlarms, VeBusWarningsAndAlarms, InverterChargerState, InverterChargerWarningsAndAlarms, EssBatteryLifeState, IOExtenderInOut, BMSDiagnostics, HistoricData, TempSummaryAndGraph, TempAirQuality, EvChargerSummary, etc.) |
| `vrm_widget_graph` | Time-series graph with `attributeCodes[]` / `attributeIds[]`, `start`/`end`, `useMinMax` |
| `vrm_widget_generator_state` | Generator state-change timeline |

</details>

<details>
<summary><strong>Writes — low-risk (4 tools, confirm-gated)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_set_favorite` | Mark/unmark a site as favorite |
| `vrm_tags_add` | Attach a tag to a site |
| `vrm_tags_remove` | Detach a tag from a site |
| `vrm_clear_alarm` | Acknowledge an active alarm |

</details>

<details>
<summary><strong>Writes — medium-risk (5 tools, confirm-gated)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_add_alarm` | Create alarm (float or enum threshold variant) |
| `vrm_edit_alarm` | Modify existing alarm |
| `vrm_delete_alarm` | Delete alarm definition |
| `vrm_reset_forecasts` | Reset forecasting baseline for a site |
| `vrm_set_site_settings` | Update site name/notes/geofence/alarm-monitoring/Node-RED restrictions/etc. |

</details>

<details>
<summary><strong>Writes — high-impact (1 tool, confirm-gated)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_set_dynamic_ess_settings` | Write Dynamic ESS configuration (schedule, b2g, priceSchedule, batteryKwh, etc.) |

</details>

<details>
<summary><strong>Access management (8 tools, confirm-gated)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_invite_user` | Invite a user by email with access level (0=monitoring, 1=admin, 2=technician) |
| `vrm_unlink_user` | Remove a user from a site |
| `vrm_unlink_installation` | Remove the current user from a site (self-unlink) |
| `vrm_set_user_rights` | Bulk-update per-user access levels |
| `vrm_set_invite_rights` | Bulk-update pending-invite access levels |
| `vrm_link_user_groups` | Link user groups with access levels |
| `vrm_set_user_group_access_level` | Change or remove a user group's access level |
| `vrm_add_site` | Add an installation to a user account |

</details>

<details>
<summary><strong>Access tokens (2 tools, confirm-gated)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_create_access_token` | Create a long-lived personal access token |
| `vrm_delete_access_token` | Revoke one token by id or ALL with `"*"` — **can self-lockout** |

</details>

<details>
<summary><strong>Auth (3 tools — Bearer flow, deprecated 2026-06-01)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_auth_login_as_demo` | Fetch a short-lived Bearer for the demo tenant (read-only) |
| `vrm_auth_login` | Log in with email+password (DEPRECATED, security hazard — use access tokens) |
| `vrm_auth_logout` | Invalidate the current Bearer session |

</details>

<details>
<summary><strong>Custom widgets CRUD (4 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_get_custom_widgets` | List custom widgets on a site |
| `vrm_create_custom_widget` | Create (confirm-gated) |
| `vrm_patch_custom_widget` | Update (confirm-gated) |
| `vrm_delete_custom_widget` | Delete (confirm-gated) |

</details>

<details>
<summary><strong>Data attributes (2 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_find_by_data_attributes` | Search user's installations by attribute conditions (`bs>=50,au=(1,2)`); server-side `page`/`count` pagination |
| `vrm_list_data_attributes` | Catalog of all VRM attribute definitions |

</details>

<details>
<summary><strong>Admin / collection (6 tools — most require admin privileges)</strong></summary>

| Tool | Description |
|------|-------------|
| `vrm_admin_list_devices` | All devices across the system |
| `vrm_admin_data_attributes_count` | Count installations by data-attribute condition |
| `vrm_admin_search_download` | Bulk search export |
| `vrm_list_firmwares` | Firmware catalog (requires `feedChannel` + `victronConnectVersion`) |
| `vrm_add_system` | Register a new system (confirm-gated) |
| `vrm_installation_overview_download` | Bulk overview export (returns binary payload as base64) |

</details>

### Resources

| URI | Content |
|-----|---------|
| `docs/vrm-api-openapi.yaml` | Bundled VRM OpenAPI 3.1 spec (78 endpoints, updated 2026-04) used for reference |

---

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `MCP_PATH` | `/mcp` | Endpoint path |
| `VRM_AUTH_SCHEME` | `Token` | Default scheme for forwarding to VRM. Use `Token` (access tokens). `Bearer` is deprecated by VRM on 2026-06-01. Per-request override: `x-vrm-auth-scheme` header. |
| `VRM_ALLOWED_SITES` | _(unset)_ | Comma-separated `idSite` allowlist. If unset, any site the token can access is allowed. |
| `ALLOWED_ORIGINS` | _(unset)_ | Comma-separated list of allowed `Origin` header values. If unset, only same-origin + loopback accepted. |

### Local `.env` (optional)

Copy `.env.example` to `.env` and adjust. Node 20.6+ loads it directly:

```bash
node --env-file=.env dist/index.js
```

`.env` is gitignored. **VRM tokens never go in `.env`** — they're passed per-request in the `Authorization` header.

### Per-request headers

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer <vrm-token>` | **Required.** The VRM token to forward. |
| `x-vrm-auth-scheme: Token\|Bearer` | Optional. Overrides `VRM_AUTH_SCHEME` for this request. Use `Bearer` for `/auth/loginAsDemo` tokens. |
| `x-vrm-skip-confirms: 1` | Optional. Bypasses the `confirm: true` gate on destructive tools. **Automation only** — never for interactive sessions. Logged as a `skip_confirms_enabled` warning. |
| `Origin` | Validated against `ALLOWED_ORIGINS` (or same-origin) for DNS-rebinding defense. |
| `mcp-protocol-version` | Validated against supported versions (`2025-06-18`, `2025-03-26`). |

---

## Security model

| Layer | What it does |
|---|---|
| **Origin header validation** | Rejects cross-origin requests unless `Origin` is in `ALLOWED_ORIGINS` (or matches the host for local dev). Defense against DNS rebinding. |
| **Strict Accept + Content-Type** | POST must send `Content-Type: application/json` and `Accept` including both `application/json` and `text/event-stream`. Also kills simple-POST CSRF. |
| **MCP-Protocol-Version whitelist** | Only accepts versions this server supports; unknown versions → 400. |
| **Bearer token required** | Missing or implausibly short tokens rejected before any VRM call. |
| **Token never stored / never logged** | Tokens live only in the fetch call that forwards them. Logger auto-strips any key containing `token` or `authorization`. |
| **Zod input validation** | Every tool argument is schema-validated. `idSite`/`idUser` must be positive integers; widget names must match a strict PascalCase regex; request bodies are schema-validated per tool. |
| **URL-safe path construction** | Path parameters are URL-encoded via `encodeURIComponent` in shared `sitePath()` / `userPath()` helpers. No string templating into URLs. |
| **VRM base-URL host pin** | Client refuses to call anything other than `vrmapi.victronenergy.com` over HTTPS. |
| **Destructive-op gating** | Tools that write/delete require `{ confirm: true }` OR the `x-vrm-skip-confirms: 1` header (automation opt-in). Refusals happen server-side, not just at the MCP client. MCP annotations (`destructiveHint`, `idempotentHint`, `readOnlyHint`) are set so clients can enforce UX confirmation. |
| **Optional site allowlist** | `VRM_ALLOWED_SITES=123,456` constrains the server to a fixed set of sites. Refused before hitting VRM. |
| **Rate-limit awareness** | 429 responses surface with `Retry-After`. No silent retries. |
| **Error body redaction** | VRM error bodies are reduced to `error_code: errors-text`, truncated to 256 chars. Raw response bodies never flow to the client. |
| **Stateless per-request** | Fresh `McpServer` + `StreamableHTTPServerTransport` per request — no cross-request state, no session auth. |
| **Structured JSON stderr logs** | All operational events are one-line JSON; token/authorization keys stripped. |
| **DELETE returns 405** | Server is stateless; no session to delete. |

---

## How it works

```
┌──────────────────────────┐       HTTPS + Bearer token        ┌──────────────────────┐
│  MCP client              │ ────────────────────────────────▶ │  victron-vrm-mcp     │
│  (Connector API, Claude  │                                    │  (Streamable HTTP)   │
│   Code, Cursor, etc.)    │                                    └──────────┬───────────┘
└──────────────────────────┘                                               │
                                                                           │ x-authorization: Token …
                                                                           ▼
                                                        https://vrmapi.victronenergy.com/v2
```

The server is **stateless** — each MCP request carries its own VRM token. A fresh `McpServer` + `StreamableHTTPServerTransport` is constructed per request, forwarding auth through the SDK's `RequestHandlerExtra.authInfo` channel.

---

## Debugging

The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) is the fastest way to poke at the server interactively.

```bash
# Terminal 1 — start the server
npm run build && npm start
# (or: PORT=3000 npx victron-vrm-mcp)

# Terminal 2 — launch the Inspector UI
npm run inspect
# Then in the UI:
#   Transport:  Streamable HTTP
#   URL:        http://127.0.0.1:3000/mcp
#   Headers:    Authorization: Bearer <your-vrm-token>
#               x-vrm-auth-scheme: Token   (or Bearer for /auth/loginAsDemo tokens)
```

Logs go to **stderr** as one-line JSON (the Streamable HTTP transport doesn't capture stderr through to clients — see the spec's [debugging guide](https://modelcontextprotocol.io/docs/tools/debugging)). For client-visible diagnostics, the spec offers `notifications/message` (planned for a future release).

## Testing

208 tests across 8 files, runs in ~2 seconds:

```bash
npm test           # build + run all tests
npm run test:unit  # unit tests only (no server spawn)
```

| File | Coverage |
|------|----------|
| `tests/helpers.test.ts` | zod schemas, `sitePath`/`userPath` encoding, `requireConfirm` + skip bypass, `resolveAuth` token guards, `formatVrmError` redaction |
| `tests/client.test.ts` | Token-length guard, scheme forwarding, array query encoding, host pin, 4xx → `VrmApiError`, 429 Retry-After, binary download round-trip |
| `tests/logger.test.ts` | Auto-redaction of `token`/`authorization` keys (case-insensitive) |
| `tests/http.test.ts` | End-to-end HTTP: 404/405/401/403/406/415/400/200, Origin validation, confirm gate, skip header |
| `tests/tools.coverage.test.ts` | Every one of the 52 tools has correct shape + annotations; every destructive tool refuses without confirm AND passes with skip header |
| `tests/outputSchema.test.ts` | Every tool declares `outputSchema` with ≥1 property; description hygiene (length, endpoint mention, no injection markers, destructive tools name the hazard) |
| `tests/regressions.test.ts` | Specific bug locks: skip-confirms bypass, firmwares required params, binary download, path traversal rejection, widget-name regex, limit bounds |
| `tests/fuzz.test.ts` | Malformed JSON, 1 MB body, unicode/control-char/XSS/SQL-injection strings, array length limits, content-type edge cases, token-leak sentinel |

CI: `.github/workflows/ci.yml` runs the full suite on Node 18 / 20 / 22 for every push + PR, plus a token-leak sentinel grep and `npm audit`.

### Evals

`evals/*.xml` — 12 multi-tool scenario evaluations (not CI, graded manually against an LLM client). Cover discovery + overview, battery-last-hour, alarm triage, find-by-SOC, user invite, access-token rotation, tag management, safety refusal, site-id lookup, daily health check, ESS config change, automated nightly job.

---

## Roadmap

Shipped:
- [x] 52 tools covering 88 VRM operations
- [x] Streamable HTTP transport + MCP Connector API support
- [x] Security hardening (Origin/Accept/Content-Type/Protocol-Version, token redaction, confirm gates, site allowlist, base-URL pin)
- [x] `outputSchema` on every tool
- [x] 208 tests + CI on Node 18/20/22
- [x] 12 scenario evals

Planned:
- [ ] Cloudflare Workers adapter (stateless-friendly deployment)
- [ ] Docker image
- [ ] Token-bucket rate limiter matching VRM's 200-window / 3 req/s
- [ ] Recorded-fixture tests (offline VRM response snapshots)
- [ ] Paginate `vrm_list_data_attributes` cursor-style when VRM adds it

---

## References

- [VRM API documentation](https://vrmapi.victronenergy.com/v2/docs)
- [VRM API live docs (try-it)](https://vrm-api-docs.victronenergy.com/)
- [Anthropic MCP Connector API](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Model Context Protocol spec](https://modelcontextprotocol.io)
- [Data communication with Victron Energy products](https://www.victronenergy.com/upload/documents/Technical-Information-Data-communication-with-Victron-Energy-products_EN.pdf) (whitepaper)

## License

MIT

# victron-vrm-mcp

MCP server for Victron Energy's [VRM cloud API](https://vrmapi.victronenergy.com/v2/docs). Exposes VRM read/write endpoints as MCP tools over Streamable HTTP, ready for use with the [Anthropic MCP Connector API](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) and any other HTTP-capable MCP client.

> **Sibling to [`victron-tcp`](https://github.com/lubosstrejcek/victron-tcp).** `victron-tcp` handles local stdio + LAN (Modbus/MQTT). This package handles remote cloud access via VRM.

**Status:** v0.1.0 — early scaffold. One tool working end-to-end: `vrm_list_installations`.

## How it works

```
┌──────────────────────────┐       HTTPS + Bearer token        ┌──────────────────────┐
│  MCP client              │ ────────────────────────────────▶ │  victron-vrm-mcp     │
│  (Claude Connector API,  │                                    │  (Streamable HTTP)   │
│   Claude Code, etc.)     │                                    └──────────┬───────────┘
└──────────────────────────┘                                               │
                                                                           │ x-authorization: Token …
                                                                           ▼
                                                        https://vrmapi.victronenergy.com/v2
```

The server is **stateless** — each request carries the user's VRM personal access token in the `Authorization: Bearer <token>` header. The server forwards it to VRM as `x-authorization: Token <token>`. No tokens are stored.

## Requirements

- Node.js 18+
- A VRM personal access token (create one at [VRM → Preferences → Integrations → Access tokens](https://vrm.victronenergy.com/))

## Running locally

```bash
npm install
npm run build
PORT=3000 npm start
```

Server binds to `127.0.0.1:3000/mcp` by default. For public access, put it behind a reverse proxy (nginx, Caddy) or a tunnel (Cloudflare Tunnel).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `MCP_PATH` | `/mcp` | Endpoint path |

## Using it

### From the Anthropic Messages API

```json
{
  "mcp_servers": [{
    "type": "url",
    "url": "https://your-host.example.com/mcp",
    "name": "victron-vrm",
    "authorization_token": "<your-vrm-personal-access-token>"
  }],
  "tools": [{ "type": "mcp_toolset", "mcp_server_name": "victron-vrm" }]
}
```

### Local smoke test

```bash
# Initialize + list tools
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $VRM_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

## Tools

### v0.1.0

| Tool | What it does | Endpoints called |
|------|--------------|-------------------|
| `vrm_list_installations` | Lists all VRM sites the user can access | `GET /users/me`, `GET /users/{idUser}/installations` |

## Roadmap

- Read coverage (v0.2+): system overview, stats, alarms, widgets (battery/solar/vebus/tank/temperature/…)
- Write tools (v0.3+): `vrm_clear_alarm`, `vrm_tags_set`, `vrm_dynamic_ess_settings_set` (gated on `confirm: true`)
- Rate-limit aware client (token bucket matching VRM's 200-window / 3 req/s)
- Cloudflare Workers / Fly / Vercel deployment adapters

## License

MIT

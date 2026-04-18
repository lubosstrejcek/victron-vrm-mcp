# Security model — victron-vrm-mcp

This document describes the security posture of `victron-vrm-mcp`, the threats it does and does not defend against, and the explicit trade-offs in its auth design.

If you want to report a vulnerability, open a GitHub advisory on this repo or email `strejcek@streyda.eu`.

---

## One-line summary

`victron-vrm-mcp` is a **per-request credential bridge** between an MCP client and the Victron VRM cloud API. It forwards the caller's VRM access token upstream on each request. It is **not** an OAuth resource server in the MCP protocol sense — it never issues its own tokens, never claims an audience, never stores credentials.

---

## Threat model

**In scope (the server defends against these):**

- Cross-origin / DNS-rebinding calls from malicious web contexts
- CSRF-style simple POSTs from browsers (killed by strict `Content-Type` / `Accept`)
- Accidental upstream host spoofing (base-URL is pinned)
- Arbitrary URL / path-traversal inputs reaching VRM (zod + `encodeURIComponent` + widget-name regex)
- Token material leaking into logs or error responses (logger redaction + VRM error-body truncation)
- Runaway destructive tool calls from an LLM (`confirm: true` gate + `destructiveHint` annotation)
- Wildcard access to arbitrary VRM sites in shared deployments (`VRM_ALLOWED_SITES` allowlist)
- Clients speaking an unsupported protocol version (`MCP-Protocol-Version` whitelist)

**Out of scope (not defended against — callers are responsible):**

- A malicious or compromised caller possessing a valid VRM token
- TLS termination — deploy behind a proper reverse proxy / Cloudflare Tunnel / managed edge
- Rate-limit exhaustion of VRM from the caller's side (we do not meter; see "Known trade-offs" below)
- VRM-side incidents (VRM outage, VRM policy change)

---

## Auth design — explicit trade-off

The 2025-06-18 MCP security-best-practices document states:

> *"MCP servers MUST NOT accept any tokens that were not explicitly issued for the MCP server."*

This server knowingly does not follow that rule, because it is a **bridge**, not a resource server. The rationale:

1. **Custom downstream header name** — incoming `Authorization: Bearer <value>` is forwarded to VRM as `x-authorization: <scheme> <value>`. The MCP-standard header name is not re-used for the downstream call; nothing pretends the bridge is an OAuth protected resource.
2. **No audience claim is ever checked and none is falsified** — the token's original VRM audience remains authoritative. VRM enforces its own access policy on every call.
3. **No storage** — the token lives only inside the `fetch()` invocation that forwards it. There is no session state, no cache, no log of the value.
4. **No scope upgrade** — the bridge cannot grant the caller anything the upstream VRM policy would not already allow.

### Known consequences of this design

| Risk called out in the spec | Why it applies here | Mitigation we apply |
|---|---|---|
| Rate-limit circumvention | A caller can flood the server, which flattens many callers into one IP toward VRM | VRM's 429 is surfaced with `Retry-After`; per-token local rate limiting is on the roadmap |
| Audit trail loss | VRM logs show only the bridge's IP, not the originating client | Operators should front the bridge with an authenticated proxy that attaches the caller identity |
| Stolen-token proxy | A leaked token is exploitable through the bridge for its full VRM lifetime | Same as exploiting VRM directly; callers should rotate tokens via `vrm_delete_access_token` if compromised |
| Trust-boundary ambiguity | Clients may mistake the bridge for an authority | README + this file state explicitly: **the bridge does not authenticate callers, it only relays their VRM credential** |

**Do not deploy this server in front of a multi-tenant fleet without understanding the trade-off.** For a hardened multi-tenant deployment, front the bridge with an authenticated reverse proxy that terminates client identity separately from the VRM token and enforces per-user rate limits.

---

## Layered defences (implemented)

| Layer | Mechanism |
|---|---|
| **Origin validation** | Incoming `Origin` is checked against `ALLOWED_ORIGINS` or falls back to same-host + loopback. Defense against DNS rebinding. Violations → `403`. |
| **Strict Accept / Content-Type** | POST must send `Content-Type: application/json` and an `Accept` covering both `application/json` and `text/event-stream`. Browsers cannot set those from a simple form, killing simple-POST CSRF. Violations → `415` / `406`. |
| **MCP-Protocol-Version whitelist** | Server accepts `2025-11-25`, `2025-06-18`, `2025-03-26`. Unknown → `400`. |
| **Method allowlist** | `POST` / `GET` / `OPTIONS` only. `DELETE` → `405` (stateless; no session to delete). |
| **Bearer header required** | Missing, short, or malformed → `401` with `WWW-Authenticate` challenge. |
| **Zod input validation** | Every tool argument schema-validated before any VRM call. `idSite` must be a positive integer; widget names must match `^[A-Za-z][A-Za-z0-9]*$`; request bodies schema-validated per tool. |
| **URL-safe path construction** | Path params go through `encodeURIComponent` in shared `sitePath()` / `userPath()` helpers. No string interpolation of user input into URLs. |
| **VRM base-URL host pin** | Client refuses to call any host other than `vrmapi.victronenergy.com` over HTTPS. Protects against SSRF even if a future bug let user input reach the URL constructor. |
| **Site allowlist** | Optional `VRM_ALLOWED_SITES` constrains the server to a fixed set of `idSite` values. Anything outside is refused before any VRM call. |
| **Destructive-op gating** | 24 destructive tools require `confirm: true` in arguments OR `x-vrm-skip-confirms: 1` header (automation opt-in, logs a warning). MCP annotations (`destructiveHint: true`) are set so well-behaved clients prompt the user for approval. |
| **Error-body redaction** | VRM error bodies are reduced to `error_code: errors-text`, truncated to 256 chars. Raw response bodies never flow to the client. |
| **Logger redaction** | All structured stderr logs auto-strip any key containing `token`, `authorization`, `cookie`, `api-key`, `apikey`, `client_secret`, `credential`, `password`, or `secret` (case-insensitive). Token material never reaches logs. |
| **Stateless per-request** | Fresh `McpServer` + `StreamableHTTPServerTransport` per HTTP request — no cross-request state, no session-based auth to hijack, clean horizontal scaling. |

---

## SSRF posture

The VRM client pins `vrmapi.victronenergy.com` over HTTPS. All path parameters are validated by zod before reaching URL construction, then URL-encoded. Widget names have their own regex. **The general SSRF mitigations called out in the spec (block private IPs, block metadata endpoints, resolver-pin) are not relevant here**: user input cannot influence the host the server calls. Documented here so reviewers don't re-litigate the design.

---

## Session-hijack posture

Not applicable — the server is stateless and issues no session IDs. Each HTTP request stands alone.

---

## Known gaps / roadmap

1. **Per-token rate limiter** (H2 in internal audit). Planned. Will key a token-bucket off `sha256(token)[:16]`.
2. **OpenTelemetry trace propagation** via `traceparent` / MCP `_meta`. Planned.
3. **Stateful opt-in session mode** to unlock elicitation, tasks, and `listChanged` notifications. Design phase.
4. **Containerised deployment** with PID 1 / SIGTERM drain. Planned — `Dockerfile` on the roadmap.

---

## Responsible disclosure

If you find a vulnerability, please do not open a public issue. Email `strejcek@streyda.eu` or open a private GitHub security advisory on this repository.

## Acknowledgements

Thanks to the MCP working group's security-best-practices document (2025-06-18) — our threat model tracks directly against it and deviates only where noted above with explicit reasoning.

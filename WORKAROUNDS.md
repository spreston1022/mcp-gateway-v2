# Workarounds: MCP Gateway + MCP Server, DCR, and token exchange

Two workarounds came up while building real, per-user OAuth token exchange on
Zuplo's MCP tooling, across two related projects:

- **`mcp-gateway-token-exchange`** — uses `McpProxyHandler` (Zuplo's "MCP
  Gateway" product). Client-facing route: `/mcp`. It calls a same-project
  upstream MCP server at `/internal/echo/mcp` (`mcpServerHandler`), which in
  turn forwards to a real downstream API (`/echo`).
- **`mcpgateway-v2`** (this repo) — uses `mcpServerHandler` directly, with no
  `McpProxyHandler` route in the token-exchange path. Route:
  `/mcp-server-delegated`.

Both workarounds exist because of gaps between Zuplo's two MCP products
(`McpProxyHandler`, the "Gateway", vs `mcpServerHandler`, the "Server") --
not because either product is broken outright.

## Workaround 1: hand-rolled PRM (Protected Resource Metadata) endpoint

**Symptom:** a route needs to publish its own RFC 9728 discovery document at
`/.well-known/oauth-protected-resource/<route>`, and gets `400 Unknown MCP
route` instead.

**Root cause:** `McpGatewayPlugin` (registered in `zuplo.runtime.ts`) claims
the entire `/.well-known/oauth-protected-resource/*` path *for the whole
deployment it's registered in* -- not per-route. Its resolver only answers
for routes it manages itself (the `mcp-*-oauth-inbound` DCR family, or a
route referenced by `mcp-token-exchange-inbound`). Any other route on that
*same origin* trying to serve its own PRM at the conventional path gets
silently shadowed and rejected.

**Two conditions both have to be true for this to bite:**
1. Something in the project requires `McpGatewayPlugin` to be active --
   either a `mcp-*-oauth-inbound` policy (DCR) or `mcp-token-exchange-inbound`
   pulls it in, independent of each other.
2. *Another route on that same origin* also needs to independently publish
   its own PRM document.

Both conditions have to hold on the **same origin** for the collision to
occur, because the plugin's wildcard claim is origin-scoped. A gateway route
calling a genuinely external upstream (Notion, or any other real,
already-OAuth-compliant MCP server on its own domain) never collides --
that upstream's PRM lives on *its own* origin, which `McpGatewayPlugin` has
no claim over at all. This only affects same-project, self-hosted routes.

**How it showed up differently in each repo** (same root cause, different
reason the second route needed a PRM at all):

- `mcp-gateway-token-exchange`: `/mcp`'s `echo-mcp-token-exchange` policy
  (`mcp-token-exchange-inbound`, `authMode: "user-oauth"`) needs a
  `protectedResourceMetadataUrl` describing the upstream `/internal/echo/mcp`
  so it can perform delegated auth against it. `McpGatewayPlugin` is active
  because of `/mcp`'s own DCR policy (`auth0-managed-oauth`); the upstream
  route it needs to describe lives on that same origin and gets shadowed.
- `mcpgateway-v2`: `/mcp-server-delegated` needs a PRM for a different
  reason entirely -- not because another route references it, but because
  an *external* client (claude.ai) needs to discover it directly.
  `McpGatewayPlugin` is active because of `/mcp-server` and `/mcp/demo-v1`'s
  DCR policies (unrelated to `/mcp-server-delegated`); `/mcp-server-delegated`
  gets shadowed as collateral damage.

**The fix (identical in both repos):** `protectedResourceMetadataUrl` (and a
`WWW-Authenticate: Bearer resource_metadata="..."` hint) just need *some*
working URL -- they don't have to live at the conventional well-known path.
So: hand-roll a plain custom-code route that returns the correct RFC 9728
JSON by hand, at a path `McpGatewayPlugin` doesn't own.

- `mcp-gateway-token-exchange`: `modules/echo-mcp-prm.ts`, served at
  `/internal/echo/mcp-metadata`, referenced via
  `echo-mcp-token-exchange`'s `protectedResourceMetadataUrl` option.
- `mcpgateway-v2`: `modules/mcp-server-delegated-prm.ts`, served at
  `/internal/mcp-server-delegated/prm`, referenced via the
  `WWW-Authenticate` header set by `modules/require-bearer-with-prm-hint.ts`.

**Risk:** low, but worth being upfront about rather than treating as fully
free:
- This is a public, non-secret JSON document, and RFC 9728 explicitly
  allows discovery via the `resource_metadata` hint as an alternative to
  the fixed well-known path -- so it's spec-compliant, not a protocol
  violation.
- It's working around what looks like a genuine product gap --
  `McpGatewayPlugin` claiming that whole path project-wide and returning a
  cryptic `Unknown MCP route` rather than a clear error is arguably a bug
  worth reporting to Zuplo, not something every customer building this
  architecture should have to independently discover and route around.
- It's duplicating logic a proper plugin is supposed to auto-generate. If
  Zuplo ever changes the PRM document shape, the hand-rolled version won't
  update itself -- a small ongoing maintenance surface.
- It's specific to an edge case: a same-project, self-hosted upstream or
  route. The canonical pattern (calling a real external MCP server, e.g.
  Linear or Stripe) never needs any of this, since a truly external
  upstream serves its own real PRM with zero collision risk. So this isn't
  "Zuplo's token exchange tooling is hacky" -- it's "this one specific,
  less-common architecture has a rough edge."

## Workaround 2: bypassing Zuplo's DCR wrapper for real per-user token exchange

**Only applies to `mcpgateway-v2`.** `mcp-gateway-token-exchange` never needs
this -- `McpProxyHandler` and `mcp-token-exchange-inbound` are a matched,
first-party pair, explicitly designed to work together with DCR.

**Root cause:** `mcpServerHandler` has no equivalent to
`mcp-token-exchange-inbound` -- it hard-errors if you try to attach it. Real
per-user token exchange on `mcpServerHandler` requires custom code
(`modules/token-exchange.ts`), and that custom code needs to see the
caller's *actual* bearer token to exchange it. Zuplo's DCR wrapper (the
`mcp-*-oauth-inbound` family) replaces the original token with an opaque,
gateway-issued session token before custom code ever runs -- and none of
those policies expose an option to forward or preserve the original token.
This was checked directly against every DCR policy's full option surface
(including the native `McpKeycloakOAuthInboundPolicy`); no such override
exists for any IdP.

**The fix:** don't use Zuplo's DCR wrapper on this route at all. Protect
`/mcp-server-delegated` with a plain JWT policy (`OpenIdJwtInboundPolicy`,
pointed at Keycloak) instead, so the real token reaches custom code intact.
This is sufficient on its own for any client that can be manually configured
with a bearer token (e.g. Claude Code). Making it also work with claude.ai's
web app -- which only knows how to speak OAuth, with no way to accept a
manually-pasted token -- additionally required Workaround 1 (hand-rolled PRM
+ 401 discovery hint), pointed directly at Keycloak's own native DCR and
authorization endpoints rather than Zuplo's.

**Risk:** the architectural choice itself (validate bearer tokens from an
external IdP rather than have the gateway broker the OAuth flow) is
standard, not a hack. What *is* demo-only and needs real scoping before any
production use: the specific Keycloak realm changes made to get anonymous
DCR working over a public tunnel --
- deleting the "Trusted Hosts" client-registration policy (opens anonymous
  DCR to any caller, from any host),
- deleting the "Allowed Client Scopes" policy (removes the restriction on
  what scopes a dynamically-registered client can claim), and
- making the `gateway-inbound-client` audience a **realm-default** client
  scope, so every client ever registered against the realm automatically
  gets a token valid for exchange into `downstream-api`. This is the
  sharpest one: Keycloak's requirement that the exchanging client be present
  in the subject token's `aud` claim exists as a real security control, and
  making it realm-wide neuters that control rather than satisfying it
  narrowly.

None of those three belong in a real deployment without narrowing them --
restrict DCR to known redirect hosts, restrict scopes explicitly rather than
deleting the restriction, and scope the audience mapper to specific vetted
clients rather than every client in the realm.

# Notes: DCR + token exchange, MCP Gateway vs MCP Server

This repo has two routes that expose an MCP server through Zuplo, using two
different patterns:

- **`/mcp-server`** and **`/mcp/demo-v1`** use Zuplo's built-in DCR-based
  OAuth policies (`auth0-managed-oauth`). A client (like claude.ai) can
  discover the login flow, register itself, and authenticate through Auth0
  automatically, with no manual token setup.
- **`/mcp-server-delegated`** performs a real per-user token exchange
  (RFC 8693): the caller's token is exchanged for a new token scoped to the
  downstream API before the upstream call is made, rather than forwarding
  the caller's original token. It uses Keycloak instead of Auth0 for this,
  because it needs Custom Token Exchange, which requires an Auth0 plan tier
  this tenant doesn't have.

## Why `/mcp-server-delegated` doesn't use the same DCR policies

Zuplo's DCR-based OAuth policies (`mcp-*-oauth-inbound`) issue their own
session token to the caller and handle the provider token internally --
route code downstream doesn't get access to the caller's original token.
Performing a real token exchange requires that original token, so this
route uses direct JWT validation against Keycloak instead
(`OpenIdJwtInboundPolicy`, `modules/token-exchange.ts`).

To still support clients that only know how to authenticate via OAuth
discovery (claude.ai's connector UI, for example), the route publishes its
own RFC 9728 Protected Resource Metadata document
(`modules/mcp-server-delegated-prm.ts`, served at
`/internal/mcp-server-delegated/prm`) and returns a
`WWW-Authenticate: Bearer resource_metadata="..."` header on unauthenticated
requests (`modules/require-bearer-with-prm-hint.ts`) so clients can discover
it. This points directly at Keycloak's own OAuth endpoints, so clients
register and log in against Keycloak itself.

This metadata document lives at a project-specific path rather than the
conventional `/.well-known/oauth-protected-resource/mcp-server-delegated`
path, because that conventional path is already served by `McpGatewayPlugin`
for `/mcp-server` and `/mcp/demo-v1`'s DCR flows, and its metadata endpoint
only serves the routes it manages itself.

## Demo environment

Token exchange in `/mcp-server-delegated` is tested against a local
Keycloak instance (Docker), exposed via a temporary public tunnel
(`cloudflared`) so it's reachable during testing. This setup is for local
testing only:

- The tunnel URL is not stable -- it changes if the container or tunnel
  restarts, and the relevant `KEYCLOAK_*` environment variables need
  updating when that happens.
- The realm's client-registration policies are configured for open testing
  (any host can register a client, any scope can be requested), and the
  downstream-audience client scope is realm-default rather than scoped to a
  specific trusted client. A real deployment would restrict registration to
  known redirect URIs, restrict allowed scopes explicitly, and scope the
  audience mapping to the specific client(s) that should be allowed to
  perform the exchange.
- Access tokens are set to a 1-hour lifetime for convenience during manual
  testing, longer than a typical default.

None of this affects the token-exchange logic itself (`token-exchange.ts`),
which works the same way against any RFC 8693-compliant token endpoint --
these are realm settings, not application code.

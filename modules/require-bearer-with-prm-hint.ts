import { type ZuploContext, type ZuploRequest } from "@zuplo/runtime";

/**
 * Runs before mcp-jwt-auth-inbound. If no bearer token is present, responds
 * 401 with a WWW-Authenticate resource_metadata hint pointing MCP clients
 * (e.g. claude.ai) at the hand-rolled PRM document, so they can discover
 * Keycloak as the authorization server and complete DCR + browser login on
 * their own. If a token is present, passes through untouched -- the real
 * signature/issuer/audience check still happens in mcp-jwt-auth-inbound.
 */
export default async function requireBearerWithPrmHint(
  request: ZuploRequest,
  context: ZuploContext,
) {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    return request;
  }

  const prmUrl = new URL(
    "/internal/mcp-server-delegated/prm",
    request.url,
  ).toString();

  return new Response(
    JSON.stringify({ error: "unauthorized", error_description: "Missing bearer token" }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${prmUrl}"`,
      },
    },
  );
}

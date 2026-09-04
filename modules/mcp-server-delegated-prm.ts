import { environment, type ZuploContext, type ZuploRequest } from "@zuplo/runtime";

/**
 * Hand-rolled RFC 9728 PRM document for /mcp-server-delegated.
 *
 * McpGatewayPlugin claims the whole /.well-known/oauth-protected-resource/*
 * wildcard project-wide and rejects any route it doesn't itself manage
 * ("Unknown MCP route") -- and OpenIdJwtInboundPolicy's own
 * oAuthResourceMetadataEnabled flag routes through that same shared
 * mechanism, so it can't be used here either. This serves the same RFC 9728
 * shape manually, at a path that doesn't collide.
 */
export default async function (request: ZuploRequest, context: ZuploContext) {
  return {
    resource: new URL("/mcp-server-delegated", request.url).toString(),
    authorization_servers: [environment.KEYCLOAK_ISSUER],
  };
}

import {
  environment,
  ZuploRequest,
  type ZuploContext,
} from "@zuplo/runtime";

export interface TokenExchangeConfig {
  tokenUrl: string;
  downstreamAudience: string;
  clientId: string;
  clientSecret: string;
}

export type TokenExchangeResult =
  | { ok: true; accessToken: string }
  | { ok: false; status: number; body: string };

/**
 * Pure exchange logic: no Zuplo runtime dependency, so it can be unit
 * tested directly with a mocked fetchFn. Kept separate from the default
 * export per Zuplo's own testing guidance (avoid importing `environment`
 * inside functions you want to unit test).
 *
 * Uses application/x-www-form-urlencoded and the standard RFC 8693
 * subject_token_type (Keycloak's token endpoint, unlike Auth0's Custom
 * Token Exchange, expects form-encoded params and the plain
 * urn:ietf:params:oauth:token-type:access_token type -- no custom URN).
 */
export async function performTokenExchange(
  subjectToken: string,
  config: TokenExchangeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    audience: config.downstreamAudience,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const tokenRes = await fetchFn(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    return { ok: false, status: tokenRes.status, body: await tokenRes.text() };
  }

  const { access_token } = (await tokenRes.json()) as {
    access_token: string;
  };
  return { ok: true, accessToken: access_token };
}

export default async function exchangeToken(
  request: ZuploRequest,
  context: ZuploContext,
) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing bearer token", { status: 401 });
  }
  const subjectToken = authHeader.slice("Bearer ".length);

  const result = await performTokenExchange(subjectToken, {
    tokenUrl: environment.KEYCLOAK_TOKEN_URL,
    downstreamAudience: environment.KEYCLOAK_DOWNSTREAM_AUDIENCE,
    clientId: environment.KEYCLOAK_CLIENT_ID,
    clientSecret: environment.KEYCLOAK_CLIENT_SECRET,
  });

  if (!result.ok) {
    context.log.error("token exchange failed", {
      status: result.status,
      body: result.body,
    });
    return new Response("Token exchange failed", { status: 502 });
  }

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${result.accessToken}`);
  return new ZuploRequest(request, { headers });
}

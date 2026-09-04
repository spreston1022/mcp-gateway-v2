import {
  environment,
  ZuploRequest,
  type ZuploContext,
} from "@zuplo/runtime";

export interface TokenExchangeConfig {
  auth0Domain: string;
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
 */
export async function performTokenExchange(
  subjectToken: string,
  config: TokenExchangeConfig,
  fetchFn: typeof fetch = fetch,
): Promise<TokenExchangeResult> {
  const tokenRes = await fetchFn(`https://${config.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: subjectToken,
      subject_token_type:
        "urn:zuplo:params:oauth:token-type:inbound-access-token",
      audience: config.downstreamAudience,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
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
    auth0Domain: environment.AUTH0_DOMAIN,
    downstreamAudience: environment.AUTH0_DOWNSTREAM_AUDIENCE,
    clientId: environment.AUTH0_CLIENT_ID,
    clientSecret: environment.AUTH0_CLIENT_SECRET,
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

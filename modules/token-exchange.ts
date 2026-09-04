import {
  environment,
  ZuploRequest,
  type ZuploContext,
} from "@zuplo/runtime";

export default async function exchangeToken(
  request: ZuploRequest,
  context: ZuploContext,
) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing bearer token", { status: 401 });
  }
  const subjectToken = authHeader.slice("Bearer ".length);

  const tokenRes = await fetch(
    `https://${environment.AUTH0_DOMAIN}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: subjectToken,
        subject_token_type:
          "urn:zuplo:params:oauth:token-type:inbound-access-token",
        audience: environment.AUTH0_DOWNSTREAM_AUDIENCE,
        client_id: environment.AUTH0_CLIENT_ID,
        client_secret: environment.AUTH0_CLIENT_SECRET,
      }),
    },
  );

  if (!tokenRes.ok) {
    context.log.error("token exchange failed", {
      status: tokenRes.status,
      body: await tokenRes.text(),
    });
    return new Response("Token exchange failed", { status: 502 });
  }

  const { access_token } = (await tokenRes.json()) as {
    access_token: string;
  };

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${access_token}`);
  return new ZuploRequest(request, { headers });
}

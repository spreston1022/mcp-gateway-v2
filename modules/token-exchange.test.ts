import { test } from "node:test";
import assert from "node:assert/strict";
import { performTokenExchange } from "./token-exchange.ts";

const config = {
  auth0Domain: "dev-l3ayzqncrfw3ta50.us.auth0.com",
  downstreamAudience: "https://echo-downstream",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
};

test("performTokenExchange sends the correct request shape", async () => {
  let capturedUrl: string | undefined;
  let capturedBody: any;

  const fakeFetch = (async (url: string, init: RequestInit) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ access_token: "new-token-123" }), {
      status: 200,
    });
  }) as typeof fetch;

  const result = await performTokenExchange("original-token", config, fakeFetch);

  assert.equal(capturedUrl, "https://dev-l3ayzqncrfw3ta50.us.auth0.com/oauth/token");
  assert.equal(capturedBody.grant_type, "urn:ietf:params:oauth:grant-type:token-exchange");
  assert.equal(capturedBody.subject_token, "original-token");
  assert.equal(
    capturedBody.subject_token_type,
    "urn:zuplo:params:oauth:token-type:inbound-access-token",
  );
  assert.equal(capturedBody.audience, "https://echo-downstream");
  assert.equal(capturedBody.client_id, "test-client-id");
  assert.equal(capturedBody.client_secret, "test-client-secret");

  assert.deepEqual(result, { ok: true, accessToken: "new-token-123" });
});

test("performTokenExchange surfaces a failed exchange as ok:false with status/body", async () => {
  const fakeFetch = (async () => {
    return new Response("invalid_grant: subject token expired", {
      status: 400,
    });
  }) as typeof fetch;

  const result = await performTokenExchange("expired-token", config, fakeFetch);

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    body: "invalid_grant: subject token expired",
  });
});

test("performTokenExchange propagates a network-level rejection", async () => {
  const fakeFetch = (async () => {
    throw new Error("network unreachable");
  }) as typeof fetch;

  await assert.rejects(
    () => performTokenExchange("any-token", config, fakeFetch),
    /network unreachable/,
  );
});

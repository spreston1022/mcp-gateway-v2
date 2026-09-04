import { test } from "node:test";
import assert from "node:assert/strict";
import { performTokenExchange } from "./token-exchange.ts";

const config = {
  tokenUrl: "https://keycloak.example.com/realms/mcp-demo/protocol/openid-connect/token",
  downstreamAudience: "downstream-api",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
};

test("performTokenExchange sends the correct request shape", async () => {
  let capturedUrl: string | undefined;
  let capturedBody: URLSearchParams | undefined;
  let capturedContentType: string | undefined;

  const fakeFetch = (async (url: string, init: RequestInit) => {
    capturedUrl = url;
    capturedBody = new URLSearchParams(init.body as string);
    capturedContentType = (init.headers as Record<string, string>)["Content-Type"];
    return new Response(JSON.stringify({ access_token: "new-token-123" }), {
      status: 200,
    });
  }) as typeof fetch;

  const result = await performTokenExchange("original-token", config, fakeFetch);

  assert.equal(capturedUrl, config.tokenUrl);
  assert.equal(capturedContentType, "application/x-www-form-urlencoded");
  assert.equal(capturedBody!.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
  assert.equal(capturedBody!.get("subject_token"), "original-token");
  assert.equal(
    capturedBody!.get("subject_token_type"),
    "urn:ietf:params:oauth:token-type:access_token",
  );
  assert.equal(capturedBody!.get("audience"), "downstream-api");
  assert.equal(capturedBody!.get("client_id"), "test-client-id");
  assert.equal(capturedBody!.get("client_secret"), "test-client-secret");

  assert.deepEqual(result, { ok: true, accessToken: "new-token-123" });
});

test("performTokenExchange surfaces a failed exchange as ok:false with status/body", async () => {
  const fakeFetch = (async () => {
    return new Response("access_denied: Client not allowed to exchange", {
      status: 400,
    });
  }) as typeof fetch;

  const result = await performTokenExchange("expired-token", config, fakeFetch);

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    body: "access_denied: Client not allowed to exchange",
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

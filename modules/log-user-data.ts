import type { ZuploContext, ZuploRequest } from "@zuplo/runtime";

export default async function (
  request: ZuploRequest,
  context: ZuploContext,
) {
  context.log.info("DEBUG request.user", {
    sub: request.user?.sub,
    data: request.user?.data,
  });
  return request;
}

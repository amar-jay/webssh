import { readJSON } from "#lib/state/client.js";
import type { RequestHandler } from "./$types";
import {
  ownerStub,
  noStore,
  jsonError,
  pairingStub,
  clientIp,
} from "#lib/state/client.js";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
export const POST: RequestHandler = async ({ request, platform }) => {
  const env = await runtimeEnv(platform?.env);
  if (!env?.WEBSSH_STATE) return jsonError("unavailable", 503);
  let body: Record<string, string>;
  try {
    body = (await readJSON(request)) as Record<string, string>;
  } catch {
    return jsonError("invalid_request");
  }
  if (
    !body ||
    ["ownerId", "agentId", "agentToken"].some(
      (k) => typeof body[k] !== "string" || body[k].length > 128 || !body[k],
    ) ||
    (body.generation !== undefined &&
      (typeof body.generation !== "string" || body.generation.length > 128)) ||
    (body.runId !== undefined &&
      (typeof body.runId !== "string" || body.runId.length > 128)) ||
    (body.sessionId !== undefined &&
      (typeof body.sessionId !== "string" || body.sessionId.length > 128)) ||
    (body.nonce !== undefined &&
      (typeof body.nonce !== "string" || body.nonce.length > 128))
  )
    return jsonError("invalid_request");
  try {
    await pairingStub(env.WEBSSH_STATE as never).limitRequest(
      clientIp(request),
      "agent",
    );
    if (body.operation === "renew" || body.operation === "revoke")
      return noStore(
        await ownerStub(
          env.WEBSSH_STATE as never,
          body.ownerId,
        ).agentCredential(
          body.ownerId,
          body.agentId,
          body.agentToken,
          body.operation,
          body.replacementToken,
          body.operationId,
        ),
      );
    if (body.operation) return jsonError("invalid_request");
    return noStore(
      await ownerStub(env.WEBSSH_STATE as never, body.ownerId).agentSession(
        body.ownerId,
        body.agentId,
        body.agentToken,
        body.sessionId,
        body.nonce,
        body.runId,
        body.generation,
      ),
    );
  } catch (error) {
    return error instanceof Error && error.message === "pairing_rate_limited"
      ? jsonError("rate_limited", 429)
      : jsonError("unauthorized", 401);
  }
};

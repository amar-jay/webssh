import type { RequestHandler } from "./$types";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import {
  readJSON,
  clientIp,
  ownerStub,
  pairingStub,
  jsonError,
  noStore,
} from "#lib/state/client.js";
export const POST: RequestHandler = async ({ request, platform }) => {
  const env = await runtimeEnv(platform?.env);
  if (!env?.WEBSSH_STATE) return jsonError("unavailable", 503);
  let body;
  try {
    body = (await readJSON(request)) as { code?: string; cliSecret?: string };
  } catch {
    return jsonError("invalid_request");
  }
  if (
    !body ||
    typeof body.code !== "string" ||
    !/^[A-Z0-9]{8}$/.test(body.code) ||
    typeof body.cliSecret !== "string" ||
    !/^[A-Za-z0-9_-]{32}$/.test(body.cliSecret)
  )
    return jsonError("invalid_request");
  try {
    const hub = pairingStub(env.WEBSSH_STATE as never);
    await hub.limitRequest(clientIp(request), "poll");
    const result = await hub.pollCLIAttach(body.code, body.cliSecret);
    if (result.status !== "approved") return noStore(result);
    const descriptor = await ownerStub(
      env.WEBSSH_STATE as never,
      result.ownerId,
    ).resolveSession(result.ownerId, result.sessionId, result.browserId);
    return noStore({ status: "approved", ...descriptor });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "pairing_unauthorized") return jsonError("unauthorized", 401);
    if (code === "pairing_rate_limited") return jsonError(code, 429);
    return jsonError(
      [
        "session_busy",
        "session_ended",
        "session_expired",
        "agent_offline",
        "agent_revoked",
      ].includes(code)
        ? code
        : "session_unavailable",
      409,
    );
  }
};

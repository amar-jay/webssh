import { readJSON } from "#lib/state/client.js";
import type { RequestHandler } from "./$types";
import type { AuthEnv } from "#lib/auth/env.js";
import {
  jsonError,
  noStore,
  ownerStub,
  pairingStub,
} from "#lib/state/client.js";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!locals.user) return jsonError("unauthorized", 401);
  const env = await runtimeEnv(platform?.env as AuthEnv | undefined);
  if (!env?.WEBSSH_STATE) return jsonError("unavailable", 503);
  let body: { code?: string };
  try {
    body = (await readJSON(request)) as { code?: string };
  } catch {
    return jsonError("invalid_json");
  }
  if (!body || typeof body.code !== "string")
    return jsonError("invalid_request");
  const code = body.code?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{8}$/.test(code)) return jsonError("invalid_code");
  try {
    const pairing = pairingStub(env.WEBSSH_STATE as never);
    const claimed = await pairing.approvePairing(code, locals.user.ownerId);
    const owner = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
    let registeredId: string | undefined;
    try {
      const agent = await owner.registerAgent(
        locals.user.ownerId,
        claimed.machineName,
      );
      registeredId = agent.agentId;
      await pairing.completePairing(claimed.attemptId, locals.user.ownerId, {
        agentId: agent.agentId,
        agentToken: agent.agentToken,
        grantKey: agent.grantKey,
        machineName: claimed.machineName,
      });
      return noStore({
        ok: true,
        agentId: agent.agentId,
        machineName: claimed.machineName,
      });
    } catch (error) {
      if (registeredId)
        await owner.revokeAgent(locals.user.ownerId, registeredId);
      await pairing.abortPairing(claimed.attemptId, locals.user.ownerId);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "pairing_failed";
    const status =
      message === "pairing_expired" ||
      message === "pairing_not_found" ||
      message === "pairing_unavailable"
        ? 409
        : 400;
    return jsonError(message, status);
  }
};

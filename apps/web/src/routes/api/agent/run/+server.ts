import type { RequestHandler } from "./$types";
import type { RunUpdate } from "@webssh/state/types";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import {
  readJSON,
  ownerStub,
  pairingStub,
  clientIp,
  jsonError,
  noStore,
} from "#lib/state/client.js";

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = await runtimeEnv(platform?.env);
  if (!env?.WEBSSH_STATE) return jsonError("unavailable", 503);
  let body: Record<string, unknown>;
  try {
    body = (await readJSON(request)) as Record<string, unknown>;
  } catch {
    return jsonError("invalid_request");
  }
  if (
    !body ||
    ["ownerId", "agentId", "agentToken", "runId", "operation"].some(
      (k) =>
        typeof body[k] !== "string" ||
        !body[k] ||
        (body[k] as string).length > 128,
    ) ||
    ["machineName", "workspaceLabel", "address", "derpMapURL"].some(
      (k) =>
        body[k] !== undefined &&
        (typeof body[k] !== "string" || (body[k] as string).length > 2048),
    ) ||
    (body.port !== undefined &&
      (!Number.isInteger(body.port) ||
        Number(body.port) < 1 ||
        Number(body.port) > 65535))
  )
    return jsonError("invalid_request");
  if (
    !["start", "announce", "heartbeat", "offline", "end"].includes(
      body.operation as string,
    )
  )
    return jsonError("invalid_operation");
  if (
    body.backend !== undefined &&
    !["tmux", "ephemeral"].includes(body.backend as string)
  )
    return jsonError("invalid_request");
  if (
    body.generation !== undefined &&
    (typeof body.generation !== "string" ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(body.generation))
  )
    return jsonError("invalid_request");
  if (body.backend === "tmux" && !body.generation)
    return jsonError("invalid_request");
  for (const key of ["recoveredIds", "endedIds", "terminatedIds"])
    if (
      body[key] !== undefined &&
      (!Array.isArray(body[key]) ||
        (body[key] as unknown[]).length > 128 ||
        (body[key] as unknown[]).some(
          (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id),
        ))
    )
      return jsonError("invalid_request");
  try {
    await pairingStub(env.WEBSSH_STATE as never).limitRequest(
      clientIp(request),
      "agent",
    );
    return noStore(
      await ownerStub(
        env.WEBSSH_STATE as never,
        body.ownerId as string,
      ).agentRun(
        body.ownerId as string,
        body.agentId as string,
        body.agentToken as string,
        body as unknown as RunUpdate,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return jsonError(
      message === "pairing_rate_limited"
        ? "rate_limited"
        : message === "unauthorized"
          ? "unauthorized"
          : "session_unavailable",
      message === "pairing_rate_limited"
        ? 429
        : message === "unauthorized"
          ? 401
          : 409,
    );
  }
};

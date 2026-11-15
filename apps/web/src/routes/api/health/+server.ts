import release from "../../../../../../release.json";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { requireAuthEnv } from "#lib/auth/env.js";
import { noStore } from "#lib/state/client.js";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ platform }) => {
  const env = await runtimeEnv(platform?.env);
  try {
    if (!env?.WEBSSH_STATE) throw new Error("unavailable");
    requireAuthEnv(env);
    const state = env.WEBSSH_STATE.get(
      env.WEBSSH_STATE.idFromName("health"),
    ) as unknown as { health(): Promise<{ schema: number }> };
    const timer = AbortSignal.timeout(3000);
    const health = await Promise.race([
      state.health(),
      new Promise<never>((_, reject) =>
        timer.addEventListener(
          "abort",
          () => reject(new Error("unavailable")),
          { once: true },
        ),
      ),
    ]);
    if (health.schema !== 5) throw new Error("unavailable");
    return noStore({
      app: "ok",
      state: "ok",
      protocol: release.protocol,
      bridge: release.bridge,
      release: release.version,
    });
  } catch {
    return noStore({ app: "ok", state: "unavailable" }, 503);
  }
};

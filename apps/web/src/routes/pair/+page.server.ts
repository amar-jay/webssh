import { normalizePairingCode, validPairingCode } from "#lib/pairing-code.js";
import { pairingStub } from "#lib/state/client.js";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals, platform }) => {
  const raw = normalizePairingCode(url.searchParams.get("code") || "");
  if (!raw) {
    if (!locals.user)
      throw redirect(303, `/login?next=${encodeURIComponent("/pair")}`);
    return { code: "", error: null, user: locals.user };
  }
  if (!validPairingCode(raw)) {
    return { code: "", error: "invalid_code", user: locals.user };
  }
  if (!locals.user) {
    throw redirect(
      303,
      `/login?next=${encodeURIComponent(`/pair?code=${raw}`)}`,
    );
  }
  try {
    const env = await runtimeEnv(platform?.env);
    if (!env?.WEBSSH_STATE) throw new Error("state_unavailable");
    const preview = await pairingStub(env.WEBSSH_STATE as never).previewPairing(
      raw,
      locals.user.ownerId,
    );
    return {
      code: raw,
      error: null,
      user: locals.user,
      machineName: preview.machineName,
    };
  } catch {
    return { code: "", error: "pairing_unavailable", user: locals.user };
  }
};

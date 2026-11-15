import type { StateAPI } from "@webssh/state/types";

type StateNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): StateAPI;
};

export function ownerStub(ns: StateNamespace, ownerId: string) {
  return ns.get(ns.idFromName(`owner:${ownerId}`));
}

export function pairingStub(ns: StateNamespace) {
  return ns.get(ns.idFromName("pairing"));
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

const publicErrors = new Set([
  "request_failed",
  "unavailable",
  "unauthorized",
  "not_found",
  "auth_not_configured",
  "invalid_json",
  "invalid_request",
  "invalid_machine_name",
  "invalid_code",
  "invalid_session",
  "invalid_agent",
  "invalid_operation",
  "invalid_run",
  "invalid_descriptor",
  "pairing_rate_limited",
  "pairing_unauthorized",
  "pairing_not_found",
  "pairing_expired",
  "pairing_unavailable",
  "pairing_failed",
  "approval_failed",
  "poll_failed",
  "agent_not_found",
  "agent_revoked",
  "agent_offline",
  "session_unavailable",
  "session_ended",
  "session_expired",
  "session_busy",
  "resource_limit",
  "rate_limited",
  "grant_failed",
  "revoke_failed",
]);

export function jsonError(error: string, status = 400): Response {
  const safe = publicErrors.has(error) ? error : "request_failed";
  return Response.json(
    { error: safe },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function noStore(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** Bound bytes, chunks and elapsed time; Content-Length is not trusted. */
export async function readTextBounded(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw Error("invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0,
    count = 0;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Error("request_timeout"));
      void reader.cancel().catch(() => {});
    }, 5_000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (++count > 1024 || (size += value.byteLength) > 16384) {
        void reader.cancel().catch(() => {});
        throw Error("request_too_large");
      }
      if (value.length) chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timer!);
    reader.releaseLock();
  }
}
export async function readJSON(request: Request): Promise<unknown> {
  return JSON.parse(await readTextBounded(request));
}
export async function readForm(request: Request): Promise<URLSearchParams> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/x-www-form-urlencoded"
  )
    throw Error("invalid_request");
  return new URLSearchParams(await readTextBounded(request));
}

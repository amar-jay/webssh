import {
  TerminalMessage,
  Capability,
  Backend,
  OpenRequest_Mode,
  Lifecycle_State,
  Failure_Code,
} from "./generated/terminal.ts";
export { TerminalMessage } from "./generated/terminal.ts";
function enumName(values: Record<string, number>, value: number): string {
  return (
    Object.entries(values)
      .find(([, v]) => v === value)?.[0]
      ?.toLowerCase() ?? "invalid"
  );
}
export const version = 2;
export const defaultPort = 8022;
export const maxFrameSize = 128 * 1024;
export const maxDataSize = 64 * 1024;

export type Message =
  | {
      type: "attach" | "create";
      version: 2;
      sessionId?: string;
      token: string;
      cols: number;
      rows: number;
      term?: string;
      capabilities?: string[];
    }
  | {
      type: "ready";
      version: 2;
      sessionId?: string;
      backend?: string;
      capabilities?: string[];
    }
  | { type: "input" | "output"; data: Uint8Array }
  | { type: "resize"; cols: number; rows: number }
  | {
      type:
        "detach" | "terminate" | "detached" | "terminated" | "ping" | "pong";
    }
  | { type: "exit"; code?: number; codeKnown?: boolean }
  | { type: "error"; error: string; retryable?: boolean };

function size(cols: unknown, rows: unknown) {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    Number(cols) >= 1 &&
    Number(cols) <= 1000 &&
    Number(rows) >= 1 &&
    Number(rows) <= 500
  );
}
function decodeMessage(value: unknown): Message {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid terminal message");
  const m = value as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    attach: [
      "type",
      "version",
      "token",
      "cols",
      "rows",
      "term",
      "sessionId",
      "capabilities",
    ],
    create: [
      "type",
      "version",
      "token",
      "cols",
      "rows",
      "term",
      "sessionId",
      "capabilities",
    ],
    ready: ["type", "version", "sessionId", "backend", "capabilities"],
    input: ["type", "data"],
    output: ["type", "data"],
    resize: ["type", "cols", "rows"],
    detach: ["type"],
    terminate: ["type"],
    ping: ["type"],
    pong: ["type"],
    detached: ["type"],
    terminated: ["type"],
    exit: ["type", "code", "codeKnown"],
    error: ["type", "error", "retryable"],
  };
  if (
    typeof m.type !== "string" ||
    !Object.hasOwn(fields, m.type) ||
    Object.keys(m).some((k) => !fields[m.type as string].includes(k))
  )
    throw new Error("Invalid terminal message");
  switch (m.type) {
    case "create":
    case "attach":
      if (
        m.version !== 2 ||
        typeof m.token !== "string" ||
        m.token.length < 32 ||
        m.token.length > 512 ||
        !size(m.cols, m.rows) ||
        (m.term !== undefined &&
          (typeof m.term !== "string" ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,63}$/.test(m.term)))
      )
        throw new Error("Invalid attach");
      break;
    case "ready":
      if (m.version !== 2) throw new Error("Unsupported terminal version");
      break;
    case "resize":
      if (!size(m.cols, m.rows)) throw new Error("Invalid resize");
      break;
    case "input":
    case "output": {
      if (!(m.data instanceof Uint8Array) || m.data.length > maxDataSize)
        throw new Error("Invalid terminal bytes");
      return { type: m.type, data: m.data };
    }
    case "exit":
      if (
        m.code !== undefined &&
        (!Number.isInteger(m.code) ||
          Number(m.code) < 0 ||
          Number(m.code) > 255)
      )
        throw new Error("Invalid exit code");
      break;
    case "error":
      if (
        typeof m.error !== "string" ||
        !/^[a-z_]{1,64}$/.test(m.error) ||
        !Failure_Code[m.error.toUpperCase() as keyof typeof Failure_Code]
      )
        throw new Error("Invalid error code");
      break;
  }
  if (
    m.sessionId !== undefined &&
    (typeof m.sessionId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(m.sessionId))
  )
    throw new Error("Invalid session");
  if (
    m.capabilities !== undefined &&
    (!Array.isArray(m.capabilities) ||
      m.capabilities.some(
        (c) => !["persistence", "reconnect", "terminate"].includes(c),
      ))
  )
    throw new Error("Invalid capability");
  return m as Message;
}

export function encode(message: Message): Uint8Array {
  decodeMessage(message);
  let payload: TerminalMessage["payload"];
  const caps = (values?: string[]) =>
    (values ?? []).map(
      (c) =>
        Capability[c.toUpperCase() as keyof typeof Capability] as Capability,
    );
  switch (message.type) {
    case "attach":
    case "create":
      payload = {
        $case: "open",
        open: {
          sessionId: message.sessionId ?? "",
          token: message.token,
          size: { cols: message.cols, rows: message.rows },
          term: message.term ?? "",
          mode:
            message.type === "create"
              ? OpenRequest_Mode.CREATE_OR_ATTACH
              : OpenRequest_Mode.ATTACH_EXISTING,
          capabilities: caps(message.capabilities),
        },
      };
      break;
    case "ready":
      payload = {
        $case: "ready",
        ready: {
          sessionId: message.sessionId ?? "",
          backend: message.backend
            ? (Backend[
                message.backend.toUpperCase() as keyof typeof Backend
              ] as Backend)
            : Backend.BACKEND_UNSPECIFIED,
          capabilities: caps(message.capabilities),
        },
      };
      break;
    case "input":
      payload = { $case: "input", input: { data: message.data } };
      break;
    case "output":
      payload = { $case: "output", output: { data: message.data } };
      break;
    case "resize":
      payload = {
        $case: "resize",
        resize: { cols: message.cols, rows: message.rows },
      };
      break;
    case "detach":
      payload = { $case: "detach", detach: {} };
      break;
    case "ping":
      payload = { $case: "ping", ping: {} };
      break;
    case "pong":
      payload = { $case: "pong", pong: {} };
      break;
    case "terminate":
      payload = { $case: "terminate", terminate: {} };
      break;
    case "exit":
    case "detached":
    case "terminated":
      payload = {
        $case: "lifecycle",
        lifecycle: {
          state:
            message.type === "exit"
              ? Lifecycle_State.ENDED
              : message.type === "detached"
                ? Lifecycle_State.DETACHED
                : Lifecycle_State.TERMINATED,
          exitCode: message.type === "exit" ? (message.code ?? 0) : 0,
          exitCodeKnown:
            message.type === "exit" ? (message.codeKnown ?? false) : false,
        },
      };
      break;
    case "error":
      payload = {
        $case: "failure",
        failure: {
          code: Failure_Code[
            message.error.toUpperCase() as keyof typeof Failure_Code
          ] as Failure_Code,
          retryable: message.retryable ?? false,
        },
      };
      break;
  }
  const body = TerminalMessage.encode({
    version: "version" in message ? message.version : 0,
    payload,
  }).finish();
  if (body.length > maxFrameSize) throw new Error("Terminal frame too large");
  const frame = new Uint8Array(body.length + 4);
  new DataView(frame.buffer).setUint32(0, body.length);
  frame.set(body, 4);
  return frame;
}

/** Incremental decoder: chunks may split or combine frames. Discard on failure. */
export class Decoder {
  private pending: Uint8Array = new Uint8Array();
  private failed = false;
  push(chunk: Uint8Array): Message[] {
    if (this.failed) throw new Error("Terminal decoder has failed");
    try {
      if (chunk.length > maxFrameSize + 4)
        throw new Error("Transport chunk too large");
      const bytes = new Uint8Array(this.pending.length + chunk.length);
      bytes.set(this.pending);
      bytes.set(chunk, this.pending.length);
      const messages: Message[] = [];
      let offset = 0;
      while (bytes.length - offset >= 4) {
        const length = new DataView(
          bytes.buffer,
          bytes.byteOffset + offset,
          4,
        ).getUint32(0);
        if (length === 0 || length > maxFrameSize)
          throw new Error("Invalid terminal frame length");
        if (bytes.length - offset - 4 < length) break;
        const wire = TerminalMessage.decode(
          bytes.subarray(offset + 4, offset + 4 + length),
        );
        let value: Record<string, unknown>;
        const p = wire.payload;
        if (!p) throw new Error("Unsupported terminal protocol");
        switch (p.$case) {
          case "open":
            value = {
              type:
                p.open.mode === OpenRequest_Mode.CREATE_OR_ATTACH
                  ? "create"
                  : "attach",
              version: wire.version,
              token: p.open.token,
              cols: p.open.size?.cols,
              rows: p.open.size?.rows,
            };
            if (
              p.open.mode !== OpenRequest_Mode.CREATE_OR_ATTACH &&
              p.open.mode !== OpenRequest_Mode.ATTACH_EXISTING
            )
              throw new Error("Invalid open mode");
            if (p.open.term) value.term = p.open.term;
            if (p.open.sessionId) value.sessionId = p.open.sessionId;
            if (p.open.capabilities.length)
              value.capabilities = p.open.capabilities.map((c) =>
                enumName(Capability, c),
              );
            break;
          case "ready":
            value = { type: "ready", version: wire.version };
            if (p.ready.sessionId) value.sessionId = p.ready.sessionId;
            if (p.ready.backend)
              value.backend = enumName(Backend, p.ready.backend);
            if (p.ready.capabilities.length)
              value.capabilities = p.ready.capabilities.map((c) =>
                enumName(Capability, c),
              );
            break;
          case "input":
            value = { type: "input", data: p.input.data };
            break;
          case "output":
            value = { type: "output", data: p.output.data };
            break;
          case "resize":
            value = {
              type: "resize",
              cols: p.resize.cols,
              rows: p.resize.rows,
            };
            break;
          case "detach":
            value = { type: "detach" };
            break;
          case "ping":
            value = { type: "ping" };
            break;
          case "pong":
            value = { type: "pong" };
            break;
          case "terminate":
            value = { type: "terminate" };
            break;
          case "lifecycle":
            value = {
              type:
                p.lifecycle.state === Lifecycle_State.ENDED
                  ? "exit"
                  : p.lifecycle.state === Lifecycle_State.DETACHED
                    ? "detached"
                    : p.lifecycle.state === Lifecycle_State.TERMINATED
                      ? "terminated"
                      : "invalid",
            };
            if (p.lifecycle.exitCode) value.code = p.lifecycle.exitCode;
            if (p.lifecycle.exitCodeKnown) value.codeKnown = true;
            break;
          case "failure":
            value = {
              type: "error",
              error: enumName(Failure_Code, p.failure.code),
            };
            if (p.failure.retryable) value.retryable = true;
            break;
        }
        if (!["open", "ready"].includes(p.$case) && wire.version !== 0)
          throw new Error("Unexpected protocol version");
        messages.push(decodeMessage(value));
        offset += 4 + length;
      }
      this.pending = bytes.slice(offset);
      return messages;
    } catch (error) {
      this.failed = true;
      this.pending = new Uint8Array();
      throw error;
    }
  }
  finish(): void {
    if (this.failed || this.pending.length)
      throw new Error("Truncated terminal stream");
  }
}

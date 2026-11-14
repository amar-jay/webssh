import { TerminalMessage } from './generated/terminal.ts';
export { TerminalMessage } from './generated/terminal.ts';
export const version = 1;
export const defaultPort = 8022;
export const maxFrameSize = 128 * 1024;
export const maxDataSize = 64 * 1024;

export type Message =
  | { type: 'attach'; version: 1; token: string; cols: number; rows: number; term?: string }
  | { type: 'ready'; version: 1 }
  | { type: 'input' | 'output'; data: Uint8Array }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'detach' }
  | { type: 'exit'; code?: number }
  | { type: 'error'; error: string };

function size(cols: unknown, rows: unknown) {
  return Number.isInteger(cols) && Number.isInteger(rows) && Number(cols) >= 1 && Number(cols) <= 1000 && Number(rows) >= 1 && Number(rows) <= 500;
}
function decodeMessage(value: unknown): Message {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid terminal message');
  const m = value as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    attach: ['type', 'version', 'token', 'cols', 'rows', 'term'], ready: ['type', 'version'],
    input: ['type', 'data'], output: ['type', 'data'], resize: ['type', 'cols', 'rows'],
    detach: ['type'], exit: ['type', 'code'], error: ['type', 'error']
  };
  if (typeof m.type !== 'string' || !Object.hasOwn(fields, m.type) || Object.keys(m).some(k => !fields[m.type as string].includes(k))) throw new Error('Invalid terminal message');
  switch (m.type) {
    case 'attach':
      if (m.version !== 1 || typeof m.token !== 'string' || m.token.length < 32 || m.token.length > 128 || !size(m.cols, m.rows) || (m.term !== undefined && (typeof m.term !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,63}$/.test(m.term)))) throw new Error('Invalid attach');
      break;
    case 'ready': if (m.version !== 1) throw new Error('Unsupported terminal version'); break;
    case 'resize': if (!size(m.cols, m.rows)) throw new Error('Invalid resize'); break;
    case 'input': case 'output': {
      if (!(m.data instanceof Uint8Array) || m.data.length > maxDataSize) throw new Error('Invalid terminal bytes');
      return { type: m.type, data: m.data };
    }
    case 'exit': if (m.code !== undefined && (!Number.isInteger(m.code) || Number(m.code) < 0 || Number(m.code) > 255)) throw new Error('Invalid exit code'); break;
    case 'error': if (typeof m.error !== 'string' || !/^[a-z_]{1,64}$/.test(m.error)) throw new Error('Invalid error code'); break;
  }
  return m as Message;
}

export function encode(message: Message): Uint8Array {
  decodeMessage(message);
  const body = TerminalMessage.encode({version:0,token:'',cols:0,rows:0,term:'',data:new Uint8Array(),code:0,error:'',...message}).finish();
  if (body.length > maxFrameSize) throw new Error('Terminal frame too large');
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
    if (this.failed) throw new Error('Terminal decoder has failed');
    try {
      if (chunk.length > maxFrameSize + 4) throw new Error('Transport chunk too large');
      const bytes = new Uint8Array(this.pending.length + chunk.length);
      bytes.set(this.pending); bytes.set(chunk, this.pending.length);
      const messages: Message[] = [];
      let offset = 0;
      while (bytes.length - offset >= 4) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
        if (length === 0 || length > maxFrameSize) throw new Error('Invalid terminal frame length');
        if (bytes.length - offset - 4 < length) break;
        const wire = TerminalMessage.decode(bytes.subarray(offset + 4, offset + 4 + length));
        const value: Record<string, unknown> = { type: wire.type };
        for (const [key, item] of Object.entries(wire)) {
          if (key !== 'type' && (item instanceof Uint8Array ? item.length > 0 : item !== '' && item !== 0)) value[key] = item;
        }
        if (wire.type === 'input' || wire.type === 'output') value.data = wire.data;
        messages.push(decodeMessage(value));
        offset += 4 + length;
      }
      this.pending = bytes.slice(offset);
      return messages;
    } catch (error) { this.failed = true; this.pending = new Uint8Array(); throw error; }
  }
  finish(): void {
    if (this.failed || this.pending.length) throw new Error('Truncated terminal stream');
  }
}

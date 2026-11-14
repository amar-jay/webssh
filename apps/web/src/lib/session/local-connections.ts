import type { Connection } from '../terminal/remote-session.js';
export type LocalSession = { mode: 'remote'; connection: Connection } | { mode: 'mock' };
// Single-use browser memory only. Never serialize credentials into route data.
const pending = new Map<string, LocalSession>();
export function putLocalSession(session: LocalSession): string {
  pending.clear();
  const id = crypto.randomUUID();
  pending.set(id, session);
  return id;
}
export function takeLocalSession(id: string): LocalSession | undefined {
  const session = pending.get(id);
  pending.delete(id);
  return session;
}

import { randomUUID } from 'node:crypto';
import type { Content } from '@google/genai';

/** A half-finished claim the rule-based agent is collecting details for. */
export interface Draft {
  amount?: number;
  category?: string;
  date?: string;
  dateAssumed?: boolean;
  city?: string;
  units?: number;
  description?: string;
  /** What the assistant last asked for. */
  awaiting?: 'category' | 'city' | 'amount' | 'date' | 'confirm';
}

export interface Session {
  id: string;
  employeeId: string;
  /** Gemini conversation history (function calls included). Append-only. */
  messages: Content[];
  draft: Draft | null;
  turns: number;
  busy: boolean;
  updatedAt: number;
}

export const MAX_TURNS_PER_SESSION = 40;
const MAX_SESSIONS = 500;

// In-memory on purpose: a chat is a scratchpad. Claims themselves are in the database.
const g = globalThis as unknown as { __claimeaseSessions?: Map<string, Session> };
const store = (): Map<string, Session> => (g.__claimeaseSessions ??= new Map());

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Returns the caller's session, or starts a new one. A session never crosses employees. */
export function getSession(id: string | undefined, employeeId: string): Session {
  const sessions = store();
  const existing = id && ID_RE.test(id) ? sessions.get(id) : undefined;
  if (existing && existing.employeeId === employeeId) {
    existing.updatedAt = Date.now();
    return existing;
  }
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (oldest) sessions.delete(oldest.id);
  }
  const session: Session = { id: randomUUID(), employeeId, messages: [], draft: null, turns: 0, busy: false, updatedAt: Date.now() };
  sessions.set(session.id, session);
  return session;
}

export function resetSession(id: string | undefined, employeeId: string): void {
  const s = id ? store().get(id) : undefined;
  if (s && s.employeeId === employeeId) store().delete(s.id);
}

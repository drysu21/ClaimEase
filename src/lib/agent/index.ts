import type { Db } from '../db';
import type { Employee } from '../claims';
import { inr } from '../domain';
import { GEMINI_MODEL, LlmError, llmEnabled, runGemini } from './llm';
import { respondWithRules, type TraceCall } from './rules';
import { MAX_TURNS_PER_SESSION, getSession } from './sessions';

export interface ChatResponse {
  sessionId: string;
  reply: string;
  toolCalls: TraceCall[];
  mode: 'gemini' | 'rules';
  /** A heads-up for the UI, e.g. Gemini was unreachable so the built-in rules answered. */
  notice?: string;
}

export class BusyError extends Error {}

/** Says what went wrong with the model call, in words an employee can act on. */
function fallbackNotice(err: unknown): string {
  const cause = err instanceof LlmError ? (err.cause as { status?: number } | undefined) : undefined;
  const text = err instanceof Error ? err.message : String(err);
  const status = cause?.status ?? (Number(/"code":\s*(\d{3})/.exec(text)?.[1]) || undefined);
  const tail = 'so the built-in assistant answered this one.';
  if (status === 429) {
    // Google says how long to wait: "retryDelay":"3498s".
    const secs = Number(/"retryDelay":\s*"(\d+)s"/.exec(text)?.[1]);
    const wait = !secs ? '' : secs >= 90 ? ` (try again in about ${Math.round(secs / 60)} minutes)` : ` (try again in about ${secs} seconds)`;
    return `Gemini's quota is used up for now${wait}, ${tail}`;
  }
  if (status === 504 || status === 408 || /timed? ?out|deadline/i.test(text)) return `Gemini took too long to answer, ${tail}`;
  if (status === 401 || status === 403) return `Gemini rejected the API key (check GEMINI_API_KEY), ${tail}`;
  return `Gemini could not be reached, ${tail}`;
}

export function agentInfo(): { mode: 'gemini' | 'rules'; model: string | null } {
  return llmEnabled() ? { mode: 'gemini', model: GEMINI_MODEL } : { mode: 'rules', model: null };
}

export async function handleChat(opts: {
  db: Db;
  employee: Employee;
  sessionId?: string;
  message: string;
  today: string;
}): Promise<ChatResponse> {
  const { db, employee, today, message } = opts;
  const session = getSession(opts.sessionId, employee.id);
  if (session.busy) throw new BusyError('Still working on your previous message.');

  session.busy = true;
  try {
    if (session.turns >= MAX_TURNS_PER_SESSION) {
      return {
        sessionId: session.id, mode: agentInfo().mode, toolCalls: [],
        reply: 'This conversation has gotten long. Please start a new chat with the button at the top.',
      };
    }
    const ctx = { db, employee, today };

    if (llmEnabled()) {
      try {
        const out = await runGemini(session.messages, message, ctx);
        session.messages = out.messages;
        session.turns++;
        return { sessionId: session.id, reply: out.reply, toolCalls: out.toolCalls, mode: 'gemini' };
      } catch (err) {
        console.error('[claimease] Gemini call failed:', err instanceof Error ? err.message : err);
        const cause = err instanceof LlmError ? err.toolCalls : [];
        const saved = cause.filter((c) => c.name === 'createClaim' && c.output.ok === true);
        if (saved.length > 0) {
          // Money-affecting work already happened. Never run the turn again, or the claim is filed twice.
          const lines = saved.map((c) => {
            const claim = c.output.claim as { ref: string; amount: number };
            return `${claim.ref} for ${inr(claim.amount)} (${String(c.output.status)})`;
          });
          session.turns++;
          return {
            sessionId: session.id, mode: 'gemini', toolCalls: cause,
            reply: `Your claim was saved: ${lines.join(', ')}. I had trouble writing the rest of my reply, so check My claims for the details.`,
            notice: 'The AI model failed after saving the claim.',
          };
        }
        const fallback = await respondWithRules(message, session, ctx);
        session.turns++;
        return {
          sessionId: session.id, mode: 'rules', reply: fallback.reply, toolCalls: fallback.toolCalls,
          notice: fallbackNotice(err),
        };
      }
    }

    const out = await respondWithRules(message, session, ctx);
    session.turns++;
    return { sessionId: session.id, reply: out.reply, toolCalls: out.toolCalls, mode: 'rules' };
  } finally {
    session.busy = false;
  }
}

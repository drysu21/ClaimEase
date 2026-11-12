'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { TraceCall } from '@/lib/agent/rules';
import type { SlimClaim } from '@/lib/tools';
import { formatDate, inr } from '@/lib/domain';
import { ClaimsTable, stayText } from './ClaimsTable';
import { StatusLabel } from './StatusLabel';

interface Msg {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  calls?: TraceCall[];
  notice?: string;
}

interface Props {
  employee: { id: string; name: string; grade: string };
  agent: { mode: 'gemini' | 'rules'; model: string | null };
  examples: string[];
}

const MAX_CHARS = 1000;
const MAX_TABLE_ROWS = 6;

function shortJson(v: unknown, max = 700): string {
  const s = JSON.stringify(v, null, 1) ?? '';
  return s.length > max ? s.slice(0, max) + ' …' : s;
}

function ClaimCard({ claim, rule }: { claim: SlimClaim; rule: { max_amount: number; unit: string } | null }) {
  return (
    <div className="claim-card">
      <div className="claim-card-top">
        <span className="ref">{claim.ref}</span>
        <StatusLabel status={claim.status} />
      </div>
      <p className="claim-amount num">{inr(claim.amount)}</p>
      <dl className="kv">
        <dt>Category</dt>
        <dd>{claim.category_label}</dd>
        <dt>Expense date</dt>
        <dd>{formatDate(claim.expense_date)}</dd>
        {stayText(claim) && (
          <>
            <dt>Stay</dt>
            <dd>{stayText(claim)}</dd>
          </>
        )}
        {rule && (
          <>
            <dt>Your limit</dt>
            <dd>
              {inr(rule.max_amount)} {rule.unit === 'per_night' ? 'per night' : 'per claim'}
            </dd>
          </>
        )}
      </dl>
      {rule && <LimitMeter claim={claim} rule={rule} />}
      {claim.flag_reason && <p className="reason reason-flag">{claim.flag_reason}</p>}
    </div>
  );
}

/** Amount against the grade limit: fills to the limit marker, and past it in amber when over. */
function LimitMeter({ claim, rule }: { claim: SlimClaim; rule: { max_amount: number; unit: string } }) {
  const spent = rule.unit === 'per_night' ? claim.amount / Math.max(claim.units, 1) : claim.amount;
  const scale = Math.max(spent, rule.max_amount) || 1;
  const over = spent > rule.max_amount;
  const pct = Math.round((spent / rule.max_amount) * 100);
  return (
    <div className="meter" role="img" aria-label={`${pct}% of the ${inr(rule.max_amount)} limit`}>
      <div className="meter-track">
        <div className={`meter-fill${over ? ' meter-over' : ''}`} style={{ width: `${(spent / scale) * 100}%` }} />
        <div className="meter-limit" style={{ left: `${(rule.max_amount / scale) * 100}%` }} />
      </div>
      <p className="meter-text small">
        <span className={over ? 'status-flagged' : 'status-approved'}>{pct}% of limit</span>
        <span className="muted"> · {inr(spent)} of {inr(rule.max_amount)}{rule.unit === 'per_night' ? ' per night' : ''}</span>
      </p>
    </div>
  );
}

function AssistantExtras({ calls }: { calls: TraceCall[] }) {
  const created = calls.find((c) => c.name === 'createClaim' && c.output.ok === true);
  const listed = [...calls].reverse().find((c) => c.name === 'getMyClaims' && c.output.ok === true);
  const listedClaims = (listed?.output.claims as SlimClaim[] | undefined) ?? [];

  return (
    <>
      {created && <ClaimCard claim={created.output.claim as SlimClaim} rule={created.output.rule as { max_amount: number; unit: string } | null} />}
      {listed && listedClaims.length > 0 && (
        <div className="chat-table">
          <ClaimsTable compact claims={listedClaims.slice(0, MAX_TABLE_ROWS)} caption="Your claims" />
          <p className="muted small">
            {listedClaims.length > MAX_TABLE_ROWS || Number(listed.output.count) > listedClaims.length
              ? `Showing ${Math.min(MAX_TABLE_ROWS, listedClaims.length)} of ${String(listed.output.count)}. `
              : ''}
            <Link href="/claims">Open My claims</Link>
          </p>
        </div>
      )}
      {calls.length > 0 && (
        <div className="steps">
          <p className="steps-title">Agent workflow · {calls.length} {calls.length === 1 ? 'step' : 'steps'}</p>
          <ol className="flow-steps">
            {calls.map((c, i) => {
              const write = c.name === 'createClaim';
              const result = String(c.output.status ?? c.output.outcome ?? (c.output.ok === false ? 'refused' : 'ok'));
              return (
                <li key={i} className={`flow-step${c.output.ok === false ? ' flow-step-bad' : ''}`}>
                  <span className="flow-num">{i + 1}</span>
                  <span className={`flow-kind ${write ? 'flow-write' : 'flow-read'}`}>{write ? 'WRITE' : 'READ'}</span>
                  <code>{c.name}</code>
                  <span className="flow-result">→ {result}</span>
                  <details>
                    <summary>details</summary>
                    <pre>{shortJson({ input: c.input, result: c.output })}</pre>
                  </details>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
}

export function Chat({ employee, agent, examples }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const storeKey = `claimease:chat:${employee.id}`;

  // Restore this tab's conversation (per employee) after mount. Storage may be unavailable, so it is optional.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storeKey) ?? 'null') as { sessionId?: string; msgs: Msg[] } | null;
      if (saved?.msgs?.length) {
        sessionId.current = saved.sessionId;
        nextId.current = Math.max(...saved.msgs.map((m) => m.id)) + 1;
        setMsgs(saved.msgs);
      } else {
        setMsgs([]);
        sessionId.current = undefined;
      }
    } catch {
      /* ignore */
    }
  }, [storeKey]);

  useEffect(() => {
    try {
      if (msgs.length) sessionStorage.setItem(storeKey, JSON.stringify({ sessionId: sessionId.current, msgs }));
    } catch {
      /* ignore */
    }
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [msgs, busy, storeKey]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput('');
      setBusy(true);
      setMsgs((m) => [...m, { id: nextId.current++, role: 'user', text }]);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId.current, message: text }),
        });
        const data = (await res.json().catch(() => null)) as
          | { sessionId: string; reply: string; toolCalls: TraceCall[]; notice?: string; error?: string }
          | null;
        if (!res.ok || !data || data.error) throw new Error(data?.error ?? 'Something went wrong. Please try again.');
        sessionId.current = data.sessionId;
        setMsgs((m) => [...m, { id: nextId.current++, role: 'assistant', text: data.reply, calls: data.toolCalls, notice: data.notice }]);
      } catch (err) {
        setMsgs((m) => [...m, { id: nextId.current++, role: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' }]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy],
  );

  function newChat() {
    const id = sessionId.current;
    if (id) void fetch('/api/chat', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id }) });
    sessionId.current = undefined;
    setMsgs([]);
    try {
      sessionStorage.removeItem(storeKey);
    } catch {
      /* ignore */
    }
    inputRef.current?.focus();
  }

  return (
    <section className="chat" aria-label="Claim assistant">
      <div className="chat-head">
        <div>
          <h1>New claim</h1>
          <p className="muted">
            {agent.mode === 'gemini'
              ? `Answering with Gemini (${agent.model}).`
              : 'Answering with the built-in assistant. Set GEMINI_API_KEY to use Gemini.'}
          </p>
        </div>
        <button type="button" className="btn btn-quiet" onClick={newChat} disabled={busy || msgs.length === 0}>
          New chat
        </button>
      </div>

      <div className="messages" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
        {msgs.length === 0 && (
          <div className="empty">
            <h2>What did you spend, {employee.name.split(' ')[0]}?</h2>
            <p>
              Describe it in your own words. I will find the category, check it against your {employee.grade} limits and file the claim.
              Anything over a limit is saved too, flagged with the reason.
            </p>
            <ul className="examples">
              {examples.map((e) => (
                <li key={e}>
                  <button type="button" className="example" onClick={() => send(e)} disabled={busy}>
                    {e}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {msgs.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg msg-user">
              <p className="msg-text">{m.text}</p>
            </div>
          ) : m.role === 'error' ? (
            <div key={m.id} className="msg msg-error" role="alert">
              <p className="msg-text">{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="msg msg-assistant">
              <p className="msg-name">ClaimEase</p>
              <p className="msg-text">{m.text}</p>
              {m.notice && <p className="notice">{m.notice}</p>}
              <AssistantExtras calls={m.calls ?? []} />
            </div>
          ),
        )}
        {busy && (
          <p className="working" role="status">
            Checking the policy
          </p>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor="expense-input" className="visually-hidden">
          Describe your expense
        </label>
        <textarea
          id="expense-input"
          ref={inputRef}
          rows={2}
          maxLength={MAX_CHARS}
          value={input}
          placeholder="For example: I spent 850 rupees on a cab to the airport yesterday"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
          {busy ? 'Sending' : 'Send'}
        </button>
      </form>
    </section>
  );
}

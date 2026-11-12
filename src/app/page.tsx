import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/lib/store';
import { must } from '@/lib/db';
import { CATEGORY_BY_KEY, inr, type Status } from '@/lib/domain';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const TOOLS = [
  ['READ', 'getEmployee', 'who is signed in, and their grade'],
  ['READ', 'getPolicyForCategory', 'limit for a category and city tier'],
  ['READ', 'checkPolicyLimit', 'would this claim pass? saves nothing'],
  ['WRITE', 'createClaim', 'saves as pending, or flagged with the reason'],
  ['READ', 'getMyClaims', 'your claims and totals by status'],
] as const;

export default async function Dashboard() {
  // shortcut: aggregates in JS over all claims; fine for demo volumes, use a SQL view if claims grow large.
  const rows = must(await getDb().from('claims').select('status, amount, category')) as { status: Status; amount: number | string; category: string }[];
  const n = (s: Status) => rows.filter((r) => r.status === s);
  const sum = (rs: typeof rows) => rs.reduce((t, r) => t + Number(r.amount), 0);
  const flagged = n('flagged');
  const autoChecked = rows.length;
  const withinPolicy = rows.filter((r) => r.status !== 'flagged' && r.status !== 'rejected').length;

  const byCat = new Map<string, { ok: number; fl: number }>();
  for (const r of rows) {
    const c = byCat.get(r.category) ?? { ok: 0, fl: 0 };
    if (r.status === 'flagged') c.fl += Number(r.amount); else c.ok += Number(r.amount);
    byCat.set(r.category, c);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1].ok + b[1].fl - (a[1].ok + a[1].fl));
  const max = Math.max(1, ...cats.map(([, v]) => v.ok + v.fl));

  return (
    <div className="page">
      <section className="dash-hero">
        <h1>ClaimEase</h1>
        <p>
          An AI agent that files expense claims from plain English, checks each one against the policy for the
          employee&apos;s grade, and flags anything over the limit or duplicated, so finance only reviews the problems.
        </p>
        <div className="btn-row">
          <Link href="/chat" className="btn btn-primary">File a claim with the agent</Link>
          <Link href="/finance" className="btn">Finance review queue</Link>
        </div>
      </section>

      <div className="stat-grid">
        <div className="stat"><p className="stat-label">Claims checked by the agent</p><p className="stat-value num">{autoChecked}</p><p className="stat-sub">{inr(sum(rows))} in total</p></div>
        <div className="stat"><p className="stat-label">Within policy</p><p className="stat-value num status-approved">{autoChecked ? Math.round((withinPolicy / autoChecked) * 100) : 0}%</p><p className="stat-sub">{withinPolicy} claims, no manual check needed</p></div>
        <div className="stat"><p className="stat-label">Flagged for finance</p><p className="stat-value num status-flagged">{flagged.length}</p><p className="stat-sub">{inr(sum(flagged))} held for review</p></div>
        <div className="stat"><p className="stat-label">Waiting (pending)</p><p className="stat-value num">{n('pending').length}</p><p className="stat-sub">{inr(sum(n('pending')))}</p></div>
        <div className="stat"><p className="stat-label">Decided by finance</p><p className="stat-value num">{n('approved').length + n('rejected').length}</p><p className="stat-sub">{n('approved').length} approved · {n('rejected').length} rejected</p></div>
      </div>

      <div className="dash-cols">
        <section className="dash-card">
          <h2>Spend by category</h2>
          {cats.map(([key, v]) => (
            <div className="bar-row" key={key}>
              <span>{CATEGORY_BY_KEY[key]?.label ?? key}</span>
              <span className="bar" aria-hidden="true">
                <span className="ok" style={{ width: `${(v.ok / max) * 100}%` }} />
                <span className="fl" style={{ width: `${(v.fl / max) * 100}%` }} />
              </span>
              <span className="num" style={{ textAlign: 'right' }}>{inr(v.ok + v.fl)}</span>
            </div>
          ))}
          <p className="legend"><span><i style={{ background: 'var(--color-accent)' }} />Within policy / decided</span><span><i style={{ background: 'var(--color-warn)' }} />Flagged</span></p>
        </section>

        <section className="dash-card">
          <h2>How the agent works</h2>
          <p className="loop">
            <span>You type</span><b>→</b><span>Gemini picks a tool</span><b>→</b><span>Zod checks args</span><b>→</b><span>Policy rules in code</span><b>→</b><span>Supabase</span>
          </p>
          <ul className="tool-list">
            {TOOLS.map(([kind, name, what]) => (
              <li key={name}>
                <span className={`flow-kind ${kind === 'WRITE' ? 'flow-write' : 'flow-read'}`}>{kind}</span>
                <code>{name}</code>
                <span className="muted">{what}</span>
              </li>
            ))}
          </ul>
          <p className="muted small" style={{ marginTop: 'var(--space-sm)' }}>
            Rules: over the grade limit or a duplicate → flagged with the reason · older than 60 days → refused · the AI never sets a status.
          </p>
        </section>
      </div>
    </div>
  );
}

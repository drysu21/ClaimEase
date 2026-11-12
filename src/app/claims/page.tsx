import type { Metadata } from 'next';
import Link from 'next/link';
import { currentEmployee } from '@/lib/auth';
import { getDb } from '@/lib/store';
import { listMyClaims, summarizeMyClaims } from '@/lib/claims';
import { STATUSES, inr, plural, type Status } from '@/lib/domain';
import { ClaimsTable } from '@/components/ClaimsTable';

export const metadata: Metadata = { title: 'My claims' };

const TABS: { key: Status | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = (STATUSES as readonly string[]).includes(raw ?? '') ? (raw as Status) : undefined;

  const me = await currentEmployee();
  const db = getDb();
  const claims = await listMyClaims(db, me.id, { status, limit: 200 });
  const summary = await summarizeMyClaims(db, me.id);
  const shown = status ? summary[status] : summary.all;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My claims</h1>
          <p className="muted">
            {me.name}, grade {me.grade}. Flagged claims are waiting for finance to decide.
          </p>
        </div>
        <Link href="/chat" className="btn btn-primary">
          New claim
        </Link>
      </div>

      <nav className="tabs" aria-label="Filter claims by status">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === 'all' ? '/claims' : `/claims?status=${t.key}`}
            aria-current={(status ?? 'all') === t.key ? 'page' : undefined}
          >
            {t.label} <span className="count num">{summary[t.key].count}</span>
          </Link>
        ))}
      </nav>

      {claims.length === 0 ? (
        <div className="empty-block">
          <h2>{status ? `No ${status} claims` : 'No claims yet'}</h2>
          <p>{status ? 'Nothing here right now.' : 'Describe an expense in the chat and it will show up here.'}</p>
          <Link href="/chat" className="btn btn-quiet">
            Start a claim
          </Link>
        </div>
      ) : (
        <>
          <ClaimsTable claims={claims} caption={`${status ?? 'All'} claims for ${me.name}`} />
          <p className="table-foot num">
            {plural(shown.count, 'claim')} totalling {inr(shown.total)}
          </p>
        </>
      )}
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { currentEmployee } from '@/lib/auth';
import { getDb } from '@/lib/store';
import { listEmployees, listForReview, reviewCounts, type ReviewFilter } from '@/lib/claims';
import { ReviewRow, type ReviewItem } from '@/components/ReviewRow';

export const metadata: Metadata = { title: 'Finance review' };

const TABS: { key: ReviewFilter; label: string }[] = [
  { key: 'open', label: 'Needs review' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const me = await currentEmployee();
  const db = getDb();

  if (me.role !== 'finance') {
    const financeUser = (await listEmployees(db)).find((e) => e.role === 'finance');
    return (
      <div className="page">
        <div className="empty-block" role="status">
          <h1>Finance review</h1>
          <p>
            This queue is for finance staff, and you are signed in as {me.name}.
            {financeUser && ` To see it, choose ${financeUser.name} in the "Signed in as" menu at the top.`}
          </p>
          <Link href="/claims" className="btn btn-quiet">
            Back to my claims
          </Link>
        </div>
      </div>
    );
  }

  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const filter: ReviewFilter = TABS.some((t) => t.key === raw) ? (raw as ReviewFilter) : 'open';
  const counts = await reviewCounts(db);
  const items: ReviewItem[] = (await listForReview(db, filter)).map((c) => ({
    id: c.id,
    ref: c.ref,
    employee_name: c.employee_name,
    employee_grade: c.employee_grade,
    employee_department: c.employee_department,
    category_label: c.category_label,
    description: c.description,
    amount: c.amount,
    units: c.units,
    city: c.city,
    expense_date: c.expense_date,
    status: c.status,
    flag_reason: c.flag_reason,
    policy_limit: c.policy_limit,
    limit_unit: c.policy_limit === null ? null : c.category === 'hotel' ? 'per_night' : 'per_claim',
    reviewer_name: c.reviewer_name,
    reviewed_at: c.reviewed_at,
    review_note: c.review_note,
  }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Finance review</h1>
          <p className="muted">
            Flagged claims come first, then the longest-waiting. A decision is final, and you cannot review your own claims.
          </p>
        </div>
      </div>

      <nav className="tabs" aria-label="Filter the review queue">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === 'open' ? '/finance' : `/finance?status=${t.key}`} aria-current={filter === t.key ? 'page' : undefined}>
            {t.label} <span className="count num">{counts[t.key]}</span>
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="empty-block">
          <h2>{filter === 'open' ? 'The queue is clear' : 'Nothing here'}</h2>
          <p>{filter === 'open' ? 'Every claim has been decided.' : 'No claims match this filter.'}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="review-table">
            <caption className="visually-hidden">Claims for finance review</caption>
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Employee</th>
                <th scope="col">Expense</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Status and reason</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <ReviewRow key={`${item.id}-${item.status}`} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

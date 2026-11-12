import { formatDate, inr, plural, type Status } from '@/lib/domain';
import { StatusLabel } from './StatusLabel';

export interface ClaimLike {
  ref: string;
  expense_date: string;
  category_label: string;
  description: string;
  amount: number;
  status: Status;
  units?: number;
  city?: string | null;
  flag_reason?: string | null;
  review_note?: string | null;
}

export function stayText(c: Pick<ClaimLike, 'units' | 'city'>): string | null {
  return c.city ? `${plural(c.units ?? 1, 'night')} in ${c.city}` : null;
}

/** The employee's own ledger. `compact` is the short version shown inside the chat. */
export function ClaimsTable({ claims, caption, compact = false }: { claims: ClaimLike[]; caption: string; compact?: boolean }) {
  return (
    <div className={compact ? 'table-wrap table-compact' : 'table-wrap'}>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Expense date</th>
            <th scope="col">Category</th>
            {!compact && <th scope="col">Description</th>}
            <th scope="col" className="num">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.ref}>
              <td><span className="ref">{c.ref}</span></td>
              <td className="nowrap">{formatDate(c.expense_date)}</td>
              <td>
                {c.category_label}
                {stayText(c) && <span className="sub">{stayText(c)}</span>}
              </td>
              {!compact && <td className="desc">{c.description}</td>}
              <td className="num">{inr(c.amount)}</td>
              <td>
                <StatusLabel status={c.status} />
                {!compact && c.review_note && <p className="reason">Finance note: {c.review_note}</p>}
                {!compact && c.flag_reason && (
                  <p className={c.status === 'flagged' ? 'reason reason-flag' : 'reason'}>
                    {c.status === 'flagged' ? c.flag_reason : `Was flagged: ${c.flag_reason}`}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

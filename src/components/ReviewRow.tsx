'use client';

import { useActionState, useState } from 'react';
import { decideAction, type DecisionState } from '@/app/finance/actions';
import { formatDate, inr } from '@/lib/domain';
import type { Status } from '@/lib/domain';
import { StatusLabel } from './StatusLabel';
import { stayText } from './ClaimsTable';

export interface ReviewItem {
  id: number;
  ref: string;
  employee_name: string;
  employee_grade: string;
  employee_department: string;
  category_label: string;
  description: string;
  amount: number;
  units: number;
  city: string | null;
  expense_date: string;
  status: Status;
  flag_reason: string | null;
  policy_limit: number | null;
  limit_unit: 'per_claim' | 'per_night' | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export const REVIEW_COLUMNS = 6;

export function ReviewRow({ item }: { item: ReviewItem }) {
  const [mode, setMode] = useState<'approved' | 'rejected' | null>(null);
  const [state, action, pending] = useActionState<DecisionState, FormData>(decideAction, { ok: false });
  const open = item.status === 'pending' || item.status === 'flagged';
  const needsNote = mode === 'rejected' || (mode === 'approved' && item.status === 'flagged');
  const noteId = `note-${item.id}`;

  return (
    <>
      <tr className={item.status === 'flagged' ? 'row-flagged' : undefined}>
        <td>
          <span className="ref">{item.ref}</span>
          <span className="sub">{item.description}</span>
        </td>
        <td>
          {item.employee_name}
          <span className="sub">
            Grade {item.employee_grade}, {item.employee_department}
          </span>
        </td>
        <td>
          {item.category_label}
          <span className="sub">{formatDate(item.expense_date)}</span>
          {stayText(item) && <span className="sub">{stayText(item)}</span>}
        </td>
        <td className="num">
          {inr(item.amount)}
          {item.policy_limit !== null && (
            <span className="sub">
              Limit {inr(item.policy_limit)}
              {item.limit_unit === 'per_night' ? ' per night' : ''}
            </span>
          )}
        </td>
        <td className="status-cell">
          <StatusLabel status={item.status} />
          {item.reviewer_name && (
            <p className="reason">
              {item.status === 'approved' ? 'Approved' : 'Rejected'} by {item.reviewer_name}
              {item.reviewed_at ? ` on ${formatDate(item.reviewed_at.slice(0, 10))}` : ''}
              {item.review_note ? `: ${item.review_note}` : ''}
            </p>
          )}
          {item.flag_reason && (
            <p className={item.status === 'flagged' ? 'reason reason-flag' : 'reason'}>
              {item.status === 'flagged' ? item.flag_reason : `Was flagged: ${item.flag_reason}`}
            </p>
          )}
        </td>
        <td className="actions">
          {open ? (
            <div className="btn-row">
              <button type="button" className="btn btn-quiet btn-sm" aria-expanded={mode === 'approved'} onClick={() => setMode('approved')}>
                Approve
              </button>
              <button type="button" className="btn btn-quiet btn-sm" aria-expanded={mode === 'rejected'} onClick={() => setMode('rejected')}>
                Reject
              </button>
            </div>
          ) : (
            <span className="muted small">Decided</span>
          )}
        </td>
      </tr>

      {open && mode && (
        <tr className="review-detail">
          <td colSpan={REVIEW_COLUMNS}>
            <form action={action} className="review-form">
              <input type="hidden" name="claimId" value={item.id} />
              <input type="hidden" name="decision" value={mode} />
              <label htmlFor={noteId}>
                {mode === 'rejected'
                  ? 'Reason for rejecting (the employee will see this)'
                  : item.status === 'flagged'
                    ? 'Why are you approving a claim that broke the policy?'
                    : 'Note (optional)'}
              </label>
              <textarea id={noteId} name="note" rows={2} maxLength={500} required={needsNote} minLength={needsNote ? 3 : undefined} autoFocus />
              {state.error && (
                <p className="form-error" role="alert">
                  {state.error}
                </p>
              )}
              <div className="btn-row">
                <button type="submit" className={mode === 'approved' ? 'btn btn-primary' : 'btn btn-danger'} disabled={pending}>
                  {pending ? 'Saving' : mode === 'approved' ? `Confirm approval of ${item.ref}` : `Confirm rejection of ${item.ref}`}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setMode(null)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

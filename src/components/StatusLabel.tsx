import type { Status } from '@/lib/domain';

const ICON: Record<Status, string> = {
  pending: 'M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2ZM8 4.8V8l2.4 1.5',
  flagged: 'M4 14V2.5M4 3h8l-1.8 2.8L12 8.6H4',
  approved: 'M3 8.5l3.2 3.2L13 4.8',
  rejected: 'M4 4l8 8M12 4l-8 8',
};

const LABEL: Record<Status, string> = {
  pending: 'Pending',
  flagged: 'Flagged',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** Status is text plus one icon, never a filled chip. The text carries the meaning, so colour is a hint only. */
export function StatusLabel({ status }: { status: Status }) {
  return (
    <span className={`status status-${status}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={ICON[status]} />
      </svg>
      {LABEL[status]}
    </span>
  );
}

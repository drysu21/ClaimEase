'use server';

import { revalidatePath } from 'next/cache';
import { currentEmployee } from '@/lib/auth';
import { getDb } from '@/lib/store';
import { decideClaim } from '@/lib/claims';

export interface DecisionState {
  ok: boolean;
  error?: string;
}

/** Approve or reject one claim. All the rules (role, own claim, notes, finality) live in decideClaim. */
export async function decideAction(_prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const reviewer = await currentEmployee();
  const res = decideClaim(getDb(), reviewer, Number(formData.get('claimId')), {
    decision: String(formData.get('decision') ?? ''),
    note: String(formData.get('note') ?? ''),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/finance');
  revalidatePath('/claims');
  return { ok: true };
}

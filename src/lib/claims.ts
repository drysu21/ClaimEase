// The business rules live here and nowhere else. The Gemini agent, the rule-based
// fallback and the pages all go through these functions, so a language model can never
// decide a claim's status: it can only ask this module to evaluate and save.

import { must, type Db } from './db';
import {
  CATEGORY_BY_KEY, MAX_CLAIM_AGE_DAYS, cityTier, daysBetween, parseISODate,
  inr, claimRef, formatDate, type CityTier, type Grade, type Status,
} from './domain';

export interface Employee {
  id: string;
  name: string;
  email: string;
  grade: Grade;
  department: string;
  role: 'employee' | 'finance';
}

export interface PolicyRule {
  city_tier: 'any' | CityTier;
  max_amount: number;
  unit: 'per_claim' | 'per_night';
  notes: string | null;
}

export interface Claim {
  id: number;
  ref: string;
  employee_id: string;
  category: string;
  category_label: string;
  description: string;
  amount: number;
  units: number;
  city: string | null;
  expense_date: string;
  submitted_at: string;
  status: Status;
  flag_reason: string | null;
  policy_limit: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface ReviewClaim extends Claim {
  employee_name: string;
  employee_grade: Grade;
  employee_department: string;
  reviewer_name: string | null;
}

export interface ClaimInput {
  category: string;
  amount: number | string;
  units?: number | string | null;
  city?: string | null;
  expenseDate?: string;
  description?: string;
}

export interface Evaluation {
  category: string;
  category_label: string | null;
  grade: Grade;
  amount: number | null;
  units: number;
  city: string | null;
  city_tier: CityTier | null;
  expense_date: string;
  age_days: number | null;
  max_age_days: number;
  rule: { max_amount: number; unit: 'per_claim' | 'per_night'; city_tier: string } | null;
  compared_amount: number | null;
  over_by: number;
  within_limit: boolean | null;
  /** blocked: cannot be saved. flagged: saved with a reason. pending: within policy. */
  outcome: 'blocked' | 'flagged' | 'pending';
  block_reasons: string[];
  flag_reasons: string[];
}

const REVIEWABLE: Status[] = ['pending', 'flagged'];

// ---------- employees and policy lookups ----------

const EMP_COLS = 'id, name, email, grade, department, role';

export async function getEmployeeById(db: Db, id: string): Promise<Employee | null> {
  return must(await db.from('employees').select(EMP_COLS).eq('id', id).maybeSingle()) as Employee | null;
}

export async function listEmployees(db: Db): Promise<Employee[]> {
  return must(await db.from('employees').select(EMP_COLS).order('id')) as Employee[];
}

/** Rules for one category and grade. For hotels, optionally narrowed to one city tier. */
export async function getRules(db: Db, category: string, grade: Grade, tier: CityTier | null = null): Promise<PolicyRule[]> {
  const rows = must(
    await db.from('policy_rules').select('city_tier, max_amount, unit, notes')
      .eq('category', category).eq('grade', grade).order('city_tier'),
  ) as PolicyRule[];
  return tier ? rows.filter((r) => r.city_tier === 'any' || r.city_tier === tier) : rows;
}

export async function getAllRulesForGrade(db: Db, grade: Grade): Promise<(PolicyRule & { category: string })[]> {
  return must(
    await db.from('policy_rules').select('category, city_tier, max_amount, unit, notes')
      .eq('grade', grade).order('category').order('city_tier'),
  ) as (PolicyRule & { category: string })[];
}

// ---------- evaluation (no writes) ----------

/**
 * Checks one expense against the employee's grade and the date rules.
 *   blocked -> cannot be saved at all (bad input, older than 60 days, future date)
 *   flagged -> can be saved, but breaks a limit: saved as flagged with the reason
 *   pending -> within policy: saved as pending
 */
export async function evaluateClaim(db: Db, employee: Employee, input: ClaimInput, today: string): Promise<Evaluation> {
  const block: string[] = [];
  const flags: string[] = [];

  const cat = CATEGORY_BY_KEY[input.category];
  if (!cat) block.push(`"${input.category}" is not a known category.`);

  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) block.push('The amount must be a number greater than zero.');
  else if (amount > 10_000_000) block.push('That amount is above anything this system accepts. Please check it.');

  const isHotel = input.category === 'hotel';
  let units = input.units == null || input.units === '' ? 1 : Number(input.units);
  if (!isHotel) units = 1;
  if (!Number.isInteger(units) || units < 1 || units > 90) {
    block.push('The number of nights must be a whole number between 1 and 90.');
    units = 1;
  }

  const city = input.city ? String(input.city).trim().slice(0, 60) || null : null;
  if (isHotel && !city) block.push('Hotel claims need the city, because limits differ for metro and other cities.');

  const expenseDate = input.expenseDate ?? today;
  let ageDays: number | null = null;
  if (parseISODate(expenseDate) === null) {
    block.push('The expense date must be a real date in YYYY-MM-DD format.');
  } else {
    ageDays = daysBetween(expenseDate, today);
    if (ageDays < 0) {
      block.push(`The expense date ${formatDate(expenseDate)} is in the future.`);
    } else if (ageDays > MAX_CLAIM_AGE_DAYS) {
      block.push(
        `Claims older than ${MAX_CLAIM_AGE_DAYS} days are not allowed. This expense is from ${formatDate(expenseDate)}, ` +
          `${ageDays} days ago.`,
      );
    }
  }

  const tier: CityTier | null = isHotel ? cityTier(city) : null;
  let rule: PolicyRule | null = null;
  let compared: number | null = null;
  let overBy: number | null = null;
  if (cat) {
    rule = (await getRules(db, cat.key, employee.grade, tier))[0] ?? null;
    if (!rule) {
      flags.push(
        `There is no policy rule for ${cat.label.toLowerCase()} at grade ${employee.grade}, so finance needs to look at it.`,
      );
    } else if (Number.isFinite(amount)) {
      compared = rule.unit === 'per_night' ? Math.round((amount / units) * 100) / 100 : amount;
      overBy = Math.round((compared - rule.max_amount) * 100) / 100;
      if (overBy > 0) {
        const where = isHotel ? ` in a ${tier === 'metro' ? 'metro' : 'non-metro'} city (${city ?? 'city not given'})` : '';
        const what =
          rule.unit === 'per_night'
            ? `${inr(compared)} per night (${inr(amount)} over ${units} ${units === 1 ? 'night' : 'nights'})`
            : inr(amount);
        flags.push(
          `${what} is ${inr(overBy)} above the ${employee.grade} limit of ${inr(rule.max_amount)} ` +
            `${rule.unit === 'per_night' ? 'per night' : 'per claim'} for ${cat.label.toLowerCase()}${where}.`,
        );
      }
    }
  }

  // Duplicate check: same employee, category, amount and expense date already claimed (and not rejected).
  if (cat && Number.isFinite(amount) && ageDays !== null && !block.length) {
    const dupes = must(
      await db.from('claims').select('id')
        .eq('employee_id', employee.id).eq('category', cat.key).eq('amount', amount).eq('expense_date', expenseDate)
        .neq('status', 'rejected').order('id').limit(3),
    ) as { id: number }[];
    if (dupes.length) {
      flags.push(
        `Possible duplicate: ${dupes.map((d) => claimRef(d.id)).join(', ')} already claims ${inr(amount)} for ` +
          `${cat.label.toLowerCase()} on ${formatDate(expenseDate)}.`,
      );
    }
  }

  return {
    category: input.category,
    category_label: cat?.label ?? null,
    grade: employee.grade,
    amount: Number.isFinite(amount) ? amount : null,
    units,
    city,
    city_tier: tier,
    expense_date: expenseDate,
    age_days: ageDays,
    max_age_days: MAX_CLAIM_AGE_DAYS,
    rule: rule ? { max_amount: rule.max_amount, unit: rule.unit, city_tier: rule.city_tier } : null,
    compared_amount: compared,
    over_by: overBy !== null && overBy > 0 ? overBy : 0,
    within_limit: rule && overBy !== null ? overBy <= 0 : null,
    outcome: block.length ? 'blocked' : flags.length ? 'flagged' : 'pending',
    block_reasons: block,
    flag_reasons: flags,
  };
}

// ---------- writes ----------

type ClaimRow = Omit<Claim, 'ref' | 'category_label'>;

export function toClaim<T extends ClaimRow>(row: T): T & { ref: string; category_label: string } {
  // Postgres numeric can arrive as a string; the UI and agent expect numbers.
  return { ...row, amount: Number(row.amount), ref: claimRef(row.id), category_label: CATEGORY_BY_KEY[row.category]?.label ?? row.category };
}

export type CreateResult =
  | { ok: true; saved: true; claim: Claim; evaluation: Evaluation }
  | { ok: false; saved: false; reasons: string[]; evaluation: Evaluation };

/**
 * Evaluates again (never trusting an earlier check) and saves.
 * `now` is the submission timestamp, injectable for seeding and tests.
 */
export async function createClaim(
  db: Db,
  employee: Employee,
  input: ClaimInput,
  { today, now = new Date().toISOString() }: { today: string; now?: string },
): Promise<CreateResult> {
  const description = String(input.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const ev = await evaluateClaim(db, employee, input, today);
  if (!description) ev.block_reasons.push('A short description of the expense is required.');
  if (ev.block_reasons.length) {
    return { ok: false, saved: false, reasons: ev.block_reasons, evaluation: { ...ev, outcome: 'blocked' } };
  }

  const status: Status = ev.outcome === 'flagged' ? 'flagged' : 'pending';
  const flagReason = status === 'flagged' ? ev.flag_reasons.join(' ') : null;
  const row = must(
    await db.from('claims').insert({
      employee_id: employee.id, category: ev.category, description, amount: ev.amount, units: ev.units, city: ev.city,
      expense_date: ev.expense_date, submitted_at: now, status, flag_reason: flagReason, policy_limit: ev.rule?.max_amount ?? null,
    }).select().single(),
  ) as ClaimRow;
  return { ok: true, saved: true, claim: toClaim(row), evaluation: ev };
}

// ---------- reads ----------

export async function listMyClaims(db: Db, employeeId: string, opts: { status?: Status; limit?: number } = {}): Promise<Claim[]> {
  const lim = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  let q = db.from('claims').select('*').eq('employee_id', employeeId);
  if (opts.status) q = q.eq('status', opts.status);
  const rows = must(await q.order('id', { ascending: false }).limit(lim)) as ClaimRow[];
  return rows.map(toClaim);
}

export type StatusSummary = Record<Status | 'all', { count: number; total: number }>;

export async function summarizeMyClaims(db: Db, employeeId: string): Promise<StatusSummary> {
  // shortcut: sums in JS over the employee's rows; fine for demo volumes, move to a SQL view if claims grow large.
  const rows = must(await db.from('claims').select('status, amount').eq('employee_id', employeeId)) as { status: Status; amount: number | string }[];
  const out: StatusSummary = {
    pending: { count: 0, total: 0 }, flagged: { count: 0, total: 0 },
    approved: { count: 0, total: 0 }, rejected: { count: 0, total: 0 }, all: { count: 0, total: 0 },
  };
  for (const r of rows) {
    const a = Number(r.amount);
    for (const k of [r.status, 'all'] as const) {
      out[k].count += 1;
      out[k].total = Math.round((out[k].total + a) * 100) / 100;
    }
  }
  return out;
}

export type ReviewFilter = Status | 'open' | 'all';

const REVIEW_SELECT =
  '*, employee:employees!claims_employee_id_fkey(name, grade, department), reviewer:employees!claims_reviewed_by_fkey(name)';
const STATUS_RANK: Record<Status, number> = { flagged: 0, pending: 1, approved: 2, rejected: 2 };

/** Finance queue: flagged first, then longest-waiting first; decided claims newest decision first. */
export async function listForReview(db: Db, status: ReviewFilter = 'open'): Promise<ReviewClaim[]> {
  let q = db.from('claims').select(REVIEW_SELECT);
  if (status === 'open') q = q.in('status', REVIEWABLE);
  else if (status !== 'all') q = q.eq('status', status);
  type Row = ClaimRow & { employee: { name: string; grade: Grade; department: string } | null; reviewer: { name: string } | null };
  const rows = must(await q) as Row[];
  const open = (s: Status) => REVIEWABLE.includes(s);
  rows.sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    (open(a.status) ? a.submitted_at.localeCompare(b.submitted_at) : (b.reviewed_at ?? '').localeCompare(a.reviewed_at ?? '')));
  return rows.map(({ employee, reviewer, ...c }) => toClaim({
    ...c,
    employee_name: employee?.name ?? c.employee_id,
    employee_grade: employee?.grade as Grade,
    employee_department: employee?.department ?? '',
    reviewer_name: reviewer?.name ?? null,
  }));
}

export type ReviewCounts = Record<Status | 'open' | 'all', number>;

export async function reviewCounts(db: Db): Promise<ReviewCounts> {
  const rows = must(await db.from('claims').select('status')) as { status: Status }[];
  const out = { pending: 0, flagged: 0, approved: 0, rejected: 0, open: 0, all: 0 };
  for (const r of rows) out[r.status] += 1;
  out.open = out.pending + out.flagged;
  out.all = out.open + out.approved + out.rejected;
  return out;
}

// ---------- finance decisions ----------

export type DecideResult = { ok: true; claim: Claim } | { ok: false; code: number; error: string };

/**
 * Approve or reject a claim. Rules:
 *  - the reviewer must be finance, and cannot review their own claim
 *  - only pending or flagged claims can be decided; a decision is final
 *  - rejecting needs a reason; approving a flagged claim is an exception and needs one too
 */
export async function decideClaim(
  db: Db,
  reviewer: Employee,
  claimId: number,
  { decision, note }: { decision: string; note?: string },
  now: string = new Date().toISOString(),
): Promise<DecideResult> {
  if (reviewer.role !== 'finance') return { ok: false, code: 403, error: 'Only finance staff can review claims.' };
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, code: 400, error: 'Decision must be "approved" or "rejected".' };
  }

  if (!Number.isInteger(claimId) || claimId < 1) return { ok: false, code: 404, error: 'Claim not found.' };
  const claim = must(await db.from('claims').select('*').eq('id', claimId).maybeSingle()) as ClaimRow | null;
  if (!claim) return { ok: false, code: 404, error: 'Claim not found.' };
  if (claim.employee_id === reviewer.id) return { ok: false, code: 403, error: 'You cannot review your own claim.' };
  if (!REVIEWABLE.includes(claim.status)) {
    return { ok: false, code: 409, error: `This claim was already ${claim.status}. Decisions are final.` };
  }

  const cleanNote = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (decision === 'rejected' && cleanNote.length < 3) {
    return { ok: false, code: 400, error: 'Please give a reason for rejecting this claim.' };
  }
  if (decision === 'approved' && claim.status === 'flagged' && cleanNote.length < 3) {
    return { ok: false, code: 400, error: 'This claim broke a policy rule. Add a note explaining why you are approving it.' };
  }

  // The status guard in the WHERE clause keeps two reviewers racing on one claim safe.
  const updated = must(
    await db.from('claims')
      .update({ status: decision, reviewed_by: reviewer.id, reviewed_at: now, review_note: cleanNote || null })
      .eq('id', claimId).in('status', REVIEWABLE).select(),
  ) as ClaimRow[];
  if (updated.length === 0) return { ok: false, code: 409, error: 'This claim was just decided by someone else.' };
  return { ok: true, claim: toClaim(updated[0]) };
}

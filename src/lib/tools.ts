// The five tools the claim assistant can use. Both agents (Gemini and the rule-based
// fallback) call them through runTool(), so they behave identically.
//
// Safety design: the employee id is NEVER a tool argument. It comes from the signed-in
// session (ToolContext), so a prompt like "file this for E004" cannot act for someone else.

import type { Db } from './db';
import {
  createClaim, evaluateClaim, getAllRulesForGrade, getRules, listMyClaims, summarizeMyClaims,
  type Claim, type Employee,
} from './claims';
import {
  CATEGORIES, CATEGORY_BY_KEY, CATEGORY_KEYS, KNOWN_CITIES, MAX_CLAIM_AGE_DAYS, STATUSES, cityTier,
  type Status,
} from './domain';

export interface ToolContext {
  db: Db;
  employee: Employee;
  today: string;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export type ToolName = 'getEmployee' | 'getPolicyForCategory' | 'checkPolicyLimit' | 'createClaim' | 'getMyClaims';

/** Every tool returns a plain object. `ok: false` marks a failure the caller should show or retry. */
export type ToolResult = { ok: boolean; [key: string]: unknown };

const categoryProp = {
  type: 'string',
  enum: CATEGORY_KEYS,
  description: 'Expense category. ' + CATEGORIES.map((c) => `${c.key}: ${c.hint}`).join(' '),
};
const amountProp = { type: 'number', description: 'Total amount in Indian rupees (INR), as a plain number, e.g. 2400.' };
const unitsProp = { type: 'integer', description: 'Number of nights. Hotel claims only; leave out for everything else.' };
const cityProp = { type: 'string', description: 'City of the stay. Required for hotel claims, ignored otherwise.' };
const dateProp = {
  type: 'string',
  description: 'Date the money was spent, as YYYY-MM-DD. Work out relative dates like "yesterday" from today\'s date first.',
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'getEmployee',
    description:
      'Returns the signed-in employee: id, name, grade and department. Takes no arguments. Call it once at the start of a ' +
      'conversation so you know who you are helping. Policy limits depend on the grade, and the other tools apply it for you.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'getPolicyForCategory',
    description:
      "Looks up the expense policy for the signed-in employee's grade. With a category, returns the maximum amount, whether it " +
      'applies per claim or per night, and notes. Hotels have different limits for metro and other cities, so pass the city when ' +
      'you know it. With no category, returns the full policy table for the grade. Use this for questions like "how much can I ' +
      'claim for a hotel in Mumbai?". It does not save anything.',
    input_schema: { type: 'object', properties: { category: categoryProp, city: cityProp } },
  },
  {
    name: 'checkPolicyLimit',
    description:
      'Checks a specific expense against the policy WITHOUT saving it. Returns outcome "pending" (within policy), "flagged" ' +
      '(over the limit, with the reason) or "blocked" (cannot be saved, e.g. older than ' + MAX_CLAIM_AGE_DAYS + ' days, a ' +
      'future date, or a hotel with no city). Use it when the employee only asks whether something would be allowed. ' +
      'You do not need it before createClaim, which runs the same check itself.',
    input_schema: {
      type: 'object',
      properties: { category: categoryProp, amount: amountProp, expense_date: dateProp, units: unitsProp, city: cityProp },
      required: ['category', 'amount'],
    },
  },
  {
    name: 'createClaim',
    description:
      'Saves an expense claim for the signed-in employee. Only call it when the employee says they have already spent the ' +
      'money or asks you to submit it. The server checks the policy for their grade itself and sets the status: "pending" ' +
      'when within policy, or "flagged" with a reason when over the limit. It refuses, and saves nothing, for claims older ' +
      'than ' + MAX_CLAIM_AGE_DAYS + ' days, future dates, or hotels with no city (the result has ok false and the reasons). ' +
      'Never guess an amount or a category: ask the employee instead.',
    input_schema: {
      type: 'object',
      properties: {
        category: categoryProp,
        amount: amountProp,
        expense_date: dateProp,
        description: { type: 'string', description: 'Short plain description of what the money was for, e.g. "Dinner with Acme team".' },
        units: unitsProp,
        city: cityProp,
      },
      required: ['category', 'amount', 'expense_date', 'description'],
    },
  },
  {
    name: 'getMyClaims',
    description:
      "Lists the signed-in employee's own claims, newest first, with totals per status. Optionally filter by status: " +
      STATUSES.join(', ') + '. The chat window shows the table to the employee automatically, so summarise rather than repeat every row.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...STATUSES], description: 'Only claims with this status.' },
        limit: { type: 'integer', description: 'Maximum number of claims to return (default 20).' },
      },
    },
  },
];

// ---------- input coercion (model output is untrusted, so check everything) ----------

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(/,/g, '')))) return Number(v.replace(/,/g, ''));
  return undefined;
}

function badCategory(v: unknown): ToolResult | null {
  const c = str(v);
  if (!c) return { ok: false, error: `category is required. One of: ${CATEGORY_KEYS.join(', ')}.` };
  if (!CATEGORY_BY_KEY[c]) return { ok: false, error: `Unknown category "${c}". One of: ${CATEGORY_KEYS.join(', ')}.` };
  return null;
}

function slimClaim(c: Claim) {
  return {
    ref: c.ref, id: c.id, category: c.category, category_label: c.category_label, description: c.description,
    amount: c.amount, units: c.units, city: c.city, expense_date: c.expense_date, status: c.status,
    flag_reason: c.flag_reason, policy_limit: c.policy_limit, review_note: c.review_note,
  };
}

// ---------- the tools ----------

export function runTool(name: string, input: unknown, ctx: ToolContext): ToolResult {
  try {
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const { db, employee, today } = ctx;

    switch (name as ToolName) {
      case 'getEmployee':
        return { ok: true, id: employee.id, name: employee.name, grade: employee.grade, department: employee.department };

      case 'getPolicyForCategory': {
        const categoryRaw = str(i.category);
        if (!categoryRaw) {
          const rules = getAllRulesForGrade(db, employee.grade);
          const policy = CATEGORIES.map((c) => ({
            category: c.key,
            category_label: c.label,
            rules: rules.filter((r) => r.category === c.key).map(({ category: _c, ...r }) => r),
          }));
          return { ok: true, grade: employee.grade, metro_cities: KNOWN_CITIES, policy };
        }
        const bad = badCategory(categoryRaw);
        if (bad) return bad;
        const cat = CATEGORY_BY_KEY[categoryRaw];
        const city = str(i.city) ?? null;
        const isHotel = cat.key === 'hotel';
        const tier = isHotel && city ? cityTier(city) : null;
        const rules = getRules(db, cat.key, employee.grade, tier);
        return {
          ok: true,
          category: cat.key,
          category_label: cat.label,
          grade: employee.grade,
          city,
          city_tier: tier,
          rules,
          ...(isHotel && !city ? { note: 'No city given, so both tiers are shown. Metro cities: ' + KNOWN_CITIES.join(', ') + '.' } : {}),
          max_claim_age_days: MAX_CLAIM_AGE_DAYS,
        };
      }

      case 'checkPolicyLimit': {
        const bad = badCategory(i.category);
        if (bad) return bad;
        const amount = num(i.amount);
        if (amount === undefined) return { ok: false, error: 'amount is required and must be a number.' };
        const ev = evaluateClaim(
          db, employee,
          { category: String(i.category), amount, units: num(i.units), city: str(i.city), expenseDate: str(i.expense_date) },
          today,
        );
        return { ok: true, ...ev };
      }

      case 'createClaim': {
        const bad = badCategory(i.category);
        if (bad) return bad;
        const amount = num(i.amount);
        if (amount === undefined) return { ok: false, error: 'amount is required and must be a number.' };
        const res = createClaim(
          db, employee,
          {
            category: String(i.category), amount, units: num(i.units), city: str(i.city),
            expenseDate: str(i.expense_date), description: str(i.description),
          },
          { today },
        );
        if (!res.ok) return { ok: false, saved: false, reasons: res.reasons, outcome: 'blocked' };
        return {
          ok: true,
          saved: true,
          status: res.claim.status,
          claim: slimClaim(res.claim),
          flag_reason: res.claim.flag_reason,
          over_by: res.evaluation.over_by,
          rule: res.evaluation.rule,
        };
      }

      case 'getMyClaims': {
        const statusRaw = str(i.status);
        if (statusRaw && !(STATUSES as readonly string[]).includes(statusRaw)) {
          return { ok: false, error: `status must be one of: ${STATUSES.join(', ')}.` };
        }
        const status = statusRaw as Status | undefined;
        const claims = listMyClaims(db, employee.id, { status, limit: num(i.limit) ?? 20 });
        const summary = summarizeMyClaims(db, employee.id);
        const shown = status ? summary[status] : summary.all;
        return { ok: true, filter: status ?? 'all', count: shown.count, total_amount: shown.total, by_status: summary, claims: claims.map(slimClaim) };
      }

      default:
        return { ok: false, error: `Unknown tool "${name}".` };
    }
  } catch (err) {
    console.error(`[tool ${name}]`, err);
    return { ok: false, error: 'The tool failed unexpectedly. Nothing was changed.' };
  }
}

export type SlimClaim = ReturnType<typeof slimClaim>;

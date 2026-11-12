// The built-in assistant. It works with no API key and no network, and it calls the very
// same tools the Gemini agent does, so the business rules are identical. It understands the
// common phrasings; Gemini handles everything else.

import { runTool, type ToolContext, type ToolResult } from '../tools';
import {
  CATEGORIES, CATEGORY_BY_KEY, KNOWN_CITIES, addDays, daysBetween, formatDate, inr, parseISODate, plural,
  weekdayName, type Status,
} from '../domain';
import type { Draft, Session } from './sessions';

export interface TraceCall {
  name: string;
  input: unknown;
  output: ToolResult;
}
export interface AgentReply {
  reply: string;
  toolCalls: TraceCall[];
}

// ---------------------------------------------------------------- parsing

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Removes dates and counts so their digits are not mistaken for the amount. */
function withoutDatesAndCounts(t: string): string {
  return t
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+\\d{4})?`, 'gi'), ' ')
    .replace(new RegExp(`\\b${MONTH}\\b\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, 'gi'), ' ')
    .replace(/\b\d+\s*(?:nights?|days?|hours?|people|persons?|guests?|pax|km)\b/gi, ' ');
}

export function parseAmount(text: string): { amount?: number; foreignCurrency?: boolean } {
  if (/\$|€|£|\b(usd|eur|gbp|dollars?|euros?|pounds?)\b/i.test(text)) return { foreignCurrency: true };
  const t = withoutDatesAndCounts(text);
  const mult = (s?: string) => (!s ? 1 : /^k$/i.test(s) ? 1000 : 100000);
  const toNum = (digits: string, m?: string) => Number(digits.replace(/,/g, '')) * mult(m);

  let m = /(?:₹|\brs\.?|\binr\b)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|lakhs?)?/i.exec(t);
  if (m) return { amount: toNum(m[1], m[2]) };
  m = /(\d[\d,]*(?:\.\d+)?)\s*(k|lakhs?)?\s*(?:rupees?|\brs\b\.?|\binr\b|₹|\/-)/i.exec(t);
  if (m) return { amount: toNum(m[1], m[2]) };
  m = /\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i.exec(t);
  if (m && toNum(m[1], m[2]) >= 1) return { amount: toNum(m[1], m[2]) };
  return {};
}

export function parseDate(text: string, today: string): { date?: string; invalid?: boolean; vague?: boolean } {
  const t = text.toLowerCase();
  const year = Number(today.slice(0, 4));
  const build = (y: number, mo: number, d: number): { date?: string; invalid?: boolean } => {
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return parseISODate(iso) === null ? { invalid: true } : { date: iso };
  };
  const noYear = (mo: number, d: number) => {
    const r = build(year, mo, d);
    if (r.date && daysBetween(today, r.date) > 0) return build(year - 1, mo, d);
    return r;
  };

  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return build(+m[1], +m[2], +m[3]);

  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(t); // day first, the Indian convention
  if (m) return build(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);

  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+(\\d{4}))?`, 'i').exec(t);
  if (m) return m[3] ? build(+m[3], MONTH_INDEX[m[2].slice(0, 3)], +m[1]) : noYear(MONTH_INDEX[m[2].slice(0, 3)], +m[1]);

  m = new RegExp(`\\b${MONTH}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'i').exec(t);
  if (m) return m[3] ? build(+m[3], MONTH_INDEX[m[1].slice(0, 3)], +m[2]) : noYear(MONTH_INDEX[m[1].slice(0, 3)], +m[2]);

  if (/\bday before yesterday\b/.test(t)) return { date: addDays(today, -2) };
  if (/\b(yesterday|last night)\b/.test(t)) return { date: addDays(today, -1) };
  if (/\b(today|this morning|this afternoon|this evening|tonight)\b/.test(t)) return { date: today };

  m = /\b(\d+)\s+days?\s+ago\b/.exec(t);
  if (m) return { date: addDays(today, -Number(m[1])) };
  if (/\b(a|one) week ago\b/.test(t)) return { date: addDays(today, -7) };

  for (let d = 0; d < 7; d++) {
    if (new RegExp(`\\b${WEEKDAYS[d]}\\b`).test(t)) {
      const todayDow = new Date(parseISODate(today) as number).getUTCDay();
      const diff = (todayDow - d + 7) % 7 || 7; // the most recent one before today
      return { date: addDays(today, -diff) };
    }
  }

  if (/\b(last|this|past)\s+(week|month)\b|\brecently\b|\bearlier\b/.test(t)) return { vague: true };
  return {};
}

const CATEGORY_WORDS: [string, RegExp][] = [
  ['hotel', /\b(hotel|lodging|accommodation|airbnb|resort|guest ?house|stay(?:ed)?|nights?)\b/g],
  ['airfare_rail', /\b(flights?|airfare|air ?tickets?|airline|indigo|vistara|air india|train|irctc|railway|rail|bus tickets?)\b/g],
  ['local_travel', /\b(cab|taxi|uber|ola|rapido|auto|autorickshaw|rickshaw|metro|fuel|petrol|diesel|parking|toll|commute|ride)\b/g],
  ['client_entertainment', /\b(client|customer|prospect|hospitality|entertain\w*)\b/g],
  ['meals', /\b(dinner|lunch|breakfast|brunch|meals?|food|snacks?|coffee|tea|restaurant|biryani|pizza)\b/g],
  ['office_supplies', /\b(stationery|stationary|printer|cartridges?|toner|notebooks?|pens?|markers?|supplies|paper|keyboard|mouse|charger|cables?|headphones?|folders?)\b/g],
  ['internet_phone', /\b(internet|wi-?fi|broadband|mobile bill|phone bill|phone|recharge|data pack|sim|postpaid|airtel|jio)\b/g],
  ['training', /\b(courses?|training|workshops?|certifications?|certificate|conference|seminar|udemy|coursera|bootcamp|exam fee|webinar)\b/g],
];

export function detectCategory(text: string): string | undefined {
  const t = text.toLowerCase();
  const score: Record<string, number> = {};
  for (const [key, re] of CATEGORY_WORDS) score[key] = (t.match(re) ?? []).length;
  // "client" only means entertainment when there is food or an event involved.
  if (score.client_entertainment && score.meals) score.meals = 0;
  else if (!/entertain/.test(t)) score.client_entertainment = 0;
  let best: string | undefined;
  let bestScore = 0;
  for (const [key] of CATEGORY_WORDS) {
    if (score[key] > bestScore) {
      best = key;
      bestScore = score[key];
    }
  }
  return best;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function parseCity(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const c of [...KNOWN_CITIES].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${c}\\b`).test(lower)) return titleCase(c);
  }
  const m = /\b(?:in|at|near)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/.exec(text);
  if (m && !/^(The|A|An|My|Our|This|That)\b/.test(m[1])) return m[1];
  return undefined;
}

export function parseNights(text: string): number | undefined {
  const m = /\b(\d+|one|a|an|two|three|four|five|six|seven|eight|nine|ten)\s*-?\s*nights?\b/i.exec(text);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
  return n || undefined;
}

// ---------------------------------------------------------------- intent

const POLICY_Q = /\b(how much|limits?|maximum|max|cap|allowed|allowance|entitled|eligible|policy|can i claim|am i allowed|what can i claim)\b/i;
const SUBMIT_SIGNAL = /\b(spent|spend|paid|bought|purchased|submit|submitted|file|filed|put in|raise|reimburse\w*|i had)\b/i;
const CONFIRM = /^\s*(yes|yep|yeah|ok|okay|sure|go ahead|submit( it)?|file( it)?|do it|please do|save( it)?|confirm)\b/i;
const GREETING = /^\s*(hi|hello|hey|help|thanks|thank you|what can you do)\b/i;

function isListRequest(t: string): boolean {
  if (POLICY_Q.test(t)) return false;
  return (
    /\b(show|list|view|see|display)\b.*\b(claims?|expenses?)\b/i.test(t) ||
    /\bmy\s+(?:\w+\s+)?(claims?|expenses?)\b/i.test(t) ||
    /\b(claims?|expenses?)\s+(status|history|list)\b/i.test(t) ||
    /\bstatus of\b/i.test(t) ||
    /\b(pending|flagged|approved|rejected)\s+(claims?|expenses?)\b/i.test(t)
  );
}

// ---------------------------------------------------------------- the agent

export async function respondWithRules(text: string, session: Session, ctx: ToolContext): Promise<AgentReply> {
  const toolCalls: TraceCall[] = [];
  const call = async (name: string, input: unknown = {}): Promise<ToolResult> => {
    const output = await runTool(name, input, ctx);
    toolCalls.push({ name, input, output });
    return output;
  };
  const done = (reply: string): AgentReply => ({ reply, toolCalls });
  const { today } = ctx;
  const grade = ctx.employee.grade;
  const firstName = ctx.employee.name.split(' ')[0];

  const trimmed = text.trim();
  if (!trimmed) return done('Tell me what you spent, for example: "I spent 2,400 rupees on a client dinner yesterday, submit it."');

  const amountInfo = parseAmount(trimmed);
  const draft: Draft | null = session.draft;
  const category = detectCategory(trimmed);

  // Answer to a question we asked: "yes, submit it", a category, a city.
  if (draft?.awaiting && !isListRequest(trimmed)) {
    if (draft.awaiting === 'confirm' && CONFIRM.test(trimmed)) return submit(draft);
    if (draft.awaiting === 'confirm' && /^\s*(no|nope|cancel|never ?mind|don'?t)\b/i.test(trimmed)) {
      session.draft = null;
      return done('Okay, I have not saved anything.');
    }
    if (draft.awaiting !== 'confirm' && !(amountInfo.amount !== undefined && draft.awaiting !== 'amount')) {
      const next: Draft = { ...draft };
      if (draft.awaiting === 'category' && category) next.category = category;
      if (draft.awaiting === 'amount' && amountInfo.amount !== undefined) next.amount = amountInfo.amount;
      if (draft.awaiting === 'city') {
        const words = trimmed.replace(/^(in|at)\s+/i, '').replace(/[.!?]+$/, '');
        next.city = parseCity(trimmed) ?? (words.split(/\s+/).length <= 3 ? titleCase(words) : undefined);
      }
      if (draft.awaiting === 'date') {
        const d = parseDate(trimmed, today);
        if (d.date) {
          next.date = d.date;
          next.dateAssumed = false;
        }
      }
      const nights = parseNights(trimmed);
      if (nights) next.units = nights;
      return submit(next);
    }
  }

  if (GREETING.test(trimmed) && amountInfo.amount === undefined) {
    await call('getEmployee');
    return done(
      `Hi ${firstName}. Tell me what you spent and I will pick the category, check it against the ${grade} policy and file the claim. ` +
        'For example: "I spent 2,400 rupees on a client dinner yesterday, submit it." You can also ask "How much can I claim for a hotel in Mumbai?" or "Show my pending claims."',
    );
  }

  if (isListRequest(trimmed) && amountInfo.amount === undefined) {
    session.draft = null;
    const statusWord = /\b(pending|flagged|approved|rejected)\b/i.exec(trimmed)?.[1].toLowerCase() as Status | undefined;
    const res = await call('getMyClaims', statusWord ? { status: statusWord } : {});
    const count = Number(res.count ?? 0);
    const by = res.by_status as Record<string, { count: number }>;
    if (count === 0) return done(statusWord ? `You have no ${statusWord} claims.` : 'You have not submitted any claims yet.');
    if (statusWord) {
      let reply = `You have ${plural(count, statusWord + ' claim')} totalling ${inr(Number(res.total_amount))}.`;
      if (statusWord === 'pending' && by.flagged.count > 0) {
        reply += ` ${plural(by.flagged.count, 'other claim')} ${by.flagged.count === 1 ? 'is' : 'are'} flagged and waiting for finance.`;
      }
      return done(reply);
    }
    const parts = (['pending', 'flagged', 'approved', 'rejected'] as const).filter((s) => by[s].count > 0).map((s) => `${by[s].count} ${s}`);
    return done(`You have ${plural(count, 'claim')} totalling ${inr(Number(res.total_amount))}: ${parts.join(', ')}.`);
  }

  if (amountInfo.foreignCurrency) {
    return done('I can only file claims in Indian rupees for now. Please give me the amount in INR.');
  }

  // A question about the policy, with no amount involved.
  if (amountInfo.amount === undefined && (POLICY_Q.test(trimmed) || category)) {
    session.draft = null;
    return answerPolicy(category, parseCity(trimmed));
  }

  if (amountInfo.amount !== undefined) {
    const hypothetical = POLICY_Q.test(trimmed) && !SUBMIT_SIGNAL.test(trimmed);
    const d = parseDate(trimmed, today);
    if (d.invalid) return done('That date does not look right. Could you give it as day, month and year?');
    if (d.vague) {
      session.draft = { amount: amountInfo.amount, category, city: parseCity(trimmed), units: parseNights(trimmed), description: trimmed, awaiting: 'date' };
      return done('Which date was that expense? For example "yesterday" or "3 Nov".');
    }
    const fresh: Draft = {
      amount: amountInfo.amount,
      category,
      date: d.date ?? today,
      dateAssumed: !d.date,
      city: parseCity(trimmed),
      units: parseNights(trimmed),
      description: trimmed.replace(/[,.]?\s*(please\s+)?submit( it)?[.!]?$/i, '').trim(),
    };
    return hypothetical ? check(fresh) : submit(fresh);
  }

  // Nothing we could use.
  return done(
    'I did not catch an amount or a question there. Try: "I spent 850 rupees on a cab to the airport yesterday", ' +
      '"How much can I claim for a hotel in Mumbai?" or "Show my pending claims."',
  );

  // ---- flows ----

  function ask(d: Draft, awaiting: NonNullable<Draft['awaiting']>, question: string): AgentReply {
    session.draft = { ...d, awaiting };
    return done(question);
  }

  function missingDetails(d: Draft): AgentReply | null {
    if (d.amount === undefined) return ask(d, 'amount', 'How much was it, in rupees?');
    if (!d.category) {
      const names = CATEGORIES.map((c) => c.label.toLowerCase()).join(', ');
      return ask(d, 'category', `I could not tell which category that falls under. Is it one of: ${names}?`);
    }
    if (d.category === 'hotel' && !d.city) return ask(d, 'city', 'Which city was the hotel in? Limits are higher in metro cities.');
    return null;
  }

  function assumptionNotes(d: Draft): string {
    const notes: string[] = [];
    if (d.dateAssumed) notes.push(`You did not give a date, so I used today (${weekdayName(today)}, ${formatDate(today)}).`);
    if (d.category === 'hotel' && !d.units) notes.push('I assumed 1 night.');
    return notes.length ? '\n' + notes.join(' ') : '';
  }

  function toolInput(d: Draft) {
    return {
      category: d.category, amount: d.amount, expense_date: d.date ?? today,
      ...(d.category === 'hotel' ? { units: d.units ?? 1, city: d.city } : {}),
    };
  }

  async function check(d: Draft): Promise<AgentReply> {
    const gap = missingDetails(d);
    if (gap) return gap;
    await call('getEmployee');
    const ev = await call('checkPolicyLimit', toolInput(d));
    if (!ev.ok) return done(String(ev.error));
    const label = String(ev.category_label).toLowerCase();
    if (ev.outcome === 'blocked') {
      session.draft = null;
      return done(`That would not be accepted. ${(ev.block_reasons as string[]).join(' ')}`);
    }
    session.draft = { ...d, awaiting: 'confirm' };
    if (ev.outcome === 'flagged') {
      return done(`${(ev.flag_reasons as string[]).join(' ')}\nIf you submit it anyway, it is saved as flagged for finance review. Say "submit it" to file it.${assumptionNotes(d)}`);
    }
    const rule = ev.rule as { max_amount: number; unit: string };
    return done(
      `Yes, ${inr(d.amount!)} for ${label} is within your ${grade} limit of ${inr(rule.max_amount)} ${rule.unit === 'per_night' ? 'per night' : 'per claim'}. ` +
        `Nothing is saved yet. Say "submit it" and I will file the claim.${assumptionNotes(d)}`,
    );
  }

  async function submit(d: Draft): Promise<AgentReply> {
    const gap = missingDetails(d);
    if (gap) return gap;
    await call('getEmployee');
    const ev = await call('checkPolicyLimit', toolInput(d));
    if (!ev.ok) return done(String(ev.error));
    if (ev.outcome === 'blocked') {
      session.draft = null;
      return done(`I cannot submit this one. ${(ev.block_reasons as string[]).join(' ')} Nothing was saved.`);
    }
    const res = await call('createClaim', { ...toolInput(d), description: d.description ?? CATEGORY_BY_KEY[d.category!].label });
    session.draft = null;
    if (!res.ok) return done(`I could not save that claim. ${((res.reasons as string[]) ?? [String(res.error)]).join(' ')}`);

    const claim = res.claim as { ref: string; amount: number; category: string; category_label: string; expense_date: string; policy_limit: number | null; units: number };
    const rule = res.rule as { unit: string } | null;
    if (res.status === 'flagged') {
      return done(`Claim ${claim.ref} is saved, but flagged for finance review.\n${res.flag_reason}\nFinance will look at it and decide.${assumptionNotes(d)}`);
    }
    const what =
      claim.category === 'hotel'
        ? `${inr(claim.amount)} for a hotel stay (${plural(claim.units, 'night')}, ${inr(claim.amount / claim.units)} per night)`
        : `${inr(claim.amount)} for ${claim.category_label.toLowerCase()}`;
    return done(
      `Claim ${claim.ref} is saved and pending approval.\n` +
        `${what}, dated ${formatDate(claim.expense_date)}. ` +
        `That is within your ${grade} limit of ${inr(claim.policy_limit ?? 0)} ${rule?.unit === 'per_night' ? 'per night' : 'per claim'}.${assumptionNotes(d)}`,
    );
  }

  async function answerPolicy(cat: string | undefined, city: string | undefined): Promise<AgentReply> {
    await call('getEmployee');
    const res = await call('getPolicyForCategory', cat ? { category: cat, ...(city ? { city } : {}) } : {});
    if (!res.ok) return done(String(res.error));
    const unitText = (u: string) => (u === 'per_night' ? 'per night' : 'per claim');
    const tail = ` Claims must be submitted within 60 days of the expense.`;

    if (!cat) {
      const policy = res.policy as { category_label: string; rules: { city_tier: string; max_amount: number; unit: string }[] }[];
      const lines = policy.map((p) => {
        const r = p.rules;
        if (r.length === 2) {
          const metro = r.find((x) => x.city_tier === 'metro')!;
          const other = r.find((x) => x.city_tier === 'other')!;
          return `${p.category_label}: ${inr(metro.max_amount)} per night in metro cities, ${inr(other.max_amount)} elsewhere`;
        }
        return `${p.category_label}: ${inr(r[0].max_amount)} ${unitText(r[0].unit)}`;
      });
      return done(`Your ${grade} limits:\n${lines.join('\n')}\n${tail.trim()}`);
    }

    const rules = res.rules as { city_tier: string; max_amount: number; unit: string; notes: string | null }[];
    const label = String(res.category_label).toLowerCase();
    if (cat === 'hotel' && !city) {
      const metro = rules.find((r) => r.city_tier === 'metro');
      const other = rules.find((r) => r.city_tier === 'other');
      return done(
        `For a hotel, your ${grade} limit depends on the city: up to ${inr(metro!.max_amount)} per night in metro cities ` +
          `(${KNOWN_CITIES.slice(0, 8).map(titleCase).join(', ')} and similar) and ${inr(other!.max_amount)} per night elsewhere. Tell me the city and I will confirm.${tail}`,
      );
    }
    const r = rules[0];
    if (!r) return done(`There is no policy rule for ${label} at grade ${grade}. A claim there would go to finance for review.`);
    const subject = cat === 'hotel' ? `a hotel in ${city} (${res.city_tier === 'metro' ? 'a metro city' : 'not a metro city'})` : label;
    return done(`As an ${grade} you can claim up to ${inr(r.max_amount)} ${unitText(r.unit)} for ${subject}.${r.notes ? ' ' + r.notes : ''}${tail}`);
  }
}

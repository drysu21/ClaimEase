import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/lib/db';
import { seedIfEmpty } from '../src/lib/seed';
import {
  createClaim, decideClaim, evaluateClaim, getEmployeeById, listMyClaims, summarizeMyClaims,
} from '../src/lib/claims';
import { addDays, daysBetween, inr, parseISODate } from '../src/lib/domain';

const TODAY = '2026-11-12';

function fresh() {
  const db = openDb(':memory:');
  seedIfEmpty(db, TODAY);
  return {
    db,
    meera: getEmployeeById(db, 'E001')!,
    rohan: getEmployeeById(db, 'E002')!,
    priya: getEmployeeById(db, 'E900')!,
  };
}

test('seed: Meera is E001, grade L2, with one claim in each status that matters', () => {
  const { db, meera } = fresh();
  assert.equal(meera.name, 'Meera Nair');
  assert.equal(meera.grade, 'L2');
  const s = summarizeMyClaims(db, 'E001');
  assert.deepEqual([s.pending.count, s.flagged.count, s.approved.count, s.rejected.count], [2, 1, 2, 1]);
});

test('demo prompt 1: 2,400 on a client dinner is within the L2 limit and saved as pending', () => {
  const { db, meera } = fresh();
  const res = createClaim(db, meera, {
    category: 'client_entertainment', amount: 2400, expenseDate: addDays(TODAY, -1), description: 'Client dinner',
  }, { today: TODAY });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.claim.status, 'pending');
  assert.equal(res.claim.flag_reason, null);
  assert.equal(res.claim.policy_limit, 3000);
  assert.equal(res.claim.expense_date, '2026-11-11');
});

test('above max_amount: saved as flagged, with the reason and by how much', () => {
  const { db, meera } = fresh();
  const res = createClaim(db, meera, {
    category: 'client_entertainment', amount: 6500, expenseDate: TODAY, description: 'Client dinner',
  }, { today: TODAY });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.claim.status, 'flagged');
  assert.match(res.claim.flag_reason!, /₹3,500 above the L2 limit of ₹3,000 per claim/);
  assert.equal(res.evaluation.over_by, 3500);
});

test('exactly at the limit is allowed', () => {
  const { db, meera } = fresh();
  assert.equal(evaluateClaim(db, meera, { category: 'meals', amount: 700, expenseDate: TODAY }, TODAY).outcome, 'pending');
  assert.equal(evaluateClaim(db, meera, { category: 'meals', amount: 701, expenseDate: TODAY }, TODAY).outcome, 'flagged');
});

test('limits follow the grade: the same 1,000 meal passes for L3 and flags for L1/L2', () => {
  const { db, rohan, meera } = fresh();
  const l3 = getEmployeeById(db, 'E003')!;
  const input = { category: 'meals', amount: 1000, expenseDate: TODAY };
  assert.equal(evaluateClaim(db, l3, input, TODAY).outcome, 'pending');
  assert.equal(evaluateClaim(db, meera, input, TODAY).outcome, 'flagged');
  assert.equal(evaluateClaim(db, rohan, input, TODAY).outcome, 'flagged');
});

test('60-day rule: day 60 is fine, day 61 is blocked and nothing is saved', () => {
  const { db, meera } = fresh();
  const before = listMyClaims(db, 'E001').length;
  const ok = evaluateClaim(db, meera, { category: 'meals', amount: 300, expenseDate: addDays(TODAY, -60) }, TODAY);
  assert.equal(ok.outcome, 'pending');

  const old = createClaim(db, meera, { category: 'meals', amount: 300, expenseDate: addDays(TODAY, -61), description: 'Old lunch' }, { today: TODAY });
  assert.equal(old.ok, false);
  if (old.ok) return;
  assert.match(old.reasons[0], /older than 60 days/);
  assert.equal(listMyClaims(db, 'E001').length, before);
});

test('future dates and impossible dates are blocked', () => {
  const { db, meera } = fresh();
  assert.equal(evaluateClaim(db, meera, { category: 'meals', amount: 300, expenseDate: addDays(TODAY, 1) }, TODAY).outcome, 'blocked');
  assert.equal(evaluateClaim(db, meera, { category: 'meals', amount: 300, expenseDate: '2026-02-31' }, TODAY).outcome, 'blocked');
});

test('bad amounts and unknown categories are blocked', () => {
  const { db, meera } = fresh();
  for (const amount of [0, -5, NaN, 'abc']) {
    assert.equal(evaluateClaim(db, meera, { category: 'meals', amount }, TODAY).outcome, 'blocked', `amount ${amount}`);
  }
  assert.equal(evaluateClaim(db, meera, { category: 'yacht', amount: 100 }, TODAY).outcome, 'blocked');
});

test('hotel limits are per night, by city tier, and need a city', () => {
  const { db, meera } = fresh();
  const h = (amount: number, units: number, city?: string) =>
    evaluateClaim(db, meera, { category: 'hotel', amount, units, city, expenseDate: TODAY }, TODAY);

  assert.equal(h(10000, 2, 'Mumbai').outcome, 'pending'); // 5,000 a night, metro limit 5,000
  assert.equal(h(10001, 2, 'Mumbai').outcome, 'flagged');
  assert.equal(h(4000, 1, 'Jaipur').outcome, 'flagged'); // non-metro limit is 3,500
  assert.equal(h(3500, 1, 'Jaipur').outcome, 'pending');
  assert.equal(h(4000, 1).outcome, 'blocked'); // no city
  assert.equal(h(12400, 2, 'Bengaluru').rule?.max_amount, 5000);
});

test('the policy lookup returns the metro hotel limit for an L2 in Mumbai', () => {
  const { db, meera } = fresh();
  const ev = evaluateClaim(db, meera, { category: 'hotel', amount: 1, city: 'Mumbai', expenseDate: TODAY }, TODAY);
  assert.deepEqual(ev.rule, { max_amount: 5000, unit: 'per_night', city_tier: 'metro' });
});

test('createClaim needs a description', () => {
  const { db, meera } = fresh();
  const res = createClaim(db, meera, { category: 'meals', amount: 300, expenseDate: TODAY, description: '   ' }, { today: TODAY });
  assert.equal(res.ok, false);
});

test('finance review: roles, own-claim rule, notes and finality', () => {
  const { db, meera, priya } = fresh();
  const mk = (cat: string, amount: number) => {
    const r = createClaim(db, meera, { category: cat, amount, expenseDate: TODAY, description: 'test' }, { today: TODAY });
    assert.ok(r.ok);
    return r.ok ? r.claim.id : 0;
  };
  const pendingId = mk('meals', 300);
  const flaggedId = mk('meals', 900);

  assert.equal(decideClaim(db, meera, pendingId, { decision: 'approved' }).ok, false); // not finance
  const r1 = decideClaim(db, meera, pendingId, { decision: 'approved' });
  assert.ok(!r1.ok && r1.code === 403);

  const r2 = decideClaim(db, priya, flaggedId, { decision: 'approved' });
  assert.ok(!r2.ok && r2.code === 400, 'approving a flagged claim needs a note');
  const r3 = decideClaim(db, priya, flaggedId, { decision: 'rejected' });
  assert.ok(!r3.ok && r3.code === 400, 'rejecting needs a reason');

  const r4 = decideClaim(db, priya, pendingId, { decision: 'approved' });
  assert.ok(r4.ok && r4.claim.status === 'approved' && r4.claim.reviewed_by === 'E900');
  const r5 = decideClaim(db, priya, flaggedId, { decision: 'approved', note: 'Late-night release, manager agreed' });
  assert.ok(r5.ok && r5.claim.status === 'approved');

  const r6 = decideClaim(db, priya, pendingId, { decision: 'rejected', note: 'changed my mind' });
  assert.ok(!r6.ok && r6.code === 409, 'decisions are final');
  assert.ok(!decideClaim(db, priya, 99999, { decision: 'approved' }).ok);
});

test('finance cannot review their own claim', () => {
  const { db, priya } = fresh();
  const r = createClaim(db, priya, { category: 'meals', amount: 300, expenseDate: TODAY, description: 'mine' }, { today: TODAY });
  assert.ok(r.ok);
  if (!r.ok) return;
  const d = decideClaim(db, priya, r.claim.id, { decision: 'approved' });
  assert.ok(!d.ok && d.code === 403);
});

test('date and money helpers', () => {
  assert.equal(daysBetween('2026-11-01', '2026-11-12'), 11);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(parseISODate('2026-02-29'), null); // 2026 is not a leap year
  assert.equal(inr(2400), '₹2,400');
  assert.equal(inr(1234567), '₹12,34,567');
});

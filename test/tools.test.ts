// The old SQLite-backed tests were removed when the data moved to Supabase.
// These cover the Zod argument checks, which run before any database call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SCHEMAS, runTool, type ToolContext } from '../src/lib/tools';

const ctx = { db: null, employee: { id: 'E001', name: 'Meera Nair', email: '', grade: 'L2', department: 'Sales', role: 'employee' }, today: '2026-11-12' } as unknown as ToolContext;

test('createClaim accepts a normal claim and coerces "2,400" to a number', () => {
  const r = TOOL_SCHEMAS.createClaim.parse({ category: 'client_entertainment', amount: '2,400', expense_date: '2026-11-11', description: 'Dinner', city: null });
  assert.equal(r.amount, 2400);
  assert.equal(r.city, undefined);
});

test('bad arguments are refused before the database is touched', async () => {
  for (const [name, args] of [
    ['createClaim', { category: 'yacht', amount: 10 }],
    ['createClaim', { category: 'meals', amount: 'lots' }],
    ['checkPolicyLimit', { category: 'meals', amount: 300, expense_date: '12/11/2026' }],
    ['getMyClaims', { status: 'deleted' }],
  ] as const) {
    const r = await runTool(name, args, ctx); // ctx.db is null: any DB call would throw
    assert.equal(r.ok, false, `${name} ${JSON.stringify(args)}`);
  }
});

test('unknown tools and employee-id arguments cannot act for someone else', async () => {
  assert.equal((await runTool('deleteClaims', {}, ctx)).ok, false);
  const r = await runTool('getEmployee', { employee_id: 'E004' }, ctx);
  assert.equal(r.id, 'E001');
});

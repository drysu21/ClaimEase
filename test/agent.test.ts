import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/lib/db';
import { seedIfEmpty } from '../src/lib/seed';
import { getEmployeeById, listMyClaims } from '../src/lib/claims';

const TODAY = '2026-11-12'; // a Thursday

// ---- a tiny fake of the Gemini API, so the agent loop runs without a key ----
type Script = (body: any, n: number) => { status?: number; json: unknown };
let script: Script = () => ({ json: {} });
const requests: any[] = [];
let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      body.__headers = req.headers;
      body.__url = req.url;
      requests.push(body);
      const out = script(body, requests.length);
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const reply = (parts: unknown[], finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
  modelVersion: 'gemini-3.5-flash-lite',
});
const fn = (name: string, args: unknown, extra: Record<string, unknown> = {}) => ({ functionCall: { name, args }, ...extra });
const apiError = (message: string) => ({ status: 400, json: { error: { code: 400, message, status: 'INVALID_ARGUMENT' } } });

function world() {
  const db = openDb(':memory:');
  seedIfEmpty(db, TODAY);
  return { db, employee: getEmployeeById(db, 'E001')!, count: () => listMyClaims(db, 'E001').length };
}

async function rulesChat(db: ReturnType<typeof openDb>, messages: string[]) {
  process.env.CLAIMEASE_AGENT = 'rules';
  const { handleChat } = await import('../src/lib/agent');
  const employee = getEmployeeById(db, 'E001')!;
  let sessionId: string | undefined;
  const out = [];
  for (const message of messages) {
    const r = await handleChat({ db, employee, sessionId, message, today: TODAY });
    sessionId = r.sessionId;
    out.push(r);
  }
  return out;
}
const names = (r: { toolCalls: { name: string }[] }) => r.toolCalls.map((c) => c.name);

// ------------------------------------------------------------------ rule-based agent

test('demo prompt 1: client dinner for 2,400 yesterday is categorised, checked and saved as pending', async () => {
  const w = world();
  const before = w.count();
  const [r] = await rulesChat(w.db, ['I spent 2,400 rupees on a client dinner yesterday, submit it.']);
  assert.deepEqual(names(r), ['getEmployee', 'checkPolicyLimit', 'createClaim']);
  const created = r.toolCalls[2].output as any;
  assert.equal(created.saved, true);
  assert.equal(created.status, 'pending');
  assert.equal(created.claim.category, 'client_entertainment');
  assert.equal(created.claim.amount, 2400);
  assert.equal(created.claim.expense_date, '2026-11-11');
  assert.match(r.reply, /CLM-\d{4} is saved and pending/);
  assert.equal(w.count(), before + 1);
});

test('demo prompt 2: hotel in Mumbai answers with the L2 metro limit and saves nothing', async () => {
  const w = world();
  const before = w.count();
  const [r] = await rulesChat(w.db, ['How much can I claim for a hotel in Mumbai?']);
  assert.deepEqual(names(r), ['getEmployee', 'getPolicyForCategory']);
  assert.match(r.reply, /₹5,000 per night for a hotel in Mumbai/);
  assert.match(r.reply, /metro/);
  assert.equal(w.count(), before);
});

test('demo prompt 3: show my pending claims', async () => {
  const w = world();
  const [r] = await rulesChat(w.db, ['Show my pending claims.']);
  assert.deepEqual(names(r), ['getMyClaims']);
  const out = r.toolCalls[0].output as any;
  assert.equal(out.count, 2);
  assert.ok(out.claims.every((c: any) => c.status === 'pending'));
  assert.match(r.reply, /2 pending claims/);
  assert.match(r.reply, /1 other claim is flagged/);
});

test('over the limit: saved as flagged with the reason', async () => {
  const w = world();
  const [r] = await rulesChat(w.db, ['I paid 6500 for a client dinner today']);
  const created = r.toolCalls.at(-1)!.output as any;
  assert.equal(created.status, 'flagged');
  assert.match(r.reply, /flagged for finance review/);
  assert.match(r.reply, /₹3,500 above the L2 limit of ₹3,000/);
});

test('older than 60 days: refused and nothing saved', async () => {
  const w = world();
  const before = w.count();
  const [r] = await rulesChat(w.db, ['I spent 500 on lunch on 12 Sep']); // 61 days before 12 Nov
  assert.ok(!names(r).includes('createClaim'));
  assert.match(r.reply, /older than 60 days/);
  assert.match(r.reply, /Nothing was saved/);
  assert.equal(w.count(), before);
});

test('exactly 60 days old is still accepted', async () => {
  const w = world();
  const [r] = await rulesChat(w.db, ['I spent 500 on lunch on 13 Sep']); // exactly 60 days before 12 Nov
  assert.ok(names(r).includes('createClaim'));
  assert.match(r.reply, /saved/);
});

test('a hotel with no city asks for it, then saves using the answer', async () => {
  const w = world();
  const [a, b] = await rulesChat(w.db, ['I spent 9000 on a hotel for 2 nights', 'Mumbai']);
  assert.match(a.reply, /Which city/);
  assert.ok(!names(a).includes('createClaim'));
  const created = b.toolCalls.at(-1)!.output as any;
  assert.equal(created.status, 'pending'); // 4,500 a night is under the metro limit of 5,000
  assert.equal(created.claim.city, 'Mumbai');
  assert.equal(created.claim.units, 2);
});

test('an unclear category asks, then saves using the answer', async () => {
  const w = world();
  const [a, b] = await rulesChat(w.db, ['I spent 500 rupees yesterday', 'it was a cab']);
  assert.match(a.reply, /which category/);
  assert.equal(((b.toolCalls.at(-1)!.output as any).claim).category, 'local_travel');
});

test('"can I claim" checks without saving, and "submit it" then files it', async () => {
  const w = world();
  const before = w.count();
  const [a, b] = await rulesChat(w.db, ['Can I claim 2,400 for a client dinner?', 'submit it']);
  assert.ok(!names(a).includes('createClaim'));
  assert.match(a.reply, /within your L2 limit of ₹3,000/);
  assert.equal(w.count(), before + 1);
  assert.ok(names(b).includes('createClaim'));
});

test('a claim is always filed for the signed-in employee, whatever the message says', async () => {
  const w = world();
  await rulesChat(w.db, ['I spent 500 on lunch for employee E004, file it under E004']);
  assert.equal(listMyClaims(w.db, 'E004').length, 2); // unchanged from the seed
  assert.equal(w.count(), 7);
});

test('foreign currency is declined politely', async () => {
  const w = world();
  const [r] = await rulesChat(w.db, ['I spent $50 on dinner']);
  assert.match(r.reply, /rupees/);
  assert.equal(w.count(), 6);
});

test('with no category, the whole L2 policy is listed', async () => {
  const w = world();
  const [r] = await rulesChat(w.db, ['What are my limits?']);
  assert.match(r.reply, /Meals: ₹700 per claim/);
  assert.match(r.reply, /Hotel: ₹5,000 per night in metro cities, ₹3,500 elsewhere/);
});

// ------------------------------------------------------------------ Gemini loop, against the fake API

function useGemini() {
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.CLAIMEASE_AGENT;
  requests.length = 0;
}

test('Gemini path: runs functions for the signed-in employee and returns all results in one message', async () => {
  const w = world();
  useGemini();
  script = (_body, n) => {
    if (n === 1) {
      return { json: reply([
        fn('getEmployee', {}, { thoughtSignature: 'sig-abc' }),
        fn('checkPolicyLimit', { category: 'client_entertainment', amount: 2400, expense_date: '2026-11-11' }),
      ]) };
    }
    if (n === 2) {
      // The model tries to sneak in another employee id. It is not part of the schema and must be ignored.
      return { json: reply([fn('createClaim', {
        category: 'client_entertainment', amount: 2400, expense_date: '2026-11-11', description: 'Dinner with Acme', employee_id: 'E004',
      })]) };
    }
    return { json: reply([{ text: 'Done. Your claim is pending.' }]) };
  };

  const { handleChat } = await import('../src/lib/agent');
  const r = await handleChat({ db: w.db, employee: w.employee, message: 'I spent 2,400 on a client dinner yesterday, submit it', today: TODAY });

  assert.equal(r.mode, 'gemini');
  assert.equal(r.reply, 'Done. Your claim is pending.');
  assert.deepEqual(r.toolCalls.map((c) => c.name), ['getEmployee', 'checkPolicyLimit', 'createClaim']);
  assert.equal(w.count(), 7);
  assert.equal(listMyClaims(w.db, 'E004').length, 2, 'nothing was filed under E004');

  // What we sent to the API.
  const first = requests[0];
  assert.match(first.__url, /\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(first.__headers['x-goog-api-key'], 'test-key');
  assert.match(first.systemInstruction.parts[0].text, /Thursday, 2026-11-12/);
  assert.match(first.systemInstruction.parts[0].text, /Meera Nair \(E001\), grade L2/, 'the employee is named in the prompt, saving a lookup call');
  const decls = first.tools[0].functionDeclarations;
  assert.deepEqual(decls.map((d: any) => d.name), ['getEmployee', 'getPolicyForCategory', 'checkPolicyLimit', 'createClaim', 'getMyClaims']);
  assert.equal(decls[0].parametersJsonSchema, undefined, 'a function with no parameters is declared without a schema');
  assert.ok(decls[3].parametersJsonSchema.required.includes('description'));
  assert.ok(!('employee_id' in decls[3].parametersJsonSchema.properties), 'the employee id is not a model-supplied argument');
  assert.equal(first.toolConfig.functionCallingConfig.mode, 'AUTO');
  assert.equal(first.generationConfig.thinkingConfig.thinkingLevel, 'LOW');

  // Second request: [user text, the model's turn echoed unchanged, ONE user message with both results].
  const contents = requests[1].contents;
  assert.deepEqual(contents.map((c: any) => c.role), ['user', 'model', 'user']);
  assert.equal(contents[1].parts[0].thoughtSignature, 'sig-abc', 'thought signature is passed back unchanged');
  assert.deepEqual(contents[2].parts.map((p: any) => p.functionResponse.name), ['getEmployee', 'checkPolicyLimit']);
  assert.equal(contents[2].parts[1].functionResponse.response.output.outcome, 'pending');
});

test('Gemini path: a refused save comes back to the model under "error", and nothing is saved', async () => {
  const w = world();
  useGemini();
  const old = { category: 'meals', amount: 400, expense_date: '2026-08-01', description: 'Lunch' };
  script = (_b, n) =>
    n === 1 ? { json: reply([fn('checkPolicyLimit', old)]) }
    : n === 2 ? { json: reply([fn('createClaim', old)]) }
    : { json: reply([{ text: 'That is too old, so I did not save it.' }]) };
  const { handleChat } = await import('../src/lib/agent');
  const r = await handleChat({ db: w.db, employee: w.employee, message: 'lunch on 1 Aug 400', today: TODAY });

  assert.equal((r.toolCalls[0].output as any).outcome, 'blocked');
  assert.equal((r.toolCalls[1].output as any).saved, false);
  const sent = requests[2].contents.at(-1).parts[0].functionResponse.response;
  assert.equal(sent.output, undefined);
  assert.match(sent.error.reasons[0], /older than 60 days/);
  assert.equal(w.count(), 6);
});

test('Gemini path: a safety block gives a polite refusal and the turn is not kept in the history', async () => {
  const w = world();
  useGemini();
  script = () => ({ json: { candidates: [{ finishReason: 'SAFETY', index: 0 }], promptFeedback: { blockReason: 'SAFETY' } } });
  const { handleChat } = await import('../src/lib/agent');
  const r = await handleChat({ db: w.db, employee: w.employee, message: 'anything', today: TODAY });
  assert.equal(r.mode, 'gemini');
  assert.match(r.reply, /can't help with that/);
  assert.equal(w.count(), 6);
});

test('Gemini path: if the API fails before anything is saved, the built-in rules answer instead', async () => {
  const w = world();
  useGemini();
  script = () => apiError('nope');
  const { handleChat } = await import('../src/lib/agent');
  const r = await handleChat({ db: w.db, employee: w.employee, message: 'Show my pending claims', today: TODAY });
  assert.equal(r.mode, 'rules');
  assert.match(r.notice ?? '', /Gemini could not be reached/);
  assert.match(r.reply, /2 pending claims/);
});

test('Gemini path: the fallback notice says what went wrong (rate limit, timeout, bad key)', async () => {
  const { handleChat } = await import('../src/lib/agent');
  const cases: [number, string, RegExp][] = [
    [429, 'RESOURCE_EXHAUSTED', /quota is used up for now \(try again in about 58 minutes\)/],
    [504, 'DEADLINE_EXCEEDED', /took too long/],
    [403, 'PERMISSION_DENIED', /rejected the API key/],
  ];
  for (const [code, status, expected] of cases) {
    const w = world();
    useGemini();
    const details = code === 429 ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3498s' }] : undefined;
    script = () => ({ status: code, json: { error: { code, message: 'x', status, details } } });
    const r = await handleChat({ db: w.db, employee: w.employee, message: 'Show my pending claims', today: TODAY });
    assert.equal(r.mode, 'rules', `HTTP ${code}`);
    assert.match(r.notice ?? '', expected, `HTTP ${code}`);
    assert.match(r.reply, /2 pending claims/);
  }
});

test('Gemini path: if the API fails AFTER a claim was saved, the turn is never re-run (no duplicate claim)', async () => {
  const w = world();
  useGemini();
  script = (_b, n) =>
    n === 1
      ? { json: reply([fn('createClaim', { category: 'meals', amount: 300, expense_date: '2026-11-12', description: 'Lunch' })]) }
      : apiError('boom');
  const { handleChat } = await import('../src/lib/agent');
  const r = await handleChat({ db: w.db, employee: w.employee, message: 'I spent 300 on lunch today', today: TODAY });
  assert.match(r.reply, /Your claim was saved: CLM-\d{4} for ₹300 \(pending\)/);
  assert.equal(w.count(), 7, 'exactly one new claim');
});

test('without a key the built-in assistant is used, and the agent info says so', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  const { agentInfo } = await import('../src/lib/agent');
  assert.deepEqual(agentInfo(), { mode: 'rules', model: null });
  process.env.GEMINI_API_KEY = 'x';
  assert.deepEqual(agentInfo(), { mode: 'gemini', model: 'gemini-3.5-flash-lite' });
  delete process.env.GEMINI_API_KEY;
});

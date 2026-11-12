# ClaimEase: Expense Claim Assistant

Team 21 | PS5 | SRM Agentic AI Hackathon

## The problem
Employees who spend money on work submit claims that break the expense policy, and the finance team spends hours
checking each one by hand.

## What our app does
- The employee describes an expense in plain English; a Gemini agent picks the category and checks it against the policy for their grade.
- It saves the claim to Supabase as **pending**, or **flagged** with the exact reason when it is over the limit.
- It catches **possible duplicates**: the same amount, category and date already claimed is flagged with the earlier claim number.
- It refuses claims older than 60 days, future dates, and requests to file for someone else.
- Employees see their claims by status; finance staff review the flagged queue and approve or reject with a note.

## Live demo
- Vercel link: https://claimease-alpha.vercel.app
- Passcode: none (signed in as Meera Nair, E001, grade L2; pick Priya Sharma in "Signed in as" to see Finance review)
- Try this prompt: "I spent 2,400 rupees on a client dinner yesterday, submit it."
- A request it flags: "I spent 6,500 on a client dinner today, submit it." A request it refuses: "I spent 500 on lunch on 1 Sep, submit it."

## Agent tools
| Tool | What it does | Reads or writes |
| --- | --- | --- |
| getEmployee | Returns the signed-in employee and grade | Reads |
| getPolicyForCategory | Policy limit for a category (hotel by city tier) | Reads |
| checkPolicyLimit | Checks an expense against the policy without saving | Reads |
| createClaim | Saves the claim as pending or flagged with the reason | Writes |
| getMyClaims | Lists the employee's claims and totals by status | Reads |

Every tool's arguments are checked with Zod before it runs. The employee id is never a tool argument.

## Database tables
- `employees`: who can claim, their grade (L1 to L4) and role (employee or finance)
- `policy_rules`: maximum amount per category and grade, per claim or per night, by city tier for hotels
- `claims`: every claim with amount, date, status, flag reason and the finance decision

## Tech stack
Next.js, React, TypeScript, Supabase, Gemini API (function calling), Zod, Vercel

## Team
| Name | Role |
| --- | --- |
| Sugavasi Devanath | Team Lead, Database (repo, Supabase, Vercel) |
| Thondamalla Sarwan | AI / Agent (tools, system prompt) |
| Amirisetty Rohith | Backend / API (API route, Zod) |
| Gonuguntla Lalitya | Frontend (pages, components) |

Build plan and vision: [docs/PLAN.md](docs/PLAN.md). Rules for AI coding agents: [AGENTS.md](AGENTS.md).

## Run it locally
1. npm install
2. Run `supabase/schema.sql` then `supabase/seed_data.sql` in the Supabase SQL Editor
3. Copy .env.example to .env.local and fill in SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY
4. npm run dev

## More details

An expense claim assistant. An employee describes an expense in plain words; the agent finds the
category, checks it against the policy for their grade, saves the claim, and flags it if it breaks a rule.
Finance staff review flagged and pending claims on their own page.

Built with Next.js 16 (App Router, TypeScript), Supabase PostgreSQL (supabase-js), Gemini function calling and Zod.

### Run it

Needs Node 22.13 or newer, and a Supabase project: run `supabase/schema.sql` then `supabase/seed_data.sql` in the SQL Editor, and put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local`.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

You are signed in as **Meera Nair (E001, grade L2)**.

### Demo prompts

| Say | What happens |
| --- | --- |
| `I spent 2,400 rupees on a client dinner yesterday, submit it.` | Category client entertainment, within the L2 limit of ₹3,000, saved as **pending** |
| `How much can I claim for a hotel in Mumbai?` | Looks up the policy: ₹5,000 per night for an L2 in a metro city. Saves nothing |
| `Show my pending claims.` | Lists your pending claims |

Things worth trying: `I spent 6,500 on a client dinner today` (saved as **flagged**, with the reason),
`I spent 500 on lunch on 12 Sep` (older than 60 days, refused), `Can I claim 2,400 for a client dinner?`
(checks only, then say `submit it`).

### Pages

- **Dashboard** (`/`): claims checked, % within policy, money held in flagged claims, spend by category, live from Supabase.
- **New claim** (`/chat`): the chat, with your grade's limits beside it. Each reply shows a claim card with a limit meter and an "Agent workflow" timeline: every tool step, marked READ or WRITE, with its result.
- **My claims** (`/claims`): your ledger, filterable by status. Flagged claims show their reason; decided claims show the finance note.
- **Finance review** (`/finance`): the queue, flagged first. Approve or reject inline. Rejecting needs a reason, and approving a *flagged* claim needs a note explaining the exception. Decisions are final, and nobody can review their own claim.

To see the finance page, pick **Priya Sharma (E900, finance)** in the "Signed in as" menu. That menu is a demo
convenience, not real authentication (see below).

### The business rules

All in [`src/lib/claims.ts`](src/lib/claims.ts), and nowhere else:

- Amount above `max_amount` for the employee's grade and category: saved with status **flagged** and the reason, including by how much.
- Expense older than **60 days**: not allowed, nothing is saved. Day 60 is fine, day 61 is not. Future dates are refused too.
- Hotels are limited **per night** and by city tier (metro or other), so the city and number of nights are needed.
- Otherwise the claim is saved as **pending**.

The language model never decides a status. It can only call the tools, and `createClaim` re-runs the policy check itself before saving.

Limits live in the `policy_rules` table, seeded by [`supabase/seed_data.sql`](supabase/seed_data.sql). Tool arguments are checked with Zod (`TOOL_SCHEMAS` in `src/lib/tools.ts`) before any tool runs.

### The agent

The five tools (`src/lib/tools.ts`): `getEmployee`, `getPolicyForCategory`, `checkPolicyLimit`, `createClaim` (the only write), `getMyClaims`.
The employee id is **not** a tool argument. It always comes from the signed-in session, so a message like "file this for E004" cannot act for someone else.

Two interchangeable agents call those same tools:

1. **Gemini** (`src/lib/agent/llm.ts`, via the official `@google/genai` SDK) when `GEMINI_API_KEY` is set. Default model `gemini-3.5-flash-lite`. It runs a function-calling loop over `generateContent` and hands each result back to the model. A claim takes two model calls: `createClaim` (which checks the policy itself), then the reply.
2. **Built-in assistant** (`src/lib/agent/rules.ts`) when there is no key. It understands the common phrasings (amounts, "yesterday", "last Friday", "3 Nov", categories, "can I claim…", "submit it") and asks for what is missing. If a Gemini call fails before anything is saved, it answers instead and the UI says so. If it fails *after* a claim was saved, the turn is never re-run, so a claim cannot be filed twice.

Put your key in `.env.local` (or `.env`) and restart `npm run dev`; see `.env.example` for every setting.

Things worth knowing about Gemini:

- **Free-tier quota is tiny.** On the test key, `gemini-3.6-flash` allowed **5 requests a minute and 20 a day**, and each chat message uses 2 or more, so about ten messages a day. That is why the default is `gemini-3.5-flash-lite`, which ran every test scenario without hitting a limit. Quotas are per model. When a limit is hit, the built-in assistant answers that message and the chat says so, with how long to wait. Enabling billing on the Google project lifts the limits, or set `GEMINI_MODEL` to another model.
- **Thinking is set to `low`.** With the model's own default thinking, every call in the loop timed out at 30 seconds. `GEMINI_THINKING_LEVEL` changes it (`minimal` is fastest).
- **A call never hangs the chat.** Each model call is cut off after 30 seconds (`GEMINI_TIMEOUT_MS`) and the built-in assistant answers instead.
- `CLAIMEASE_DEBUG=1` logs each model step (timing and which functions it called) to the server console.

### Tests

```bash
npm test
```

Zod argument checks for the agent tools (no database or key needed).

### Known limits

- **Sign-in is a demo.** The "Signed in as" cookie is not secure: anyone can set it, and the finance role follows it. Replace `src/lib/auth.ts` with a real session before using this for anything real.
- Chat memory is in the server process. Restarting it clears conversations (claims are in the database and stay).
- Amounts are INR only. Receipts and attachments are not handled.

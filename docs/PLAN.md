# ClaimEase project plan (Team 21, PS5: Expense Claim Assistant)

Live: https://claimease-alpha.vercel.app · Code: https://github.com/drysu21/ClaimEase

## 1. Vision
ClaimEase is not a chatbot that answers questions. It is an **AI agent that does the claim work**:
it reads the policy, decides which checks to run, files the claim in the database, and hands finance a
short queue of only the claims that need a human. One system, three users:

| User | What they do in ClaimEase | Screen |
| --- | --- | --- |
| **Employee** (Meera Nair, E001, L2) | Describes an expense in plain English; the agent files it | New claim, My claims |
| **Finance reviewer** (Priya Sharma, E900) | Reviews only the flagged queue; approves or rejects with a note | Finance review |
| **Manager / judge** | Sees spend, policy breaks and money held, at a glance | Dashboard |

## 2. Problem
- 36 limits to remember (9 categories × 4 grades), plus per-night hotel limits by city tier.
- Employees don't know their limit, so claims break policy: 5 of 14 seed claims broke a rule.
- Finance checks every claim by hand. Old claims and duplicate claims slip through.

## 3. What the agent does (the agent loop)
```
Employee message
   │
   ▼
/api/chat ──► Gemini (gemini-3.5-flash-lite) gets: system prompt + 5 tool schemas + chat so far
   │                 │
   │                 ▼ chooses a tool + arguments (or answers)
   │          Zod validates the arguments ── bad? → error back to Gemini, it retries
   │                 │
   │                 ▼
   │          Tool runs on the server against Supabase (READ or WRITE)
   │                 │
   │                 ▼ result goes back to Gemini ── loop (capped) until it answers
   ▼
Reply + claim card + limit meter + "Agent workflow" timeline (every step, READ/WRITE, result)
```
- **Multi-step:** one message can trigger several tools, e.g. `getPolicyForCategory` → `createClaim`.
- **Fallback agent:** if Gemini is down or out of quota, a rule-based agent (`src/lib/agent/rules.ts`) runs the same
  tools, so the demo never breaks. A claim already saved is never re-run, so nothing is filed twice.
- **Transparency:** each reply shows the agent's workflow: step number, READ/WRITE badge, tool, result, raw details.

## 4. Tools
| # | Tool | Type | Table | What it returns |
| --- | --- | --- | --- | --- |
| 1 | `getEmployee` | READ | employees | name, grade, department of the signed-in employee |
| 2 | `getPolicyForCategory` | READ | policy_rules | limit, unit and notes for a category, or the full grade table |
| 3 | `checkPolicyLimit` | READ | policy_rules, claims | pending / flagged / blocked with reasons. Saves nothing |
| 4 | `createClaim` | **WRITE** | claims | the saved claim, its status, flag reason and the limit used |
| 5 | `getMyClaims` | READ | claims | the employee's claims and totals per status |

Every tool has a JSON schema for Gemini (`TOOL_DEFS`) and a Zod schema (`TOOL_SCHEMAS`) checked before it runs.

## 5. Business rules (in code, `src/lib/claims.ts`, never in the prompt)
| Rule | Result |
| --- | --- |
| Amount over the grade limit | Saved as **flagged**, with the reason and how much over |
| Hotel | Limit is **per night**, by city tier (metro / other); needs city and nights |
| Expense older than 60 days, or in the future | **Refused**, nothing saved |
| Same employee, category, amount and date already claimed (not rejected) | Saved as **flagged: possible duplicate** of CLM-xxxx |
| Finance reviews their own claim | Refused |
| Reject, or approve a flagged claim, without a note | Refused |
| Claim already decided | Refused (decisions are final; checked in the same database update) |

## 6. Safety and guardrails
- The employee id comes from the signed-in session cookie, **never from a tool argument**. "File it for E004" is refused.
- The language model **never sets the status**. `createClaim` re-runs the policy check itself.
- Zod rejects bad arguments (unknown category, bad date, negative amount) before any database call.
- Supabase keys live only on the server (`.env.local`, Vercel env vars), never in the browser.
- Agent loop is capped per message and per session; message length is capped at 1,000 characters.

## 7. Data model (Supabase Postgres, RLS on)
| Table | Key columns |
| --- | --- |
| `employees` | id, name, email, grade L1–L4, department, role employee/finance |
| `policy_rules` | category, grade, city_tier any/metro/other, max_amount, unit per_claim/per_night, notes |
| `claims` | id, employee_id, category, amount, units, city, expense_date, status, flag_reason, policy_limit, reviewed_by, reviewed_at, review_note |

Seed: 5 employees, 36 policy rules, 14 claims (`supabase/seed_data.sql`, dates relative to today).

## 8. Screens
| Screen | Path | What it shows |
| --- | --- | --- |
| **Dashboard** | `/` | Claims checked, % within policy, flagged amount held, pending, decided; spend by category (within vs flagged); how the agent works |
| **New claim** | `/chat` | Chat with the agent, claim card with **limit meter**, **agent workflow timeline**, the grade's limits beside it |
| **My claims** | `/claims` | The employee's claims from Supabase, filter by status |
| **Finance review** | `/finance` | Flagged first, then pending; approve or reject with a note |

## 9. Team and ownership
| Member | Role | Owns |
| --- | --- | --- |
| Sugavasi Devanath | Team Lead · Database | Repo, Supabase schema and seed, Vercel, dashboard |
| Thondamalla Sarwan | AI / Agent | Tools, system prompt, Gemini loop, fallback agent |
| Amirisetty Rohith | Backend / API | `/api/chat`, Zod schemas, business rules, finance actions |
| Gonuguntla Lalitya | Frontend | Pages, chat UI, limit meter, workflow timeline |

## 10. Build timeline
| Phase | Done |
| --- | --- |
| 1. Supabase tables, seed data, RLS | ✓ |
| 2. Read tools, then `createClaim`, then the system prompt | ✓ |
| 3. Agent loop with Gemini function calling + rule-based fallback | ✓ |
| 4. Chat, My claims, Finance review pages | ✓ |
| 5. Zod validation and tests | ✓ |
| 6. Duplicate detection, limit meter, dashboard, workflow timeline | ✓ |
| 7. Deploy to Vercel, test all demo prompts on the live link | ✓ |

## 11. Testing (checked on the live link)
| Input | Expected | Result |
| --- | --- | --- |
| ₹2,400 client dinner yesterday, submit | Saved **pending** | ✓ |
| How much for a hotel in Mumbai? | ₹5,000 per night, nothing saved | ✓ |
| ₹6,500 client dinner today, submit | **Flagged**, ₹3,500 over L2 limit | ✓ |
| Same dinner sent twice | **Flagged**, possible duplicate | ✓ |
| ₹4,200 hotel in Pune, 1 night | **Flagged**, 120% of ₹3,500 non-metro limit | ✓ |
| Lunch from 1 Sep | **Refused**, older than 60 days | ✓ |
| File it for E004 | **Refused**, own claims only | ✓ |
| Unit tests (`npm test`) | Zod rejects bad tool input | ✓ 3 passing |

## 12. Roadmap (after the hackathon)
1. Receipt photo upload with OCR (Gemini vision) to fill amount, date and merchant.
2. Real sign-in with Supabase Auth and row-level policies per employee.
3. Manager approval step before finance for claims above a threshold.
4. Monthly spend summary per department, emailed to finance.
5. Slack / email notification when a claim is flagged or decided.

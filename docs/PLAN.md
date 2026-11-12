# ClaimEase build plan and vision (Team 21, PS5)

## Vision
Employees file expense claims by just describing them. The agent picks the category, checks the policy for
their grade, saves the claim, and flags it with a clear reason when it breaks a rule. Finance stops checking every
claim by hand and only reviews the flagged queue.

## Problem
Employees submit claims that break the policy, and the finance team spends hours checking each one by hand.

## Agent tools
| Tool | Reads / writes | Table | Returns |
| --- | --- | --- | --- |
| `getEmployee` | Reads | employees | id, name, grade, department of the signed-in employee |
| `getPolicyForCategory` | Reads | policy_rules | max amount, unit, notes for a category (or the full grade table) |
| `checkPolicyLimit` | Reads | policy_rules | pending / flagged / blocked, with reasons. Saves nothing |
| `createClaim` | **Writes** | claims | the saved claim, status and flag reason |
| `getMyClaims` | Reads | claims | the employee's claims and totals per status |

## Rules the write tool checks before saving
1. Expense date is a real date, not in the future, and at most 60 days old; otherwise refuse.
2. Hotels need a city (metro or other tier) and number of nights; the limit is per night.
3. Amount above the grade's `max_amount`: save as `flagged` with the reason (by how much); else `pending`.

## Screens and API
- `POST /api/chat`: the agent loop (Gemini picks tools; max steps capped; falls back to a rule-based assistant).
- `/chat` New claim chat with "Steps taken" and the grade's limits beside it.
- `/claims` My claims, filterable by status.
- `/finance` Finance review: flagged first, approve or reject with a note.

## Build order (done)
1. Supabase tables + seed data
2. Read tools, then `createClaim`, then the system prompt
3. Chat API route and pages
4. Zod checks, rule tests, deploy to Vercel

## Next (after the hackathon)
- Receipt upload with OCR to fill amount and date
- Real sign-in (Supabase Auth) instead of the demo user switcher
- Monthly spend summary per department for finance

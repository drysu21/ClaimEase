# AGENTS.md — rules for AI coding agents (ClaimEase, Team 21, PS5)

- Problem: PS5 Expense Claim Assistant. Business user: an employee who spends money on work. Logged-in user: E001 Meera Nair, grade L2.
- Stack: Next.js App Router, TypeScript, Supabase PostgreSQL via supabase-js (server only), Gemini function calling (`@google/genai`), Zod. Deployed on Vercel.
- Tables (see `supabase/schema.sql`):
  - `employees` (id, name, email, grade L1-L4, department, role employee|finance)
  - `policy_rules` (category, grade, city_tier any|metro|other, max_amount, unit per_claim|per_night, notes)
  - `claims` (id, employee_id, category, description, amount, units, city, expense_date, submitted_at, status pending|flagged|approved|rejected, flag_reason, policy_limit, reviewed_by, reviewed_at, review_note)
- Agent tools live in `src/lib/tools.ts`: a JSON schema in `TOOL_DEFS` for Gemini and a Zod schema in `TOOL_SCHEMAS`, checked before the tool runs.
- Business rules live only in `src/lib/claims.ts`:
  - Amount above `max_amount` for the grade and category: save with status `flagged` and the reason.
  - Expenses older than 60 days, or in the future: refuse, save nothing.
  - Same category, amount and expense date already claimed (not rejected): save as `flagged`, "Possible duplicate".
  - Hotels are limited per night by city tier, so city and nights are needed.
  - Finance cannot review their own claim; rejecting, or approving a flagged claim, needs a note; decisions are final.
- The employee id comes from the signed-in session (`src/lib/auth.ts`). Never take a user id as a tool argument.
- The language model never sets a claim's status; `createClaim` re-checks the policy itself.
- Never use Supabase keys in client components. Never commit `.env.local`.

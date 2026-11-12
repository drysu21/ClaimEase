# ClaimEase presentation guide (Team 21, PS5)

About 5 minutes of demo plus questions. Open https://claimease-alpha.vercel.app on the laptop before you start,
and keep `docs/ClaimEase_slides.pdf` open in a second window.

## Before you go up (2 minutes)
- [ ] Live link open on **New claim**, signed in as **Meera Nair (E001, L2)**. Click **New chat** so the chat is empty.
- [ ] Slides open on slide 1.
- [ ] Backup: `npm run dev` working on a laptop, in case the Wi-Fi fails.
- [ ] Everyone knows their part below and the answers to the judge questions.

## Who says what

| Time | Who | Slide / screen | What to say |
|---|---|---|---|
| 0:00–0:30 | **Devanath** (Team Lead) | Slide 1 | "We are Team 21, PS5, Expense Claim Assistant. Our app is **ClaimEase**: an employee describes an expense in plain English, and an AI agent files it, checks it against policy, and flags anything that breaks a rule." Introduce the team and roles. |
| 0:30–1:00 | **Lalitya** (Frontend) | Slide 2 | "Employees don't know the limit for their grade, so they submit claims that break policy. Finance checks every claim by hand. In our data there are 36 limits to remember, and 5 of 14 claims broke one." |
| 1:00–3:00 | **Sarwan** (AI / Agent) | **Live app** | Live demo, 4 prompts below. After each one, open **Steps taken** to show which tool Gemini chose. |
| 3:00–3:45 | **Rohith** (Backend) | Slide 4 | "Gemini never touches the database. It only asks for a tool. Our code checks the arguments with Zod, runs the tool against Supabase, and the business rules are in code, not in the prompt." |
| 3:45–4:30 | **Devanath** | **Live app → Finance review**, then slide 5 | Switch "Signed in as" to **Priya Sharma (finance)**. Show flagged claims first, and approve one with a note. Then slide 5: results and links. |

## The live demo (Sarwan), in this order

1. **Happy path:** `I spent 2,400 rupees on a client dinner with Acme yesterday, submit it.`
   → Saved as **pending**, with a claim number. *Say:* "Gemini chose `createClaim`, and it was saved in Supabase."
2. **Policy question, nothing saved:** `How much can I claim for a hotel in Mumbai?`
   → ₹5,000 per night. *Say:* "Read-only tool. Mumbai is a metro city, so the metro limit applies."
3. **Rule break:** `I spent 6,500 on a client dinner with Northwind today, submit it.`
   → Saved as **flagged**: ₹3,500 over the L2 limit. *Say:* "The status is decided by our code, not by the AI." Point at the **limit meter** on the claim card: it fills past the black limit line and turns amber-red when over.
4. **Our extra feature, duplicate detection:** send prompt 1 again, word for word.
   → Flagged as a **possible duplicate** of the claim from step 1. *Say:* "Duplicate claims are a real source of loss for finance. ClaimEase catches them automatically."
5. *(If time)* **Refusal:** `I spent 500 on lunch on 1 Sep, submit it.` → refused, older than 60 days, nothing saved.

Then click **My claims** to show the new rows came straight from Supabase.

## Judge questions and who answers

| Question | Who | Answer |
|---|---|---|
| How does the agent decide what to do? | Sarwan | We send Gemini the message and 5 tool descriptions. Gemini picks the tool and arguments; our code runs it and sends the result back, in a loop until it answers. |
| What stops the AI from breaking your rules? | Rohith | `createClaim` re-checks the policy in code (`src/lib/claims.ts`) before saving. The AI can't set the status. |
| Why not pass the user id to the tool? | Rohith | So nobody can act as someone else. The server takes the id from the signed-in session. "File it for E004" is refused. |
| What does Zod do? | Rohith | It checks the arguments Gemini sends (category, amount, date format) before any tool runs. Bad input is rejected with a clear message. |
| Which tool writes to the database? | Sarwan | `createClaim` inserts into the `claims` table. Finance approve/reject updates it. |
| Where are your keys? | Devanath | In `.env.local` (not in Git) and in Vercel environment variables. Never in the frontend. |
| How do you detect duplicates? | Sarwan | Before saving, we look for a claim by the same employee with the same category, amount and date that isn't rejected. If one exists, the new claim is flagged with that claim number. |
| What happens if Gemini is down or out of quota? | Sarwan | A built-in rule-based assistant answers with the same tools, so the demo never crashes. If a claim was already saved, we never re-run it, so nothing is filed twice. |
| What is the bar on the claim card? | Lalitya | The limit meter: how much of the grade limit this claim uses. Green within the limit; past the black line it turns amber-red, so the employee sees at a glance why it was flagged. |
| What would you add next? | Lalitya | Receipt photo upload with OCR to fill amount and date, real sign-in, and a monthly spend summary for finance. |
| Who wrote this part? | Owner | Each member explains their own area, even if AI helped write it. |

## If something goes wrong
- **Gemini is slow or errors:** the built-in assistant answers and the chat says so. Keep going, and say it's the fallback.
- **The page doesn't load:** switch to the localhost backup.
- **A judge asks a question you don't know:** "Good question. [Owner] built that part", and pass it on.

## Links for the form
- GitHub: https://github.com/drysu21/ClaimEase
- Vercel: https://claimease-alpha.vercel.app (no passcode)
- Slides: `docs/ClaimEase_slides.pdf`

# The Study Duck

A plush duck you teach out loud. The gap between feeling you know something and knowing it becomes a number (the Illusion Score).

This is not a quiz bot that walks a script. You talk. Grok reads whether you actually taught anything. Code picks the *kind* of move (keep listening, probe a gap, celebrate, wrap up). Grok writes the line from this turn: what you just said, what the duck last said, and what is still open.

```bash
cp .env.example .env.local   # XAI_API_KEY and DATABASE_URL
npm install
npm run dev                  # http://localhost:3000
npm test
```

Talk against the real engine at `/dev/voice` (Real server, not Mock) or start from a section. After wrap-up, `/sessions/[id]/results` is the debrief.

## How a session works

1. The duck opens: *explain it to me, I'm just a duck.*
2. A greeting or mic check is answered as a greeting. It is not "you missed sorted input."
3. When you teach, Grok judges structure (quotes have to appear in your words). Code updates scores and the help ladder.
4. The next line is worded from your last turn. Fallback questions are the *intent* (probe the gap), not a script to recite. Planted claims and traces (`lo = mid`, `1, 3, 5, 7, 9`) stay exact so the answer cannot leak.
5. "Hmm, let me think" only plays if `/turn` is still going after **8 seconds**. A normal Grok round trip is 2–4 s.
6. `/end` computes understanding, the Illusion Score, the strongest moment, the one concept to revisit, recall dates, and the learner profile. The spoken wrap-up is one sentence about *this* session.

Code still owns scores, levels, leak check, skip/wrap brakes, and which concept is the hole. Grok owns whether you started teaching and the words you hear. Per-user config overrides stay within 25% of the default.

## Illusion Score and recall

- **Understanding** = share of concepts Owned, Assisted counting half (0–100).
- **Illusion Score** = stated confidence (1–5 × 20) minus understanding.
- **Recall:** 1 day (misconception, explained-to, skipped, not-yet), 2 days (assisted), 4 days (owned). A later success doubles the interval up to 30 days; a miss resets to 1.

`GET /api/sessions/:id/results`, `GET /api/review/due` and `GET /api/profile` return that from the database, not stubs.

## Stack

Next.js (App Router, `src/`), Tiger Data (Postgres via `pg`), Grok Voice + Grok text (xAI), Recharts, Vitest.

Keys go in `.env.local` or `.env`, never in git.

## Docs

- [Master build plan](docs/The%20Study%20Duck%20Master%20Build%20Plan.md) — API contract, who owns what, B13 done-when
- [Rules spec](docs/Duck%20When%20the%20Duck%20Speaks%20Up%20(Rules%20Spec).md) — signals, ladder, conversation, end-of-session, profile

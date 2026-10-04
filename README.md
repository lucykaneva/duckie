# Duckie

A rubber duck you teach out loud. The gap between how sure you felt and how much you could actually explain becomes a number: the Illusion Score.

You upload your slides, say how sure you are, close the laptop, and talk. Duckie plays a curious student who is quietly holding the checklist. Most tutors explain the chapter to you. Duckie makes you do the explaining.

The landing page is a duck made of particles. Scroll and it settles, then the line appears, then you land in your courses.

## A session

1. **Upload** notes or slides. Duckie pulls out the concepts, the usual wrong ideas, and the slide each one lives on.
2. **Rate yourself** from 1 to 5 before you start.
3. **Teach.** Duckie opens with the topic: *"I don't really get binary search yet. How does it work?"* It waits until you finish, then makes one short move. Teaching binary search, you might hear *"So I could use it on my pebbles? They're all mixed up."* That checks whether the list has to be sorted, without saying so.
4. **Get help in steps.** A curious question, then a plainer one, then a smaller example, and only then a short explanation you have to say back. Trace answers stay on the server until you commit to yours.
5. **See the gap.** The debrief shows what you owned, what needed help, and what Duckie had to explain. Shaky ideas come back after 1, 2, or 4 days.

Talk to the real engine at `/dev/voice` (Real server, not Mock), or start from a section. After wrap-up, `/sessions/[id]/results` is the debrief and `/sessions/[id]/log` is every turn. `/review` is what is due.

## How a turn works

Code decides the move. The model only does two jobs: pull quotes out of what you said, and choose the words.

```
you finish a thought
        │
        ▼
   Grok Voice          transcript, then speaks the approved line
        │
        ▼
   judge               concepts covered, missed, or wrong, each with your exact quote
        │              a quote that is not in your words is dropped
        ▼
   rules engine        score, help level, which concept, whether to skip or stop
        │
        ▼
   wording             one or two spoken sentences, 20 words or fewer
        │
        ▼
   leak check          anything that would say a stored answer is blocked
```

A line Duckie is not allowed to say never gets spoken. If wording fails, a fixed line is used instead. Numbers live in `src/lib/duck/config.ts`.

| | |
| --- | --- |
| End of a turn | 1.8 s of silence, or 4 s if you trailed off |
| Barge-in | stop target 300 ms |
| "Hmm, let me think" | only if `/turn` is still going after 8 s. A normal round trip is 2–4 s |
| Help | at most 3 moves on one concept, then an offer to leave it. Asking for help can earn a few more |
| Session | 8 minutes |
| Slides | stored for the debrief. The duck does not mention them while you talk |

Trace and prediction answers come from running reference code, not from the model. `reference_code` and `expected_answer` stay in `concept_secrets` and never go into an API response or a prompt before you commit.

## Illusion Score

Understanding is the share of concepts you owned, with assisted counting half, from 0 to 100. Confidence is your 1 to 5, times 20.

```
Illusion Score = 20 × confidence − understanding
```

Felt 5/5 and owned 1 of 5 concepts: 100 − 20 = **80**. A positive score means you overestimated yourself. A negative score means you knew more than you felt.

Recall starts at 1 day (misconception, explained-to, skipped), 2 days (assisted), or 4 days (owned). A later success doubles the gap up to 30 days. A miss resets it to 1.

After a session, the turn log is summarised into a learner profile. A profile line has to point at something you said. Any nudge to the duck's timing stays within 25% of the default.

## Run it

```bash
cp .env.example .env.local   # XAI_API_KEY and DATABASE_URL
npm install
npm run db:migrate
npm run db:seed              # binary search demo
npm run dev                  # http://localhost:3000
npm test
```

| Script | |
| --- | --- |
| `npm run dev` | Next.js on port 3000 |
| `npm test` | Vitest. The rules engine runs with no model and no audio |
| `npm run db:migrate` | Postgres schema |
| `npm run db:seed` | Demo course, binary search section, concepts |
| `npm run build` | Production build |

Keys go in `.env.local`. They are not in git.

The demo section is Algorithms → Binary search. Concepts: sorted input, halving, when it stops, the update step, and O(log n). The trace is the list 1, 3, 5, 7, 9, looking for 6.

## Stack

| | |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| Voice | Grok Voice API. Speech in, the approved line out, barge-in |
| Text | Grok. Judge, wording, slide extraction, learner profile |
| Data | Tiger Data (Postgres via `pg`) |
| Slides | pdf-parse, plus Grok for concepts and misconceptions |
| Pictures | Three.js particle duck on the landing page. Recharts on the debrief |
| Tests | Vitest |
| Duck | Clip-on mic, a speaker in the plush, no screen |

## Where things live

| Path | What |
| --- | --- |
| `src/app/` | Landing, courses, upload, the session, debrief, review |
| `src/app/api/` | Courses, sections, upload, `/turn`, results, profile, review |
| `src/components/` | UI, including the particle duck |
| `src/lib/engine/` | Signals, scores, ladder, brakes, leak check, recall, debrief |
| `src/lib/prompts/` | `judgeTurn`, `wordMove`, `summarizeProfile` |
| `src/lib/voice/` | Voice session, turn-taking, barge-in, silence |
| `src/lib/db/` | Schema, queries, seed |
| `src/lib/extract/` | PDF text and concept extraction |
| `src/lib/duck/config.ts` | Every threshold |
| `tests/` | Engine tests, including a full binary-search replay |

## Docs

- [Master build plan](docs/The%20Study%20Duck%20Master%20Build%20Plan.md) covers the API contract and who owns what.
- [Rules spec](docs/Duck%20When%20the%20Duck%20Speaks%20Up%20(Rules%20Spec).md) covers signals, the help ladder, and the worked example.

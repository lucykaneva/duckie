@AGENTS.md

# The Study Duck

Hackathon project: a plush duck you teach out loud, so the gap between feeling you know something and knowing it becomes a number (the Illusion Score). Full plan: `docs/master-build-plan.md` (read the relevant section before building a feature, don't load it all). Rules spec: Angela's "Duck: When the Duck Speaks Up".

## Stack

One Next.js app (App Router, TypeScript, `src/`), API routes under `src/app/api`, Tiger Data (Postgres via `pg`), Grok Voice and Grok text API (xAI), Recharts, Vitest.

## Layout

Each folder has one owner. Stay in your lane; if you need a change in someone else's folder, ask them. The seam between Dev A and Dev B is `POST /api/sessions/[id]/turn`: Dev B's route calls Dev A's functions.

| Path | Owner | What goes here |
| --- | --- | --- |
| `src/app/` | Designer | Pages: landing, `courses/` (course, section, upload), `session/[id]/`, `debrief/` (results, "Your duck has learned"), `review/` (recall list) |
| `src/app/api/` | Dev B | API routes from the plan's API contract: `courses`, `sections`, `sessions/[id]/turn`, `profile`, `review/due` |
| `src/components/` | Designer | UI pieces and styling |
| `src/mocks/` | Designer | Mock JSON the UI builds against until real endpoints are live |
| `src/lib/duck/` | Shared (Dev B edits) | `config.ts` (the `DUCK` thresholds) and `types.ts` (interfaces everyone imports) |
| `src/lib/engine/` | Dev B | Rules: signals, scores, ladder, brakes, leak check, recall schedule, reference-code runner |
| `src/lib/db/` | Dev B | Tiger Data schema and queries |
| `src/lib/extract/` | Dev B | pdf-parse and Grok concept extraction |
| `src/lib/voice/` | Dev A | Grok Voice session, end-of-turn timing, barge-in, silence timers, hardware |
| `src/lib/prompts/` | Dev A | `judgeTurn`, `wordMove`, `summarizeProfile` (Grok text) |
| `tests/` | Dev B | Vitest tests for the engine |

Not in git: `.env.local`. Owners are enforced by `CODEOWNERS` once it is added.

## Rules that must not be broken

- Code decides scores, levels and moves; the AI only judges structure and chooses wording.
- Tune numbers in `src/lib/duck/config.ts`, never in logic.
- A judge item without a quote that appears verbatim in the turn text is dropped.
- The duck's line is 20 words or fewer with at most one question, and never contains a stored answer before the student commits (leak check).
- `reference_code` and `expected_answer` live only in `concept_secrets` and never appear in any API response or AI prompt before commit.
- Keys go in `.env.local`, never in git.

## Commands

- `npm run dev` start on :3000
- `npm test` run Vitest
- `npm run build` / `npm run lint`

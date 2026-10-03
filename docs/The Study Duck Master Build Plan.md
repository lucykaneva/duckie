# The Study Duck: Master Build Plan

Oct 2, 2026 · @HD

## Overview

The Study Duck is a plush duck on your desk that you teach out loud, so the gap between feeling you know something and actually knowing it becomes a number. Build window: Saturday 9am to Sunday 8am (23 hours), with two devs plus one designer.

**The problem.** Studying with ChatGPT feels productive because every explanation makes sense while you read it. Then the exam arrives and nothing comes out. Reading a clear explanation is not the same as retrieving it yourself, and students are falling into this trap without noticing.

**One line.** AI makes you feel like you understand. The duck shows you whether you actually do.

**Why a duck.** Rubber duck debugging works because explaining out loud exposes what you don't know. Our duck talks back and asks questions. It is a physical object with no screen, so you cannot peek at ChatGPT mid-answer.

**Targets**

- SpaceX track ("Make it Legendary"): must be built with Cursor and must use the Grok Imagine or Voice API. We use Grok Voice. Bonus points for using Grok for planning and team collaboration.
- Tiger Data (our database), GoDaddy (our domain), and the main track prizes.
- Dropped from the original doc: ElevenLabs and Gemini, to keep one voice provider and one key. Revisit only if Grok Voice fails the tonight spike.

## Product spec

The user teaches and the duck is the student: curious, a little dim, and secretly holding the checklist. Angela's rules spec ("Duck: When the Duck Speaks Up", Oct 2) is the source of truth for every number and rule below. Its core principle: simple, measurable rules in code decide when the duck acts and how much help it gives, and the AI only chooses the words.

### Core flow

1. **Web setup.** Sign in (stubbed), create a course, add a section of type *test* or *project*, upload slides, notes or code.
2. **Analysis on upload.** Grok extracts, per topic, the key concepts, the known misconceptions and their slide numbers. For some concepts it also writes a trace or prediction question with reference code, so that answer comes from running code and never from the AI.
3. **Start.** The student clicks Start (this activates the mic), closes the laptop and picks up the duck.
4. **Confidence.** The duck asks once per topic: "How sure are you about this, 1 to 5?" This number feeds the Illusion Score. The spec does not cover it, so see the open questions.
5. **The student explains and the duck listens.** The duck waits for a real end of turn, evaluates the rules once, then makes exactly one move: at most one question, 20 words or fewer.
6. **Help ladder.** Levels L0 to L4, one level up per failed attempt. The duck never explains first.
7. **Brakes.** "Move on" skips a concept, two duck questions in a row trigger an open prompt, silence has timers, and a session ends at 8 minutes or 6 concepts.
8. **Rare, earned praise.** Real celebration only after earned success, once per concept.
9. **Wrap-up.** One spoken sentence: the strongest moment and the one concept to revisit. Full results go on screen.
10. **Recall.** Concepts come back after 1, 2 or 4 days depending on how they ended, doubling per successful recall up to 30 days.

### The rules at a glance

| Turn-taking rule | Setting |
| --- | --- |
| End of turn | 1.2 s of silence after speech (use Grok Voice's built-in turn detection if it has one) |
| Unfinished thought | Last word is "and", "so", "because", "like", "um" or "uh": wait up to 3.0 s |
| Barge-in | Student talks over the duck: duck stops within 300 ms |
| One move per turn | At most one question, spoken line of 20 words or fewer |
| Long student turn | Never interrupted; evaluated only when it ends |
| Filler | If evaluation takes over 1.5 s, say "Hmm, let me think" once |

Each concept keeps its own struggle score from 0 to 1. Signals add up across turns, capped at 1.

| Signal | Detected by | Adds |
| --- | --- | --- |
| "I don't know" | Code: phrases like "no idea", "not sure at all" | 0.45 |
| Wrong prediction or trace | Code: answer differs from the reference code's output | 0.3 each time |
| Misconception stated | Judge, with the student's exact quote | 0.3 |
| Concept missed | Judge, only after the explanation turn ends | 0.3 |
| Self-contradiction | Judge, with both quotes | 0.3 |
| Long silence after a question | Code: 8 s of no speech | 0.25 |
| Vague answer | Judge, with a quote | 0.25 |
| Hedging | Code: 2 or more "I think", "maybe", "kind of", "or something" in a turn | 0.15 |
| Heavy fillers | Code: more than 1 "um" or "uh" per 8 words | 0.1 |

Fair-evidence rules: a judge signal without an exact quote does not count. Each signal counts once per student turn. A correct prediction or unaided explanation resets that concept to 0. Asking for help is not a struggle signal.

| Level | Score band | What the duck does |
| --- | --- | --- |
| L0 Listen | Under 0.25 | Says nothing about the concept and moves on |
| L1 Curious question | 0.25 to 0.45 (misconceptions start here) | A naive question that tests the gap without naming it |
| L2 Point to the source | 0.45 to 0.6 | Names the slide, not the answer |
| L3 Smaller case | 0.6 to 0.8, or the student asks for help | A tiny example with different values |
| L4 Explain, then teach back | 0.8 or more, or 3 failed attempts | Explains in 2 sentences or fewer, then asks the student to restate it |

Ladder rules: a request for help starts at L3, never L4. L4 needs at least one attempt first and always ends with teach-back. At most 3 duck moves per concept, then the duck offers to move on.

| Concept state | Meaning | Debrief colour |
| --- | --- | --- |
| Not yet | Not discussed so far | Grey |
| Owned | Explained or predicted correctly with no help | Green |
| Assisted | Got there after help at L1 to L3 | Yellow |
| Explained to | Needed L4 | Red |
| Misconception | Stated a wrong belief and did not resolve it | Red |
| Skipped | Student chose to move on | Grey, scheduled for recall |

**The duck never:** speaks while the student speaks, says a trace or prediction answer before the student commits to one, asks more than one question in a turn, explains first below L4, reads slides aloud beyond one sentence, or praises reflexively.

All thresholds live in one config object (the `DUCK` object in the spec). The team tunes numbers in the config and never edits logic to tune.

### Illusion Score

Illusion Score = stated confidence (1 to 5, times 20) minus understanding, per topic. Understanding is the share of concepts Owned, with Assisted counting half. Example: "Binary search: felt 5/5, owned 1 of 5." This definition is our addition on top of the spec and needs a team yes.

### Adaptability (core differentiator)

The rules stay in code. What adapts is a small set of config numbers per student, plus a tone line given to the wording prompt, both driven by a learner profile that is rewritten after every session from the turn log.

- **Pace:** a student who often pauses mid-thought gets a longer end-of-turn wait, so the duck interrupts less.
- **Nagginess:** a student who skips often or goes quiet after repeated questions gets a higher L1 threshold and a lower move cap.
- **Calibration:** a student who is regularly overconfident (felt high, owned low) gets lower thresholds on their strong topics, so the duck probes sooner.
- **Teaching habits:** skips steps, leans on jargon, hedges a lot, relies on analogies. These shape which gaps the duck probes first.
- **Tone:** whether the student responds to humour or encouragement. This only changes the duck's wording.

Guard rails (our proposal): each override stays within about 25% of the default, and every profile line must point to a student quote in the turn log, the same quote-or-it-doesn't-count rule as the signals. The website shows the result as "Your duck has learned: ...".

### Stretch features (only after the core loop is solid)

- Laptop notification invitations when concepts are due for recall (spec section 7).
- A "duck knows the basics" opening variant for students who give context first.
- Pico W with LEDs and a servo for glowing eyes and a head tilt.

## Tech stack

One voice and AI provider (Grok), one app (Next.js), one database (Tiger Data). The rules engine is plain TypeScript inside the same repo so it can be unit tested without any AI or audio. Everything is coded in Cursor, and Grok is also used for team planning to meet the track's bonus criteria.

| Layer | Tool | Purpose | Owner |
| --- | --- | --- | --- |
| Voice | Grok Voice API | Speech in with finished-turn transcripts, speech out of the approved line, barge-in | Dev A |
| Judge | Grok text API | Reads a finished turn and returns structure only: concepts covered, missed, misconceptions, contradictions, vague answers, each with the student's exact quote | Dev A |
| Wording | Grok text API | Turns the engine's decision (level, concept, instruction) into one spoken line of 20 words or fewer | Dev A |
| Profile summarizer | Grok text API | After each session, turns the turn log into the learner profile and "Your duck has learned" lines | Dev A |
| Rules engine | TypeScript module with Vitest tests | Signals, scores, ladder, brakes, celebration, concept states, leak check, recall schedule | Dev B |
| Concept extraction | pdf-parse plus Grok text API | Slides to concepts, misconceptions, slide tags, trace questions with reference code | Dev B |
| Reference-code runner | Hosted code runner or an isolated worker with a timeout (decide tonight, simplest that works) | Runs reference code to produce trace and prediction answers | Dev B |
| Web app | Next.js (React) on Vercel | Pages and API routes in one project | Designer (UI), Dev B (routes) |
| Database | Tiger Data (Postgres, free tier) | Courses, concepts, sessions, turn log, recall schedule, profiles | Dev B |
| Charts | Recharts | Felt vs owned chart on the results page | Designer |
| Domain | GoDaddy (promo MLHBRH2699) | Public address | Dev A |
| Hardware | Wireless clip-on mic (DJI Mic Mini), Google Home Mini (speaker only), plush duck, power bank | Duck body, ears and voice | Dev A |
| Coding and planning | Cursor (required), GitHub, Grok | All code in Cursor with frequent commits; Grok for task splitting, screenshots saved as evidence | Everyone |

**Changes from the original doc**

- ElevenLabs and Gemini are removed. Grok Voice handles speech and Grok text handles judging, wording and extraction.
- The voice agent no longer calls tools to mark coverage. The duck page sends each finished turn to our server and speaks the line it gets back. That removes the biggest unknown (tool calling in Grok Voice) and keeps every rule in testable code.
- Grok Imagine is not used: the duck is screen-free and the product is conversation.
- Tonight's voice spike must confirm that Grok Voice gives finished-turn transcripts with timing and can speak an exact line. The fallback is in the risks section.

## Roles and ownership

The designer owns the whole frontend. The two devs split along one seam, the `/turn` endpoint: Dev A owns everything on the device side (voice, hardware, and the AI prompts), Dev B owns everything behind it (rules, data, APIs). Pick who is A and who is B by who is more comfortable with real-time audio and prompts (A) versus databases and testable logic (B).

| Role | Owns | Does not touch |
| --- | --- | --- |
| Dev A: Voice, hardware, AI prompts | Grok Voice session, end-of-turn timing, barge-in, filler, silence timers, speaking the approved line, the three AI functions (`judgeTurn`, `wordMove`, `summarizeProfile`), precomputed-question fallback, wrap-up, hardware rig, domain | Database, scoring rules, UI styling |
| Dev B: Rules, data, APIs | Schema, upload and extraction, the rules engine and its unit tests, the reference-code runner, the leak check, all API routes, Illusion Score, recall schedule, learner profile storage and config overrides, the decision log | Voice session, hardware, prompts, UI styling |
| Designer: Frontend | Course and section pages, upload, session screen, results and debrief, "Your duck has learned" panel, recall list, landing page, branding, demo mode | API logic, rules, prompts, hardware |

**How the pieces connect**

- Dev A calls Dev B's `/turn` endpoint with each finished student turn and speaks the line that comes back.
- Dev B's engine calls Dev A's three AI functions. Both sides code against the shared interfaces in the API contract section, so each can work with stubs for the other.
- The designer reads results and profile data from Dev B's endpoints, and listens to session events (listening, thinking, speaking, paused, ended) from Dev A's session client.
- Whoever builds a rule reads the matching section of Angela's spec first, then implements it exactly. Tune numbers in the config, never in logic.
- Anyone blocked for more than 20 minutes says so in the team channel.

## Architecture and data model

&#91;embedded content: system architecture · 9 parts\]

Voice runs between the duck page and Grok Voice. Every finished student turn goes to Dev B's rules engine, which calls Dev A's AI functions for judging and wording, runs reference code for trace answers, and returns one approved line to speak. Everything that must be remembered is stored in Tiger Data.

**Data model (Dev B owns, locked tonight)**

| Table | Key fields |
| --- | --- |
| users | id, name |
| courses | id, user\_id, name |
| sections | id, course\_id, name, type (test or project) |
| documents | id, section\_id, filename, raw\_text, page\_count |
| concepts | id, section\_id, topic, name, slide, kind (explain, trace or predict), misconceptions (list), check\_prompt, fallback\_questions (L1 to L4 text; L4 is the short explanation plus teach-back, for when the AI is down) |
| concept\_secrets (server only) | concept\_id, reference\_code, expected\_answer |
| sessions | id, section\_id, topic, confidence (1 to 5), started\_at, ended\_at, end\_reason |
| concept\_state | session\_id, concept\_id, state, score, level\_reached, moves, failed\_attempts, skipped, celebrated |
| turns (the decision log) | id, session\_id, n, text, started\_at, ended\_at, signals, score\_after, level, move\_kind, line |
| recall | user\_id, concept\_id, state\_after, interval\_days, due\_date, successes |
| learner\_profile | user\_id, calibration, pace, nagginess, teaching\_habits, tone, config\_overrides, duck\_learned (lines with quotes), updated\_at |

**Shared TypeScript interfaces (Dev B writes them tonight in `src/lib/duck/types.ts`; both devs and the designer import them)**

```ts
export type ConceptState = 'not_yet' | 'owned' | 'assisted' | 'explained_to' | 'misconception' | 'skipped';
export type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
export type MoveKind = 'open' | 'confidence' | 'question' | 'rephrase' | 'ack' | 'celebrate' | 'offer_skip' | 'check_in' | 'pause' | 'wrap_up';

// Dev A implements. Returns structure only, never speech. A quote must appear verbatim in the turn text or the item is dropped.
export interface JudgeResult {
  covered: { conceptId: string; quote: string }[];
  missed: { conceptId: string }[];            // only filled when the explanation turn has ended
  misconceptions: { conceptId: string; quote: string }[];
  contradictions: { conceptId: string; quotes: [string, string] }[];
  vague: { conceptId: string; quote: string }[];
}
export declare function judgeTurn(input: { text: string; concepts: ConceptForJudge[]; explanationTurnEnded: boolean }): Promise<JudgeResult>;

// Dev A implements. Returns one spoken line, 20 words or fewer, at most one question mark.
export declare function wordMove(input: { kind: MoveKind; level: Level; conceptName: string; slide?: number; studentWords: string; toneHint?: string }): Promise<string>;

// Dev A implements. Every returned line must carry a student quote from the turn log.
export declare function summarizeProfile(input: { turns: TurnLogRow[]; previous?: Profile }): Promise<Profile>;
```

## API contract

Dev B owns this and locks it tonight. All routes are Next.js API routes under `/api`, JSON in and out, one hardcoded demo user. The designer builds against the mock shapes below until each endpoint is live. Answer values and reference code never appear in any response.

| Method and path | Purpose | Caller |
| --- | --- | --- |
| `GET /api/courses`, `POST /api/courses` | List or create courses | Frontend |
| `POST /api/courses/:id/sections` | Create a section `{name, type: "test" or "project"}` | Frontend |
| `POST /api/sections/:id/upload` | Upload files, parse and extract concepts (async, poll status) | Frontend |
| `GET /api/sections/:id/concepts` | Concept list with misconceptions and slide tags (no answers) | Frontend, Dev A |
| `POST /api/sessions` | Start `{sectionId, topic, confidence}`. Returns the session and the opening move | Frontend, Dev A |
| `POST /api/sessions/:id/turn` | One finished student turn `{text, startedAt, endedAt, silenceBeforeMs}`. Returns the next move | Dev A |
| `POST /api/sessions/:id/silence` | Silence timer fired `{ms: 8000, 20000 or 45000}`. Returns the next move | Dev A |
| `POST /api/sessions/:id/end` | End the session `{reason}`. Computes scores, recall dates and profile update; returns the wrap-up move | Dev A |
| `GET /api/sessions/:id/results` | Debrief data | Frontend |
| `GET /api/profile` | Learner profile and "Your duck has learned" lines | Frontend, Dev A |
| `GET /api/review/due` | Concepts due for recall | Frontend |

The filler line ("Hmm, let me think") is the duck page's job: if `/turn` has not answered after 1.5 s, speak it once.

**Concept (what the client sees)**

```json
{
  "id": "c_12",
  "topic": "Binary search",
  "name": "Sorted input",
  "slide": 4,
  "kind": "explain",
  "misconceptions": ["Binary search works on any list"]
}
```

**Move (the response of `/turn`, `/silence`, `/end` and the opening of `/sessions`)**

```json
{
  "kind": "question",
  "level": "L1",
  "conceptId": "c_12",
  "line": "So I could use it on my pebbles? They're all mixed up.",
  "sessionState": "active",
  "concepts": [{"id": "c_12", "state": "not_yet", "score": 0.3}]
}
```

`sessionState` is `active`, `paused` or `wrapping_up`. The line is already leak-checked and 20 words or fewer. Dev A speaks it as is.

**Results (what the designer's debrief reads)**

```json
{
  "sessionId": "s_88",
  "topic": "Binary search",
  "confidence": 5,
  "understanding": 30,
  "illusionScore": 70,
  "strongestMoment": "You found where it stops.",
  "reviseNext": "The update step",
  "concepts": [
    {"id": "c_12", "name": "Sorted input", "state": "assisted", "levelReached": "L1", "slide": 4, "quotes": ["No, they have to be sorted"]}
  ],
  "duckLearned": ["You skip the update step unless asked (turn 7: \"I think that's fine?\")"],
  "recall": [{"conceptId": "c_12", "due": "2026-10-05"}]
}
```

## Hardware setup

Dev A owns this. Do steps 1 to 3 tonight (about 60 to 90 minutes, both devs if possible) so Saturday starts with a working ears-and-voice rig. Step 4 happens Saturday afternoon. The Home Mini needs a one-time setup over the phone hotspot, so do not leave it for the venue Wi-Fi.

### Parts

Wireless clip-on mic (transmitter plus USB receiver), Google Home Mini (from MLH), plush duck, USB power bank or long cable, phone hotspot, laptop, Google Home app on a phone.

### Steps

1. **Mic to laptop.** Plug the receiver into the laptop, power on and pair the transmitter. Confirm the laptop lists the receiver as an input device in system sound settings and in the browser's mic picker. Speak and watch the input level move.
   - **Checkpoint:** a 10-second browser recording plays back clearly.
   - Per the team, the transmitter only sends audio while it is active or recording, so the web app's Start button is the moment the session begins. Confirm what "active" means on your unit (a button, auto voice detection, or a recording mode) and write the exact steps in the team notes.
2. **Home Mini one-time setup.** Power it up, open the Google Home app on a phone connected to the hotspot, and add the device to your Wi-Fi.
   - **Checkpoint:** the app shows the Mini online.
3. **Home Mini as a Bluetooth speaker only.** In the Google Home app, put the Mini into Bluetooth pairing mode, then pair it from the laptop's Bluetooth settings. Set it as the laptop's output device. Then flip the physical mute switch so "Hey Google" stays off.
   - **Checkpoint:** laptop audio plays out of the Mini, and it stays paired with the mute switch on. Test this before moving on: if pairing drops with mute on, pair first, then mute, and note the order.
4. **Rig inside the duck (Saturday afternoon).** Put the Mini inside the duck with the power bank or cable routed out the back. Clip the mic inside the duck or on its chest, as far from the Mini as the plush allows.
   - **Checkpoint:** a full spoken exchange with the duck sealed up, with no feedback and no clipping.

### Known risks

- **Echo.** The mic hears the Mini and the duck hears itself. Mitigate with distance, browser echo cancellation, and a lower speaker volume. Fallback: mic worn on the user's collar instead of inside the duck.
- **Bluetooth latency.** Expect a fraction of a second extra on the duck's voice. Test early and have the duck use short sentences.
- **Battery.** Charge the transmitter and power bank before Saturday 9am and again Saturday night.
- **Venue Wi-Fi.** Keep the phone hotspot as the backup for the demo.

## Tonight (Friday)

Goal: walk in at 9am with accounts working, the hardware talking to the laptop, the voice question answered, and the schema and types agreed. Do not start building features. Task IDs continue into Saturday's lists (A3 follows A2, B5 follows B4, D2 follows D1).

**Everyone (about 45 minutes, both devs together)**

- [ ] **ALL1 · Repo and deploy.** Create the GitHub repo, open it in Cursor, create the Next.js project, and deploy an empty page to Vercel. *Done when:* both devs can push and the Vercel URL loads.
- [ ] **ALL2 · Keys and database.** Get the xAI key and confirm credits, create the Tiger Data database, claim the GoDaddy domain and point it at Vercel. Keys go in Vercel and `.env.local`, never in git. *Done when:* a test Grok text call and a test database query both work from the deployed app.
- [ ] **ALL3 · Team setup.** Make a team channel and shared notes. Use Grok to plan and split tasks and save screenshots (track bonus). Agree to commit at least hourly. Each person reads the parts of Angela's spec that match their tasks.

**Dev A (about 90 minutes)**

- [ ] **A1 · Hardware bring-up (hardware steps 1 to 3).** Plug in the DJI Mic Mini receiver and confirm the laptop sees it as an input; the Mic Mini is built for smartphones, so check the receiver's connector fits the laptop (USB-C or an adapter) before anything else. Set up the Home Mini over the phone hotspot, pair it as a Bluetooth speaker, then flip the mute switch. *Done when:* a 10-second recording from the mic plays back clearly, laptop audio comes out of the Mini, and it stays paired with the mute switch on. Write down what "active" means for the transmitter on your unit.
- [ ] **A2 · Grok Voice spike, four checks.** Build a throwaway page and answer yes or no to each: (a) do we get a finished-turn transcript with start and end times? (b) can we make it speak an exact line without improvising? (c) does talking over it stop the audio quickly? (d) does it have built-in turn detection, and can we tune the silence? *Done when:* all four are written in the team notes. If (b) is no, tell Dev B tonight so the fallback in the risks section is chosen.

**Dev B (about 2 hours)**

- [ ] **B1 · Config and types.** Create `src/lib/duck/config.ts` by pasting the `DUCK` object from the spec, and `src/lib/duck/types.ts` from the interfaces in this doc. *Done when:* committed, and Dev A and the designer can import them.
- [ ] **B2 · Schema.** Create the tables from the data model on Tiger Data. *Done when:* the migration runs clean on an empty database.
- [ ] **B3 · API stubs.** Every route in the API contract returns the mock shapes and is deployed. *Done when:* the designer can fetch each route from the Vercel URL.
- [ ] **B4 · Extraction spike (only if time is left).** Upload a PDF, extract text with pdf-parse, send it to Grok, and get back a concept list with slide tags. *Done when:* one real slide deck produces a sensible list.

**Designer (about 30 minutes)**

- [ ] **D1 · Read and plan.** Read this doc and Angela's spec section 4 (concept states and colours). Pick the duck's name and look, list the screens, and set up the pages folder. *Done when:* a screen list and a first colour and type direction are in the team notes.

## Timeline

&#91;embedded content: build timeline · 6 phases, 4 milestones\]

The diamond at 4am Sunday is the feature freeze: after it, only bug fixes, rehearsal and the submission. Run a 10-minute team check-in at 1pm, 6pm, 11pm and 3am Sunday. At each one, confirm what ships and cut from the cut list if a phase is behind.

**Sleep.** Plan shifts so at least one dev is fresh for the Sunday 4am to 8am stretch. Whoever is not on the demo rehearsal should record the backup video.

## Task lists

Each task has an ID (A for Dev A, B for Dev B, D for the designer), a time slot, and a *Done when* line, so you always know what to do next and when it counts as finished. Tonight's tasks (A1, A2, B1 to B4, D1) are in the Tonight section above. Tick the boxes as you go; the doc is shared, so everyone sees progress. If a task runs 30 minutes over, say so in the channel and cut from the cut list.

- [ ] **ALL4 · 9:00 to 9:30am · Kickoff (everyone).** Walk through the worked example in Angela's spec, confirm who is Dev A and Dev B, hear Dev A's voice-spike answers and choose the fallback if needed, and confirm the API contract. *Done when:* roles are set, the voice approach is decided, and everyone knows their first task.

### Dev A: Voice, hardware, AI prompts

**Phase 1 (9:30am to 1pm): walking skeleton**

- [ ] **A3 · 9:30 to 10:30 · Session client skeleton.** The Start button on the duck page activates the mic and opens the Grok Voice session. Show a live transcript with timestamps in a debug panel. *Needs:* A1 and A2 results. *Done when:* you speak and see your words appear on the page.
- [ ] **A4 · 10:30 to 12:00 · Turn loop v1.** Detect the end of a turn (the platform's detection if it has one, otherwise 1.2 s of silence, and up to 3.0 s when the last word is "and", "so", "because", "like", "um" or "uh"). Send the finished turn to `POST /turn` (Dev B's stubs from B3 are already live) and speak the line that comes back. *Needs:* B3. *Done when:* you say a sentence and hear the stub's line from the Mini.
- [ ] **A5 · 12:00 to 1:00 · Barge-in, filler, silence timers.** Stop speaking within 300 ms when the student talks. Say "Hmm, let me think" once if `/turn` takes over 1.5 s. Call `/silence` at 8, 20 and 45 s and honour `paused`. *Done when:* the spec's barge-in test (10 times) and the pause-after-"and" test (2 s) pass by hand.

**Phase 2 (1pm to 6pm): AI layer and the duck's body**

- [ ] **A6 · 1:00 to 2:30 · `judgeTurn`.** Write the prompt and the quote check: any item whose quote is not verbatim in the turn text is dropped. Test on the worked example's turns plus three more transcripts. *Done when:* the example turns return the structure the spec's signal table implies, with no item missing a quote.
- [ ] **A7 · 2:30 to 3:30 · `wordMove`.** One prompt per level (the spec says what each level may do), reusing the student's own words. Reject lines over 20 words or with more than one question and retry once; then fall back to the precomputed line. *Needs:* Dev B's `fallback_questions` (B8). *Done when:* every level produces a valid line for the worked example, and L1 to L3 never state the answer.
- [ ] **A8 · 3:30 to 5:00 · Rig the duck (hardware step 4).** Put the Mini and mic inside the duck, route the power cable out the back, and test echo and latency with it sealed. If the duck hears itself, lower the volume or move the mic. *Done when:* a full spoken exchange with the sealed duck has no feedback.
- [ ] **A9 · 5:00 to 6:00 · First end-to-end run.** Switch from Dev B's stub to the real `/turn` and replay the spec's binary search session with the sealed duck. Log every mismatch and send it to Dev B. *Done when:* the session runs from Start to a spoken reply on every turn and a bug list exists. Milestone: duck rigged and sealed.

**Phase 3 (6pm to 11pm): fallback and adaptability**

- [ ] **A10 · 6:00 to 7:30 · Fallback mode.** If the AI call fails or times out, switch to precomputed questions so the session continues. *Needs:* B8. *Done when:* with the AI switched off, a session still runs.
- [ ] **A11 · 7:30 to 9:00 · `summarizeProfile`.** Input: the turn log. Output: the profile fields (calibration, pace, nagginess, teaching habits, tone) and the "Your duck has learned" lines, each with a student quote. Agree field names with Dev B by 7:30 (B13 stores them). *Done when:* two different fake turn logs produce visibly different profiles.
- [ ] **A12 · 9:00 to 10:00 · Wrap-up and tone.** Speak the wrap-up line from `/end`, and the proposal to wrap up at 8 minutes or 6 concepts (code decides, you speak). Pass the profile's tone hint to `wordMove`. *Done when:* a session ends with a spoken wrap-up and the duck's wording changes between two profiles.
- [ ] **A13 · 10:00 to 11:00 · Spec tests by voice.** Try to get the duck to say a stored trace answer before you commit to one (leak test), barge in 10 times, pause 2 s after "and". Tune timings with Dev B in the config only. *Done when:* all voice tests in the spec pass.

**Phase 4 (11pm to 4am): harden, then freeze**

- [ ] **A14 · 11:00pm to 1:00am · Reliability.** Reconnect if the voice session drops, recover from a mic unplug, tune volume and pace, and add a push-to-talk button as a backup. *Done when:* unplugging and replugging the receiver recovers without a page reload.
- [ ] **A15 · 1:00 to 3:00am · Dry runs.** Three full demo runs with the sealed duck on the phone hotspot. Charge the transmitter and power bank. *Done when:* three clean runs in a row.
- [ ] **A16 · 3:00 to 4:00am · Backup video and freeze.** Record a clean session as the backup demo and save it in two places. *Done when:* the video is saved. Feature freeze at 4:00.

**Phase 5 (4am to 8am)**

- [ ] **A17 · 4:00 to 8:00am · Rehearse and submit.** Rehearse the demo three times, collect Grok Voice and Cursor screenshots for the submission, and give the duck a final charge and check.

### Dev B: Rules, data, APIs

**Phase 1 (9:30am to 1pm): seed data and rules engine v1**

- [ ] **B5 · 9:30 to 10:15 · Seed the demo course by hand.** Binary search with 5 concepts (sorted input, halving, when it stops, the update step, O(log n)), the misconception on the update step ("lo = mid is fine"), the trace question (list 1, 3, 5, 7, 9, target 6, reference code, expected answer), and fallback lines for L1 to L4 per concept, all taken from the spec's worked example. *Done when:* the seed loads into the database and `GET /concepts` returns it without any answers.
- [ ] **B6 · 10:15 to 11:30 · Signals and score (pure TypeScript, no I/O).** Code-detected signals ("I don't know" phrases, hedging count, filler rate, "move on" and "can you explain it" phrases) and the score update: signals add, cap at 1, each signal counts once per turn, success resets to 0, judge items without a quote are ignored. Read the config only from `DUCK`. *Done when:* Vitest tests cover every signal, the cap and the reset.
- [ ] **B7 · 11:30 to 1:00 · Ladder, states and the first real `/turn`.** Map score bands to levels L0 to L4 (a request for help starts at L3, misconceptions start at L1, L4 needs at least one attempt and ends with teach-back, at most 3 moves per concept), track concept states, and make exactly one move per turn. Wire this into `/turn` with the judge stubbed to an empty result and the wording stubbed to the seed's fallback line. *Done when:* tests for every band pass, and a scripted `/turn` call gives the right level for each turn of the worked example.

**Phase 2 (1pm to 6pm): extraction, brakes, trace questions**

- [ ] **B8 · 1:00 to 2:30 · Real upload and extraction.** pdf-parse (keep page numbers) then Grok: per topic the concepts, misconceptions, slide tags, concept kind, a trace or prediction question with reference code and expected answer where it fits, and fallback lines for L1 to L4 (L4 is a two-sentence explanation ending in a teach-back question). Store the reference code and answer only in `concept_secrets`. *Done when:* the binary search slides produce a list close to the seed, and a bad PDF returns a clear error.
- [ ] **B9 · 2:30 to 4:00 · Brakes and celebration.** "Move on" skips a concept for the session, two skips trigger the keep-going check, two duck questions in a row trigger "What's the next piece of it?", silence at 8 s rephrases, 20 s offers a skip, 45 s pauses, a session proposes wrap-up at 8 minutes or 6 concepts, and celebration follows the spec's table (only when earned, once per concept, neutral after L4). Tell Dev A the 1.5 s pause after a success. *Done when:* Vitest tests cover each brake and each celebration row.
- [ ] **B10 · 4:00 to 5:30 · Code runner and leak check.** Run the reference code to get the expected answer (or precompute it at extraction if the runner is slow), compare it with the student's committed answer (a wrong one adds 0.3), and block any duck line that contains a stored answer value until the student has committed. *Done when:* the "5 and 7" leak case from the worked example is blocked and tested, and a wrong trace raises the score by 0.3.

**Phase 3 (6pm to 11pm): orchestration, results, adaptability**

- [ ] **B11 · 6:00 to 7:30 · Full `/turn` orchestration.** Signals from code, then `judgeTurn`, the engine, `wordMove`, and the leak check, with a time limit on each Grok call; on a timeout, evaluate with code-only signals and use the precomputed line. Write one `turns` row per decision (signals, score, level, line). *Needs:* A6 and A7. *Done when:* the worked example runs through the real functions with a row logged per turn.
- [ ] **B12 · 7:30 to 9:00 · End of session, Illusion Score, recall.** On `/end`, compute states, understanding (Owned counts 1, Assisted counts 0.5), the Illusion Score, the strongest moment and the one concept to revisit, and the recall dates (1 day for Misconception, Explained to or Skipped; 2 for Assisted; 4 for Owned; doubling per successful recall up to 30 days; a failed recall resets to 1). Serve `GET /results` and `GET /review/due`. *Done when:* the results shape in the API contract is returned with real data.
- [ ] **B13 · 9:00 to 10:30 · Learner profile and config overrides.** Store the profile from `summarizeProfile` (field names agreed with Dev A by 7:30), apply bounded per-user overrides to the config at session start (about 25% from the default), and return the "Your duck has learned" lines with their quotes. *Needs:* A11. *Done when:* two users with different profiles get different thresholds in a test.
- [ ] **B14 · 10:30 to 11:00 · Decision log view.** A simple page or endpoint that lists every turn with signals, score, level and line, for the debrief and for tuning. *Done when:* a finished session can be read back turn by turn.

**Phase 4 (11pm to 4am): prove it, seed it, harden it**

- [ ] **B15 · 11:00pm to 12:30am · Worked-example replay and spec tests.** Script the spec's whole binary search session as an automated test with the judge returning the expected structure, and run the spec's pre-demo test list (scoring, ladder, brakes, leak, AI-off fallback). *Done when:* every level and duck line category matches the worked example and all tests are green.
- [ ] **B16 · 12:30 to 2:00am · Demo data.** Seed two or three users with session histories and a second demo course so the profile, recall list and results look real. *Done when:* the demo user's pages are full of believable data.
- [ ] **B17 · 2:00 to 3:30am · Hardening.** Timeouts and error handling on every route, cached extraction results, database indexes, and a guard against empty or oversized uploads. *Done when:* a failed Grok call never crashes a session.
- [ ] **B18 · 3:30 to 4:00am · Freeze.** Tag the release, deploy it, and take a database backup. *Done when:* the tagged build is what the domain serves.

**Phase 5 (4am to 8am)**

- [ ] **B19 · 4:00 to 8:00am · Write-up and rehearse.** Write the submission text (problem, solution, architecture, Cursor use, Grok use) and rehearse the demo three times.
- [ ] **B20 · Stretch only · Invitations.** Laptop notification when concepts are due, with the spec's limits (1 invite per 4 hours, 2 per day, none within 30 minutes of an upload, 24 hours of quiet after a dismissal). Only if everything above is done and tested.

### Designer: Frontend

Build every page against the mock JSON first (Dev B's stubs are live tonight), then swap to real endpoints page by page.

**Phase 1 (9:30am to 1pm): the setup screens**

- [ ] **D2 · 9:30 to 11:00 · Courses and sections.** Course list with a create button, and a course page listing its sections with a *test* or *project* badge and a create button. *Done when:* you can create a course and a section on the stub API and see them listed.
- [ ] **D3 · 11:00 to 12:30 · Upload page.** A file drop for slides, notes or code, progress while extraction runs, then the concept list with slide tags and misconceptions. *Done when:* uploading the demo PDF shows the seed concepts.
- [ ] **D4 · 12:30 to 2:00 · Start and session screen.** Topic picker and a Start button, then a calm session page that says "Close your laptop and pick up the duck", with status chips (Listening, Thinking, Speaking, Paused), an End button and a debug transcript toggle. Agree event names with Dev A by 12:30 (`listening`, `thinking`, `speaking`, `paused`, `ended`). *Done when:* a dev-only panel that fires each event changes the chips correctly.

**Phase 2 (2pm to 6pm): the debrief, where the pitch lands**

- [ ] **D5 · 2:00 to 4:30 · Results page.** Concept cards coloured by state exactly as in the spec (grey, green, yellow, red), each showing the student's own quote, the help level reached and the slide number; the strongest moment and the concept to revisit; and a felt-vs-owned chart per topic (Recharts) with the Illusion Score. *Done when:* the mock results render every state colour and the chart.
- [ ] **D6 · 4:30 to 6:00 · Recall list and "Your duck has learned".** A list of concepts due with their dates ("3 concepts ready to talk about with the duck"), and a panel with each learned line and its quote underneath. *Done when:* both render from mock data.

**Phase 3 (6pm to 11pm): polish and real data**

- [ ] **D7 · 6:00 to 8:00 · Landing page and branding.** The one-line hook, a duck illustration or mascot, the name, colours and type used consistently across all pages. *Done when:* the landing page is deployed on the domain.
- [ ] **D8 · 8:00 to 10:00 · Real endpoints.** Swap the mocks for the real endpoints: courses, sections, upload and concepts first; results and profile when Dev B's B12 and B13 land. *Done when:* the first three pages work with no mocks.
- [ ] **D9 · 10:00 to 11:00 · Live session status.** Make the session page's chips follow Dev A's real events. *Needs:* A4 and A5. *Done when:* a real session shows Listening, Thinking and Speaking at the right moments.

**Phase 4 (11pm to 4am): harden and add the safety net**

- [ ] **D10 · 11:00pm to 2:00am · Real results, states and phone layout.** Results and profile on real data, with loading, empty and error states, checked on a phone. *Done when:* a full session from Start to debrief works end to end with no console errors.
- [ ] **D11 · 2:00 to 3:30am · Demo mode.** A hidden toggle that replays a recorded session's moves and results without any audio, as the fallback if voice fails on stage. *Done when:* demo mode runs the debrief with the microphone unplugged.
- [ ] **D12 · 3:30 to 4:00am · Final pass and freeze.** Check every page on a fresh laptop and a phone. *Done when:* nothing is broken on the deployed domain.

**Phase 5 (4am to 8am)**

- [ ] **D13 · 4:00 to 8:00am · Submission visuals.** Screenshots of each page, a short screen recording of the web flow, and the architecture diagram from this doc as an image. Help rehearse the demo.

### Handoffs and shared checkpoints

These are the moments one person's work unblocks another's. If you are late on one of them, say so right away.

| What | From | To | Needed by |
| --- | --- | --- | --- |
| Config object, shared types, mock JSON, deployed API stubs (B1 to B3) | Dev B | Dev A, Designer | Tonight |
| Voice spike answers and the speak-exact-line decision (A2) | Dev A | Dev B | Tonight |
| Seed course loaded (B5) | Dev B | Everyone | Sat 10:15am |
| Session event names: listening, thinking, speaking, paused, ended | Dev A | Designer | Sat 12:30pm |
| `judgeTurn` and `wordMove` working (A6, A7) | Dev A | Dev B | Sat 3:30pm |
| Real engine with trace and leak check (B7 to B10) | Dev B | Dev A | Sat 5:00pm |
| Duck rigged and sealed (A8) | Dev A | Everyone | Sat 5:00pm |
| Profile field names agreed (A11, B13) | Dev A and Dev B | Each other | Sat 7:30pm |
| Results, review and profile endpoints real (B12, B13) | Dev B | Designer | Sat 9:00pm |
| Feature freeze | Everyone | Everyone | Sun 4:00am |

- [ ] **ALL5 · 11:00pm to 12:00am · Tune with real people.** Follow the spec's tuning plan: five other hackers, five minutes each. Count interruptions (any is a bug), ask "Did it feel naggy?" and "Did it let you off too easy?", and change only numbers in the config. *Done when:* the config is updated and you have a short list of what you changed and why.
- [ ] **ALL6 · Check-ins.** 10 minutes at 1pm, 6pm, 11pm and 3am. Confirm what ships, cut from the cut list if a phase is behind, and plan sleep so one person is fresh for Sunday 4am to 8am.

## Risks, fallbacks and cut list

The biggest risks are the live voice loop and speed: a judge call plus a wording call must fit inside a natural pause. If a risk is still open 90 minutes after it appears, switch to its fallback.

| Risk | Likelihood | Fallback |
| --- | --- | --- |
| Grok Voice cannot speak an exact line | Medium | Pass the approved line as a strict "say exactly this" instruction each turn, and keep stored answers out of every prompt until the student commits, so a leak is impossible even if it improvises |
| No finished-turn transcript or timing from Grok Voice | Medium | Run our own silence timer on the transcript stream (1.2 s, and 3.0 s after an unfinished-thought word) |
| Judge plus wording is slower than 1.5 s | Medium | One judge call per turn, short prompts, the filler line once, and a code-only evaluation with a precomputed line when a call times out |
| Judge returns unquoted or invented items | Medium | The quote check drops anything not verbatim in the turn text; code decides every score and level |
| Reference-code runner unavailable or slow | Medium | Compute the expected answers at extraction time and store them, so the runner is only a check |
| The duck feels naggy or too easy | High | Tune numbers in the config only, using the spec's tuning plan (ALL5) |
| Echo from the speaker inside the duck | High | Mic on the user's collar, lower volume, browser echo cancellation |
| Mic only transmits when active, or receiver does not fit the laptop | Known | Start button begins the session; test the connector and adapter in A1 |
| Home Mini drops Bluetooth with mute on | Medium | Pair first, then mute. Backup: any other Bluetooth speaker inside the duck |
| PDF extraction misses slide text | Medium | Seeded demo course; demo extraction on a clean PDF only |
| Venue Wi-Fi unreliable | Medium | Phone hotspot, plus the backup demo video |
| Integration slips past midnight | Medium | Types, config and API contract frozen tonight; designer works on mocks; stubs stay live |

**Cut list, in order (cut from the top first)**

1. Invitations (B20) and the Pico W eyes and head tilt.
2. The "duck knows the basics" opening variant and anything beyond a basic *project* section.
3. Per-user config overrides: keep the profile and the "Your duck has learned" lines, and apply only the tone hint to the wording.
4. Recall doubling beyond the first recall (keep the 1, 2 and 4 day starting intervals).
5. Landing page polish and extra animations.

**Never cut:** the rules engine with its ladder and brakes, the leak check, the confidence question and Illusion Score, the debrief with state colours, and the quote-backed "Your duck has learned" panel. These are the pitch.

## Demo script and submission

Target demo length: about 3 minutes, built on the spec's binary search example so every beat is something the rules engine really does. Rehearse it at least three times with the sealed duck before Sunday 8am.

**Demo flow**

1. **Hook (20s).** "AI makes you feel like you understand. The duck shows you whether you actually do."
2. **Setup (30s).** Show a course with the uploaded binary search slides and the extracted concept list. Press Start and answer the confidence question (for example, 4 out of 5).
3. **The duck (80s).** Close the laptop and pick up the duck. A judge explains binary search but leaves out that the list must be sorted, and the duck asks about its pebbles (L1). Then the duck asks for a trace on 1, 3, 5, 7, 9 looking for 6. A wrong answer gets a pointer to the slide (L2), not the answer. The fix earns one real celebration.
4. **The gap (30s).** Open the debrief: felt 4 out of 5, owned 1 of 5 concepts, concept cards in grey, green, yellow and red, each with the student's own words and the slide number.
5. **Adaptability (30s).** Show "Your duck has learned" with its quotes, then a second session where the duck waits longer after pauses or words things differently because of the profile.
6. **Close (10s).** Show the recall list ("3 concepts ready to talk about with the duck") and repeat the one-line pitch.

**Submission checklist**

- [ ] Public site on the GoDaddy domain, tested on a phone and a fresh laptop.
- [ ] Public GitHub repo with a clear README and Cursor-made commit history.
- [ ] Cursor usage evidence: screenshots of agent use, rules files and plans.
- [ ] Grok usage evidence: Grok Voice in the product, Grok text for judging and wording, and Grok for team planning (screenshots).
- [ ] Screenshot of the passing unit tests and the worked-example replay, showing the rules are real code.
- [ ] Backup demo video (about 2 minutes), recorded before 6am Sunday.
- [ ] Submission text with the problem, solution, architecture and what is next.
- [ ] Submit to the SpaceX track, Tiger Data, GoDaddy and the main track, and enter the raffle for the Cursor water bottle.
- [ ] Charge the transmitter, power bank and phone. Pack the duck, receiver, cables and the hotspot phone.

## Open questions

- [ ] **Confidence and Illusion Score.** The spec never asks the student how sure they are. We add one confidence question per topic at the start (its own duck turn) and define understanding as Owned plus half of Assisted. Does Angela agree this fits the spec?
- [ ] **Who is Dev A and who is Dev B?** Decide at kickoff by who is more comfortable with audio and prompts (A) versus databases and testable logic (B).
- [ ] **Can Grok Voice speak an exact line and give finished-turn transcripts with timing?** Dev A answers tonight in A2; the risks section has the fallbacks.
- [ ] **DJI Mic Mini receiver:** does its connector fit the laptop, and what exactly makes the transmitter "active"? Answer in A1 and write it in the notes for the demo.
- [ ] **Does the Home Mini keep its Bluetooth pairing with the mute switch on?** Test in A1.
- [ ] **Reference-code runner:** hosted runner, isolated worker, or precomputed answers only? Dev B picks tonight or at 4:00pm Saturday at the latest.
- [ ] **Per-user config overrides:** is about 25% from the default a safe bound for adaptability? Tune after the ALL5 session.
- [ ] **Stretch scope:** are invitations (laptop notifications), the "duck knows the basics" opening and a basic *project* section all fine to leave until the core is done?
- [ ] **Name and look of the duck,** for the designer.

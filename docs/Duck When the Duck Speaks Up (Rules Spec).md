# Duck: When the Duck Speaks Up (Rules Spec)

Oct 2, 2026 · @Angela

## Purpose and core principle

The duck speaks only when simple, measurable rules say the moment is right; the AI only chooses the words. This spec defines those rules so the duck feels like a patient listener, not a quiz machine.

The design borrows from [Burrow](https://github.com/jerryjlwang/Burrow) (HackMIT 2026 Education winner), whose proactive engine scores cheap local signals, escalates gently, and backs off when told to.

**Scope:** a session is the student explaining an uploaded topic (for example, binary search slides) to the duck out loud. Section 7 covers when the duck invites a session.

**Principles**

1. **Evidence before action.** Code-measured signals decide when the duck acts; the AI never decides that on a hunch.
2. **Never interrupt.** The duck reacts only after the student finishes a thought.
3. **Escalate gently.** A curious question first, a full explanation last.
4. **The student teaches.** The duck asks; it explains only as a last resort, then asks the student to restate it.
5. **Respect "move on".** A skipped concept is dropped for the session and scheduled for later.
6. **Praise only what was earned.** Specific, rare, never reflexive.
7. **Checked answers come from code.** Trace and prediction answers come from running reference code, never from the AI.

## Turn-taking

The duck waits for a real end of turn, evaluates the rules once, then makes exactly one move. Use the voice platform's built-in turn detection if it has one; the numbers below are the fallback and the tuning targets.

| Rule | Setting |
| --- | --- |
| End of turn | 1.2 s of silence after speech |
| Unfinished thought | Last word is "and", "so", "because", "like", "um" or "uh": wait up to 3.0 s instead |
| Barge-in | Student starts talking while the duck talks: duck stops within 300 ms and listens |
| One move per turn | At most one question; spoken line of 20 words or fewer |
| Long student turn | No interruption, however long; evaluate only when it ends |
| Filler while thinking | If evaluation takes over 1.5 s, the duck says a short filler ("Hmm, let me think") once |

Signals are scored only on finished turns. A concept the student has not mentioned yet is "not yet", never "missed", until their explanation turn ends.

&#91;embedded content: turn-taking loop · 6 steps, 1 decision\]

Code owns every step except the duck's wording, and the leak check runs before anything is spoken.

## Signals

Each concept from the slides keeps its own struggle score from 0 to 1. Signals add up across turns, capped at 1, so a second wrong trace climbs higher than the first.

| Signal | How it is detected | Adds to score |
| --- | --- | --- |
| "I don't know" | Phrases like "no idea", "I don't know", "not sure at all" | 0.45 |
| Wrong prediction or trace | Student's answer differs from the reference code's output | 0.3 each time |
| Misconception stated | Judge matches a known misconception from the slides and quotes the student | 0.3 |
| Concept missed | Explanation turn ended without it, per the coverage judge | 0.3 |
| Self-contradiction | Judge flags two statements that conflict, with both quotes | 0.3 |
| Long silence after a question | No speech for 8 s | 0.25 |
| Vague answer | Judge rates the explanation as non-specific ("it just works") | 0.25 |
| Hedging | 2 or more of "I think", "maybe", "kind of", "or something" in one turn on the concept | 0.15 |
| Heavy fillers | More than 1 "um" or "uh" per 8 words in the turn | 0.1 |

**Rules that keep the evidence fair**

- **Quote or it doesn't count.** Any judge-based signal must include the student's exact words. No quote, no signal.
- **Once per turn.** Each signal counts at most once per student turn.
- **Success resets.** A correct prediction or an unaided explanation resets that concept's score to 0.
- **Asking for help is not a struggle signal.** "Can you explain it?" is a request; handle it with the ladder in section 4.

## Concept states and the help ladder

The score picks how much help the duck gives, from a curious question up to a short explanation. Help only climbs within a concept, one level per failed attempt, and resets when the concept is resolved or skipped.

**Concept states**

| State | Meaning | Shown in debrief as |
| --- | --- | --- |
| Not yet | Not discussed so far | Grey |
| Owned | Explained or predicted correctly with no help | Green |
| Assisted | Got there after help at level 1 to 3 | Yellow |
| Explained to | Needed level 4 | Red |
| Misconception | Stated a wrong belief and did not resolve it | Red |
| Skipped | Student chose to move on | Grey, scheduled for recall |

**Help ladder**

| Level | Trigger | What the duck does | Example (binary search) |
| --- | --- | --- | --- |
| L0 Listen | Score under 0.25 | No comment on the concept; move to the next one | (moves on) |
| L1 Curious question | 0.25 to 0.45 | A naive question that tests the gap without naming it | "So I could use it on my pebbles? They're all mixed up." |
| L2 Point to the source | 0.45 to 0.6 | Names the slide, not the answer | "Slide 4 says something about order. What does it say?" |
| L3 Smaller case | 0.6 to 0.8, or the student asks for help | A tiny example with different values | "Try it with just 2, 5, 9, looking for 9." |
| L4 Explain, then teach back | 0.8 or more, or 3 failed attempts | Explains in 2 sentences or fewer, then asks the student to restate it | "It only works on sorted lists, because… Can you say why in your words?" |

**Ladder rules**

- **Misconceptions start at L1,** with a question that tests the student's own belief, as Burrow's misconception nudges do.
- **A request for help starts at L3,** never L4. L4 needs at least one attempt first.
- **L4 always ends with teach-back.** The concept is never closed on the duck's explanation alone.
- **At most 3 duck moves per concept,** then the duck offers to move on.

## Brakes

The brakes keep the duck from turning into an interrogation. They override every level in section 4.

| Brake | Rule |
| --- | --- |
| Move on | "Let's move on" or "skip": concept becomes Skipped, is not raised again this session, and is scheduled for recall |
| Two skips | After 2 skips in one session, the duck asks once: "Keep going or wrap up?" |
| Question streak | After 2 back-to-back duck questions, the next move is an open prompt: "What's the next piece of it?" |
| Silence, 8 s | Rephrase the question once, at the same level |
| Silence, 20 s | "Want to skip this one?" |
| Silence, 45 s | Pause the session: "I'll be here when you're ready." |
| Session length | At 8 minutes or 6 concepts, the duck proposes wrapping up; it never extends unasked |
| AI unavailable | Use precomputed questions from the slide analysis; never improvise answers |

**Never**

- Speak while the student is speaking.
- Say a trace or prediction answer before the student commits to one. Code checks every duck line for the stored answer value before it is spoken.
- Ask more than one question in a turn.
- Explain first, below L4.
- Read slides aloud beyond one sentence.
- Praise reflexively ("Great job!" after every answer).

## Celebration and feedback

Praise is rare and specific, so it means something. It follows Burrow's rule: celebrate only success that was earned.

| Moment | Duck response |
| --- | --- |
| Resolved a concept after struggling (score reached 0.45 or more) | Real celebration, naming what they did: "Ooh, you caught the infinite loop." |
| Caught a misconception or bug on their own | Real celebration |
| Correct, unaided, no struggle | Short acknowledgment ("Got it") and move on |
| Correct only after L4 | Neutral: "Okay, that makes sense now." No celebration |
| Vague or partly right | No praise; the ladder continues |

- **Once per concept.** No second celebration for the same concept.
- **Steer after success.** Wait until the duck's audio ends plus 1.5 s, then move to the next concept. A success is the best moment to move forward.
- **Wrap-up.** One spoken sentence: the strongest moment and the one concept to revisit. The full results go to the on-screen debrief.

## Outside a session: invitations

Outside a session the duck never speaks; it invites with a quiet laptop notification. A speaker that talks into a room unprompted is the fastest way to get unplugged.

**When a concept is due for recall**

| Concept state after a session | First recall |
| --- | --- |
| Misconception, Explained to, or Skipped | 1 day |
| Assisted | 2 days |
| Owned | 4 days |

Each successful recall doubles the interval, up to 30 days, following Burrow's rule that stability doubles per successful recall. A failed recall resets it to 1 day.

**Invitation rules**

- Notification text: "3 concepts ready to talk about with the duck."
- At most 1 invitation every 4 hours and 2 per day.
- After a new upload, invite once, not before 30 minutes have passed.
- A dismissed invitation means no new one for 24 hours.
- Quiet hours are set by the student; none by default, since students study late.

## Config and AI rules

All thresholds live in one config object so the team can tune them after testing without touching logic.

```ts
export const DUCK = {
  // turn-taking (section 2)
  endOfTurnSilenceMs: 1_200,
  unfinishedThoughtWaitMs: 3_000,
  bargeInStopMs: 300,
  fillerAfterMs: 1_500,
  maxDuckWords: 20,

  // signal weights (section 3)
  weights: {
    dontKnow: 0.45, wrongTrace: 0.3, misconception: 0.3,
    conceptMissed: 0.3, contradiction: 0.3,
    silence: 0.25, vague: 0.25, hedging: 0.15, fillers: 0.1,
  },
  hedgingMinPerTurn: 2,
  fillerWordsPerUm: 8,

  // help ladder (section 4)
  levels: { L1: 0.25, L2: 0.45, L3: 0.6, L4: 0.8 },
  maxMovesPerConcept: 3,
  failedAttemptsForL4: 3,

  // brakes (section 5)
  silenceRephraseMs: 8_000,
  silenceOfferSkipMs: 20_000,
  silencePauseMs: 45_000,
  maxQuestionStreak: 2,
  skipsBeforeCheckIn: 2,
  sessionMaxMs: 8 * 60_000,
  sessionMaxConcepts: 6,

  // celebration (section 6)
  earnedScore: 0.45,
  afterCelebrationMs: 1_500,

  // invitations (section 7)
  recallFirstDays: { misconception: 1, explainedTo: 1, skipped: 1, assisted: 2, owned: 4 },
  recallMaxDays: 30,
  inviteGapMs: 4 * 3_600_000,
  invitesPerDay: 2,
  afterUploadMs: 30 * 60_000,
  dismissedInviteMs: 24 * 3_600_000,
};
```

**Who decides what**

| Decision | Made by |
| --- | --- |
| When the student's turn ended | Code (silence timer and turn detection) |
| Which signals fired | Code, plus judge results that carry a quote |
| Score, level, brakes, celebration | Code |
| Trace and prediction answers | Reference code, run in a sandbox |
| The duck's exact words | AI, under the rules below |

**Rules in the AI's prompt**

- You are a curious duck who has read the slides but pretends not to understand. The student is teaching you.
- You are on level {L}: {that level's instruction}. This is a hard limit.
- One question at most, 20 words or fewer. Use the student's own words where you can.
- Never state the answer to a trace or prediction. Never explain unless the level is L4.
- **The judge returns structure, not speech:** concept ids covered, missing or wrong, each with the student's exact quote. Its words never reach the student, as in Burrow's step judge.

## Worked example: binary search

One session traced through the rules, so the team can check the build against it. Jordan uploaded binary search slides; the analysis found 5 concepts: sorted input, halving, when it stops, the update step (`lo = mid + 1`), and O(log n).

The trace question uses the list 1, 3, 5, 7, 9 and target 6, with `mid = (lo + hi) // 2`. The reference code checks 5, then 7, then stops: 6 is not in the list.

| Turn | Jordan says | Signals and score | Level | Duck says |
| --- | --- | --- | --- | --- |
| 1 | "I want to talk about binary search." | Session opens | — | "Ooh! Can you explain it to me? I'm just a duck." |
| 2 | "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving." | Halving: Owned. Sorted input: missed, 0.3 | L1 | "So I could use it on my pebbles? They're all mixed up." |
| 3 | "No, they have to be sorted, or you could throw away the half with the target." | Sorted input: Assisted, score reset. Not earned (0.3) | — | "Got it. Test me: 1, 3, 5, 7, 9, looking for 6. Which numbers do you check?" |
| 4 | "Um, I think 5, then 7, then maybe 9?" | Wrong trace 0.3 + hedging 0.15 + fillers 0.1 = 0.55 | L2 | "Slide 7 shows when it stops. What has to be true to stop?" |
| 5 | "When there's nothing left to search. After 7 there's nothing left, so just 5 and 7." | Correct. When it stops: Assisted, earned (0.55) | — | "Ooh, nice. You found where it stops." |
| 6 | (duck moves on after 1.5 s) | Next concept: update step | — | "My friend wrote lo = mid, not mid + 1. Is that okay?" |
| 7 | "I think that's fine?" | Misconception 0.3 | L1 | "What happens to lo when it's right next to hi?" |
| 8 | "It stays the same… so it loops forever." | Update step: Assisted. Not earned (0.3) | — | "Got it." |
| 9 | (6 concepts or 8 minutes not reached; O(log n) remains) | — | — | "Last one: how many checks for a million items?" |

**Debrief:** halving Owned; sorted input, when it stops and the update step Assisted (recall in 2 days); O(log n) depends on turn 10.

In turn 4 the duck never says "5 and 7". The leak check blocks those values until Jordan commits to an answer.

## Testing and tuning

The numbers above are starting guesses; test with real people early and tune the config, not the logic.

**Before the demo**

- [ ] Unit-test the scoring: every signal, the cap at 1, the reset on success
- [ ] Unit-test the ladder: each score band maps to the right level; a request for help starts at L3
- [ ] Unit-test the brakes: skip, two skips, question streak, silence at 8, 20 and 45 s
- [ ] Leak test: the duck never says a stored trace answer before the student commits
- [ ] Replay the worked example as a script and check every level and duck line
- [ ] Barge-in: talk over the duck 10 times; it stops every time
- [ ] Pause test: pause mid-sentence for 2 s after "and"; the duck waits
- [ ] Fallback: turn off the AI; the session continues on precomputed questions

**Tuning with real people (5 hackers, 5 minutes each)**

- [ ] Count interruptions: any is a bug; raise the end-of-turn silence if needed
- [ ] Ask "Did it feel naggy?" If yes, raise the L1 threshold or lower the move cap
- [ ] Ask "Did it let you off too easy?" If yes, lower the thresholds
- [ ] Log every decision (turn, signals, score, level, line) for the debrief and for tuning

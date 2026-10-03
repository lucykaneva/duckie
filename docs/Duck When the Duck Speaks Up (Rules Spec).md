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

**How the code reads these signals (added by Dev B while building `src/lib/engine`; settled)**

These choices fill gaps in the tables above. Getting them wrong causes real bugs, such as skipping a concept the student was only explaining.

- **Fillers are only "um" and "uh".** Stretched or alternate spellings count too ("umm", "uhh", "uhm"). "Like", "so", "and", "er" and "hmm" do not count; "and", "so", "because", "like", "um" and "uh" only extend the end-of-turn wait (section 2). Words are matched whole ("umbrella" is not a filler), and "uh-huh" and "uh-oh" do not count.
- **"More than 1 per 8 words" means fillers × 8 is greater than the word count.** One "um" fires only in a turn of 7 words or fewer; exactly 1 per 8 words does not fire.
- **Hedging counts every occurrence** of "I think", "maybe", "kind of" (or "kinda") and "or something" in the turn. Two or more fire the signal.
- **"I don't know" also matches** "I do not know", "dunno", "no idea", "no clue" and "not sure at all". "Not sure" on its own does not. It can fire on "I don't know if that's right, but..."; we accept that.
- **"Move on" and "skip" only count as a request, never while the student is explaining.** "Let's move on", "can we skip this one" or a turn that is just "skip" skips the concept. "Then you skip the left half" and "it moves on to the right half" do not. A false match here would mark a concept Skipped and jump to the next topic.
- **A help request must be addressed to the duck** ("can you explain it", "I need help", "give me a hint", "I'm stuck"). "Let me explain it" is the student teaching, not a request.
- **"Concept missed" has no quote,** because the student did not say it. It counts only after the explanation turn has ended. Every other judge signal needs a quote that appears word for word in the turn text.
- **"Earned" uses the score before the success reset.** In turn 5 below, the score was 0.45 going in, so it was earned; a score of 0.3 is not. Scores are rounded so that 0.3 + 0.15 equals 0.45 exactly.

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

**How the code runs the ladder** (added by Dev B in B7; settled). These are judgment calls the spec did not settle. Getting any of them wrong breaks the session, so they are fixed here and covered by `tests/ladder.test.ts` and `tests/turn.test.ts`.

- **Band edges are inclusive at the lower end.** A score of exactly 0.45 is L2, exactly 0.25 is L1, and so on. Scores are rounded to 6 decimals before the comparison so 0.3 + 0.15 is exactly 0.45.
- **The duck climbs at most one level per move.** The first help move on a concept may reach L3 at most (L1 to L3 straight from L0 is fine). After that, one step up per move, even if the score jumps to L4's band. The student must always be asked something before being told something.
- **A failed attempt after help always climbs.** Once the duck has given help (L1 or higher), a wrong answer moves it at least one level up, even when the score band is lower. After the opening check question (L0) the score band decides the first level. The ladder never goes down within a concept.
- **L4 needs a real attempt.** It is allowed only when the score is in the L4 band (0.8 or more) or after `failedAttemptsForL4` failed attempts. A request for help is not an attempt and never counts toward this.
- **A request for help goes to L3 from below it,** and does not count as a failed attempt. Asking again at L3 or higher just continues the ladder.
- **Misconceptions never sit at L0.** A misconception raises the floor to L1, whatever the score.
- **The 3-move cap counts every duck move on the concept,** including the first check question (L0). **L4 is exempt from the cap:** a student who got to L4 has not yet been explained to, so the duck gives the explanation and teach-back question first, and offers to skip only after that.
- **The duck never moves on by itself.** After the ladder is used up it says "Want to skip this one?" and waits. It moves on only if the student then says a plain yes (yes, yeah, okay, sure, go ahead), or says they want to move on at any time. Anything else, including "I don't know", keeps the offer open.
- **Resolved wins over struggling.** If the student answers correctly in the same turn that also contains hedging or fillers, the concept is resolved and the score resets to 0. The state is Owned if the concept was never helped, Assisted after L1 to L3, Explained to after L4. Whether the struggle was earned (score reached `earnedScore` before the success) is recorded for the debrief.
- **Every concept in the section is scored on every turn,** not only the one being asked about. A student who covers a later concept while answering an earlier one gets it recognised (Owned) and is not asked about it again.
- **L4 with the AI down:** each concept stores a short explanation plus teach-back question in `fallback_questions.L4`, written at extraction and by hand in the demo seed. The duck is never left without an L4 line.
- **Which line is used.** L1 to L4 and the opening check question come from `fallback_questions` and `check_prompt` until wording is wired in (B11). The AI's wording replaces them only when it passes the line limits and the leak check.

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

**How the code runs the brakes** (added by Dev B in B9; settled). The table above leaves gaps. These are the choices the code makes, covered by `tests/brakes.test.ts`.

- **"Back-to-back questions" means questions with nothing in between.** A content question or a rephrase counts. An acknowledgement ("Got it"), a celebration, an offer to skip, a check-in, an open prompt or a pause ends the run, and a question that follows an acknowledgement or celebration starts a new run. The worked example needs this: its turns 2, 3 and 4 are all questions, but turn 3 opens with "Got it."
- **The open prompt does not use up a ladder move.** "What's the next piece of it?" stays on the same concept at the same level; the ladder carries on after it. It replaces only a question or rephrase, never an offer to skip.
- **Two skips: asked once, and the answer is not scored.** If the student then says "wrap up" (or any explicit request to stop) the session wraps; any other short reply, such as "keep going", carries on. If nothing is left to ask, the duck proposes wrapping up instead of asking "Keep going or wrap up?".
- **The session-length limit counts finished concepts** (Owned, Assisted, Explained to or Skipped) **and active time.** Time spent paused does not count. The duck proposes wrapping up at the next natural break (when it is about to move to a new concept), never in the middle of helping someone. It proposes once; if the student says "keep going" it does not ask again, and it never extends the session by itself.
- **A proposal is a question; the student decides.** "Yes", "sure", "okay" or "let's wrap up" wraps up. A short "keep going" or "no" carries on and is not scored. A long reply is the student explaining: it is scored as usual and counts as turning the proposal down. When every concept has been asked and the student has already turned the proposal down, the duck closes, because it has nothing left to ask.
- **The student can always stop.** "Let's wrap up", "I want to stop", or a turn that is just "I'm done" or "stop" ends the session at any point. "I'm done with halving, now I check the middle" is an explanation and does not.
- **Silence adds the 8 s signal once per student turn** (0.25, to the concept the duck asked about), when the duck last asked a content question. Check-ins, proposals and offers do not count. The rephrase keeps the same level even if the new score is in a higher band, and it does not use up a ladder move. Until Dev A's `wordMove` is wired in, the rephrase repeats the same line. 20 s offers to skip; 45 s pauses. A step that was already handled returns 409, so a late timer can never double-count.
- **Coming back from a pause.** A short reply with nothing in it ("I'm back", "okay", "sorry") repeats the question and scores nothing. An actual answer is scored as usual, and "skip" still skips.
- **`silenceBeforeMs` on a turn is ignored.** The silence signal is applied by the `/silence` call, so using it again would count the same pause twice.

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

**How the code applies the celebration table** (added by Dev B in B9; settled)

- **"Caught a misconception or bug on their own" means the planted mistake, answered with no help.** A concept can carry a flag, `plants_misconception`, set when its opening question states a wrong claim ("My friend wrote `lo = mid`. Is that okay?"). If the student gets that right at L0 it is a real celebration even though there was no struggle. After any help it is only "Got it". Extraction sets the flag; the demo seed sets it on the update step.
- **A celebration is its own move, and the next question follows 1.5 s later as a second move.** `/turn` returns the celebration with the follow-up in `then`. Dev A speaks the celebration, waits for the audio to end plus `DUCK.afterCelebrationMs`, then speaks `then.line`. The server has already counted the follow-up as asked.
- **The line names the concept** ("Ooh, nice. You got when it stops.") until Dev A's `wordMove` writes a specific one ("Ooh, you caught the infinite loop"). A concept name too long to fit in 20 words falls back to "Ooh, nice. You got that one."
- **After L4, the answer is always neutral,** even if the score had climbed far past 0.45.

**How the code checks answers and runs the leak check** (added by Dev B in B10; settled). Covered by `tests/answers.test.ts` and `tests/run-code.test.ts`.

- **The true answer is computed once, at upload, by running the reference code.** Grok's own guess is only a first draft: the stored answer is whatever the code returns. The code runs in a separate process with no secrets, no network, no file access, a 1 second limit and a memory cap. If it fails, times out or returns something we cannot check, the concept becomes a plain explain question. The same happens if one of its own lines says the real answer.
- **Only simple answers are checked:** a number, a list of numbers, a word or phrase, a list of those, or true/false.
- **A student's answer is a "commit" only if it contains something we can read.** "I don't know", "can you explain it?" or "skip" are not commits and are never marked wrong. Only a commit can add the 0.3 wrong-trace signal or count as correct.
- **Numbers must match exactly, in order.** Repeating a value while explaining is fine ("After 7 there's nothing left, so just 5 and 7" is correct). Adding a value ("5, then 7, then maybe 9") or reversing the order is wrong. Spoken numbers count ("five and seven", "twenty-five"); "Slide 7" does not; a lone "one" is treated as the word, not the number.
- **A miss on a word answer is never "wrong".** A student can say the same idea in other words, so a word answer is either correct or not judged.
- **The reply to the L3 example is not compared.** L3 uses different values, so comparing it with the stored answer would mark a correct student wrong.
- **What counts as saying the answer.** A line leaks if it contains a run of numbers that is exactly the answer ("you'd check 5 and 7"), or the stored word. The question's own list (`1, 3, 5, 7, 9`) contains 5 and 7 but is a longer run, so it is allowed, and so is anything the check question itself already says. A single-number answer is flagged whenever the duck says that number on its own, which can block a harmless line; the replacement is the safe direction.
- **True/false answers are never checked for leaks,** because "yes" and "no" appear in ordinary questions.
- **A blocked line is replaced, not repaired.** The duck says the concept's precomputed line for that level if it is safe, otherwise "Let's slow down. Can you walk me through it step by step?". This runs on every line the server sends, whoever wrote it.
- **Once the student has committed to an answer for a concept, the duck may say it** (for example in the L4 explanation).

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

**How one finished turn is orchestrated** (added by Dev B in B11). Covered by `tests/orchestrate.test.ts`.

- **The order is fixed.** Code-readable signals and the committed-answer check first; then `judgeTurn`; then the engine; then `wordMove`; then the leak check. Code decides the move. Grok only reads structure and writes words.
- **Each Grok call has a time limit.** If the judge is slow, down or unusable, the turn is scored with code-only signals and an empty judge. If wording is slow or rejected, the precomputed line is spoken. The duck never waits for a second chance beyond what `wordMove` already retries.
- **The judge is skipped** when the engine will not score the turn: the session is closing, the student asked to wrap up or skip, a short reply to a check-in or skip offer, or "I'm back" after a pause.
- **"Missed" only applies to explainable concepts.** A trace or prediction is something the duck tests later, a planted claim is a probe the duck brings up itself, and a check question that asks how many or already contains a number is a later quiz. Leaving those out of the explanation turn is not a miss.
- **`wordMove` only rewords help questions, rephrases and celebrations.** Opening lines, L0 check questions, acknowledgements, brakes, proposals, pause and wrap-up stay as the engine wrote them.
- **The leak check runs on whatever `wordMove` returned.** A leaking line is replaced; the student never hears it. The prompt is never given a stored answer.

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
| 4 | "Um, I think 5, then 7, then maybe 9?" | Wrong trace 0.3 + hedging 0.15 = 0.45 (one "um" in 9 words is not more than 1 per 8, so fillers do not fire) | L2 | "Slide 7 shows when it stops. What has to be true to stop?" |
| 5 | "When there's nothing left to search. After 7 there's nothing left, so just 5 and 7." | Correct. When it stops: Assisted, earned (0.45) | — | "Ooh, nice. You found where it stops." |
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

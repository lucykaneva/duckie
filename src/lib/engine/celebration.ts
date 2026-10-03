import type { DuckConfig } from "../duck/config";
import { ACK_AFTER_EXPLAIN_LINE, ACK_LINE } from "./wording";

// What the duck says about a concept the student just got through (spec section 6).
// Praise is rare and specific: only earned success is celebrated, and only once per concept.

export type Feedback =
  /** Real celebration: the student got through after struggling (`caught: false`) or caught a planted mistake unaided. */
  | { kind: "celebrate"; caught: boolean }
  /** A short acknowledgement that goes in front of the next line. Includes the neutral "that makes sense now" after L4. */
  | { kind: "ack"; line: string };

export interface ResolvedFacts {
  /** Score before the success reset. */
  previous: number;
  /** True when the student only got there after the L4 explanation. */
  explainedTo: boolean;
  /** The highest help level used. L0 means unaided. */
  unaided: boolean;
  /** The concept's check question states a wrong claim for the student to catch. */
  plantsMisconception: boolean;
  alreadyCelebrated: boolean;
}

export function feedbackFor(
  facts: ResolvedFacts,
  config: Pick<DuckConfig, "earnedScore">,
): Feedback {
  // Correct only after L4: neutral, never a celebration.
  if (facts.explainedTo) return { kind: "ack", line: ACK_AFTER_EXPLAIN_LINE };
  // Once per concept.
  if (facts.alreadyCelebrated) return { kind: "ack", line: ACK_LINE };
  // Resolved after struggling (score reached 0.45 or more).
  if (facts.previous >= config.earnedScore) return { kind: "celebrate", caught: false };
  // Caught a misconception or bug on their own: the planted mistake, answered without help.
  if (facts.plantsMisconception && facts.unaided) return { kind: "celebrate", caught: true };
  // Correct and unaided or only lightly helped, no real struggle: "Got it" and move on.
  return { kind: "ack", line: ACK_LINE };
}

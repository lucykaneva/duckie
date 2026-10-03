import type { ConceptState } from "@/lib/duck/types";
import { MasteryDuck } from "./MasteryDuck";

/** Bucket for a future particle-duck drawing. */
export type MasteryKind = "owned" | "assisted" | "explained_to" | "not_there_yet";

const MASTERY_LABEL: Record<MasteryKind, string> = {
  owned: "Owned",
  assisted: "Assisted",
  explained_to: "Explained to",
  not_there_yet: "Not there yet",
};

const MASTERY_NOTE: Record<MasteryKind, string> = {
  owned: "You explained it on your own.",
  assisted: "You got there with some help.",
  explained_to: "Duckie had to explain it.",
  not_there_yet: "You haven't quite got this one yet.",
};

export function masteryKind(state: ConceptState): MasteryKind {
  if (state === "owned" || state === "assisted" || state === "explained_to") return state;
  return "not_there_yet";
}

/**
 * Reserved slot for the particle duck.
 * Replace the empty `data-mastery` region with the drawing; the label stays underneath.
 */
export function MasteryVisual({
  state,
  size = "md",
}: {
  state: ConceptState;
  size?: "md" | "sm";
}) {
  const kind = masteryKind(state);
  const compact = size === "sm";

  return (
    <div>
      <div
        data-mastery={kind}
        data-state={state}
        className={compact ? "h-14" : "h-[136px]"}
        aria-hidden="true"
      >
        <MasteryDuck kind={kind} height={compact ? 56 : 136} />
      </div>
      <p
        className={
          compact
            ? "text-[10px] tracking-[0.14em] text-ink-muted uppercase"
            : "text-[11px] font-medium tracking-[0.14em] text-ink uppercase"
        }
      >
        {MASTERY_LABEL[kind]}
      </p>
      {compact ? null : (
        <p className="mt-1 text-small text-ink-muted">{MASTERY_NOTE[kind]}</p>
      )}
    </div>
  );
}

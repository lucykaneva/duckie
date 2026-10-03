import type { ConceptState, Level, ResultsConcept } from "@/lib/duck/types";
import { Badge } from "@/components/ui/Badge";

export const STATE_LABEL: Record<ConceptState, string> = {
  owned: "Owned",
  assisted: "Assisted",
  explained_to: "Explained to",
  misconception: "Misconception",
  skipped: "Skipped",
  not_yet: "Not yet",
};

export const STATE_MEANING: Record<ConceptState, string> = {
  owned: "Taught without a hint.",
  assisted: "Got there with a nudge.",
  explained_to: "The duck had to explain it.",
  misconception: "A trap showed up.",
  skipped: "Left for later.",
  not_yet: "On the list. Not taught yet.",
};

export const STATE_ORDER: ConceptState[] = [
  "misconception",
  "explained_to",
  "assisted",
  "skipped",
  "not_yet",
  "owned",
];

const STATE_EDGE: Record<ConceptState, string> = {
  owned: "bg-state-green-fg",
  assisted: "bg-state-yellow-fg",
  explained_to: "bg-state-red-fg",
  misconception: "bg-state-red-fg",
  skipped: "bg-state-grey-fg",
  not_yet: "bg-state-grey-fg",
};

export const STATE_DOT: Record<ConceptState, string> = {
  owned: "bg-state-green-fg",
  assisted: "bg-state-yellow-fg",
  explained_to: "bg-state-red-fg",
  misconception: "bg-state-red-fg",
  skipped: "bg-state-grey-fg",
  not_yet: "bg-state-grey-fg",
};

const HELP_LEVEL: Record<Level, string> = {
  L0: "No help",
  L1: "duckie asked a question",
  L2: "duckie pointed to slide",
  L3: "duckie gave smaller example",
  L4: "duckie explained",
};

export function ConceptResultCard({ concept }: { concept: ResultsConcept }) {
  const quote = concept.quotes?.[0];

  return (
    <article className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex">
        <div aria-hidden="true" className={`w-1.5 shrink-0 ${STATE_EDGE[concept.state]}`} />
        <div className="min-w-0 flex-1 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-section">{concept.name}</h3>
            <Badge dotClassName={STATE_DOT[concept.state]}>{STATE_LABEL[concept.state]}</Badge>
          </div>
          {quote ? (
            <p className="mt-3 text-body text-ink-muted italic">
              “{quote}”
            </p>
          ) : null}
          <p className="mt-3 text-small text-ink-muted">
            {HELP_LEVEL[concept.levelReached]} · Slide {concept.slide}
          </p>
        </div>
      </div>
    </article>
  );
}

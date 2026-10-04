import type { ReactNode } from "react";

/** Centered page measure — same px-5 / py-14 as Courses, wide enough for the rail + 3 cards. */
export const reviewPageShell = "mx-auto w-full max-w-[72rem] px-5 py-14";

/** Title rail 240px, 56px gutter, cards share one content rail. */
export const reviewSectionGrid =
  "grid items-start gap-y-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-x-14";

/** Compact collection — explicit gap, never space-between. */
export const reviewCardGrid =
  "grid grid-cols-1 justify-items-start gap-x-8 gap-y-8 sm:grid-cols-2 xl:grid-cols-3";

export function ReviewPageHeader({ sample }: { sample: boolean }) {
  return (
    <header>
      <p className="text-label">Review</p>
      <h1 className="mt-3 text-title">Ready for another go?</h1>
      {sample ? <p className="sr-only">Sample data</p> : null}
    </header>
  );
}

export function ReviewSection({
  title,
  description,
  ariaLabel,
  children,
}: {
  title: string;
  description: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <section className={reviewSectionGrid}>
      <div>
        <h2 className="text-title">{title}</h2>
        <p className="mt-3 text-body text-ink-muted">{description}</p>
      </div>
      <div className={reviewCardGrid} aria-label={ariaLabel}>
        {children}
      </div>
    </section>
  );
}

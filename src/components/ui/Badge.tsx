import type { ReactNode } from "react";

export function Badge({ children, dotClassName }: { children: ReactNode; dotClassName?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-pill border border-border bg-surface py-1 text-small text-ink ${
        dotClassName ? "pr-3 pl-2" : "px-3"
      }`}
    >
      {dotClassName ? <span aria-hidden className={`size-2 shrink-0 rounded-pill ${dotClassName}`} /> : null}
      {children}
    </span>
  );
}

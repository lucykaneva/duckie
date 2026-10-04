import Link from "next/link";
import { DuckStamp } from "./DuckStamp";

type CourseBookProps = {
  name: string;
  href: string;
};

export function CourseBook({ name, href }: CourseBookProps) {
  return (
    <Link
      href={href}
      className="card-lift group block w-full min-w-0 rounded-card outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      aria-label={name}
    >
      <div className="relative aspect-[236/320] w-full">
        <BookSilhouette className="transition-[filter] group-hover:drop-shadow-[0_12px_18px_rgb(29_29_31_/_0.12)]" />

        <div className="absolute inset-x-0 top-[26%] flex flex-col items-center px-[17%]">
          <span className="text-section line-clamp-3 text-center break-words text-ink">{name}</span>
          <svg viewBox="0 0 60 8" className="mt-2 h-2 w-[38%]" aria-hidden="true">
            <path
              d="M1 5C16 2.5 40 2.5 59 4"
              fill="none"
              stroke="var(--color-duck-outline)"
              strokeOpacity="0.5"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <DuckStamp className="absolute right-[16%] bottom-[14%] h-auto w-[18.5%]" />
      </div>
    </Link>
  );
}

type GhostCourseBookProps = {
  /** First empty slot only — opens New course. Other ghosts stay silent. */
  onClick?: () => void;
};

export function GhostCourseBook({ onClick }: GhostCourseBookProps) {
  const actionable = Boolean(onClick);
  const book = (
    <div
      className={`relative aspect-[236/320] w-full opacity-[0.22] ${
        actionable
          ? "transition-opacity duration-200 ease-out group-hover:opacity-[0.38] group-focus-visible:opacity-[0.38]"
          : ""
      }`}
    >
      <BookSilhouette ghost />
      {actionable ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-[10%] text-center">
          <span className="font-display text-[26px] leading-none text-ink">+</span>
          <span className="mt-1.5 text-section text-ink">New course</span>
        </div>
      ) : null}
    </div>
  );

  if (actionable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="New course"
        className="card-lift group block w-full min-w-0 bg-transparent text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        {book}
      </button>
    );
  }

  return (
    <div className="w-full min-w-0" aria-hidden="true">
      {book}
    </div>
  );
}

function BookSilhouette({
  className,
  ghost = false,
}: {
  className?: string;
  ghost?: boolean;
}) {
  const dash = ghost ? "8 5.5 5 6.5 9 5 6 7" : undefined;

  return (
    <svg viewBox="0 0 236 320" className={`absolute inset-0 size-full ${className ?? ""}`} aria-hidden="true">
      <path
        d="M26 10C90 5 160 5 226 11C230 95 230 220 227 303"
        fill="none"
        stroke="var(--color-border-strong)"
        strokeWidth={ghost ? "1.7" : "1.2"}
        strokeLinecap="round"
        strokeDasharray={dash}
      />
      <path
        d="M17 14C72 9 152 7 219 12C222 92 222 216 220 306C152 311 72 312 16 307C13 220 13 96 17 14Z"
        fill={ghost ? "transparent" : "var(--color-surface)"}
        stroke="var(--color-duck-outline)"
        strokeOpacity={ghost ? 1 : 0.72}
        strokeWidth={ghost ? "1.85" : "1.4"}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={dash}
      />
      <path
        d="M33 12.5C30.5 100 30.5 220 32.5 307.5"
        fill="none"
        stroke="var(--color-border-strong)"
        strokeWidth={ghost ? "1.6" : "1.2"}
        strokeLinecap="round"
        strokeDasharray={dash}
      />
      <path
        d="M21 299C90 303 150 303 215 298"
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={ghost ? "1.6" : "1.2"}
        strokeLinecap="round"
        strokeDasharray={dash}
      />
    </svg>
  );
}

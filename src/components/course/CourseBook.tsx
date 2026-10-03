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
      className="group block w-[236px] rounded-card"
      aria-label={name}
    >
      <div className="relative h-[320px] w-[236px] transition-transform group-hover:-translate-y-[5px] group-hover:rotate-[1deg] group-focus-visible:-translate-y-[5px] group-focus-visible:rotate-[1deg]">
        <svg
          viewBox="0 0 236 320"
          className="absolute inset-0 size-full transition-[filter] group-hover:drop-shadow-[0_12px_18px_rgb(29_29_31_/_0.12)]"
          aria-hidden="true"
        >
          {/* pages peeking out behind the cover */}
          <path
            d="M26 10C90 5 160 5 226 11C230 95 230 220 227 303"
            fill="none"
            stroke="var(--color-border-strong)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {/* cover */}
          <path
            d="M17 14C72 9 152 7 219 12C222 92 222 216 220 306C152 311 72 312 16 307C13 220 13 96 17 14Z"
            fill="var(--color-surface)"
            stroke="var(--color-duck-outline)"
            strokeOpacity="0.72"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          {/* spine */}
          <path
            d="M33 12.5C30.5 100 30.5 220 32.5 307.5"
            fill="none"
            stroke="var(--color-border-strong)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {/* page block along the bottom */}
          <path
            d="M21 299C90 303 150 303 215 298"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute inset-x-0 top-[84px] flex flex-col items-center px-10">
          <span className="text-section line-clamp-3 text-center break-words text-ink">
            {name}
          </span>
          <svg
            viewBox="0 0 60 8"
            className="mt-2 h-2 w-[60px]"
            aria-hidden="true"
          >
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

        <DuckStamp className="absolute right-[38px] bottom-[44px] size-11" />
      </div>
    </Link>
  );
}

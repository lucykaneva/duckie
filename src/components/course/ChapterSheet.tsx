import Link from "next/link";
import type { SectionType } from "@/lib/duck/types";
import { DuckStamp } from "./DuckStamp";

type ChapterSheetProps = {
  index: number;
  name: string;
  type: SectionType;
  itemCount?: number;
  href: string;
};

const DUCK_VARIANTS = ["spark", "swirl", "tilt"] as const;

export function ChapterSheet({ index, name, type, itemCount, href }: ChapterSheetProps) {
  const number = String(index + 1).padStart(2, "0");
  const tabLabel = type === "project" ? "PROJECT" : "TEST";
  const tabFill = type === "project" ? "#e4e7f4" : "var(--color-brand-soft)";
  const tabTop = 18 + (index % 3) * 28;
  const duckVariant = DUCK_VARIANTS[index % DUCK_VARIANTS.length];
  const countLabel =
    itemCount === undefined
      ? null
      : `${itemCount} ${itemCount === 1 ? "item" : "items"}`;

  return (
    <Link href={href} className="group relative block" aria-label={name}>
      <div className="relative transition-transform duration-[200ms] ease-out group-hover:-translate-y-[3px] group-hover:rotate-[0.3deg] group-focus-visible:-translate-y-[3px] group-focus-visible:rotate-[0.3deg]">
        <svg
          viewBox="0 0 720 128"
          className="block h-auto w-full drop-shadow-[0_5px_0_#eceae3] transition-[filter] duration-[200ms] ease-out group-hover:drop-shadow-[0_8px_10px_rgb(29_29_31_/_0.10)]"
          aria-hidden="true"
        >
          {/* stacked sheets behind the page */}
          <path
            d="M18 10C240 7 500 7 668 11V108C500 112 240 112 16 108Z"
            fill="var(--color-surface)"
            stroke="var(--color-duck-outline)"
            strokeOpacity="0.35"
            strokeWidth="1.1"
          />
          <path
            d="M14 8C238 6 498 5 664 10V112C496 116 236 116 12 111Z"
            fill="var(--color-surface)"
            stroke="var(--color-duck-outline)"
            strokeOpacity="0.55"
            strokeWidth="1.15"
          />
          {/* front sheet */}
          <path
            d="M10 6.5C120 4 360 3.5 658 8.5C659.5 40 659.5 80 657.5 114.5C360 119 120 118.5 9 114C7.5 78 8 40 10 6.5Z"
            fill="var(--color-surface)"
            stroke="var(--color-duck-outline)"
            strokeOpacity="0.72"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          {/* index tab */}
          <path
            d={`M656 ${tabTop}
               C662 ${tabTop - 1} 668 ${tabTop - 1} 698 ${tabTop + 1}
               C700 ${tabTop + 10} 700 ${tabTop + 22} 698 ${tabTop + 32}
               C668 ${tabTop + 34} 662 ${tabTop + 34} 656 ${tabTop + 32}
               Z`}
            fill={tabFill}
            stroke="var(--color-duck-outline)"
            strokeOpacity="0.7"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <text
            x="677"
            y={tabTop + 21}
            textAnchor="middle"
            fill="var(--color-ink)"
            fontSize="8"
            fontFamily="var(--font-sans)"
            fontWeight="500"
            letterSpacing="1.8"
          >
            {tabLabel}
          </text>
        </svg>

        {index === 0 ? <PaperClip /> : null}

        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center gap-8 pr-[88px] pl-8 sm:pl-10">
          <div className="w-10 shrink-0 text-center">
            <span className="font-display text-[22px] leading-none font-semibold text-ink-muted">
              {number}
            </span>
            <svg viewBox="0 0 36 6" className="mx-auto mt-1 h-1.5 w-9" aria-hidden="true">
              <path
                d="M1 3.5C10 1.8 24 1.8 35 3.2"
                fill="none"
                stroke="var(--color-ink-muted)"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-title truncate text-ink">{name}</p>
            {countLabel ? <p className="mt-1 text-small text-ink-muted">{countLabel}</p> : null}
          </div>
        </div>

        <DuckStamp
          variant={duckVariant}
          className="pointer-events-none absolute right-[84px] bottom-[28px] size-9"
        />
      </div>
    </Link>
  );
}

function PaperClip() {
  return (
    <svg
      viewBox="0 0 18 28"
      className="pointer-events-none absolute top-[-6px] left-8 h-7 w-[14px]"
      aria-hidden="true"
    >
      <path
        d="M6 12V7.5C6 4.5 8.2 3 10.4 3C12.6 3 14.5 4.6 14.5 7.4V18.2C14.5 21.4 12.2 23.6 9.2 23.6C6.2 23.6 4 21.3 4 18.2V9.2"
        fill="none"
        stroke="var(--color-duck-outline)"
        strokeOpacity="0.7"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

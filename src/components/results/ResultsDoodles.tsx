type IllusionMood = "pleased" | "suspicious" | "surprised";

export function illusionMood(score: number): IllusionMood {
  if (score < 35) return "pleased";
  if (score >= 70) return "surprised";
  return "suspicious";
}

/** 60–90px duck reaction beside the Illusion Score. */
export function IllusionDuck({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const mood = illusionMood(score);

  return (
    <svg
      viewBox="0 0 72 72"
      className={className ?? "size-[72px]"}
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="var(--color-duck-outline)"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M16 48C15.4 39.5 22.2 33.4 31 32.6C31.2 24.2 37.2 18.6 44.2 18.8C51 19 55.8 24.4 55.4 31C55.2 32.8 54.6 34.4 53.8 35.8C57.4 38.6 59 42.4 58.6 46.4C57.8 53.4 51.6 58.2 41.4 58.6L27.6 58.2C20.2 57.8 16.4 53.4 16 48Z"
          fill="var(--color-brand)"
        />
        <path d="M54.2 27.2L64.4 30.6L53.8 34.2Z" fill="var(--color-duck-beak)" />
        {mood === "pleased" ? (
          <>
            <path d="M28.4 46.2C32.2 50.4 39.6 50.6 43.8 45.8" />
            <path d="M50.6 16.2C52.4 14.6 55.2 16.8 53.8 18.6" />
            <circle cx="47.2" cy="28.6" r="1.35" fill="var(--color-duck-outline)" stroke="none" />
          </>
        ) : null}
        {mood === "suspicious" ? (
          <>
            <path d="M30.2 47.6C34.4 45.4 40.8 45.2 44.6 48" />
            <path d="M43.6 23.8C46.8 22.2 51.4 23.2 53.2 25.6" />
            <circle cx="48.6" cy="28.2" r="1.35" fill="var(--color-duck-outline)" stroke="none" />
            <path d="M59.2 13.8C60.6 11.6 63.8 12.8 62.8 15.4C62.2 16.8 60.4 16.8 59.8 15.4C59.4 14.6 59.2 14.2 59.2 13.8Z" />
          </>
        ) : null}
        {mood === "surprised" ? (
          <>
            <ellipse cx="36.4" cy="47.2" rx="3.1" ry="3.6" />
            <path d="M50.2 14.4L51.4 10.8M55.6 16.2L58.4 13.2" />
            <circle cx="47.2" cy="28.6" r="1.7" fill="var(--color-duck-outline)" stroke="none" />
          </>
        ) : null}
      </g>
    </svg>
  );
}

/** Loose underline under the score, plus a small arrow toward the caption. */
export function ScoreUnderline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 148 22" className={className} aria-hidden="true">
      <g
        fill="none"
        stroke="var(--color-duck-outline)"
        strokeOpacity="0.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 8C24 5.4 56 5 88 8.2C100 9.2 110 8.4 120 7.2" strokeWidth="1.3" />
        <path d="M118 8C128 11.4 138 16.8 146 14.6" strokeWidth="1.15" />
        <path d="M144.2 14.8C146.8 14.2 148.6 16.6 146.4 18.2C145.2 19.2 143.4 18.2 144.2 16.8" strokeWidth="1.1" />
      </g>
    </svg>
  );
}

export function BestMomentSparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        d="M10 2.2C10.4 6.2 12.6 8.6 17.2 9.6C13 10.4 10.6 13 10 17.6C9.5 13.2 7.2 10.6 2.8 9.7C7.2 8.8 9.5 6.4 10 2.2Z"
        fill="none"
        stroke="var(--color-duck-outline)"
        strokeOpacity="0.45"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TeachAgainArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 20" className={className} aria-hidden="true">
      <path
        d="M4.2 13.4C6.4 6.2 16.6 3.6 22.4 8.2C25.2 10.4 24.8 15.2 20.6 16.2C16.2 17.2 12.4 14.2 13.6 11"
        fill="none"
        stroke="var(--color-duck-outline)"
        strokeOpacity="0.45"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M18.6 14.8C20.2 16.4 22.4 16.8 24.2 15.6"
        fill="none"
        stroke="var(--color-duck-outline)"
        strokeOpacity="0.45"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}

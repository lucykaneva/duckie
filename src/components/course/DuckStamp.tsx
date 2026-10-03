type DuckStampProps = {
  className?: string;
  /** Small doodle variations so each page is not a carbon copy. */
  variant?: "spark" | "swirl" | "tilt";
};

export function DuckStamp({ className, variant = "spark" }: DuckStampProps) {
  const tilt = variant === "tilt" ? "rotate-[-8deg]" : variant === "swirl" ? "rotate-[6deg]" : "";

  return (
    <svg viewBox="0 0 48 48" className={`${tilt} ${className ?? ""}`} aria-hidden="true">
      <g
        stroke="var(--color-duck-outline)"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M11 31C11 25.5 16 21.5 22 21C22 15.5 26 12 30.5 12C35 12 38.5 15.5 38.5 20C38.5 21.3 38.2 22.5 37.7 23.5C40 25.5 41 28 41 30.5C41 35 37 38.5 30 38.5L19 38.5C14 38.5 11 35.5 11 31Z"
          fill="var(--color-brand)"
        />
        <path d="M37.6 17.6L45 20L37.6 22.6Z" fill="var(--color-duck-beak)" />
        <path d="M19.5 30C22.5 34 27.5 34 30 30" fill="none" />
        {variant === "swirl" ? (
          <path d="M40 8C42 6 44 10 42.5 12" fill="none" />
        ) : variant === "tilt" ? (
          <path d="M38 8L39 5M43 11L46 10" fill="none" />
        ) : (
          <path d="M39 9.5L41.5 6.5M33.5 7.5L34 4M43.5 13.5L47 12.5" fill="none" />
        )}
      </g>
      <circle cx="32.8" cy="18.6" r="1.3" fill="var(--color-duck-outline)" />
    </svg>
  );
}

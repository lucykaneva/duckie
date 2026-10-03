type DuckieNotedStampProps = {
  /** Plays the press-down stamp motion the first time it mounts. */
  animate?: boolean;
  /** sm sits on a gallery card. md is the opened report. */
  size?: "sm" | "md";
  className?: string;
};

const INK = "#c6a34a";

/** Rubber-stamp mark for Duckie's teaching reports. */
export function DuckieNotedStamp({
  animate = true,
  size = "md",
  className = "",
}: DuckieNotedStampProps) {
  const box = size === "sm" ? "size-16" : "size-[68px] sm:size-20";
  return (
    <div
      className={`pointer-events-none shrink-0 ${box} ${
        animate ? "duckie-noted-stamp" : "-rotate-2"
      } ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 80 80" className="size-full overflow-visible">
        <g fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M40 7.2C55.2 5.6 68.4 14.2 71.6 29.2C74.6 43.2 68.8 59.4 55.2 67.6C42.2 75.4 23.6 74.2 14 62.6C4.6 51.4 6.2 33.2 16 20.6C23.2 11.4 30.4 8.2 40 7.2Z"
            strokeWidth="1.7"
          />
          <path
            d="M40 11.2C53 10 64.2 17.2 66.8 30C69.2 41.8 64.4 55.2 53 62.2C42 68.8 26.6 67.6 18.4 58C10.4 48.6 11.8 34.4 19.6 24C25.4 16.2 31.6 12.4 40 11.2Z"
            strokeWidth="0.6"
            opacity="0.55"
          />
        </g>
        <text
          x="40"
          y="22"
          textAnchor="middle"
          fill={INK}
          fontSize="7.2"
          letterSpacing="1.35"
          fontFamily="var(--font-sans), ui-sans-serif, sans-serif"
          fontWeight="600"
        >
          DUCKIE
        </text>
        <g
          transform="translate(23 27.5) scale(0.72)"
          fill="none"
          stroke={INK}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M8 20C8 15.2 12.2 12 17 11.6C17 7.2 20.4 4.2 24.2 4.2C28 4.2 31 7.2 31 11C31 12 30.7 13 30.2 13.8C32.2 15.2 33.2 17.4 33.2 19.4C33.2 23.2 29.6 26.2 23.6 26.2H15.2C10.6 26.2 8 23.6 8 20Z"
            fill={INK}
            fillOpacity="0.16"
          />
          <path d="M30.4 8.4L36.6 10.5L30.4 12.7Z" fill={INK} stroke="none" />
          <path d="M15.4 19.4C17.6 22.1 21.6 22.1 23.6 19.4" />
          <circle cx="26.8" cy="8.3" r="1.05" fill={INK} stroke="none" />
        </g>
        <text
          x="40"
          y="66.5"
          textAnchor="middle"
          fill={INK}
          fontSize="7.2"
          letterSpacing="1.5"
          fontFamily="var(--font-sans), ui-sans-serif, sans-serif"
          fontWeight="600"
        >
          NOTED
        </text>
      </svg>
    </div>
  );
}

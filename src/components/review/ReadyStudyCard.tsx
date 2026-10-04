"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import { TopicDoodle } from "./TopicDoodle";

const PAPER = "#fbf8f1";
const INK = "#3a3732";

/** Wobbly rounded-rect cards — same size, not a stamped box. */
const SHAPES = [
  "M24 18C40 11 72 16 104 12C136 8 178 15 204 14C222 14 228 28 229 48C231 92 226 148 228 196C230 244 227 284 214 300C196 312 148 306 112 308C74 310 36 306 20 296C10 288 8 262 9 220C10 168 7 112 11 68C14 38 16 22 24 18Z",
  "M22 16C48 10 86 14 122 11C160 8 198 16 216 20C226 24 230 40 228 62C226 110 231 168 227 214C224 262 220 292 206 302C180 314 132 307 98 306C60 305 28 310 16 298C8 288 7 260 8 218C9 164 12 108 10 64C9 36 14 20 22 16Z",
  "M26 14C54 13 94 8 130 13C168 18 206 12 218 22C226 28 227 44 226 66C225 118 230 176 226 222C223 268 216 296 204 304C176 314 128 308 96 307C56 306 30 308 18 296C10 286 11 256 12 214C13 160 8 104 13 60C16 34 18 15 26 14Z",
];

const GHOSTS = [
  "M30 22C48 16 78 20 110 17C148 14 186 22 208 22C220 22 223 36 223 54C224 100 220 154 222 200C223 246 220 280 210 294C186 306 144 300 110 302C74 304 40 300 26 290C16 282 15 258 16 220C17 170 14 118 18 74C20 46 22 26 30 22Z",
  "M28 21C54 16 90 19 124 17C162 15 196 22 212 26C220 30 223 44 221 64C220 112 224 166 221 212C218 258 214 286 202 296C178 308 134 301 100 300C64 299 34 303 22 292C14 283 14 256 15 216C16 166 19 112 17 70C16 44 20 24 28 21Z",
  "M32 19C58 19 96 14 132 19C168 24 202 18 214 26C220 32 221 46 220 66C219 116 223 172 220 218C217 262 212 290 202 298C176 308 130 302 98 301C60 300 36 302 24 292C16 283 17 254 18 214C19 162 15 108 19 66C22 40 24 19 32 19Z",
];

const YELLOW_BANDS = [
  "M8 250C38 236 76 262 118 244C158 228 198 260 232 246V312C200 316 140 314 118 313C70 312 28 316 8 308Z",
  "M8 252C48 238 94 266 138 246C180 228 216 258 232 250V312C190 317 136 313 110 312C64 311 26 315 8 307Z",
  "M8 246C34 264 86 230 130 252C172 272 210 234 232 252V311C188 316 134 314 106 313C60 311 24 314 8 306Z",
];

const UNDERLINES = [
  "M8 6C22 3.4 40 2.8 54 6.2",
  "M4 4.2C20 7.2 42 2.2 60 5",
  "M10 5.8C24 2.4 46 7 58 3.6",
];

type ReadyStudyCardProps = {
  name: string;
  href: string;
  index?: number;
  /** Bottom line. Ready now says Review; coming up says the due day. */
  cta?: string;
  /**
   * Topic doodle. Each card can take its own asset once those exist.
   * Defaults to the simple landing duck.
   */
  illustrationSrc?: string;
  illustration?: ReactNode;
};

export function ReadyStudyCard({
  name,
  href,
  index = 0,
  cta = "Review",
  illustrationSrc,
  illustration,
}: ReadyStudyCardProps) {
  const uid = useId().replace(/:/g, "");
  const clipId = `ready-card-${uid}`;
  const grainId = `ready-grain-${uid}`;
  const crayonId = `ready-crayon-${uid}`;
  const variant = index % SHAPES.length;
  const shape = SHAPES[variant];

  return (
    <Link
      href={href}
      aria-label={cta === "Review" ? `Review ${name}` : `${name}, ${cta}`}
      className="card-lift group relative flex aspect-[3/4] w-[min(248px,78vw)] shrink-0 snap-start flex-col outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
    >
      <svg
        viewBox="0 0 240 320"
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipId}>
            <path d={shape} />
          </clipPath>
          <filter id={grainId} x="-4%" y="-4%" width="108%" height="108%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={variant + 2} result="n" />
            <feColorMatrix type="luminanceToAlpha" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.055" />
            </feComponentTransfer>
            <feBlend in="SourceGraphic" mode="multiply" />
          </filter>
          <filter id={crayonId} x="-6%" y="-6%" width="112%" height="112%">
            <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" seed={variant + 7} result="n" />
            <feColorMatrix type="luminanceToAlpha" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.22" />
            </feComponentTransfer>
            <feBlend in="SourceGraphic" mode="multiply" />
          </filter>
          <filter id={`ready-wobble-${uid}`} x="-10%" y="-8%" width="120%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed={variant + 3} result="w" />
            <feDisplacementMap in="SourceGraphic" in2="w" scale="1.3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id={`ready-wobble-ghost-${uid}`} x="-10%" y="-8%" width="120%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed={variant + 11} result="w" />
            <feDisplacementMap in="SourceGraphic" in2="w" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <path
          d={GHOSTS[variant]}
          fill="none"
          stroke={INK}
          strokeOpacity="0.28"
          strokeWidth="0.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#ready-wobble-ghost-${uid})`}
        />
        <g clipPath={`url(#${clipId})`}>
          <rect width="240" height="320" fill={PAPER} filter={`url(#${grainId})`} />
          <path d={YELLOW_BANDS[variant]} fill="#f5c518" filter={`url(#${crayonId})`} />
        </g>
        <path
          d={shape}
          fill="none"
          stroke={INK}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#ready-wobble-${uid})`}
        />
      </svg>

      <div className="relative flex h-[42%] items-center justify-center bg-transparent px-6 pb-2 pt-6">
        <div className="bg-transparent" style={{ backgroundColor: "transparent" }}>
          {illustration ?? <TopicDoodle name={name} fallbackSrc={illustrationSrc} />}
        </div>
      </div>

      <div className="relative flex h-[33%] flex-col items-center justify-start bg-transparent px-5 pt-1 text-center">
        <h3 className="font-display text-[26px] leading-[30px] font-semibold text-ink">{name}</h3>
        <svg viewBox="0 0 64 8" className="mt-2 h-2 w-14 overflow-visible" aria-hidden="true">
          <path
            d={UNDERLINES[variant]}
            fill="none"
            stroke={INK}
            strokeOpacity="0.42"
            strokeWidth="1.05"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="relative flex h-[25%] items-center justify-center bg-transparent">
        <span className="font-display text-[20px] leading-none font-semibold text-ink">{cta}</span>
        {cta === "Review" ? (
          <span
            aria-hidden="true"
            className="absolute left-[calc(50%+3.1rem)] font-display text-[20px] leading-none text-ink transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1.5"
          >
            →
          </span>
        ) : null}
      </div>
    </Link>
  );
}

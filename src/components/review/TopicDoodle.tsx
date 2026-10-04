const DOODLE_SRC: Record<string, string> = {
  "Loop invariant": "/review/doodles/loop-invariant.png",
  "Sorted input": "/review/doodles/sorted-input.png",
  "The update step": "/review/doodles/update-step.png",
  "When it stops": "/review/doodles/when-it-stops.png",
  "Midpoint overflow": "/review/doodles/midpoint-overflow.png",
};

const FALLBACK = "/review/doodles/fallback.png";

type TopicDoodleProps = {
  name: string;
  fallbackSrc?: string;
};

export function TopicDoodle({ name, fallbackSrc }: TopicDoodleProps) {
  const src = DOODLE_SRC[name] ?? fallbackSrc ?? FALLBACK;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-[92px] w-auto max-w-[148px] bg-transparent object-contain"
      style={{ backgroundColor: "transparent" }}
    />
  );
}

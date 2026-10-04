"use client";

import { useEffect, useMemo, useState } from "react";
import { getReviewDue, isSample } from "@/lib/api";
import { isoDay } from "@/lib/mock/dates";
import type { DueRecall } from "@/lib/duck/types";
import { ReadyStudyCard } from "@/components/review/ReadyStudyCard";
import {
  ReviewPageHeader,
  ReviewSection,
  reviewPageShell,
} from "@/components/review/ReviewLayout";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";

const TOPIC_DOODLES: Record<string, string> = {
  "Loop invariant": "/review/doodles/loop-invariant.png",
  "Sorted input": "/review/doodles/sorted-input.png",
  "The update step": "/review/doodles/update-step.png",
  "When it stops": "/review/doodles/when-it-stops.png",
  "Midpoint overflow": "/review/doodles/midpoint-overflow.png",
};

export default function ReviewPage() {
  const [items, setItems] = useState<DueRecall[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [sample, setSample] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getReviewDue()
      .then((list) => {
        if (cancelled) return;
        setSample(isSample(list));
        setItems(list);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const today = isoDay(0);
  const readyNow = useMemo(
    () => items.filter((item) => item.due <= today),
    [items, today],
  );
  const comingUp = useMemo(
    () => items.filter((item) => item.due > today),
    [items, today],
  );

  return (
    <main className={reviewPageShell}>
      <ReviewPageHeader sample={sample} />

      {status === "loading" ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-12">
          <ErrorState
            message="Couldn't load review."
            action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
          />
        </div>
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <div className="mt-12">
          <EmptyState message="Nothing to review. duckie nap now." />
        </div>
      ) : null}

      {status === "ready" && items.length > 0 ? (
        <div className="mt-12 flex flex-col gap-16">
          {readyNow.length > 0 ? (
            <ReviewSection
              title="Ready now"
              description="Teach Duckie these again today."
              ariaLabel="Ready now"
            >
              {readyNow.map((item, index) => (
                <ReadyStudyCard
                  key={item.conceptId}
                  name={item.name}
                  // TODO: link to the section once GET /api/review/due includes sectionId.
                  href="/courses"
                  index={index}
                  illustrationSrc={TOPIC_DOODLES[item.name]}
                />
              ))}
            </ReviewSection>
          ) : null}

          {comingUp.length > 0 ? (
            <ReviewSection
              title="Coming next"
              description="These aren't ready to teach again yet."
              ariaLabel="Coming next"
            >
              {comingUp.map((item, index) => (
                <ReadyStudyCard
                  key={item.conceptId}
                  name={item.name}
                  href="/courses"
                  index={index}
                  cta={formatDue(item.due)}
                  illustrationSrc={TOPIC_DOODLES[item.name]}
                />
              ))}
            </ReviewSection>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function formatDue(due: string): string {
  if (due === isoDay(0)) return "Today";
  if (due === isoDay(1)) return "Tomorrow";
  const date = new Date(`${due}T12:00:00`);
  if (Number.isNaN(date.getTime())) return due;
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return `${weekday} ${date.getDate()} ${month}`;
}

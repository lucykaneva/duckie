"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReviewDue } from "@/lib/api";
import { isoDay } from "@/lib/mock/dates";
import type { DueRecall } from "@/lib/duck/types";
import { CardGallery, editorialColumns } from "@/components/CardGallery";
import { MasteryVisual } from "@/components/review/MasteryVisual";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";

export default function ReviewPage() {
  const [items, setItems] = useState<DueRecall[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // TODO: drop the fixture default once GET /api/review/due returns a real list.
    setStatus("loading");
    getReviewDue({ mock: true })
      .then((list) => {
        if (cancelled) return;
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
    <main className="flex flex-col">
      <div className={`grid h-[max(7rem,calc(33.333svh-4rem))] shrink-0 items-center ${editorialColumns}`}>
        <div className="hidden md:block" aria-hidden="true" />
        <h1 className="text-title">Ready for another go?</h1>
      </div>

      {status === "loading" ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mx-auto max-w-[720px] px-5">
          <ErrorState
            message="Couldn't load review."
            action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
          />
        </div>
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <div className={`grid ${editorialColumns}`}>
          <div className="hidden md:block" aria-hidden="true" />
          <EmptyState message="Nothing to review. duckie nap now." />
        </div>
      ) : null}

      {status === "ready" && readyNow.length > 0 ? (
        <section className={`grid items-start gap-y-8 ${editorialColumns}`}>
          <div className="pr-5 sm:pr-8 md:sticky md:top-6 md:pr-2">
            <h2 className="text-title">Ready now</h2>
            <p className="mt-3 text-body text-ink-muted">Teach Duckie these again today.</p>
          </div>
          <CardGallery ariaLabel="Ready now" itemCount={readyNow.length}>
            {readyNow.map((item, index) => (
              <ReadyCard key={item.conceptId} item={item} index={index} />
            ))}
          </CardGallery>
        </section>
      ) : null}

      {status === "ready" && comingUp.length > 0 ? (
        <section className={`mt-8 grid items-start gap-y-8 ${editorialColumns}`}>
          <div className="pr-5 sm:pr-8 md:sticky md:top-6 md:pr-2">
            <h2 className="text-title">Coming up</h2>
            <p className="mt-3 text-body text-ink-muted">These come back on a later day.</p>
          </div>
          <CardGallery ariaLabel="Coming up" itemCount={comingUp.length}>
            {comingUp.map((item) => (
              <UpcomingCard key={item.conceptId} item={item} />
            ))}
          </CardGallery>
        </section>
      ) : null}
    </main>
  );
}

function ReadyCard({ item, index }: { item: DueRecall; index: number }) {
  const tilt = index % 2 === 0 ? "motion-safe:hover:rotate-[0.3deg]" : "motion-safe:hover:-rotate-[0.3deg]";

  return (
    <Link
      href="/courses"
      aria-label={`Teach Duckie ${item.name}`}
      className={`group flex h-[360px] w-[min(420px,max(280px,calc((100%-1rem)/2.45)))] shrink-0 snap-start flex-col rounded-[20px] border border-border bg-surface px-5 py-5 shadow-[0_8px_22px_rgb(29_29_31/0.06)] transition duration-200 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_14px_28px_rgb(29_29_31/0.1)] ${tilt}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] tracking-[0.14em] text-ink-muted uppercase">{item.topic}</p>
        <p className="shrink-0 text-[11px] tracking-[0.14em] text-ink-muted uppercase">
          {formatDue(item.due)}
        </p>
      </div>
      <h3 className="mt-3 font-display text-[26px] leading-7 font-semibold text-ink">{item.name}</h3>
      <div className="flex flex-1 flex-col justify-center">
        <MasteryVisual state={item.stateAfter} />
      </div>
      {/* TODO: link to the section once GET /api/review/due includes sectionId. */}
      <span className="mt-2 flex items-center justify-between text-body font-medium text-ink">
        <span className="relative">
          Teach Duckie
          <span className="absolute -bottom-px left-0 h-px w-full bg-brand transition-[width] duration-200 group-hover:w-[calc(100%+14px)]" />
        </span>
        <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

function UpcomingCard({ item }: { item: DueRecall }) {
  return (
    <article className="flex h-[200px] w-[230px] max-w-[78vw] shrink-0 snap-start flex-col rounded-[18px] border border-border bg-surface px-4 py-4 shadow-[0_2px_8px_rgb(29_29_31/0.04)]">
      <p className="text-[12px] font-medium tracking-[0.14em] text-ink-muted uppercase">
        {formatDue(item.due)}
      </p>
      <h3 className="mt-2 font-display text-[18px] leading-6 font-semibold text-ink/80">{item.name}</h3>
      <div className="mt-auto pt-2">
        <MasteryVisual state={item.stateAfter} size="sm" />
      </div>
    </article>
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

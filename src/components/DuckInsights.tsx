"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DuckInsight } from "@/lib/duck/types";
import { CardGallery } from "@/components/CardGallery";
import { DuckieNotedStamp } from "@/components/DuckieNotedStamp";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isValidInsight(item: DuckInsight): boolean {
  return Boolean(item.quote?.trim() || item.evidenceText?.trim());
}

function sortInsights(items: DuckInsight[]): DuckInsight[] {
  return [...items].sort((a, b) => {
    if (Boolean(a.isNew) !== Boolean(b.isNew)) return a.isNew ? -1 : 1;
    if (a.valence !== b.valence) return a.valence === "watch_out" ? -1 : 1;
    return 0;
  });
}

function sheetDate(isoDay: string): string {
  const date = new Date(`${isoDay}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDay;
  const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${month} ${String(date.getDate()).padStart(2, "0")}`;
}

function citeDate(isoDay: string): string {
  const date = new Date(`${isoDay}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function reportNumber(turn: number): string {
  const n = Number.isFinite(turn) ? Math.max(0, Math.trunc(turn)) : 0;
  return `#${String(n).padStart(3, "0")}`;
}

function excerpt(item: DuckInsight): string {
  if (item.quote?.trim()) return `“${item.quote.trim()}”`;
  return item.evidenceText?.trim() ?? "";
}

export function DuckInsights({
  items,
  showOnlyNew = false,
  dismissedIds,
  leavingId,
  onDismiss,
  placeholder = false,
}: {
  items: DuckInsight[];
  showOnlyNew?: boolean;
  dismissedIds?: Set<string>;
  leavingId?: string | null;
  onDismiss?: (item: DuckInsight) => void;
  placeholder?: boolean;
}) {
  const visible = sortInsights(items.filter(isValidInsight))
    .filter((item) => (showOnlyNew ? item.isNew : true))
    .filter((item) => !dismissedIds?.has(item.id));

  const [reading, setReading] = useState<{ id: string; origin: DOMRect | null } | null>(null);
  const [motion, setMotion] = useState<"next" | "prev" | null>(null);

  const cards = placeholder ? [PLACEHOLDER] : visible;
  const cardKey = cards.map((item) => item.id).join("|");
  const openItem = reading ? (cards.find((item) => item.id === reading.id) ?? null) : null;
  const openIndex = openItem ? cards.findIndex((item) => item.id === openItem.id) : -1;

  useEffect(() => {
    if (reading && !cardKey.split("|").includes(reading.id)) {
      setReading(null);
    }
  }, [cardKey, reading]);

  function openReport(item: DuckInsight, origin: DOMRect) {
    setMotion(null);
    setReading({ id: item.id, origin });
  }

  function closeReport() {
    const id = reading?.id;
    setReading(null);
    setMotion(null);
    if (!id) return;
    const card = document.getElementById(`report-${id}`);
    if (card instanceof HTMLElement) card.focus();
  }

  function step(direction: "next" | "prev") {
    if (openIndex < 0) return;
    const next = cards[openIndex + (direction === "next" ? 1 : -1)];
    if (!next || next.id === PLACEHOLDER.id) return;
    setMotion(direction);
    setReading({ id: next.id, origin: null });
  }

  if (!placeholder && visible.length === 0) return null;

  return (
    <>
      <CardGallery ariaLabel="Duckie reports" itemCount={cards.length} dragDisabled={placeholder}>
        {cards.map((item, index) =>
          placeholder ? (
            <ReportPreview key={item.id} item={item} faded />
          ) : (
            <ReportPreview
              key={item.id}
              item={item}
              fading={leavingId === item.id}
              tilt={index % 2 === 0 ? "right" : "left"}
              onOpen={(origin) => openReport(item, origin)}
            />
          ),
        )}
      </CardGallery>

      {openItem && !placeholder ? (
        <ReportModal
          item={openItem}
          origin={reading?.origin ?? null}
          motion={motion}
          hasPrev={openIndex > 0}
          hasNext={openIndex >= 0 && openIndex < cards.length - 1}
          onPrev={() => step("prev")}
          onNext={() => step("next")}
          onClose={closeReport}
          onDismiss={
            onDismiss
              ? () => {
                  const item = openItem;
                  closeReport();
                  onDismiss(item);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function ReportPreview({
  item,
  faded = false,
  fading = false,
  tilt = "right",
  onOpen,
}: {
  item: DuckInsight;
  faded?: boolean;
  fading?: boolean;
  tilt?: "left" | "right";
  onOpen?: (origin: DOMRect) => void;
}) {
  const watch = item.valence === "watch_out";
  const shared = `relative flex h-[500px] w-[min(340px,78vw)] shrink-0 snap-start flex-col rounded-[22px] border border-border bg-surface px-6 py-6 text-left shadow-[0_10px_28px_rgb(29_29_31/0.05)] sm:h-[530px] sm:w-[380px] ${
    faded || fading ? "opacity-40" : "opacity-100"
  }`;

  const body = (
    <>
      {item.isNew ? (
        <span className="absolute top-0 left-7 h-1.5 w-10 rounded-b-full bg-brand" aria-hidden="true" />
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium tracking-[0.18em] text-ink">DUCKIE REPORT</p>
        <p className="text-[11px] tracking-[0.16em] text-ink-muted">{reportNumber(item.turn)}</p>
      </div>
      <p className="mt-2 text-[11px] leading-4 tracking-[0.14em] text-ink-muted uppercase">
        {item.topic}
        <span className="px-1.5 normal-case tracking-normal" aria-hidden="true">
          ·
        </span>
        {sheetDate(item.date)}
      </p>
      <RuledLine />
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusMark watch={watch} />
        {item.isNew ? (
          <span className="text-[10px] font-medium tracking-[0.16em] text-ink-muted uppercase">New</span>
        ) : null}
      </div>
      <p className="mt-4 line-clamp-4 font-display text-[26px] leading-8 font-semibold text-ink">
        {item.noticed}
      </p>
      <div className="mt-5">
        <p className="text-label">What I saw</p>
        <p className="mt-2 line-clamp-2 text-body text-ink italic">{excerpt(item)}</p>
      </div>
      <div className="mt-auto pt-6 pr-16">
        <RuledLine />
        <p className="mt-4 text-label">Try next time</p>
        <p className="mt-2 line-clamp-3 text-body text-ink">{item.adaptation}</p>
      </div>
      <DuckieNotedStamp size="sm" animate={false} className="absolute right-5 bottom-5" />
    </>
  );

  if (!onOpen) {
    return (
      <div className={shared} aria-hidden="true">
        {body}
      </div>
    );
  }

  return (
    <button
      id={`report-${item.id}`}
      type="button"
      className={`${shared} cursor-pointer transition duration-200 hover:z-10 hover:shadow-[0_18px_40px_rgb(29_29_31/0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-safe:hover:-translate-y-1.5 motion-safe:hover:scale-[1.01] ${
        tilt === "left" ? "motion-safe:hover:-rotate-[0.4deg]" : "motion-safe:hover:rotate-[0.4deg]"
      }`}
      onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
    >
      {body}
    </button>
  );
}

function ReportModal({
  item,
  origin,
  motion,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onDismiss,
}: {
  item: DuckInsight;
  origin: DOMRect | null;
  motion: "next" | "prev" | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const onPrevRef = useRef(onPrev);
  const onNextRef = useRef(onNext);
  onCloseRef.current = onClose;
  onPrevRef.current = onPrev;
  onNextRef.current = onNext;
  const watch = item.valence === "watch_out";
  const cite = `${item.topic} · ${citeDate(item.date)} · Turn ${item.turn}`;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !origin) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dest = panel.getBoundingClientRect();
    const scale = Math.max(0.42, Math.min(origin.width / dest.width, 0.82));
    const dx = origin.left + origin.width / 2 - (dest.left + dest.width / 2);
    const dy = origin.top + origin.height / 2 - (dest.top + dest.height / 2);
    panel.style.transition = "none";
    panel.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        panel.style.transition = "transform 280ms cubic-bezier(0, 0, 0.2, 1)";
        panel.style.transform = "";
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [origin]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay?.querySelector<HTMLElement>("[data-close]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrevRef.current();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onNextRef.current();
        return;
      }
      if (event.key !== "Tab" || !overlay) return;
      const items = [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  const slide =
    motion === "next" ? "report-slide-next" : motion === "prev" ? "report-slide-prev" : "";

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      {hasPrev ? (
        <button
          type="button"
          aria-label="Previous report"
          onClick={onPrev}
          className="absolute top-1/2 left-3 z-20 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface text-ink shadow-[0_8px_20px_rgb(29_29_31/0.08)] sm:grid"
        >
          <Arrow direction="left" />
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          aria-label="Next report"
          onClick={onNext}
          className="absolute top-1/2 right-3 z-20 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface text-ink shadow-[0_8px_20px_rgb(29_29_31/0.08)] sm:grid"
        >
          <Arrow direction="right" />
        </button>
      ) : null}
      <div
        className="relative z-10 flex h-full items-center justify-center px-4 py-6 sm:px-16"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => event.stopPropagation()}
          className="max-h-[min(860px,calc(100vh-3rem))] w-[min(720px,calc(100vw-2rem))] overflow-y-auto rounded-[22px] border border-border bg-surface px-5 py-6 shadow-[0_24px_60px_rgb(29_29_31/0.16)] sm:px-8 sm:py-8"
        >
          <div key={item.id} className={slide}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-4">
                  <p className="text-[12px] font-medium tracking-[0.18em] text-ink">DUCKIE REPORT</p>
                  <p className="text-[12px] tracking-[0.16em] text-ink-muted">{reportNumber(item.turn)}</p>
                </div>
                <p className="mt-2 text-small text-ink-muted">
                  {item.topic} · {citeDate(item.date)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {hasPrev ? (
                  <button
                    type="button"
                    aria-label="Previous report"
                    onClick={onPrev}
                    className="grid size-8 place-items-center rounded-full text-ink hover:bg-bg sm:hidden"
                  >
                    <Arrow direction="left" />
                  </button>
                ) : null}
                {hasNext ? (
                  <button
                    type="button"
                    aria-label="Next report"
                    onClick={onNext}
                    className="grid size-8 place-items-center rounded-full text-ink hover:bg-bg sm:hidden"
                  >
                    <Arrow direction="right" />
                  </button>
                ) : null}
                <button
                  type="button"
                  data-close=""
                  aria-label="Close"
                  onClick={onClose}
                  className="grid size-8 place-items-center rounded-full text-ink hover:bg-bg"
                >
                  <CloseMark />
                </button>
              </div>
            </div>
            <RuledLine />
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusMark watch={watch} />
              {item.isNew ? (
                <span className="text-[10px] font-medium tracking-[0.16em] text-ink-muted uppercase">
                  New
                </span>
              ) : null}
            </div>
            <p className="mt-6 text-label">Teaching habit</p>
            <p id={titleId} className="mt-2 font-display text-[28px] leading-[34px] font-semibold text-ink sm:text-[30px] sm:leading-9">
              {item.noticed}
            </p>
            <div className="mt-8">
              <p className="text-label">What Duckie saw</p>
              <div className="mt-3 rounded-[10px] border border-[#e7e2d8] bg-[#f6f4ef] px-4 py-4">
                {item.duckPrompt ? (
                  <p className="text-body text-ink">
                    <span className="mb-1 block text-[11px] font-medium tracking-[0.16em] text-ink-muted">
                      DUCKIE
                    </span>
                    {item.duckPrompt}
                  </p>
                ) : null}
                {item.quote ? (
                  <p className={`text-body text-ink italic ${item.duckPrompt ? "mt-4" : ""}`}>
                    <span className="mb-1 block text-[11px] font-medium tracking-[0.16em] text-ink-muted not-italic">
                      YOU
                    </span>
                    “{item.quote}”
                  </p>
                ) : null}
                {item.evidenceText ? (
                  <p className={`text-body text-ink ${item.duckPrompt || item.quote ? "mt-4" : ""}`}>
                    {item.evidenceText}
                  </p>
                ) : null}
              </div>
            </div>
            {item.sessionId ? (
              <Link
                href={`/sessions/${item.sessionId}/log`}
                className="mt-3 inline-flex max-w-full text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <span aria-hidden="true" className="mr-1.5">
                  ↳
                </span>
                {cite}
              </Link>
            ) : null}
            <div className="mt-8 rounded-[10px] bg-state-yellow-bg px-4 py-3.5">
              <p className="text-[12px] font-medium tracking-[0.16em] text-ink">TRY NEXT TIME</p>
              <p className="mt-2 font-display text-[18px] leading-6 text-ink">{item.adaptation}</p>
            </div>
            <div className={`mt-6 flex items-end ${onDismiss ? "justify-between" : "justify-end"}`}>
              {onDismiss ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  That's not me
                </button>
              ) : null}
              <DuckieNotedStamp animate />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusMark({ watch }: { watch: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium tracking-[0.14em] uppercase ${
        watch ? "bg-state-yellow-bg text-state-yellow-fg" : "bg-state-green-bg text-state-green-fg"
      }`}
    >
      {watch ? <WatchScribble /> : <StrengthScribble />}
      {watch ? "Watch out" : "Doing great"}
    </span>
  );
}

function RuledLine() {
  return (
    <svg viewBox="0 0 640 8" preserveAspectRatio="none" className="mt-4 h-2 w-full" aria-hidden="true">
      <path
        d="M1 4.4C48 3.1 96 5.4 160 4.1C230 2.7 280 5.2 360 4C440 2.9 520 5.1 639 3.7"
        fill="none"
        stroke="var(--color-duck-outline)"
        strokeOpacity="0.4"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WatchScribble() {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden="true">
      <path
        d="M7.1 2.3C7 4.1 7.4 5.6 7 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="7" cy="10.3" r="0.85" fill="currentColor" />
    </svg>
  );
}

function StrengthScribble() {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden="true">
      <path
        d="M2.6 7.3c1.15 1.2 2.15 2.35 2.7 3.15C7.1 7.4 9 4.9 11.5 3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
      {direction === "left" ? (
        <path d="M9 2.5L4.5 7L9 11.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M5 2.5L9.5 7L5 11.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function CloseMark() {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true">
      <path d="M3 3l8 8M11 3L3 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const PLACEHOLDER: DuckInsight = {
  id: "ins_placeholder",
  valence: "watch_out",
  noticed: "A habit Duckie noticed",
  quote: "A line you said",
  topic: "Topic",
  date: "2026-10-03",
  turn: 1,
  sessionId: "",
  adaptation: "What Duckie will try next time",
};

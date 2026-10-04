"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";

/** Shared column track for the You page and Review page. */
export const editorialColumns =
  "pl-5 sm:pl-8 md:grid-cols-[220px_minmax(0,1fr)] md:gap-x-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-x-10";

/**
 * The You-page horizontal gallery: recessed sage tray, drag, wheel, snap, and progress line.
 * Pass the cards as children. Report cards and review cards both sit in this tray.
 */
export function CardGallery({
  label,
  meta,
  ariaLabel,
  itemCount,
  dragDisabled = false,
  children,
}: {
  label?: string;
  meta?: ReactNode;
  ariaLabel: string;
  itemCount: number;
  dragDisabled?: boolean;
  children: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ down: false, x: 0, left: 0, moved: false });
  const suppressClick = useRef(false);
  const [progress, setProgress] = useState({ thumb: 100, offset: 0, canScroll: false });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const scroller = el;

    function sync() {
      const max = scroller.scrollWidth - scroller.clientWidth;
      const thumb = scroller.scrollWidth === 0 ? 100 : (scroller.clientWidth / scroller.scrollWidth) * 100;
      const travel = Math.max(0, 100 - thumb);
      setProgress({
        thumb,
        offset: max <= 1 ? 0 : (scroller.scrollLeft / max) * travel,
        canScroll: max > 4,
      });
    }

    function onWheel(event: WheelEvent) {
      if (scroller.scrollWidth <= scroller.clientWidth + 4) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      const next = scroller.scrollLeft + event.deltaY;
      if (next <= 0 && event.deltaY < 0) return;
      if (next >= max && event.deltaY > 0) return;
      event.preventDefault();
      scroller.scrollLeft = next;
    }

    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", sync);
    return () => {
      scroller.removeEventListener("scroll", sync);
      scroller.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", sync);
    };
  }, [itemCount]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || dragDisabled) return;
    const el = scrollerRef.current;
    if (!el) return;
    dragRef.current = { down: true, x: event.clientX, left: el.scrollLeft, moved: false };
    el.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const el = scrollerRef.current;
    if (!el || !dragRef.current.down) return;
    const dx = event.clientX - dragRef.current.x;
    if (Math.abs(dx) > 6) dragRef.current.moved = true;
    el.scrollLeft = dragRef.current.left - dx;
  }

  function onPointerUp() {
    if (dragRef.current.moved) suppressClick.current = true;
    dragRef.current.down = false;
  }

  function onClickCapture(event: MouseEvent) {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = false;
  }

  return (
    <div className="mr-5 min-w-0 overflow-hidden rounded-[22px] bg-[#cdd6be] px-5 py-5 sm:mr-8">
      {label ? (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-label">{label}</h2>
          {meta ? <p className="text-small text-ink">{meta}</p> : null}
        </div>
      ) : null}
      <div
        ref={scrollerRef}
        className={`report-gallery flex cursor-grab snap-x snap-mandatory gap-4 overflow-x-auto bg-transparent py-3 ${
          label ? "-mb-3" : "-my-3"
        }`}
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        {children}
        <div
          className={`shrink-0 snap-none ${itemCount > 1 ? "w-[max(1.25rem,calc(100%-24rem))]" : "w-5"}`}
          aria-hidden="true"
        />
      </div>
      {progress.canScroll ? (
        <div className="mt-3 h-px bg-ink/15" aria-hidden="true">
          <div
            className="h-[2px] -translate-y-px rounded-full bg-ink/25"
            style={{ width: `${progress.thumb}%`, marginLeft: `${progress.offset}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

const REST = 22;
const HOVER = 34;
const PRESS = 16;
const FOLLOW = 0.18;
const STIFF = 0.28;
const DAMP = 0.72;

const HOT =
  'a[href], button:not(:disabled), summary, [role="button"], [role="link"], input:not([type="hidden"]), select, textarea, label[for]';

function finePointer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isHot(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest(HOT)) return true;
  let el: Element | null = target;
  for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
    if (getComputedStyle(el).cursor === "pointer") return true;
  }
  return false;
}

/** Tiny glass bubble that replaces the native cursor on fine-pointer devices. */
export function GlassCursor() {
  const ballRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!finePointer()) return;

    const ball = ballRef.current;
    if (!ball) return;

    const root = document.documentElement;
    root.classList.add("has-glass-cursor");

    let mx = innerWidth / 2;
    let my = innerHeight / 2;
    let x = mx;
    let y = my;
    let size = REST;
    let sizeVel = 0;
    let hover = false;
    let down = false;
    let visible = false;
    let raf = 0;

    const targetSize = () => (down ? PRESS : hover ? HOVER : REST);

    const frame = () => {
      x += (mx - x) * FOLLOW;
      y += (my - y) * FOLLOW;
      sizeVel += (targetSize() - size) * STIFF;
      sizeVel *= DAMP;
      size += sizeVel;

      const scale = size / REST;
      ball.style.opacity = visible ? "1" : "0";
      ball.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
      raf = requestAnimationFrame(frame);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      mx = event.clientX;
      my = event.clientY;
      hover = isHot(event.target);
      visible = true;
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      down = true;
      hover = isHot(event.target);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      down = false;
      hover = isHot(event.target);
    };
    const onLeave = () => {
      visible = false;
      down = false;
    };

    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerdown", onDown, { passive: true });
    addEventListener("pointerup", onUp, { passive: true });
    addEventListener("pointercancel", onUp, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove("has-glass-cursor");
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return <div ref={ballRef} className="glass-cursor" aria-hidden="true" />;
}

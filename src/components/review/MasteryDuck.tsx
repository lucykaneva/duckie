"use client";

import { useEffect, useRef } from "react";
import {
  loadImage,
  samplePixels,
  REFERENCE_SCALE,
  type ParticleSample,
} from "@/components/duck-hero/sampleImage";
import type { MasteryKind } from "./MasteryVisual";

/** How much of the same duck has found its place. Owned stays at 1 and uses its own draw path. */
const ASSEMBLE: Record<MasteryKind, number> = {
  owned: 1,
  assisted: 0.56,
  explained_to: 0.22,
  not_there_yet: 0.07,
};

/** Head / front-chest of the left-facing duck — particles here form first. */
const CORE = { x: -0.1, y: 0.08 };
const SAMPLE_SEED = 20261003;

let sampleWait: Promise<ParticleSample> | null = null;

function getSample() {
  if (!sampleWait) {
    sampleWait = loadImage("/landing/duck.png").then((img) =>
      samplePixels(img, { seed: SAMPLE_SEED }),
    );
  }
  return sampleWait;
}

function hash01(i: number) {
  let n = Math.imul(i + 1, 2654435761);
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  return (n >>> 0) / 4294967296;
}

function keepParticle(size: number, h: number) {
  if (size >= 6) return true;
  if (size >= 3.5) return h < 0.72;
  return h < 0.38;
}

/**
 * Breaks the duck's structure. Owned never calls this.
 * along = 0 at the beak, 1 at the tail.
 */
function placeBroken(
  kind: Exclude<MasteryKind, "owned">,
  tx: number,
  ty: number,
  along: number,
  dist: number,
  jitter: number,
  alpha: number,
  hx: number,
  hy: number,
): { x: number; y: number; alpha: number; formed: boolean } | null {
  if (kind === "assisted") {
    // Front ~56% stays. The cut is slightly ragged so it isn't a hard crop.
    const cut = ASSEMBLE.assisted + (jitter - 0.5) * 0.1;
    if (along <= cut) return { x: tx, y: ty, alpha, formed: true };
    // Narrow break band: a few particles peel off the cut.
    if (along < cut + 0.14) {
      if (jitter > 0.4) return null;
      return {
        x: tx + 0.05 + jitter * 0.1,
        y: ty + (hy - 0.5) * 0.1,
        alpha: alpha * 0.55,
        formed: false,
      };
    }
    // Tail / back half: mostly gone. A sparse spray, not a dotted silhouette.
    if (jitter > 0.11) return null;
    return {
      x: cut + 0.06 + hx * 0.3,
      y: (hy - 0.5) * 0.28,
      alpha: alpha * 0.42,
      formed: false,
    };
  }

  if (kind === "explained_to") {
    // Only a head / beak / small chest fragment stays assembled.
    const fragment = along <= ASSEMBLE.explained_to + jitter * 0.04 && dist < 0.26;
    if (fragment) return { x: tx, y: ty, alpha, formed: true };
    if (jitter > 0.22) return null;
    const blobs = [
      [0.16, 0.06],
      [0.3, -0.14],
      [0.22, -0.24],
      [0.38, 0.12],
      [0.28, 0.22],
    ] as const;
    const blob = blobs[Math.floor(hx * blobs.length) % blobs.length];
    const ang = hy * Math.PI * 2;
    const r = Math.sqrt(jitter / 0.22) * 0.14;
    return {
      x: blob[0] + Math.cos(ang) * r,
      y: blob[1] + Math.sin(ang) * r,
      alpha: alpha * 0.4,
      formed: false,
    };
  }

  // not_there_yet: one tiny beak/head cluster, then a sparse irregular cloud.
  const hint = along <= 0.14 && dist < 0.22;
  if (hint) return { x: tx, y: ty, alpha, formed: true };
  if (jitter > 0.11) return null;
  const blobs = [
    [-0.22, 0.18],
    [0.26, -0.2],
    [0.08, 0.24],
    [-0.3, -0.16],
    [0.34, 0.1],
    [-0.04, -0.28],
  ] as const;
  if (hy > 0.78) {
    return {
      x: (hx - 0.5) * 0.8,
      y: (jitter - 0.5) * 0.64,
      alpha: alpha * 0.38,
      formed: false,
    };
  }
  const blob = blobs[Math.floor(hx * blobs.length) % blobs.length];
  const ang = hy * Math.PI * 2;
  const r = Math.sqrt(jitter / 0.11) * 0.13;
  return {
    x: blob[0] + Math.cos(ang) * r,
    y: blob[1] + Math.sin(ang) * r,
    alpha: alpha * 0.42,
    formed: false,
  };
}

function drawDuck(
  ctx: CanvasRenderingContext2D,
  sample: ParticleSample,
  kind: MasteryKind,
  w: number,
  h: number,
  dpr: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const scale = Math.min(w, h) * 0.92;
  const cx = w / 2;
  const cy = h / 2 + h * 0.02;
  const sizeScale = (Math.min(w, h) / REFERENCE_SCALE) * 2.05;

  type Dot = { x: number; y: number; r: number; fill: string; formed: boolean };
  const dots: Dot[] = [];

  for (let i = 0; i < sample.count; i++) {
    const size = sample.sizes[i];
    const jitter = hash01(i);
    if (!keepParticle(size, jitter)) continue;

    const tx = sample.targets[i * 2];
    const ty = sample.targets[i * 2 + 1];
    const dx = tx - CORE.x;
    const dy = ty - CORE.y;
    const dist = Math.hypot(dx, dy) || 1;
    // 0 at the beak/head, 1 at the tail — the only axis that changes between states.
    const along = Math.min(1, Math.max(0, (tx + 0.34) / 0.68));
    const rank = along * 0.78 + Math.min(1, dist / 0.55) * 0.1 + jitter * 0.12;

    let x = tx;
    let y = ty;
    let alpha = sample.alphas[i];
    let formed = true;

    if (kind === "owned") {
      // Frozen Owned path — do not change.
      formed = rank <= 1;
      if (rank > 0.9 && jitter > 0.55) {
        const nx = sample.normals[i * 2] || dx / dist;
        const ny = sample.normals[i * 2 + 1] || dy / dist;
        x += nx * 0.018 * jitter;
        y += ny * 0.018 * jitter;
        alpha *= 0.6;
        formed = false;
      }
    } else {
      const placed = placeBroken(kind, tx, ty, along, dist, jitter, alpha, hash01(i + 17), hash01(i + 41));
      if (!placed) continue;
      x = placed.x;
      y = placed.y;
      alpha = placed.alpha;
      formed = placed.formed;
    }

    const cr = sample.colors[i * 3];
    const cg = sample.colors[i * 3 + 1];
    const cb = sample.colors[i * 3 + 2];
    const lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
    const feature = lum < 0.28 || (cr > 0.9 && cg > 0.9);
    if (feature && kind !== "owned" && !formed) continue;

    dots.push({
      x: cx + x * scale,
      y: cy - y * scale,
      r: Math.max(1.15, size * sizeScale) / 2,
      fill: `rgba(${Math.round(cr * 255)},${Math.round(cg * 255)},${Math.round(cb * 255)},${alpha})`,
      formed,
    });
  }

  dots.sort((a, b) => Number(a.formed) - Number(b.formed) || a.r - b.r);
  for (const dot of dots) {
    ctx.beginPath();
    ctx.fillStyle = dot.fill;
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Frozen frame of the landing-page particle duck.
 * Same silhouette and scale for every state; only assembly changes.
 */
export function MasteryDuck({
  kind,
  height = 136,
}: {
  kind: MasteryKind;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = Math.round(height * 1.2);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    getSample().then((sample) => {
      if (cancelled || !canvasRef.current) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawDuck(ctx, sample, kind, width, height, dpr);
    });

    return () => {
      cancelled = true;
    };
  }, [kind, width, height]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="mx-auto block"
      style={{ width, height }}
    />
  );
}

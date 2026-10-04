"use client";

/**
 * New GET /api/profile fields for Dev B:
 * - sessionCount: number
 * - updatedAt: ISO datetime (already on Profile)
 * - calibration: sentence (already on Profile)
 * - tone: string (already on Profile)
 * - insights: DuckInsight[]
 *     { id, valence: 'strength' | 'watch_out', noticed, duckPrompt?, quote?,
 *       evidenceText?, topic, date (YYYY-MM-DD), turn, sessionId, adaptation, isNew }
 * - POST /api/profile/dismiss { itemId }
 * - POST /api/profile/reset
 */

import { useEffect, useRef, useState } from "react";
import { dismissProfileItem, getProfile, isSample, resetProfile } from "@/lib/api";
import type { DuckInsight, Profile } from "@/lib/duck/types";
import { editorialColumns } from "@/components/CardGallery";
import { DuckInsights } from "@/components/DuckInsights";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";

export default function DuckiePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sample, setSample] = useState(false);
  const [reload, setReload] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [undo, setUndo] = useState<DuckInsight | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const empty = new URLSearchParams(window.location.search).get("empty") === "1";
    setStatus("loading");
    getProfile()
      .then((data) => {
        if (cancelled) return;
        setSample(isSample(data));
        setProfile(empty ? { ...data, insights: [] } : data);
        setDismissed(new Set());
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  const insights = profile?.insights ?? [];
  const validLeft = insights.filter(
    (item) =>
      !dismissed.has(item.id) &&
      Boolean(item.quote?.trim() || item.evidenceText?.trim()),
  );

  function onDismiss(item: DuckInsight) {
    setLeavingId(item.id);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      setDismissed((current) => new Set(current).add(item.id));
      setLeavingId(null);
    }, 300);
    void dismissProfileItem(item.id);
    setUndo(item);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  }

  function onUndo() {
    if (!undo) return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const id = undo.id;
    setLeavingId(null);
    setDismissed((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setUndo(null);
  }

  async function onReset() {
    setResetting(true);
    try {
      await resetProfile();
      setDismissed(new Set());
      setUndo(null);
      setProfile((current) => (current ? { ...current, insights: [] } : current));
      setResetOpen(false);
    } finally {
      setResetting(false);
    }
  }

  const empty = status === "ready" && validLeft.length === 0;

  return (
    <main className="flex flex-col">
      {sample ? (
        <div className={`pt-4 ${editorialColumns}`}>
          <span className="inline-flex rounded-full border border-border px-2.5 py-0.5 text-small text-ink-muted">
            Sample data
          </span>
        </div>
      ) : null}
      <div className={`grid h-[max(7rem,calc(33.333svh-4rem))] shrink-0 items-center ${editorialColumns}`}>
        <div className="hidden md:block" aria-hidden="true" />
        <h1 className="text-title">a little more about how you teach</h1>
      </div>

      {status === "loading" ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mx-auto max-w-[720px] px-5">
          <ErrorState
            message="Couldn't load how you teach."
            action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
          />
        </div>
      ) : null}

      {status === "ready" && profile ? (
        <>
          <section className={`grid items-start gap-y-8 ${editorialColumns}`}>
            <div className="pr-5 sm:pr-8 md:sticky md:top-6 md:pr-2">
              <h2 className="text-title">Duckie report</h2>
              <p className="mt-3 text-body text-ink-muted">
                Little things Duckie noticed while learning from you.
              </p>
              {empty ? (
                <div className="mt-6">
                  <p className="text-body">Duckie is still learning you.</p>
                  <p className="mt-2 text-body text-ink-muted">
                    Teach for one session and Duckie will start noticing how you explain things.
                  </p>
                  <div className="mt-5">
                    <ButtonLink href="/courses">Start a session</ButtonLink>
                  </div>
                </div>
              ) : null}
            </div>
            <DuckInsights
              items={insights}
              dismissedIds={dismissed}
              leavingId={leavingId}
              onDismiss={onDismiss}
              placeholder={empty}
            />
          </section>

          <div className="mt-16 max-w-xl space-y-6 pl-5 sm:pl-8">
            {profile.tone ? (
              <Card>
                <p className="text-body">{toneLine(profile.tone)}</p>
              </Card>
            ) : null}
            <p className="text-small text-ink-muted">
              Duckie keeps short quotes from your sessions to learn how you teach.
            </p>
            <Button variant="ghost" onClick={() => setResetOpen(true)}>
              Reset what Duckie knows
            </Button>
          </div>
        </>
      ) : null}

      {undo ? (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-lg"
        >
          <p className="text-small">Removed.</p>
          <button
            type="button"
            onClick={onUndo}
            className="text-small text-ink underline-offset-2 hover:underline"
          >
            Undo
          </button>
        </div>
      ) : null}

      <Dialog
        open={resetOpen}
        title="Reset what Duckie knows?"
        onClose={() => {
          if (!resetting) setResetOpen(false);
        }}
      >
        <p className="mt-3 text-body">
          This clears the habits Duckie has learned about how you teach.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={resetting}>
            Keep them
          </Button>
          <Button onClick={onReset} loading={resetting}>
            Reset
          </Button>
        </div>
      </Dialog>
    </main>
  );
}

function toneLine(tone: string): string {
  const trimmed = tone.trim().replace(/\.$/, "");
  if (!trimmed) return "";
  if (/^you /i.test(trimmed) && /duckie/i.test(trimmed)) return trimmed;
  const rest = trimmed.replace(/^responds/i, "respond");
  if (/humour|humor/i.test(rest)) {
    return `You ${rest.replace(/^you /i, "")}, so Duckie keeps it light.`;
  }
  return `You ${rest.charAt(0).toLowerCase()}${rest.slice(1)}, so Duckie adapts.`;
}

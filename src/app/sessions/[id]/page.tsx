"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  debugAddTranscript,
  debugSetDuckState,
  getDuckSession,
  getDuckSnapshot,
  onDuckRuntimeEvent,
  releaseDuckSession,
  type DuckState,
  type TranscriptLine,
} from "@/lib/duck-runtime";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

type ChipState = Exclude<DuckState, "ended">;

const CHIP: Record<ChipState, string> = {
  idle: "Getting ready…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  paused: "Paused",
};

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();

  const snapshot = getDuckSnapshot();
  const [state, setState] = useState<ChipState>(
    snapshot.state === "ended" ? "idle" : snapshot.state,
  );
  const [lines, setLines] = useState<TranscriptLine[]>(snapshot.lines);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showStipple, setShowStipple] = useState(false);
  const [devPanel, setDevPanel] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [endError, setEndError] = useState("");
  const leavingForResults = useRef(false);

  const resultsHref = `/sessions/${sessionId}/results`;

  useEffect(() => {
    setDevPanel(new URLSearchParams(window.location.search).get("dev") === "1");

    const probe = new Image();
    probe.onload = () => setShowStipple(true);
    probe.src = "/duckie-stipple.png";
  }, []);

  useEffect(() => {
    const stop = onDuckRuntimeEvent((event) => {
      if (event.type === "state") {
        if (event.state === "ended") {
          leavingForResults.current = true;
          releaseDuckSession();
          router.push(resultsHref);
          return;
        }
        setState(event.state);
        return;
      }
      if (event.type === "student_turn") {
        setLines(getDuckSnapshot().lines);
      }
      if (event.type === "move" || event.type === "filler") {
        setLines(getDuckSnapshot().lines);
      }
      if (event.type === "error") {
        setEndError(event.message);
      }
    });
    return stop;
  }, [router, resultsHref]);

  useEffect(() => {
    return () => {
      if (leavingForResults.current) return;
      getDuckSession()?.stop();
      releaseDuckSession();
    };
  }, []);

  async function onEnd() {
    setEnding(true);
    setEndError("");
    const duck = getDuckSession();
    try {
      if (duck) {
        await duck.end("student ended");
        return;
      }
      leavingForResults.current = true;
      router.push(resultsHref);
    } catch (error) {
      setEndError(error instanceof Error ? error.message : "Couldn't end the session.");
      setEnding(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-between px-6 py-16 text-center">
      <div className="flex flex-1 flex-col items-center justify-center gap-10">
        {showStipple ? (
          // Shown only if a designer drops the artwork into public/.
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/duckie-stipple.png" alt="" className="h-auto w-[200px]" />
        ) : null}

        <p className="text-display text-balance">Close your laptop and pick up duckie.</p>

        <div
          aria-live="polite"
          className="inline-flex items-center gap-5 rounded-pill border border-border bg-surface px-10 py-6"
        >
          <StateIcon state={state} />
          <span className="text-title">{CHIP[state]}</span>
        </div>

        {state === "paused" ? (
          <div className="flex flex-col items-center gap-5">
            <p className="text-lead">duckie wait. Talk when ready.</p>
            <Button
              onClick={() => {
                // DuckSession has no resume(). Talking ends a pause.
                // This updates the chip through the same event path the page reads.
                debugSetDuckState("listening");
              }}
            >
              Resume
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-16 flex w-full flex-col items-center gap-6">
        <button
          type="button"
          onClick={() => setShowTranscript((open) => !open)}
          aria-expanded={showTranscript}
          aria-controls="session-transcript"
          className="rounded-card px-2 py-1 text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {showTranscript ? "Hide transcript" : "Show transcript"}
        </button>

        {showTranscript ? (
          <div
            id="session-transcript"
            className="max-h-64 w-full overflow-y-auto rounded-card border border-border bg-surface text-left"
          >
            {lines.length === 0 ? (
              <p className="px-6 py-4 text-small text-ink-muted">Nothing said yet.</p>
            ) : (
              lines.map((line, index) => (
                <p
                  key={`${line.at}-${index}`}
                  className="border-b border-border px-6 py-3 text-body last:border-b-0"
                >
                  <span className="text-label">
                    {line.speaker === "duck" ? "duckie" : "You"}
                  </span>
                  <span className="ml-3 text-small text-ink-muted">
                    {new Date(line.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="mt-1 block">{line.text}</span>
                </p>
              ))
            )}
          </div>
        ) : null}

        <Button variant="ghost" onClick={() => setEndOpen(true)}>
          End session
        </Button>
      </div>

      <Dialog
        open={endOpen}
        title="End now?"
        onClose={() => {
          if (!ending) {
            setEndOpen(false);
            setEndError("");
          }
        }}
      >
        {endError ? <p className="mt-3 text-small text-state-red-fg">{endError}</p> : null}
        <div className="mt-5 flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => {
              setEndOpen(false);
              setEndError("");
            }}
            disabled={ending}
          >
            Keep going
          </Button>
          <Button onClick={onEnd} loading={ending}>
            End
          </Button>
        </div>
      </Dialog>

      {devPanel ? <DevPanel /> : null}
    </main>
  );
}

function StateIcon({ state }: { state: ChipState }) {
  if (state === "idle") {
    return (
      <span aria-hidden="true" className="flex size-8 items-center justify-center">
        <span className="size-5 rounded-pill bg-ink-muted" />
      </span>
    );
  }

  if (state === "listening") {
    return (
      <span aria-hidden="true" className="flex size-8 items-center justify-center">
        <span className="size-5 animate-pulse rounded-pill bg-ink" />
      </span>
    );
  }

  if (state === "thinking") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 fill-ink">
        <circle cx="5" cy="12" r="2.4" />
        <circle cx="12" cy="12" r="2.4" />
        <circle cx="19" cy="12" r="2.4" />
      </svg>
    );
  }

  if (state === "speaking") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-8 stroke-ink"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M4 9v6M8.5 6v12M13 9v6M17.5 4.5v15M21 9v6" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-8 fill-ink">
      <rect x="6" y="5" width="4" height="14" rx="1.5" />
      <rect x="14" y="5" width="4" height="14" rx="1.5" />
    </svg>
  );
}

const DEV_EVENTS: DuckState[] = ["idle", "listening", "thinking", "speaking", "paused", "ended"];

function DevPanel() {
  return (
    <div className="fixed right-4 bottom-4 z-40 w-52 rounded-card border border-border-strong bg-surface p-3 text-left">
      <p className="text-label">Dev panel</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {DEV_EVENTS.map((event) => (
          <button
            key={event}
            type="button"
            onClick={() => debugSetDuckState(event)}
            className="rounded-pill border border-border px-2.5 py-1 text-small text-ink hover:border-border-strong"
          >
            {event}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() =>
            debugAddTranscript({
              speaker: "student",
              text: "Binary search needs the list sorted first.",
              at: Date.now(),
            })
          }
          className="rounded-pill border border-border px-2.5 py-1 text-small text-ink hover:border-border-strong"
        >
          + you
        </button>
        <button
          type="button"
          onClick={() =>
            debugAddTranscript({
              speaker: "duck",
              text: "So I could use it on my pebbles? They're all mixed up.",
              at: Date.now(),
            })
          }
          className="rounded-pill border border-border px-2.5 py-1 text-small text-ink hover:border-border-strong"
        >
          + duckie
        </button>
      </div>
    </div>
  );
}

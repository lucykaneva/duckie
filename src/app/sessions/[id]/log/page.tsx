"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSessionLog } from "@/lib/api";
import type { DecisionLogRow, SessionLog } from "@/lib/duck/types";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";

function metaLine(row: DecisionLogRow): string {
  const bits: string[] = [];
  if (typeof row.meta.judge === "string") bits.push(`judge ${row.meta.judge}`);
  if (row.meta.answer === "correct" || row.meta.answer === "wrong") bits.push(`answer ${row.meta.answer}`);
  const words = row.meta.words;
  if (Array.isArray(words) && words[0] && typeof words[0] === "object") {
    const first = words[0] as { source?: unknown };
    if (typeof first.source === "string") bits.push(`wording ${first.source}`);
  }
  if (Array.isArray(row.meta.leakBlocked) && row.meta.leakBlocked.length > 0) bits.push("leak blocked");
  return bits.join(" · ");
}

function sourceLabel(source: DecisionLogRow["source"]): string {
  if (source === "silence") return "Silence";
  if (source === "steer") return "Follow-up";
  return "Student";
}

export default function SessionLogPage() {
  const params = useParams<{ id: string }>();
  const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [log, setLog] = useState<SessionLog | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setStatus("loading");
    setError("");
    getSessionLog(sessionId)
      .then((data) => {
        if (cancelled) return;
        setLog(data);
        setStatus("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Couldn't load the decision log.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, reload]);

  return (
    <main className="mx-auto w-full max-w-content px-5 py-14">
      {status === "loading" ? (
        <>
          <header>
            <p className="text-label">Decision log</p>
            <h1 className="mt-3 text-title">Session</h1>
          </header>
          <div className="flex justify-center py-16">
            <Spinner className="size-6" />
          </div>
        </>
      ) : null}

      {status === "error" ? (
        <>
          <header>
            <p className="text-label">Decision log</p>
            <h1 className="mt-3 text-title">Session</h1>
          </header>
          <div className="mt-8">
            <ErrorState
              message={error || "Couldn't load the decision log."}
              action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
            />
          </div>
        </>
      ) : null}

      {status === "ready" && log ? (
        <>
          <header>
            <p className="text-label">Decision log</p>
            <h1 className="mt-3 text-title">{log.topic}</h1>
            <p className="mt-2 text-small text-ink-muted">{log.turns.length} logged rows</p>
          </header>

          <div className="mt-6">
            <ButtonLink href={`/sessions/${log.sessionId}/results`} variant="ghost">
              Back to results
            </ButtonLink>
          </div>

          {log.turns.length === 0 ? (
            <p className="mt-8 text-body">No turns logged yet.</p>
          ) : (
            <ol className="mt-8 flex flex-col gap-4">
              {log.turns.map((row) => (
                <li key={row.id}>
                  <Card>
                    <p className="text-label">
                      {row.n} · {sourceLabel(row.source)}
                      {row.level ? ` · ${row.level}` : ""}
                      {row.moveKind ? ` · ${row.moveKind}` : ""}
                      {row.conceptName ? ` · ${row.conceptName}` : ""}
                    </p>
                    {row.text ? <p className="mt-3 text-body">“{row.text}”</p> : null}
                    {row.line ? <p className="mt-3 text-body text-ink-muted">Duck: {row.line}</p> : null}
                    <p className="mt-3 text-small text-ink-muted">
                      {row.signals.length ? row.signals.join(", ") : "no signals"}
                      {row.scoreAfter !== null ? ` · score ${row.scoreAfter}` : ""}
                      {metaLine(row) ? ` · ${metaLine(row)}` : ""}
                    </p>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </main>
  );
}

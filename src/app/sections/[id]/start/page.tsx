"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getConcepts, isSample } from "@/lib/api";
import { createDuckSession } from "@/lib/duck-runtime";
import type { Concept } from "@/lib/duck/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { SectionBreadcrumb } from "@/components/section/SectionBreadcrumb";

const CONFIDENCE = [1, 2, 3, 4, 5];

export default function SessionStartPage() {
  const params = useParams<{ id: string }>();
  const sectionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();

  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sample, setSample] = useState(false);
  const [reload, setReload] = useState(0);
  const [topic, setTopic] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    setStatus("loading");

    getConcepts(sectionId)
      .then((list) => {
        if (cancelled) return;
        setSample(isSample(list));
        setConcepts(list);
        setTopic(list[0]?.topic ?? "");
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [sectionId, reload]);

  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const concept of concepts) {
      counts.set(concept.topic, (counts.get(concept.topic) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }));
  }, [concepts]);

  async function onStart() {
    if (!sectionId || !topic || confidence === null) return;
    setStarting(true);
    setStartError("");
    try {
      const duck = createDuckSession({ sectionId, topic, confidence });
      await duck.start();
      if (!duck.id) {
        throw new Error("Couldn't start. Check the microphone and try again.");
      }
      router.push(`/sessions/${duck.id}`);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Couldn't start the session.");
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-content px-5 py-14">
      {sample ? (
        <span className="mb-4 inline-flex rounded-full border border-border px-2.5 py-0.5 text-small text-ink-muted">
          Sample data
        </span>
      ) : null}
      <SectionBreadcrumb sectionId={sectionId} />

      <header className="mt-6">
        <p className="text-label">New session</p>
        <h1 className="mt-3 text-title">What you teach duckie today?</h1>
      </header>

      <div className="mt-8">
        {status === "loading" ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6" />
          </div>
        ) : null}

        {status === "error" ? (
          <ErrorState
            message="Couldn't load the topics."
            action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
          />
        ) : null}

        {status === "ready" && topics.length === 0 ? (
          <EmptyState message="No concept here yet. Give duckie your slides first." />
        ) : null}

        {status === "ready" && topics.length > 0 ? (
          <>
            <div role="radiogroup" aria-label="Topic" className="grid gap-4">
              {topics.map((item) => {
                const selected = item.name === topic;
                return (
                  <button
                    key={item.name}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTopic(item.name)}
                    className={`card-lift rounded-card border px-8 py-8 text-left transition-colors ${
                      selected
                        ? "border-ink bg-brand-soft"
                        : "border-border bg-surface hover:border-border-strong"
                    }`}
                  >
                    <span className="block text-title">{item.name}</span>
                    <span className="mt-3 block text-body text-ink-muted">
                      {item.count} {item.count === 1 ? "concept" : "concepts"}
                    </span>
                  </button>
                );
              })}
            </div>

            <section className="mt-10">
              <h2 className="text-section">How sure you feel about this?</h2>
              <div
                role="radiogroup"
                aria-label="How sure you feel about this"
                className="mt-4 flex flex-wrap gap-3"
              >
                {CONFIDENCE.map((value) => {
                  const selected = confidence === value;
                  return (
                    <div key={value} className="w-24">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setConfidence(value)}
                        className={`w-full rounded-pill border py-4 text-section transition-colors ${
                          selected
                            ? "border-ink bg-ink text-surface"
                            : "border-border bg-surface text-ink hover:border-border-strong"
                        }`}
                      >
                        {value}
                      </button>
                      <span className="mt-2 block text-center text-small text-ink-muted">
                        {value === 1 ? "Not sure" : value === 5 ? "Very sure" : "\u00A0"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <p className="mt-10 text-small text-ink-muted">
              duckie need your microphone. Browser will ask.
            </p>

            {startError ? (
              <p className="mt-3 text-small text-state-red-fg">{startError}</p>
            ) : null}

            <div className="mt-4">
              <Button
                onClick={onStart}
                loading={starting}
                disabled={confidence === null || !topic}
              >
                Start
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

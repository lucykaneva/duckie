"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getResults, isSample } from "@/lib/api";
import type { SessionResults } from "@/lib/duck/types";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { DuckInsights } from "@/components/DuckInsights";
import { GapChart } from "@/components/results/GapChart";
import {
  BestMomentSparkle,
  IllusionDuck,
  ScoreUnderline,
  TeachAgainArrow,
} from "@/components/results/ResultsDoodles";
import {
  ConceptResultCard,
  STATE_LABEL,
  STATE_MEANING,
  STATE_ORDER,
} from "@/components/results/ConceptResultCard";

export default function SessionResultsPage() {
  const params = useParams<{ id: string }>();
  const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [results, setResults] = useState<SessionResults | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [sample, setSample] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setStatus("loading");
    setError("");
    getResults(sessionId)
      .then((data) => {
        if (cancelled) return;
        setSample(isSample(data));
        setResults(data);
        setStatus("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Couldn't load the results.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, reload]);

  const ownedCount = results?.concepts.filter((concept) => concept.state === "owned").length ?? 0;
  const felt = (results?.confidence ?? 0) * 20;
  const understood = results?.understanding ?? 0;

  const orderedConcepts = useMemo(() => {
    if (!results) return [];
    return [...results.concepts].sort(
      (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
    );
  }, [results]);

  const recallLine = useMemo(() => {
    if (!results || results.recall.length === 0) return "";
    const earliest = results.recall
      .map((item) => item.due)
      .sort()[0];
    const when = formatRecallDay(earliest);
    const count = results.recall.length;
    return `Duckie will ask about ${count} ${count === 1 ? "concept" : "concepts"} again on ${when}.`;
  }, [results]);

  return (
    <main className="mx-auto w-full max-w-content px-5 py-14">
      {sample ? (
        <span className="mb-4 inline-flex rounded-full border border-border px-2.5 py-0.5 text-small text-ink-muted">
          Sample data
        </span>
      ) : null}
      {status === "loading" ? (
        <>
          <header>
            <p className="text-label">Session results</p>
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
            <p className="text-label">Session results</p>
            <h1 className="mt-3 text-title">Session</h1>
          </header>
          <div className="mt-8">
            <ErrorState
              message={error || "Couldn't load the results."}
              action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
            />
          </div>
        </>
      ) : null}

      {status === "ready" && results ? (
        <>
          <header>
            <p className="text-label">Session results</p>
            <h1 className="mt-3 text-title">{results.topic}</h1>
          </header>

          <Card className="mt-8">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-label">You felt</p>
                <p className="mt-3 text-title">
                  {results.confidence}/5 sure
                </p>
              </div>
              <div>
                <p className="text-label">You owned</p>
                <p className="mt-3 text-title">
                  {ownedCount} of {results.concepts.length}
                </p>
              </div>
            </div>

            <p className="sr-only">
              Felt {felt} out of 100, from a confidence of {results.confidence} out of 5.
              Understood {understood} out of 100. You owned {ownedCount} of{" "}
              {results.concepts.length} concepts. Illusion score {results.illusionScore}.
            </p>
            <div className="mt-8">
              <GapChart felt={felt} understood={understood} />
            </div>

            <div className="relative mt-8 pr-20">
              <p className="text-label">Illusion score</p>
              <p className="relative mt-2 w-fit text-display">
                {results.illusionScore}
                <ScoreUnderline className="pointer-events-none absolute top-[calc(100%+2px)] left-0 h-[1.15rem] w-[7.4rem]" />
              </p>
              <p className="mt-3 text-lead">Gap between feeling and knowing.</p>
              <IllusionDuck
                score={results.illusionScore}
                className="pointer-events-none absolute top-5 right-0 size-[72px]"
              />
            </div>
          </Card>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Card className="relative">
              <BestMomentSparkle className="pointer-events-none absolute top-4 right-4 size-4" />
              <p className="text-label">Best moment</p>
              <p className="mt-3 text-body">{results.strongestMoment}</p>
            </Card>
            <Card className="relative">
              <TeachAgainArrow className="pointer-events-none absolute top-4 right-4 h-4 w-6" />
              <p className="text-label">Teach duckie again</p>
              <p className="mt-3 text-body">{results.reviseNext}</p>
            </Card>
          </div>

          <section className="mt-12">
            <h2 className="text-label">Concepts</h2>
            <div className="mt-4 flex flex-col gap-4">
              {orderedConcepts.map((concept) => (
                <ConceptResultCard key={concept.id} concept={concept} />
              ))}
            </div>
            <ul className="mt-6 space-y-1">
              {STATE_ORDER.map((state) => (
                <li key={state} className="text-small text-ink-muted">
                  <span className="font-medium text-ink">{STATE_LABEL[state]}</span>
                  {" — "}
                  {STATE_MEANING[state]}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-12">
            <h2 className="text-label">Next time</h2>
            {recallLine ? (
              <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-body">{recallLine}</p>
                <ButtonLink href="/review" variant="ghost">
                  See all
                </ButtonLink>
              </div>
            ) : null}
            <div className="mt-8">
              <DuckInsights items={results.insights ?? []} showOnlyNew />
            </div>
            <div className="mt-8">
              <ButtonLink href={`/sessions/${results.sessionId}/log`} variant="ghost">
                Decision log
              </ButtonLink>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function formatRecallDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getConcepts, getCourses, getSections, isSample } from "@/lib/api";
import type { Concept } from "@/lib/duck/types";
import { ReadyStudyCard } from "@/components/review/ReadyStudyCard";
import { reviewCardGrid, reviewPageShell } from "@/components/review/ReviewLayout";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { SectionBreadcrumb } from "@/components/section/SectionBreadcrumb";

function topicsOf(concepts: Concept[]): string[] {
  const topics: string[] = [];
  for (const concept of concepts) {
    const topic = concept.topic.trim();
    if (topic && !topics.includes(topic)) topics.push(topic);
  }
  return topics;
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base;
}

/** The upload is one review. A deck about binary search is titled Binary Search. */
function presentationName(concepts: Concept[], filename?: string): string {
  const topics = topicsOf(concepts);
  if (topics.length === 1) return topics[0];
  const fromFile = filename ? titleFromFilename(filename) : "";
  return fromFile || topics[0] || "Slides";
}

type Deck = {
  key: string;
  concepts: Concept[];
  filename?: string;
};

function decksOf(concepts: Concept[]): Deck[] {
  const order: string[] = [];
  const groups = new Map<string, Concept[]>();
  for (const concept of concepts) {
    const key = concept.documentId || "slides";
    const list = groups.get(key);
    if (list) list.push(concept);
    else {
      order.push(key);
      groups.set(key, [concept]);
    }
  }
  return order.map((key) => {
    const list = groups.get(key) ?? [];
    const filename = list.find((concept) => concept.filename)?.filename ?? undefined;
    return { key, concepts: list, filename };
  });
}

function presentationSummary(concepts: Concept[]): string {
  const count = `${concepts.length} ${concepts.length === 1 ? "idea" : "ideas"}`;
  const topics = topicsOf(concepts);
  const names =
    topics.length <= 1
      ? concepts.map((concept) => concept.name.trim()).filter(Boolean)
      : topics;
  return names.length > 0 ? `${count}. ${names.join(", ")}` : count;
}

async function loadSectionName(sectionId: string): Promise<string | null> {
  const courses = await getCourses();
  for (const course of courses) {
    const sections = await getSections(course.id).catch(() => []);
    const match = sections.find((section) => section.id === sectionId);
    if (match) return match.name;
  }
  return null;
}

export default function SectionMaterialPage() {
  const params = useParams<{ id: string }>();
  const sectionId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [sectionName, setSectionName] = useState("Chapter");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sample, setSample] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    setStatus("loading");

    Promise.all([loadSectionName(sectionId).catch(() => null), getConcepts(sectionId)])
      .then(([name, list]) => {
        if (cancelled) return;
        if (name) setSectionName(name);
        setSample(isSample(list));
        setConcepts(list);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [sectionId, reload]);

  return (
    <main className={reviewPageShell}>
      {sample ? (
        <span className="mb-4 inline-flex rounded-full border border-border px-2.5 py-0.5 text-small text-ink-muted">
          Sample data
        </span>
      ) : null}
      <SectionBreadcrumb sectionId={sectionId} />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-label">Material</p>
          <h1 className="mt-3 text-title">{status === "ready" ? sectionName : "Chapter"}</h1>
        </div>
        {status === "ready" && sectionId ? (
          <ButtonLink href={`/sections/${sectionId}/upload`}>Add material</ButtonLink>
        ) : null}
      </div>

      <div className="mt-8">
        {status === "loading" ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6" />
          </div>
        ) : null}

        {status === "error" ? (
          <ErrorState
            message="Couldn't load this chapter."
            action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
          />
        ) : null}

        {status === "ready" && concepts.length === 0 ? (
          <EmptyState message="Nothing here yet. Give duckie your slides." />
        ) : null}

        {status === "ready" && concepts.length > 0 ? (
          <div className={reviewCardGrid} aria-label="Material">
            {decksOf(concepts).map((deck, index) => {
              const topic = topicsOf(deck.concepts)[0] ?? "";
              const document =
                deck.key === "slides" ? "" : `&document=${encodeURIComponent(deck.key)}`;
              return (
                <ReadyStudyCard
                  key={deck.key}
                  name={presentationName(deck.concepts, deck.filename)}
                  detail={presentationSummary(deck.concepts)}
                  index={index}
                  href={
                    sectionId
                      ? `/sections/${sectionId}/start?topic=${encodeURIComponent(topic)}${document}`
                      : "/courses"
                  }
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </main>
  );
}

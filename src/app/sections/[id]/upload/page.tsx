"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useParams } from "next/navigation";
import { getUploadStatus, isTooManyPagesError, uploadFiles, type UploadStatus } from "@/lib/api";
import type { Concept, ConceptKind } from "@/lib/duck/types";
import {
  IMAGE_MAX_BYTES,
  PDF_MAX_BYTES,
  PDF_MAX_PAGES,
  megabytesLabel,
} from "@/lib/upload-limits";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { SectionBreadcrumb } from "@/components/section/SectionBreadcrumb";

const ACCEPTED = [".pdf", ".jpg", ".jpeg", ".png"];
const TOO_MANY_PAGES = `Too many pages for duckie. Up to ${PDF_MAX_PAGES} pages.`;
const POLL_MS = 1_500;
const LINE_MS = 2_500;
const GIVE_UP_MS = 90_000;

const FINDING_LINES = [
  "duckie find big ideas…",
  "duckie look for traps…",
];

const KIND_LABELS: Record<ConceptKind, string> = {
  explain: "Explain",
  trace: "Trace",
  predict: "Predict",
};

type Phase = "idle" | "uploading" | "reading" | "ready" | "error";

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function isImageFile(file: File): boolean {
  return /\.(jpe?g|png)$/i.test(file.name) || file.type.startsWith("image/");
}

function limitFor(file: File): number {
  return isImageFile(file) ? IMAGE_MAX_BYTES : PDF_MAX_BYTES;
}

function sizeErrorFor(file: File): string {
  return isImageFile(file)
    ? "Photo too big for duckie. Try smaller photo."
    : "Too big for duckie. Try fewer slides, or photos of key slides instead.";
}

type ReadingStatus = {
  pageCount?: number;
  pending: number[];
};

function readingFrom(status: UploadStatus): ReadingStatus {
  return {
    pageCount: status.pageCount,
    pending: status.imagePagesPending ?? [],
  };
}

export default function SectionUploadPage() {
  const params = useParams<{ id: string }>();
  const sectionId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [phase, setPhase] = useState<Phase>("idle");
  const [files, setFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [lineIndex, setLineIndex] = useState(0);
  const [reading, setReading] = useState<ReadingStatus | null>(null);
  const [existingName, setExistingName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;
    getUploadStatus(sectionId)
      .then((job) => {
        if (cancelled || !job) return;
        if (job.filename || job.documentId) {
          setExistingName(job.filename ?? "the old file");
        }
      })
      .catch(() => {
        // A missing or failing status just means we don't show the replace note.
      });
    return () => {
      cancelled = true;
    };
  }, [sectionId]);

  useEffect(() => {
    if (phase !== "reading" || !sectionId) return;
    let cancelled = false;
    const startedAt = Date.now();

    const poll = setInterval(async () => {
      if (Date.now() - startedAt > GIVE_UP_MS) {
        if (!cancelled) setPhase("error");
        return;
      }
      try {
        const result = await getUploadStatus(sectionId);
        if (cancelled) return;
        if (!result) return;
        setReading(readingFrom(result));
        if (result.status === "ready") {
          setConcepts(result.concepts ?? []);
          setPhase("ready");
        } else if (result.status === "error") {
          setPhase("error");
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    }, POLL_MS);

    const rotate = setInterval(() => {
      setLineIndex((index) => (index + 1) % FINDING_LINES.length);
    }, LINE_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(rotate);
    };
  }, [phase, sectionId]);

  function addFiles(incoming: File[]) {
    const problems: string[] = [];
    const accepted: File[] = [];

    for (const file of incoming) {
      const extension = extensionOf(file.name);
      if (!ACCEPTED.includes(extension)) {
        problems.push(`${file.name} is a kind of file duckie can't read.`);
      } else if (file.size > limitFor(file)) {
        problems.push(sizeErrorFor(file));
      } else {
        accepted.push(file);
      }
    }

    if (accepted.length > 0) {
      // The live route accepts one file in the field named "file".
      setFiles([accepted[0]]);
    }
    setFileErrors(problems);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  async function onUpload() {
    if (!sectionId || files.length === 0) return;
    setFileErrors([]);
    setPhase("uploading");
    try {
      const result = await uploadFiles(sectionId, files);
      setReading(readingFrom(result));
      if (result.status === "ready") {
        setConcepts(result.concepts ?? []);
        setPhase("ready");
        return;
      }
      if (result.status === "error") {
        if (isTooManyPagesError(new Error(result.error ?? ""))) {
          returnToIdleWithPageLimit();
          return;
        }
        setPhase("error");
        return;
      }
      setLineIndex(0);
      setPhase("reading");
    } catch (error) {
      if (isTooManyPagesError(error)) {
        returnToIdleWithPageLimit();
        return;
      }
      setPhase("error");
    }
  }

  function returnToIdleWithPageLimit() {
    setFiles([]);
    setConcepts([]);
    setLineIndex(0);
    setReading(null);
    setFileErrors([TOO_MANY_PAGES]);
    setPhase("idle");
  }

  function reset() {
    setFiles([]);
    setFileErrors([]);
    setConcepts([]);
    setLineIndex(0);
    setReading(null);
    setPhase("idle");
  }

  const topics = useMemo(() => {
    const order: string[] = [];
    const grouped = new Map<string, Concept[]>();
    for (const concept of concepts) {
      const existing = grouped.get(concept.topic);
      if (existing) {
        existing.push(concept);
      } else {
        grouped.set(concept.topic, [concept]);
        order.push(concept.topic);
      }
    }
    return order.map((topic) => ({ topic, items: grouped.get(topic) ?? [] }));
  }, [concepts]);

  const picking = phase === "idle" || phase === "uploading";

  return (
    <main className="mx-auto w-full max-w-content px-5 py-14">
      <SectionBreadcrumb sectionId={sectionId} />

      <header className="mt-6">
        <p className="text-label">Add material</p>
        <h1 className="mt-3 text-title">Give duckie your slides</h1>
      </header>

      <div className="mt-8">
        {picking ? (
          <>
            {existingName ? (
              <p className="mb-4 text-small text-ink-muted">
                Uploading again replaces the old file
                {existingName !== "the old file" ? ` (${existingName})` : ""}.
              </p>
            ) : null}
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose a file. Press Enter to pick slides or a photo from your computer, or drop it here."
              onClick={() => inputRef.current?.click()}
              onKeyDown={onKeyDown}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed bg-surface px-6 py-16 text-center transition-colors ${
                dragging ? "border-ink" : "border-border hover:border-border-strong"
              }`}
            >
              <p className="text-body">Drop slides or photo here</p>
              <p className="mt-2 text-small text-ink-muted">
                {`PDF up to ${megabytesLabel(PDF_MAX_BYTES)} MB and ${PDF_MAX_PAGES} pages, or one photo up to ${megabytesLabel(IMAGE_MAX_BYTES)} MB.`}
              </p>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(",")}
              className="hidden"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />

            {fileErrors.length > 0 ? (
              <ul className="mt-4 space-y-1">
                {fileErrors.map((problem) => (
                  <li key={problem} className="text-small text-state-red-fg">
                    {problem}
                  </li>
                ))}
              </ul>
            ) : null}

            {files.length > 0 ? (
              <>
                <div className="mt-6 overflow-hidden rounded-card border border-border bg-surface">
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center justify-between gap-4 border-b border-border px-6 py-4 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-body">{file.name}</p>
                        <p className="text-small text-ink-muted">{formatSize(file.size)}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setFiles((current) => current.filter((_, at) => at !== index))
                        }
                        className="shrink-0 rounded-card px-2 py-1 text-small text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex justify-end">
                  <Button onClick={onUpload} loading={phase === "uploading"}>
                    Upload
                  </Button>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {phase === "reading" ? (
          <ReadingCard reading={reading} lineIndex={lineIndex} />
        ) : null}

        {phase === "ready" ? (
          <>
            <p className="text-body">
              duckie found {concepts.length} {concepts.length === 1 ? "concept" : "concepts"} in{" "}
              {topics.length} {topics.length === 1 ? "topic" : "topics"}.
            </p>

            <div className="mt-6 space-y-8">
              {topics.map((group) => (
                <section key={group.topic}>
                  <h2 className="text-section">{group.topic}</h2>
                  <div className="mt-3 overflow-hidden rounded-card border border-border bg-surface">
                    {group.items.map((concept) => (
                      <div
                        key={concept.id}
                        className="border-b border-border px-6 py-4 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-body">{concept.name}</span>
                          <span className="ml-auto flex items-center gap-2">
                            <Badge>Slide {concept.slide}</Badge>
                            <span className="rounded-pill bg-bg px-2.5 py-1 text-small text-ink-muted">
                              {KIND_LABELS[concept.kind]}
                            </span>
                          </span>
                        </div>
                        {concept.misconceptions.map((trap) => (
                          <p key={trap} className="mt-2 text-small text-ink-muted">
                            Common trap: {trap}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-8">
              <ButtonLink href={`/sections/${sectionId}/start`}>Teach duckie</ButtonLink>
            </div>
          </>
        ) : null}

        {phase === "error" ? (
          <ErrorState
            message="Read not work. Try different file."
            action={<Button onClick={reset}>Try again</Button>}
          />
        ) : null}
      </div>
    </main>
  );
}

function ReadingCard({
  reading,
  lineIndex,
}: {
  reading: ReadingStatus | null;
  lineIndex: number;
}) {
  const pageCount = reading?.pageCount;
  const pending = reading?.pending ?? [];
  const hasCount = typeof pageCount === "number" && pageCount > 0;
  const readingPages = hasCount && pending.length > 0;
  const barRatio = hasCount
    ? pending.length === 0
      ? 1
      : Math.min(1, Math.max(0, (pageCount - pending.length) / pageCount))
    : null;

  return (
    <Card className="flex flex-col items-center gap-4 py-12 text-center">
      <Spinner className="size-6" />
      <p className="text-body" aria-live="polite">
        {readingPages
          ? `Reading page ${pending[0]} of ${pageCount}`
          : FINDING_LINES[lineIndex]}
      </p>
      {barRatio !== null ? (
        <div className="mt-2 w-full max-w-sm">
          <div className="h-1.5 overflow-hidden rounded-pill bg-bg">
            <div
              className="h-full rounded-pill bg-brand transition-[width]"
              style={{ width: `${barRatio * 100}%` }}
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

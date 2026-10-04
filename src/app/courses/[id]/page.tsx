"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createSection, getConcepts, getCourses, getSections, isSample } from "@/lib/api";
import type { Section, SectionType } from "@/lib/duck/types";
import { ChapterSheet } from "@/components/course/ChapterSheet";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

export default function CourseSectionsPage() {
  const params = useParams<{ id: string }>();
  const courseId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [courseName, setCourseName] = useState("Course");
  const [sections, setSections] = useState<Section[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sample, setSample] = useState(false);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sectionType, setSectionType] = useState<SectionType>("test");
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setStatus("loading");

    Promise.all([getCourses().catch(() => null), getSections(courseId)])
      .then(([courses, list]) => {
        if (cancelled) return;
        const match = courses?.find((course) => course.id === courseId);
        setCourseName(match?.name || "Course");
        setSections(list);
        setSample(isSample(list));
        setStatus("ready");
        Promise.all(
          list.map((section) =>
            getConcepts(section.id)
              .then((concepts) => {
                if (isSample(concepts)) setSample(true);
                return [section.id, concepts.length] as const;
              })
              .catch(() => [section.id, 0] as const),
          ),
        ).then((pairs) => {
          if (cancelled) return;
          setItemCounts(Object.fromEntries(pairs));
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [courseId, reload]);

  function closeDialog() {
    if (creating) return;
    setOpen(false);
    setName("");
    setSectionType("test");
    setFormError("");
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!courseId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Give the chapter a name.");
      return;
    }
    setCreating(true);
    setFormError("");
    try {
      const section = await createSection(courseId, trimmed, sectionType);
      setSections((current) => [...current, section]);
      setStatus("ready");
      setOpen(false);
      setName("");
      setSectionType("test");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Couldn't create the section.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-content px-5 py-14">
      {sample ? (
        <span className="mb-4 inline-flex rounded-full border border-border px-2.5 py-0.5 text-small text-ink-muted">
          Sample data
        </span>
      ) : null}
      <nav aria-label="Breadcrumb" className="text-small text-ink-muted">
        <Link href="/courses" className="text-ink underline-offset-2 hover:underline">
          Courses
        </Link>
        <span aria-hidden="true"> › </span>
        <span>{status === "ready" ? courseName : "Course"}</span>
      </nav>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-label">Chapters</p>
          <h1 className="mt-3 text-title">{status === "ready" ? courseName : "Course"}</h1>
        </div>
        {status === "ready" && sections.length > 0 ? (
          <Button onClick={() => setOpen(true)}>New chapter</Button>
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
            message="Couldn't load sections."
            action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
          />
        ) : null}

        {status === "ready" && sections.length === 0 ? (
          <EmptyState
            message="No chapter here. Quiet. duckie like quiet."
            action={<Button onClick={() => setOpen(true)}>New chapter</Button>}
          />
        ) : null}

        {status === "ready" && sections.length > 0 ? (
          <div className="flex flex-col gap-8">
            {sections.map((section, index) => (
              <ChapterSheet
                key={`${section.id}-${index}`}
                index={index}
                name={section.name}
                type={section.type}
                itemCount={itemCounts[section.id]}
                href={`/sections/${section.id}/upload`}
              />
            ))}
          </div>
        ) : null}
      </div>

      <Dialog open={open} title="New chapter" onClose={closeDialog}>
        <form className="mt-5" onSubmit={onCreate}>
          <Input
            label="Chapter name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={formError}
            placeholder="Midterm"
            autoComplete="off"
          />
          <div className="mt-4">
            <p className="text-label">Type</p>
            <div
              role="radiogroup"
              aria-label="Section type"
              className="mt-2 grid grid-cols-2 gap-1 rounded-card border border-border p-1"
            >
              {(
                [
                  ["test", "Test"],
                  ["project", "Project"],
                ] as const
              ).map(([value, label]) => {
                const selected = sectionType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSectionType(value)}
                    className={`rounded-card py-2 font-medium transition ${
                      selected ? "bg-ink text-surface" : "text-ink hover:bg-bg"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button type="submit" loading={creating} disabled={name.trim().length === 0}>
              Create
            </Button>
          </div>
        </form>
      </Dialog>
    </main>
  );
}

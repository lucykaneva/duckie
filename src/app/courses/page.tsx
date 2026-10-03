"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createCourse, getCourses } from "@/lib/api";
import type { Course } from "@/lib/duck/types";
import { Button } from "@/components/ui/Button";
import { CourseBook } from "@/components/course/CourseBook";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getCourses()
      .then((list) => {
        if (cancelled) return;
        setCourses(list);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  function closeDialog() {
    if (creating) return;
    setOpen(false);
    setName("");
    setFormError("");
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Give the course a name.");
      return;
    }
    setCreating(true);
    setFormError("");
    try {
      const course = await createCourse(trimmed);
      setCourses((current) => [...current, course]);
      setStatus("ready");
      setOpen(false);
      setName("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Couldn't create the course.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-content px-5 py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-label">Your courses</p>
          <h1 className="mt-3 text-title">Courses you teach duckie</h1>
        </div>
        {status === "ready" && courses.length > 0 ? (
          <Button onClick={() => setOpen(true)}>New course</Button>
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
            message="Couldn't load courses."
            action={<Button onClick={() => setReload((value) => value + 1)}>Try again</Button>}
          />
        ) : null}

        {status === "ready" && courses.length === 0 ? (
          <EmptyState
            message="No course here. Quiet. duckie like quiet."
            action={<Button onClick={() => setOpen(true)}>New course</Button>}
          />
        ) : null}

        {status === "ready" && courses.length > 0 ? (
          <div className="flex flex-wrap justify-start gap-x-8 gap-y-10">
            {courses.map((course, index) => (
              <CourseBook
                key={`${course.id}-${index}`}
                name={course.name}
                href={`/courses/${course.id}`}
              />
            ))}
          </div>
        ) : null}
      </div>

      <Dialog open={open} title="New course" onClose={closeDialog}>
        <form className="mt-5" onSubmit={onCreate}>
          <Input
            label="Course name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={formError}
            placeholder="Algorithms"
            autoComplete="off"
          />
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

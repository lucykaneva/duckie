"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createCourse, getCourses } from "@/lib/api";
import type { Course } from "@/lib/duck/types";
import { Button } from "@/components/ui/Button";
import { CourseBook, GhostCourseBook } from "@/components/course/CourseBook";
import { Dialog } from "@/components/ui/Dialog";
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
    <main className="course-shelf">
      <div>
        <p className="text-label">Your courses</p>
        <h1 className="mt-3 text-title">Courses you teach duckie</h1>
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

        {status === "ready" ? (
          <div className="course-shelf-grid">
            {bookshelfSlots(courses).map((slot) =>
              slot.course ? (
                <CourseBook
                  key={slot.course.id}
                  name={slot.course.name}
                  href={`/courses/${slot.course.id}`}
                />
              ) : (
                <GhostCourseBook
                  key={slot.key}
                  onClick={slot.actionable ? () => setOpen(true) : undefined}
                />
              ),
            )}
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

function bookshelfSlots(courses: Course[]) {
  const withAction = courses.length + 1;
  const total = Math.max(8, Math.ceil(withAction / 4) * 4);

  return Array.from({ length: total }, (_, index) => {
    const course = courses[index];
    if (course) {
      return { key: course.id, course, actionable: false as const };
    }
    return {
      key: index === courses.length ? "new-course" : `empty-${index}`,
      course: null,
      actionable: index === courses.length,
    };
  });
}

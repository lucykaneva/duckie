"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCourses, getSections } from "@/lib/api";

type Trail = { courseId: string; courseName: string; sectionName: string };

/** Courses › course › section, with plain words when a name can't be found. */
export function SectionBreadcrumb({ sectionId }: { sectionId: string }) {
  const [trail, setTrail] = useState<Trail | null>(null);

  // Best effort: there is no endpoint for one section, so walk the courses.
  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;

    getCourses()
      .then(async (courses) => {
        const lists = await Promise.all(
          courses.map((course) => getSections(course.id).catch(() => [])),
        );
        for (const [index, list] of lists.entries()) {
          const match = list.find((section) => section.id === sectionId);
          if (match) {
            return {
              courseId: courses[index].id,
              courseName: courses[index].name,
              sectionName: match.name,
            };
          }
        }
        return null;
      })
      .then((found) => {
        if (!cancelled && found) setTrail(found);
      })
      .catch(() => {
        // The breadcrumb falls back to plain words.
      });

    return () => {
      cancelled = true;
    };
  }, [sectionId]);

  return (
    <nav aria-label="Breadcrumb" className="text-small text-ink-muted">
      <Link href="/courses" className="text-ink underline-offset-2 hover:underline">
        Courses
      </Link>
      <span aria-hidden="true"> › </span>
      {trail ? (
        <Link
          href={`/courses/${trail.courseId}`}
          className="text-ink underline-offset-2 hover:underline"
        >
          {trail.courseName}
        </Link>
      ) : (
        <span>Course</span>
      )}
      <span aria-hidden="true"> › </span>
      <span>{trail ? trail.sectionName : "Section"}</span>
    </nav>
  );
}

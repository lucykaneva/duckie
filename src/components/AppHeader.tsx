"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getReviewDue } from "@/lib/api";
import { isoDay } from "@/lib/mock/dates";

const LINKS = [
  { href: "/courses", label: "Courses" },
  { href: "/review", label: "Review" },
  { href: "/duckie", label: "You" },
];

function isSessionScreen(pathname: string): boolean {
  return /^\/sessions\/[^/]+\/?$/.test(pathname);
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader() {
  const pathname = usePathname() ?? "";
  const hidden = isSessionScreen(pathname);
  const [dueCount, setDueCount] = useState(0);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    getReviewDue({ mock: true })
      .then((list) => {
        if (cancelled) return;
        const today = isoDay(0);
        setDueCount(list.filter((item) => item.due <= today).length);
      })
      .catch(() => {
        if (!cancelled) setDueCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [hidden, pathname]);

  if (hidden) return null;

  return (
    <header className="border-b border-border bg-bg">
      <div className="flex w-full items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/" className="font-display text-section shrink-0">
          quack
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center justify-end gap-x-10 gap-y-2">
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center text-small sm:text-body ${
                  active
                    ? "text-ink underline decoration-2 underline-offset-4"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {link.label}
                {link.href === "/review" && dueCount > 0 ? (
                  <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-pill bg-ink px-1.5 text-small text-surface">
                    {dueCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

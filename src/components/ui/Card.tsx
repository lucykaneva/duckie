import type { HTMLAttributes } from "react";

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card-lift rounded-card border border-border bg-surface p-6 ${className}`} {...props}>
      {children}
    </div>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { Spinner } from "./Spinner";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ink" | "ghost";
  loading?: boolean;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-card px-4 py-2.5 font-medium transition select-none active:translate-y-px";

const variants = {
  primary: "bg-brand text-brand-ink hover:brightness-95",
  ink: "bg-ink text-surface hover:brightness-125",
  ghost: "bg-transparent text-ink hover:bg-surface",
};

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  children,
  className = "",
}: {
  href: string;
  variant?: "primary" | "ink" | "ghost";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

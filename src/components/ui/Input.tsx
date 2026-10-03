import { useId, type InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function Input({ label, hint, error, id, className = "", ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;

  return (
    <div>
      <label htmlFor={inputId} className="text-label">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={`mt-2 w-full px-3.5 py-2.5 text-body ${className}`}
        {...props}
      />
      {error ? (
        <p id={messageId} className="mt-2 text-small text-state-red-fg">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-2 text-small text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

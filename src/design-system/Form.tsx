import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx.ts";

export const inputClasses =
  "w-full min-h-11 rounded-md border border-border bg-surface px-3 text-body text-text placeholder:text-muted/70 " +
  "focus:border-primary-strong focus:outline-none focus:ring-2 focus:ring-primary-strong/30 aria-invalid:border-danger";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-small font-semibold">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-small text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-small text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputClasses, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputClasses, "appearance-none bg-[length:20px] pr-9", className)} {...props}>
      {children}
    </select>
  );
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputClasses, "min-h-24 py-2", className)} {...props} />;
}

/**
 * Parses user-typed numbers, accepting Norwegian decimal commas ("66,5") and spaces.
 * Returns undefined for empty input and NaN for garbage, so validation can tell them apart.
 */
export function parseDecimal(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return undefined;
  return /^-?\d*\.?\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

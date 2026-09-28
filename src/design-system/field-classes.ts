import { cx } from "./cx.ts";

export const inputClasses =
  "w-full min-h-11 rounded-md border border-border bg-surface px-3 text-body text-text placeholder:text-muted/70 " +
  "focus:border-primary-strong focus:outline-none focus:ring-2 focus:ring-primary-strong/30 aria-invalid:border-danger";

/**
 * Base input classes, minus `w-full` when the caller sets its own width. Tailwind orders
 * utilities by its own rules, so `w-24` next to `w-full` would otherwise lose unpredictably.
 */
export function fieldClasses(className?: string): string {
  const base = className && /(^|\s)w-/.test(className) ? inputClasses.replace("w-full ", "") : inputClasses;
  return cx(base, className);
}

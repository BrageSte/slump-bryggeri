import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Spinner } from "./Feedback.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:brightness-110 shadow-sm",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2",
  ghost: "text-primary-strong hover:bg-primary-soft",
  danger: "bg-danger text-surface hover:brightness-110",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3 text-small gap-1.5",
  md: "min-h-11 px-4 text-body gap-2",
  lg: "min-h-14 px-5 text-lg gap-2.5",
};

/** Shared by <Button> and link-styled buttons. */
export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", block = false): string {
  return cx(
    "inline-flex items-center justify-center rounded-md font-semibold transition select-none",
    "active:scale-[.98] disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    block && "w-full",
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClasses(variant, size, block), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size={size === "lg" ? 22 : 18} /> : icon ? <Icon name={icon} size={size === "lg" ? 22 : 20} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className,
  variant = "ghost",
  type = "button",
  ...props
}: { icon: IconName; label: string; variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-md transition active:scale-95 disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}

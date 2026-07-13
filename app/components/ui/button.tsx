import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "success" | "ghost";
type ButtonSize = "md" | "sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
};

const variantClassName: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-primary)] text-[var(--color-text-on-primary)] shadow-[var(--shadow-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]",
  secondary:
    "bg-[var(--color-secondary)] text-[var(--color-text-primary)] shadow-[var(--shadow-success)] hover:opacity-90 active:opacity-80",
  success:
    "bg-[var(--color-success)] text-[var(--color-text-on-primary)] shadow-[var(--shadow-success)] hover:opacity-90 active:opacity-80",
  ghost:
    "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-bg-subtle)]",
};

const sizeClassName: Record<ButtonSize, string> = {
  md: "h-11 px-5 text-sm",
  sm: "h-9 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/30 disabled:cursor-not-allowed disabled:opacity-60",
        variantClassName[variant],
        sizeClassName[size],
        className,
      ].join(" ")}
      {...props}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
}

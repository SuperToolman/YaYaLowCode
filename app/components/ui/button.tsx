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
    "bg-[var(--brand-blue)] text-white shadow-[0_10px_24px_rgba(30,96,255,0.22)] hover:bg-[#1e57de]",
  secondary:
    "bg-[#2c4c92] text-white shadow-[0_10px_24px_rgba(44,76,146,0.2)] hover:bg-[#233d77]",
  success:
    "bg-[var(--brand-green)] text-white shadow-[0_10px_24px_rgba(23,180,102,0.2)] hover:bg-[#14935a]",
  ghost: "bg-white text-[var(--text-primary)] ring-1 ring-inset ring-[var(--line)] hover:bg-[#f7faff]",
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
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)]/30 disabled:cursor-not-allowed disabled:opacity-60",
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

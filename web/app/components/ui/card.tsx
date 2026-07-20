import type { ReactNode } from "react";

type CardProps = {
  title?: ReactNode;
  desc?: ReactNode;
  content?: ReactNode;
  bottom?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function Card({
  title,
  desc,
  content,
  bottom,
  children,
  className = "",
}: CardProps) {
  return (
    <article
      className={[
        "rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 text-[var(--color-text-primary)] shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]",
        className,
      ].join(" ")}
    >
      {title || desc ? (
        <header className="space-y-3">
          {title ? <div>{title}</div> : null}
          {desc ? <div>{desc}</div> : null}
        </header>
      ) : null}
      {content ? <div className="mt-4">{content}</div> : null}
      {children ? <div className="mt-4">{children}</div> : null}
      {bottom ? <footer className="mt-5">{bottom}</footer> : null}
    </article>
  );
}

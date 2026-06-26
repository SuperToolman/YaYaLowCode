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
        "rounded-3xl border border-[var(--line)] bg-white p-4 shadow-[0_14px_40px_rgba(17,44,84,0.06)] transition-shadow hover:shadow-[0_18px_48px_rgba(17,44,84,0.1)]",
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

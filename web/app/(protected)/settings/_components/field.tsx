export const inputClassName =
  "mt-2 h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--color-primary-soft)]";

export function Field({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <label className="block text-sm font-medium text-[var(--color-text-primary)]">
      {label}
      <div className="mt-2">{children}</div>
      {hint ? (
        <span className="mt-2 block text-xs font-normal text-[var(--color-text-secondary)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

import { Comment } from "@gravity-ui/icons";

export function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center text-center text-[var(--color-text-secondary)]">
      <div>
        <Comment />
        <p>{text}</p>
      </div>
    </div>
  );
}

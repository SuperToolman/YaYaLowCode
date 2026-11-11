"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import type { KeyboardEvent } from "react";

export type FormulaEditorHandle = {
  insertText: (text: string, selectionOffset?: number) => void;
};

export const FormulaEditor = forwardRef<
  FormulaEditorHandle,
  {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
  }
>(function FormulaEditor({ value, onChange, placeholder, className }, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      insertText(text, selectionOffset = 0) {
        const input = inputRef.current;
        if (!input) return onChange(`${value}${text}`);
        const start = input.selectionStart;
        const next = `${value.slice(0, start)}${text}${value.slice(input.selectionEnd)}`;
        onChange(next);
        requestAnimationFrame(() => {
          input.focus();
          input.setSelectionRange(
            start + text.length + selectionOffset,
            start + text.length + selectionOffset,
          );
        });
      },
    }),
    [onChange, value],
  );
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      const input = inputRef.current;
      if (input) {
        const start = input.selectionStart;
        onChange(
          `${value.slice(0, start)}  ${value.slice(input.selectionEnd)}`,
        );
        requestAnimationFrame(() =>
          input.setSelectionRange(start + 2, start + 2),
        );
      }
    }
  }
  return (
    <textarea
      ref={inputRef}
      aria-label="公式编辑器"
      className={
        className ??
        "h-full min-h-[220px] w-full resize-none rounded-md border p-3 font-mono text-sm outline-none"
      }
      placeholder={placeholder}
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  );
});

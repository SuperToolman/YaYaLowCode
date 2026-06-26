/**
 * 字段公式编辑器
 * */

"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import type { KeyboardEvent } from "react";

type FormulaEditorProps = {
  isDisabled?: boolean;
  onChange: (value: string) => void;
  value: string;
};

export const FormulaEditor = forwardRef<HTMLTextAreaElement, FormulaEditorProps>(
  function FormulaEditor({ isDisabled, onChange, value }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(ref, () => textareaRef.current!, []);

    function insertText(text: string) {
      const textarea = textareaRef.current;

      if (!textarea) {
        onChange(`${value}${text}`);
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentValue = textarea.value;
      const nextValue = `${currentValue.slice(0, start)}${text}${currentValue.slice(
        end,
      )}`;
      const nextPosition = start + text.length;

      onChange(nextValue);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(nextPosition, nextPosition);
      });
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key !== "Tab") {
        return;
      }

      event.preventDefault();
      insertText("  ");
    }

    return (
      <textarea
        ref={textareaRef}
        aria-label="公式编辑器"
        className="h-full min-h-[220px] w-full resize-none rounded-lg border border-[#d7dee9] bg-white px-3 py-3 font-mono text-[15px] leading-6 text-[#202f45] outline-none transition placeholder:text-[#9aa6b6] focus:border-[#2f6bff] focus:ring-2 focus:ring-[#2f6bff]/10 disabled:cursor-not-allowed disabled:bg-[#f6f8fb] disabled:text-[#9aa6b6]"
        disabled={isDisabled}
        placeholder="请输入公式，例如：@SUM($number_1, 100)"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
    );
  },
);

"use client";

import dynamic from "next/dynamic";
import type { EditorProps } from "@monaco-editor/react";

const Editor = dynamic(async () => {
  const { default: Editor, loader } = await import("@monaco-editor/react");
  // Keep the editor, language services and workers on the application's origin.
  loader.config({ paths: { vs: "/monaco/vs" } });
  return Editor;
}, {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-[var(--color-text-secondary)]">编辑器加载中...</div>,
});

export type MonacoEditorProps = EditorProps;

/** Shared Monaco setup; consumers can override every option and editor callback. */
export function MonacoEditor({ options, height = "360px", theme = "vs-dark", ...props }: MonacoEditorProps) {
  return (
    <Editor
      {...props}
      height={height}
      theme={theme}
      options={{
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbersMinChars: 3,
        padding: { top: 16, bottom: 16 },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        ...options,
      }}
    />
  );
}

export default MonacoEditor;

"use client";

import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Input } from "@heroui/react";
import { Modal } from "@heroui/react/modal";

export type AutomationFormulaField = {
  key: string;
  label: string;
  fieldType: string;
};

type FormulaFunction = {
  name: string;
  category: string;
  description: string;
  example: string;
};

const formulaFunctions: FormulaFunction[] = [
  {
    name: "SUM",
    category: "常用函数",
    description: "计算一组数值的总和。",
    example: "SUM($amount, 100)",
  },
  {
    name: "AVERAGE",
    category: "常用函数",
    description: "计算一组数值的平均值。",
    example: "AVERAGE($score_a, $score_b)",
  },
  {
    name: "IF",
    category: "逻辑函数",
    description: "根据条件返回两个结果之一。",
    example: 'IF($status == "通过", 1, 0)',
  },
  {
    name: "AND",
    category: "逻辑函数",
    description: "所有条件为真时返回真。",
    example: "AND($amount > 0, $enabled == true)",
  },
  {
    name: "OR",
    category: "逻辑函数",
    description: "任一条件为真时返回真。",
    example: "OR($level == 1, $level == 2)",
  },
  {
    name: "CONCAT",
    category: "文本函数",
    description: "按顺序拼接多个文本值。",
    example: 'CONCAT($first_name, " ", $last_name)',
  },
];

export function AutomationFormulaEditorModal({
  fields,
  fieldLabel,
  isOpen,
  value,
  onChange,
  onConfirm,
  onOpenChange,
}: {
  fields: AutomationFormulaField[];
  fieldLabel: string;
  isOpen: boolean;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const formulaInputRef = useRef<FormulaTokenEditorHandle>(null);
  const [fieldKeyword, setFieldKeyword] = useState("");
  const [functionKeyword, setFunctionKeyword] = useState("");
  const [activeFunction, setActiveFunction] = useState(formulaFunctions[0]);

  const visibleFields = useMemo(() => {
    const keyword = fieldKeyword.trim().toLocaleLowerCase();
    if (!keyword) return fields;

    return fields.filter((field) => field.label.toLocaleLowerCase().includes(keyword));
  }, [fieldKeyword, fields]);
  const visibleFunctions = useMemo(() => {
    const keyword = functionKeyword.trim().toLocaleLowerCase();
    if (!keyword) return formulaFunctions;

    return formulaFunctions.filter((item) => item.name.toLocaleLowerCase().includes(keyword));
  }, [functionKeyword]);

  function insertText(text: string, selectionOffset = 0) {
    formulaInputRef.current?.insertText(text, selectionOffset);
  }

  function selectFunction(item: FormulaFunction) {
    setActiveFunction(item);
    insertText(`${item.name}()`, -1);
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="cover">
          <Modal.Dialog className="flex h-[min(680px,88vh)] w-[min(960px,96vw)] max-w-[96vw] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
              <Modal.Heading className="text-lg font-semibold">公式设置</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭公式编辑器" />
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-hidden p-4">
              <div className="flex h-full min-h-0 flex-col gap-3">
                <section className="flex min-h-[230px] flex-1 flex-col overflow-hidden rounded-lg border border-[var(--color-border)]">
                  <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs">
                    <span className="font-semibold text-[var(--color-text-primary)]">公式编辑</span>
                    <span className="text-[var(--color-text-secondary)]">使用数学运算符编辑公式</span>
                  </div>
                  <div className="min-h-0 flex-1 bg-[var(--color-bg-input)] p-2">
                    <FormulaTokenEditor
                      ref={formulaInputRef}
                      fields={fields}
                      value={value}
                      onChange={onChange}
                    />
                  </div>
                </section>

                <div className="grid min-h-0 grid-cols-1 gap-3 md:h-[230px] md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.45fr)]">
                  <FormulaPanel title="公式字段">
                    <Input
                      aria-label="搜索字段"
                      fullWidth
                      className="h-8 min-h-8 text-xs"
                      placeholder="搜索字段"
                      value={fieldKeyword}
                      onChange={(event) => setFieldKeyword(event.currentTarget.value)}
                    />
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {visibleFields.length > 0 ? (
                        <div className="space-y-1 p-1">
                          {visibleFields.map((field) => (
                            <Button
                              key={field.key}
                              fullWidth
                              variant="ghost"
                              className="h-8 justify-start px-2 text-left text-xs"
                              onPress={() => formulaInputRef.current?.insertText(`$${field.key}`)}
                            >
                              <span className="truncate">{field.label}</span>
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <div className="px-3 py-5 text-xs text-[var(--color-text-secondary)]">未找到字段</div>
                      )}
                    </div>
                  </FormulaPanel>

                  <FormulaPanel title="函数列表">
                    <Input
                      aria-label="搜索函数"
                      fullWidth
                      className="h-8 min-h-8 text-xs"
                      placeholder="搜索函数"
                      value={functionKeyword}
                      onChange={(event) => setFunctionKeyword(event.currentTarget.value)}
                    />
                    <div className="min-h-0 flex-1 overflow-y-auto p-1">
                      {visibleFunctions.map((item) => (
                        <Button
                          key={item.name}
                          fullWidth
                          variant="ghost"
                          className="h-8 justify-start px-2 text-xs"
                          onPress={() => selectFunction(item)}
                        >
                          {item.name}
                        </Button>
                      ))}
                    </div>
                  </FormulaPanel>

                  <section className="min-h-0 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3 text-xs leading-6 text-[var(--color-text-secondary)]">
                    <div className="font-semibold text-[var(--color-text-primary)]">{activeFunction.name}</div>
                    <p className="mt-2">{activeFunction.description}</p>
                    <p className="mt-2">
                      用法：<code className="font-mono text-[var(--color-primary)]">{activeFunction.name}(参数1, 参数2)</code>
                    </p>
                    <p>
                      示例：<code className="font-mono text-[var(--color-primary)]">{activeFunction.example}</code>
                    </p>
                    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
                      <div className="font-medium text-[var(--color-text-primary)]">{fieldLabel}</div>
                      <p className="mt-1">从左侧选择来源字段或函数后，会插入到当前光标位置。</p>
                    </div>
                  </section>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="border-t border-[var(--color-border)] px-5 py-3">
              <Button variant="ghost" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onPress={onConfirm}>确定</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

type FormulaTokenEditorHandle = {
  insertText: (text: string, selectionOffset?: number) => void;
};

const FormulaTokenEditor = forwardRef<FormulaTokenEditorHandle, {
  fields: AutomationFormulaField[];
  value: string;
  onChange: (value: string) => void;
}>(function FormulaTokenEditor({ fields, value, onChange }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingCaretOffset = useRef<number | null>(null);
  const fieldLabels = useMemo(
    () => new Map(fields.map((field) => [`$${field.key}`, field.label])),
    [fields],
  );

  useImperativeHandle(ref, () => ({
    insertText(text, selectionOffset = 0) {
      const editor = editorRef.current;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const start = editor && range && editor.contains(range.startContainer)
        ? getFormulaOffset(editor, range.startContainer, range.startOffset)
        : value.length;
      const end = editor && range && editor.contains(range.endContainer)
        ? getFormulaOffset(editor, range.endContainer, range.endOffset)
        : value.length;
      const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;

      pendingCaretOffset.current = start + text.length + selectionOffset;
      onChange(nextValue);
    },
  }), [onChange, value]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const caretOffset = pendingCaretOffset.current;
    if (!editor) return;

    pendingCaretOffset.current = null;
    if (serializeFormulaNode(editor) !== value) {
      renderFormulaDom(editor, value, fieldLabels);
      if (caretOffset !== null) {
        placeFormulaCaret(editor, caretOffset);
      }
    }
  }, [fieldLabels, value]);

  function handleInput() {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    pendingCaretOffset.current = range && editor.contains(range.startContainer)
      ? getFormulaOffset(editor, range.startContainer, range.startOffset)
      : null;
    onChange(serializeFormulaNode(editor));
  }

  return (
    <div
      ref={editorRef}
      aria-label="公式编辑器"
      aria-multiline="true"
      className="h-full min-h-[220px] w-full overflow-y-auto rounded-md border border-[var(--designer-border)] bg-[var(--color-bg-input)] px-3 py-3 font-mono text-sm leading-6 text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-soft)]"
      contentEditable
      role="textbox"
      spellCheck={false}
      suppressContentEditableWarning
      onInput={handleInput}
    />
  );
});

function renderFormulaDom(editor: HTMLElement, value: string, fieldLabels: Map<string, string>) {
  const fragment = document.createDocumentFragment();
  const tokenPattern = /\$[A-Za-z0-9:_-]+/g;
  let lastIndex = 0;

  for (const match of value.matchAll(tokenPattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      fragment.append(document.createTextNode(value.slice(lastIndex, start)));
    }

    const label = fieldLabels.get(token);
    if (label) {
      const tag = document.createElement("span");
      tag.className = "mx-0.5 inline-flex rounded bg-[var(--color-primary-soft)] px-1.5 py-0.5 font-sans text-xs leading-5 text-[var(--color-primary)]";
      tag.contentEditable = "false";
      tag.dataset.formulaToken = token;
      tag.textContent = label;
      fragment.append(tag);
    } else {
      fragment.append(document.createTextNode(token));
    }
    lastIndex = start + token.length;
  }

  if (lastIndex < value.length || fragment.childNodes.length === 0) {
    fragment.append(document.createTextNode(value.slice(lastIndex)));
  }

  editor.replaceChildren(fragment);
}

function serializeFormulaNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLElement && node.dataset.formulaToken) {
    return node.dataset.formulaToken;
  }

  return Array.from(node.childNodes).map(serializeFormulaNode).join("");
}

function getFormulaOffset(editor: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.setEnd(node, offset);
  return serializeFormulaNode(range.cloneContents()).length;
}

function placeFormulaCaret(editor: HTMLElement, offset: number) {
  const range = document.createRange();
  let remaining = offset;
  let isPlaced = false;

  for (const node of Array.from(editor.childNodes)) {
    const length = serializeFormulaNode(node).length;
    if (node.nodeType === Node.TEXT_NODE) {
      const textLength = node.textContent?.length ?? 0;
      if (remaining <= textLength) {
        range.setStart(node, remaining);
        range.collapse(true);
        isPlaced = true;
        break;
      }
    } else if (remaining <= length) {
      if (remaining === 0) range.setStartBefore(node);
      else range.setStartAfter(node);
      range.collapse(true);
      isPlaced = true;
      break;
    }
    remaining -= length;
  }

  if (!isPlaced) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  editor.focus();
}

function FormulaPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)]">
        {title}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">{children}</div>
    </section>
  );
}

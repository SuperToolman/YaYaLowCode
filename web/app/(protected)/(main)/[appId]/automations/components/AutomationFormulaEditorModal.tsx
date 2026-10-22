"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "@heroui/react";
import { FormulaEditor, type FormulaEditorHandle } from "@global-components/formula-editor/FormulaEditor";
import { FORMULA_FUNCTION_ITEMS } from "@global-components/formula-editor/formula-definitions";
import { Modal } from "@heroui/react/modal";

export type AutomationFormulaField = {
  key: string;
  label: string;
  fieldType: string;
};



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
  const formulaInputRef = useRef<FormulaEditorHandle>(null);
  const [fieldKeyword, setFieldKeyword] = useState("");
  const [functionKeyword, setFunctionKeyword] = useState("");
  const [activeFunction, setActiveFunction] = useState(FORMULA_FUNCTION_ITEMS[0]);

  const visibleFields = useMemo(() => {
    const keyword = fieldKeyword.trim().toLocaleLowerCase();
    if (!keyword) return fields;

    return fields.filter((field) => field.label.toLocaleLowerCase().includes(keyword));
  }, [fieldKeyword, fields]);
  const visibleFunctions = useMemo(() => {
    const keyword = functionKeyword.trim().toLocaleLowerCase();
    if (!keyword) return FORMULA_FUNCTION_ITEMS;

    return FORMULA_FUNCTION_ITEMS.filter((item) => item.name.toLocaleLowerCase().includes(keyword));
  }, [functionKeyword]);

  function insertText(text: string, selectionOffset = 0) {
    formulaInputRef.current?.insertText(text, selectionOffset);
  }

  function selectFunction(item: (typeof FORMULA_FUNCTION_ITEMS)[number]) {
    setActiveFunction(item);
    insertText(`${item.name}()`, -1);
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="cover">
          <Modal.Dialog className="flex h-[min(680px,88vh)] w-[min(960px,96vw)] max-w-[96vw] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--color-border)]">
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
                    <FormulaEditor
                      ref={formulaInputRef}
                      value={value}
                      onChange={onChange}
                      className="h-full min-h-[220px] w-full overflow-y-auto rounded-md border border-[var(--designer-border)] bg-[var(--color-bg-input)] px-3 py-3 font-mono text-sm leading-6 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
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
                          onPress={() => { setActiveFunction(item); insertText(`${item.name}()`, -1); }}
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
                          示例：<code className="font-mono text-[var(--color-primary)]">{activeFunction.name}(...)</code>
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

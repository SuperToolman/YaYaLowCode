import React, { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesignerCanvas } from "./DesignerCanvas";
import type { PlacedField } from "../designer-types";

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("@/features/form-runtime/components/RuntimeFormRenderer", () => ({ RuntimeFieldNode: ({ field }: { field: PlacedField }) => {
  renders.set(field.id, (renders.get(field.id) ?? 0) + 1); return <input aria-label={field.id} />;
} }));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => undefined, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => undefined, isOver: false }),
}));
vi.mock("@heroui/react", () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));
afterEach(() => { cleanup(); renders.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const measured = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  let iterations = 0;
  const fields = new Proxy(Array.from({ length: 300 }, (_, index): PlacedField => ({
    id: `f${index}`, type: "singleLineText", label: `字段${index}`, row: index, column: 0,
    rowSpan: 1, colSpan: 1, props: {}, parentGroupId: null,
  })), { get(target, key, receiver) {
    if (key === Symbol.iterator) return function* () { iterations++; yield* target; };
    return Reflect.get(target, key, receiver);
  } });
  const props = { fields, gridRef: createRef<HTMLDivElement>(), insertionIndicator: null,
    rowCount: 300, selectedFieldId: null, showMatrix: false,
    onCanvasClick: vi.fn(), onFieldSelect: vi.fn(), onResizePointerDown: vi.fn(),
    onResizePointerMove: vi.fn(), onResizePointerUp: vi.fn(), onResizePointerCancel: vi.fn(),
  };
  const view = render(<DesignerCanvas {...props} />);
  renders.clear(); measured.mockClear(); iterations = 0;
  return { ...view, props, measured, getIterations: () => iterations };
}

it("300 个字段切换选择只执行前后选中字段，不重建父子索引", () => {
  const { rerender, props, getIterations, measured } = setup();
  rerender(<DesignerCanvas {...props} selectedFieldId="f0" />);
  expect([...renders.keys()]).toEqual(["f0"]);
  renders.clear();
  rerender(<DesignerCanvas {...props} selectedFieldId="f1" />);
  expect([...renders.keys()]).toEqual(["f0", "f1"]);
  expect(getIterations()).toBe(0);
  expect(measured).not.toHaveBeenCalled();
});

it("缩放预览不做全量位置测量，提交后只测量受影响行及之后的区域", () => {
  const { rerender, props, measured } = setup();
  const fields = props.fields.map((f) => f.id === "f299" ? { ...f, rowSpan: 2 } : f);
  rerender(<DesignerCanvas {...props} fields={fields} rowCount={301} showMatrix />);
  expect(measured).not.toHaveBeenCalled();
  measured.mockClear();
  rerender(<DesignerCanvas {...props} fields={fields} rowCount={301} />);
  expect(measured).toHaveBeenCalledTimes(1);
});

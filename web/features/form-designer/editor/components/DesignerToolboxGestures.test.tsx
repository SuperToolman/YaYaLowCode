import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompTool } from "./CompTool";

class TestPointerEvent extends MouseEvent {
  pointerId = 1;
  isPrimary = true;
}

function ExistingField() {
  const { setNodeRef, listeners } = useDraggable({ id: "field", data: { kind: "field" } });
  return <button ref={setNodeRef} {...listeners}>existing field</button>;
}

function setup() {
  const onAdd = vi.fn();
  const onDragStart = vi.fn();
  const onDragEnd = vi.fn();
  function Harness() {
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
    return <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <CompTool embedded onAddComponent={onAdd} />
      <ExistingField />
    </DndContext>;
  }
  render(<Harness />);
  return { onAdd, onDragStart, onDragEnd, card: screen.getByRole("button", { name: "单行文本" }) };
}

function pointerDown(card: HTMLElement) {
  const event = createEvent.pointerDown(card, { button: 0, clientX: 0, clientY: 0 });
  Object.defineProperty(event, "timeStamp", { value: 1000 });
  fireEvent(card, event);
}

function release(card: HTMLElement, elapsed: number) {
  fireEvent.pointerUp(card);
  const event = createEvent.click(card);
  Object.defineProperty(event, "timeStamp", { value: 1000 + elapsed });
  fireEvent(card, event);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("toolbox gestures with the native pointer sensor", () => {
  it("adds once on a short click without activating drag", () => {
    const { card, onAdd, onDragStart } = setup();
    pointerDown(card);
    fireEvent.pointerMove(document, { clientX: 3 });
    act(() => vi.advanceTimersByTime(99));
    release(card, 99);
    act(() => vi.advanceTimersByTime(200));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("singleLineText");
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("drags after a long press without also adding on release", () => {
    const { card, onAdd, onDragStart, onDragEnd } = setup();
    pointerDown(card);
    act(() => vi.advanceTimersByTime(101));
    fireEvent.pointerMove(document, { clientX: 7 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(document, { clientX: 50 });
    release(card, 101);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("keeps native drag responsive when movement starts within 100ms", () => {
    const { card, onAdd, onDragStart, onDragEnd } = setup();
    pointerDown(card);
    fireEvent.pointerMove(document, { clientX: 7 });
    fireEvent.pointerMove(document, { clientX: 250, clientY: 80 });
    act(() => vi.advanceTimersByTime(101));
    expect(onDragStart).toHaveBeenCalledTimes(1);
    release(card, 150);
    expect(onDragEnd.mock.calls[0]?.[0].delta).toMatchObject({ x: 250, y: 80 });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("does not add after pointer cancellation", () => {
    const { card, onAdd, onDragStart } = setup();
    pointerDown(card);
    fireEvent.pointerCancel(card);
    release(card, 50);
    act(() => vi.advanceTimersByTime(200));
    expect(onAdd).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("keeps the existing field drag distance threshold", () => {
    const { onDragStart } = setup();
    pointerDown(screen.getByRole("button", { name: "existing field" }));
    fireEvent.pointerMove(document, { clientX: 5 });
    expect(onDragStart).not.toHaveBeenCalled();
    fireEvent.pointerMove(document, { clientX: 7 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});

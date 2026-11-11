import { expect, it, vi } from "vitest";
import { createRuntimeFormStore } from "./runtime-form-store";

it("字段快照隔离、批量通知且事务内立即读到最新值", () => {
  const store = createRuntimeFormStore({ values: { a: 1, b: 2 }, dataSources: {}, formulaErrors: {} });
  const a = store.getFieldSnapshot("a");
  const b = store.getFieldSnapshot("b");
  const onA = vi.fn(), onB = vi.fn(), onValues = vi.fn();
  store.subscribeField("a", onA); store.subscribeField("b", onB); store.subscribe(onValues);
  store.batch(() => {
    store.publish({ ...store.getState(), values: { a: 3, b: 2 } });
    expect(store.getValues().a).toBe(3);
    store.publish({ ...store.getState(), values: { a: 4, b: 2 } });
    expect(onValues).not.toHaveBeenCalled();
  });
  expect(store.getFieldSnapshot("a")).not.toBe(a);
  expect(store.getFieldSnapshot("b")).toBe(b);
  expect(onA).toHaveBeenCalledTimes(1); expect(onB).not.toHaveBeenCalled();
  expect(onValues).toHaveBeenCalledTimes(1);
});

it("校验与公式错误只通知对应字段，清除错误同样发布", () => {
  const store = createRuntimeFormStore({ values: { a: 1 }, dataSources: {}, formulaErrors: {} });
  store.getFieldSnapshot("a"); store.getFieldSnapshot("sub:0:b");
  const onA = vi.fn(), onCell = vi.fn();
  const unsubscribe = store.subscribeField("a", onA);
  store.subscribeField("sub:0:b", onCell);
  store.publish(store.getState(), { "sub:0:b": "必填" });
  expect(onA).not.toHaveBeenCalled(); expect(onCell).toHaveBeenCalledTimes(1);
  store.publish({ ...store.getState(), formulaErrors: { a: "公式错误" } }, {});
  expect(onA).toHaveBeenCalledTimes(1); expect(onCell).toHaveBeenCalledTimes(2);
  unsubscribe();
  store.publish({ ...store.getState(), formulaErrors: {} });
  expect(onA).toHaveBeenCalledTimes(1);
});

it("独立实例不共享数据，异常结束批处理仍释放通知", () => {
  const initial = { values: {}, dataSources: {}, formulaErrors: {} };
  const first = createRuntimeFormStore(initial), second = createRuntimeFormStore(initial);
  const listener = vi.fn(); first.subscribe(listener);
  expect(() => first.batch(() => {
    first.publish({ ...first.getState(), values: { x: 1 } });
    throw new Error("test");
  })).toThrow("test");
  expect(listener).toHaveBeenCalledTimes(1);
  expect(second.getValues()).toEqual({});
});

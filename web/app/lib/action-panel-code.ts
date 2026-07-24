type LegacyFieldEventLike = {
  fieldId?: string;
  eventName?: string;
  script?: string;
};

type LegacyActionPanelLike = {
  code?: string;
  didMount?: string;
  onSubmit?: string;
  fieldEvents?: LegacyFieldEventLike[];
};

export function getDefaultActionPanelCode() {
  return [
    "/** @param {ActionContext} ctx */",
    "function didMount(ctx) {",
    "  const { state, helpers } = ctx;",
    "  // state.urlParams.id",
    "  // helpers.setDataSource('currentUser', { id: '1', name: '张三' });",
    "}",
    "",
    "/** @param {ActionContext} ctx */",
    "function onFieldEvent(ctx) {",
    "  const { fieldId, eventName, value, label, helpers } = ctx;",
    "  // 级联选择时：value 为点分隔值路径，label 为点分隔标签路径。",
    "  // $('cascader-1')?.value / $('cascader-1')?.label",
    "  // helpers.getCountryCity('countryCity-1')?.path.at(-1)?.name",
    "  // helpers.getCascader('cascader-1') // { value: 'part.part_a', label: '部门.A部门' }",
    "  // if (fieldId === 'singleLineText-1' && eventName === 'onChange') {",
    "  //   helpers.setFieldValue('singleLineText-2', value);",
    "  // }",
    "}",
    "",
    "/** @param {ActionContext} ctx */",
    "function onSubmit(ctx) {",
    "  const { values } = ctx;",
    "  return values;",
    "}",
  ].join("\n");
}

export function normalizeActionPanelCode(actionPanel?: LegacyActionPanelLike | null) {
  if (actionPanel?.code && actionPanel.code.trim()) {
    return actionPanel.code;
  }

  const didMountBody = normalizeScriptBody(actionPanel?.didMount);
  const onSubmitBody = normalizeScriptBody(actionPanel?.onSubmit, "return ctx.values;");
  const fieldEventBodies = (actionPanel?.fieldEvents ?? [])
    .map((event) => {
      const fieldId = JSON.stringify(event.fieldId ?? "");
      const eventName = JSON.stringify(event.eventName ?? "onChange");
      const body = indentScript(normalizeScriptBody(event.script), 4);

      if (!body.trim()) {
        return "";
      }

      return [
        `  if (ctx.fieldId === ${fieldId} && ctx.eventName === ${eventName}) {`,
        body,
        "    return;",
        "  }",
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  if (!didMountBody.trim() && !fieldEventBodies.trim() && !onSubmitBody.trim()) {
    return getDefaultActionPanelCode();
  }

  return [
    "function didMount(ctx) {",
    indentScript(didMountBody, 2),
    "}",
    "",
    "function onFieldEvent(ctx) {",
    fieldEventBodies.trim() ? fieldEventBodies : "  // field event handlers",
    "}",
    "",
    "function onSubmit(ctx) {",
    indentScript(onSubmitBody || "return ctx.values;", 2),
    "}",
  ].join("\n");
}

export function validateActionPanelCode(code: string) {
  try {
    new Function(`${code}\nreturn true;`);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "动作脚本校验失败";
  }
}

function normalizeScriptBody(script?: string, fallback = "") {
  const trimmed = script?.trim();
  return trimmed ? trimmed : fallback;
}

function indentScript(script: string, spaces: number) {
  const prefix = " ".repeat(spaces);
  return script
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

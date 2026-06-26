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
    "  const { fieldId, eventName, value, helpers } = ctx;",
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

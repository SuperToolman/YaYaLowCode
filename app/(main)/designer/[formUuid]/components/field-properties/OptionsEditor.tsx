/**
 * 字段选项编辑器
 * */



"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { InputGroup } from "@heroui/react";
import {
  normalizeFieldOptions,
  type DesignerFieldProps,
} from "../CompTool";
import {
  createOptionsFromText,
  serializeOptions,
} from "../../designer-options";
import type {
  FieldPropsChangeHandler,
  PlacedField,
} from "../../designer-types";

export function OptionsEditor({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const [draftValue, setDraftValue] = useState(() =>
    serializeOptions(normalizeFieldOptions(field.props.options, field.type)),
  );

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.currentTarget.value;
    const nextOptions = createOptionsFromText(nextValue);
    const optionValues = new Set(nextOptions.map((option) => option.value));
    const nextProps: DesignerFieldProps = { options: nextOptions };

    setDraftValue(nextValue);

    if (field.type === "checkbox") {
      const selectedValues = Array.isArray(field.props.defaultValue)
        ? field.props.defaultValue
        : [];
      nextProps.defaultValue = selectedValues.filter((item) =>
        optionValues.has(item),
      );
    } else {
      const selectedValue =
        typeof field.props.defaultValue === "string"
          ? field.props.defaultValue
          : "";
      nextProps.defaultValue = optionValues.has(selectedValue)
        ? selectedValue
        : (nextOptions[0]?.value ?? "");
    }

    onPropsChange(field.id, nextProps);
  }

  return (
    <div className="min-w-0 flex-1 space-y-1">
      <InputGroup fullWidth>
        <InputGroup.TextArea
          aria-label="组件选项"
          rows={4}
          value={draftValue}
          onChange={handleChange}
        />
      </InputGroup>
      <p className="text-xs leading-5 text-[#8d9aae]">
        每行一个选项；不写 | 时 value 与 label 一致，写成 label|value
        时二者分开。
      </p>
    </div>
  );
}

"use client";

import { EMPTY_RICH_TEXT_DOCUMENT, isRichTextDocument, formatRuntimeSerialNumber, toOptionalNumber } from "../model/initial-state";
import { getFieldDescription } from "./field-description";
import dynamic from "next/dynamic";
import { memo, useId } from "react";
import type { ChangeEvent } from "react";
import { Button, ErrorMessage, FieldError, Label, Input, InputGroup, Link, NumberField, Radio, RadioGroup, TextField, TextArea } from "@heroui/react";
import { Description } from "@heroui/react/description";
import { TextContext } from "react-aria-components";
import { RuntimeMemberSelect } from "./RuntimeMemberSelect";
import { RuntimeCascaderSelect } from "./RuntimeCascaderSelect";
import { Counter, RuntimeCheckboxOptions, RuntimeClearButton, RuntimeCountryCitySelect, RuntimeDateRangePicker, RuntimeDatePicker, RuntimeMultiSelect, RuntimeSelect, RuntimeUpload } from "./RuntimeFormFieldControls";
import type { RuntimeSchemaField } from "../../form-model/runtime-types";
import { useRuntimeFieldSnapshot } from "./runtime-field-context";
import { normalizeFieldOptions, getRuntimeTitlePosition } from "./runtime-field-layout";

const RichTextEditor = dynamic(
  () =>
    import("@/shared/ui/RichTextEditor").then((module) => module.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div
        aria-label="富文本加载中"
        className="flex min-h-32 w-full animate-pulse flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)]"
      >
        <div className="h-9 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]" />
        <div className="m-3 h-4 w-2/5 rounded bg-[var(--color-bg-subtle)]" />
      </div>
    ),
  },
);
export const FormField = memo(function FormField({
  field,
  formulaError,
  onFieldAction,
  showLabel = true,
  validationKey,
  value,
}: {
  field: RuntimeSchemaField;
  formulaError?: string;
  onFieldAction: (
    fieldId: string,
    nextValue: unknown,
    eventName?: string,
  ) => void;
  showLabel?: boolean;
  validationKey?: string;
  value: unknown;
}) {
  const error = useRuntimeFieldSnapshot(validationKey ?? field.id).error;
  const errorId = useId();
  const usesFieldError = [
    "singleLineText",
    "multiLineText",
    "date",
    "number",
    "radio",
    "select",
    "multiSelect",
    "department",
    "member",
    "dateRange",
  ].includes(field.type);
  const props = field.props ?? {};
  const titlePosition = getRuntimeTitlePosition(
    field.type,
    props.titlePosition,
  );
  const placeholder = props.placeholder ?? "请输入";
  const options = normalizeFieldOptions(props.options, field.type);
  const textValue =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : typeof props.defaultValue === "string"
          ? props.defaultValue
          : "";
  const multiValues = Array.isArray(value)
    ? (value as string[])
    : Array.isArray(props.defaultValue)
      ? props.defaultValue
      : [];
  const numberValue =
    typeof value === "number"
      ? value
      : (toOptionalNumber(value as string | number | string[] | undefined) ??
        toOptionalNumber(
          props.defaultValue as string | number | string[] | undefined,
        ));
  const description = getFieldDescription(field.type, props);
  const orientation =
    field.type === "radio" || field.type === "checkbox"
      ? "horizontal"
      : (props.orientation ?? "vertical");

  const hasVisibleLabel =
    showLabel &&
    !["button", "description", "link"].includes(field.type) &&
    titlePosition !== "inside";
  const isLeftTitle = hasVisibleLabel && titlePosition === "left";
  const isInsideTitle = titlePosition === "inside";
  const fillsFieldHeight =
    field.type === "multiLineText" || field.type === "richText" ||
    field.type === "attachment" || field.type === "imageUpload";
  const contentClass =
    fillsFieldHeight
      ? "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2"
      : "flex w-full min-w-0 flex-col gap-2";

  return (
    <div
      className={
        isLeftTitle
          ? "grid h-full w-full min-w-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-start gap-3 pt-7"
          : fillsFieldHeight
            ? "flex h-full min-h-0 w-full min-w-0 flex-col"
            : "flex w-full min-w-0 flex-col"
      }
    >
      {hasVisibleLabel ? (
        <Label
          isRequired={
            Boolean(props.isRequired) &&
            !["description", "link", "button", "html", "tsx"].includes(
              field.type,
            )
          }
          className={isLeftTitle ? "max-w-28 truncate pt-2" : "mb-2"}
          htmlFor={field.id}
        >
          {field.label}
        </Label>
      ) : null}
      <div
        className={contentClass}
        role="group"
        aria-label={field.label}
        aria-describedby={error && !usesFieldError ? errorId : undefined}
      >
        {field.type === "singleLineText" ? (
          <TextField
            aria-label={field.label}
            isInvalid={Boolean(error)}
            validationBehavior="aria"
            isRequired={props.isRequired}
            fullWidth
          >
            <div className="relative">
              {isInsideTitle ? (
                <InputGroup fullWidth>
                  <InputGroup.Prefix className="max-w-28 shrink-0">
                    <Label
                      htmlFor={field.id}
                      isRequired={props.isRequired}
                      className="truncate"
                    >
                      {field.label}
                    </Label>
                  </InputGroup.Prefix>
                  <InputGroup.Input
                    id={field.id}
                    aria-label={field.label}
                    disabled={props.isDisabled}
                    placeholder={placeholder}
                    readOnly={props.isReadOnly}
                    required={props.isRequired}
                    value={textValue}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onFieldAction(
                        field.id,
                        event.currentTarget.value,
                        "onChange",
                      )
                    }
                    className="min-w-0 flex-1"
                  />
                </InputGroup>
              ) : (
                <Input
                  id={field.id}
                  aria-label={field.label}
                  disabled={props.isDisabled}
                  placeholder={placeholder}
                  readOnly={props.isReadOnly}
                  required={props.isRequired}
                  value={textValue}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    onFieldAction(
                      field.id,
                      event.currentTarget.value,
                      "onChange",
                    )
                  }
                  fullWidth
                />
              )}
              {props.showClearButton ? (
                <RuntimeClearButton
                  isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
                  onClear={() => onFieldAction(field.id, "", "onChange")}
                />
              ) : null}
              {props.showCounter ? <Counter value={textValue} /> : null}
            </div>
            <FieldError>{error}</FieldError>
          </TextField>
        ) : null}
        {field.type === "description" ? (
          <Description>{textValue || placeholder}</Description>
        ) : null}
        {field.type === "serialNumber" ? (
          <Input
            id={field.id}
            aria-label={field.label}
            disabled={props.isDisabled}
            readOnly
            required={props.isRequired}
            placeholder={props.placeholder ?? "自动生成"}
            value={textValue || formatRuntimeSerialNumber(props)}
            fullWidth
          />
        ) : null}
        {field.type === "multiLineText" ? (
          <TextField
            aria-label={field.label}
            isInvalid={Boolean(error)}
            validationBehavior="aria"
            isRequired={props.isRequired}
            fullWidth
            className="min-h-0 flex-1"
          >
            <div className="relative min-h-0 flex-1">
              <TextArea
                id={field.id}
                aria-label={field.label}
                disabled={props.isDisabled}
                placeholder={placeholder}
                readOnly={props.isReadOnly}
                required={props.isRequired}
                rows={Math.max(2, field.rowSpan ?? 1)}
                fullWidth
                className="h-full resize-none"
                value={textValue}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  onFieldAction(
                    field.id,
                    event.currentTarget.value,
                    "onChange",
                  )
                }
              />
              {props.showClearButton ? (
                <RuntimeClearButton
                  isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
                  onClear={() => onFieldAction(field.id, "", "onChange")}
                />
              ) : null}
              {props.showCounter ? <Counter value={textValue} /> : null}
            </div>
            <FieldError>{error}</FieldError>
          </TextField>
        ) : null}
        {field.type === "richText" ? (
          <RichTextEditor
            ariaLabel={field.label}
            disabled={props.isDisabled}
            readOnly={props.isReadOnly}
            value={isRichTextDocument(value) ? value : EMPTY_RICH_TEXT_DOCUMENT}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "number" ? (
          <NumberField
            aria-label={field.label}
            isRequired={props.isRequired}
            isInvalid={Boolean(error)}
            validationBehavior="aria"
            value={numberValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue ?? "", "onChange")
            }
            isDisabled={props.isDisabled}
            isReadOnly={props.isReadOnly}
            maxValue={props.maxValue}
            minValue={props.minValue}
            fullWidth
          >
            <NumberField.Group>
              <NumberField.DecrementButton>-</NumberField.DecrementButton>
              <NumberField.Input id={field.id} placeholder={placeholder} />
              <NumberField.IncrementButton>+</NumberField.IncrementButton>
            </NumberField.Group>
            <FieldError>{error}</FieldError>
          </NumberField>
        ) : null}
        {field.type === "radio" ? (
          <RadioGroup
            aria-label={field.label}
            orientation={orientation}
            isInvalid={Boolean(error)}
            validationBehavior="aria"
            value={textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
            isDisabled={props.isDisabled}
            isReadOnly={props.isReadOnly}
            isRequired={props.isRequired}
          >
            {options.map((option) => (
              <Radio key={option.value} value={option.value}>
                <Radio.Content className="text-[12px]">
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  {option.label}
                </Radio.Content>
              </Radio>
            ))}
            <FieldError>{error}</FieldError>
          </RadioGroup>
        ) : null}
        {field.type === "checkbox" ? (
          <RuntimeCheckboxOptions
            ariaLabel={field.label}
            isInvalid={Boolean(error)}
            className={
              orientation === "horizontal"
                ? "flex flex-row flex-wrap items-center gap-x-3 gap-y-1.5"
                : "flex flex-col items-start gap-1.5"
            }
            value={multiValues}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
            options={options}
            isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
            isRequired={props.isRequired}
          />
        ) : null}
        {field.type === "select" || field.type === "department" ? (
          <RuntimeSelect
            field={field}
            errorMessage={error}
            options={options}
            placeholder={placeholder}
            props={props}
            value={textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "member" ? (
          <RuntimeMemberSelect
            field={field}
            errorMessage={error}
            placeholder={placeholder}
            props={props}
            value={props.memberMultiple ? multiValues : textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "countryCity" ? (
          <RuntimeCountryCitySelect
            field={field}
            props={props}
            value={value}
            onChange={(nextValue, eventName) =>
              onFieldAction(field.id, nextValue, eventName)
            }
          />
        ) : null}
        {field.type === "cascader" ? (
          <RuntimeCascaderSelect
            ariaLabel={field.label}
            dataSource={props.dataSource}
            isDisabled={props.isDisabled}
            isReadOnly={props.isReadOnly}
            placeholder={placeholder}
            value={textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "multiSelect" ? (
          <RuntimeMultiSelect
            field={field}
            errorMessage={error}
            options={options}
            placeholder={placeholder}
            props={props}
            value={multiValues}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "link" ? (
          <Link href={props.href || "#"} target={props.target}>
            {textValue || "打开链接"}
            <Link.Icon />
          </Link>
        ) : null}
        {field.type === "date" ? (
          <RuntimeDatePicker
            field={field}
            errorMessage={error}
            props={props}
            value={textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "dateRange" ? (
          <RuntimeDateRangePicker
            field={field}
            errorMessage={error}
            props={props}
            value={multiValues}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "attachment" || field.type === "imageUpload" ? (
          <RuntimeUpload
            field={field}
            props={props}
            value={value}
            onFilesCommitted={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "button" ? (
          <Button
            type="button"
            isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
            onPress={() => {
              if (props.isReadOnly) return;
              onFieldAction(field.id, value ?? "", "onClick");
            }}
          >
            {props.buttonText || field.label}
          </Button>
        ) : null}
        {description ? (
          <TextContext.Provider value={null}>
            <Description
              style={{ display: "block" }}
              className="text-sm text-[var(--color-text-secondary)]"
            >
              {description}
            </Description>
          </TextContext.Provider>
        ) : null}
        {error && !usesFieldError ? (
          <TextContext.Provider value={null}>
            <ErrorMessage
              style={{ display: "block" }}
              id={errorId}
              role="alert"
            >
              {error}
            </ErrorMessage>
          </TextContext.Provider>
        ) : null}
        {formulaError ? (
          <TextContext.Provider value={null}>
            <ErrorMessage style={{ display: "block" }}>
              公式错误：{formulaError}
            </ErrorMessage>
          </TextContext.Provider>
        ) : null}
      </div>
    </div>
  );
});

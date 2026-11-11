"use client";

import { notifyRequestError } from "@/shared/lib/notify";
import { getMissingRequiredImportFields, assembleImportRecords, buildImportTemplate, getExcelImportFields } from "@/features/records/model/excel-import";
import { notify } from "@/shared/lib/notify";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";
import { buildExcelWorkbook, downloadExcelBuffer, parseExcelFile } from "@/features/records/screen/xlsx-worker-client";
import { deserializeExcelValue, getBuiltinRecordValues, sanitizeFileName, serializeExcelValue } from "@/features/records/screen/form-record-utils";
import type { FormRecord } from "@/features/records/types";
import { useRecordImportExport } from "@/features/records/screen/model/use-record-import-export";
import { buildExcelColumns, formatAssociationExportValue, loadAssociationImportLookup, resolveAssociationImportValue, type AssociationImportLookup } from "@/features/records/model/excel-association";
import { BUILTIN_RECORD_FIELDS } from "@/features/form-model/field-metadata";
import { type ImportWorkbookState } from "@/features/records/screen/components/FormDataImportDrawer";
import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";

type RecordWorkbookOptions = {
 schema: RuntimeFormSchema | null;
 formMetadataName: string;
 formUuid: string;
 selectedRecordIds: Set<string>;
 displayedRecords: FormRecord[];
 visibleFields: RuntimeSchemaField[];
 loadRecords: () => Promise<void>;
 createRecord: (data: Record<string, unknown>) => Promise<unknown>;
};
const EMPTY_IMPORT_STATE: ImportWorkbookState = {
  fileName: "",
  headers: [],
  rows: [],
  mappings: {},
  progress: 0,
  successCount: 0,
  failureCount: 0,
  importing: false,
  completed: false,
};

export function useRecordWorkbook({ schema, formMetadataName, formUuid, selectedRecordIds, displayedRecords, visibleFields, loadRecords, createRecord }: RecordWorkbookOptions) {
  const importController = useRecordImportExport<{
    index: number;
    data: Record<string, unknown>;
  }>(async (input) => {
    await createRecord(input.data);
    return { index: input.index };
  });
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importState, setImportState] =
    useState<ImportWorkbookState>(EMPTY_IMPORT_STATE);
  useEffect(() => {
    if (!importController.running) return;
    const timer = window.setTimeout(
      () =>
        setImportState((current) => ({
          ...current,
          progress: importController.progress.total
            ? Math.round(
                (importController.progress.completed /
                  importController.progress.total) *
                  100,
              )
            : 0,
          successCount: importController.progress.succeeded,
          failureCount: importController.progress.failed,
        })),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [importController.progress, importController.running]);
  const importFileBufferRef = useRef<ArrayBuffer | null>(null);
  const importReadIdRef = useRef(0);

  const importFields = useMemo(
    () => getExcelImportFields(schema?.fields ?? []),
    [schema?.fields],
  );

  const excelFields = useMemo(
    () =>
      visibleFields.filter(
        (field) =>
          !field.props?.isDisabled &&
          !field.props?.isReadOnly &&
          field.props?.defaultValueType !== "formula",
      ),
    [visibleFields],
  );

  async function downloadExcelTemplate() {
    const { matrix, merges } = buildImportTemplate(
      importFields,
      BUILTIN_RECORD_FIELDS,
    );
    const buffer = await buildExcelWorkbook(matrix, "数据", merges);
    downloadExcelBuffer(
      buffer,
      `${sanitizeFileName(formMetadataName || schema?.formName || formUuid)}-导入模板.xlsx`,
    );
  }

  async function exportSelectedRecords() {
    if (selectedRecordIds.size === 0) {
      notify.warning("请选择需要导出的数据", {
        description: "在数据行上悬停并勾选复选框后再导出。",
      });
      return;
    }

    const selectedRecords = displayedRecords.filter((record) =>
      selectedRecordIds.has(record.id),
    );
    const columns = buildExcelColumns(excelFields);
    const resolvedFormName = formMetadataName || schema?.formName || formUuid;
    const associationLookups = new Map<string, AssociationImportLookup>();
    try {
      await Promise.all(
        excelFields
          .filter((field) => field.type === "associationFormField")
          .map(async (field) => {
            const lookup = await loadAssociationImportLookup(field);
            if (lookup) associationLookups.set(field.id, lookup);
          }),
      );
    } catch (error) {
      notifyRequestError(error, "无法导出关联字段", {
        description:
          error instanceof Error ? error.message : "请检查关联表单权限和配置。",
      });
      return;
    }
    const matrix = [
      [
        ...columns.map((column) => column.header),
        ...BUILTIN_RECORD_FIELDS.map((field) => field.label),
      ],
      ...selectedRecords.map((record) => {
        const builtIns = getBuiltinRecordValues(record, resolvedFormName);
        return [
          ...columns.map((column) =>
            column.field.type === "associationFormField"
              ? formatAssociationExportValue(
                  record.data[column.field.id],
                  associationLookups.get(column.field.id),
                )
              : serializeExcelValue(record.data[column.field.id]),
          ),
          ...BUILTIN_RECORD_FIELDS.map((field) => builtIns[field.id]),
        ];
      }),
    ];
    const buffer = await buildExcelWorkbook(matrix);
    downloadExcelBuffer(
      buffer,
      `${sanitizeFileName(formMetadataName || schema?.formName || formUuid)}-数据-${selectedRecords.length}条.xlsx`,
    );
  }

  function openImportModal() {
    importFileBufferRef.current = null;
    importReadIdRef.current += 1;
    setImportState(EMPTY_IMPORT_STATE);
    setIsImportOpen(true);
  }

  async function readImportSheet(
    buffer: ArrayBuffer,
    fileName: string,
    sheetName?: string,
  ) {
    const readId = ++importReadIdRef.current;
    setImportState((current) => ({ ...current, loading: true }));
    try {
      const columns = buildExcelColumns(importFields).map((column) => ({
        id: column.field.id,
        label: column.field.label,
        header: column.header,
      }));
      const result = await parseExcelFile(buffer.slice(0), columns, sheetName);
      if (readId !== importReadIdRef.current) return;
      setImportState({
        ...EMPTY_IMPORT_STATE,
        fileName,
        ...result,
        loading: false,
      });
    } catch (reason) {
      if (readId !== importReadIdRef.current) return;
      notifyRequestError(reason, "无法读取 Excel", {
        description:
          reason instanceof Error ? reason.message : "请检查文件格式。",
      });
      setImportState((current) => ({ ...current, loading: false }));
    }
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    importFileBufferRef.current = buffer;
    await readImportSheet(buffer, file.name);
  }

  async function handleImportSheetChange(sheetName: string) {
    if (importFileBufferRef.current)
      await readImportSheet(
        importFileBufferRef.current,
        importState.fileName,
        sheetName,
      );
  }

  async function importExcelRows() {
    if (importState.loading) return;
    const missingRequiredIds = getMissingRequiredImportFields(
      importFields,
      importState.mappings,
    );
    if (missingRequiredIds.length > 0) {
      notify.error("请匹配所有必填字段", {
        description: importFields
          .filter((field) => missingRequiredIds.includes(field.id))
          .map((field) => field.label)
          .join("、"),
      });
      return;
    }
    setImportState((current) => ({
      ...current,
      importing: true,
      completed: false,
      progress: 0,
      successCount: 0,
      failureCount: 0,
    }));
    const fieldMap = new Map(importFields.map((field) => [field.id, field]));
    const associationFieldIds = [
      ...new Set(
        Object.values(importState.mappings).filter(
          (fieldId) =>
            fieldId && fieldMap.get(fieldId)?.type === "associationFormField",
        ),
      ),
    ];
    const associationLookups = new Map<string, AssociationImportLookup>();

    try {
      await Promise.all(
        associationFieldIds.map(async (fieldId) => {
          const field = fieldMap.get(fieldId);
          if (!field) return;
          const lookup = await loadAssociationImportLookup(field);
          if (lookup) associationLookups.set(fieldId, lookup);
        }),
      );
    } catch (error) {
      setImportState((current) => ({ ...current, importing: false }));
      notifyRequestError(error, "无法解析关联字段", {
        description:
          error instanceof Error ? error.message : "请检查关联表单权限和配置。",
      });
      return;
    }

    let importItems;
    try {
      importItems = assembleImportRecords(
        importState.rows,
        importState.mappings,
        importFields,
        importState.rowGroups,
        (field, cell) =>
          field.type === "associationFormField"
            ? resolveAssociationImportValue(
                cell,
                associationLookups.get(field.id),
              ) || undefined
            : deserializeExcelValue(field, cell),
      );
    } catch (error) {
      setImportState((current) => ({ ...current, importing: false }));
      notifyRequestError(error, "无法导入 Excel", {
        description:
          error instanceof Error ? error.message : "请检查字段匹配。",
      });
      return;
    }
    const { succeeded: successCount, failed: failureCount } =
      await importController.importAll(importItems, 3);

    await loadRecords();
    setImportState((current) => ({
      ...current,
      importing: false,
      completed: true,
      progress: 100,
      successCount,
      failureCount,
    }));
    if (failureCount === 0)
      notify.success("导入完成", {
        description: `成功导入 ${successCount} 条数据。`,
      });
    else
      notify.warning("导入完成", {
        description: `成功 ${successCount} 条，失败 ${failureCount} 条。`,
      });
  }

return { isImportOpen, setIsImportOpen, importState, setImportState, importFields, downloadExcelTemplate, exportSelectedRecords, openImportModal, handleImportFileChange, handleImportSheetChange, importExcelRows };
}

"use client";

import { useMemo, useState } from "react";
import { type Selection } from "@heroui/react";
import type { RuntimeFormSchema, RuntimeSchemaField } from "@/features/form-model/runtime-types";
import { estimateTableColumnWidth, getBuiltinRecordValues, getTableFieldDisplayValue, getVisibleDataFields } from "@/features/records/screen/form-record-utils";
import type { FormRecord } from "@/features/records/types";
import { useAssociationFormsQuery } from "@/features/records/queries";
import { useRuntimeMemberUsers } from "@/features/form-runtime/queries";
import type { IdentityUser } from "@/features/form-runtime/types";
import { getSubformAncestors, getSubformTableFields } from "@/features/records/screen/components/records-table/subform-rows";
import type { RecordTableColumn, TableAssociationFormData } from "./record-table-types";

type TableLayoutOptions = { schema: RuntimeFormSchema; fields: RuntimeSchemaField[]; builtinFields: readonly {id: string; label: string}[]; columnOrder: string[]; };
export function getDynamicColumnWidth(
  label: string,
  values: string[],
  sortable: boolean,
  maxWidth: number,
  adornmentWidth = 0,
) {
  const titleWidth = Math.min(
    maxWidth,
    estimateTableColumnWidth([label], 24, maxWidth) + (sortable ? 20 : 0),
  );
  const contentWidth = estimateTableColumnWidth(
    values,
    24,
    maxWidth,
    adornmentWidth,
  );
  return Math.min(maxWidth, Math.max(titleWidth, contentWidth));
}

export function useRecordTableLayout({ schema, fields, builtinFields, columnOrder }: TableLayoutOptions) {
  const subformFields = useMemo(() => schema.fields.filter((field) => field.type === "subform" && !field.props?.isHidden), [schema.fields]);
  const hasSubforms = subformFields.length > 0;
  const [expandedSubformKeys, setExpandedSubformKeys] = useState<Set<string>>(() => new Set());
  const expandedSubforms = useMemo(() => new Set([...expandedSubformKeys].map((key) => {
    try { return (JSON.parse(key) as [string, string])[1]; } catch { return ""; }
  })), [expandedSubformKeys]);
  const expandedRowKeys = useMemo<Selection>(() => new Set([...expandedSubformKeys].map((key) => {
    try { return (JSON.parse(key) as [string, string])[0]; } catch { return ""; }
  }).filter(Boolean)), [expandedSubformKeys]);
  const hasExpandedRows = expandedSubforms.size > 0;
  const columns = useMemo(() => {
    if (!hasExpandedRows) return getSubformTableFields(fields, schema.fields);
    const selectedTopLevelFields = fields.filter((field) => getSubformAncestors(field, schema.fields).length === 0);
    const expandedSubformFields = getVisibleDataFields(schema.fields).filter(
      (field) => field.type !== "subform" && expandedSubforms.has(getSubformAncestors(field, schema.fields).at(-1)?.id ?? ""),
    );
    const fieldsById = new Map([...selectedTopLevelFields, ...expandedSubformFields].map((field) => [field.id, field]));
    return getSubformTableFields([...fieldsById.values()], schema.fields);
  }, [expandedSubforms, fields, hasExpandedRows, schema.fields]);
  const subformParents = useMemo(() => new Map(columns.map((field) => [field.id, getSubformAncestors(field, schema.fields).at(-1)?.id])), [columns, schema.fields]);
  const memberUsers = useRuntimeMemberUsers(columns.some((field) => field.type === "member"));
  const tableColumns = useMemo(() => {
    const businessColumns = new Map(
      columns.map((field, index) => [
        field.id,
        { kind: "field" as const, field, index },
      ]),
    );
    const builtInColumns = new Map(
      builtinFields.map((field, index) => [
        field.id,
        { kind: "builtin" as const, field, index },
      ]),
    );
    const summaryColumns = new Map(
      subformFields.map((field, index) => [
        field.id,
        {
        kind: "subformSummary",
        field: { id: field.id, label: field.label },
        parentSubformId: getSubformAncestors(field, schema.fields).at(-1)?.id,
        index,
        } satisfies RecordTableColumn,
      ]),
    );
    const allColumns: RecordTableColumn[] = [];
    const appendSubformChildren = (subformId: string) => {
      for (const id of columnOrder) {
        const childColumn = businessColumns.get(id);
        if (!childColumn || subformParents.get(id) !== subformId) continue;
        allColumns.push(childColumn);
        businessColumns.delete(id);
      }
      for (const [id, childColumn] of businessColumns) {
        if (subformParents.get(id) !== subformId) continue;
        allColumns.push(childColumn);
        businessColumns.delete(id);
      }
    };
    columnOrder.forEach((id) => {
      const summaryColumn = summaryColumns.get(id);
      if (summaryColumn) {
        allColumns.push(summaryColumn);
        summaryColumns.delete(id);
        appendSubformChildren(id);
        return;
      }
      const businessColumn = businessColumns.get(id);
      if (businessColumn && !subformParents.get(id)) {
        allColumns.push(businessColumn);
        businessColumns.delete(id);
      }
      const builtinColumn = builtInColumns.get(id);
      if (builtinColumn) {
        allColumns.push(builtinColumn);
        builtInColumns.delete(id);
      }
    });
    for (const [id, businessColumn] of businessColumns) {
      if (subformParents.get(id)) continue;
      allColumns.push(businessColumn);
      businessColumns.delete(id);
    }
    for (const [id, summaryColumn] of summaryColumns) {
      allColumns.push(summaryColumn);
      appendSubformChildren(id);
    }
    allColumns.push(...builtInColumns.values());
    const visibleColumns = allColumns.filter((column) =>
      column.kind !== "field" || hasExpandedRows || !subformParents.get(column.field.id),
    );
    const instanceTitleIndex = visibleColumns.findIndex(
      (column) =>
        column.kind === "builtin" && column.field.id === "instanceTitle",
    );
    const instanceIdIndex = visibleColumns.findIndex(
      (column) => column.kind === "builtin" && column.field.id === "instanceId",
    );
    const withCombinedInstance =
      instanceTitleIndex < 0 || instanceIdIndex < 0
        ? visibleColumns
        : visibleColumns
            .filter(
              (column) =>
                !(
                  column.kind === "builtin" &&
                  (column.field.id === "instanceTitle" ||
                    column.field.id === "instanceId")
                ),
            )
            .toSpliced(Math.min(instanceTitleIndex, instanceIdIndex), 0, {
              kind: "combinedInstance",
              field: { id: "instanceId", label: "实例标题" },
              index: builtinFields.findIndex((field) => field.id === "instanceTitle"),
            });
    const submitterIndex = withCombinedInstance.findIndex(
      (column) => column.kind === "builtin" && column.field.id === "submitter",
    );
    const organizationIndex = withCombinedInstance.findIndex(
      (column) =>
        column.kind === "builtin" &&
        column.field.id === "submitterOrganization",
    );
    if (submitterIndex < 0 || organizationIndex < 0)
      return withCombinedInstance;

    return withCombinedInstance
      .filter(
        (column) =>
          !(
            column.kind === "builtin" &&
            (column.field.id === "submitter" ||
              column.field.id === "submitterOrganization")
          ),
      )
      .toSpliced(Math.min(submitterIndex, organizationIndex), 0, {
        kind: "combinedSubmitter",
        field: { id: "submitter", label: "创建人&组织" },
        index: builtinFields.findIndex((field) => field.id === "submitter"),
      });
  }, [builtinFields, columnOrder, columns, hasExpandedRows, schema.fields, subformFields, subformParents]);
return { subformFields, hasSubforms, expandedSubformKeys, setExpandedSubformKeys, expandedSubforms, expandedRowKeys, hasExpandedRows, columns, subformParents, memberUsers, tableColumns };
}

export function useRecordTableValues({ columns, subformParents, builtinFields, records, formName, formType, memberUsers, sortableFieldIds }: {
 columns: RuntimeSchemaField[];
 subformParents: Map<string, string | undefined>;
 builtinFields: TableLayoutOptions["builtinFields"];
 records: FormRecord[];
 formName: string;
 formType: "normal" | "workflow";
 memberUsers: ReadonlyMap<string, IdentityUser>;
 sortableFieldIds: string[];
}) {
  const associationFormIds = useMemo(
    () => [
      ...new Set(
        columns
          .filter(
            (field) =>
              field.type === "associationFormField" &&
              field.props?.associationFormId,
          )
          .map((field) => field.props!.associationFormId!),
      ),
    ],
    [columns],
  );

  const associationForms = useAssociationFormsQuery(associationFormIds) as Map<
    string,
    TableAssociationFormData
  >;
  const recordDisplayValues = useMemo(() => {
    const values = new Map<
      string,
      {
        fields: Record<string, string>;
        builtIns: Record<string, string>;
      }
    >();

    records.forEach((record) => {
      values.set(record.id, {
        fields: Object.fromEntries(
          columns.map((field) => [
            field.id,
            subformParents.get(field.id) ? "" : getTableFieldDisplayValue(field, record, associationForms, memberUsers),
          ]),
        ),
        builtIns: getBuiltinRecordValues(
          record,
          formName,
          formType === "workflow",
        ),
      });
    });

    return values;
  }, [associationForms, columns, formName, formType, records, memberUsers, subformParents]);
  const businessColumnWidths = useMemo(
    () =>
      columns.map((field) => {
        const memberAvatarWidth =
          field.type === "member"
            ? Math.max(
                0,
                ...records.map((record) => {
                  const value = record.data[field.id];
                  const ids = Array.isArray(value) ? value : [value];
                  return ids.filter(
                    (id): id is string =>
                      typeof id === "string" && memberUsers.has(id),
                  ).length;
                }),
              ) * 30
            : 0;
        return getDynamicColumnWidth(
          field.label,
          records.map(
            (record) =>
              recordDisplayValues.get(record.id)?.fields[field.id] ?? "",
          ),
          sortableFieldIds.includes(field.id),
          320,
          memberAvatarWidth +
            (field.type === "associationFormField" ? 16 : 0),
        );
      }),
    [columns, memberUsers, recordDisplayValues, records, sortableFieldIds],
  );
  const builtInColumnMaxWidths = useMemo(
    () =>
      builtinFields.map((field) => (field.id === "instanceTitle" ? 360 : 260)),
    [builtinFields],
  );
  const builtInColumnWidths = useMemo(
    () =>
      builtinFields.map((field, index) =>
        getDynamicColumnWidth(
          field.label,
          records.map(
            (record) =>
              recordDisplayValues.get(record.id)?.builtIns[field.id] ?? "",
          ),
          sortableFieldIds.includes(field.id),
          builtInColumnMaxWidths[index],
        ),
      ),
    [
      builtInColumnMaxWidths,
      builtinFields,
      recordDisplayValues,
      records,
      sortableFieldIds,
    ],
  );
return { associationForms, recordDisplayValues, businessColumnWidths, builtInColumnWidths };
}

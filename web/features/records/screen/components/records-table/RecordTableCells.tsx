"use client";

import { createContext, useContext } from "react";
import { Avatar } from "@heroui/react";
import { getMemberLabel } from "@/features/form-runtime/member-display";
import type { IdentityUser } from "@/features/form-runtime/types";
import { MyTableCheckbox } from "@/shared/ui/MyTable";
import type { RecordTableRow } from "./record-table-types";

type TableSelectionContextValue = {
  selectedIds: Set<string>;
  pageIds: string[];
  onRowChange: (recordId: string, selected: boolean) => void;
  onPageChange: (selectedPageIds: Set<string>) => void;
};

export const TableSelectionContext = createContext<TableSelectionContextValue | null>(
  null,
);

export function SelectionHeader() {
  const selection = useContext(TableSelectionContext);
  if (!selection) return null;
  const allSelected =
    selection.pageIds.length > 0 &&
    selection.pageIds.every((id) => selection.selectedIds.has(id));
  return (
    <MyTableCheckbox
      ariaLabel="全选当前页"
      isSelected={allSelected}
      onChange={(selected) =>
        selection.onPageChange(new Set(selected ? selection.pageIds : []))
      }
    />
  );
}

export function SelectionCell({
  recordId,
  rowNumber,
}: {
  recordId: string;
  rowNumber: number;
}) {
  const selection = useContext(TableSelectionContext);
  if (!selection) return null;
  const isSelected = selection.selectedIds.has(recordId);
  return (
    <>
      <span
        className={`!text-[12px] ${isSelected ? "opacity-0" : "transition-opacity group-hover:opacity-0"}`}
      >
        {rowNumber}
      </span>
      <span
        className={`absolute inset-0 flex items-center justify-center transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <MyTableCheckbox
          ariaLabel={`选择第 ${rowNumber} 行`}
          isSelected={isSelected}
          onChange={(selected) => selection.onRowChange(recordId, selected)}
        />
      </span>
    </>
  );
}

export function RecordMembersCell({
  value,
  users,
  displayFormat,
}: {
  value: unknown;
  users: ReadonlyMap<string, IdentityUser>;
  displayFormat?: "name" | "nameJobNumber" | "nameUserId";
}) {
  const ids = (Array.isArray(value) ? value : [value]).filter(
    (id): id is string => typeof id === "string" && Boolean(id.trim()),
  );
  if (ids.length === 0) return <span>-</span>;

  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {ids.map((id, index) => {
        const user = users.get(id);
        const label = user ? getMemberLabel(user, displayFormat) : id;
        return (
          <span
            key={`${id}-${index}`}
            className="inline-flex min-w-0 shrink items-center gap-1"
            title={label}
          >
            {user ? (
              <Avatar size="sm" className="size-6 shrink-0">
                <Avatar.Image src={user.avatarUrl ?? undefined} alt="" />
                <Avatar.Fallback>{user.displayName.slice(0, 1)}</Avatar.Fallback>
              </Avatar>
            ) : null}
            <span className="truncate">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function RecordSubmitterCell({
  record,
  showOrganization = false,
}: {
  record: RecordTableRow;
  showOrganization?: boolean;
}) {
  const name = record.displayValues.builtIns.submitter || "-";
  const organization = record.displayValues.builtIns.submitterOrganization;
  return (
    <div className="flex min-w-0 items-center gap-2" title={showOrganization ? `${name} (${organization})` : name}>
      <Avatar size="sm" className="size-6 shrink-0">
        <Avatar.Image src={record.createdByAvatarUrl ?? undefined} alt="" />
        <Avatar.Fallback>{name === "-" ? "?" : name.slice(0, 1)}</Avatar.Fallback>
      </Avatar>
      <div className="min-w-0 leading-tight">
        <span className="block truncate !text-xs">{name}</span>
        {showOrganization ? (
          <span className="mt-0.5 block truncate !text-[10px] text-[var(--color-text-secondary)]">
            {organization}
          </span>
        ) : null}
      </div>
    </div>
  );
}

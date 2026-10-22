import {
  ArrowRightArrowLeft as WorkflowFormIcon,
  Code as DefinedPageIcon,
  Copy as CopiedIcon,
  CirclePlus as CreatedIcon,
  CircleCheck as ProcessedIcon,
  Clock as TodoIcon,
  FileText as FormIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  LayoutRows as DetailFormIcon,
  Link as LinkIcon,
} from "@gravity-ui/icons";
import type { NavigationItem } from "./types";

export function getSidebarNodeIcon(itemType: NavigationItem["itemType"], pathSlug: string, isExpanded = false, formType: NavigationItem["formType"]) {
  if (itemType === "group") return isExpanded ? <FolderOpenIcon /> : <FolderIcon />;
  if (itemType === "system") return pathSlug === "tasks" || pathSlug === "todo" ? <TodoIcon /> : pathSlug === "processed" ? <ProcessedIcon /> : pathSlug === "created" ? <CreatedIcon /> : pathSlug === "copied" ? <CopiedIcon /> : <TodoIcon />;
  if (itemType === "link") return <LinkIcon />;
  if (formType === "workflow") return <WorkflowFormIcon />;
  if (formType === "defined") return <DefinedPageIcon />;
  if (formType === "detail") return <DetailFormIcon />;
  return <FormIcon />;
}

export function getSidebarNodeIconColor(itemType: NavigationItem["itemType"], formType?: NavigationItem["formType"]) {
  if (itemType === "group") return "text-[var(--nav-group-icon)]";
  if (itemType === "link") return "text-[var(--nav-link-icon)]";
  if (itemType === "form") {
    if (formType === "detail") return "text-[var(--form-type-detail-icon-color)]";
    if (formType === "workflow") return "text-[var(--form-type-workflow-icon-color)]";
    if (formType === "defined") return "text-[var(--form-type-defined-icon-color)]";
    return "text-[var(--nav-form-icon)]";
  }
  return "text-[var(--color-text-secondary)]";
}

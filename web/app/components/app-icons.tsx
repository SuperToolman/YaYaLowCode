import type { SVGProps } from "react";

export function IconBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export function LogoIcon() {
  return (
    <IconBase className="h-6 w-6">
      <path d="M5 7.2 12 4l7 3.2v9.6L12 20l-7-3.2Z" />
      <path d="M5 7.2 12 11l7-3.8" />
      <path d="M12 11v9" />
    </IconBase>
  );
}

export function AddIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function SwapIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M4 7h12" />
      <path d="m12 3 4 4-4 4" />
      <path d="M20 17H8" />
      <path d="m12 13-4 4 4 4" />
    </IconBase>
  );
}

export function DownloadIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </IconBase>
  );
}

export function ToolIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m14 7 3-3 3 3-3 3" />
      <path d="m4 20 7.5-7.5" />
      <path d="m7 17 3 3" />
    </IconBase>
  );
}

export function BellIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </IconBase>
  );
}

export function MessageIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M5 6h14v10H9l-4 3V6Z" />
      <path d="M9 10h6" />
      <path d="M9 13h4" />
    </IconBase>
  );
}

export function GearIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.6Z" />
    </IconBase>
  );
}

export function ChevronDownIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  );
}

export function ListIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M8 7h11" />
      <path d="M8 12h11" />
      <path d="M8 17h11" />
      <path d="M5 7h.01" />
      <path d="M5 12h.01" />
      <path d="M5 17h.01" />
    </IconBase>
  );
}

export function TodoIcon() {
  return (
    <IconBase className="h-4 w-4">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v4.8l3 1.8" />
    </IconBase>
  );
}

export function ProcessedIcon() {
  return (
    <IconBase className="h-4 w-4">
      <circle cx="9" cy="8" r="2.5" />
      <path d="M4.5 18c.5-3 2.2-4.5 4.5-4.5 1.2 0 2.2.4 3 1.1" />
      <path d="m14.5 17 1.7 1.7 3.3-3.7" />
    </IconBase>
  );
}

export function CreatedIcon() {
  return (
    <IconBase className="h-4 w-4">
      <circle cx="9" cy="8" r="2.5" />
      <path d="M4.5 18c.5-3 2.2-4.5 4.5-4.5s4 1.5 4.5 4.5" />
      <path d="M16 8h4" />
      <path d="M18 6v4" />
    </IconBase>
  );
}

export function CopiedIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m4 11.5 15-6-5.8 13-2.3-5.2L4 11.5Z" />
      <path d="m11 13.3 2.5-2.5" />
    </IconBase>
  );
}

export function GridIcon() {
  return (
    <IconBase className="h-4 w-4">
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <rect x="14" y="14" width="6" height="6" rx="1.2" />
    </IconBase>
  );
}

export function GearMiniIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M12 9.5A2.5 2.5 0 1 0 12 14.5A2.5 2.5 0 1 0 12 9.5Z" />
      <path d="M4.7 13.4V10.6l1.8-.4c.1-.4.3-.8.5-1.2L6 7.5l2-2 1.5 1c.4-.2.8-.4 1.2-.5l.4-1.8h2.8l.4 1.8c.4.1.8.3 1.2.5l1.5-1 2 2-1 1.5c.2.4.4.8.5 1.2l1.8.4v2.8l-1.8.4c-.1.4-.3.8-.5 1.2l1 1.5-2 2-1.5-1c-.4.2-.8.4-1.2.5l-.4 1.8h-2.8l-.4-1.8c-.4-.1-.8-.3-1.2-.5l-1.5 1-2-2 1-1.5c-.2-.4-.4-.8-.5-1.2l-1.8-.4Z" />
    </IconBase>
  );
}

export function MoreIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M6 12h.01" />
      <path d="M12 12h.01" />
      <path d="M18 12h.01" />
    </IconBase>
  );
}

export function ArrowLeftIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m15 18-6-6 6-6" />
    </IconBase>
  );
}

export function ArrowUpIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m6 15 6-6 6 6" />
    </IconBase>
  );
}

export function ArrowDownIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  );
}

export function TrashIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </IconBase>
  );
}

export function RestoreIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M4 12a8 8 0 1 0 2.3-5.7" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4l3 2" />
    </IconBase>
  );
}

export function PreviewIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
      <circle cx="12" cy="12" r="2.5" />
    </IconBase>
  );
}

export function PublishIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m12 3 7 4v5c0 4.2-2.8 7.3-7 9-4.2-1.7-7-4.8-7-9V7l7-4Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </IconBase>
  );
}

export function SaveIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M5 4h12l2 2v14H5V4Z" />
      <path d="M8 4v6h8V4" />
      <path d="M8 20v-6h8v6" />
    </IconBase>
  );
}

export function CodeIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m14 5-4 14" />
    </IconBase>
  );
}

export function InfoIcon() {
  return (
    <IconBase className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v5" />
      <path d="M12 7.5h.01" />
    </IconBase>
  );
}

export function ChevronLeftIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m14 18-6-6 6-6" />
    </IconBase>
  );
}

export function ChevronRightIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="m10 6 6 6-6 6" />
    </IconBase>
  );
}

export function FolderIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3l1.5 2H18A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z" />
      <path d="M3.5 9H20.5" />
    </IconBase>
  );
}

export function FolderOpenIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M3.5 8A2.5 2.5 0 0 1 6 5.5h3l1.5 2H18a2.5 2.5 0 0 1 2.35 3.35l-1.7 5A2.5 2.5 0 0 1 16.3 17.5H5.7a2.5 2.5 0 0 1-2.35-3.35l1.7-5A2.5 2.5 0 0 1 7.4 7.5Z" />
      <path d="M3.5 8h17" />
    </IconBase>
  );
}

export function FormIcon() {
  return (
    <IconBase className="h-4 w-4">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </IconBase>
  );
}

export function WorkflowFormIcon() {
  return (
    <IconBase className="h-4 w-4">
      <rect x="4" y="4" width="5" height="5" rx="1" />
      <rect x="15" y="15" width="5" height="5" rx="1" />
      <path d="M9 6.5h3a3 3 0 0 1 3 3v5.5" />
      <path d="m13.2 12.8 1.8 2.2 2.2-1.8" />
    </IconBase>
  );
}

export function DetailFormIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M4 5.5h10.5a2 2 0 0 1 2 2v2" />
      <path d="m14.2 7.2 2.3 2.3 2.3-2.3" />
      <rect x="5" y="11" width="14" height="8" rx="1.5" />
      <path d="M5 14h14M9.7 11v8M14.3 11v8" />
    </IconBase>
  );
}

export function DefinedPageIcon() {
  return (
    <IconBase className="h-4 w-4">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 8h16" />
      <path d="m10 12-2 2 2 2" />
      <path d="m14 12 2 2-2 2" />
    </IconBase>
  );
}

export function LinkIcon() {
  return (
    <IconBase className="h-4 w-4">
      <path d="M10 14 8.5 15.5a3 3 0 1 1-4.2-4.2L7 8.6" />
      <path d="m14 10 1.5-1.5a3 3 0 1 1 4.2 4.2L17 15.4" />
      <path d="M8.5 15.5 15.5 8.5" />
    </IconBase>
  );
}

export function AppIcon({ type }: { type: string }) {
  switch (type) {
    case "ltc":
      return (
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <rect x="3" y="3" width="18" height="18" rx="5" opacity="0.2" />
          <path d="M8 8h3v8h6v3H8V8Z" />
        </svg>
      );
    case "dev":
      return (
        <IconBase className="h-5 w-5">
          <rect x="4" y="5" width="16" height="11" rx="2" />
          <path d="M8 19h8" />
          <path d="M12 16v3" />
        </IconBase>
      );
    case "data":
      return (
        <IconBase className="h-5 w-5">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 9h8" />
          <path d="M8 13h8" />
        </IconBase>
      );
    case "finance":
      return (
        <IconBase className="h-5 w-5">
          <path d="M4 9h16" />
          <path d="M6 20V9" />
          <path d="M18 20V9" />
          <path d="m3 9 9-5 9 5" />
          <path d="M3 20h18" />
        </IconBase>
      );
    case "general":
    case "plan":
      return (
        <IconBase className="h-5 w-5">
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
          <path d="m8 5 1.5-2" />
        </IconBase>
      );
    case "produce":
    case "warehouse":
    case "project":
      return (
        <IconBase className="h-5 w-5">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </IconBase>
      );
    case "quality":
      return (
        <IconBase className="h-5 w-5">
          <path d="M7 4h10v16H7Z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
        </IconBase>
      );
    case "purchase":
      return (
        <IconBase className="h-5 w-5">
          <circle cx="9" cy="19" r="1.5" />
          <circle cx="17" cy="19" r="1.5" />
          <path d="M5 5h2l2.5 9h8l2-6H8" />
        </IconBase>
      );
    case "dictionary":
    case "sales":
      return (
        <IconBase className="h-5 w-5">
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
        </IconBase>
      );
    default:
      return (
        <IconBase className="h-5 w-5">
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </IconBase>
      );
  }
}

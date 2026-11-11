import type { PlatformLicenseStatus } from "@/shared/lib/http";

export function LicenseCustomerIdentity({
  license,
}: {
  license: Pick<PlatformLicenseStatus, "customerName" | "subject"> | null;
}) {
  return (
    <div className="min-w-0">
      <p className="m-0 wrap-anywhere">
        {license?.customerName?.trim() || "客户名称未提供"}
      </p>
      <p className="mt-1 mb-0 wrap-anywhere font-mono text-xs text-muted select-text">
        {license?.subject || "-"}
      </p>
    </div>
  );
}
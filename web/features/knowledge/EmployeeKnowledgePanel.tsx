"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowRotateRight, Eye } from "@gravity-ui/icons";
import { Button, Spinner } from "@heroui/react";
import { MySurface } from "@/shared/ui/MySurface";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notifyRequestError } from "@/shared/lib/notify";
import { downloadDocument, listBases, listDocuments, type KnowledgeDocument } from "./client";
import { KnowledgeParsingModal } from "./KnowledgeParsingModal";
import { parsingStatus } from "./parsing-status";

type Props = {
  employeeId: string;
  installed: boolean;
  installedVersion?: string | null;
};

export function EmployeeKnowledgePanel({ employeeId, installed, installedVersion }: Props) {
  const { user, permissionsReady } = useAuth();
  const canRead = Boolean(user);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [preview, setPreview] = useState<KnowledgeDocument>();
  const query = useQuery<KnowledgeDocument[]>({
    queryKey: ["knowledge", user?.id, "employee_bundle", employeeId, installedVersion],
    enabled: permissionsReady && installed && canRead,
    refetchInterval: (query) => query.state.data?.some((item) => ["queued", "processing"].includes(item.status)) ? 3000 : false,
    queryFn: async ({ signal }) => {
      const result = await listBases("employee_bundle", undefined, signal);
      const bases = result.items.filter((base) => base.employeeId === employeeId);
      const documents = await Promise.all(bases.map((base) => listDocuments(base.id, signal)));
      return documents.flatMap((item) => item.items);
    },
  });
  useEffect(() => {
    if (query.error) notifyRequestError(query.error, "加载员工知识库失败");
  }, [query.error]);

  if (!installed) return <p className="text-sm text-muted">安装该 AI 员工后，可查看随安装包同步的知识资料。</p>;
  if (!permissionsReady) return <Spinner aria-label="加载知识库权限" />;
  if (!canRead) return <p className="text-sm text-muted">请登录后查看员工知识库。</p>;

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="员工知识库">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">由运营中心维护，随员工安装或更新同步，仅供查看和下载。</p>
        <Button isIconOnly variant="ghost" aria-label="刷新员工知识库" isDisabled={query.isFetching} onPress={() => void query.refetch()}><ArrowRotateRight /></Button>
      </div>
      {query.isPending ? <Spinner aria-label="加载员工知识库" /> : query.isError ? (
        <p role="alert" className="text-sm text-muted">知识资料加载失败，请重试；访问需有效许可证和员工使用权。</p>
      ) : query.data.length === 0 ? (
        <p className="text-sm text-muted">当前已安装版本暂无可查看的知识资料。</p>
      ) : query.data.map((document) => (
        <MySurface key={document.versionId} className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate font-medium" title={document.name}>{document.name}</span>
            <span className="text-xs text-muted">{(document.size / 1024).toFixed(1)} KiB · 文档版本 {document.version}{document.packageVersion ? ` · 员工包 ${document.packageVersion}` : ""} · {parsingStatus[document.status] ?? "待解析"}</span>
          </div>
          <Button isIconOnly variant="ghost" aria-label={`查看 ${document.name} 解析结果`} onPress={() => setPreview(document)}><Eye /></Button>
          <Button isIconOnly variant="ghost" aria-label={`下载 ${document.name}`} isPending={downloading === document.versionId} isDisabled={downloading !== null} onPress={() => {
            setDownloading(document.versionId);
            void downloadDocument(document.versionId, document.name)
              .catch((error) => notifyRequestError(error, "下载知识资料失败"))
              .finally(() => setDownloading(null));
          }}><ArrowDownToLine /></Button>
        </MySurface>
      ))}
      {preview && <KnowledgeParsingModal key={preview.versionId} document={preview} canRetry={false} onClose={() => setPreview(undefined)} />}
    </section>
  );
}

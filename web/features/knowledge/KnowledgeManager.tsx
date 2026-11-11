"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Modal, Spinner } from "@heroui/react";
import { Plus, TrashBin, ArrowDownToLine, ArrowRotateRight, Clock, Eye, Magnifier } from "@gravity-ui/icons";
import { useAuth } from "@/features/auth/components/AuthProvider";
import InfoTooltip from "@/shared/ui/InfoTooltip";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import { listBases, createBase, listDocuments, uploadDocument, listVersions, deleteDocument, deleteBase, downloadDocument, type KnowledgeDocument } from "./client";
import { KnowledgeSearchModal } from "./KnowledgeSearchModal";
import { KnowledgeParsingModal } from "./KnowledgeParsingModal";
import { KnowledgeCreateModal, type KnowledgeCreation } from "./KnowledgeCreateModal";
import { KnowledgeIndexStatus } from "./KnowledgeIndexStatus";
import { parsingErrors, parsingStatus } from "./parsing-status";

type Props = {
  kind: "global" | "application";
  applicationId?: string;
};
export function KnowledgeManager({ kind, applicationId }: Props) {
  const { hasPermission, permissionsReady, user } = useAuth();
  const queryClient = useQueryClient();
  const canManage =
    kind === "global"
      ? hasPermission("knowledge.global.manage")
      : hasPermission(`app:${applicationId}:knowledge_manage`);
  const canView = Boolean(user);
  const [selectedKey, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const createRequest = useRef({ fingerprint: "", id: crypto.randomUUID() });
  const uploadRequests = useRef(new Map<string, string>());
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{
    kind: "base" | "document";
    id: string;
    name: string;
  }>();
  const [history, setHistory] = useState<KnowledgeDocument[]>();
  const [preview, setPreview] = useState<KnowledgeDocument>();
  const [searchOpen, setSearchOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const replace = useRef<string | undefined>(undefined);
  const scopeKey = ["knowledge", user?.id, kind, applicationId];
  const baseQuery = useQuery({
    queryKey: [...scopeKey, "bases"],
    queryFn: ({ signal }) => listBases(kind, applicationId, signal),
    enabled: permissionsReady && canView,
  });
  const bases = baseQuery.data?.items ?? [];
  const selected = bases.some((b) => b.id === selectedKey)
    ? selectedKey
    : (bases[0]?.id ?? "");
  const docQuery = useQuery({
    queryKey: [...scopeKey, "documents", selected],
    queryFn: ({ signal }) => listDocuments(selected, signal),
    enabled: permissionsReady && canView && Boolean(selected),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "processing"].includes(item.status),
      )
        ? 3000
        : false,
  });
  const docs = docQuery.data?.items ?? [];
  const loading = baseQuery.isFetching || docQuery.isFetching;
  const current = bases.find((b) => b.id === selected);
  const editable = canManage && Boolean(current?.canManage);
  const error = baseQuery.error ?? docQuery.error;
  useEffect(() => {
    if (error) notifyRequestError(error, "加载知识资料失败");
  }, [error]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopeKey });
  async function action(fn: () => Promise<unknown>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notifyRequestError(e, "知识库操作失败");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  async function upload(file: File) {
    const bid = selected;
    await action(async () => {
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      const key = JSON.stringify([bid, replace.current, file.name, digest]);
      const requestId = uploadRequests.current.get(key) ?? crypto.randomUUID();
      uploadRequests.current.set(key, requestId);
      await uploadDocument(bid, file, replace.current, requestId);
      uploadRequests.current.delete(key);
      await refresh();
      notify.success("文档已保存");
    });
  }
  if (!permissionsReady) return <Spinner aria-label="加载知识权限" />;
  if (!canView)
    return <p className="text-sm text-muted">暂无知识库访问权限。</p>;
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="知识库管理">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <InfoTooltip content="文档上传后自动解析，并使用知识库选择的嵌入模型构建索引；检索时使用所选重排序模型，实际模式以检索结果为准。单文档上限 8 MiB，含历史版本最多 2000 份 / 1 GiB；单文档解析上限 4 MiB 文本、4096 分块。" />
        <Button
          isIconOnly
          variant="ghost"
          aria-label="刷新知识库"
          isDisabled={busy || loading}
          onPress={() =>
            void action(async () => {
              await refresh();
            })
          }
        >
          <ArrowRotateRight />
        </Button>
        {canManage && (
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => {
              setCreating(true);
            }}
          >
            <Plus />
            新建知识库
          </Button>
        )}
      </div>
      <div className="grid min-w-0 items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {bases.map((b) => (
            <Button
              key={b.id}
              variant={b.id === selected ? "secondary" : "ghost"}
              className="justify-start"
              isDisabled={busy}
              onPress={() => setSelected(b.id)}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {b.name}
              </span>
              <span className="text-xs text-muted">{b.documentCount}</span>
            </Button>
          ))}
          {!loading && !bases.length && (
            <p className="text-sm text-muted">暂无知识库。</p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {current && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <h4 className="min-w-0 truncate">{current.name}</h4>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label="试搜知识库"
                  onPress={() => setSearchOpen(true)}
                >
                  <Magnifier />
                </Button>
              </div>
              {editable && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => {
                      replace.current = undefined;
                      input.current?.click();
                    }}
                  >
                    <Plus />
                    上传文档
                  </Button>
                  <Button
                    size="sm"
                    isIconOnly
                    variant="ghost"
                    aria-label="删除知识库"
                    isDisabled={busy}
                    onPress={() =>
                      setDeleting({
                        kind: "base",
                        id: selected,
                        name: current.name,
                      })
                    }
                  >
                    <TrashBin />
                  </Button>
                </div>
              )}
            </div>
          )}
          {current && (
            <>
              {current.description && (
                <p className="text-sm leading-6 text-muted">
                  {current.description}
                </p>
              )}
              <KnowledgeIndexStatus
                key={current.id}
                baseId={current.id}
                canManage={editable}
              />
            </>
          )}
          <input
            ref={input}
            hidden
            type="file"
            accept=".pdf,.docx,.xlsx,.ods,.pptx,.csv,.tsv,.txt,.md"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          {(loading || busy) && <Spinner size="sm" aria-label="处理知识文档" />}
          {docs.map((d) => (
            <Card key={d.id} variant="secondary">
              <Card.Content className="flex flex-wrap items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="text-xs text-muted">
                    v{d.version} · {(d.size / 1024).toFixed(1)} KiB ·{" "}
                    {new Date(d.createdAt).toLocaleString()} ·{" "}
                    {parsingStatus[d.status] ?? "待解析"}
                    {d.chunkCount ? ` · ${d.chunkCount} 个分块` : ""}
                  </span>
                  {d.parsingError && (
                    <span className="text-xs text-muted">
                      {parsingErrors[d.parsingError] ??
                        "解析未完成，请查看详情。"}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    isIconOnly
                    variant="ghost"
                    aria-label={`查看 ${d.name} 解析结果`}
                    isDisabled={busy}
                    onPress={() => setPreview(d)}
                  >
                    <Eye />
                  </Button>
                  <Button
                    size="sm"
                    isIconOnly
                    variant="ghost"
                    aria-label={`下载 ${d.name}`}
                    isDisabled={busy}
                    onPress={() =>
                      void action(() => downloadDocument(d.versionId, d.name))
                    }
                  >
                    <ArrowDownToLine />
                  </Button>
                  <Button
                    size="sm"
                    isIconOnly
                    variant="ghost"
                    aria-label={`查看 ${d.name} 版本`}
                    isDisabled={busy}
                    onPress={() =>
                      void action(async () => {
                        setHistory((await listVersions(d.id)).items);
                      })
                    }
                  >
                    <Clock />
                  </Button>
                  {editable && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={busy}
                        onPress={() => {
                          replace.current = d.id;
                          input.current?.click();
                        }}
                      >
                        更新版本
                      </Button>
                      <Button
                        size="sm"
                        isIconOnly
                        variant="ghost"
                        aria-label={`删除 ${d.name}`}
                        isDisabled={busy}
                        onPress={() =>
                          setDeleting({
                            kind: "document",
                            id: d.id,
                            name: d.name,
                          })
                        }
                      >
                        <TrashBin />
                      </Button>
                    </>
                  )}
                </div>
              </Card.Content>
            </Card>
          ))}
          {selected && !loading && !docs.length && (
            <p className="text-sm text-muted">暂无文档。</p>
          )}
        </div>
      </div>
      {searchOpen && current && (
        <KnowledgeSearchModal
          key={current.id}
          base={current}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {preview && (
        <KnowledgeParsingModal
          key={preview.versionId}
          document={preview}
          canRetry={editable}
          onClose={() => setPreview(undefined)}
        />
      )}
      {creating && (
        <KnowledgeCreateModal
          busy={busy}
          onClose={() => setCreating(false)}
          onCreate={async (value: KnowledgeCreation) => {
            await action(async () => {
              const fingerprint = JSON.stringify(value);
              if (createRequest.current.fingerprint !== fingerprint)
                createRequest.current = {
                  fingerprint,
                  id: crypto.randomUUID(),
                };
              const base = await createBase(
                value.name,
                kind,
                applicationId,
                createRequest.current.id,
                { description: value.description, retrieval: value.retrieval },
              );
              createRequest.current = {
                fingerprint: "",
                id: crypto.randomUUID(),
              };
              await refresh();
              setSelected(base.id);
              setCreating(false);
              notify.success("知识库已创建");
            });
          }}
        />
      )}
      <Modal
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(undefined);
        }}
      >
        <Modal.Backdrop isDismissable={!busy}>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  删除{deleting?.kind === "base" ? "知识库" : "文档"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                确认删除“{deleting?.name}
                ”？将永久删除关联原件及历史版本，无法恢复。
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => setDeleting(undefined)}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  isPending={busy}
                  onPress={() =>
                    void action(async () => {
                      if (!deleting) return;
                      if (deleting.kind === "base") {
                        await deleteBase(deleting.id);
                        await refresh();
                      } else {
                        await deleteDocument(deleting.id);
                        await refresh();
                      }
                      setDeleting(undefined);
                    })
                  }
                >
                  确认删除
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal
        isOpen={Boolean(history)}
        onOpenChange={(open) => {
          if (!open) setHistory(undefined);
        }}
      >
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>文档版本</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                {history?.map((d) => (
                  <div key={d.versionId} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      v{d.version} · {d.name} ·{" "}
                      {new Date(d.createdAt).toLocaleString()}
                    </span>
                    <Button
                      variant="ghost"
                      isDisabled={busy}
                      onPress={() =>
                        void action(() => downloadDocument(d.versionId, d.name))
                      }
                    >
                      下载
                    </Button>
                  </div>
                ))}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  );
}

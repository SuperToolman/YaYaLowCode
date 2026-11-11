"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gear } from "@gravity-ui/icons";
import { Button, Input, Label, ListBox, Modal, Select, Spinner, Switch, TextField } from "@heroui/react";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import { listModelRoutes } from "@/features/settings/api";
import { readRetrievalSettings, retryVectorIndex, saveRetrievalSettings, type RetrievalConfig, type RetrievalSettings } from "./client";
import { retrievalReason } from "./retrieval-status";

export function KnowledgeRetrievalSettingsButton({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="secondary" isDisabled={disabled} onPress={() => setOpen(true)}><Gear />知识检索</Button>{open && <RetrievalModal onClose={() => setOpen(false)} />}</>;
}
function RetrievalModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const settings = useQuery({ queryKey: ["knowledge-retrieval-settings", user?.id], queryFn: ({ signal }) => readRetrievalSettings(signal), staleTime: 0, gcTime: 0, refetchOnMount: "always", refetchInterval: 5000 });
  const routes = useQuery({ queryKey: ["knowledge-retrieval-routes", user?.id], queryFn: () => listModelRoutes(), staleTime: 0, gcTime: 0 });
  return <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}><Modal.Backdrop><Modal.Container size="lg"><Modal.Dialog>
    <Modal.Header><Modal.Heading>平台知识检索</Modal.Heading><Modal.CloseTrigger /></Modal.Header>
    <Modal.Body className="flex max-h-[70vh] min-w-0 flex-col gap-3 overflow-y-auto">
      {settings.isPending || routes.isPending ? <Spinner aria-label="加载知识检索设置" /> : settings.error || routes.error ? <Button variant="secondary" onPress={() => { void settings.refetch(); void routes.refetch(); }}>重新加载</Button> : settings.data && routes.data ? <SettingsForm initial={settings.data} routes={[...settings.data.platformConnections, ...routes.data.filter((route) => route.enabled && ["embedding", "reranker"].includes(route.providerType) && !settings.data.platformConnections.some((shared) => shared.id === route.id && shared.providerType === route.providerType))]} onClose={onClose} /> : null}
    </Modal.Body>
  </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
function SettingsForm({ initial, routes, onClose }: { initial: RetrievalSettings; routes: Array<{ id: string; name: string; providerType: string }>; onClose: () => void }) {
  const { user } = useAuth();
  const [config, setConfig] = useState<RetrievalConfig>(initial.config);
  const [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  const update = <K extends keyof RetrievalConfig>(key: K, value: RetrievalConfig[K]) => setConfig((previous) => ({ ...previous, [key]: value }));
  const routePicker = (kind: "embedding" | "reranker") => {
    const choices = routes.filter((route) => route.providerType === kind);
    const key = kind === "embedding" ? "embeddingRouteId" : "rerankerRouteId";
    const selected = choices.some((route) => route.id === config[key]) ? config[key] : null;
    return <Select aria-label={kind === "embedding" ? "Embedding供应商" : "重排供应商"} selectedKey={selected || null} onSelectionChange={(value) => update(key, String(value ?? ""))} isDisabled={busy}>
      <Select.Trigger><Select.Value>{choices.find((route) => route.id === selected)?.name ?? (kind === "embedding" ? "选择 Embedding 供应商" : "选择重排序供应商")}</Select.Value><Select.Indicator /></Select.Trigger>
      <Select.Popover><ListBox>{choices.map((route) => <ListBox.Item id={route.id} key={`${route.providerType}:${route.id}`} textValue={route.name}>{route.name}</ListBox.Item>)}</ListBox></Select.Popover>
    </Select>;
  };
  async function save() {
    setBusy(true);
    try { const value = await saveRetrievalSettings(config); cache.setQueryData(["knowledge-retrieval-settings", user?.id], value); notify.success("平台知识检索设置已保存，新任务生效"); onClose(); }
    catch (error) { notifyRequestError(error, "保存知识检索设置失败"); }
    finally { setBusy(false); }
  }
  const reranking = Boolean(config.rerankerModel !== null && config.rerankerModel !== undefined);
  return <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <Switch isSelected={config.enabled} onChange={(value) => update("enabled", value)} isDisabled={busy}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用向量与关键词混合检索</Switch.Content></Switch>
    {config.enabled && <>
      {routePicker("embedding")}
      <TextField value={config.embeddingModel} onChange={(value) => update("embeddingModel", value)} isDisabled={busy} isRequired><Label>Embedding 模型</Label><Input maxLength={200} placeholder="例如 Qwen/Qwen3-Embedding-8B" /></TextField>
      <TextField value={String(config.dimensions)} onChange={(value) => update("dimensions", Number(value))} isDisabled={busy} isRequired><Label>模型实际输出维度</Label><Input type="number" min={1} max={4096} /></TextField>
      {config.embeddingModel === "Qwen/Qwen3-Embedding-8B" && <p className="text-xs text-muted">硅基流动支持维度：64、128、256、512、768、1024、1536、2048、2560、4096。平台会按所选维度请求并校验返回结果。</p>}
      <Switch isSelected={reranking} onChange={(value) => setConfig((previous) => ({ ...previous, rerankerModel: value ? "" : null, rerankerRouteId: null }))} isDisabled={busy}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用重排</Switch.Content></Switch>
      {reranking && <>{routePicker("reranker")}<TextField value={config.rerankerModel ?? ""} onChange={(value) => update("rerankerModel", value)} isDisabled={busy} isRequired><Label>Reranker 模型</Label><Input maxLength={200} placeholder="供应商支持的重排模型名称" /></TextField></>}
      <Switch isSelected={config.allowKeywordFallback} onChange={(value) => update("allowKeywordFallback", value)} isDisabled={busy}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>未就绪时允许降级检索</Switch.Content></Switch>
      <p className="text-xs text-muted">三类知识库共用平台配置与向量索引。保存时将所选连接用于平台知识服务；个人聊天模型不受影响。接口需支持 /embeddings，可选重排需支持 /rerank。</p>
    </>}
    {initial.profileId && <div className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>文档索引：已就绪 {initial.ready} · 构建中 {initial.pending} · 失败 {initial.failed}</span>{initial.failed > 0 && <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => { setBusy(true); void retryVectorIndex().then((value) => cache.setQueryData(["knowledge-retrieval-settings", user?.id], value)).catch((error) => notifyRequestError(error, "重试索引失败")).finally(() => setBusy(false)); }}>重试失败项</Button>}{initial.lastError && <span>{retrievalReason(initial.lastError)}</span>}</div>}
    <div className="flex justify-end gap-2"><Button variant="ghost" isDisabled={busy} onPress={onClose}>取消</Button><Button type="submit" isPending={busy} isDisabled={config.enabled && (!routes.some((route) => route.id === config.embeddingRouteId && route.providerType === "embedding") || !config.embeddingModel.trim() || !Number.isInteger(config.dimensions) || config.dimensions < 1 || config.dimensions > 4096 || (reranking && (!routes.some((route) => route.id === config.rerankerRouteId && route.providerType === "reranker") || !config.rerankerModel?.trim())))}>保存</Button></div>
  </form>;
}

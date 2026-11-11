"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Description, Input, Label, ListBox, Modal, Select, Spinner, TextField, TextArea } from "@heroui/react";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { listModelRoutes } from "@/features/settings/api";
import { readRetrievalSettings } from "./client";
import type { BaseRetrievalSelection } from "@/shared/lib/http";

export type KnowledgeCreation = {
  name: string;
  description: string;
  retrieval: BaseRetrievalSelection;
};
type ModelChoice = {
  key: string;
  name: string;
  model: string;
  route: string;
  kind: string;
};
export function modelChoices(
  routes: Array<{
    id: string;
    name: string;
    providerType: string;
    model: string;
  }>,
): ModelChoice[] {
  return routes.filter((route) => route.model.trim()).map((route) => ({
    key: JSON.stringify([route.providerType, route.id, route.model]),
    name: `${route.name} / ${route.model}`,
    model: route.model,
    route: route.id,
    kind: route.providerType,
  }));
}
export function KnowledgeCreateModal({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean;
  onClose: () => void;
  onCreate: (value: KnowledgeCreation) => Promise<void>;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [embedding, setEmbedding] = useState("");
  const [reranker, setReranker] = useState("none");
  const options = useQuery({
    queryKey: ["knowledge-create-models", user?.id],
    queryFn: async () => {
      const [settings, routes] = await Promise.all([
        readRetrievalSettings(),
        listModelRoutes(),
      ]);
      const owned = routes.filter(
        (route) =>
          route.enabled &&
          ["embedding", "reranker"].includes(route.providerType),
      );
      const shared = settings.platformConnections.filter(
        (route) =>
          !owned.some(
            (item) =>
              item.id === route.id && item.providerType === route.providerType,
          ),
      );
      return modelChoices([...owned, ...shared.flatMap((route) => route.models.map((model) => ({ ...route, model })))]);
    },
    staleTime: 0,
    gcTime: 0,
  });
  const embeddingChoice = options.data?.find(
    (item) => item.key === embedding && item.kind === "embedding",
  );
  const rerankerChoice = options.data?.find(
    (item) => item.key === reranker && item.kind === "reranker",
  );
  const picker = (
    kind: "embedding" | "reranker",
    value: string,
    onChange: (value: string) => void,
  ) => {
    const choices = options.data?.filter((item) => item.kind === kind) ?? [];
    return (
      <Select
        aria-label={kind === "embedding" ? "嵌入模型" : "重排序模型"}
        selectedKey={value || null}
        onSelectionChange={(key) => onChange(String(key ?? ""))}
        isDisabled={busy || options.isPending || options.isError}
        isRequired={kind === "embedding"}
      >
        <Label>
          {kind === "embedding" ? "嵌入模型" : "重排序模型（可选）"}
        </Label>
        <Select.Trigger className="w-full">
          <Select.Value>
            {value === "none"
              ? "不使用重排序"
              : (choices.find((item) => item.key === value)?.name ??
                "选择已配置的模型")}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {kind === "reranker" && (
              <ListBox.Item id="none" textValue="不使用重排序">
                不使用重排序
              </ListBox.Item>
            )}
            {choices.map((item) => (
              <ListBox.Item id={item.key} key={item.key} textValue={item.name}>
                {item.name}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  };
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Modal.Backdrop isDismissable={!busy}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  !busy &&
                  name.trim() &&
                  embeddingChoice &&
                  (reranker === "none" || rerankerChoice)
                )
                  void onCreate({
                    name: name.trim(),
                    description: description.trim(),
                    retrieval: {
                      embeddingRouteId: embeddingChoice.route,
                      embeddingModel: embeddingChoice.model,
                      rerankerRouteId: rerankerChoice?.route ?? null,
                      rerankerModel: rerankerChoice?.model ?? null,
                    },
                  });
              }}
            >
              <Modal.Header>
                <Modal.Heading>新建知识库</Modal.Heading>
                <Modal.CloseTrigger isDisabled={busy} />
              </Modal.Header>
              <Modal.Body className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto">
                <TextField
                  value={name}
                  onChange={setName}
                  isRequired
                  isDisabled={busy}
                >
                  <Label>知识库名称</Label>
                  <Input
                    maxLength={120}
                    placeholder="例如：产品手册"
                    autoFocus
                  />
                </TextField>
                <TextField
                  value={description}
                  onChange={setDescription}
                  isDisabled={busy}
                >
                  <Label>描述</Label>
                  <TextArea
                    maxLength={2000}
                    rows={3}
                    fullWidth
                    placeholder="介绍知识库的内容与使用场景"
                  />
                </TextField>
                {picker("embedding", embedding, setEmbedding)}
                {picker("reranker", reranker, setReranker)}
                {options.isPending ? (
                  <Spinner size="sm" aria-label="加载可用模型" />
                ) : options.isError ? (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-2"
                  >
                    模型加载失败
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => void options.refetch()}
                    >
                      重试
                    </Button>
                  </div>
                ) : options.data?.some((item) => item.kind === "embedding") ? (
                  <Description>
                    创建时自动验证嵌入模型。上传文档后自动解析并构建向量索引，检索时按此配置召回和重排。
                  </Description>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" isDisabled={busy} onPress={onClose}>
                  取消
                </Button>
                <Button
                  type="submit"
                  isPending={busy}
                  isDisabled={
                    busy ||
                    !name.trim() ||
                    !embeddingChoice ||
                    (reranker !== "none" && !rerankerChoice)
                  }
                >
                  {busy ? "正在验证并创建…" : "创建知识库"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

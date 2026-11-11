"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Chip } from "@heroui/react";
import { testModelRoute } from "@/features/settings/api";
import { notify, notifyRequestError } from "@/shared/lib/notify";

export function ProviderConnectionTest({
  id, apiBaseUrl, apiKey, providerKind = "", disabled, deleteAction, saveAction, saveStatus,
}: {
  id: string;
  apiBaseUrl: string;
  apiKey: string;
  providerKind?: string;
  disabled: boolean;
  deleteAction?: ReactNode;
  saveAction?: ReactNode;
  saveStatus?: "saved" | "unsaved" | "readonly";
}) {
  const [testing, setTesting] = useState(false);
  const pending = useRef(false);
  const configuration = JSON.stringify([id, apiBaseUrl, apiKey, providerKind]);
  const currentConfiguration = useRef<string | null>(configuration);
  useEffect(() => {
    currentConfiguration.current = configuration;
    return () => { currentConfiguration.current = null; };
  }, [configuration]);

  async function test() {
    if (pending.current) return;
    pending.current = true;
    setTesting(true);
    try {
      const response = await testModelRoute(id, {
        providerKind, apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      if (currentConfiguration.current !== configuration) return;
      const show = response.success ? notify.success : notify.error;
      show(response.success ? "连接测试成功" : "连接测试失败", {
        description: `${response.message}（${response.latencyMs} ms）`,
      });
    } catch (error) {
      if (currentConfiguration.current !== configuration) return;
      notifyRequestError(error, "连接测试失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      pending.current = false;
      setTesting(false);
    }
  }

  return (
    <footer className="flex shrink-0 flex-col gap-2 border-t border-[var(--color-border)] px-5 py-3 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex shrink-0 items-center gap-3">
          {deleteAction}
          {saveStatus && (
            <Chip
              role="status"
              size="sm"
              variant="soft"
              color={saveStatus === "saved" ? "success" : saveStatus === "unsaved" ? "warning" : "default"}
            >
              <Chip.Label>
                {saveStatus === "saved" ? "已保存" : saveStatus === "unsaved" ? "未保存" : "仅查看"}
              </Chip.Label>
            </Chip>
          )}
        </div>
        <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
          <p className="min-w-48 flex-1 text-right text-xs text-[var(--color-text-secondary)]">
            使用当前配置检查模型列表接口，不执行模型推理；密钥留空时使用已保存密钥。
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              isPending={testing}
              isDisabled={disabled || testing || !apiBaseUrl.trim()}
              onPress={() => void test()}
            >
              {testing ? "测试中…" : "测试连接"}
            </Button>
            {saveAction}
          </div>
        </div>
      </div>
    </footer>
  );
}

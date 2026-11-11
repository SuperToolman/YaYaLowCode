"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Dropdown, Input } from "@heroui/react";
import { ArrowRotateRight, ChevronDown } from "@gravity-ui/icons";
import { fetchModelRouteModels } from "@/features/settings/api";
import { notify, notifyRequestError } from "@/shared/lib/notify";

export function ProviderModelPicker({
  id, apiBaseUrl, apiKey, providerKind = "", label, model, disabled, onChange,
}: {
  id: string;
  apiBaseUrl: string;
  apiKey: string;
  providerKind?: string;
  label: string;
  model: string;
  disabled: boolean;
  onChange: (model: string) => void;
}) {
  const inputId = useId();
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const configuration = JSON.stringify([id, apiBaseUrl, apiKey, providerKind]);
  const currentConfiguration = useRef<string | null>(configuration);
  const [fetched, setFetched] = useState<{ configuration: string; models: string[] } | null>(null);
  const availableModels = fetched?.configuration === configuration ? fetched.models : [];
  useEffect(() => {
    currentConfiguration.current = configuration;
    return () => { currentConfiguration.current = null; };
  }, [configuration]);

  async function fetchModels() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setFetched(null);
    try {
      const response = await fetchModelRouteModels(id, {
        providerKind, apiBaseUrl: apiBaseUrl.trim(), apiKey: apiKey.trim() || undefined,
      });
      if (currentConfiguration.current !== configuration) return;
      if (!response.success) {
        notify.error("获取模型列表失败", { description: response.message });
        return;
      }
      if (!Array.isArray(response.models)) {
        throw new Error("服务端未返回模型列表，请确认前后端版本一致并重启后端。");
      }
      const modelIds = [...new Set(response.models)].sort();
      setFetched({ configuration, models: modelIds });
      if (modelIds.length) notify.success(`已获取 ${modelIds.length} 个模型`);
      else notify.info("供应商返回的模型列表为空");
    } catch (error) {
      if (currentConfiguration.current !== configuration) return;
      notifyRequestError(error, "获取模型列表失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm font-medium">
      <label htmlFor={inputId}>{label}</label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={inputId}
          className="min-w-0 flex-1 font-mono text-xs"
          disabled={disabled}
          value={model}
          placeholder="输入或选择模型 ID"
          pattern={"[^,，\\r\\n]+"}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <Button
          type="button"
          isIconOnly
          size="sm"
          variant="secondary"
          className="shrink-0"
          aria-label="获取模型列表"
          isPending={loading}
          isDisabled={disabled || loading || !apiBaseUrl.trim()}
          onPress={() => void fetchModels()}
        >
          <ArrowRotateRight className="size-4" />
        </Button>
        {availableModels.length > 0 && (
          <Dropdown>
            <Button
              type="button"
              isIconOnly
              size="sm"
              variant="secondary"
              className="shrink-0"
              aria-label="选择获取的模型"
              isDisabled={disabled || loading}
            >
              <ChevronDown className="size-4" />
            </Button>
            <Dropdown.Popover placement="bottom start" className="max-w-[min(480px,calc(100vw-2rem))]">
              <Dropdown.Menu
                aria-label="供应商模型列表"
                className="max-h-72 overflow-y-auto"
                onAction={(key) => onChange(String(key))}
              >
                {availableModels.map((model) => (
                  <Dropdown.Item key={model} id={model} textValue={model} className="break-all font-mono text-xs">
                    {model}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        )}
      </div>
      <span className="text-xs font-normal leading-5 text-[var(--color-text-secondary)]">
        每条供应商配置关联一个模型。
      </span>
    </div>
  );
}

"use client";
import { assertApiResult } from "@lib/api-request";

import { notifyRequestError } from "@lib/notify";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
} from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import {
  createButtonAutomationForForm,
  listButtonAutomationOptions,
  type ButtonAutomationOption,
} from "@/app/lib/http";
import { notify } from "@lib/notify";

export function CustomButtonAutomationConfig({
  appId,
  formUuid,
  value,
  disabled,
  buttonName = "",
  onChange,
}: {
  appId: string;
  formUuid: string;
  value: string;
  disabled: boolean;
  buttonName?: string;
  onChange: (id: string) => void;
}) {
  const [options, setOptions] = useState<ButtonAutomationOption[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [invalidSelection, setInvalidSelection] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);
  useEffect(() => {
    let active = true;
    listButtonAutomationOptions({
      path: { formUuid },
      responseStyle: "fields",
    })
      .then((result) => {
        assertApiResult(result);
        if (active) {
          const nextOptions = result.data.data;
          setOptions(nextOptions);
          if (
            valueRef.current &&
            !nextOptions.some((flow) => flow.id === valueRef.current)
          ) {
            setInvalidSelection(true);
            onChangeRef.current("");
          }
        }
      })
      .catch((error) => {
        if (active) {
          setOptions([]);
          notifyRequestError(error, error.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [formUuid, refresh]);

  async function create() {
    if (!name.trim()) {
      notify.error("请填写自动化名称");
      return;
    }
    setBusy(true);
    try {
      const result = await createButtonAutomationForForm({
        path: { formUuid },
        body: {
          name: name.trim(),
        },
        responseStyle: "fields",
      });
      assertApiResult(result);
      const flow = result.data.data;
      setOptions((current) => [
        ...current,
        {
          id: flow.id,
          name: flow.name,
          status: flow.status,
          sourceFormUuid: formUuid,
        },
      ]);
      onChange(flow.id);
      setRefresh((current) => current + 1);
      setCreating(false);
      notify.success("已创建，请前往设计并启用自动化");
    } catch (error) {
      notifyRequestError(error, error instanceof Error ? error.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <Select
          className="min-w-0 flex-1"
          aria-label="集成自动化"
          isRequired
          selectedKey={value || null}
          isDisabled={disabled || loading}
          onSelectionChange={(key) => {
            setInvalidSelection(false);
            onChange(String(key || ""));
          }}
        >
          <Label>集成自动化</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {options.map((flow) => (
                <ListBox.Item key={flow.id} id={flow.id} textValue={flow.name}>
                  {flow.name}
                  {flow.status === "paused" ? "（未启用）" : ""}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Button
          variant="secondary"
          isDisabled={disabled}
          onPress={() => {
            setName(buttonName);
            setCreating(true);
          }}
        >
          快速创建
        </Button>
      </div>
      {value ? (
        <a
          className="text-sm text-accent"
          href={`/${encodeURIComponent(appId)}/automations/${encodeURIComponent(value)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          前往设计
        </a>
      ) : null}
      {invalidSelection ? (
        <p role="alert">原绑定的自动化已删除或不可用，请重新选择。</p>
      ) : null}
      {creating ? (
        <Modal
          isOpen
          onOpenChange={(open) => {
            if (!open && !busy) setCreating(false);
          }}
        >
          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>快速创建按钮触发自动化</Modal.Heading>
                  <Modal.CloseTrigger isDisabled={busy} />
                </Modal.Header>
                <Modal.Body className="space-y-4">
                  <TextField
                    value={name}
                    onChange={setName}
                    isRequired
                    isDisabled={busy}
                  >
                    <Label>自动化名称</Label>
                    <Input maxLength={100} />
                  </TextField>
                  <p className="text-sm text-muted">
                    触发类型：按钮触发。初始节点使用当前表单及点击记录；创建后请设计节点并启用。
                  </p>
                </Modal.Body>
                <Modal.Footer>
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => setCreating(false)}
                  >
                    取消
                  </Button>
                  <Button
                    isPending={busy}
                    isDisabled={busy || !name.trim()}
                    onPress={() => void create()}
                  >
                    创建并选中
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      ) : null}
    </div>
  );
}

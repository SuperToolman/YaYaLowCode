"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Chip, Modal, Surface, Table, Tabs } from "@heroui/react";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import {
  checkPlatformPackageDownload,
  getPlatformPackageJob,
  getPlatformPackageState,
  startPlatformPackage,
} from "../platform-package-api";
import type {
  PackagePlatform,
  PlatformPackageState,
} from "../model/platform-package";
import { platformEnvironmentDescriptions } from "../model/platform-environment-descriptions";

export function PlatformPackageModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<PlatformPackageState | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [platform, setPlatform] = useState<PackagePlatform>("linux/amd64");
  const logs = useRef<HTMLPreElement>(null);
  const job = state?.job;
  const running = job?.status === "queued" || job?.status === "running";
  const jobId = job?.id;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void getPlatformPackageState(controller.signal)
        .then(setState)
        .catch((error) => {
          notifyRequestError(error, "无法读取打包环境", {
            description: error.message,
          });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, revision]);

  useEffect(() => {
    if (!open || !running || !jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getPlatformPackageJob(jobId, controller.signal);
        setState((previous) =>
          previous ? { ...previous, job: next } : previous,
        );
        if (next.status === "succeeded") notify.success("平台离线包已生成");
        if (next.status === "failed")
          notify.error("离线打包失败", { description: next.error });
        if (next.status !== "running" && next.status !== "queued") return;
      } catch (error) {
        if (controller.signal.aborted) return;
        notifyRequestError(error, "无法刷新打包进度");
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, running, jobId]);

  useEffect(() => {
    if (logs.current) logs.current.scrollTop = logs.current.scrollHeight;
  }, [job?.logs]);

  async function start() {
    if (!state?.version || starting) return;
    setStarting(true);
    try {
      const next = await startPlatformPackage(
        state.version,
        platform,
        state.runtimeHash,
      );
      setState((previous) =>
        previous ? { ...previous, job: next } : previous,
      );
      notify.success("打包任务已启动");
    } catch (error) {
      notifyRequestError(error, "无法启动打包", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setStarting(false);
    }
  }

  async function download() {
    if (!job || downloading) return;
    setDownloading(true);
    try {
      const result = await checkPlatformPackageDownload(job.id);
      const link = document.createElement("a");
      link.href = `/api/settings/platform-package/${job.id}/download`;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      notifyRequestError(error, "无法下载离线包", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop">
        <Modal.Container placement="center">
          <Modal.Dialog
            className="min-w-0 max-h-[90vh]"
            style={{
              width: "min(1100px, calc(100vw - 2rem))",
              maxWidth: "none",
            }}
          >
            <Modal.Header>
              <Modal.Heading>打包平台离线镜像</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body className="min-w-0 space-y-4 overflow-y-auto">
              <p className="text-sm text-muted">
                构建完整平台镜像并验证启动，生成可上传到运营平台的离线
                ZIP。版本与关于平台保持一致。
              </p>
              <Surface className="space-y-3 p-4">
                <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 text-sm">
                  <dt className="text-muted">平台版本</dt>
                  <dd>{state?.version ?? "读取中"}</dd>
                  <dt className="text-muted">包格式</dt>
                  <dd>离线镜像 ZIP（manifest.json + image.tar）</dd>
                  <dt className="text-muted">文件名</dt>
                  <dd className="wrap-anywhere font-mono text-xs">
                    {state?.version ?? "版本"}-UUID.zip
                  </dd>
                  <dt className="text-muted">输出目录</dt>
                  <dd className="wrap-anywhere font-mono text-xs">
                    {state?.outputDirectory ?? "读取中"}
                  </dd>
                </dl>
                <fieldset className="space-y-2" disabled={running || starting}>
                  <legend className="text-sm text-muted">目标架构</legend>
                  <div
                    className="flex gap-2"
                    role="group"
                    aria-label="目标架构"
                  >
                    {(["linux/amd64", "linux/arm64"] as const).map((value) => (
                      <Button
                        key={value}
                        size="sm"
                        aria-pressed={platform === value}
                        variant={platform === value ? "primary" : "secondary"}
                        onPress={() => setPlatform(value)}
                      >
                        {value}
                      </Button>
                    ))}
                  </div>
                </fieldset>
                <p className="text-xs text-muted">
                  默认适用于常见 x86 服务器；ARM 服务器请选择
                  linux/arm64。构建时可能下载基础镜像和依赖。
                </p>
              </Surface>
              {state?.deployment ? (
                <Tabs defaultSelectedKey="environment" aria-label="部署配置">
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="包部署信息">
                      <Tabs.Tab id="environment">
                        环境变量（{state.deployment.environment.length}）
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="storage">
                        数据卷与端口
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                  <Tabs.Panel id="environment" className="space-y-2 pt-3">
                    <p className="text-xs text-muted">
                      以下变量声明和默认值会写入包内
                      manifest.json；构建完成时还会合并镜像自带的
                      ENV。未设置默认值的变量由运营平台创建客户实例时提供，不读取开发机
                      .env 中的密码或密钥。
                    </p>
                    <Table>
                      <Table.ScrollContainer>
                        <Table.Content
                          aria-label="包环境变量"
                          className="w-full min-w-[860px] text-left text-xs"
                        >
                          <Table.Header>
                            <Table.Column id="name" isRowHeader>
                              变量名
                            </Table.Column>
                            <Table.Column
                              id="required"
                              className="whitespace-nowrap"
                            >
                              必填
                            </Table.Column>
                            <Table.Column id="default">默认值</Table.Column>
                            <Table.Column id="description">描述</Table.Column>
                          </Table.Header>
                          <Table.Body items={state.deployment.environment}>
                            {(variable) => (
                              <Table.Row id={variable.name}>
                                <Table.Cell className="font-mono">
                                  {variable.name}
                                </Table.Cell>
                                <Table.Cell>
                                  {variable.required ? "是" : "否"}
                                </Table.Cell>
                                <Table.Cell className="max-w-64 wrap-anywhere font-mono">
                                  {variable.default === undefined ? (
                                    <span className="font-sans text-muted">
                                      部署时配置
                                    </span>
                                  ) : variable.default === "" ? (
                                    "（空字符串）"
                                  ) : (
                                    variable.default
                                  )}
                                </Table.Cell>
                                <Table.Cell className="min-w-56 max-w-80 whitespace-normal text-muted">
                                  {platformEnvironmentDescriptions[
                                    variable.name
                                  ] ?? "自定义部署环境变量。"}
                                </Table.Cell>
                              </Table.Row>
                            )}
                          </Table.Body>
                        </Table.Content>
                      </Table.ScrollContainer>
                    </Table>
                  </Tabs.Panel>
                  <Tabs.Panel id="storage" className="space-y-3 pt-3 text-sm">
                    <p>
                      容器端口：Web {state.deployment.webPort} / API{" "}
                      {state.deployment.apiPort}
                    </p>
                    <dl className="space-y-2">
                      {state.deployment.volumes.map((volume) => (
                        <div
                          key={volume.key}
                          className="flex flex-wrap justify-between gap-2"
                        >
                          <dt>{volume.key}</dt>
                          <dd className="font-mono text-xs">
                            {volume.destination}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs text-muted">
                      包内包含数据卷挂载声明；客户实例的数据卷在部署时创建，不打包开发数据库与本机文件。
                    </p>
                  </Tabs.Panel>
                </Tabs>
              ) : null}
              {loading ? (
                <p role="status" className="text-sm text-muted">
                  正在检查 Docker 与打包环境…
                </p>
              ) : null}
              {!loading && state && !state.ready ? (
                <p
                  role="status"
                  className="whitespace-pre-wrap text-sm text-warning"
                >
                  {state.reason}
                </p>
              ) : null}
              {!running ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={loading || starting}
                  onPress={() => setRevision((value) => value + 1)}
                >
                  重新检查环境
                </Button>
              ) : null}
              {job ? (
                <section className="space-y-2" aria-label="打包任务">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p role="status" className="text-sm">
                      {job.message}
                    </p>
                    <Chip
                      color={
                        job.status === "succeeded"
                          ? "success"
                          : job.status === "failed"
                            ? "danger"
                            : "default"
                      }
                    >
                      {job.status === "succeeded"
                        ? "已完成"
                        : job.status === "failed"
                          ? "失败"
                          : "执行中"}
                    </Chip>
                  </div>
                  <p className="text-xs text-muted">
                    {job.version} · {job.platform} ·{" "}
                    {new Date(job.createdAt).toLocaleString("zh-CN")}
                  </p>
                  {job.error ? (
                    <p className="whitespace-pre-wrap wrap-anywhere text-sm text-danger">
                      {job.error}
                    </p>
                  ) : null}
                  {job.result ? (
                    <div className="space-y-1 text-sm">
                      <p className="wrap-anywhere font-mono text-xs">
                        {job.result.filename}
                      </p>
                      <p className="text-xs text-muted">
                        {(job.result.size / 1024 / 1024).toFixed(1)} MiB ·{" "}
                        {job.result.path}
                      </p>
                    </div>
                  ) : null}
                  {job.logs ? (
                    <pre
                      ref={logs}
                      className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-default p-3 font-mono text-xs"
                      aria-label="构建日志"
                      tabIndex={0}
                    >
                      {job.logs}
                    </pre>
                  ) : null}
                </section>
              ) : null}
              {running ? (
                <p className="text-xs text-muted">
                  任务在开发机后台运行，可以关闭弹窗；重新打开或刷新页面后可继续查看。
                </p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => onOpenChange(false)}>
                关闭
              </Button>
              {job?.status === "succeeded" ? (
                <Button
                  isDisabled={downloading}
                  onPress={() => void download()}
                >
                  {downloading ? "正在准备下载…" : "下载离线包"}
                </Button>
              ) : null}
              <Button
                variant="primary"
                isDisabled={
                  loading ||
                  starting ||
                  running ||
                  !state?.ready ||
                  !state?.version
                }
                onPress={() => void start()}
              >
                {starting
                  ? "正在启动…"
                  : running
                    ? "正在打包…"
                    : job
                      ? "重新打包"
                      : "确认打包"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

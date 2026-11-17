"use client";
import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Chip,
  Description,
  Input,
  Label,
  Radio,
  RadioGroup,
  Modal,
  Paragraph,
  ProgressBar,
  Separator,
  Spinner,
  Surface,
  TextField,
  ButtonGroup,
} from "@heroui/react";
import { ArrowRight, ArrowsRotateRight, Cube } from "@gravity-ui/icons";
import {
  listApps,
  preflightMarketPublication,
  getMarketplaceSubmission,
  submitAppToMarketplace,
  exportApplicationPackage,
  downloadApplicationPackage,
  type ExportedApplicationPackage,
  type PublicationPreflight,
} from "../api";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import { unwrapApiResult } from "@/shared/lib/api-request";

import {
  CommercialFields,
  commercialPayload,
  emptyCommercial,
} from "./CommercialFields";

export function MarketPublishDialog({
  appId,
  productId,
  onClose,
  mode = "publish",
  memberAppIds,
}: {
  memberAppIds?: string[];
  appId: string;
  productId?: string;
  onClose: () => void;
  mode?: "publish" | "export";
}) {
  const exporting = mode === "export";
  const [commercial, setCommercial] = useState(emptyCommercial);
  const [packageName, setPackageName] = useState("");
  const [exportType, setExportType] = useState<
    "new_listing" | "version_upgrade"
  >("new_listing");
  const [exportProduct, setExportProduct] = useState(productId ?? "");
  const [version, setVersion] = useState("1.0.0");
  const [check, setCheck] = useState<PublicationPreflight>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newProduct, setNewProduct] = useState(false);
  const [existing, setExisting] = useState(productId);
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<
    "ready" | "running" | "success" | "failed"
  >("ready");
  const [elapsed, setElapsed] = useState(0);
  const [file, setFile] = useState<ExportedApplicationPackage>();
  const [receipt, setReceipt] = useState<{
    submissionId?: string;
    version?: string;
  }>();
  const inFlight = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>(
    memberAppIds?.length ? memberAppIds : [appId],
  );
  const [candidates, setCandidates] =
    useState<{ id: string; name: string }[]>();
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const initializedScope = useRef(false);
  const [membersOpen, setMembersOpen] = useState(false);

  async function chooseMembers() {
    setMembersOpen(true);
    if (candidates) return;
    setLoadingCandidates(true);
    try {
      const apps = unwrapApiResult(await listApps({ responseStyle: "fields" }));
      setCandidates(
        apps
          .filter(
            (app) =>
              !app.marketInstallationId &&
              !["market", "market_archived"].includes(app.deploymentType),
          )
          .map((app) => ({ id: app.id, name: app.name })),
      );
    } catch (cause) {
      notifyRequestError(
        cause,
        cause instanceof Error ? cause.message : "无法读取可添加的本地应用",
      );
    } finally {
      setLoadingCandidates(false);
    }
  }

  useEffect(() => {
    if (phase !== "running") return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (error || phase !== "ready")
      feedback.current?.scrollIntoView?.({
        block: "start",
        behavior: "smooth",
      });
  }, [phase, error]);

  async function inspect(selected = selectedAppIds) {
    setPhase("ready");
    setFile(undefined);
    setReceipt(undefined);
    setStatus("");
    setError("");
    setBusy(true);
    setCheck(undefined);
    try {
      const firstInspection = !initializedScope.current;
      const [initial, previous] = await Promise.all([
        preflightMarketPublication(appId, selected),
        exporting
          ? Promise.resolve(undefined)
          : getMarketplaceSubmission(appId),
      ]);
      let result = initial;
      if (!initializedScope.current) {
        initializedScope.current = true;
        const snapshot = previous?.snapshot as
          | { manifest?: { selectedAppIds?: unknown } }
          | undefined;
        const saved =
          !productId || previous?.productId === productId
            ? snapshot?.manifest?.selectedAppIds
            : undefined;
        if (
          Array.isArray(saved) &&
          saved.length &&
          saved.every((id): id is string => typeof id === "string")
        ) {
          setSelectedAppIds(saved);
          result = await preflightMarketPublication(appId, saved);
        }
      }
      if (firstInspection && previous?.status === "upload_pending")
        setNewProduct(
          (previous.snapshot as { newProduct?: boolean })?.newProduct === true,
        );
      if (
        firstInspection &&
        previous?.snapshot &&
        typeof previous.snapshot === "object" &&
        "commercial" in previous.snapshot
      ) {
        const raw = previous.snapshot.commercial as Record<string, unknown>;
        if (raw && typeof raw === "object")
          setCommercial({
            pricingMode: raw.pricingMode === "paid" ? "paid" : "free",
            price: String(Number(raw.priceCents ?? 0) / 100),
            rate: String(Number(raw.publisherRateBasisPoints ?? 0) / 100),
            description: String(raw.description ?? ""),
          });
      }
      setPackageName(
        (current) => current || previous?.appName || "未命名套应用",
      );
      setCheck(result);
      setExisting(productId || previous?.productId || undefined);
      if (result.blockingIssues.length)
        notify.warning(`预检发现 ${result.blockingIssues.length} 项问题`, {
          description: "请在依赖与发布检查中查看并处理。",
        });
      else
        notify.success("发布预检通过", {
          description: exporting
            ? "应用范围完整，可以导出应用包。"
            : "应用范围完整，可以提交运营审核。",
        });
      if (
        firstInspection &&
        previous?.status === "rejected" &&
        previous.reviewReason
      )
        notify.warning("上次上线申请未通过审核", {
          description: previous.reviewReason,
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "预检失败");
      notifyRequestError(
        cause,
        cause instanceof Error ? cause.message : "预检失败",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void inspect();
    });
    return () => {
      active = false;
    };
  }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function publish() {
    if (!check || busy || inFlight.current || phase === "success") return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (check.applicationType === "suite" && !packageName.trim())
        throw new Error("请填写套应用名称");
      const payload = exporting ? undefined : commercialPayload(commercial);
      setStatus("");
      setElapsed(0);
      setPhase("running");
      if (exporting) {
        if (exportType === "version_upgrade" && !exportProduct.trim())
          throw new Error("请填写升级目标商品编号");
        const exported = await exportApplicationPackage(
          appId,
          check.fingerprint,
          version,
          check.applicationType === "suite" ? packageName.trim() : undefined,
          selectedAppIds,
          {
            submissionType: exportType,
            ...(exportType === "version_upgrade"
              ? { targetProductId: exportProduct.trim() }
              : {}),
          },
        );
        setFile(exported);
        setStatus(
          "应用包已导出，已发起浏览器下载；可在运营平台导入后提交审核。",
        );
        notify.success("应用包导出成功");
        setPhase("success");
        return;
      }
      const submission = await submitAppToMarketplace(appId, {
        fingerprint: check.fingerprint,
        selectedAppIds,
        productId: newProduct ? null : (existing ?? null),
        newProduct,
        packageName:
          check.applicationType === "suite" ? packageName.trim() : undefined,
        commercial: payload!,
      });
      if (submission?.status === "upload_pending")
        throw new Error("应用包已保存在本地，但尚未完成上传，请重试原申请。");
      setReceipt(submission);
      setStatus("已提交，等待运营审核；通过后由运营另行上架。");
      notify.success("上线申请提交成功", {
        description: "等待运营审核，通过后由运营上架。",
      });
      setPhase("success");
    } catch (cause) {
      notifyRequestError(
        cause,
        cause instanceof Error
          ? cause.message
          : exporting
            ? "导出失败，请重试"
            : "提交失败，可重试原申请",
      );
      setPhase("failed");
      setError(
        cause instanceof Error
          ? cause.message
          : exporting
            ? "导出失败，请重试"
            : "提交失败，可重试原申请",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const names = new Map(
    check?.members.map((member) => [member.appId, member.name]),
  );
  const singleMember =
    check?.members.length === 1 ? check.members[0] : undefined;
  const groups = new Map<string, PublicationPreflight["dependencies"]>();
  for (const edge of check?.dependencies ?? []) {
    const key = `${edge.sourceAppId}:${edge.targetAppId}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const blocked = (check?.blockingIssues.length ?? 0) > 0;

  return (
    <>
      <Modal
        isOpen
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <Modal.Backdrop isDismissable={!busy} isKeyboardDismissDisabled={busy}>
          <Modal.Container placement="center" size="lg" scroll="inside">
            <Modal.Dialog className="w-[min(65rem,calc(100vw-2rem))] max-w-none">
              <Modal.Header className="pb-3">
                <div className="flex items-center gap-3 pr-8">
                  <Modal.Icon className="shrink-0">
                    <Cube width={24} height={24} />
                  </Modal.Icon>
                  <div className="min-w-0 space-y-1">
                    <Modal.Heading>
                      {exporting ? "确认应用导出范围" : "确认应用上线范围"}
                    </Modal.Heading>
                    <Description>
                      {exporting
                        ? "导出完整应用包，在运营平台导入后审核上架"
                        : "确认完整发布范围，提交后由运营审核并上架"}
                    </Description>
                  </div>
                </div>
                <Modal.CloseTrigger aria-label="关闭弹窗" isDisabled={busy} />
              </Modal.Header>

              <Modal.Body>
                <div className="space-y-4">
                  <div ref={feedback} className="scroll-mt-4" />
                  {phase === "running" && (
                    <Card
                      variant="secondary"
                      aria-label={exporting ? "应用包导出进度" : "上线申请进度"}
                      className="my-4"
                    >
                      <Card.Header>
                        <Card.Title>
                          {exporting
                            ? "正在生成应用包"
                            : "正在打包并提交上线申请"}
                        </Card.Title>
                        <Card.Description>
                          {exporting
                            ? "服务端正在重新校验依赖、生成 ZIP，完成后会自动发起下载。"
                            : "服务端正在重新校验依赖、生成 ZIP 并上传至运营平台，等待接收结果。"}
                        </Card.Description>
                      </Card.Header>
                      <Card.Content className="gap-5 py-6">
                        <ProgressBar
                          aria-label={
                            exporting ? "导出处理中" : "打包上传处理中"
                          }
                          isIndeterminate
                        >
                          <ProgressBar.Track>
                            <ProgressBar.Fill />
                          </ProgressBar.Track>
                        </ProgressBar>
                        <div
                          role="status"
                          aria-live="polite"
                          className="flex items-center gap-3"
                        >
                          <Spinner size="sm" aria-hidden="true" />
                          <Paragraph size="sm">
                            处理中，请勿关闭弹窗或重复提交
                          </Paragraph>
                        </div>
                        <Paragraph size="sm" color="muted">
                          已等待 {elapsed} 秒 · {check?.members.length ?? 0}{" "}
                          个应用 · {check?.resourceSummary.forms ?? 0} 个表单
                        </Paragraph>
                        {elapsed >= 15 && (
                          <Paragraph size="sm" color="muted">
                            应用资源较多或网络较慢，请继续等待。若请求中断，页面会显示失败原因。
                          </Paragraph>
                        )}
                      </Card.Content>
                    </Card>
                  )}
                  {phase === "success" && (
                    <Card
                      variant="secondary"
                      aria-label="处理结果"
                      className="my-4"
                    >
                      <Card.Header>
                        <Card.Title>
                          {exporting ? "应用包导出成功" : "上线申请提交成功"}
                        </Card.Title>
                      </Card.Header>
                      <Card.Content className="gap-4">
                        <Alert status="success" role="status">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Alert.Description>{status}</Alert.Description>
                          </Alert.Content>
                        </Alert>
                        <Paragraph weight="semibold">
                          {check?.applicationType === "suite"
                            ? packageName
                            : singleMember?.name}
                        </Paragraph>
                        <Paragraph size="sm" color="muted">
                          {check?.members.length ?? 0} 个成员应用 ·{" "}
                          {check?.resourceSummary.forms ?? 0} 个表单
                        </Paragraph>
                        {receipt?.submissionId && (
                          <Paragraph size="sm" className="break-all">
                            申请编号：{receipt.submissionId}
                          </Paragraph>
                        )}
                        {receipt?.version && (
                          <Paragraph size="sm">
                            申请版本：{receipt.version}
                          </Paragraph>
                        )}
                        {file && (
                          <>
                            <Paragraph size="sm" className="break-all">
                              文件：{file.filename}
                            </Paragraph>
                            <Paragraph size="sm" color="muted">
                              大小：
                              {(file.size / 1024).toLocaleString("zh-CN", {
                                maximumFractionDigits: 1,
                              })}{" "}
                              KB · 版本 {version}
                            </Paragraph>
                            <Button
                              variant="secondary"
                              onPress={() => downloadApplicationPackage(file)}
                            >
                              再次下载 ZIP
                            </Button>
                            <Description>
                              如果没有弹出下载提示，请查看浏览器下载列表，或点击再次下载。
                            </Description>
                          </>
                        )}
                      </Card.Content>
                    </Card>
                  )}
                  {busy && !check && (
                    <div
                      role="status"
                      className="flex min-h-56 items-center justify-center gap-3"
                    >
                      <Spinner size="sm" aria-hidden="true" />
                      <Paragraph size="sm" color="muted">
                        正在检查应用与依赖范围…
                      </Paragraph>
                    </div>
                  )}
                  {check && phase !== "running" && phase !== "success" && (
                    <>
                      <Card variant="secondary" aria-label="基础信息">
                        <Card.Header className="flex-row flex-wrap items-center justify-between gap-4">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Chip size="sm" color="accent" variant="soft">
                                <Chip.Label>
                                  {check.applicationType === "suite"
                                    ? "套应用"
                                    : "单应用"}
                                </Chip.Label>
                              </Chip>
                              <Description>
                                整体审核 · 整体授权 · 整体安装
                              </Description>
                            </div>
                            <Card.Title>基础信息</Card.Title>
                          </div>
                          <dl className="flex flex-wrap gap-6">
                            {[
                              ["成员应用", check.members.length],
                              ["表单", check.resourceSummary.forms ?? 0],
                              [
                                "自动化",
                                check.resourceSummary.automations ?? 0,
                              ],
                            ].map(([label, count]) => (
                              <div key={label} className="min-w-12">
                                <dt>
                                  <Paragraph size="xs" color="muted">
                                    {label}
                                  </Paragraph>
                                </dt>
                                <dd>
                                  <Paragraph
                                    weight="semibold"
                                    className="tabular-nums"
                                  >
                                    {count}
                                  </Paragraph>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </Card.Header>
                        <Card.Content className="gap-3">
                          {check.applicationType === "suite" ? (
                            <TextField
                              value={packageName}
                              onChange={setPackageName}
                              isRequired
                              isDisabled={busy}
                            >
                              <Label>套应用名称</Label>
                              <Input
                                maxLength={80}
                                placeholder="例如：客户经营套件"
                              />
                            </TextField>
                          ) : (
                            <Paragraph weight="medium">
                              {singleMember?.name ?? "应用包"}
                            </Paragraph>
                          )}
                        </Card.Content>
                      </Card>

                      <div className="space-y-4">
                        <Card
                          variant="secondary"
                          aria-label="发布成员"
                          className="min-w-0"
                        >
                          <Card.Header className="flex-row items-center justify-between gap-2">
                            <Card.Title>发布成员</Card.Title>
                            <div className="flex flex-wrap items-center gap-2">
                              <Description>
                                {check.members.length} 个应用
                              </Description>
                              <Button
                                size="sm"
                                variant="secondary"
                                isDisabled={busy}
                                onPress={() => void chooseMembers()}
                              >
                                选择成员应用
                              </Button>
                            </div>
                          </Card.Header>
                          <Card.Content className="grid gap-4 sm:grid-cols-2">
                            {check.members.map((member, index) => (
                              <Surface
                                key={member.appId}
                                variant="tertiary"
                                className="flex min-w-0 items-start gap-3 rounded-xl p-3"
                              >
                                <Avatar
                                  size="sm"
                                  color="accent"
                                  variant="soft"
                                  aria-hidden="true"
                                >
                                  <Avatar.Fallback>
                                    {member.name.slice(0, 1) || index + 1}
                                  </Avatar.Fallback>
                                </Avatar>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Chip
                                      size="sm"
                                      color={
                                        selectedAppIds.includes(member.appId)
                                          ? "accent"
                                          : "warning"
                                      }
                                      variant="soft"
                                      className="shrink-0"
                                    >
                                      <Chip.Label>
                                        {selectedAppIds.includes(member.appId)
                                          ? "所选成员"
                                          : "必要依赖"}
                                      </Chip.Label>
                                    </Chip>
                                    <Paragraph
                                      size="sm"
                                      weight="medium"
                                      className="min-w-0 break-words"
                                    >
                                      {member.name}
                                    </Paragraph>
                                  </div>
                                  <Paragraph
                                    size="xs"
                                    color="muted"
                                    truncate
                                    title={member.appId}
                                    className="font-mono"
                                  >
                                    {member.appId}
                                  </Paragraph>
                                </div>
                              </Surface>
                            ))}
                          </Card.Content>
                          <Card.Footer>
                            <Description>
                              视图 {check.resourceSummary.views ?? 0} · 按钮{" "}
                              {check.resourceSummary.buttons ?? 0} · 导航{" "}
                              {check.resourceSummary.navigation ?? 0}
                            </Description>
                          </Card.Footer>
                        </Card>

                        <Card
                          variant="secondary"
                          aria-label="依赖与发布检查"
                          className="min-w-0"
                        >
                          <Card.Header className="flex-row items-center justify-between gap-2">
                            <Card.Title>依赖与发布检查</Card.Title>
                            <Chip size="sm" variant="soft">
                              <Chip.Label>
                                {check.dependencies.length} 处引用
                              </Chip.Label>
                            </Chip>
                          </Card.Header>
                          <Card.Content className="gap-4">
                            <Alert
                              status={blocked ? "warning" : "success"}
                              role={blocked ? "alert" : "status"}
                            >
                              <Alert.Indicator />
                              <Alert.Content>
                                <Alert.Title>
                                  {blocked
                                    ? `还有 ${check.blockingIssues.length} 项问题需要处理`
                                    : "发布预检通过"}
                                </Alert.Title>
                                <Alert.Description>
                                  {blocked
                                    ? "修复以下配置后，重新预检即可继续提交。"
                                    : exporting
                                      ? "应用范围完整，可以导出应用包。"
                                      : "应用范围完整，可以提交运营审核。"}
                                </Alert.Description>
                                {blocked && (
                                  <ul className="mt-3 space-y-4">
                                    {check.blockingIssues.map(
                                      (issue, index) => (
                                        <li
                                          key={`${issue.appId}:${issue.path}:${index}`}
                                          className="min-w-0 space-y-1"
                                        >
                                          <Paragraph size="sm">
                                            {names.get(issue.appId) ??
                                              "引用的应用"}{" "}
                                            · {issue.message}
                                          </Paragraph>
                                          <Paragraph size="xs" color="muted">
                                            {issue.location ??
                                              (issue.path === "/"
                                                ? "检查范围：整个应用包"
                                                : "具体位置暂不可用，请联系管理员查看详细信息")}
                                          </Paragraph>
                                          {issue.suggestion && (
                                            <Paragraph size="xs" color="muted">
                                              处理建议：{issue.suggestion}
                                            </Paragraph>
                                          )}
                                          <details className="text-xs">
                                            <summary className="cursor-pointer">
                                              供管理员排查的详细信息
                                            </summary>
                                            <Paragraph
                                              size="xs"
                                              color="muted"
                                              className="mt-1 break-all font-mono"
                                            >
                                              应用编号：{issue.appId} ·
                                              配置位置：{issue.path}
                                            </Paragraph>
                                            {issue.resourceId && (
                                              <Paragraph
                                                size="xs"
                                                color="muted"
                                                className="break-all font-mono"
                                              >
                                                配置编号：{issue.resourceId}
                                              </Paragraph>
                                            )}
                                            {issue.previousPath && (
                                              <Paragraph
                                                size="xs"
                                                color="muted"
                                                className="break-all font-mono"
                                              >
                                                另一处位置：{issue.previousPath}
                                              </Paragraph>
                                            )}
                                          </details>
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                )}
                              </Alert.Content>
                            </Alert>
                            <Separator />
                            {groups.size > 0 ? (
                              <Accordion
                                allowsMultipleExpanded
                                variant="surface"
                                className="max-h-64 overflow-y-auto"
                              >
                                {[...groups].map(([key, edges]) => (
                                  <Accordion.Item key={key} id={key}>
                                    <Accordion.Heading>
                                      <Accordion.Trigger>
                                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                          <span>
                                            {names.get(edges[0].sourceAppId) ??
                                              "来源应用"}
                                          </span>
                                          <ArrowRight
                                            width={14}
                                            aria-hidden="true"
                                            className="shrink-0"
                                          />
                                          <span>
                                            {names.get(edges[0].targetAppId) ??
                                              "目标应用"}
                                          </span>
                                          <Chip size="sm" variant="soft">
                                            <Chip.Label>
                                              {edges.length} 处引用
                                            </Chip.Label>
                                          </Chip>
                                        </span>
                                        <Accordion.Indicator />
                                      </Accordion.Trigger>
                                    </Accordion.Heading>
                                    <Accordion.Panel>
                                      <Accordion.Body className="space-y-3">
                                        {edges.map((edge, index) => (
                                          <div
                                            key={`${edge.path}:${edge.resourceId}:${index}`}
                                            className="min-w-0 space-y-1"
                                          >
                                            <Paragraph size="xs" color="muted">
                                              引用来源 {index + 1}
                                            </Paragraph>
                                            <Paragraph
                                              size="xs"
                                              className="break-all font-mono"
                                            >
                                              {edge.path}
                                            </Paragraph>
                                            <Paragraph
                                              size="xs"
                                              color="muted"
                                              className="break-all font-mono"
                                            >
                                              {edge.resourceId}
                                            </Paragraph>
                                          </div>
                                        ))}
                                      </Accordion.Body>
                                    </Accordion.Panel>
                                  </Accordion.Item>
                                ))}
                              </Accordion>
                            ) : (
                              <Alert status="success">
                                <Alert.Indicator />
                                <Alert.Content>
                                  <Alert.Description>
                                    所有资源均在当前应用内
                                  </Alert.Description>
                                </Alert.Content>
                              </Alert>
                            )}
                            {check.configurationRequired.length > 0 && (
                              <Alert status="accent">
                                <Alert.Indicator />
                                <Alert.Content>
                                  <Alert.Title>安装后配置</Alert.Title>
                                  <ul className="space-y-1">
                                    {check.configurationRequired.map(
                                      (notice) => (
                                        <li key={notice}>
                                          <Alert.Description>
                                            {notice}
                                          </Alert.Description>
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </Alert.Content>
                              </Alert>
                            )}
                          </Card.Content>
                        </Card>
                      </div>

                      {!exporting && (
                        <Alert status="accent">
                          <Alert.Content>
                            <Alert.Description>
                              申请类型：
                              {existing && !newProduct ? "版本升级" : "新上线"}
                              {existing && !newProduct
                                ? ` · 商品 ${existing}`
                                : " · 创建新的应用商品"}
                            </Alert.Description>
                          </Alert.Content>
                        </Alert>
                      )}
                      {!exporting && (
                        <Card variant="secondary" aria-label="销售与分成信息">
                          <Card.Header>
                            <Card.Title>销售与分成信息</Card.Title>
                            <Card.Description>
                              填写商品说明、定价与发布者分成。
                            </Card.Description>
                          </Card.Header>
                          <Card.Content className="gap-4">
                            <CommercialFields
                              value={commercial}
                              onChange={setCommercial}
                              disabled={busy}
                              showHeading={false}
                            />
                            {existing && (
                              <>
                                <Separator />
                                <Checkbox
                                  isSelected={newProduct}
                                  onChange={setNewProduct}
                                  isDisabled={busy}
                                >
                                  <Checkbox.Content>
                                    <Checkbox.Control>
                                      <Checkbox.Indicator />
                                    </Checkbox.Control>
                                    <Label>发布为新商品</Label>
                                  </Checkbox.Content>
                                  <Description>
                                    创建独立商品，原商品及已安装版本继续保留。
                                  </Description>
                                </Checkbox>
                              </>
                            )}
                          </Card.Content>
                        </Card>
                      )}
                      {exporting && (
                        <Card variant="secondary" aria-label="导出配置">
                          <Card.Header>
                            <Card.Title>导出配置</Card.Title>
                          </Card.Header>
                          <Card.Content className="gap-4">
                            <RadioGroup
                              value={exportType}
                              onChange={(value) =>
                                setExportType(
                                  value as "new_listing" | "version_upgrade",
                                )
                              }
                              isDisabled={busy}
                              orientation="horizontal"
                            >
                              <Label>申请类型</Label>
                              {(
                                [
                                  ["new_listing", "新上线"],
                                  ["version_upgrade", "版本升级"],
                                ] as const
                              ).map(([value, label]) => (
                                <Radio key={value} value={value}>
                                  <Radio.Content>
                                    <Radio.Control>
                                      <Radio.Indicator />
                                    </Radio.Control>
                                    <Label>{label}</Label>
                                  </Radio.Content>
                                </Radio>
                              ))}
                            </RadioGroup>
                            {exportType === "version_upgrade" && (
                              <TextField
                                value={exportProduct}
                                onChange={setExportProduct}
                                isRequired
                                isDisabled={busy}
                              >
                                <Label>目标商品编号</Label>
                                <Input placeholder="prod_…" />
                                <Description>
                                  请填写运营平台中需要升级的商品编号；导入时必须选择同一商品。
                                </Description>
                              </TextField>
                            )}
                            <TextField
                              value={version}
                              onChange={setVersion}
                              isDisabled={busy}
                            >
                              <Label>包版本号</Label>
                              <Input placeholder="1.0.0" />
                              <Description>
                                更新现有商品时，请使用尚未发布的版本号
                              </Description>
                            </TextField>
                          </Card.Content>
                        </Card>
                      )}
                    </>
                  )}
                </div>
              </Modal.Body>

              <Modal.Footer className="flex-wrap items-center justify-between gap-3">
                <Description>
                  {error
                    ? "操作未完成，请重试"
                    : phase === "running"
                      ? "正在处理，请等待结果"
                      : phase === "success"
                        ? "处理完成，可以关闭弹窗"
                        : check
                          ? blocked
                            ? "处理完阻断项后可提交"
                            : exporting
                              ? "确认范围和版本号后导出"
                              : "审核通过后，由运营选择版本上架"
                          : exporting
                            ? "确认范围后再导出应用包"
                            : "确认范围后再提交申请"}
                </Description>
                <ButtonGroup>
                  <Button
                    variant="tertiary"
                    isDisabled={busy}
                    onPress={onClose}
                  >
                    关闭
                  </Button>
                  {phase !== "success" && (
                    <Button
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() => void inspect()}
                    >
                      <ArrowsRotateRight width={15} />
                      重新预检
                    </Button>
                  )}
                  {phase !== "success" && (
                    <Button
                      isDisabled={busy || !check || blocked}
                      onPress={() => void publish()}
                    >
                      {busy && check ? (
                        <Spinner size="sm" color="current" aria-hidden="true" />
                      ) : null}
                      {phase === "running"
                        ? exporting
                          ? "正在打包…"
                          : "打包上传中…"
                        : phase === "failed"
                          ? exporting
                            ? "重试导出"
                            : "重试提交"
                          : exporting
                            ? "导出应用包（ZIP）"
                            : "确认整包提交"}
                      <ArrowRight width={15} />
                    </Button>
                  )}
                </ButtonGroup>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal
        isOpen={membersOpen}
        onOpenChange={(open) => {
          if (!busy) setMembersOpen(open);
        }}
      >
        <Modal.Backdrop isDismissable={!busy} isKeyboardDismissDisabled={busy}>
          <Modal.Container placement="center" size="md" scroll="inside">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>选择成员应用</Modal.Heading>
                <Description>
                  选择要一起发布的本地应用，必要依赖自动包含，修改后自动预检。
                </Description>
                <Modal.CloseTrigger
                  aria-label="关闭成员选择"
                  isDisabled={busy}
                />
              </Modal.Header>
              <Modal.Body className="space-y-3">
                {loadingCandidates ? (
                  <div role="status" className="flex items-center gap-2">
                    <Spinner size="sm" />
                    正在读取本地应用…
                  </div>
                ) : candidates?.length === 0 ? (
                  <Description>没有可选择的本地应用</Description>
                ) : (
                  candidates?.map((app) => {
                    const selected = selectedAppIds.includes(app.id);
                    const required =
                      !selected &&
                      !!check?.members.some(
                        (member) => member.appId === app.id,
                      );
                    return (
                      <Checkbox
                        key={app.id}
                        isSelected={selected || required}
                        isDisabled={
                          busy ||
                          required ||
                          (selected && selectedAppIds.length === 1)
                        }
                        onChange={(include) => {
                          const next = include
                            ? [...selectedAppIds, app.id]
                            : selectedAppIds.filter((id) => id !== app.id);
                          setSelectedAppIds(next);
                          void inspect(next);
                        }}
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label>
                            {app.name}
                            {required
                              ? "（必要依赖，自动包含）"
                              : selected
                                ? "（已选择）"
                                : ""}
                          </Label>
                        </Checkbox.Content>
                      </Checkbox>
                    );
                  })
                )}
                {busy && <Description>正在重新检查应用与依赖范围…</Description>}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="secondary"
                  isDisabled={busy || loadingCandidates}
                  onPress={() => {
                    if (!candidates) void chooseMembers();
                    else setMembersOpen(false);
                  }}
                >
                  {!candidates && !loadingCandidates ? "重新读取" : "完成"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}

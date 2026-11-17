"use client";
import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Button,
  Chip,
  Description,
  EmptyState,
  Paragraph,
  SearchField,
  ToggleButton,
  ToggleButtonGroup,
  Modal,
  Spinner,
  Table,
} from "@heroui/react";
import {
  listMarketSubmissionRecords,
  retryMarketSubmission,
  type SubmissionRecord,
} from "../api";
const statuses: Record<string, string> = {
  upload_pending: "待上传",
  pending_review: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};
type Snapshot = {
  submissionType?: string;
  source?: string;
  manifest?: {
    members?: { appId: string; resources?: { apps?: { name?: string }[] } }[];
  };
};
export function MarketSubmissionsDialog({
  onClose,
  onResubmit,
}: {
  onClose: () => void;
  onResubmit: (record: SubmissionRecord) => void;
}) {
  const [records, setRecords] = useState<SubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await listMarketSubmissionRecords();
      setRecords(result.records);
      setWarning(result.syncError ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "申请记录加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, []);
  async function retry(record: SubmissionRecord) {
    setBusy(record.submissionId);
    setError("");
    try {
      await retryMarketSubmission(record.submissionId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传重试失败");
    } finally {
      setBusy("");
    }
  }
  const visible = records.filter(
    (record) =>
      (filter === "all" || record.status === filter) &&
      `${record.appName} ${record.version} ${record.submissionId}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Modal.Backdrop isDismissable={!busy} isKeyboardDismissDisabled={!!busy}>
        <Modal.Container
          placement="center"
          size="lg"
          scroll="inside"
          className="w-full sm:w-full"
        >
          <Modal.Dialog className="max-w-7xl">
            <Modal.Header>
              <Modal.Heading>上线申请记录</Modal.Heading>
              <Description>
                查看每次申请和审核意见。审核通过后需由运营单独上架；驳回后可修改应用并重新申请。
              </Description>
              <Modal.CloseTrigger aria-label="关闭" isDisabled={!!busy} />
            </Modal.Header>
            <Modal.Body className="space-y-4">
              {error && (
                <Alert status="danger" role="alert">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              {warning && (
                <Alert status="warning" role="status">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{warning}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SearchField
                  aria-label="搜索申请"
                  value={search}
                  onChange={setSearch}
                  className="w-full sm:w-80"
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="应用名称、版本或申请编号" />
                    <SearchField.ClearButton aria-label="清除申请搜索" />
                  </SearchField.Group>
                </SearchField>
                <Button
                  variant="secondary"
                  isDisabled={loading || !!busy}
                  onPress={() => void refresh()}
                >
                  刷新审核状态
                </Button>
              </div>
              <ToggleButtonGroup
                aria-label="审核状态筛选"
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[filter]}
                onSelectionChange={(keys) => {
                  const key = keys.values().next().value;
                  if (key != null) setFilter(String(key));
                }}
                size="sm"
                className="max-w-full flex-wrap"
              >
                {[["all", "全部"], ...Object.entries(statuses)].map(
                  ([value, label], index) => (
                    <ToggleButton key={value} id={value}>
                      {index > 0 && <ToggleButtonGroup.Separator />}
                      {label}
                    </ToggleButton>
                  ),
                )}
              </ToggleButtonGroup>
              {loading && (
                <div role="status" className="flex items-center gap-2">
                  <Spinner size="sm" />
                  <Paragraph size="sm" color="muted">
                    正在同步申请记录…
                  </Paragraph>
                </div>
              )}
              <Table>
                <Table.ScrollContainer>
                  <Table.Content
                    aria-label="上线申请记录"
                    className="min-w-[1100px]"
                  >
                    <Table.Header>
                      <Table.Column isRowHeader className="w-72">
                        应用与申请编号
                      </Table.Column>
                      <Table.Column>申请类型</Table.Column>
                      <Table.Column>版本</Table.Column>
                      <Table.Column>提交时间</Table.Column>
                      <Table.Column>审核状态</Table.Column>
                      <Table.Column className="w-52">审核意见</Table.Column>
                      <Table.Column>操作</Table.Column>
                    </Table.Header>
                    <Table.Body
                      renderEmptyState={() => (
                        <EmptyState>
                          <Paragraph weight="medium">
                            {loading ? "正在加载…" : "暂无符合条件的上线申请"}
                          </Paragraph>
                          {!loading && (
                            <Description>
                              提交上线申请后可在这里查看审核进度，或调整搜索和筛选条件。
                            </Description>
                          )}
                        </EmptyState>
                      )}
                    >
                      {visible.map((record) => {
                        const snapshot = record.snapshot as Snapshot;
                        return (
                          <Table.Row
                            key={record.submissionId}
                            id={record.submissionId}
                          >
                            <Table.Cell>
                              <div className="space-y-2">
                                <Paragraph size="sm" weight="semibold">
                                  {record.appName}
                                </Paragraph>
                                <Description className="break-all">
                                  {record.submissionId}
                                </Description>
                                <Accordion>
                                  <Accordion.Item>
                                    <Accordion.Heading>
                                      <Accordion.Trigger>
                                        成员范围
                                        <Accordion.Indicator />
                                      </Accordion.Trigger>
                                    </Accordion.Heading>
                                    <Accordion.Panel>
                                      <Accordion.Body>
                                        {snapshot.manifest?.members?.map(
                                          (member) => (
                                            <Paragraph
                                              key={member.appId}
                                              size="sm"
                                            >
                                              {member.resources?.apps?.[0]
                                                ?.name ?? member.appId}
                                            </Paragraph>
                                          ),
                                        )}
                                        <Description className="break-all">
                                          商品：{record.productId ?? "尚未分配"}
                                        </Description>
                                      </Accordion.Body>
                                    </Accordion.Panel>
                                  </Accordion.Item>
                                </Accordion>
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="space-y-2">
                                <Chip
                                  size="sm"
                                  variant="soft"
                                  color={
                                    snapshot.submissionType ===
                                    "version_upgrade"
                                      ? "accent"
                                      : "default"
                                  }
                                >
                                  <Chip.Label>
                                    {snapshot.submissionType ===
                                    "version_upgrade"
                                      ? "版本升级"
                                      : snapshot.submissionType ===
                                          "new_listing"
                                        ? "新上线"
                                        : "历史申请"}
                                  </Chip.Label>
                                </Chip>
                                <Description>
                                  {snapshot.source === "offline-import"
                                    ? "ZIP 导入"
                                    : "在线申请"}
                                </Description>
                              </div>
                            </Table.Cell>
                            <Table.Cell>{record.version}</Table.Cell>
                            <Table.Cell>
                              {new Date(
                                record.submittedAt * 1000,
                              ).toLocaleString("zh-CN")}
                            </Table.Cell>
                            <Table.Cell>
                              <Chip
                                size="sm"
                                variant="soft"
                                color={
                                  record.status === "rejected"
                                    ? "danger"
                                    : record.status === "approved"
                                      ? "success"
                                      : "default"
                                }
                              >
                                <Chip.Label>
                                  {statuses[record.status] ?? record.status}
                                </Chip.Label>
                              </Chip>
                              {record.status === "approved" && (
                                <Description>
                                  {record.listingStatus === "listed"
                                    ? "当前已上架"
                                    : "当前未上架"}
                                </Description>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <Paragraph
                                size="sm"
                                className="whitespace-normal break-words"
                              >
                                {record.reviewReason || "—"}
                              </Paragraph>
                            </Table.Cell>
                            <Table.Cell>
                              {record.status === "upload_pending" && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  isDisabled={!!busy}
                                  isPending={busy === record.submissionId}
                                  onPress={() => void retry(record)}
                                >
                                  重试上传
                                </Button>
                              )}
                              {record.status === "rejected" && record.appId && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  isDisabled={!!busy}
                                  onPress={() => onResubmit(record)}
                                >
                                  修改后重新申请
                                </Button>
                              )}
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" isDisabled={!!busy} onPress={onClose}>
                关闭
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

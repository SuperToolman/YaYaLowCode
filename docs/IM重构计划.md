# 自研 IM 完整重构计划

## Summary

将现有 `communication_*` 存储一次性迁移到新的 `im_*` 存储，并把 PostgreSQL 作为唯一消息事实源。系统通知统一作为固定系统会话中的 `system` 消息，审批和 Agent 状态通过消息卡片进入同一时间线。

本轮采用破坏性切换：

- 启动迁移时复制并校验旧数据。
- 校验成功后删除旧 `communication_*` 会话、消息和成员表。
- 新代码只读写 `im_*` 表。
- 附件继续使用独立关系表。
- 单实例实现 outbox 投递 worker，同时抽象事件总线，为后续 Valkey 跨实例广播保留接口。

## 核心实现

### 1. 数据库与迁移

新增并启用以下表：

- `im_conversations`
- `im_conversation_members`
- `im_messages`
- `im_message_attachments`
- `im_mailbox_counters`
- `im_mailbox_events`
- `im_device_cursors`
- `im_delivery_outbox`
- `im_business_message_bindings`

关键约束：

- `UNIQUE(conversation_id, conversation_seq)`
- `UNIQUE(sender_user_id, local_id)`
- `UNIQUE(user_id, mailbox_seq)`
- `UNIQUE(conversation_id, conversation_uuid)`
- 附件关系使用 `im_message_attachments(message_id, file_id)`。

迁移步骤必须在单个数据库迁移事务中完成：

1. 创建新表和索引。
2. 按旧会话生成新会话 UUID。
3. 复制成员关系和成员角色。
4. 按旧消息时间和旧 sequence 生成 `conversationSeq`。
5. 将 `client_message_id` 映射为 `localId`。
6. 复制附件关系。
7. 为每个用户生成连续 mailbox event。
8. 为系统通知生成固定系统会话中的 `system` 消息。
9. 校验消息数、成员数、顺序、附件和业务绑定。
10. 校验成功后删除旧 `communication_conversations`、`communication_conversation_members`、`communication_messages`、`communication_message_attachments`。
11. 保留 `workflow_notifications` 作为业务审计和跳转数据源，但不再作为消息页读取源。

迁移失败时事务整体回滚，不允许出现部分切换。

### 2. 后端领域层

重构 `communication.rs` 使用新 Entity：

- 会话查询改为 `im_conversations`。
- 成员权限改为 `im_conversation_members`。
- 消息读写改为 `im_messages`。
- 附件查询改为 `im_message_attachments`。
- 所有发送、撤回、重编辑、已读操作统一使用新表。

发送消息必须在一个 PostgreSQL 事务中完成：

1. 校验会话成员权限。
2. 使用 `sender_user_id + localId` 查询幂等消息。
3. 已存在时返回原消息及原序号。
4. 锁定并递增会话序号。
5. 插入 `im_messages`。
6. 为每个接收用户分配 mailboxSeq。
7. 插入 `im_mailbox_events`。
8. 插入 `im_delivery_outbox`。
9. 提交事务。
10. 提交后由事件总线通知在线 WS。

系统消息使用：

```text
message_type = system
payload.type = yaya.system_card
```

审批消息绑定：

```text
business_type = approval
business_id = workflow_task.id
```

Agent 消息绑定：

```text
business_type = agent_run
business_id = agent_session.id
```

### 3. 系统通知和审批

工作流创建待办或抄送时：

1. 继续写入 `workflow_notifications`，保留业务审计能力。
2. 同时在固定系统会话中创建一条 `system` 消息。
3. 写入 `im_business_message_bindings`。
4. 为收件人写入 mailbox event。
5. 通过 WS 推送到消息时间线。

系统通知卡片必须携带：

- `cardType`
- `businessId`
- `version`
- `title`
- `content`
- `actions`
- `appId`
- `formUuid`
- `recordUuid`

点击审批按钮时：

1. 客户端提交审批命令。
2. 服务端校验当前用户、任务权限、任务状态和卡片版本。
3. 工作流事务执行同意或拒绝。
4. 重复提交返回幂等结果，不重复执行。
5. 更新业务绑定状态。
6. 创建新的系统消息，说明审批结果。
7. 通过 mailbox event 推送结果。

消息页删除 `listWorkflowNotifications` 的主读取逻辑，系统通知只从 IM 系统会话加载。旧通知 HTTP 接口仅保留给兼容页面和后台审计使用。

### 4. WebSocket 与同步协议

保留统一 envelope：

```json
{
  "type": "event",
  "event": "message.created",
  "requestId": null,
  "mailboxSeq": 1024,
  "conversationSeq": 88,
  "conversationId": "conversation-1",
  "localId": "local-uuid",
  "data": {}
}
```

支持请求：

- `authenticate`
- `sync`
- `history`
- `ack`
- `ping`
- `presence`
- `typing`

首次同步：

1. 建立连接并认证。
2. 记录同步起点 mailboxSeq。
3. 返回 `snapshot.started`。
4. 返回会话列表、成员、未读数和系统会话摘要。
5. 发送起点之前的 mailbox events。
6. 查询并发送同步期间新增的事件。
7. 返回 `snapshot.completed`。
8. 客户端写入本地游标并发送 ACK。

重连同步：

- 只发送 `mailboxSeq > lastAckedMailboxSeq` 的事件。
- 事件按序发送。
- 重复事件由客户端去重。
- 游标早于保留窗口时发送 `sync.reset_required`。
- reset 后客户端清空本地 mailbox 游标并执行完整快照。

历史分页：

- 通过 WS `history` 请求。
- 同一会话同时只允许一个请求。
- 使用 `conversationSeq` 分页。
- 返回 `history.page`。
- 客户端按 `messageId` 去重并保持滚动锚点。
- 历史插入期间继续接收实时事件。

### 5. Outbox 投递与事件总线

新增 `EventBus` 抽象：

```rust
trait EventBus {
    async fn publish(&self, event: ImDeliveryEvent) -> Result<()>;
    fn subscribe(&self) -> Receiver<ImDeliveryEvent>;
}
```

本轮实现：

- PostgreSQL outbox worker。
- 单实例后台任务每 500ms 查询待处理 outbox。
- 按批次锁定任务，避免重复处理。
- 通过本地事件总线广播结构化事件。
- WS 根据 `userId` 过滤事件。
- 成功后更新 `delivered_at` 和 `status=delivered`。
- 失败增加 `retry_count`，按指数退避更新 `next_retry_at`。
- 超过最大重试次数进入 `failed`，记录 `last_error`。

后续 Valkey 实现只替换 EventBus，不改变消息事务和 WS 协议。数据库信箱始终是断线恢复来源。

### 6. 前端共享客户端

从消息页面抽取共享 `ImClientAdapter`，至少包含：

- WebSocket 生命周期管理。
- 连接状态机。
- mailbox cursor。
- 事件乱序暂存。
- mailboxSeq 去重。
- ACK。
- reconnect backoff。
- history request correlation。
- optimistic message replacement。
- `localId` 幂等发送。
- reset_required 处理。

状态机：

```text
idle
connecting
syncing
online
reconnecting
reset_required
failed
```

Web 页面和 Tauri 使用同一个 adapter、同一个 envelope 类型和 reducer。

消息页只负责：

- 会话展示。
- 时间线渲染。
- 输入框和附件。
- 审批卡片交互。
- Agent 消息展示。

消息数据、同步和重连逻辑全部移出页面组件。

### 7. HTTP 命令接口

保留现有路由，明确改为命令语义：

- 发送消息。
- 创建和更新会话。
- 成员管理。
- 文件上传。
- 已读提交。
- 审批同意。
- 审批拒绝。

HTTP 只返回：

```json
{
  "code": 0,
  "data": {
    "requestId": "...",
    "localId": "...",
    "accepted": true
  }
}
```

最终消息和业务结果只通过 WS 返回。

## 测试与验收

### 数据与事务

- 旧数据迁移后消息、成员、附件数量一致。
- 相同 `localId` 并发发送只生成一条消息。
- 并发发送不会产生重复或倒退的 conversationSeq。
- 多接收人 mailboxSeq 连续且互不重复。
- 数据库提交成功但 WS/Valkey 失败时，sync 能补齐事件。
- outbox 重试不会重复投递业务消息。

### WS

- 首次快照期间新增消息不会丢失。
- 重连只收到缺失序号。
- 重复、乱序、延迟事件最终收敛。
- reset_required 会触发完整快照。
- ACK 重复或乱序提交不会回退游标。
- history 不覆盖实时消息。
- ping/pong、鉴权失败、超时和服务端关闭行为正确。

### 系统消息与审批

- 工作流通知同时生成审计记录和 IM system 消息。
- 系统会话未读数正确。
- 审批按钮权限、版本和状态校验正确。
- 重复审批请求只执行一次。
- 审批结果会生成新的 system 消息。
- Agent 运行、等待审批、完成和失败状态共用 IM 时间线。

### 前端

- 首次加载顺序正确。
- 下拉刷新保持滚动锚点。
- 快速切换会话不会串消息。
- 发送失败可重试且 localId 不变。
- 系统卡片、普通消息和 Agent 消息排序一致。
- Web 与 Tauri 对同一事件序列产生相同 reducer 状态。

## 监控与日志

新增指标：

```text
im_ws_connections
im_ws_reconnects
im_sync_lag
im_mailbox_gap_count
im_message_send_latency
im_delivery_outbox_pending
im_delivery_outbox_failed
im_duplicate_localid_count
im_history_query_latency
im_cursor_reset_count
im_approval_action_conflict_count
```

所有消息链路日志必须包含：

```text
userId
deviceId
conversationId
localId
messageId
conversationSeq
mailboxSeq
requestId
```

默认保留 30 天 mailbox event；游标早于保留窗口统一返回 `sync.reset_required`。

## 假设与固定决策

- 本轮采用破坏性存储切换。
- 旧 `communication_*` 表迁移成功后立即删除。
- `workflow_notifications` 保留为业务审计源，但不再作为消息页数据源。
- 系统通知使用固定系统会话。
- 系统消息已读使用会话成员游标。
- 附件使用独立 `im_message_attachments` 关系表。
- 首版只实现单实例 outbox worker。
- Valkey 只作为后续跨实例事件总线，不承担消息事实存储。
- PostgreSQL 是唯一消息、信箱和游标权威来源。

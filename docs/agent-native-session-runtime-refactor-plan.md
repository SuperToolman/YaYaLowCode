# Agent 原生会话运行时重构计划

## 目标

将当前 `/agent` 从“页面发起一次 HTTP 请求并消费该次 SSE 输出”的聊天页，重构为“多个会话可独立运行、持续订阅、可恢复和可投影”的 Agent Workbench。

重构完成后，用户应能够：

- 在会话 A 运行期间切换到会话 B，A 继续运行，返回 A 后能看到完整且连续的过程。
- 同时在多个会话中发起任务；每个会话独立展示队列、运行、等待审批、完成、停止和失败状态。
- 在刷新页面、浏览器断线、BFF 重启后重新连接，并从缺失事件开始恢复，而非用全量历史覆盖正在生成的内容。
- 在会话列表中快速查看并筛选运行中的会话、最近活动、最后动作、错误和未读更新；会话数量增长后首屏不产生 N+1 状态查询。
- 继续使用当前 DSH 的 Agent loop、Skill、工具、审批、持久化会话、工作区和产物能力；Rust 平台 API 仍是授权、领域写入、审计和文件元数据的唯一事实来源。

本计划不以 `dsh-rust-sdk` 替换当前交互式 DSH Runtime。该 SDK 可在后续用于 Rust 后台任务调用 DSH，但不作为浏览器多会话交互链路的基础。

## 当前问题与根因

当前调用路径为：

```text
React 页面局部 State
  -> POST /api/agent/sessions/:id/messages
  -> Next.js Agent BFF
  -> yaya-agent-host 临时 SSE Response
  -> DSH Agent / Session Event Log
  -> Rust 平台 API
```

该路径的问题不在于 DSH 是否支持多会话，而在于自定义适配层只暴露“本次 POST 对应的 SSE”。页面将事件直接写入局部 `messages`，连接关闭、切换会话或刷新页面后不再拥有运行中的会话状态。

必须消除的架构问题：

1. 全局 `loading` 将一个会话的运行态扩大为整个工作台的锁，阻止创建、切换和发送其他会话。
2. 页面只有当前会话的事件消费者；非当前会话靠轮询 `runtime-status`，没有增量事件、断线补偿和后台完成通知。
3. 首屏先加载全量会话，再逐个请求运行状态；运行状态读取可能扫描 DSH 会话事件，形成随会话数和历史长度增长的 N+1。
4. Rust `agent_session` 记录、DSH 事件日志和前端临时状态是三个独立事实源，缺少明确的聚合投影与版本边界。
5. 会话列表没有分页游标、摘要状态、最后活动、未读和服务端过滤；消息历史也没有以事件序号为边界的增量恢复契约。
6. 现有 SSE 没有 `sessionId + seq + generation` 恢复语义，无法分辨重复、乱序、漏事件和旧连接回放。

## 架构决策

### 保留的技术边界

```text
Browser / Tauri
  └─ Next.js Agent Workbench
       └─ Agent Runtime Store + 会话投影
            └─ Agent BFF 长连接（WebSocket 优先）
                 └─ DSH Runtime / yaya-agent-host
                      ├─ DSH Session Event Log / Persistence
                      └─ Rust Platform API
                           ├─ RBAC、审批、审计
                           ├─ Agent Session 元数据与摘要
                           ├─ 文件、产物、业务动作
                           └─ 低代码领域数据
```

### 各层职责

| 层 | 职责 | 禁止承担的职责 |
| --- | --- | --- |
| Rust Platform API | 会话归属、权限、标题/置顶/归档、业务资源、审批、文件元数据、运行摘要持久化 | 拼接模型流文本、维护浏览器连接、解析 UI 组件状态 |
| DSH Runtime / YaYa Host | Agent 执行、会话恢复、事件日志、工具、Skill、取消、运行态事件 | 成为业务写入唯一来源、保存前端未读状态 |
| Agent BFF | 浏览器身份透传、协议转发、连接鉴权、断线连接管理 | 将 DSH 事件重新压扁为无序字符串 delta |
| 浏览器 Agent Runtime Store | 连接状态、按会话投影、事件去重、分页历史、未读、草稿、视图订阅 | 直接调用 Rust 内部 API、把全局运行态塞入页面组件 |
| 页面与组件 | 路由组合、展示状态、用户命令 | 直接解析 SSE 帧、维护跨会话运行状态 |

### 不采用 Rust SDK 作为主链路的理由

`dsh-rust-sdk` 是 Rust 服务进程到 DSH 子进程的 stdio JSON-RPC 客户端。它适合无浏览器界面的后台任务编排，但不能替代 DSH Web 侧的 mux、多会话投影、序号补偿和会话 UI Runtime；当前版本也不提供中途取消 RPC。使用它重建交互主链路会将既有 DSH Web Runtime 能力改造成自维护协议，降低而非提高交互体验上限。

## 目标领域模型

### 会话元数据与运行摘要分离

会话记录继续由 Rust 的 `agent_session` 管理，增加或建立独立的 `agent_session_runtime_summary` 投影。元数据和运行态不应互相覆盖。

```text
AgentSession (用户可编辑、业务事实)
  id, ownerUserId, agentId, title, isPinned, context,
  lifecycleStatus(active | archived), createdAt, updatedAt

AgentSessionRuntimeSummary (DSH 事件投影、可重建)
  sessionId, eventGeneration, lastEventSeq, lastActivityAt,
  runId, runStatus, phase, lastToolName, lastError,
  pendingApprovalCount, unreadActivityVersion, updatedAt
```

约束：

- `AgentSession.lifecycleStatus` 只表示会话是否可见或归档，不能复用为运行状态。
- `runStatus` 使用固定枚举：`idle`、`queued`、`running`、`waiting_approval`、`completed`、`stopped`、`failed`、`unknown`。
- `phase` 为运行中的细粒度展示提示：`preparing`、`reasoning`、`tool`、`responding`、`reconciling_artifacts`。其缺失不得改变 `runStatus`。
- `lastEventSeq` 必须来自 DSH canonical event 的连续序号；不使用浏览器自增序号。
- `eventGeneration` 用于 DSH Runtime 重启、日志替换或会话恢复边界。generation 改变时前端必须重新拉取一致历史，不能合并两个 generation 的事件。
- 运行摘要是缓存和索引，允许由 DSH 持久事件全量重建；不得作为审批、工具执行或消息正文的唯一事实来源。

### UI 会话状态

前端每个会话拥有独立状态，不再有工作台级 `loading`：

```ts
type SessionViewState = {
  sessionId: string;
  summary?: SessionRuntimeSummary;
  history: PagedHistoryState;
  projection: SessionProjection;
  draft: ComposerDraft;
  unread: boolean;
  selected: boolean;
  connection: "live" | "catching_up" | "stale" | "offline";
  command: {
    prompting: boolean;
    cancelling: boolean;
    approving: boolean;
  };
};
```

`prompting` 只禁止同一会话的不兼容操作；它不能禁用其他会话的创建、切换、阅读、发送或取消。

## 协议与接口设计

### 协议原则

1. 发送命令与订阅事件完全分离。
2. 每个实时事件必须包含 `sessionId`、`generation`、`seq`、`occurredAt` 和稳定 `eventId`。
3. 浏览器可用 `(sessionId, generation, seq)` 去重、排序和识别缺口。
4. WebSocket 用于会话目录、多个会话事件和命令确认；HTTP 保留给首次快照、分页历史、附件上传下载和降级恢复。
5. BFF 只做认证/授权边界与透明协议转发；领域 DTO 在 Rust API 定义，DSH canonical event 在 DSH Host 定义。

### 会话目录 HTTP API

新增面向工作台的版本化 API，禁止复用旧的全量 `/api/agent/sessions` 响应作为主列表：

```text
GET /api/agent/workbench/sessions
  ?cursor=<opaque>
  &limit=<1..100>
  &agentId=<optional>
  &runStatus=<optional>
  &query=<optional>
  &includeArchived=false
```

响应：

```json
{
  "items": [
    {
      "id": "ASESSION-...",
      "agentId": "...",
      "title": "...",
      "isPinned": false,
      "lastActivityAt": "...",
      "runStatus": "running",
      "phase": "tool",
      "lastToolName": "yaya_query_records",
      "pendingApprovalCount": 0,
      "lastError": null,
      "unreadActivityVersion": 18,
      "lastEventSeq": 244,
      "eventGeneration": "..."
    }
  ],
  "nextCursor": "opaque-or-null",
  "snapshotVersion": "..."
}
```

服务端排序固定为：置顶优先、运行中优先、`lastActivityAt` 倒序、稳定 ID 兜底。任何 prompt 接受、DSH 事件、审批状态变化、完成、失败、取消和产物登记都必须刷新对应摘要的 `lastActivityAt`。

### 历史与事件补偿 HTTP API

```text
GET /api/agent/workbench/sessions/:sessionId/history
  ?beforeSeq=<optional>
  &limit=<1..100>

GET /api/agent/workbench/sessions/:sessionId/events
  ?generation=<required>
  &afterSeq=<required>
  &limit=<1..1000>
```

历史 API 返回已折叠为可展示 message/timeline 的分页视图，并携带 `oldestSeq`、`newestSeq`、`hasMoreBefore`。事件 API 返回 canonical event envelope，用于补缺和校验连续性。两者均返回同一 `generation`；发现 generation 不匹配时返回明确的 `reset_required` 错误码。

历史 API 不允许在前端切换会话时一次读取全量事件；默认只读取尾页，用户上滚后再读取更早消息。

### WebSocket mux

新增单连接端点：

```text
GET /api/agent/workbench/stream
```

认证使用既有浏览器登录态或短期连接令牌，不允许把长期平台 JWT 放在 URL query 中。

客户端握手：

```json
{
  "type": "subscribe",
  "connectionId": "uuid",
  "sessions": [
    { "sessionId": "ASESSION-A", "generation": "g1", "afterSeq": 128 },
    { "sessionId": "ASESSION-B", "generation": "g3", "afterSeq": 52 }
  ],
  "includeDirectory": true
}
```

服务端事件信封：

```json
{
  "type": "session.event",
  "sessionId": "ASESSION-A",
  "generation": "g1",
  "seq": 129,
  "eventId": "g1:129",
  "occurredAt": "...",
  "event": { "type": "tool/call", "data": {} }
}
```

必须支持的服务端帧：

- `connection.ready`：连接 ID、服务端目录版本、心跳配置。
- `directory.snapshot`：初始会话摘要页或订阅范围内摘要。
- `directory.upsert`、`directory.remove`：会话列表增量更新。
- `session.subscribed`：当前 generation 与服务端 `lastSeq`，用于发现客户端缺口。
- `session.event`：DSH canonical event。
- `session.summary`：由事件派生的轻量运行摘要。
- `session.reset_required`：generation 已变化或客户端游标不可恢复。
- `command.accepted`、`command.rejected`：命令确认。
- `heartbeat`、`error`。

客户端命令帧：

- `prompt`：`sessionId`、`clientCommandId`、文本、附件 ID、模式（`queue` 或 `steer`）。
- `cancel`：`sessionId`、`clientCommandId`、取消原因。
- `approve` / `reject`：审批 ID 和用户选择。
- `subscribe` / `unsubscribe`：按当前可见和运行会话调整订阅范围。
- `mark_read`：更新当前用户前端侧未读游标；若需要跨设备同步，再落入 Rust。

每个变更命令带 `clientCommandId`。服务端为同一用户、同一会话和有限窗口实现幂等，断线重发不得重复投递 prompt 或重复执行审批。

### 兼容与降级

- 首次发布同时保留现有 `/api/agent/sessions/:id/messages` 和 SSE 路径，仅旧页面使用。
- WebSocket 不可用时，Workbench 降级为带 `afterSeq` 的 SSE 订阅，不降级为轮询完整历史。
- 仅当实时通道与补偿 API 都不可用时，才使用低频摘要轮询，并向用户显示“实时连接已断开，正在恢复”。
- 新旧协议并存期间，运行命令只允许由一种前端协议发出；通过 feature flag 将用户固定在旧版或新版，避免同一会话双消费者重复 prompt。

## DSH Host 改造

### 从临时 response Set 改为订阅中心

现有 `streams: Map<sessionId, Set<ServerResponse>>` 只能绑定一次 POST 生命周期。替换为 `SessionSubscriptionHub`：

```text
SessionSubscriptionHub
  - session event ring buffer / durable cursor
  - 浏览器 connection registry
  - sessionId -> subscribers
  - connectionId -> subscriptions
  - DSH event -> canonical envelope -> subscribers
  - reconnect afterSeq -> replay or reset_required
```

要求：

- DSH `session/event` 是唯一的 canonical event 输入，保留 event type、seq、time、data、surface 信息和源 event seq。
- 订阅中心不能因为最后一个浏览器连接离开而停止 Agent；运行生命周期由 DSH Agent Handle 管理。
- 同一个会话支持多个浏览器/标签页订阅；事件必须按会话 seq 有序发送。
- 新订阅先发送 `session.subscribed(lastSeq, generation)`，再回放 `afterSeq` 之后的事件，最后接入 live stream；此过程不能漏掉回放与 live 交界的事件。
- 内存 buffer 只用于低延迟重连；超出范围时从 DSH Persistence 读取。持久日志不可补偿时明确返回 `reset_required`。
- DSH Runtime 重启后恢复 active/running 摘要、重新建立必要 handle 或将无法恢复的 open turn 标记为可解释的 `stopped`/`unknown`，不得伪装为完成。

### Prompt 与运行生命周期

将 `POST /messages` 的职责拆解：

1. 校验会话归属、AI 员工、附件、权限和当前运行策略。
2. 创建或恢复 DSH Agent Handle。
3. 调用 `followup`、`queue` 或 `steer`。
4. 立即返回 `command.accepted`，携带 `runId`、当前 generation 和已知起始 seq。
5. 后续过程、工具、审批、产物和终止只通过 session event / summary 推送。

一个会话内的 prompt 策略必须显式定义：

| 当前 run 状态 | 新 prompt 默认行为 | 可选行为 |
| --- | --- | --- |
| `idle` / terminal | 开启新 run | 无 |
| `queued` | 追加队列 | 编辑或撤销本人的待发送项 |
| `running` | 拒绝并提示使用队列 | 明确 `steer` |
| `waiting_approval` | 追加队列 | 审批、拒绝、取消 |

不得允许浏览器通过新 prompt 隐式覆盖正在运行的 Agent。`steer` 必须显示为明确操作并在事件流中留痕。

### 运行摘要投影

在 DSH Host 接收到 canonical event 时调用摘要投影器。投影器必须是幂等的，并至少处理：

- `turn/start`：设置 `running`、记录 `runId` 和开始时间。
- reasoning/text chunk：更新 phase 和最后活动。
- `tool/call` / `tool/result`：更新 `phase=tool`、工具名与失败摘要。
- `approval/asked` / approval resolution：更新 `waiting_approval` 与待审批数。
- `turn/end`：依据 DSH reason 转为 `completed`、`stopped` 或 `failed`。
- 产物创建/登记：更新最后活动并发送目录 upsert。
- runtime/transport failure：标记 `unknown` 或 `failed`，携带可展示错误码；不可直接把断线判定成模型失败。

摘要写入 Rust API 时使用内部受信接口和事件幂等键 `(sessionId, generation, seq)`。写入失败不得阻断 DSH 日志持久化或浏览器事件推送；需记录可重放的投影失败。

## Rust Platform API 改造

### 数据库与索引

新增摘要表或在现有会话表中严格区分字段。推荐独立表，避免高频运行态更新争用用户编辑的标题、置顶和归档字段。

必要索引：

- `(owner_user_id, lifecycle_status, is_pinned DESC, last_activity_at DESC, session_id)`：目录分页。
- `(owner_user_id, run_status, last_activity_at DESC)`：运行状态筛选。
- `(session_id)` 唯一：摘要关联。
- `(session_id, event_generation, last_event_seq)`：投影幂等和诊断。

归档会话的处理：先阻止新 prompt、取消活跃 run 或等待其结束，再归档元数据与工作区。不能像当前实现一样在存在运行态时立即删除工作区，避免运行工具写入失败或审计产物丢失。

### API 与权限

- 会话目录、历史、事件和 WebSocket 订阅均按当前登录用户和会话归属授权。
- DSH Host 写摘要只使用运行时服务身份；不得借用浏览器 JWT 绕过内部边界。
- 用户请求 `prompt`、`cancel`、审批操作时，在命令入口再次校验会话归属和 AI 员工策略。
- `agent_session` 的 `updated_at` 用于元数据编辑；新增 `last_activity_at` 专门代表对话与运行活动，避免排序语义混乱。
- 所有命令、摘要变化、审批选择、运行终止都写可查询审计记录，并关联 `sessionId`、`runId`、`clientCommandId` 与 DSH event key。

### OpenAPI 与 BFF

- 目录、历史、事件补偿、命令 HTTP 兼容端点必须进入 OpenAPI；WebSocket frame 定义作为版本化 JSON Schema 与 TypeScript 类型源维护。
- 生成 Web API 客户端后，禁止页面手写 URL 和响应信封解析。
- Next BFF 仅转发已定义 API 与 WebSocket；不可继续复制各个代理 route 的独立鉴权/错误处理逻辑。

## 前端重构

### 新目录结构

```text
web/features/agent-workbench/
  api/
    sessions.ts                 # 目录、历史、命令、补偿请求
    stream.ts                   # WebSocket/SSE transport
    protocol.ts                 # frame schema 与解析
  model/
    agent-runtime-store.ts      # 所有会话的中心 store
    session-projection.ts       # DSH event -> UI projection 纯函数
    directory-store.ts          # 游标分页、筛选、排序与增量 upsert
    reconnect-controller.ts     # 重连、afterSeq 补偿、generation reset
    command-controller.ts       # prompt/cancel/approve 幂等命令
    history-pagination.ts       # 尾页、向上加载、锚点保持
    unread-state.ts             # 当前用户已读游标
  components/
    AgentWorkbench.tsx
    SessionDirectory.tsx
    SessionListItem.tsx
    ConversationViewport.tsx
    RunActivityTimeline.tsx
    Composer.tsx
    ConnectionStatus.tsx
  types.ts
  index.ts
```

`web/app/(protected)/agent/page.tsx` 最终只负责路由级组合、页面布局和传递当前用户/上下文，不再直接读取 SSE、维护 `messages`、全局 `loading` 或手工轮询状态。

### Agent Runtime Store

store 采用可订阅外部状态容器，可用 Zustand、React `useSyncExternalStore` 或仓库已有等价方案；不得把所有会话消息放进单个页面 `useState`。

store 责任：

- 为每个会话保存 `lastAppliedSeq`、generation、投影、尾页历史、未读与命令状态。
- 收到 event 时按 seq 检查：重复忽略；连续应用；跳号进入 `catching_up` 并请求补偿；generation 变化进入 reset 流程。
- 会话未打开时仅维持摘要和紧凑事件投影；打开时才保留完整可视 timeline。
- 会话关闭/归档后释放大消息内容与订阅，但保留目录行直到服务端增量通知移除。
- 浏览器多标签并存时，每个标签独立连接可正常工作；可后续增加 `BroadcastChannel` 降低重复连接，但不能作为正确性的前提。

### 消息与 timeline 投影

`session-projection.ts` 是纯函数，输入为上次 projection 与一个 canonical event，输出新 projection 和可选摘要变化。必须覆盖：

- 用户消息、assistant message、reasoning delta、text delta。
- tool call/result 的稳定关联；工具结果不得因页面刷新丢失。
- 审批请求、用户审批结果、过期与取消。
- turn start/end、模型错误、传输错误、artifact created。
- 未知事件必须保留原始诊断信息，不得让整个会话渲染失败。

历史 API 返回的消息投影与实时 event 投影必须共享相同转换规则或共享同一测试 fixtures，避免刷新后的内容与实时内容不一致。

### UI 行为

- 顶部显示全局连接状态，不将 WebSocket 断线误显示为单个 Agent 失败。
- 会话列表每项显示：标题、最近活动、运行状态、当前工具/等待审批、失败标记、未读点；运行态使用稳定尺寸图标，禁止列表行抖动。
- 切换会话不取消运行；切换期间保留旧会话 view，加载新会话尾页时显示局部 skeleton。
- 正在阅读历史时，实时新消息不能强制滚到底部；展示“有新内容”按钮。用户位于底部时才自动跟随流。
- 历史向上分页必须保持视觉锚点，避免加载旧消息导致视口跳动。
- stop 操作归属当前会话；运行中的其他会话在列表中仍可单独停止。
- Composer 默认仅对当前会话禁用不兼容操作；其他会话可继续输入、上传和发送。
- 每条 user command 先乐观显示为 `pending`，仅在 `command.accepted` 后进入正式队列/运行状态；拒绝后保留草稿与可读错误。
- 会话首次标题可以保留首条消息截断作为临时标题，但应由后台标题任务或用户编辑异步更新，不能阻塞 prompt。

### 性能与内存约束

- 会话目录采用游标分页和虚拟列表；不加载所有会话与所有状态。
- 默认每个打开会话只保留固定尾页数量，超过阈值的消息投影可丢弃并按历史 API 重新读取。
- 同时订阅所有 `running`、`queued`、`waiting_approval` 会话，以及当前可见目录项；不必为所有历史 idle 会话维持实时订阅。
- 目录摘要更新使用批处理/帧合并，避免 token chunk 导致整个列表高频重渲染。
- assistant text 流在 UI 中按动画帧或短批次合并，不逐 token 触发全局 store 通知。

## 迁移步骤

### 阶段 0：契约冻结与基线

- 为现有会话创建、消息发送、取消、审批、文件、产物、恢复建立端到端基线测试与事件 fixtures。
- 明确现有 DSH event vocabulary、turn end reason、approval data 和工具事件字段，写入 JSON Schema。
- 给当前接口加使用指标与日志：连接存活、SSE 断开、历史加载量、每次首屏状态请求数、运行结束漏显、重复 prompt。
- 建立 feature flag：`agentWorkbenchRuntime=v1|v2`。任何用户仅命中一个版本。

### 阶段 1：服务端会话摘要

- 建立 runtime summary 存储、迁移和索引。
- 在 DSH Host 增加事件投影器和摘要内部写入接口。
- 实现新目录分页 API，前端先在非实时页面或开发入口读取新目录。
- 验证 DSH 重启、会话恢复、归档、运行失败时摘要能重建且不影响现有 SSE 功能。

完成条件：目录首屏不再逐会话请求 `runtime-status`，单页查询次数与会话总数无关。

### 阶段 2：事件补偿与订阅中心

- 将当前 `streams` 临时 SSE 集合替换为 `SessionSubscriptionHub`。
- 实现 session generation、`afterSeq` 补偿、`reset_required` 与事件 replay。
- 先提供 HTTP/SSE 订阅兼容实现，再提供 WebSocket mux；两个 transport 共享同一 event envelope 和订阅中心。
- 在压测中验证订阅/回放交界事件零丢失、重复可去重、无序帧不会污染投影。

完成条件：页面关闭或连接中断不会停止 Agent；新连接可从已知 seq 恢复到最新事件。

### 阶段 3：前端 Runtime Store 与只读工作台

- 创建 `agent-workbench` feature、协议解析和 store。
- 先实现目录、连接状态、单会话尾页历史、实时只读事件投影；旧输入与命令仍可保留。
- 用事件 fixtures 覆盖实时、补偿、重复、跳号、generation reset、未知事件和历史分页。
- 替换当前页面的全量 `sessions/messages/sessionRunStates/loading` 局部状态。

完成条件：可在新工作台中打开运行中的会话，刷新后恢复真实过程，不出现空白 assistant 占位作为运行状态替代。

### 阶段 4：命令与并发

- 通过 mux 或新命令 API 接入 prompt、queue、steer、cancel、approve/reject。
- 实现 `clientCommandId` 幂等、命令确认、失败回滚和草稿保留。
- 移除全局 `loading`，按会话 command state 控制 UI。
- 启用并发运行的会话订阅、目录增量状态和未读标记。

完成条件：至少两个会话可以独立发起、显示运行过程、切换、停止和完成；任一会话失败不影响其余会话。

### 阶段 5：交互完善与清理

- 接入目录搜索、状态筛选、置顶、归档、未读、产物更新、等待审批提示和失败恢复入口。
- 完成虚拟列表、消息分页、自动跟随和性能预算。
- 将旧 `/messages` POST+临时 SSE 实现标记弃用；确认无用户仍在 v1 后删除旧页面状态模型和轮询代码。
- 更新 README、部署文档、OpenAPI、运行手册和故障诊断说明。

## 测试计划

### 单元测试

- Session event 到 UI projection 的每个 event type、重复事件、未知 event、乱序和缺口。
- `runStatus` 状态机，包括审批、取消、模型失败、Runtime 重启和不完整 turn。
- 目录游标、排序、筛选、摘要 upsert、未读版本比较。
- `clientCommandId` 幂等和命令乐观状态恢复。
- history 分页合并和 generation reset 后的状态清理。

### DSH Host 集成测试

- 一个 session 多订阅者、一个连接多 session、订阅取消与连接断开。
- 从内存 buffer 与持久日志进行 afterSeq 补偿。
- 回放与 live 交界无丢失、无重复、顺序稳定。
- DSH event 推送与摘要投影失败隔离。
- Agent 运行期间无订阅者、重新连接、取消、审批、产物登记和 Runtime 重启。

### Rust API 集成测试

- 会话目录按用户归属授权、游标分页和排序稳定性。
- internal summary 写入幂等与拒绝越权 session。
- 归档运行中会话的状态机与工作区清理顺序。
- 摘要重建与现有元数据编辑并发时不丢字段。

### 浏览器端到端测试

- 会话 A 运行时创建并运行会话 B；两个列表状态独立且结果都完整。
- 在 A 生成工具调用期间切换到 B，再返回 A；timeline 连续。
- 断网、重连、刷新、BFF 重启后恢复；不重复文本、不丢工具结果。
- 审批等待、批准/拒绝、取消、失败、重试和产物下载。
- 大量会话目录、长历史、快速切换和多标签页面。
- 键盘操作、屏幕阅读器状态播报、窄屏与桌面布局。

### 可观测性验收

新增并监控：

- 活跃连接数、重连次数、补偿事件数、generation reset 次数。
- event lag（DSH 产生到浏览器投影的延迟）。
- 命令接受/拒绝/幂等命中率。
- 摘要投影滞后、失败与重放次数。
- 每页目录请求数、历史下载字节、前端 store 内存占用。
- 每个 run 的开始、结束、取消、失败和未被前端确认的终态比例。

## 验收标准

### 正确性

- Agent 运行不再依赖浏览器 POST/SSE Response 存活。
- 同一 session 的 event 按 generation 与 seq 单调应用；重复和乱序不产生重复文本、重复工具卡片或状态回退。
- 客户端发现事件缺口后自动补偿；不能补偿时清晰重置并加载一致历史。
- 用户刷新后可恢复正在运行的 session；会话完成、停止和失败原因与 DSH 日志一致。
- 一个会话的 cancel、失败、连接断开或历史加载失败不影响其他会话。

### 体验

- 运行中的会话在列表中有明确状态、当前动作和未读更新；没有只靠转圈图标表达全部运行信息。
- 用户可以无中断切换会话、阅读历史、创建会话并发起其他任务。
- 会话列表与历史按需加载，数量增加不会线性增加首屏状态请求。
- 新内容自动跟随仅在用户位于底部时发生；阅读历史不被打断。
- 所有错误都区分命令被拒绝、Agent 失败、连接中断、补偿失败和权限不足，并提供正确恢复动作。

### 工程边界

- 页面组件不直接读写 SSE/WebSocket 帧；只从 `agent-workbench` store 获取状态和发出命令。
- Rust 不直接实现 Agent loop；DSH Host 不直接拥有低代码领域写入事实。
- `dsh-rust-sdk` 未引入交互链路。若后续接入后台 job，必须使用独立模块和独立 session 命名空间，不影响 Web Workbench 协议。
- 新 API、frame schema、状态枚举和错误码有版本号、测试 fixtures 和文档；协议变更不依赖前端/后端同步发布的偶然顺序。

## 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| DSH event 版本升级导致 projection 失配 | 保存未知 event、schema 校验、契约 fixtures、generation reset、版本化 envelope |
| 高 token 速率导致 React 重渲染 | 事件批处理、会话级订阅、虚拟列表、只对打开会话展开完整投影 |
| Runtime 重启导致 open turn 不完整 | 将运行状态标记为 `unknown` 或基于持久事件推导 `stopped`，禁止臆造 `completed` |
| 双协议并存导致重复 prompt | feature flag 用户隔离、服务端 clientCommandId 幂等、单会话命令来源审计 |
| 摘要和 DSH 日志短暂不一致 | 事件日志为可重建事实；摘要带 seq/generation，落后时触发重投影 |
| 归档误删运行中工作区 | 归档先进入受控终止流程，确认 terminal 后再清理；保留审计与产物策略 |
| WebSocket 代理环境不稳定 | 统一 envelope 的 SSE afterSeq 降级通道、心跳、指数退避、连接诊断 |

## 非目标

- 不在该重构中替换模型供应商、Skill 格式、工具权限模型或低代码领域 API。
- 不为追求“像 Codex”复制其品牌视觉；优先实现可靠会话语义和高频操作效率。
- 不把 DSH event log 全量复制进 Rust 数据库；仅保存必要摘要、审计索引和业务关联。
- 不以 `dsh-rust-sdk` 取代 DSH Web Runtime 或 yaya-agent-host。
- 不要求所有 idle 会话常驻内存或常驻实时订阅。

## 最终交付物

- 版本化的 Workbench 目录、历史、补偿和实时协议。
- DSH Host 的会话订阅中心、generation/seq 补偿和运行摘要投影。
- Rust 会话运行摘要存储、分页目录 API、内部投影接口和审计记录。
- `web/features/agent-workbench` 的 Runtime Store、投影、重连、命令与 UI 组件。
- 可并发运行、可恢复、可分页、可观测的 `/agent` 工作台。
- 单元、集成、端到端、断线恢复和性能回归测试，以及部署与故障处理文档。

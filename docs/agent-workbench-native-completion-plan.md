# Agent Workbench 原生体验收尾实施计划

## 1. 文档说明

本文档用于指导 Agent 原生 Workbench 重构的最后收尾阶段。当前系统已经完成受控 DSH Gateway、基础 Runtime Store、共享 Protected Runtime Provider、旧 SSE 链路移除和基础目录分页，但距离“完整 DSH 原生 Workbench”仍有若干工程和验收项未完成。

本计划不重新设计已经完成的架构，也不恢复旧消息模型。后续工作以当前代码为基础，目标是补齐 DSH 原生 client-runtime 接入、完整会话交互、可靠性测试、生产传输配置和性能验收。

当前必须保持的事实边界：

- DSH canonical event、mux frame 和 canonical history 是消息与运行过程的唯一事实来源。
- Rust `agent_sessions` 是 owner、AI 员工、上下文、lineage 和归档状态的权限事实来源。
- Rust runtime summary 只用于目录索引、状态筛选和恢复提示，不保存消息或 canonical event。
- `/agent` 与 `FormAgentPanel` 只能使用同一个 Protected Runtime Provider。
- 不恢复 `/messages`、临时 SSE、页面级消息数组事实来源或逐会话轮询。
- 不再次执行 Agent 数据重置；既有 reset migration 是历史清理边界。

## 2. 当前状态

### 2.1 已完成能力

- 已建立 `/api/agent/dsh` 受控 Gateway。
- 已支持 DSH RPC envelope、WebSocket mux 和 SSE fallback。
- 已对 RPC、session owner、平台身份和 session allowlist 做基础校验。
- 已将 Rust `session_uuid` 作为 DSH session id 使用。
- 已实现共享 `AgentWorkbenchRuntimeProvider`。
- `/agent` 与 `FormAgentPanel` 已消费同一 Runtime。
- Runtime 已具备 canonical event 投影、generation、seq 去重、历史加载、断线 stale 和 session-scoped command 状态。
- 会话目录已支持 Rust 游标分页、搜索、AI 员工过滤、运行状态过滤和虚拟列表。
- FormAgentPanel 已接入受控附件上传。
- 审批和问题 frame 已保留 DSH `rpcId`，可以构造原生 `client-response`。
- 旧 Agent `/messages`、`runtime-status` 和页面专用 SSE 路由已删除或返回 404。
- Rust、Host、Web TypeScript、客户端 fixture 和 Web 生产构建已通过。

### 2.2 尚未完成能力

1. Web client 目前仍是 YaYa 自定义适配器，尚未真正封装锁定版本的 DSH `WebApiClient`、`ConnectionController`、client-runtime session manager 和 conversation assembler。
2. Runtime Store 缺少覆盖并发会话、乱序事件、generation reset、seq gap、命令幂等和历史锚点的独立测试。
3. Rust 目录分页的 SQL 排序还未完整实现“置顶、活跃运行态、最近活动、稳定 session id”的复合排序。
4. queue、steer、subagent、artifact、approval/question 的 UI 还需要补齐完整交互和恢复语义。
5. Gateway owner 隔离、mux frame 过滤、fork reconciliation、创建补偿和 rename reconciliation 缺少完整自动化测试。
6. 生产反向代理尚未完成 WebSocket upgrade 透明转发验收。
7. 两用户隔离、刷新恢复、断网重连、WS 到 SSE 降级和真实权限链路尚未完成带认证 E2E 验收。

## 3. 收尾目标

### 3.1 产品目标

用户应获得接近 Codex、原生 DSH 和 Grok 的会话体验：

- 会话 A 运行时可以立即切换到会话 B，A 不暂停、不丢事件。
- 多个会话可以同时 prompt、排队、取消、审批、fork 和查看历史。
- 刷新、重连或短暂断网后，按 generation 和 lastSeq 恢复，不重复、不覆盖、不伪造消息。
- 会话列表可以快速识别运行中、排队中、等待审批、失败、停止、未读和最后工具。
- 长历史按页加载，大量会话使用虚拟列表，token 事件只更新目标会话。

### 3.2 架构目标

- Web 只依赖 `@yaya/dsh-workbench-client` 的受限能力。
- DSH 原生 transport 和 canonical event 成为唯一交互协议。
- Rust 与 Host 之间的 owner、agent scope、runtime secret 和 lineage 校验可自动化证明。
- Runtime summary 可由 DSH event 重建，不承担事实存储职责。
- `/agent`、`FormAgentPanel` 和未来 Agent 入口共享同一 Runtime 生命周期。

### 3.3 验收目标

只有 Client Contract、Runtime Store、Gateway/Rust、E2E 和性能验收全部通过，才可将重构标记为完成。

## 4. 总体思路

采用“协议收敛、状态分层、事实单一、逐层验收”的方式推进。

```text
DSH client-connection / client-runtime
        |
        v
@yaya/dsh-workbench-client
        |
        v
Protected AgentWorkbenchRuntimeProvider
        |
        +--> /agent Workbench
        +--> FormAgentPanel
        |
        v
受控 DSH Gateway /api/agent/dsh
        |
        +--> DSH canonical event、mux、history、queue、approval
        +--> Rust owner、agent scope、workspace、文件和业务边界
```

核心原则：

1. 先把 DSH 原生能力封装稳定，再继续扩展 UI。
2. 所有 frame 先经过 schema、session、generation、seq 校验，再进入 Runtime。
3. 每个 session 独立保存投影、命令、未读和连接状态。
4. 目录摘要和消息事实严格分离。
5. 所有可重试命令必须带 `clientCommandId`，服务端必须幂等。
6. 任何失败都只能影响目标 session，不能锁住整个工作台。

## 5. 实施范围

## 5.1 Client Package 原生化

### 目标

将 `web/packages/dsh-workbench-client` 从自定义轻量封装升级为 DSH 版本锁定的浏览器适配包。

### 实施内容

- 固定当前 DSH 版本，并记录 package 版本和 schema 版本。
- 接入 DSH `WebApiClient` 作为 unary RPC carrier。
- 接入 DSH `ConnectionController` 管理 WebSocket mux、重连和连接状态。
- 接入 DSH client-runtime 的 session manager、projection 和 conversation assembler；如果 DSH 内部模块不适合直接被 Next.js 打包，则构建浏览器安全的 YaYa adapter bundle，但必须保留 DSH schema 和行为契约。
- base path 固定为 `/api/agent/dsh`，禁止回退默认 `/api`。
- 仅暴露 YaYa 所需 API：session、history、queue、approval、question、subagent、projection、artifact、reconnect。
- 不导出 host、workspace、settings、credentials、provider/model 配置。
- 统一处理 RPC envelope、mux frame、SSE fallback、rpcId、schema 错误和未知 frame。
- 建立版本化 fixture，覆盖 history、approval、question、queue、subagent、projection、artifact 和 stream error。

### 验收标准

- Web 包不再直接依赖通用 DSH host API。
- WebSocket 和 SSE 进入相同 frame 解码与校验流程。
- rpcId 不匹配、未知 frame、非法 session frame、错误 envelope 均被拒绝。
- DSH 版本升级时，fixture 契约测试能够提前发现不兼容。

## 5.2 Runtime Store 完整化

### 目标

使 Runtime 真正成为“会话集合运行时”，而不是当前页面的消息容器。

### 每个 session 必须保存

- DSH session projection 和 conversation assembler。
- `generation`、`lastSeq`、`oldestSeq`、history cursor。
- canonical event 去重索引和原始事件。
- queue、approval、question、job、subagent、artifact。
- draft、unread version、last activity。
- `connecting`、`connected`、`reconnecting`、`stale`、`closed`。
- session-scoped command pending map。

### 事件规则

- 仅接受当前 allowlist 中的 session frame。
- 同一 `(sessionId, generation, seq)` 只应用一次。
- 低 seq、重复 seq 和旧 generation frame 丢弃。
- `session/subscribed.lastSeq` 大于本地连续 seq 时，按 `afterSeq` 或 history cursor 补偿。
- generation 变化时清空 projection、assembler、tool tree 和局部状态，再加载 history tail。
- active session 阅读到新内容时清零 unread；后台 session 继续运行。
- WebSocket 与 SSE 都失败时保留本地投影并标记 stale，禁止恢复逐会话轮询。
- history 向上分页必须保持事件顺序、消息边界和 projection 锚点稳定。

### 命令规则

- prompt、steer、queue、cancel、rename、fork、approval、question、subagent 均使用 session-scoped pending 状态。
- 每个命令携带 `clientCommandId`。
- 网络重试不得重复执行 prompt、cancel、queue 或审批。
- 命令失败只更新目标 session 的 error 和 command 状态。

## 5.3 Workbench UI 补全

### 会话目录

- 使用 Rust 游标分页作为唯一目录来源。
- 服务端支持 query、agent、runStatus 过滤。
- SQL 排序固定为 pinned、活跃运行态、最近活动、稳定 session id。
- 使用虚拟列表，追加页面不能重复 session。
- 显示 running、queued、waiting approval、phase、last tool、failed/stopped、unread、last activity。
- session command pending 只禁用当前 session 对应按钮。

### 会话内容

- 使用 DSH conversation projection，不以 `AgentMessage[]` 作为事实来源。
- 展示 assistant text、reasoning、tool call/result、timeline、proposal、jobs 和 artifacts。
- 支持历史向上分页和新内容提示。
- 切换、刷新、断线重连后恢复正确 generation/seq。

### 原生交互

- queue：展示待执行项、删除和重排。
- steer：向运行中会话发送引导，不创建错误的重复 turn。
- cancel：只取消目标 session。
- rename/fork：显示提交状态、失败可重试。
- approval：展示工具、原因、approval id，使用原始 rpcId 应答。
- question：展示问题和选项，支持回答与取消。
- subagent：展示子 Agent 进度、层级和 interrupt。
- artifact：frame 只更新目标 session，下载仍使用 Rust RBAC 接口。

## 5.4 Gateway 与 Rust 边界

### Gateway

- `session.list/search` 只能使用 Rust 私有目录 allowlist。
- 带 session identity 的 RPC 每次实时校验 owner、agent scope 和平台权限。
- 每个 mux frame 按 session owner 过滤。
- allowlist 在连接建立、重连、create/fork、archive 和短缓存窗口后刷新。
- create 失败必须补偿归档，不留下目录可见半成品。
- fork 必须先完成 DSH fork，再通过 Rust reconciliation 创建 child metadata 和 lineage。
- rename 以 DSH title event 为提交点，Rust 写失败返回可重试错误并写审计。
- 禁止注册 host、settings、credentials、workspace 和 provider/model 通用方法。

### Rust

- `agent_sessions` 继续保存权限、owner、agent、title、context、lineage、archive。
- runtime summary 只保存目录索引和恢复提示。
- 完成 query、agent、status 游标过滤和复合排序。
- 完成 fork lineage 查询、creation failure 状态和归档前 cancel 约束。
- workspace 只由 retention cleanup 清理，不在运行中归档时立即递归删除。
- 不恢复 `agent_messages`、`agent_runs` 或临时消息事实模型。

## 5.5 受保护区 Provider 与 FormAgentPanel

- Provider 只在 protected layout 创建一次。
- 页面卸载不能关闭 mux 或取消后台 session。
- `/agent` 只改变 active session。
- FormAgentPanel 删除独立 client、独立 mux 和独立消息状态。
- 表单上下文通过受控 `session.create/session.prompt` context 传递。
- 表单字段回填必须经过字段白名单、类型校验和可写性校验。
- 文件上传和产物下载继续使用 Rust RBAC API。

## 6. 测试计划

### 6.1 Client Contract

- RPC request/response envelope。
- 未知 method 和未知 frame 拒绝。
- WebSocket/SSE frame schema 一致。
- rpcId mismatch 拒绝。
- approval/question/queue/subagent/artifact frame 解析。
- 连续 WebSocket 失败后切换 SSE。

### 6.2 Runtime Store

- A/B 会话并发运行。
- 切换会话不中断后台运行。
- duplicate、out-of-order、low seq 丢弃。
- seq gap history compensation。
- generation reset。
- history beforeSeq 分页和顺序。
- unread 和新内容提示。
- clientCommandId 重试幂等。
- WS/SSE 相同事件序列最终收敛。
- stale 状态不触发轮询。

### 6.3 Gateway/Rust

- 非 owner RPC 返回统一拒绝且不泄露 session 存在性。
- 非 owner mux frame 永不下发。
- list/search 不读取 DSH 全局 session list。
- create 使用有效 AI 员工和 Rust session UUID。
- runtime 初始化失败自动补偿。
- fork lineage 正确继承。
- rename reconciliation 可重试。
- approval/subagent 权限隔离。
- 运行中 archive 必须先 cancel。
- reset marker 和 workspace cleanup 可重试。

### 6.4 E2E

- 新建会话。
- 刷新恢复。
- 断网重连。
- WebSocket 降级 SSE。
- queue、steer、cancel。
- approval/question。
- fork/subagent。
- 附件上传。
- artifact 登记和下载。
- FormAgentPanel 字段回填。
- 两个用户互不可见。
- 旧 `/messages` 和 `/runtime-status` 返回 404。

### 6.5 性能

- 目录首屏请求数不随会话总数线性增加。
- 大量会话下虚拟列表稳定。
- token/frame 只更新目标 session。
- 长历史按页加载。
- mux 连接数不随 session 数量线性增加。

## 7. 实施顺序

### 阶段一：客户端原生化

先完成 DSH client-connection、schema 和受限 API 包装，保证 Runtime 后续依赖稳定的 transport 和 projection contract。

### 阶段二：Runtime 核心测试与幂等

抽取纯 reducer、frame validator、history merge 和 command state 逻辑，先建立单元测试，再扩展 UI，避免在页面中验证状态机。

### 阶段三：Rust 目录与边界补全

完成复合排序、游标编码、fork lineage、creation failure 和 archive cancel 约束，随后补充 Gateway 测试。

### 阶段四：UI 原生交互补全

接入 queue、steer、approval、question、subagent、artifact 和新内容提示，确保命令只影响当前 session。

### 阶段五：部署与 E2E 验收

配置生产 WebSocket upgrade，执行双用户、断网、刷新、降级和性能测试，最后删除剩余仅供内部兼容的旧 Agent 代码。

## 8. 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| DSH schema 或版本升级导致 client 不兼容 | 锁定版本、fixture、schema 校验、升级前契约测试 |
| 高频 token 造成全局重渲染 | session 级订阅、批量更新、虚拟列表、selector |
| RPC 重试造成重复 prompt | clientCommandId、服务端幂等表或幂等缓存 |
| generation 变化后混入旧事件 | generation gate，变化时清空局部 projection |
| mux allowlist 过期造成越权 | 连接、重连、create/fork/archive 和固定窗口刷新，并逐 frame 校验 |
| Rust summary 落后于 DSH | summary 仅作索引，按 seq/generation 可重建 |
| 运行中归档误删 workspace | Host cancel、终态确认、retention cleanup |
| 生产代理不支持 WebSocket | 同 schema SSE fallback、连接诊断和部署检查 |
| DSH client-runtime 依赖 Node/Cordis | 构建浏览器安全 adapter bundle，禁止把 Host runtime 依赖带入 Next |

## 9. 完成定义

本计划只有在以下条件全部满足时才算完成：

1. Web 使用的 client 包已基于锁定 DSH 版本，或已提供行为等价且有 DSH fixture 证明的浏览器 adapter。
2. Runtime Store 的 reducer、重连、补偿、generation reset 和命令幂等测试全部通过。
3. Rust 目录复合排序、游标过滤、lineage、archive cancel 和 retention cleanup 测试全部通过。
4. Gateway owner 隔离、mux 过滤、create/fork/rename/approval/subagent 测试全部通过。
5. `/agent` 和 `FormAgentPanel` 所有交互均通过共享 Runtime，不再存在第二套 Agent 协议。
6. 双用户、刷新、重连、WS/SSE 降级、queue、approval、question、fork、subagent、附件和 artifact E2E 全部通过。
7. 性能指标达到目录固定首屏请求、长历史分页、目标 session 局部更新和虚拟列表稳定要求。
8. 旧 Agent 交互链路和旧数据模型未被任何新 UI 或运行时调用。

## 10. 交付物

- `@yaya/dsh-workbench-client` 锁定版本包和契约 fixture。
- 完整 `AgentWorkbenchRuntime` reducer、projection、reconnect 和 command API。
- Rust 目录分页、过滤、排序、lineage 和归档边界实现。
- Gateway owner/filter/reconciliation 自动化测试。
- `/agent` 和 `FormAgentPanel` 的完整原生交互 UI。
- 生产 WebSocket/SSE 代理配置和部署检查清单。
- Client、Runtime、Gateway、Rust、E2E、性能测试报告。
- 故障恢复、断线重连、summary 重建和审计排错文档。

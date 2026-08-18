# YaYa Agent Service

独立部署的 Cordis Agent 运行时。Cordis 仅负责插件生命周期、服务依赖和事件协作；低代码平台仍是身份、RBAC、许可证和领域写操作的唯一事实来源。

## Development

```powershell
pnpm --dir agent dev
```

默认地址为 `http://127.0.0.1:8789`。`GET /healthz` 检查进程可用性；`GET /v1/plugins` 展示当前可调用工具。所有会话请求须携带平台 JWT 的 `Authorization: Bearer ...`，Agent 服务会将它透传给 Rust 平台 API。

将 `web` 的 `AGENT_RUNTIME_BASE_URL` 设置为该地址后，Next.js BFF 会将 `/api/agent/*` 会话和 SSE 请求转发到此服务。未配置或运行时不可达时，BFF 返回 `503`；它不会回退到已删除的 Rust Agent 执行器。

插件由 `config/plugins.json` 选择。每项都可用 `module` 覆盖默认实现，替代模块必须导出 Cordis Plugin 以及 manifest：`id`、`version`、`provides`、`requires`、`configSchema`、`capabilities`。Host 会校验配置、所请求 capability 和 `requires` / `provides` 图，并拒绝缺失依赖或同服务的多个 provider。替换 provider 与加载 extension 不需要修改 Host 源码，但配置变更需要重启 Agent 进程。

`workflow-engine` 是 Agent 编排边界。LangGraph 是本项目面向 durable workflow 的首选外部实现候选，但必须作为独立 worker，通过一个提供 `workflow` 服务的 `workflow-client` 插件接入；它不会嵌入 Rust 或 Node。当前 Node provider 保持为可回退实现，切换条件和内部协议见 [architecture.md](docs/architecture.md)。

生产配置 `config/plugins.production.json` 启用 `workflow-langgraph-client`、PostgreSQL 存储和 pg-boss 持久化调度，禁用本地 workflow、JSON 存储和内存调度。LangGraph Worker 位于 `langgraph-worker/`，只接受共享内部令牌认证的 `/v1/invoke` 请求；它不接受浏览器流量或平台 JWT。Worker 使用受限的 checkpoint 数据库凭据，且不拥有 Rust 平台写入权限。

每个请求都会由 Rust 平台验证 JWT，并返回稳定的 `userId`、可选 `tenantId` 和权限快照。Cordis 会话以这些身份字段归属，而不是以原始 token 为键。会话创建同时在平台建立授权记录，确保审批、确认、取消和写操作均保留在 Rust 的 RBAC 边界内。

审批工具会创建平台持久化的 pending action，流程进入 `run.paused`；此时 Agent storage 会保存 run、消息、迭代位置和 action ID。确认后由平台原子地将 action 置为 `executing`、执行领域操作，workflow provider 使用该 checkpoint 继续同一 run。取消、过期和失败均由平台状态机管理。

生产配置应禁用 `storage-json` 并启用 `storage-postgres`。PostgreSQL 适配器自动创建独立的 `agent_runtime_*` 表，用于会话、消息、run、步骤、checkpoint 和记忆；它不读取或写入平台领域表。部署时必须使用受限数据库账号，并将此 schema 纳入备份与迁移计划。

默认工作流使用 OpenAI-compatible `tool_calls` 协议，不接受 `@tool` 文本指令。`AGENT_MAX_TOOL_ITERATIONS`、`AGENT_RUN_TIMEOUT_MS` 与 `AGENT_MAX_TOTAL_TOKENS` 限制循环、时长和 token 预算；每次模型和工具步骤会写入 run trace。客户端断开会取消仍在运行的模型请求。

记忆仅按 tenant/user/route 作用域检索，写入前会脱敏常见邮箱、手机号和身份证格式，支持保留期、嵌入模型版本和整主体删除。配置 embedding API 后，PostgreSQL provider 保存向量并按余弦相似度检索；模型或维度变更时必须按 `embeddingVersion` 重建。

`skills`、`ui-adapter`、`sandbox`、`scheduler` 和 `audit` 都是 Cordis 服务。Skills 为 workflow 注入已启用的指令；UI adapter 只负责 Agent API 的展示协议，不承载 React 页面。Sandbox 默认拒绝执行。显式开启后会使用一次性 Docker 容器，以只读根文件系统、绑定工作目录、CPU/内存/PID/时长限制和默认断网运行命令。默认 `scheduler` 仅适合开发；生产使用 pg-boss 的 PostgreSQL 持久化队列。网关会发布 Agent 流事件，审计插件将关键事件写为 run step。

`extensions` 可从 npm 包名或相对配置文件路径加载外部插件；目标模块必须默认导出 Cordis Plugin 和完整 manifest。扩展的注入依赖、配置和卸载均由 Cordis 管理，无需修改 Host 源码。

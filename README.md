# 丫丫低代码平台

面向表单设计、数据录入、流程审批、集成自动化和 AI 员工的低代码平台。

当前版本：**1.07a**（内部包版本：`0.2.0-alpha.0`）

平台面向客户部署；商品、订单、许可证、AI 员工和未来的插件包由独立运营端 `E:\yaya-operation-center` 管理。客户平台负责验证授权、安装已购内容并执行受控业务能力，不向客户暴露 Agent 核心插件或运营侧模型密钥。

## 架构概览

```text
Browser / Tauri
       |
       v
Web (Next.js, 8787) ---- BFF ---- Rust Platform API (8788)
                                         |
                                         +-- PostgreSQL / Valkey / runtime files
                                         +-- identity, RBAC, license, approval, domain writes
       |
       +-- Agent BFF ---- Cordis Agent Runtime (8789)
                                   |
                                   +-- model / tools / skills / sessions / storage
                                   +-- policy / sandbox / scheduler / audit / UI adapter
                                   +-- optional LangGraph Worker (8790)

Operation Center
       |
       +-- customers / orders / payments / AI employee catalog / licenses
```

详细边界见 [系统架构](docs/system-architecture.md)、[Agent 架构](agent/docs/architecture.md) 和 [部署说明](deploy/README.md)。

## 已实现能力

### 低代码与业务

- 应用、导航分组、普通表单和流程表单管理。
- 可视化表单设计、草稿/发布/版本恢复、动态 PostgreSQL 表存储和子表单。
- 记录新增、编辑、删除、回收站、服务端分页/筛选/排序和自定义视图。
- 自动化工作流、条件分支、HTTP/数据节点、版本、运行日志和失败重试。
- 流程任务中心、审批、暂停、恢复、反审、评论和站内通知。
- 本地账号、钉钉登录、组织同步、RBAC 和应用/表单权限过滤。
- 即时通讯、附件、群聊和 WebSocket 实时事件，由许可证模块控制。

### Cordis Agent Runtime

- Agent 已从 Rust 推理运行时剥离，使用独立 Node/Cordis 服务运行。
- Cordis 管理插件挂载、卸载、服务依赖与事件协作；每个插件以 manifest 声明 `id`、版本、`provides`、`requires`、能力和配置 schema。
- 默认插件覆盖模型、工具、Skills、会话、JSON/PostgreSQL 存储、记忆、策略审批、审计、沙盒、调度、workflow 和 UI 协议适配。
- Agent 会话通过 BFF 访问 Cordis；平台 JWT 会被验证并转换为 tenant/user/权限快照，平台仍是授权、审批与领域写入的唯一事实来源。
- 工具写操作进入持久化 `pending_action` 状态机；确认、取消、过期和最终领域写入由 Rust API 执行。workflow 在暂停时持久化 checkpoint，并在确认后恢复同一 run。
- 支持 OpenAI-compatible tool-calling、迭代/超时/token 预算、步骤审计和 SSE 流式事件。
- 记忆按租户、用户、路由隔离，并具备常见 PII 脱敏、保留期、删除权和嵌入版本边界。
- LangGraph Worker 已有独立调用协议与可替换 workflow provider 边界；默认仍使用 Node workflow provider。

### 授权与商业交付

- 平台验证 RS256 许可证，许可证包含平台模块、模块有效期、部署类型和 AI 员工权益。
- 客户可在 AI 员工市场查看、购买、安装、更新和移除已授权的 AI 员工包及其 Skills。
- 客户侧已下架“模型供应商”和“插件”配置页面及其写接口；Cordis 模型插件使用受控运行环境中的密钥和路由配置。
- 许可证契约已预留 `pluginPackages` 权益字段，包含插件包 ID、版本、哈希、入口、manifest 与到期时间，且不包含密钥。

## 运行端口

| 服务 | 端口 | 地址 |
| --- | --- | --- |
| Web | 8787 | `http://127.0.0.1:8787` |
| Rust Platform API | 8788 | `http://127.0.0.1:8788/healthz` |
| Cordis Agent | 8789 | `http://127.0.0.1:8789/healthz` |
| LangGraph Worker | 8790 | 内部 Worker 端口 |

## 本地开发

前置条件：Node.js、pnpm、Rust、PostgreSQL；若启用生产 Agent 存储，还需要可访问的 PostgreSQL。许可证公钥默认读取 `deploy/secrets/license-public.pem`。

```powershell
pnpm install
.\scripts\start-dev.ps1
```

一键脚本会：

1. 清理本项目遗留的 Web、API、Agent 进程。
2. 启动 Rust API 并等待 `8788/healthz`。
3. 启动 Cordis Agent 并等待 `8789/healthz`。
4. 注入 `AGENT_RUNTIME_BASE_URL` 后启动 Next.js `8787`。

常用命令：

```powershell
pnpm dev:web
pnpm dev:api
pnpm dev:agent
pnpm dev:all
pnpm export:openapi
pnpm codegen:api
pnpm lint:web
pnpm check:api
pnpm check:agent
```

Web 启动前会生成 OpenAPI 客户端。修改 Rust 路由、DTO 或 OpenAPI 定义后，应执行 `pnpm export:openapi` 与 `pnpm codegen:api`。

## 部署

`deploy/compose.yaml` 运行 Web、Rust API、Cordis Agent 和 LangGraph Worker；Agent 与 Worker 不对外发布端口，仅通过单容器网络命名空间与平台通信。

生产环境必须：

- 使用 HTTPS、强随机 `AUTH_TOKEN_SECRET` 和 `BACKEND_INTERNAL_TOKEN`。
- 将模型 API Key、Worker token、数据库凭据和许可证公钥放入部署密钥管理，不写入 Git、许可证或插件 manifest。
- 使用 PostgreSQL storage、持久化调度和受限数据库账号；备份 PostgreSQL 与 `api-state` 运行时卷。
- 审查 sandbox 的容器、网络、挂载和资源限制后才启用命令执行能力。

## 目录结构

```text
web/                    Next.js 前端、BFF、Tauri 壳
api/                    Rust/Axum 平台 API、领域模块、迁移与 OpenAPI
agent/                  独立 Cordis Agent Runtime
agent/config/           插件组合配置
agent/langgraph-worker/ 独立 LangGraph Worker
deploy/                 Compose、镜像、发布与数据库迁移脚本
docs/                   系统与架构文档
scripts/                本地开发启动脚本
```

## 已落地与待落地边界

以下能力已可测试：Web/API/Agent 一键启动、Cordis 会话和工具调用、审批暂停/确认恢复、AI 员工授权安装、客户侧配置入口下架、端口统一和 OpenAPI/BFF 协议。

以下能力仍在实施，不应视为生产完成：

### 1. 运营端插件商品化与授权包交付

- 在 `yaya-operation-center` 建立插件包商品目录：manifest、版本、SHA-256、依赖、能力、配置 schema、部署类型、价格、状态和发布记录。
- 订单支持 `plugin_package` 商品项；签发许可证时写入实际 `pluginPackages` 权益，而不是当前预留的空列表。
- 运营端提供已购插件包下载接口；客户平台用当前许可证鉴权，下载后校验签名、哈希、路径和 manifest。
- 客户平台将授权包保存为不可编辑安装快照，根据许可证过期、撤销、更新和依赖变化生成 Agent 的有效插件组合。

### 2. 受控模型路由与 BYOM

- SaaS：模型适配器、模型路由、限额、密钥引用完全由运营端管理，客户平台只接收可用状态和脱敏展示信息。
- 本地部署：新增独立 `byom` 授权模块；仅持有本地部署许可证且已购买该模块的客户可配置自有模型。
- BYOM 密钥使用部署环境密钥或 KMS 加密保存，支持密钥轮换、脱敏显示、访问审计和删除；不得进入许可证、日志、前端或插件包。
- 模型插件只接收受控配置/密钥引用，支持按租户、AI 员工和用途进行路由、预算、速率限制和故障切换。

### 3. Agent 插件加载与运维

- 已授权外部插件包的隔离安装、签名校验、依赖求解、版本回滚、健康检查和审计。
- 插件组合变更后的热重载或受控滚动重启；运行中的 run 需明确取消、完成或 checkpoint 恢复语义。
- LangGraph Worker 的完整工具图、人工中断、持久化恢复、多节点压测和追踪。
- 容器 sandbox 执行器、文件挂载白名单、网络出口策略、CPU/内存/PID 限额与产物归档。
- pg-boss 持久化队列、定时任务幂等键、失败重试、死信队列、分布式调度和监控。

### 4. 质量与安全

- PostgreSQL 多实例并发、会话/run/审批/记忆迁移和压测。
- Agent 工具、审批、授权包、BYOM 和租户隔离的端到端测试与安全测试。
- 成本、token、延迟、工具错误率、checkpoint 恢复率和插件运行状态的统一可观测性。
- 数据记录和字段级权限、自动化递归触发防护、动作脚本调试能力和更多运行时字段校验。

## 验证

```powershell
pnpm check:agent
pnpm lint:web
cargo check --manifest-path api/Cargo.toml
git diff --check
```

提交或部署前，不要提交数据库密码、模型密钥、JWT、许可证签名或运行时配置文件。

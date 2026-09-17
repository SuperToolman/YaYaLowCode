# 丫丫低代码平台

面向表单设计、数据录入、流程审批、集成自动化和 AI 员工的低代码平台。

当前版本：**1.12a**（内部包版本：`0.2.0-alpha.0`）

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
       +-- Agent BFF ---- DSH Harness + YaYa plugin (8789)
                                   |
                                   +-- model / tools / skills / sessions / storage
                                   +-- policy / sandbox / scheduler / audit / UI adapter

Operation Center
       |
       +-- customers / orders / payments / AI employee catalog / licenses
```

详细边界见 [系统架构](docs/system-architecture.md)、[DSH 集成说明](docs/yaya-dsh-integration.md) 和 [部署说明](deploy/README.md)。

## 已实现能力

### 低代码与业务

- 应用、导航分组、普通表单和流程表单管理。
- 可视化表单设计、保存即生效、历史版本恢复、动态 PostgreSQL 表存储和子表单。
- 记录新增、编辑、删除、回收站、服务端分页/筛选/排序和自定义视图。
- 自动化工作流、条件分支、HTTP/数据节点、版本、运行日志和失败重试。
- 流程任务中心、审批、暂停、恢复、反审、评论和站内通知。
- 本地账号、钉钉登录、组织同步、RBAC 和应用/表单权限过滤。
- 即时通讯、附件、群聊和 WebSocket 实时事件，由许可证模块控制。

### DSH Agent Runtime

- Agent 已从 Rust 推理运行时剥离，使用独立 DSH Harness 运行。
- YaYa 平台能力通过 `agent/deepseek-harness/packages/extensions/yaya-platform` 插件注入；`yaya-agent-host` 负责 `/api/agent` 会话、流式事件、文件和产物适配。
- 默认插件覆盖模型、工具、Skills、会话、JSON/PostgreSQL 存储、记忆、策略审批、审计、沙盒、调度、workflow 和 UI 协议适配。
- Agent 会话通过 BFF 访问 Cordis；平台 JWT 会被验证并转换为 tenant/user/权限快照，平台仍是授权、审批与领域写入的唯一事实来源。
- 工具写操作进入持久化 `transaction` 状态机；执行、取消、过期和最终领域写入由 Rust API 记录与执行。workflow 在暂停时持久化 checkpoint，并在执行后恢复同一 run。
- 支持 OpenAI-compatible tool-calling、迭代/超时/token 预算、步骤审计和 SSE 流式事件。
- 记忆按租户、用户、路由隔离，并具备常见 PII 脱敏、保留期、删除权和嵌入版本边界。
- AI 员工会话工作区按“用户 / AI 员工 / 会话”隔离；上传附件复制为会话输入，Agent 产物单独登记和下载。
- AI 员工市场安装时会导入授权 Skill 包，DSH Host 仅在对应员工会话中注册其 Skill、工具与插件能力。
- `/agent` 支持 DSH 持久化会话恢复、运行状态、停止生成、工具调用记录和可收纳的产物侧栏。
- DSH Host 会在回合结束后从工作区登记新增产物，并以原始二进制流、UTF-8 文件名和受限工作区路径提供下载。

### 授权与商业交付

- 平台验证 RS256 许可证，许可证包含平台模块、模块有效期、部署类型和 AI 员工权益。
- 客户可在 AI 员工市场查看、购买、安装、更新和移除已授权的 AI 员工。安装结果是受许可证约束的员工授权快照；Cordis 在创建会话和执行时读取其 Persona、Skills 与工具边界。
- 客户侧已下架通用插件配置；客户可在“自有模型”中维护实例级模型供应商。Cordis 模型插件通过受控内部接口按请求读取该路由，运营端不接触客户密钥。
- 许可证契约已预留 `pluginPackages` 权益字段，包含插件包 ID、版本、哈希、入口、manifest 与到期时间，且不包含密钥。

## 运行端口

| 服务 | 端口 | 地址 |
| --- | --- | --- |
| Web | 8787 | `http://127.0.0.1:8787` |
| Rust Platform API | 8788 | `http://127.0.0.1:8788/healthz` |
| DSH Harness | 8789 | `http://127.0.0.1:8789` |

## 本地开发

前置条件：Node.js、pnpm、Rust、PostgreSQL；若启用生产 Agent 存储，还需要可访问的 PostgreSQL。许可证公钥默认读取 `deploy/secrets/license-public.pem`。

首次启用自有模型前，为 Rust API 设置 Base64 编码的 32 字节 `YAYA_BYOM_ENCRYPTION_KEY`。`AGENT_RUNTIME_SHARED_SECRET` 仅在 YaYa Host 适配层启用后配置。

```powershell
pnpm --dir web install
pnpm --dir agent/deepseek-harness install
.\scripts\start-dev.ps1
```

一键脚本会：

1. 清理本项目遗留的 Web、API、Agent 进程。
2. 启动 Rust API 并等待 `8788/healthz`。
3. 启动 DSH profile 并等待 `8789`。
4. 注入 `AGENT_RUNTIME_BASE_URL` 后启动 Next.js `8787`。

常用命令：

```powershell
pnpm --dir web dev
cargo run --manifest-path api/Cargo.toml
pnpm --dir agent/deepseek-harness yaya-agent-host
.\scripts\start-dev.ps1
cargo run --release --manifest-path api/Cargo.toml -- --export-openapi
pnpm --dir web codegen:api
pnpm --dir web lint
cargo check --manifest-path api/Cargo.toml
pnpm --dir agent/deepseek-harness typecheck
```

Web 启动前会生成 OpenAPI 客户端。修改 Rust 路由、DTO 或 OpenAPI 定义后，应执行 `cargo run --release --manifest-path api/Cargo.toml -- --export-openapi` 与 `pnpm --dir web codegen:api`。

## 部署

`deploy/compose.yaml` 当前只运行 Web/Rust API；DSH Harness 与 YaYa Agent Host 需要单独部署，并通过 `AGENT_RUNTIME_BASE_URL` 连接到 Web BFF。

生产环境必须：

- 使用 HTTPS、强随机 `AUTH_TOKEN_SECRET` 和 `BACKEND_INTERNAL_TOKEN`。
- 为 DSH Host 配置 `AGENT_RUNTIME_SHARED_SECRET`、`YAYA_PLATFORM_API_URL`、`DSH_AGENTS_HOME`、工作区根目录和配额；Host 必须与平台 API 使用同一受控运行时文件卷策略。
- 将模型 API Key、Worker token、数据库凭据和许可证公钥放入部署密钥管理，不写入 Git、许可证或插件 manifest。
- 使用 PostgreSQL storage、持久化调度和受限数据库账号；备份 PostgreSQL 与 `api-state` 运行时卷。
- 审查 sandbox 的容器、网络、挂载和资源限制后才启用命令执行能力。

## 目录结构

```text
web/                    Next.js 前端、BFF、Tauri 壳
  app/                  路由、布局及页面专属组件
  components/           跨页面共享 UI、主题与基础样式能力
  features/             按业务领域组织的组件、模型和 API 适配层
  styles/               主题 token 与受控通用样式
  scripts/              OpenAPI 兼容处理与前端规范检查
api/                    Rust/Axum 平台 API、领域模块、迁移与 OpenAPI
agent/deepseek-harness/ DSH Harness 与 YaYa plugin
deploy/                 Compose、镜像、发布与数据库迁移脚本
docs/                   系统与架构文档
scripts/                本地开发启动脚本
```

## 前端规范

- `app/layout.tsx` 是唯一允许导入全局样式的入口；页面和 Feature 使用 CSS Module 管理局部样式。
- 主题变量统一在 `web/styles/tokens.css` 声明，受控通用样式位于 `web/styles/utilities.css`；业务模块不得重复定义全局主题 token。
- 领域代码放在 `web/features/<domain>/`，页面专属实现放在对应路由目录；跨领域共享 UI 放在 `web/components/`。
- CSS Module 类名采用 `<domain>-<component>__<element>--<state>` 形式，Feature 不得直接引用其他 Feature 的 CSS Module。
- 执行 `pnpm --dir web lint` 可同时运行 ESLint 与样式边界检查；执行 `pnpm --dir web test` 可验证前端规则测试。

## 已落地与待落地边界

以下能力已可测试：Web/API/Agent 一键启动、Cordis 会话和工具调用、审批暂停/确认恢复、AI 员工授权安装、客户侧配置入口下架、端口统一和 OpenAPI/BFF 协议。

以下能力仍在实施，不应视为生产完成：

### 1. 运营端插件商品化与授权包交付

- 在 `yaya-operation-center` 建立插件包商品目录：manifest、版本、SHA-256、依赖、能力、配置 schema、部署类型、价格、状态和发布记录。
- 订单支持 `plugin_package` 商品项；签发许可证时写入实际 `pluginPackages` 权益，而不是当前预留的空列表。
- 运营端提供已购插件包下载接口；客户平台用当前许可证鉴权，下载后校验签名、哈希、路径和 manifest。
- 客户平台将授权包保存为不可编辑安装快照，根据许可证过期、撤销、更新和依赖变化生成 Agent 的有效插件组合。

### 2. 客户自有模型路由

- 每个客户独立部署的平台实例都可在设置中配置自有模型供应商；这不是许可证商品，也不影响 AI 员工的运营端定义。一个客户实例只维护一组模型路由。
- 模型密钥使用部署环境密钥或 KMS 加密保存，支持密钥轮换、脱敏显示、访问审计和删除；不得进入许可证、日志、前端或插件包。
- Cordis 模型插件通过内部 workload 边界按请求读取实例默认模型路由；后续支持按 AI 员工和用途细分路由、预算、速率限制和故障切换。

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
pnpm --dir agent/deepseek-harness typecheck
pnpm --dir web lint
cargo check --manifest-path api/Cargo.toml
git diff --check
```

提交或部署前，不要提交数据库密码、模型密钥、JWT、许可证签名或运行时配置文件。

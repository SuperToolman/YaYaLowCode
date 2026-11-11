# 丫丫低代码平台

品牌官网位于 [`yaya-website/`](yaya-website/README.md)，默认端口 **8744**。进入该目录执行 `pnpm dev` 本地开发，执行 `pnpm deploy` 输入服务器 IP、SSH 账号与密码，即可发布并更新固定的 `yaya-website` 容器。部署要求见[官网发布说明](yaya-website/deploy/README.md)。

面向表单设计、数据录入、流程审批、集成自动化和 AI 员工的低代码平台。

当前版本：**1.12a**

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
                                         +-- AgentV2 persistent runs / events / workspace
                                                    |
                                                    +-- Rust Worker -- Rig model requests
                                                    +-- independent Cordis Host (stdio)
                                                    +-- bounded native Office helper

Operation Center
       |
       +-- customers / orders / payments / AI employee catalog / licenses
```

详细边界见 [系统架构](docs/system-architecture.md)、[AgentV2 架构](docs/agent-v2-architecture.md) 和 [部署说明](deploy/README.md)。

## 已实现能力

### 低代码与业务

- 应用、导航分组、普通表单和流程表单管理。
- 可视化表单设计、保存即生效、历史版本恢复、动态 PostgreSQL 表存储和子表单。
- 记录新增、编辑、删除、回收站、服务端分页/筛选/排序和自定义视图。
- 自动化工作流、条件分支、HTTP/数据节点、版本、运行日志和失败重试。
- 流程任务中心、审批、暂停、恢复、反审、评论和站内通知。
- 本地账号、钉钉登录、组织同步、RBAC 和应用/表单权限过滤。
- 即时通讯、附件、群聊和 WebSocket 实时事件，由许可证模块控制。

### AgentV2

- Rust Worker 自行控制模型/工具循环，Rig 负责流式模型请求，Cordis 为独立受控插件 Host。
- 会话按部署、用户和员工隔离；员工能力映射与用户当前 RBAC/任务快照共同控制执行，许可证及安装状态持续校验。
- 任务、checkpoint、事件、工具结果及写入确认持久化，平台业务写入在用户确认后执行。
- 发送采用临时附件、二进制并发上传与原子提交；工作区持久化附件及显式生成文件。
- Excel、Word、PowerPoint 和文字 PDF 提供受限基础读取/采样，XLSX/DOCX/PPTX 支持基础生成；图片依赖供应商视觉支持。
- 主入口 `/agent-v2`；旧 `/agent` 只跳转。DSH 运行时、旧会话 API、BFF 和前端组件已移除。
- RAG、归档/恢复/彻底删除、表单草稿回填、完整插件市场与生产验收仍以[验收矩阵](docs/agent-v2-acceptance.md)为准，不因旧版移除而视为完成。

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
| AgentV2 Worker / Cordis Host | 无 HTTP 监听 | 内部任务领取 / stdio |

## 本地开发

前置条件：Node.js、pnpm、Rust、PostgreSQL；若启用生产 Agent 存储，还需要可访问的 PostgreSQL。许可证公钥默认读取 `deploy/secrets/license-public.pem`。

首次启用自有模型前，为 Rust API 设置 Base64 编码的 32 字节 `YAYA_BYOM_ENCRYPTION_KEY`。生产环境同时配置随机 `YAYA_AGENT_V2_WORKER_SECRET`。

```powershell
pnpm --dir web install
.\scripts\start-dev.ps1
```

一键脚本会：

1. 清理本项目遗留的 Web、API、Agent 进程。
2. 启动 Rust API 并等待 `8788/healthz`。
3. 构建独立 Office helper、启动 AgentV2 Worker 和 Cordis Host。
4. 启动 Next.js `8787`，进入 `/agent-v2`。

常用命令：

```powershell
pnpm --dir web dev
cargo run --manifest-path api/Cargo.toml
cargo run --manifest-path agent-v2/Cargo.toml -p yaya-agent-v2-worker
.\scripts\start-dev.ps1
cargo run --release --manifest-path api/Cargo.toml -- --export-openapi
pnpm --dir web codegen:api
pnpm --dir web lint
cargo check --manifest-path api/Cargo.toml
.\scripts\check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline
```

Web 启动前会生成 OpenAPI 客户端。修改 Rust 路由、DTO 或 OpenAPI 定义后，应执行 `cargo run --release --manifest-path api/Cargo.toml -- --export-openapi` 与 `pnpm --dir web codegen:api`。

## 部署

`deploy/compose.yaml` 单容器运行 Web、Rust API、AgentV2 Worker、独立 Cordis Host、Office helper、PostgreSQL 与 Valkey。旧 DSH 已移除。

生产环境必须：

- 使用 HTTPS、强随机 `AUTH_TOKEN_SECRET` 和 `BACKEND_INTERNAL_TOKEN`。
- 为 API 和 Worker 配置同一个强随机 `YAYA_AGENT_V2_WORKER_SECRET`；Cordis Host 不接收数据库或模型密钥。
- 将模型 API Key、Worker token、数据库凭据和许可证公钥放入部署密钥管理，不写入 Git、许可证或插件 manifest。
- 使用 PostgreSQL storage、持久化调度和受限数据库账号；备份 PostgreSQL 与 `api-state` 运行时卷。
- 审查 sandbox 的容器、网络、挂载和资源限制后才启用命令执行能力。

## 目录结构

```text
web/                    Next.js 前端、BFF、Tauri 壳
  app/                  路由、布局及页面专属组件
  shared/               无业务依赖的公共 UI、Provider、HTTP 与基础工具
  features/             按业务领域组织的组件、模型和 API 适配层
  styles/               主题 token 与受控通用样式
  scripts/              OpenAPI 兼容处理与前端规范检查
api/                    Rust/Axum 平台 API、领域模块、迁移与 OpenAPI
agent-v2/               Rust core、Worker、Office helper 与独立 Cordis Host
deploy/                 Compose、镜像、发布与数据库迁移脚本
docs/                   系统与架构文档
scripts/                本地开发启动脚本、独立 Node.js 离线打包工具
```

## 前端规范

- `app/layout.tsx` 是唯一允许导入全局样式的入口；页面和 Feature 使用 CSS Module 管理局部样式。
- 主题变量统一在 `web/styles/tokens.css` 声明，受控通用样式位于 `web/styles/utilities.css`；业务模块不得重复定义全局主题 token。
- 领域代码放在 `web/features/<domain>/`，页面专属实现放在对应路由目录；通用 UI 放在 `web/shared/ui/`，应用外壳位于 `web/app/_components/`。
- 依赖方向为 `app → features → shared`，统一使用 `@/` 路径别名。目录职责和使用规则见 [前端说明](web/README.md)。
- CSS Module 类名采用 `<domain>-<component>__<element>--<state>` 形式，Feature 不得直接引用其他 Feature 的 CSS Module。
- 执行 `pnpm --dir web lint` 可运行结构、HTTP、ESLint 与样式边界检查；执行 `pnpm --dir web test` 可验证前端规则测试。

## 已落地与待落地边界

以下能力已可测试：Web/API/AgentV2 一键启动、Rust/Rig 会话和 Cordis 工具调用、审批暂停/确认恢复、AI 员工授权安装、客户侧配置入口下架、端口统一和 OpenAPI/BFF 协议。

以下能力仍在实施，不应视为生产完成：

### 1. 运营端插件商品化与授权包交付

- 在 `yaya-operation-center` 建立插件包商品目录：manifest、版本、SHA-256、依赖、能力、配置 schema、部署类型、价格、状态和发布记录。
- 订单支持 `plugin_package` 商品项；签发许可证时写入实际 `pluginPackages` 权益，而不是当前预留的空列表。
- 运营端提供已购插件包下载接口；客户平台用当前许可证鉴权，下载后校验签名、哈希、路径和 manifest。
- 客户平台将授权包保存为不可编辑安装快照，根据许可证过期、撤销、更新和依赖变化生成 Agent 的有效插件组合。

### 2. 客户自有模型路由

- 每个客户独立部署的平台实例都可在设置中配置自有模型供应商；这不是许可证商品，也不影响 AI 员工的运营端定义。一个客户实例只维护一组模型路由。
- 模型密钥使用部署环境密钥或 KMS 加密保存，支持密钥轮换、脱敏显示、访问审计和删除；不得进入许可证、日志、前端或插件包。
- Rust API 通过 BYOM 公共服务解析实例模型路由，由 V2 Worker 使用 Rig 请求模型；后续支持按 AI 员工和用途细分路由、预算、速率限制和故障切换。

### 3. Agent 插件加载与运维

- 已授权外部插件包的隔离安装、签名校验、依赖求解、版本回滚、健康检查和审计。
- 插件组合变更后的热重载或受控滚动重启；运行中的 run 需明确取消、完成或 checkpoint 恢复语义。
- Rust AgentV2 Worker 的多实例压测、故障恢复覆盖与执行追踪。
- 容器 sandbox 执行器、文件挂载白名单、网络出口策略、CPU/内存/PID 限额与产物归档。
- PostgreSQL 持久任务的调度、幂等、失败重试与监控验收。

### 4. 质量与安全

- PostgreSQL 多实例并发、会话/run/审批/记忆迁移和压测。
- Agent 工具、审批、授权包、BYOM 和租户隔离的端到端测试与安全测试。
- 成本、token、延迟、工具错误率、checkpoint 恢复率和插件运行状态的统一可观测性。
- 数据记录和字段级权限、自动化递归触发防护、动作脚本调试能力和更多运行时字段校验。

## 验证

```powershell
.\scripts\check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline
pnpm --dir web lint
cargo check --manifest-path api/Cargo.toml
git diff --check
```

提交或部署前，不要提交数据库密码、模型密钥、JWT、许可证签名或运行时配置文件。

# 丫丫低代码平台

一个面向表单设计、数据录入、集成自动化与智能辅助场景的低代码平台原型项目。当前仓库已经包含应用管理、表单设计器、表单运行时、自动化工作流编辑器、身份认证与 RBAC 权限中心、受控 Agent MVP，以及基于 Rust + PostgreSQL 的后端服务。

当前版本：**0.67a**（内部语义化版本：`0.2.0-alpha.0`）

## 当前状态

当前项目已经打通以下核心链路：

- 创建应用
- 在应用下创建普通表单、流程表单与分组
- 在表单设计器中拖拽组件、配置属性、编辑动作脚本
- 配置富文本、级联选择和地区目录字段
- 保存草稿、发布版本、恢复历史版本，并为已发布表单同步独立的动态数据表
- 在运行时页面新增、编辑、删除并查看表单记录
- 在记录表格中查看关联表单字段，并打开关联记录的只读详情
- 通过自定义视图查看表单数据，并支持分页读取记录
- 基于表单事件触发集成自动化
- 查看自动化运行日志并执行失败重试
- 提交流程表单记录，按审批流处理待办、拒绝或反审
- 使用本地账号密码或钉钉扫码登录，并按角色权限访问平台、应用和表单
- 配置 OpenAI Compatible 模型，并在授权范围内使用 Agent 分析资源、创建表单草稿和保存 Schema 草稿
- 通过独立子路由管理数据库、Agent、身份源、用户、角色和权限设置

## 技术栈

### 前端

- Next.js 16
- React 19
- Tauri 2（桌面端）
- HeroUI
- React Flow
- Monaco Editor
- `@hey-api/openapi-ts`
- `react-markdown` / `remark-gfm`
- `xlsx`

### 后端

- Rust
- Axum
- SeaORM `2.0.0-rc.41`
- PostgreSQL
- Reqwest
- Rig

## 已实现能力

### 1. 应用管理

- 应用列表展示
- 创建空白应用
- 应用卡片访问入口
- 应用启用 / 关闭
- 编辑应用名称
- 删除应用
- 应用设置页面（当前大部分配置为前端占位）

### 2. 应用导航

- 应用下内置系统页面
- 表单导航
- 分组导航
- 分组递归嵌套
- 导航拖拽排序

### 3. 表单设计器

- 组件箱
- 大纲树
- 数据源变量配置
- 动作面板统一脚本编辑
- 页面源码查看
- 分组容器组件
- 组件属性编辑
- 字段默认值与公式编辑
- 页面属性配置
- 字段索引配置（发布时创建或更新 B-tree 索引）
- 预览
- 保存草稿
- 发布
- 恢复历史版本
- 流程表单：创建时自动生成审批流程，记录支持保存、提交、审批、拒绝和反审
- 富文本组件：支持常用文本排版、列表、链接、图片、表格与任务列表；级联组件支持多层级数据源和中英文标签

### 4. 表单运行时

- 表单提交视图
- 全部数据视图
- 抽屉式新增记录
- 已发布 Schema 渲染
- 运行时动作脚本执行
- 记录级编辑
- 记录级删除
- 运行时记录变更触发自动化
- 子表单（Subform）表格视图：行增删改排序、主题切换、批量导入/导出、列冻结
- 自定义数据视图：服务端持久化、创建、编辑、删除
- 表单记录分页查询
- 地区目录：支持树形目录查询、导入和运行时多语言显示
- 字段大纲：按应用查看表单、字段、Schema 版本与动态物理表

### 5. 集成自动化

- 自动化列表页
- 自动化编辑器
- 暗色工作区与节点属性面板
- 工作流名称、说明、启停状态、版本管理
- 触发器节点
- 条件分支节点
- 获取单条数据节点
- 获取多条数据节点
- 新增数据节点
- 更新数据节点
- 删除数据节点
- HTTP 请求节点
- 流程节点：审批、执行、抄送、结束；流程可复用数据操作和 HTTP 请求节点
- 自动化版本快照与恢复

### 6. 自动化运行与日志

- 支持触发事件：
  - `before_create`
  - `after_create`
  - `before_update`
  - `after_update`
  - `before_delete`
  - `after_delete`
- 自动化运行日志查询
- 节点级执行日志
- 输入 / 输出载荷查看
- 运行耗时展示
- 整条流程重头触发
- 错误节点断点重试
- 流程运行时：流程实例、审批/执行待办、操作历史、同意、拒绝和反审

### 7. Agent 智能助手

- 多级 Agent 管理体系：模型提供商 → 配置档案 → Agent 定义
- 模型提供商（Provider）管理，支持 OpenAI Compatible / DeepSeek 等
- Agent 配置档案：对话模型、Embedding 模型、Temperature、最大执行步骤、上下文策略、插件/Skill/知识库绑定
- Agent 定义：按平台/应用/业务范围分配 Agent，可指定人格（Persona）
- Agent 人格预设：默认人格、业务分析师、低代码实施顾问
- 全局 Agent 助手入口
- Agent 会话与历史消息
- SSE 流式响应，支持 Markdown 渲染
- 按配置档案授权访问表单、应用和自动化工具；可受控创建表单草稿及保存 Schema 草稿
- 已绑定 Skill、知识库和插件工具可参与 Agent 运行，并保留资源与工具调用审计
- 会话、消息、运行和步骤审计记录
- 当前 Agent 仅支持配置档案授权的有限写入，不支持发布或删除操作

### 8. 平台与应用设置

- 平台数据库连接设置、状态检测与保存前连接测试
- Agent 多级管理：模型供应商、配置档案、Agent 定义、人格管理
- 插件与 Skills 定义管理
- 知识库配置入口
- 身份源设置：钉钉组织体系的 AccessToken 管理、部门/用户同步、同步数据清理与 OAuth 登录配置
- 平台本地用户与角色管理：用户资料、多个邮箱地址、账号状态、角色分配，以及本地用户和角色 CRUD
- RBAC 权限中心：按角色配置平台设置、应用和表单操作权限；应用导航会按授权结果过滤
- 设置页面独立子路由与左侧导航（共 13 项），支持多级分组
- 设置导航和内容区域独立滚动
- 应用基础设置、表单设置、管理员、权限与数据工厂页面（当前大部分配置为前端占位）

### 9. 后端接口与存储

- 应用增删改查
- 表单创建与删除
- 导航分组与排序
- 表单 Schema 草稿保存
- 表单发布
- 表单版本查询与恢复
- 表单记录保存、查询、编辑、删除（按已发布表单的独立动态表持久化）
- 自动化增删改查
- 自动化版本查询与恢复
- 自动化运行日志与重试接口
- Agent 设置接口
- Agent 会话、消息和流式运行接口
- 本地登录、钉钉 OAuth 登录和 JWT 鉴权
- 用户、角色与角色权限管理接口
- 表单视图、字段大纲和记录分页接口
- 流程表单创建、流程实例与待办审批接口
- 地区目录、文件上传下载和数据库连接测试接口

## 表单数据存储结构

已发布表单会编译为独立的混合物理存储，而不是继续共用 `form_records`：

- `form_storage_definitions`：保存表单物理表名、字段映射和已编译 Schema 版本。
- `form_data_<form_uuid>`：每张已发布表单的主数据表，通用记录元数据与可映射标量字段使用实体列。
- `form_data_<form_uuid>_<subform_field>`：子表单对应的子表，用于保存子表单行。
- `extension_data JSONB`：仅保存附件、对象等复杂字段或暂未映射的扩展字段；查询结果会与标量列重组为统一的记录数据。

## 自动化存储结构

当前自动化已拆分为独立结构化存储，而不是仅保存整包图 JSON：

- `automation_flows`
- `automation_flow_versions`
- `automation_nodes`
- `automation_edges`
- `automation_flow_runs`
- `automation_flow_run_nodes`

Agent MVP 使用以下结构保存会话与审计信息：

- `agent_sessions`
- `agent_messages`
- `agent_runs`
- `agent_run_steps`

身份与表单工作区补充使用以下结构：

- `iam_local_credentials`
- `iam_user_email_addresses`
- `form_views`

流程表单运行时使用以下结构：

- `workflow_instances`
- `workflow_tasks`
- `workflow_actions`

## 本地启动

### 前端启动

```bash
pnpm install
pnpm dev:web
```

执行 `pnpm dev:web` 前会自动先运行一次：

```bash
pnpm codegen:api
```

用于根据 [`web/openapi/openapi.json`](web/openapi/openapi.json) 自动更新前端 API Client。

后端运行时从 `/openapi.json` 导出最新路由契约。`web/openapi/openapi.base.json` 暂时保留既有应用、表单和自动化接口的细粒度 Schema；启动脚本会将其与后端导出的新增路径合并，待所有 Rust DTO 完成 `ToSchema` 标注后可移除该兼容基线。

### 后端启动

在仓库根目录执行：

```bash
pnpm dev:api
```

### 前后端一起启动

在仓库根目录执行：

```powershell
.\scripts\start-dev.ps1
```

脚本会等待后端健康检查通过，从后端 `/openapi.json` 下载最新 API 契约，再运行 HeyAPI 生成客户端，最后启动前端。也可以使用 `pnpm dev:all`。

如果前端已经更新了自动化相关页面或代理接口，而本地运行日志接口仍然返回 `404` 或提示路由不可用，通常是后端进程还是旧版本，直接重启后端即可。

### Tauri 桌面端

桌面端位于 [`web/src-tauri`](web/src-tauri)，使用 Tauri 2。由于当前 Next.js 项目使用了 SSR、Server Components 和 API Route，桌面客户端采用“桌面壳连接独立 Web 服务”的结构，以完整保留现有功能。

本地开发时先启动 API，再启动桌面端：

```bash
pnpm dev:api
pnpm dev:desktop
```

`pnpm dev:desktop` 会自动启动 Next.js 开发服务器，并在 Tauri 窗口中打开 `http://127.0.0.1:3000`。

构建桌面安装包前，需要先确定桌面客户端连接的 Web 地址。默认地址是 `http://127.0.0.1:3000`，也可以通过 `YAYA_WEB_URL` 指向已部署的 Web 服务：

```powershell
$env:YAYA_WEB_URL="https://your-web.example.com"
pnpm build:desktop
```

桌面端安装包不内嵌 Next.js 服务和 PostgreSQL；生产环境仍需单独部署 `web` 与 `api`。如果后续需要完全离线的单机版，可再将 Next.js Server 和 API 打包为 Tauri sidecar。

## 数据库配置

当前项目默认使用 PostgreSQL。推荐通过以下任一方式配置连接：

- 在 `/settings/database` 页面填写并验证数据库连接。
- 设置 `DATABASE_URL` 环境变量，例如：

```bash
DATABASE_URL=postgres://postgres:your_password@localhost:5432/yaya_low_code
```

未提供本地设置文件和 `DATABASE_URL` 时，后端会尝试连接无密码的本地地址 `postgres://postgres@localhost:5432/yaya_low_code`。

数据库配置保存在 `.yaya-lowcode-settings.json`，该文件可能包含密码，已被 Git 忽略，不应上传到仓库。

请提前确认本地 PostgreSQL 已启动，并且已创建对应数据库。

## Agent 配置

在 `/settings/model-providers` 配置模型供应商，在 `/settings/agent-profiles` 配置对话模型、Embedding 模型、Temperature 等参数，在 `/settings/agents` 创建和管理 Agent 定义。Agent 可按平台/应用/业务范围分配，并指定人格（Persona）。

Agent 配置保存在 `.yaya-agent-registry.json`，该文件可能包含 API Key，已被 Git 忽略。Agent 启用后可通过全局侧边栏入口创建会话，当前只允许读取应用、表单和自动化信息。

## 身份源配置

权限中心支持本地账号与钉钉组织身份。钉钉的 App ID、原企业内部应用 AgentId、Client ID、Client Secret、同步策略和首次登录自动创建用户策略可以在 `/settings/identity-source` 页面维护，保存后立即生效，无需重启服务。

身份源配置保存在后端本地 `.yaya-identity-settings.json` 文件中，该文件已被 Git 忽略。
钉钉 AccessToken 通过后端接口获取，并连同过期时间直接写回该配置文件。

登录页默认提供本地账号密码登录；钉钉登录会跳转到钉钉 OAuth 授权页，回调后创建平台 JWT 会话。生产环境应设置随机且保密的 `AUTH_TOKEN_SECRET`；Web 服务与 API 服务使用不同进程部署时，还应设置相同的 `BACKEND_INTERNAL_TOKEN`，供 Web 服务读取钉钉 OAuth 配置。

## 目录结构

```text
web/                    Next.js Web 前端
web/app/                Next.js App Router
web/openapi/            OpenAPI 描述文件
web/app/lib/api-client/ heyapi 生成的前端 API Client
web/src-tauri/          Tauri 2 桌面端壳层
api/                    Rust + Axum API 服务
```

## 设计说明

- 设计器预览默认读取当前草稿 Schema
- 实际运行时页面默认读取已发布 Schema
- 自动化编辑器当前采用画布式工作流设计
- 右侧属性面板仅在选中节点时显示
- 自动化条件分支当前已支持全上游节点数据作为可选来源
- 动作脚本当前支持：
  - `didMount(ctx)`
  - `onFieldEvent(ctx)`
  - `onSubmit(ctx)`

## 构建验证

常用命令：

```bash
pnpm lint:web
pnpm build:web
pnpm check:api
cd web && cargo check --manifest-path src-tauri/Cargo.toml
```

`0.3b` 发布前，应完成上述前后端核心检查，并验证动态表、索引和子表单触发器可在目标 PostgreSQL 环境正常执行。

发布前还应确认本地设置文件未被 Git 跟踪，并避免在文档、日志或提交内容中写入数据库密码和模型 API Key。

## 下一步建议

- 子表单设计器端拖拽、字段配置与属性编辑
- 动态表、索引和子表单触发器的 PostgreSQL 端到端集成测试
- 自动化递归触发防护
  - 事件来源标记
  - 执行深度限制
  - 循环链路风险检测
- 自动化运行日志后端分页、筛选、统计汇总与日志保留策略
- HTTP 请求节点补充更完整的响应状态、响应头与错误上下文
- 条件分支规则编辑器继续向宜搭式交互收敛
- 字段映射编辑器继续细化
- RBAC 授权规则与应用、表单、自动化链路的端到端测试
- 更细粒度的数据记录与字段级权限
- 动作脚本调试增强
- 更多字段类型与运行时校验能力
- Agent 写操作的人工确认与权限审计
- Agent 插件运行时加载与执行引擎
- 知识库文档处理、Embedding 与 pgvector 检索
- Skills 加载器、工具白名单和知识范围配置

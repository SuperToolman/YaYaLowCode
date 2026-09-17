# 业务逻辑与 UI 解耦计划

## 目标

将路由级 Client Component 收敛为“页面编排 + 本页 UI 组合”，把跨页面的远程数据、稳定领域状态转换、校验和 CRUD 能力放入 feature 边界内。页面不得直接持有 API 路径、响应信封解析或跨页面复用的领域规则；页面专属状态和 JSX 不因目录规范被强行抽离。

### 归属判断原则

`features` 表示业务域边界，不等于所有代码都必须抽成可复用组件。只有在多个页面/入口使用、属于稳定领域能力、或需要独立测试维护时才迁入 feature。仅服务单一路由的视图配置、导入导出编排和页面交互模型，保留在该路由的 `model/` 或 `components/` 中；页面专属 UI 不为形式复用而抽离。

本计划只包含尚未完成的工作。已迁移的 records Schema、Excel/关联表单、草稿模型，以及 form-designer 历史和 Agent 流帧模型不在本计划范围内。

## 目标结构

```text
features/<domain>/
├── api.ts or api/             # Hey SDK 或未覆盖端点的 feature adapter
├── model/                     # 纯转换、校验、状态机、query key、业务 hook
├── components/                # 业务 UI，不感知路由路径
├── types.ts                   # 领域类型与 DTO 到 UI 类型的边界
└── index.ts                   # 对外稳定出口
```

依赖方向：

```text
app route/page -> feature components -> feature model -> feature api -> SDK/request adapter
app route/page -> shared components
feature A -> feature B 的 index.ts（仅明确的公共类型或能力）
```

禁止：

- `features/*` 导入 `app/(...)` 下的组件、工具或类型。
- 业务组件导入路由参数、`next/navigation` 并同时承载领域状态机。
- 页面直接解析 API 信封、拼接业务 API URL 或实现通用数据转换。
- 跨 feature 导入另一个 feature 的内部 `model/`、`components/` 文件。

## P0：Records 页面继续拆分

对象：[FormRecordsScreen.tsx](../app/(protected)/(main)/[appId]/[formUuid]/components/FormRecordsScreen.tsx)

### 1. 抽离记录工作台状态

新增 `features/records/model/use-records-workbench.ts`，负责：

- 分页、搜索延迟值、选中记录、抽屉打开状态。
- 新增、编辑、删除后的 Query 缓存失效与页面回退。
- URL 中 `record` 参数与当前选中记录的同步。
- 权限能力到 `canCreate/canEdit/canDelete` 的映射。

页面保留：路由参数、`RecordsWorkspace` 组件组合和系统页/定义页分流。

### 2. 收敛记录编辑提交编排（按复用性决定归属）

记录编辑器只服务当前 Records 路由时，优先放在 `app/(protected)/(main)/[appId]/[formUuid]/model/`；只有被多个入口使用时才迁入 `features/records/model/`。无论归属何处，模型负责：

- 新建、编辑、继续提交的表单值初始化。
- Runtime 表单校验结果到提交状态的转换。
- 创建、更新、工作流提交 mutation 的选择与错误映射。
- 草稿恢复、保存、删除与提交成功后的清理。

现有抽屉 UI 保持在路由组件中。只有确认存在第二个使用入口、且 props 边界稳定时，才新增 `features/records/components/RecordEditorDrawer.tsx`；抽离后组件只接收明确 props，不读取路由参数或自行请求记录。

### 3. 收敛页面专属视图配置

在 `app/(protected)/(main)/[appId]/[formUuid]/model/use-form-views.ts` 维护页面专属视图配置，负责：

- 视图字段、筛选、排序、列顺序的默认值和校验。
- 视图草稿与服务端 View DTO 的双向转换。
- 新建、编辑、删除、设为默认视图的 mutation 编排。

`FormTableSetting` 与 `ViewConfigComponents` 保留为 UI；路由级组件不再维护 view draft 的细节。

### 4. 收敛页面专属导入导出控制器

在 `app/(protected)/(main)/[appId]/[formUuid]/model/use-record-import-export.ts` 维护页面专属导入导出编排，负责：

- Excel 解析、字段映射校验、关联数据预加载和导入并发控制。
- 导出列、内置字段、记录值序列化和文件名生成。
- 导入进度、成功/失败项和取消状态。

`FormDataImportDrawer` 仅展示导入状态和触发回调；Web Worker 调用不应位于路由页面。

Records 审核结论：`use-record-editor`、`use-record-import-export` 和草稿存储均已被页面实际使用，继续保留在该路由 `model/`；未接入的 `use-records-workbench` 已删除。分页、搜索、视图弹窗和 URL 状态仍属于当前页面编排，不新增跨页面控制器。导入进度状态声明顺序已修正，保留原 HeroUI 表格、抽屉和导入 UI。

## P0：Designer 编辑器无损收口（已审核）

对象：[DesignerScreen.tsx](../app/(protected)/(main)/designer/[formUuid]/components/DesignerScreen.tsx)

审核确认 Designer 目前只有一个完整编辑入口，文档状态、画布交互和工作台状态都与该页面的 DnD、历史提交和 UI 生命周期紧密关联。此前新增但未接入的 `use-designer-document.ts`、`use-designer-canvas-interactions.ts`、`use-designer-workbench.ts` 已删除，避免形成与真实页面并行的简化实现。

当前边界如下：

- Schema、布局、校验、拖拽、快捷键和工作台状态继续保留在 Designer 路由。
- `features/form-designer` 保留请求适配和已被真实使用的通用历史纯函数。
- Designer 路由通过 feature 公共出口访问请求适配和历史函数，不访问 feature 内部路径。
- Header、Sidebar、Canvas、Preview 和 HeroUI 结构保持不变。
- 只有出现第二个真实编辑入口时，才重新评估文档或画布控制器抽取。

## P1：自动化编辑器继续下沉（保留路由专属 UI）

对象：[PageClient.tsx](../app/(protected)/(main)/[appId]/automations/[automationId]/components/PageClient.tsx)

`features/automation-editor/api.ts` 作为稳定请求入口；页面专属图模型与节点注册保留在 Automation 路由。

### 1. 抽离流程加载与保存

流程、表单、明细表单、成员、版本的加载和保存仍由当前 Automation 路由完整编排。未接入的简化 `use-automation-editor.ts` 已删除，避免与真实页面状态形成第二套实现。

### 2. 抽离图编辑命令

`features/automation-editor/model/graph-commands.ts` 仅保留已被页面实际使用的 React Flow change 转换及基础图命令，负责：

- 添加、删除、连接、插入节点。
- 条件分支、节点配置、触发器同步。
- Node/edge change 到领域图状态的转换（参数遵循 React Flow 的 `changes, current` 顺序）。

页面保留 `ReactFlowProvider` 和布局组合；`WorkflowCanvas` 只处理画布 UI 事件。

### 3. 编辑器业务 UI（条件式抽离）

只有在多个自动化入口共享且交互契约稳定时，才迁入 `features/automation-editor/components/`：

- `AutomationEditorHeader`
- `AutomationNodePalette`
- `AutomationPropertiesPanel`
- `AutomationVersionDialog`

否则继续保留在路由目录，路由只负责 lazy loading、数据注入和组合；不得为了目录整洁替换现有 React Flow/HeroUI UI。

## P1：用户管理页面（先无损迁移，暂不强制拆 UI）

对象：[settings/users/page.tsx](../app/(protected)/settings/users/page.tsx)

### 1. 用户表单模型

新增 `features/identity-access/model/user-form.ts`，负责：

- 创建与编辑用户的默认值、字段校验、角色 ID 规范化。
- API DTO 与 UI 表单值转换。
- 本地账号初始化结果的展示数据转换。

### 2. 用户管理控制器（页面专属优先）

用户/角色请求和稳定的 DTO、校验逻辑可放入 `features/identity-access`。搜索、筛选、分页及弹窗开关若仅服务该页面，保留在路由 `page.tsx` 或其同目录 `model/`。只有第二个入口出现时，才新增页面无关的控制器 hook。负责范围包括：

- 用户、角色加载与刷新。
- 创建、编辑、启停、删除、初始化凭据 mutation。
- 搜索、筛选和分页状态。

### 3. UI 保持现状

保留现有 HeroUI Table、角色选择、筛选和弹窗 JSX。只有实际复用需求明确时，才新增 `features/identity-access/components/`：

- `UserTable`
- `UserEditorDialog`
- `CredentialInitializationDialog`

设置页继续作为该页面的 UI 与交互承载者；迁移不得改变组件库、视觉样式或已有功能。

## P1：收敛路由目录遗留领域文件

将下列可复用非路由文件逐步迁入所属 feature：

- `app/(protected)/(main)/[appId]/[formUuid]/form-record-utils.ts`：仅将确认跨页面复用的纯函数迁入 records；展示和页面编排保持路由边界。
- `app/(protected)/(main)/[appId]/[formUuid]/model/use-form-views.ts`：保留在 Records 路由，页面专属视图状态不强制跨 feature 复用。
- `app/(protected)/(main)/designer/[formUuid]/designer-*.ts`：按 Schema、布局、校验、交互逐项判断；页面专属模型可留在路由 `model/`。
- `app/(protected)/(main)/[appId]/automations/[automationId]/automation-editor-model.ts`：仅将稳定领域图模型迁入 `features/automation-editor/model/`，页面专属状态保留兼容层或路由模型。

迁移时先建立 feature 公共出口，再用 `git mv` 移动文件并更新 import；每次只迁移一个模型边界。

## 验收标准

- 路由 `page.tsx` 处理 params/searchParams、Server 数据、权限、本页状态和 UI 组合；不直接解析远程 DTO 或实现跨页面领域规则。
- 路由级 Client Screen 不直接拼接 API URL 或解析响应信封；页面专属 DTO 转换、校验和交互模型可在同路由 `model/` 定义。
- 每个 feature 的远程状态均通过 `api.ts`、Query hooks 或 mutation hooks 访问。
- 每个抽离的模型具备最小单元测试：纯函数覆盖输入/边界/错误，hook 覆盖关键状态转换。
- `pnpm exec tsc --noEmit`、`pnpm build`、相关交互回归全部通过。
- 跨 feature import 仅使用 `@features/<domain>` 公共出口；页面内部可使用本路由 `model/`、`components/`，禁止 feature 反向依赖 `app/(...)`。

## 非目标

- 不为目录形式强制将拖拽、Monaco、React Flow 或 Runtime Form 改为 Server Component。
- 不将短生命周期的输入值全部替换为 React Query 或全局 store。
- 不在本阶段重写后端接口、OpenAPI 契约或路由 URL。

## 后续执行约束

每迁移一个边界，先回答三个问题：是否有第二个使用入口、是否存在稳定的领域不变量、是否能在不改变现有 UI 和交互的前提下定义清晰接口。三个问题均不能明确回答“是”时，代码留在当前路由目录，不新增 feature 抽象。

执行顺序固定为：

1. 先做纯函数、DTO 转换和请求适配的归属调整，并补测试。
2. 再做 hook 的状态边界调整，保持 URL、缓存、错误和取消行为不变。
3. 最后才评估 UI 组件是否存在真实复用；没有复用就保留原组件文件和 HeroUI 结构。

任何迁移都必须通过 `pnpm exec tsc --noEmit`、相关测试和 `pnpm build`，并对 Records、Designer、Automation、Users 做现有交互回归。发现样式、角色选择、筛选、弹窗或表格行为变化时，立即回退该边界的抽离，而不是在新 feature 中重写一套 UI。

Automation 的历史页面组件已逐文件改为从同路由 `../automation-editor-model` 读取图模型类型和转换函数，节点注册仍保留在自动化路由侧。`features/automation-editor` 不再反向依赖 `app`，也不再导出页面专属图模型；后续只有出现第二个自动化入口且领域契约稳定时，才考虑抽取共享模型。

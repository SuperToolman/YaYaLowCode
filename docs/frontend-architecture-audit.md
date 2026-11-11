# 前端架构递归检查

检查日期：2026-11-10。范围：`web/app`、`web/features`、`web/shared`、`web/scripts` 的全部深层 JavaScript/TypeScript 源文件，以及非生成目录。下方保留首次递归检查的发现；本轮已按这些发现完成以下调整。

## 后续优化复核（当前状态）

按用户要求继续处理 ESLint 警告、大型组件职责拆分及构建兼容配置；浏览器端到端验收不在本轮范围内。

- 清理 49 条 ESLint 警告，包括无用导入、废弃弹窗和禁用分支；修正主题上下文和通知加载的 Hook 依赖。`lint` 改为 `eslint --max-warnings 0`，防止新增警告被放行。
- 表单运行时拆出字段控件、节点组合、上下文订阅和布局工具，原入口保留兼容导出；自动化编辑器拆出节点配置操作 Hook；记录页拆出 Excel 工作簿流程，记录表格拆出单元格、列布局和值格式化。
- Next.js 与 eslint-config-next 从 16.2.7 同步升级至 16.2.12，移除 `experimental.turbopackScopeHoisting: false`。恢复默认优化后的普通生产构建连续两次通过，验证了当前依赖与配置组合；未作上游根因已永久修复或性能提升的推断。

| 组合入口 | 拆分前行数 | 拆分后行数 | 提取职责 |
| --- | ---: | ---: | --- |
| `FormHomeRecords.tsx` | 2,201 | 1,539 | 工作簿解析、模板、导入导出及状态 |
| 自动化 `PageClient.tsx` | 1,818 | 1,257 | 节点配置修改操作 |
| `RuntimeFormRenderer.tsx` | 1,603 | 624 | 字段控件、节点布局、上下文及工具 |
| `RecordsTable.tsx` | 1,582 | 1,109 | 单元格、列布局、值格式化及类型 |

行数包含注释和空行，按移除文件末尾空白后的文本计数，仅用于说明职责集中程度。拆分后的页面仍承担状态、交互和组合，后续可随具体业务需求继续细化。

| 最终检查 | 结果 |
| --- | --- |
| 完整 lint（结构、HTTP、ESLint、样式） | 通过，ESLint 0 错误、0 警告 |
| 前端全量测试 | 121 个文件、571 项全部通过；本轮新增 8 项回归测试 |
| 新增回归覆盖 | 节点不可变更新及分支约束、导入映射与部分失败、过期解析响应、子表展开及内置列顺序 |
| 依赖图 | 713 个源码文件、1,821 条本地依赖边，未发现未解析引用、层间边界错误或文件/领域运行时循环 |
| API 契约及 TypeScript | `contract:check` 通过，生成 SDK 与当前契约一致 |
| 开发契约 | 通过，26 类组件、13 类节点，110,812 字节，内容保持一致 |
| 默认优化生产构建 | Next.js 16.2.12 下连续两次通过 |
| 平台打包脚本 | 5 项测试通过；未实际重新构建、启动并导出 Docker 镜像 |

依赖图覆盖 `app`、`features`、`shared` 的源码及测试，排除生成 SDK；动态计算路径和运行时交互仍不由静态检查证明。本轮未进行浏览器端到端验收，也未测量包体积或浏览器性能收益。下方旧阶段的测试数量、警告和兼容配置记录仅描述当时状态，以本节为准。

## 前一阶段调整与复核（历史记录）

- 拆开消息气泡容器与内容渲染的相互引用；自动化模型不再反向导出节点注册菜单。
- 新建 `features/form-model`，承载表单 Schema 类型、字段元数据、日期校验、展示选项和动作代码契约。字段选择控件归入 `form-controls`，条件规则及编辑器归入 `conditions`，业务基础能力不依赖消费者实现。
- `MyAvatar`、`MyTable` 及其样式和测试迁入 `shared/ui`；应用外壳上下文及自动化标题事件下沉到所属业务领域。
- 设计器实现迁入 `features/form-designer/editor`；自动化实现迁入 `features/automation-editor/editor`、`management`、`model`，路由继续保留 URL、页面和布局入口。
- `RecordsWorkspace` 提供嵌入记录页的渲染接口；按钮页面抽屉归入记录动作组合层，通过上下文调用接口，保留懒加载，消除反向导入完整记录屏幕的依赖环。
- 字段属性面板按关联表单、关联回填、子表和流水号拆分；运行时初始化逻辑提取到 `form-runtime/model/initial-state.ts`；记录页拆出薄加载入口；自动化的 34 个类型声明独立到 `model/editor-types.ts`。
- 结构检查加入 TypeScript 内联导入类型、文件运行时循环、业务领域循环和源码内生成目录检查，并补充回归测试。迁移 3 处源码中的 Vitest 缓存至 `web/.cache`，移除 38 个已确认真正为空的目录。

架构调整完成时的依赖图覆盖 `app`、`features`、`shared`，排除生成 SDK；共 695 个代码文件，其中生产文件 581 个、本地依赖边 1,755 条。未解析本地代码引用、同步文件循环、包含动态加载的运行时文件循环、业务领域运行时循环均为 **0**。统计范围与首次检查不同，文件数不能直接作增减对比。显式类型依赖参与层间边界检查，不计为运行时循环；计算动态路径、上下文注入语义和浏览器交互仍需要人工验证。

验证结果：

| 检查 | 结果 |
| --- | --- |
| 结构、HTTP、样式边界 | 通过 |
| 开发契约一致性 | 通过，26 类组件、13 类节点，导出内容未改变 |
| API 契约及 TypeScript | 通过，重新生成 SDK 与已保存契约一致 |
| 生产构建 | 修复预渲染问题后，普通 `pnpm run build` 连续两次通过 |
| 前端全量测试 | 错误修复后的最终复核：118 个测试文件、563 项测试全部通过 |
| 打包脚本测试 | 5 项通过；本轮未实际重新构建、启动并导出 Docker 镜像 |
| ESLint | 0 个错误、49 条警告；完整 `pnpm run lint` 通过 |

### 测试与构建错误修复

原先 10 项 Agent 页面测试首先受阻于测试环境缺少 `QueryClientProvider`。补齐独立 QueryClient 后，继续补全知识库、模型配置、会话详情及执行记录的模拟请求；使用有效历史时间和明确的完成/排队状态，更新全局通知及断线后不取消任务的断言。历史分页、重复事件、会话切换、发送重试、输入法、停止执行和附件等原有行为测试均保留并通过，未跳过测试。

4 项 ESLint 错误已修复：侧栏偏好抽到 `features/application/sidebar-preferences.ts`，用 `useSyncExternalStore` 订阅浏览器存储，通过服务端默认快照避免 hydration 不一致；消息时间在客户端时钟准备好之前显示确定的绝对时间；当前会话 ref 在 layout effect 中同步；实时消息载荷使用具体类型替代 `any`。新增 6 项侧栏存储/跨消费者同步/服务端 hydration 测试和 1 项消息初始时间测试。

构建复现 `useOverlayTriggerState is not a function`，发生于 HeroUI/React Stately 的 Turbopack 预渲染路径。`next.config.ts` 设置 `experimental.turbopackScopeHoisting: false` 作为当前 Next 16.2.7 的规避配置，保留模块边界后普通生产构建连续两次通过；这关闭了模块合并优化，未测量包体积或性能影响，升级依赖后应重新验证是否可以恢复。还修正了模型选择组件的 HeroUI 属性类型不兼容，并重新生成、核验当前 OpenAPI SDK。

大型业务文件仍需后续按功能迭代拆分，尤其是 `FormHomeRecords.tsx`、自动化 `PageClient.tsx`、`RuntimeFormRenderer.tsx` 和 `RecordsTable.tsx`。本轮解决了已识别的层间耦合与循环，未声称所有业务职责均已细化，也未进行新的浏览器端到端验收。

---

以下为首次检查记录，其中路径和数字描述调整前的状态。

## 结论

顶层 `app → features → shared` 边界已建立，深层业务边界尚未完成。需要继续处理同步循环引用、业务模块间的依赖环、通用组件归属以及业务模型所在位置。目录层数本身不是合规标准：Next 路由形成的深层目录合理，模型与 UI 相互依赖才是关键问题。

## 方法和范围

- 使用 TypeScript AST 递归解析静态 import、export 和字符串字面量形式的动态 import/require，按 `@/` 和相对路径解析本地模块。
- 将显式 `import type`、`export type` 和全部为 type specifier 的声明与值引用分开；文件循环分析排除测试、生成 SDK 和脚本。含动态加载的依赖图与仅静态加载的依赖图分别分析。
- 使用强连通分量检查文件和业务领域之间的循环，并人工阅读循环中的具体符号和使用位置。领域级依赖环不等同于同一文件执行链发生同步循环。
- 排除 `node_modules`、`.next`、`.cache`、Tauri target/gen、静态资源和桌面构建产物。检查服务端 Node 内置模块是否从 `use client` 入口可达。
- 只对代码中的字面量依赖作静态判断。动态计算路径、运行时注入及接口语义不在静态图覆盖范围内；未进行新的浏览器交互或 Rust 后端审计。

| 项目 | 结果 |
| --- | ---: |
| 扫描代码文件（含脚本、测试和生成 SDK） | 701 |
| 生产源码文件（排除测试、生成 SDK、脚本） | 562 |
| 本地代码依赖边（含类型、测试和生成代码） | 1,674 |
| 未解析的本地代码引用 | 0 |
| 同步值引用的文件循环 | 2 组 |
| 额外包含动态加载的文件循环 | 1 组 |
| 业务领域级值依赖循环 | 1 组，涉及 5 个领域 |
| `use client` 到本次识别的 Node 服务端导入链 | 0 |

## 需要继续调整的内容

### 1. 两组同步循环引用

**自动化模型与节点注册表互相引用。**

- `app/(protected)/(main)/[appId]/automations/[automationId]/automation-editor-model.ts:292` 从注册表重新导出菜单。
- `app/(protected)/(main)/[appId]/automations/components/AutomationWorkflowNodeRegistry.ts:10` 又从上述模型导入 `normalizeGetDataConfig`、`validateGetFilterRules` 等运行时函数。

模型导入注册表，注册表又依赖模型，模型因此承担了纯数据规则、菜单入口、节点注册等多种职责。改动模块初始化或导出方式时更容易出现顺序问题；当前扫描不说明它已经导致运行错误。

建议将节点类型、规则标准化和校验下沉到 `features/automation-editor/model`，注册表单向使用模型；菜单由注册表入口导出，避免模型反向重新导出注册表。

**消息气泡容器与内部渲染器互相引用。**

- `app/(protected)/messages/components/MessageBubble.tsx:9` 导入 `MessageBubbleMain`。
- `app/(protected)/messages/components/MessageBubbleMain.tsx:4` 又导入前者的 `MessageAvatar`、`MessageBubbleContent` 等值导出。

建议把 Props 类型、头像和消息内容渲染拆为独立叶子模块，容器和布局共同引用叶子模块。函数声明目前可能使该环正常运行，但这不是一个稳定清晰的模块边界。

### 2. 记录页与按钮页弹窗存在动态依赖环

```text
features/records/screen/components/FormRecordsScreen.tsx:60
  → records-table/RecordsTable.tsx:67
  → features/custom-buttons/components/CustomButtonPageDrawer.tsx:16
  → 动态加载 FormRecordsScreen
```

这是为了支持按钮弹窗嵌入表单记录页面而形成的组合。动态加载能延后加载时机，因此应与同步初始化循环分开看待；它仍使按钮功能和完整记录页互相知道对方的实现。

建议由上层组合入口提供页面渲染能力或明确的嵌入接口，按钮领域负责参数和动作，页面组合层负责选择要嵌入的实现。拆分前应保留嵌套页面、弹窗关闭、权限与记录提交的行为测试。

### 3. 五个业务领域形成依赖环

涉及 `automation-editor`、`form-designer`、`form-runtime`、`records`、`custom-buttons`。典型链路如下：

```text
form-runtime
  → form-designer/model/action-panel-code
  → 其他设计器能力

automation-editor/components/BranchRulesEditor
  → form-designer/components/FieldSelect
  → records/model/excel-association

records/screen
  → custom-buttons/components
  → form-runtime / automation-editor
```

第一条展示单向的运行时到设计器耦合，不单独构成完整环；整体强连通关系由上述多条领域依赖及记录页组合链共同形成。

具体问题：

- `features/form-runtime/components/RuntimeFormRenderer.tsx:43` 需要设计器目录中的 `normalizeActionPanelCode`。这是运行时解析也需要的业务契约，归属不应限于设计器。
- `features/form-designer/components/FieldSelect.tsx:14` 为获取字段类型标签而依赖记录 Excel 导入模型。
- `features/automation-editor/field-mapping/target-fields.ts:1` 为获取系统字段常量而依赖同一 Excel 模型。
- `excel-association.ts` 同时包含字段常量、显示标签、Excel 转换和记录查询功能，轻量元数据与数据访问混在一起。

建议先抽取明确的领域基础模块，例如表单契约、字段元数据、表达式规则，再让设计器、运行时、记录和按钮单向依赖它。业务契约应留在业务领域内，不能为了消除循环而全部搬进 `shared`。

### 4. 通用 UI 被放在表单运行时内部

- `features/form-runtime/components/fields/MyAvatar.tsx` 只接收姓名、头像和展示属性，没有表单业务依赖。消费者包括聊天列表、消息气泡、应用卡片和全局侧边栏，形成无意义的跨业务引用。
- `features/form-runtime/components/fields/MyTable.tsx` 是基于 TanStack/HeroUI 的泛型表格，当前主要消费者是记录表格。

建议将这两项及其样式和测试放入 `shared/ui`；后续逐一判断其他 `fields` 组件，不能把真正包含表单校验、Schema 或数据请求的组件也整体搬走。

### 5. 大型业务实现仍集中在路由深层目录

| 文件 | 行数（含注释和空行） | 建议 |
| --- | ---: | --- |
| `app/(protected)/(main)/designer/[formUuid]/components/field-properties/FieldPropertyDrawer.tsx` | 2,658 | 按字段类别、属性规则和数据请求拆分 |
| `features/records/screen/components/FormRecordsScreen.tsx` | 2,349 | 保留组合入口，拆出查询、编辑、导入导出和动作编排 |
| `app/(protected)/(main)/[appId]/automations/[automationId]/components/PageClient.tsx` | 1,881 | 业务编辑器实现下沉到 `features/automation-editor` |
| `features/form-runtime/components/RuntimeFormRenderer.tsx` | 1,876 | 分开 Schema 处理、动作运行与字段布局 |
| `app/(protected)/(main)/[appId]/automations/[automationId]/automation-editor-model.ts` | 1,640 | 拆分模型、默认值、校验、序列化和注册入口 |
| `features/records/screen/components/records-table/RecordsTable.tsx` | 1,586 | 分离列配置、行操作、按钮弹窗和批量操作 |

行数只是定位职责集中程度的线索，不是强制限制。设计器路由子树有 47 个代码文件、约 11,680 行非测试代码；自动化路由子树有 34 个代码文件、约 8,021 行非测试代码。仅页面使用的 UI 留在路由内合理，独立的业务模型与可复用编辑器能力更适合放入 `features`。

`app/api/.../route.ts` 的最深目录达到 9 层，但这些文件多数是很薄的 BFF 代理，深度来自接口 URL，不应为减少层级而改变接口或集中成巨型路由文件。

### 6. 类型模型和模块公共入口不够独立

- `features/form-runtime/model/form-formula.ts:1` 从组件 barrel 导入 `RuntimeSchemaField` 类型；记录导入和设计器契约也有类似引用。
- `features/form-runtime/components/runtime-form-types.ts` 是多个领域共同使用的 Schema 类型定义，却存放在 `components` 下。
- 跨领域值引用中，有 44 条指向较深的内部路径。该数值不表示 44 处违规，但说明调用方经常知道另一个模块的内部组件、文件夹和实现名称。
- 当前 `features/form-designer/index.ts` 等入口只覆盖部分能力，无法统一业务模块的可复用契约。

类型引用不会直接导致运行时循环。建议将模型类型独立到相应 `model` / `contracts`，为真正需要跨模块复用的能力提供窄入口；不要把整个模块通过单一 `export *` 全部公开，以免把客户端组件和服务端实现混为一个导入入口。

### 7. 规范检查存在覆盖盲点

当前 `lint:structure`、`lint:http`、`lint:styles` 均通过，但不代表深层架构全部合格。

- `check-structure.mjs` 检查顶层依赖方向和旧别名，不建立模块依赖图，因此不检查文件循环和业务领域循环。
- 它未访问 TypeScript `ImportTypeNode`。用 `type Page = import("@/app/page").default` 放在 feature 文件中探测时返回空错误列表；该写法仍是跨层类型耦合，只是没有运行时加载。
- 测试文件的跨层组合有意放行；它们不能作为生产层间依赖通过的证据。
- 检查不约束跨业务模块的公开入口，也不检查新增空目录或深层 Vitest 缓存。

建议先修已有依赖图，再增加字面量 `ImportTypeNode` 覆盖、文件依赖环检查、已知动态组合说明和领域依赖规则，避免为了让检查变绿直接忽略全部现有问题。

### 8. 历史空目录和源码目录内的测试缓存

递归检查找到 22 个真正空的非生成目录，以及 3 个位于源码子目录中的 `node_modules/.vite/vitest/.../results.json` 缓存。后者没有独立的 `package.json`，此次看到的内容是测试结果缓存，不是另一个业务项目的完整依赖安装。

缓存位置：

```text
app/(protected)/(main)/[appId]/automations/[automationId]/components/node_modules
app/(protected)/(main)/[appId]/[formUuid]/components/records-table/node_modules
app/(protected)/(main)/[appId]/[formUuid]/components/view-settings/node_modules
```

真正的空目录包括旧 Agent API、旧设置页、表单发布/流程暂停/恢复路径，以及 `features/identity-access/components`、`features/records/components`。它们不会自动成为 Next 路由，但会让目录看起来仍有功能。可以在独立清理中移除；本轮只记录，未删除。

## 推荐后续顺序

1. 修复消息气泡和自动化模型的两组同步循环；保留行为，补对应依赖图检查。
2. 抽离字段元数据、表单类型和运行时动作契约，恢复领域基础能力的单向依赖；将通用头像、表格放回 `shared/ui`。
3. 调整记录页面与按钮弹窗的组合接口，保留懒加载和嵌套交互的行为。
4. 再逐步拆分设计器、自动化编辑器和记录页的大型实现，并完善模块公共入口。
5. 清理空目录、统一测试缓存位置，把经过验证的边界接入持续检查。

本轮没有重新执行全量测试或生产构建，因为没有修改生产源码。上轮的类型、契约和生产构建通过；已复现的 Agent 页面测试与 ESLint 遗留问题仍是独立事项，本次架构静态检查没有将它们标记为解决。

# Web 前端目录边界

本目录是独立的 Next.js 项目，使用 pnpm 管理 `package.json`、锁文件及 `node_modules/`。仓库根目录的辅助打包工具由 `../scripts/` 独立管理。

```text
app/                Next 页面、布局、BFF 路由及页面私有代码
  _components/      应用外壳、首页和全局导航的组合组件
features/           按业务领域组织的组件、请求、模型、hooks 和测试
shared/             无业务依赖的公共能力
  ui/               通用 UI 和编辑器
  providers/        主题、Query、Toast 等公共上下文
  lib/              HTTP、鉴权存储、通知、通用工具及生成的 SDK
  api/              特殊传输入口与公共请求类型
styles/             全局主题变量和公共样式
public/             静态资源
scripts/            代码生成、契约导出、规范检查
src-tauri/          桌面宿主 Rust 项目
```

## 放置与引用规则

- 依赖方向为 `app → features → shared`。`app` 也可直接使用 `shared`；`shared` 不引用 `app` 或 `features`，业务模块不引用页面代码。
- `features` 按领域划分；业务 UI 随所属领域存放。例如按钮在 `custom-buttons/components`，工作流在 `workflow`，表单记录页面的可嵌入实现位于 `records/screen`。跨领域复用应引用明确的业务模块，不把业务组件放入公共 UI。
- 表单共用契约、字段元数据、日期规则和动作代码规范位于 `features/form-model`，不依赖设计器、运行时或记录实现；字段选择控件在 `features/form-controls`，条件模型和编辑器在 `features/conditions`。
- 设计器实现位于 `features/form-designer/editor`；自动化编辑器的 UI、管理页和模型分别位于 `features/automation-editor/editor`、`management`、`model`。路由入口负责参数和组合。
- 记录页面由 `records/screen/RecordsWorkspace` 组合并提供嵌入页渲染接口；记录动作通过上下文使用该接口，不反向导入完整记录页面。通用头像和泛型表格位于 `shared/ui`。
- 页面只使用一次的组件可与页面就近存放。路由入口保留在 `app`，被其他业务复用的页面实现应下沉到相应 `features`。
- `AuthProvider` 属于 `features/auth/components`，应用外壳负责挂载；基础 Query、主题和 Toast Provider 位于 `shared/providers`。
- 统一使用 `@/` 根别名；同目录或模块内部可使用相对路径。测试与被测代码就近存放；跨层集成测试允许组合路由与业务代码。
- 生成 SDK 位于 `shared/lib/api-client`，不要手改；业务通过 `shared/lib/http` 使用稳定入口。
- 全局 CSS 只从 `app/layout.tsx` 引入。业务局部样式使用 CSS Modules，并遵守现有类名规则。
- `.next`、`.cache`、`node_modules`、`tauri-dist` 为生成目录。不要在 `web/web/` 再创建缓存，脚本应根据自身位置计算项目根。

## 检查与运行

在本目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm run dev
pnpm run lint:structure
pnpm run lint:http
pnpm run lint:styles
pnpm exec tsc --noEmit
pnpm test
pnpm run build
```

`pnpm run lint` 包含结构检查、HTTP 检查、ESLint 和样式检查，并使用 `--max-warnings 0` 阻止新增警告。`codegen:api` 与 `contract:development:check` 使用迁移后的源路径。

表单运行入口 `RuntimeFormRenderer` 负责动作生命周期和提交，字段展示在 `RuntimeFormField`，分组/子表组合在 `RuntimeFieldNode`；二者共享独立的字段上下文与布局规则。记录页的 Excel 流程在 `records/screen/model/use-record-workbook`，表格列布局和展示数据在 `records-table/use-record-table-layout`。自动化节点配置修改位于 `automation-editor/editor/use-node-config-actions`，页面负责组合图形画布、加载与保存。

结构检查递归解析源码和内联 `import()` 类型，检查层间边界、文件及业务领域的运行时依赖环（含字面量动态加载），并阻止源码内嵌入缓存或依赖目录。显式类型引用参与边界检查，不参与运行时循环判断；计算得到的动态路径和运行时注入关系需要人工审查。

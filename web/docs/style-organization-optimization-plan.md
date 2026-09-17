# 第六阶段：样式组织与设计 Token 优化计划

## 目标

在不改变现有 HeroUI、Tailwind CSS 4、主题切换和页面视觉基线的前提下，明确样式所有权，降低全局 CSS 的耦合，建立可维护的设计 Token 层。

本阶段不是重写 UI，也不是把所有 `var(--color-*)` 替换成 Tailwind 色值。动态主题依赖 CSS Variables，业务页面应继续通过语义 token 消费颜色。

## 当前审计结论

### 1. 样式载体

- 项目使用 Tailwind CSS 4，通过 `postcss.config.mjs` 加载 `@tailwindcss/postcss`。
- `app/globals.css` 同时引入 Tailwind 和 HeroUI，并包含约 998 行规则。
- 当前存在 6 个 CSS Module：
  - `app/(protected)/messages/messages.module.css`
  - `app/(protected)/settings/about/about.module.css`
  - `app/(protected)/settings/logs/logs.module.css`
  - `app/(protected)/settings/notifications/notifications.module.css`
  - `app/(protected)/(main)/[appId]/[formUuid]/components/SystemPageView.module.css`
  - `app/components/my-fields/MyAvatar.module.css`
- 大部分业务页面使用 Tailwind arbitrary values 和 `var(--color-*)`，没有独立的 feature 样式目录。

### 2. `globals.css` 职责混杂

当前文件至少包含以下几类内容：

- Tailwind/HeroUI 全局导入。
- Light/Dark 主题 token 与兼容别名。
- `ThemeProvider` 的 HeroUI token 桥接说明。
- Agent 作用域变量。
- 全局标签类，如字段类型标签、提及 token。
- Records、Automation、Designer、Runtime 的页面/组件布局修正。
- 表格滚动、Monaco、抽屉、弹窗、富文本和响应式规则。

这导致修改一个页面专属规则时需要打开全局文件，也容易让不同业务域共享同名类或隐式依赖全局选择器。

### 3. Token 所有权重叠

`app/globals.css` 在 `:root` 和 dark theme 中提供默认 token；`components/ThemeProvider.tsx` 又通过 `root.style.setProperty` 写入同一批变量，包括：

- `--color-bg-*`
- `--color-text-*`
- `--color-primary*`
- `--color-border`
- `--color-bg-panel*`
- `--color-control-*`
- `--shadow-*`

这不是当前功能错误，但形成“双重定义”：CSS 是 fallback，运行时 Provider 是实际值。第六阶段应明确这一关系，禁止业务页面再次定义同名全局变量。

### 4. 颜色使用现状

- `var(--color-text-primary)`、`var(--color-border)`、`var(--color-text-secondary)` 是最常用的语义变量。
- Users、Automation、Designer、Records 页面中直接出现大量 `var(--color-*)`，这是动态主题消费，不应直接替换为固定 Tailwind 色值。
- 仍存在少量硬编码颜色，主要在字段类型标签、图标色、第三方/编辑器兼容样式和局部状态中。
- Login 页面存在模糊装饰层；后续只在视觉回归确认后再处理，不在本阶段为了 token 整理改动布局。

## 目标边界

### 全局样式

`app/globals.css` 最终只保留：

- Tailwind/HeroUI import。
- `@theme` 与基础 reset。
- 全局主题 token 的 fallback 定义。
- 真正跨页面的语义工具类和无业务归属的基础规则。

### Token

新增 `styles/tokens.css`（位置可在 `app/styles/` 或项目约定的 `styles/`，以 Next 全局导入路径为准），负责：

- 原始颜色、语义颜色、阴影、圆角、字体和动效 token 的文档化分组。
- Light/Dark fallback。
- 兼容别名的迁移说明。

`ThemeProvider` 继续负责运行时主题变体写入；不得在页面或 feature 中重复声明 `--color-*`、`--surface`、`--border` 等全局 token。

### 工具类

新增 `styles/utilities.css`，仅放置有明确跨页面价值的工具类，例如：

- 横向滚动容器。
- 文本截断和可访问焦点辅助类。
- 通用 surface/overlay 语义类。

带业务词汇的类名不放入 utilities。

### CSS Modules

- 页面专属复杂布局继续使用 CSS Modules，文件放在对应页面目录。
- 当某个 UI 已迁移到 feature 且有真实第二入口时，CSS Module 随组件进入 feature 目录。
- 不为了“目录整齐”把简单 Tailwind class 改写为 CSS Module。
- 不把共享全局选择器复制到多个 Module。

### Feature 样式

只有满足以下至少两项时，才建立 `features/<domain>/components/*.module.css`：

1. 组件存在两个真实使用入口；
2. 样式包含稳定的领域视觉契约；
3. 样式需要独立测试或独立迭代；
4. 从路由迁出后不会依赖路由选择器或 URL 结构。

## 分阶段实施

### P0：建立边界，不改变视觉

1. 新增 `styles/tokens.css` 和 `styles/utilities.css`。
2. 将 `globals.css` 中的 token 定义、兼容别名和通用工具类按职责迁移。
3. 保留 `globals.css` 的兼容导入，确保加载顺序为：Tailwind/HeroUI → tokens → utilities → 全局基础规则。
4. 为 Token 添加注释，标记“CSS fallback”与“ThemeProvider runtime override”。
5. 增加 lint/脚本检查：禁止业务 CSS 新增 `:root`、`html[data-resolved-theme]` 下的重复 token 定义。

### P1：收敛全局业务规则

按业务域逐批处理，不跨域大规模重命名：

- Records：表格滚动、Runtime 表单、导入抽屉相关规则。
- Designer：属性抽屉、画布交互和 Monaco 兼容规则。
- Automation：属性面板、规则横向滚动和节点编辑器规则。
- Identity/Settings：用户表格、设置页 surface 和滚动区域。

确认规则只服务单一路由时，移动到相对页面的 `.module.css`；确认多个入口使用时，才迁移到对应 feature 样式目录。

### P1：语义 token 消费规范

- 新增页面优先使用 HeroUI 语义颜色或 `var(--color-*)`，不直接写固定 hex。
- 业务 JSX 中允许使用已登记的语义 token；禁止新增同义 token，如同时出现 `--brand-blue`、`--primary-blue`、`--color-primary` 表示同一语义。
- 兼容别名只用于迁移旧组件，新代码使用 `--color-*` 或 HeroUI token。
- 阴影、圆角和字体同样遵循 token，不在页面重复声明同值 arbitrary style。

### P2：清理与自动化约束

- 统计并逐步减少硬编码颜色，仅处理能明确映射到现有语义 token 的值。
- 为 CSS Modules 建立命名约定：`<domain>-<component>__<element>--<state>`，避免通用短类名。
- 在 ESLint 或自定义脚本中检查：
  - feature 不得导入 `app/globals.css`；
  - 业务 CSS 不得声明全局 token；
  - 新增全局选择器必须在允许列表中；
  - 跨 feature 不得依赖另一个 feature 的 CSS Module。
- 删除迁移完成后的重复规则，但保留必要的兼容别名直到所有引用清零。

## 不建议做的事情

- 不把所有 `var(--color-*)` 批量替换为 Tailwind 固定色。
- 不把每个页面的 Tailwind class 抽成 feature 组件或 CSS Module。
- 不因为存在 CSS Module 就重写现有 HeroUI Table、Modal、Drawer、React Flow 样式。
- 不在本阶段修改主题配色、圆角基线或页面布局比例。
- 不将第三方组件内部 class 当作稳定公共 API，除非已有版本锁定和回归依据。

## 验收标准

- `globals.css` 不再新增业务域专属规则；迁移后职责可通过文件位置判断。
- Token 变量只有一个定义来源：CSS fallback + `ThemeProvider` runtime override，业务代码不重复定义。
- Light/Dark、HeroUI 组件和动态主题切换视觉不变。
- Records、Designer、Automation、Users 页面不出现样式回归。
- CSS Module 仍只承担复杂局部样式，Tailwind 继续承担基础布局和间距。
- 全量 TypeScript、lint、build 通过；样式迁移批次具备对应截图或手工回归记录。

## 推荐执行顺序

1. 先建立 `tokens.css`、`utilities.css`，只迁移定义，不改 JSX。
2. 再迁移全局业务规则，每次只处理一个业务域。
3. 最后清理硬编码颜色和兼容别名，并加入自动化边界检查。
4. 每批完成后进行 Light/Dark 和 HeroUI 关键组件回归，再进入下一批。

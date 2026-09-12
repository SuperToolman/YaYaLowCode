# 全局组件目录

`app/components` 只放可被两个及以上路由复用、且不属于某个具体路由业务的组件。

## 子目录约定

- `agent/`：跨页面复用的 Agent 展示组件
- `my-fields/`：通用字段、表格和表面容器
- `workflow-editor/`：跨路由复用的流程编辑器基础组件
- 根目录：Provider、Layout、Runtime 等全局组件

路由专属组件必须放在对应路由目录下的 `components/`，例如：

```text
app/(protected)/(main)/[appId]/components/
app/(protected)/(main)/designer/[formUuid]/components/
```

## 命名约定

- React 组件文件使用大驼峰：`RecordsTable.tsx`、`QueryProvider.tsx`
- Next.js 系统文件保持小写：`page.tsx`、`layout.tsx`、`route.ts`
- 非组件模块使用 kebab-case：`runtime-form-types.ts`、`workflow-core.ts`
- 新代码优先通过 `@/app/components/...` 或当前路由的相对路径引用


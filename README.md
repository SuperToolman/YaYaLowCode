# YaYa Low Code

一个面向表单与应用编排场景的低代码平台原型，包含前端设计器、运行时表单页、应用导航、动态表单 Schema 管理，以及 Rust 后端接口。

## 技术栈

- 前端：Next.js 16、React 19、HeroUI、Monaco Editor
- API Client：`@hey-api/openapi-ts`
- 后端：Rust、Axum、SeaORM `2.0.0-rc.41`
- 数据库：PostgreSQL

## 当前能力

- 应用列表与应用卡片操作
- 应用下表单/分组导航
- 系统内置页面导航
- 表单设计器
  - 组件箱
  - 大纲树
  - 数据源变量
  - 动作面板统一脚本编辑
  - 页面源码查看
  - 草稿 / 发布 / 版本恢复
- 表单运行时
  - 表单提交视图
  - 数据列表视图
  - 抽屉式新增记录
- 后端表单 Schema 与记录存储

## 本地启动

### 1. 前端

```bash
pnpm install
pnpm dev
```

前端开发启动前会自动执行一次：

```bash
pnpm codegen:api
```

用于基于 `openapi/openapi.json` 重新生成前端 API Client。

### 2. 后端

进入 `backend` 目录后启动：

```bash
cargo run
```

## 数据库配置

当前默认 PostgreSQL 连接信息：

- Host: `localhost`
- Port: `5432`
- Username: `postgres`
- Password: `5201314qq`
- Database: `yaya_low_code`

请确保本地 PostgreSQL 已创建对应数据库并允许连接。

## 目录结构

```text
app/                Next.js App Router 前端
backend/            Rust + Axum + SeaORM 后端
openapi/            OpenAPI 描述文件
app/lib/api-client/ heyapi 生成的前端 API Client
```

## 说明

- 设计器预览使用当前草稿 Schema。
- 实际运行时页面默认读取已发布 Schema。
- 动作脚本当前支持 `didMount(ctx)`、`onFieldEvent(ctx)`、`onSubmit(ctx)`。

## 构建验证

```bash
pnpm build
```

当前前端生产构建已通过。

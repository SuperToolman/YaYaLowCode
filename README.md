# 丫丫低代码平台

一个面向表单设计、应用导航与数据录入场景的低代码平台原型项目，包含前端设计器、运行时表单页、应用管理能力，以及基于 Rust 的后端接口与 PostgreSQL 存储。

## 项目概述

当前项目已经打通以下核心链路：

- 创建应用
- 在应用下创建表单与分组
- 在表单设计器中拖拽组件、配置属性、编辑动作脚本
- 保存草稿、发布版本、恢复历史版本
- 在运行时页面提交表单数据并查看记录

## 技术栈

### 前端

- Next.js 16
- React 19
- HeroUI
- Monaco Editor
- `@hey-api/openapi-ts`

### 后端

- Rust
- Axum
- SeaORM `2.0.0-rc.41`
- PostgreSQL

## 已实现能力

### 1. 应用管理

- 应用列表展示
- 创建空白应用
- 应用卡片访问入口
- 应用启用 / 关闭
- 编辑应用名称
- 删除应用
- 应用设置入口预留

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
- 页面属性配置
- 预览
- 保存草稿
- 发布
- 恢复历史版本

### 4. 表单运行时

- 表单提交视图
- 全部数据视图
- 抽屉式新增记录
- 已发布 Schema 渲染
- 运行时动作脚本执行

### 5. 后端接口

- 应用增删改查
- 表单创建与删除
- 导航分组与排序
- 表单 Schema 草稿保存
- 表单发布
- 表单版本查询与恢复
- 表单记录保存与查询

## 本地启动

## 前端启动

```bash
pnpm install
pnpm dev
```

执行 `pnpm dev` 前会自动先运行一次：

```bash
pnpm codegen:api
```

用于根据 `openapi/openapi.json` 自动更新前端 API Client。

## 后端启动

进入 `backend` 目录后执行：

```bash
cargo run
```

## 数据库配置

当前项目默认使用 PostgreSQL，连接信息如下：

- 地址：`localhost`
- 端口：`5432`
- 用户名：`postgres`
- 密码：`5201314qq`
- 数据库名：`yaya_low_code`

请提前确认本地 PostgreSQL 已启动，并且已创建对应数据库。

## 目录结构

```text
app/                前端主项目（Next.js App Router）
backend/            Rust 后端
openapi/            OpenAPI 描述文件
app/lib/api-client/ heyapi 生成的前端 API Client
public/             静态资源
```

## 设计说明

- 设计器预览默认读取当前草稿 Schema
- 实际运行时页面默认读取已发布 Schema
- 动作脚本当前支持：
  - `didMount(ctx)`
  - `onFieldEvent(ctx)`
  - `onSubmit(ctx)`

## 构建验证

前端构建命令：

```bash
pnpm build
```

当前前端生产构建已通过。

## 当前待完善项

- 表单权限模型
- 自定义视图能力
- 动作脚本调试增强
- 更多字段类型与运行时校验能力

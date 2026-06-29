# 丫丫低代码平台

一个面向表单设计、数据录入与集成自动化场景的低代码平台原型项目。当前仓库已经包含应用管理、表单设计器、表单运行时、自动化工作流编辑器，以及基于 Rust + PostgreSQL 的后端服务。

## 当前状态

当前项目已经打通以下核心链路：

- 创建应用
- 在应用下创建表单与分组
- 在表单设计器中拖拽组件、配置属性、编辑动作脚本
- 保存草稿、发布版本、恢复历史版本
- 在运行时页面新增、编辑、删除并查看表单记录
- 基于表单事件触发集成自动化
- 查看自动化运行日志并执行失败重试

## 技术栈

### 前端

- Next.js 16
- React 19
- HeroUI
- React Flow
- Monaco Editor
- `@hey-api/openapi-ts`

### 后端

- Rust
- Axum
- SeaORM `2.0.0-rc.41`
- PostgreSQL
- Reqwest

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
- 记录级编辑
- 记录级删除
- 运行时记录变更触发自动化

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

### 7. 后端接口与存储

- 应用增删改查
- 表单创建与删除
- 导航分组与排序
- 表单 Schema 草稿保存
- 表单发布
- 表单版本查询与恢复
- 表单记录保存、查询、编辑、删除
- 自动化增删改查
- 自动化版本查询与恢复
- 自动化运行日志与重试接口

## 自动化存储结构

当前自动化已拆分为独立结构化存储，而不是仅保存整包图 JSON：

- `automation_flows`
- `automation_flow_versions`
- `automation_nodes`
- `automation_edges`
- `automation_flow_runs`
- `automation_flow_run_nodes`

## 本地启动

### 前端启动

```bash
pnpm install
pnpm dev
```

执行 `pnpm dev` 前会自动先运行一次：

```bash
pnpm codegen:api
```

用于根据 [openapi/openapi.json](/C:/Users/SuperToolman/Desktop/myProjects/yaya-low-code/openapi/openapi.json) 自动更新前端 API Client。

### 后端启动

进入 [backend](/C:/Users/SuperToolman/Desktop/myProjects/yaya-low-code/backend) 目录后执行：

```bash
cargo run
```

如果前端已经更新了自动化相关页面或代理接口，而本地运行日志接口仍然返回 `404` 或提示路由不可用，通常是后端进程还是旧版本，直接重启后端即可。

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
pnpm lint
pnpm build
cd backend && cargo check
```

本轮自动化基础能力开发完成后，上述核心检查已通过。

## 下一步建议

- 自动化递归触发防护
  - 事件来源标记
  - 执行深度限制
  - 循环链路风险检测
- 自动化运行日志后端分页、筛选、统计汇总与日志保留策略
- HTTP 请求节点补充更完整的响应状态、响应头与错误上下文
- 条件分支规则编辑器继续向宜搭式交互收敛
- 字段映射编辑器继续细化
- 表单权限模型
- 自定义视图能力
- 动作脚本调试增强
- 更多字段类型与运行时校验能力

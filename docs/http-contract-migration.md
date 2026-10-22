# HTTP 契约与客户端收敛

## 数据与调用边界

Rust DTO / `api/src/openapi.rs` → `api/openapi/openapi.json` → HeyAPI → `web/app/lib/http.ts` → 业务封装 / 页面模型。

- 已补齐市场、设置、通知、授权、文件、平台 Agent 会话和文件等 HTTP 契约，包括 method、参数、请求体、响应、multipart 和二进制格式。保留已有 operationId。
- 业务模块通过 `@lib/http` 获取生成函数及类型；生成目录可完整重建。运行时初始化在 `api-client-runtime.ts`，兼容类型别名在 `http.ts`；移除修改生成文件的补丁脚本。
- 设置、市场、记录、回收站、表单设计器、邮件、文件、身份权限、工作流和平台 Agent 封装使用生成 SDK 与公共解包。页面仍需显示成功消息的地方使用公共 envelope assertion，不自行判断业务码。
- 动态表单 JSON、编辑器状态、UI 投影仍有独立模型；生成类型的可选值在转换处显式处理。市场外部附加字段保留为 JSON，避免丢失上游扩展数据。
- 登录、短信、会话等 Next BFF 契约集中在 `features/auth/contracts.ts`。可用 Agent 聚合、外部 OAuth、上传下载、流式请求保留专用入口。DSH 及其专用客户端/协议排除在本次迁移之外。

## 请求与错误

- `api-request.ts` 提供受控 Fetch、`unwrapApiResult`、`ApiRequestError` 和 Query 重试规则。JSON 默认 15 秒，包含读取响应体；流只限制连接建立阶段，并保留调用方取消。Blob 和流不执行 JSON 解包。
- 错误区分网络、超时、取消、HTTP、业务与无效响应，保留状态、业务码和原因。204 单独处理，合法 null/false/0/空字符串均允许。
- 公共层通知网络、超时、401、5xx、无效响应；登录和会话探测支持静默 401。页面使用 `notifyRequestError` 呈现业务上下文，取消不提示。按错误类别去重，不以系统错误屏蔽其他业务错误。
- Query 仅对网络、超时、5xx 最多重试两次，Mutation 默认不重试。未捕获异常兜底、工作流通知轮询保留，无额外 Query 全局 Toast。
- Next 服务端每请求创建独立 SDK 客户端，鉴权优先 Bearer，其次 Cookie。公共 JSON 代理统一超时、取消、204、无效响应和后端不可用处理；文件和流使用专门代理。

## 生成与边界检查

在 `web` 目录执行：

```sh
pnpm run contract:export  # Rust 导出契约
pnpm run contract:update  # 导出 → 生成 → TypeScript 检查
pnpm run contract:check   # 重新生成，对比整个生成目录，再检查类型
pnpm run lint:http        # 稳定入口、手写请求与不安全断言检查
```

导出通过专门的 ignored Rust 测试执行，避免 Windows 正在运行的 API 可执行文件被锁定。该测试仅导出文件。`lint` 已包含 HTTP 边界检查。生成检查覆盖已保存 OpenAPI 与 SDK 的一致性；后端修改后应先执行 `contract:update`。

## 验证记录（2026-10-21）

| 检查 | 结果 |
| --- | --- |
| Rust 测试 | 99 通过，10 ignored；未启用数据库集成测试 |
| Rust 编译 | cargo check 通过，有现有 warnings |
| OpenAPI 导出与 SDK 重复生成 | 通过，重复生成无额外差异 |
| TypeScript | 通过 |
| 前端测试 | 44 文件、229 测试通过；最后的代理拒绝 Promise 修复另跑相关 5 测试通过 |
| Next 生产构建 | 通过；最后的代理异常兜底小改另通过类型检查和相关测试 |
| HTTP 定向 ESLint / 边界检查 | 通过 |
| 全量 ESLint | 未通过，现有 React Hooks、Agent runtime、DSH 测试及 public/monaco 产物等问题；本次测试导入触发的新增错误已修复 |
| 样式边界 | 未通过，现有消息组件 CSS 命名及 globals.css 全局选择器违规 |
| 只读在线冒烟 | 后端 /healthz 200；生产前端 /login 200；无 Cookie 的 session 401、设置通知 403 |

新增 `.test.ts` 覆盖解包、HTTP/业务/网络/超时/取消/无效 JSON、401 静默、204/205/HEAD、合法空数据、Blob、流、旧浏览器流取消、通知去重、Query 重试及并发用户鉴权隔离。模拟后端验证记录 CRUD 方法/路径、设置、市场、邮件、工作流偏好、multipart 上传及登录 Cookie/会话。

没有可用的已登录验收会话，因此登录后完整页面交互与真实下载链路仍需人工验收。模拟请求通过不等同于完整端到端验收。未执行真实购买、发送邮件或删除业务数据。保留工作区已有改动以及已删除的 `.test.tsx`，未恢复它们。

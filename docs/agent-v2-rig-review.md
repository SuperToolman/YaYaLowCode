# AgentV2 Rig 用法核查与开发启动

日期：2026-10-28。核查对象为锁定的 `rig-core = 0.40.0` 源码和当前 AgentV2，不以教程示例是否相似判断正确性。

结论：当前客户端、请求构造、历史消息、工具结果关联及流式调用使用了有效的 Rig API；平台自行驱动工具循环是本项目持久化与授权边界的设计选择。不能据此认定多厂商原生协议、RAG、多模态等完整能力已经实现。

## 来源与教程版本差异

- 用户提供的[教程](https://clawpk.net/tutorials/158-rust-rig-agent)。本文通过浏览器读取了全文；它是第三方入门材料，未指定与本项目一致的依赖版本。
- [Rig 0.40.0 文档](https://docs.rs/rig-core/0.40.0/rig_core/)、[Tool 模块](https://docs.rs/rig-core/0.40.0/rig_core/tool/index.html)、[流式模块](https://docs.rs/rig-core/0.40.0/rig_core/streaming/index.html)；同时检查本机 Cargo 缓存中该版本 `src/lib.rs`、`completion/request.rs`、`providers/openai/client.rs` 和兼容流解析源码。

| 教程说法/示例 | 0.40.0 核查与本项目选择 |
| --- | --- |
| `cargo add rig` | 本项目固定官方包 `rig-core`，使用 Cargo 别名 `rig`，不会按未明确版本的命令替换依赖 |
| Rust 1.75+ | 该版包使用 edition 2024，不能将 1.75 当作本工程支持基线；本机已验证 Rust 1.95 |
| `openai::Client` | 该版默认为 Responses 客户端；本项目 BYOM 当前使用 Chat Completions 兼容接口，因此显式使用 `CompletionsClient` |
| `Client::from_env()` | 适合单一环境配置的例子；本项目从已授权用户的 BYOM 路由取得 base URL、模型和密钥，再用 builder 注入，不以进程级全局 Key 替换用户路由 |
| `#[rig::tool]` | 该版公开的是 `tool` 模块及 `tool_macro` 导出；教程写法不应直接照搬。本项目用 `ToolDefinition` 声明工具，Rust 手动授权并执行 |
| 模型工具参数能在编译期检查 | Rust 类型/trait 实现可以由编译器检查，但远程模型输出的 JSON 必须在运行时校验。模型不是 Rust 编译器的输入，不能省略运行时校验 |
| `.agent(...).tool(...).prompt(...)` | 是框架支持的高层用法；本项目选择官方 `CompletionModel` 底层接口，使一次模型步骤与 checkpoint、工具授权及任务执行锁配合 |
| `dynamic_context(2, store)` | 该版需要向量检索 index；内存 store 提供 `.index(model)`，不能假定教程片段直接适配。V2 的检索还须接入用户/员工 ACL 和删除传播，当前未实现 |
| `while let Some(Ok(chunk))` | 这种循环会在错误时直接退出；本项目逐项处理 Result，不能把网络失败当作完成 |
| 单二进制/WASM 与性能倍数 | 本系统明确包含 PostgreSQL 与独立 Node Cordis 子进程，尚未支持 Worker 编译为浏览器 WASM，也没有本项目数据支持固定的性能倍数结论 |

## 当前调用边界

`worker/src/adapters/model.rs` 使用 `CompletionClient`、`CompletionModel`、`completion_request`、`Message`、`ToolDefinition` 和 `StreamedAssistantContent`。调用只生成一轮模型输出；`runtime.rs` 在每次工具执行前重新取得平台授权，保存工具结果后再发起下一轮请求。

历史保留 user/assistant/tool 的角色，工具结果通过模型返回的 call ID 关联。工具 Schema 描述与实际执行端校验同时存在；未知工具、未授权工具或参数不合法时拒绝执行。当前仅开放诊断与应用列表只读工具。

本轮补强：

1. 连接建立/响应头与首个流项共用首响应截止时间，避免分别消耗一整个首响应超时。其后保留空闲、连接和总请求超时。
2. 保存工具原始参数 delta，并限制累计大小；拒绝无效 JSON 或 SDK 归一化后不一致的参数。Rig 丢弃未完成工具时，不能将伴随文本提交为成功回答，改为可重试错误。
3. 错误保留脱敏的 SDK 类别和 HTTP 状态上下文，不把原始供应商正文、Key 或 URL 写入错误链；任务对外仍使用稳定错误码。

仍需补齐：纯文本流的服务端正常结束/异常 EOF 严格区分（Rig 的 Final 不等价于服务端 finish_reason）、更多供应商错误矩阵、长会话上下文预算；原生 Anthropic/Gemini 等 provider、多模态、Embedding 和 RAG 属于后续明确实现项。

## 开发启动

仓库根目录运行：

```powershell
.\scripts\start-dev.ps1
# 旧 DSH 已构建，仅跳过旧构建；AgentV2 仍正常构建启动
.\scripts\start-dev.ps1 -SkipDshBuild
# 本次不启动旧 DSH，开发新链路
.\scripts\start-dev.ps1 -SkipLegacyAgent
# 本次不启动 V2，沿用旧链路
.\scripts\start-dev.ps1 -SkipAgentV2
# 自定义端口同步到 API、BFF、Worker
.\scripts\start-dev.ps1 -BackendPort 8888 -FrontendPort 8887 -AgentPort 8889
```

默认同时启动平台 API、AgentV2 Worker、旧 DSH 和前端，页面为 `/agent-v2`。Cordis 依赖通过独立锁文件安装，Host 由 Worker 在需要诊断工具时按 run 启动，不新增常驻 HTTP 端口。`-SkipLegacyAgent` 不会终止另行启动的旧服务。

脚本支持从 `agent-v2/.env` 读取 V2 配置；已有进程环境优先。开发环境缺少 Worker 通信密钥时，在内存生成随机值并传给同次启动的 API 和 Worker，不写日志/文件；显式配置占位值或长度不足则报错。生产仍须注入固定受管密钥。平台既有 BYOM 加密密钥继续沿用，不能随重启生成。

Worker 日志：`agent-v2/runtime/dev/worker.log`、`worker-error.log`。进程记录保存 PID、二进制绝对路径和启动时间，不保存密钥；重启时核对身份，避免 PID 复用后误杀其他进程。脚本退出/failure 清理本次启动的 Worker、Host 子进程和后端。API 尚未 ready 或 Worker 提前退出时不会宣称启动成功。

## 本轮验证

- `scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline`：通过 Rust/数据库/Worker 接管、API 权限、Cordis、前端/BFF 与共享权限检查；新增真实 Worker 启动/就绪/停止及错误 PID 身份拒绝测试。
- 新增假供应商场景：发送文本后输出半截工具参数，真实 Rig 解析后由平台拒绝完成；无工具执行记录和最终 assistant 消息。
- 真实现有 BYOM + Rig 流式 + Cordis 工具 + 续答复测通过。本轮首次尝试曾返回 `provider_rejected`，当时尚未保留状态上下文，无法确定供应商拒绝原因；不将一次复测通过等同于生产稳定性已验收。
- 未执行会重启当前平台服务、运行 public schema 迁移的完整 `start-dev.ps1`；启动组件使用隔离数据库 schema 实测，完整客户式浏览器验收仍按首批记录执行。

## 随后完整启动复测

2026-10-28 用户反馈启动报错后，实际执行默认 `scripts/start-dev.ps1`，复现 API 正常但 V2 Worker 退出，数据库报 `earlier.queue_seq` 不存在。原因是当前开发库已执行早期 95 号迁移，后续修改建表定义不会自动升级已有表。

修复为新增 `m20261028_000096_agent_v2_queue_seq`：在事务内补列、按创建时间/ID 回填旧任务顺序、设置非空和唯一索引，并保持会话事件计数不小于既有任务/事件序号；保留现有消息、任务与旧 Agent 数据。隔离测试覆盖新库重复升级、旧结构已有任务回填及升级后继续提交/领取。

修复后默认完整启动通过，包括实际旧 DSH 全量构建、平台 API、V2 Worker、旧 Host、OpenAPI SDK 生成及 Next 开发服务。当前开发库已自动执行追加迁移 96；此记录更新上节“未执行完整启动”的早期状态。API `8788/healthz`、旧 Host `8789/healthz` 均返回 200；前端 `8787/agent-v2` 未登录时正确跳转登录页，未授权 BFF 请求被拒绝。没有用该未登录页面检查宣称会话端到端已通过。

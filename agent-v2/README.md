# AgentV2 独立执行链路

当前已成为唯一在用 Agent 执行链路；旧 DSH 入口及实现于 2026-11-02 移除。V2 全范围生产验收仍未完成。完整范围以 `../docs/agent-v2-architecture.md`、开发计划和验收矩阵为准。

## 工程与依赖

- `core/src/domain.rs`：消息、命令、执行上下文、权限判断及 OpenAPI DTO。
- `core/src/store.rs`：PostgreSQL 事务、任务执行锁/心跳、fencing epoch、checkpoint、事件与 outbox。
- `worker/src/runtime.rs`：平台控制的模型/工具循环；`adapters/model.rs` 使用 Rig 单步流式请求；`adapters/cordis.rs` 管理每个 run 的真实 Host 子进程。
- `cordis-host/`：独立 npm 工程，固定加载诊断插件，服务注入和 effect/dispose；不加载任意市场代码。
- 平台 API：`../api/src/modules/agent_v2.rs`；页面：`../web/app/(protected)/agent-v2/page.tsx`。
- Rust 1.95.0、Node 24.13.0；Rig `0.40.0`、SeaORM `2.0.0-rc.41`、Cordis `4.0.0-rc.12`。锁文件已保存到工作区；通用 `mime_guess` 补丁位于 `../api/vendor/mime_guess`，不属于旧 Agent。

这是“一客户一套平台”的部署。`tenant_id` 沿用平台已有身份/BYOM 范围字段，未新增商业租户管理或租赁计费。本文的任务执行锁（数据库字段 `lease_*`）只防止崩溃或超时 Worker 重复提交；不是客户购买/租赁平台的合同。

## 启动

日常整体开发运行 `./scripts/start-dev.ps1`，仅启动 API、AgentV2 和 Web；`-SkipAgentV2` 用于只开发平台 API/Web。旧 DSH 专用脚本及跳过开关已移除。该入口会统一 API/Worker 开发密钥和端口，并管理 V2 构建、就绪、日志及退出清理。详细行为与 Rig 版本核查见 [Rig 核查记录](../docs/agent-v2-rig-review.md)。下面保留分别启动各服务的方式，分别启动时仍须自行统一密钥。

1. 复制 `.env.example` 到 `.env`，填写平台 `DATABASE_URL`，为 API 与 Worker 设置同一个随机 `YAYA_AGENT_V2_WORKER_SECRET`（至少 32 字节）。沿用平台已有 `AUTH_TOKEN_SECRET`、`YAYA_BYOM_ENCRYPTION_KEY`；已有密钥不得重新生成。许可证公钥/员工安装仍使用平台现有配置。
2. 从仓库根目录分别在三个终端运行：

   ```powershell
   ./scripts/start-agent-v2.ps1 -Service Api
   ./scripts/start-agent-v2.ps1 -Service Worker
   ./scripts/start-agent-v2.ps1 -Service Web
   ```

   若原 API 已在 8788 运行，应在原服务正常维护流程中重启为新构建并注入同一 Worker secret，或设置独立端口；脚本不会杀死现有进程。API 启动沿用既有迁移机制追加 `m20261028_000095_agent_v2`；没有主动对当前 public schema 执行迁移。现有 API 主程序也会启动平台原有业务 Worker，请使用测试部署验证后再更新客户环境。
3. 访问 `http://localhost:8787/agent-v2`。账户需要 `agent.window` 和 `agent:<employeeId>:use`；系统管理员按平台现有通配规则处理。员工必须已安装、许可证有效。用户需有可用默认 BYOM 路由，员工需显式获准 `diagnostic_echo` 或已有 `list_apps`/`yaya_list_apps`。

可修改 `-ApiPort`、`-WebPort`。Worker 的 `YAYA_AGENT_V2_API_URL` 必须指向对应 API。模型密钥只由内部接口传给 Worker；Host 环境不继承 JWT、密钥或数据库连接。

## 行为

- 创建会话时锁定用户/员工/平台已有范围；提交命令不接受员工替换字段。
- prompt 与用户消息、run、初始事件同事务；同会话 `clientCommandId` 去重，不同内容返回 409。
- 每会话按持久 `queue_seq` 顺序执行，避免随机 UUID 排序造成消息超车。Worker 使用原子领取和临时执行锁，心跳续期；过期 owner/epoch 不能写状态、消息、工具结果或事件。
- 工具完成结果与 checkpoint 原子保存；恢复会复用已提交结果。工具执行到结果入库之间崩溃可能重做只读工具，因此本批不开放业务写入。
- 当前工具：`diagnostic_echo`（真实 Cordis）、`platform_list_apps`（用户应用可见范围与员工 applicationIds 交集，空范围拒绝返回业务数据）。其余工具不进入模型定义。
- 四类模型超时：连接 10 秒、首流项 30 秒、空闲 20 秒、总请求 120 秒；最多 12 步、网络/429/5xx 最多 3 次领取，重试间隔 3 秒。配置名见 Worker `Config`。停止在心跳检测或下一次持久操作时生效；默认心跳约 10 秒。Host 随 run future 丢弃而终止。
- SSE 从持久事件按 seq 重放；浏览器断线不提交取消。消息刷新可重新加载历史，切换员工不会复用前一员工会话。会话目录本批上限 200 条；分页/搜索属于后续交付。
- outbox 与事件原子写入，当前 SSE 直接读取事件表；尚未实现 outbox 分发/清理服务。

## 检查

```powershell
./scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline
# 或提供测试数据库；只创建/清理随机命名 schema，不改客户 public 表
./scripts/check-agent-v2.ps1 -TestDatabaseUrl $env:AGENT_V2_TEST_DATABASE_URL
```

包括真实 Cordis 测试、Rust 数据库/执行恢复/实际杀进程测试、API 权限与 SSE 撤权、共享权限回归、前端组件、实际 BFF 代理、ESLint 与 HTTP 边界检查。API 测试使用临时生成公私钥签发的测试许可证，密钥文件只在临时目录，不替换平台许可证。

独立源码构建检查：`./scripts/test-agent-v2-independence.ps1 -Offline`。该脚本只复制 V2 和通用 MIME 补丁到临时目录，不复制旧 DSH、运行配置或密钥；使用本机编译缓存，执行 Rust 构建/基础测试和真实 Cordis 生命周期测试。需要 PostgreSQL 的测试仍由上面的完整检查执行，此检查不等同于完整隔离部署端到端验收。

真实 BYOM 检查（使用现有默认路由，只生成隔离测试会话；会产生模型调用费用）：

```powershell
# 本机已有开发默认密钥时显式选择，客户部署应注入实际 YAYA_BYOM_ENCRYPTION_KEY
$env:AGENT_V2_USE_DEVELOPMENT_KEY='1'
node agent-v2/scripts/test-live-byom.mjs
```

没有可用配置时应记录“未验证”，不能改为假模型通过。PSQL 路径可用 `PSQL_PATH` 覆盖。

早期验证见 `../docs/agent-v2-first-slice-report.md`，其首批范围不代表当前全部实现。附件、工作区、平台写入确认及办公解析已有后续实现；RAG、会话完整生命周期、市场完整兼容和生产门槛尚未完成。当前实际结果与未验证项见[验收补齐报告](../docs/agent-v2-acceptance-closeout-report.md)。

## 当前文件工具更新（2026-10-30）

旧首批描述不代表当前全部能力：员工 applicationIds 已不参与 V2 授权；附件及会话工作区已实现。新 office crate 提供常见办公文件读取及 XLSX/DOCX/PPTX 基础生成，启动脚本自动构建 helper。生产需将 yaya-agent-v2-office 放到 API 旁或配置 YAYA_AGENT_V2_OFFICE_PATH。格式、资源限制、实际验收与缺口见 [办公文件报告](../docs/agent-v2-office-report.md)。

## 模型输出预算与办公续答诊断（2026-11-02）

`YAYA_AGENT_V2_MAX_COMPLETION_TOKENS` 控制每步请求的模型生成 token 上限，默认 8192，可配置 1–32768；它同时覆盖供应商计入 completion 的推理 token，不等于可见正文长度。供应商和模型仍必须支持设定值。达到预算时持久化 `model.response_failed` 用量事件，返回 `model_output_limit`，不执行截断工具参数；真实空响应返回 `empty_model_response` 并按现有最大重试次数重试。已经持久化的工具结果不会因此重新执行。日志只记录安全错误类别和 HTTP 状态，不记录供应商正文、密钥或推理文本。

现有默认 BYOM 可对指定任务已经持久化的工具结果做隔离诊断：设置 `AGENT_V2_LIVE_REPLAY_RUN=<run UUID>` 再运行 `test-live-byom.mjs`。只查询源 checkpoint，在随机测试 schema 中发一次模型请求，不重跑原工具、不执行模型新提出的写入，也不更改源任务。诊断省略原始附件字节，适用于文件内容已包含在工具结果中的模型续答定位，不能替代完整上传/解析/生成验收。仅对有权访问的数据使用；会产生正常模型调用费用。


## Skill 独立执行（2026-11-02）

开发服务使用默认 target，完整检查使用 `target/validation`；不要把两者显式指向同一目录，以免Windows锁住运行中的二进制。独立空库验收：注入专用 `AGENT_V2_FRESH_DATABASE_URL` 后运行 `node agent-v2/scripts/test-fresh-database.mjs`；只接受 `agent_v2_acceptance_*` 空库，不创建或删除数据库，详情见上述验收报告。

`executor` 默认使用当前系统账户本地子进程，启动不要求 Docker。会话 venv/node_modules 与文件跨调用、重启保留；员工安装不安装依赖，锁文件可选，缺包后由 Agent 独立安装并重跑。Skill 配置不进入模型。当前账户不提供系统级沙箱。Windows 执行器真实链路通过，真实模型与 Linux 发布待验收，见[本地执行报告](../docs/agent-v2-local-execution-report.md)。

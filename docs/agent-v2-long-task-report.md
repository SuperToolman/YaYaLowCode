# AgentV2 长任务与自动执行调整报告

日期：2026-11-03。代码基线 HEAD：949b8a2；实现位于未提交工作区。本报告的最新规则覆盖早期 48 步、12 小时、1000 次请求预算方案。

## 当前规则

- 没有整条任务的累计时长、模型请求次数或模型步骤上限。模型返回完成答复后结束，用户可停止；不可恢复错误明确失败。模型请求数量及运行时长仅作持久观测。
- 移除 48 步阶段门槛、时间耗尽心跳拦截、请求次数预留上限，以及 API 对脚本超时的“剩余任务预算”裁剪。
- 页面不显示预算卡、阶段配额、“继续任务”或“增加预算并继续”。普通执行不增加独立状态卡；结果不确定时保留核对执行记录及停止入口。
- 单次请求网络超时、单次脚本默认 600 秒／可请求 1..7200 秒、子进程树终止、结果大小、附件传输和资源配额继续保留。这些不是任务累计运行预算。
- 重复调用检测只向模型提供换方法或解释阻碍的提示，不自动暂停、不要求用户批准继续。
- 权限快照、员工使用权、许可证、逐次授权、平台写操作确认、FIFO、幂等、fencing 与 outcome_unknown 不重放保持有效。模型的完成判断不能代替这些授权。

## 首次发送即暂停的回归修复

根因是将 UTF-8 字节大小估算直接作为 token 硬限制，并在无法删减必要输入时写入 paused。较大的员工说明和工具 Schema 可在第一次模型调用前触发；继续命令没有改变输入，因此重复暂停。

当前字节估算仅作为整理历史的软触发信号。不能压缩时保留完整历史继续请求；摘要失败记录 context.compaction_deferred 后使用原输入，不伪造成功、不截断调用与结果配对。摘要正常完成才持久保存精简模型视图；原始页面历史不变。真实模型拒绝请求时按实际错误处理，不把估算当作供应商的确定结论。

上下文窗口来自服务端对实际模型／路由的配置：YAYA_AGENT_V2_CONTEXT_TOKENS 是未指定路由时的软触发默认值，YAYA_AGENT_V2_CONTEXT_WINDOWS_JSON 可按 BYOM route ID 覆盖。已修复误用“秒数不超过 86400”校验导致 128K／1M 配置无法加载的问题。本批未新增运营端模型配置界面，也没有精确 tokenizer 或自动推断供应商窗口；不能声称 32768 是所有模型的容量。图片编码字节也只是保守信号，不能视为视觉 token 的真实计费。

旧任务中因 context_unshrinkable、context_compaction_failed、budget_exhausted、no_progress 暂停的记录，由新 Worker 在取得数据库执行权后自动接续。必须已确认无运行脚本且无结果不确定记录，恢复后重新授权。旧 epoch 无权写入。不改写已失败／取消任务，不重新执行已有工具效果。

仅对前版脚本说明中“任务剩余预算”描述的移除建立精确合同 hash 兼容；其余工具 Schema、动作权限、员工能力及资源版本仍冻结检查。

## 持久化与发布

新增迁移 m20261103_000107_agent_v2_long_tasks，为执行观测、上下文 checkpoint、暂停兼容和脚本 deadline 增加字段及协议保护。budget_ms、model_limit、stage 等历史字段暂存兼容，不再参与执行条件，也不作为新增任务配额。保留旧 resume HTTP 合同兼容已有客户端，但新页面不使用它，恢复不追加预算。

没有为取消预算再新增表，也没有删除正式会话、文件、依赖环境或历史记录。测试只创建并删除随机隔离 schema；未直接升级当前开发库，实际 API 启动执行平台迁移。

开发启动：在原开发终端停止本项目启动进程后，从仓库根目录执行：

```powershell
.\scripts\start-dev.ps1
```

API、Worker、execution manager 与 Web 应配套重启。运行中的旧程序不会因为源码变化而自动获得本次修复；不允许旧 Worker 接管新协议任务。已失败的历史任务需重新发送，新执行仍复用原会话工作文件与依赖环境。回退前先停止活跃任务；保留新增字段、正式文件和消息，不反向删除迁移，不重放未核对脚本。

## 验证证据

- Core：13 个测试通过，含 4 个真实 PostgreSQL 隔离测试。新增用例将历史 model_limit 设为 1、model_requests 设为 1000、budget_ms 设为 1、运行起点设为 13 小时前，仍能并发记录新请求而保持 running；验证自动恢复、checkpoint、FIFO、取消、unknown 不恢复和旧 epoch 拒绝。
- Worker：真实 PostgreSQL + Rig 协议的确定性流式供应商 + 真实 Cordis 生命周期。验证单次执行连续 51 个模型步骤和 50 次实际诊断工具调用，无 48 步中断；上下文摘要及原始历史保存；摘要失败继续；重复探查最终由模型解释阻碍；大员工说明、全工具目录和附件在首次请求前不被估算拦截；旧 context 暂停自动恢复。
- API：真实 HTTP／隔离数据库权限、会话、附件、submission、设计 broker 及兼容 resume 集成用例通过；2 个执行资源／冻结配置用例通过。
- 前端：AgentV2 组件及状态测试通过；预算卡与继续按钮移除、未知执行结果不提供重跑入口；定向 ESLint 通过。
- Executor：本轮前序 10 个实际本地执行／合同测试通过，涵盖 Python 缺包→独立 pip→重跑、Node CJS/ESM、中文与脱敏、停止进程树、deadline、会话依赖持久、旧 job 不重放；取消任务预算未改变本地进程后端。

复现命令（数据库用例必须显式提供 AGENT_V2_TEST_DATABASE_URL，只操作随机测试 schema）：

```powershell
cargo test --locked -p yaya-agent-v2 --tests --manifest-path agent-v2/Cargo.toml -- --include-ignored
cargo test --locked -p yaya-agent-v2-worker --bin yaya-agent-v2-worker --manifest-path agent-v2/Cargo.toml -- --include-ignored
cargo test --locked -p yaya-agent-v2-executor --bin yaya-agent-v2-executor --manifest-path agent-v2/Cargo.toml
# API 用例还需独立测试许可证；完整配置见 scripts/check-agent-v2.ps1。
# web 目录：pnpm exec vitest run features/agent-v2
```

已使用 Rust/Cargo 1.95.0、Rig 0.40.0、Node 24.13.0、Python 3.13.9、PostgreSQL CLI 18.4。构建测试使用 test 可执行文件，未覆盖运行中的主程序。

## 未实测项

按用户要求，本批不使用浏览器测试，页面真实操作由用户手动验收。本批模型循环使用确定性供应商，不能替代真实已授权模型自主完成 BOM 缺包安装、重跑、完整交付。隔夜无人值守、Linux 长脚本、发布镜像和生产验收未通过本批实测。此前 Web 全量 tsc 存在 MyTable.test.tsx:66 的非 AgentV2 类型错误，不计作全项目类型检查通过。

脚本仍以当前系统账户运行；会话目录和 venv 分离不等于操作系统沙箱。本批不代表整个 AgentV2 或生产安全验收完成。

## 模型错误展示修复（2026-11-03）

实际 BYOM 诊断发现 DeepSeek 返回 HTTP 503 / service_unavailable_error，安全提取的消息为 Service is too busy。最新两条失败任务持久码是 provider_retryable，不能将其它历史 execution_failed 均归因为该 503。原实现将 HTTP 状态只保留在 Worker 安全日志，run.failed 事件仅携带通用分类，页面无法显示具体状态。

现将 HTTP 503 映射为 provider_unavailable、429 映射为 provider_rate_limited，继续参与原有可重试错误处理；运行时从受控安全元数据保留状态分类，经既有 error_code 和 run.failed.payload.errorCode 持久传递。前端显示中文原因和 HTTP 状态，不回显供应商原始正文、URL 或密钥；execution_failed 不再直出内部代码，而是明确说明缺少具体原因。无需新增 API DTO 或迁移，不改写旧任务历史。重启 Worker 并刷新 Web 后新请求生效。按用户要求未运行回归测试。

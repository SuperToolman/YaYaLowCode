# AgentV2 现有能力验收补齐报告

日期：2026-11-02（Asia/Shanghai）。基线 commit：`949b8a2c8e5b02c9c6a59f067337257a40f8ac60`；本报告对应其上的当前工作区，仓库原有大量未提交变更，不代表全部变更均由本批产生。

**结论：本机分层回归和开发启动通过，已修复执行器重复执行风险与启动误停风险；真实模型、浏览器完整业务链路、Docker及独立空库验收仍有阻断。本批不标记完整验收闭环或完整 V2 完成。** 没有新增 RAG、归档删除或上下文压缩，没有恢复旧 DSH 或创建旧内容备份。

## 1. 实际修复

- 启动不再仅凭端口终止进程：先检查 API 可执行文件或 Next 命令确属当前仓库；两个端口均通过检查后才停止。不能确认归属时拒绝操作。Worker 原有 PID、启动时间和路径校验继续保留。
- 显式配置复用执行 manager 时，验证 secret 配置长度和健康检查；缺少 Docker 时默认开发启动仍告知脚本不可用，不回退宿主执行。
- 执行器发现已有任务目录但状态文件损坏或丢失时拒绝重新提交，要求核对；不再将读取失败当作新任务。这避免可能已经产生外部效果的脚本被重跑。
- 提取并验证重启中断终态：running/queued 转 outcome_unknown 后，晚到成功不能覆盖；扩展不同参数冲突、鉴权、旧 epoch 与终态保护用例。
- 全检查加入空库入口防误用测试和共享记录校验的显式数据库回归，不把默认 ignored 或零用例结果当作通过证据。

## 2. 新验收入口

### 独立空库

`agent-v2/scripts/test-fresh-database.mjs` 仅接受显式 `AGENT_V2_FRESH_DATABASE_URL`，数据库名必须为 `agent_v2_acceptance_*`，不允许查询参数覆盖 search_path。拒绝已配置的开发/生产数据库名，以及存在用户表、函数或类型的非空库；连接口令使用子进程环境，不放入 psql 参数。不会创建、删除数据库或扩大角色权限。

使用前由管理员准备独立空测试库；连接通过现有秘密注入方式设置，不将口令写入命令记录：

```powershell
# 先用独立 target 构建 API 和 Worker，不能覆盖正在运行的二进制
$env:CARGO_TARGET_DIR='E:/OverPorject/yaya-low-code/agent-v2/target/validation'
cargo build --manifest-path api/Cargo.toml --locked
cargo build --manifest-path agent-v2/Cargo.toml --locked -p yaya-agent-v2-worker
# 注入 AGENT_V2_FRESH_DATABASE_URL 后
node agent-v2/scripts/test-fresh-database.mjs
```

入口执行全量迁移、重复迁移、迁移106检查、API健康检查和真实Worker启动；文件状态使用临时目录，数据库保留用于诊断，不自动删除。结果在 `agent-v2/target/fresh-database/result.json`。退出码0通过、2前置条件阻断、1执行失败。4条防误用测试通过不代表真实空库通过。

### 容器执行

`agent-v2/scripts/test-executor-live.ps1` 缺少 Docker/daemon/manager 配置时输出 blocked，退出2；默认真实场景增加参数冲突、旧epoch及超时。超时等待使用配置值加余量，替代原90秒等待不足以覆盖默认120秒运行超时的问题。

```powershell
# 仅在 Docker 测试环境执行，注入现有执行URL和secret
./agent-v2/scripts/test-executor-live.ps1 -ExpectedExecutionTimeoutSeconds 120
# 独立测试 manager 的崩溃恢复；不自动终止任意外部服务
./agent-v2/scripts/test-executor-live.ps1 -Mode PrepareRecovery
# 立即重启该测试 manager 后，使用上一条输出的 executionId
./agent-v2/scripts/test-executor-live.ps1 -Mode ValidateRecovery -RecoveryExecutionId <executionId>
```

PrepareRecovery 要在运行超时前重启测试 manager；未发生重启则不得将 ValidateRecovery 记为通过。真实容器后续还必须验收依赖预构建、只读挂载、资源/磁盘限额、输出收集、配置保密、取消与崩溃；镜像digest和Python完整hash锁仍是供应链门槛。本机本轮没有执行这些Docker场景。

## 3. 本轮实际结果

| 检查 | 结果与证据 |
| --- | --- |
| 完整检查 | `./scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline` 最终通过；`agent-v2/target/acceptance-closeout-final-check.log` |
| Rust | 按各命令结果合计78次测试通过；包含真实PG隔离schema、Worker恢复、权限/提交/附件/设计确认/效果等集成入口。嵌套场景不另虚增测试数 |
| ignored说明 | `platform::`宽过滤中有1条记录校验用例默认ignored，随后显式用`--ignored`执行通过；doc-test零用例不计验收 |
| Cordis | 3条真实生命周期/协议/适配样本测试通过，不代表市场全兼容 |
| 前端 | 8文件40用例通过，包含发送恢复、历史分页/终态、确认卡与BFF；定向ESLint和HTTP边界通过 |
| 启动归属 | 6条确定性用例通过，另实际核验当前API/Next归属；不终止无关进程 |
| 空库防误用 | Node测试4条通过；没有显式独立空库时入口返回blocked |
| 默认启动 | `./scripts/start-dev.ps1`实际通过，API `/healthz` 200、Web登录页200、Worker ready；`acceptance-closeout-startup-default.log` |
| 当前增量迁移 | 只读核验当前数据库migration106登记数为1；未手工改客户业务数据、身份或密钥 |
| 真实Rig诊断 | 实际运行 `test-live-byom.mjs`，现有默认BYOM返回 `provider_error_kind=provider,http_status=unknown / provider_rejected`；`acceptance-closeout-live.log`。失败，不算通过；没有自动更换模型或扩大员工能力 |
| Docker | 本机缺少CLI，真实脚本返回blocked；无宿主回退 |

汇总：`agent-v2/target/acceptance-closeout-summary.json`。Rig0.40.0、Cordis4.0.0-rc.12沿用锁文件；本批不新增公共DTO或迁移，启动按既有流程导出OpenAPI/生成SDK，不据此宣称新增能力。

中间失败如实记录：一轮复查误用了正在运行Worker所在的validation target，Windows锁文件导致构建失败；停止本次管理的开发进程后检查通过，最终默认开发target与检查validation target分开。不要将开发服务与检查指向同一target。

## 4. 真实链路与阻断

- 浏览器曾成功登录本地默认开发账号并展示员工选择、历史会话、消息框和工作区。服务重启期间页面进入连接错误页，之后浏览器URL策略阻止重载；未绕过策略，未完成重启后的业务交互验收。
- 因此文字实际发送、图片/Excel/DOCX/PDF混合附件、上传与提交边界刷新、20轮以上历史滚动、断线/停止，以及T23/T31预览批准/拒绝/冲突的**本轮浏览器全链路均未通过**。已有数据库/假供应商用例通过不能替代它们。
- 默认BYOM诊断已实际尝试但失败；当前仅能确定供应商/协议返回拒绝，未知HTTP状态，不推断为员工权限或许可证问题，不记录供应商原始正文或密钥。
- 当前数据库角色 `CREATEDB=false`，没有显式独立空库。临时PG初始化与清理命令被自动审批审查拒绝，返回“blocked by policy”，没有进一步细则。本轮未完成新的initdb尝试；此前Windows0xC0000005仍是历史阻断，不虚构本次重现。
- 全站TypeScript/样式检查此前存在共享组件阻断，本轮没有修复或重测全站；本批定向检查通过不等于全站通过。72小时稳定性、容量和Linux部署仍未验收。

## 5. 后续与回退

下一步先恢复可用浏览器测试环境、查明现有BYOM拒绝原因，执行上表真实链路；提供独立空库后跑新入口；有Docker环境后跑容器场景。未通过前继续保持对应验收状态，不开始以这些能力已可靠为前提的生产切换。

回退本批启动/验收脚本及执行器修复不需要数据库回滚；保留正式会话、附件、执行记录和既有密钥。状态损坏的执行不自动重跑，需核对外部效果。所有测试清理仅针对自建临时文件或随机测试schema，不备份或删除客户业务数据。

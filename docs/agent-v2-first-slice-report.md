# AgentV2 首批实现与验收记录

日期：2026-10-28。结论：独立执行代码与分层集成测试已落地，真实 BYOM + Rig + Cordis 工具链路通过；**首批全部上线门槛尚未通过，完整 V2 未完成**。无生产切换、历史迁移或旧实现删除。

## 部署决议与权限边界

用户确认“一客户一平台”，不新增商业租户/租赁模式。数据库已有 `tenant_id` 继续绑定平台现有用户身份和 BYOM 范围。Worker 的 `lease_*` 是任务临时执行锁/心跳/fencing，仅用于可靠恢复，与客户购买模式无关。

用户员工分配复用 `agent:<employeeId>:use`，`agent.window` 只表示页面入口。员工安装/有效期来自原平台员工许可证服务。会话固定绑定范围、用户、员工；所有读取、命令、取消、SSE 校验归属，撤权后关闭事件流。Worker 每次模型步骤与工具调用前读取当前授权，不能靠旧 JWT 或缓存权限继续使用工具。

## 已实现

| 项目 | 当前证据 |
| --- | --- |
| 独立 Rust workspace | `agent-v2/core`、`worker`、Cargo.lock；不加入旧 API 的 Cargo workspace |
| 独立 Cordis | npm 上游 `cordis@4.0.0-rc.12`，Host package-lock；非旧 fork，不读取旧 DSH 目录 |
| 持久任务 | 8 张 V2 表：sessions/commands/messages/runs/steps/tool_invocations/events/outbox；追加迁移 95 |
| 去重与执行顺序 | 同事务保存、幂等冲突检测、queue_seq、同会话串行、多 Worker 竞争领取 |
| 崩溃恢复 | 临时执行锁/心跳/epoch，模型与工具 checkpoint，已持久工具结果复用 |
| 受控模型工具 | Rig 单步 stream，Rust 手动循环和授权；诊断工具、应用列表只读工具 |
| 独立 Host 协议 | 版本握手、能力列表、健康、调用、取消、卸载；1MiB 帧与结果限制、并发 ID、异常处理 |
| API 与 UI | `/api/agent/v2`、内部 Worker 专用 secret、OpenAPI/生成 SDK、员工选择、会话/历史、发送/停止、工具/错误、SSE |
| 样本 | Skill 文本；迁移适配样本 `yaya.sample.diagnostic-adapter@1.0.0`，兼容 C4、sample-only |

## 实测结果

补充：[Rig 用法核查及开发启动说明](agent-v2-rig-review.md)。主 `scripts/start-dev.ps1` 已接入 V2，新增隔离 Worker 启动/就绪/退出及 PID 身份检查测试；模型适配补强首响应共享截止时间和半截工具参数拒绝处理。纯文本 EOF 严判等剩余门槛仍保留。

启动故障复测补充：已实际运行默认完整启动，修复已有开发数据库缺少 `queue_seq` 导致 Worker 退出的问题，追加兼容迁移 96，并在当前开发库通过正常启动流程执行。新旧结构升级测试通过，API/旧 Host 健康检查及 Next 启动通过；详情见上述核查说明末节。下文首次验收时“未改 public”的记录仅指当时的隔离测试，不能作为本次启动后的数据库状态。

执行 `scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline`，Windows / Rust 1.95 / Node 24.13 / 本地 PostgreSQL：

- Rust workspace：2 条 domain 单元测试；1 条数据库集成测试；真实 Host 生命周期；Rig 假供应商工具循环及 checkpoint 恢复；1 条真实 Worker 子进程终止/接管测试（领取、模型步骤开始、工具开始、工具结果保存四个边界）。
- API：隔离 schema 和临时测试许可证，验证未分配员工 403、其他用户 404、伪造 employeeId 422、命令去重、SSE seq 重放、撤权后断流及取消拒绝。
- 共享平台测试：22 通过，1 个原有数据库校验测试因单独环境变量未设置而忽略。旧入口权限与归档权限策略回归通过；未覆盖旧 Agent 全部业务 UI。
- 前端：6 条测试通过，含组件发送重试复用命令 ID、停止、重新挂载恢复历史、连接中断不取消、事件去重/撤权清理；真实 Next BFF handler 连接本地 HTTP 上游验证 cookie/Bearer、Last-Event-ID、JSON 与 SSE 透传。ESLint 和 HTTP 边界检查通过。
- 已有 BYOM：读取现有已启用默认路由，在隔离测试 schema 运行真实 Rig 流式模型、Cordis 工具和模型续答，通过。没有修改用户路由或密钥。该检查使用测试上下文，不替代完整授权产品页面端到端验收。
- OpenAPI 导出与 SDK 生成成功。全仓 `tsc --noEmit` 仍失败于既有 `web/app/components/my-fields/MyTable.test.tsx:66` children 类型，不属于本批修改；AgentV2 无新增 TS 错误。
- 独立源码检查：`scripts/test-agent-v2-independence.ps1 -Offline` 通过。临时目录只含 V2 和通用 MIME 补丁，不含旧 DSH 目录/配置；Windows 下使用现有编译缓存，Rust 构建、2 条 domain 测试、真实 Rust Host 生命周期及 3 条 Node Cordis/迁移适配测试通过。该检查跳过需要数据库的测试，不代表完整隔离产品链路或 Linux 部署已验收。

## 依赖和兼容决议

- Rig 固定 `0.40.0`，Chat Completions 接口；不使用 SDK 自动工具循环。SeaORM 固定 `2.0.0-rc.41`，与平台共享基础数据库依赖。
- Cordis 上游：[cordiverse/cordis](https://github.com/cordiverse/cordis)，npm `4.0.0-rc.12`，MIT；依赖 `cosmokit@1.8.1`、`@standard-schema/spec@1.1.0`，MIT。完整 npm integrity 在锁文件。
- 旧来源为 `@deepseek-ai/cordis@4.0.1`，作用域、版本和 API 合同不同；本次仅验证 Context/plugin/provide/get/effect/dispose 所需子集。未完成完整源码差异审计，不能认定旧插件二进制直接兼容。
- `yaya.sample.diagnostic-adapter@1.0.0` 是独立迁移合同样本，手动映射参数/execute 到工具注册，无 DSH 服务依赖；不是市场真实包兼容证明。未核定的市场包一律未验证。
- Host 当前只固定加载受信任诊断插件，不具备生产级第三方代码沙盒。Rust 传入 scope 不含 JWT、API key、连接串；Host 子进程环境只保留运行必需系统变量。

## P0 能力基线（源码证据，非全量现场验收）

| 能力 | 现状来源 | 可用等级/首批迁移结论 |
| --- | --- | --- |
| 员工市场安装/许可证 | `api/src/modules/settings.rs` runtime employees + `platform/license.rs` | 平台已有实际入口；V2 复用，只能使用已安装有效员工 |
| 员工使用权限 | `platform/platform_permissions.rs`、`settings::get_runtime_ai_employees` | 既有资源权限，V2 统一复用；入口权限不赋予员工使用权 |
| 用户身份/组织范围 | `platform/authorization.rs` | 现有范围解析，不新增商业租户系统 |
| 自有模型 | `modules/byom.rs`、settings/model-routes | 已有默认路由，真实验证成功；解密仅 API→Worker |
| 旧工作台/会话 | `modules/agents.rs`、`web/features/agent-workbench` | 保留当前入口；V2 本批仅新会话/消息/停止 |
| 工作区/附件/产物 | 旧 Agent 工作区与平台上传服务 | 平台已有实现，V2 尚未迁移，不显示上传按钮 |
| 搜索/归档/恢复/彻底删除 | 旧 Agent 会话/归档 API 与工作台 | 保留旧功能；V2 后续实现，未纳入本批完成 |
| 平台应用列表 | 旧 `yaya-platform` 插件 `yaya_list_apps` + Rust `apps` 服务 | V2 独立 `platform_list_apps`，取用户和员工范围交集 |
| 其他平台只读工具 | 旧插件 forms/automations/schema/query_records、field_outline、navigation、related/detail records、workflow definitions/runtime | 有源码注册，是否对具体员工启用由包授权决定；V2 默认不暴露，待逐项应用服务适配 |
| 平台写入 | 旧插件 propose_write/create_form/create_automation/save_form_schema，Rust action API | 有实现；V2 暂不开放，后续 P4 授权/确认/审计闭环 |
| 表单回填建议 | 旧 `yaya_propose_form_values` 与表单 UI | 存在源码，V2 本批不迁移浏览器回填协议 |
| 浏览器、MCP、命令、LSP、调度 | 旧 DSH 可选插件/配置 | 可选能力，不能从源码存在推断具体客户已启用；需要安装包级清单 |
| RAG/Embedding/文档检索 | 三份 V2 设计文档 | 本批尚未实现，不能认定旧源码存在即等价可用 |

现有员工实际启用工具列表、市场必迁包 ID/version/digest、完整旧流程录像、目标客户规模尚未全部冻结，P0 退出门槛未完成。不能据此删除旧实现。

## 回归场景与未完成门槛

已覆盖身份绑定、员工授权、拒绝改变会话员工、用户隔离、事件撤权。业务动作授权与删除确认在 V2 尚未开放，后续必须测试：模型伪造应用/表单资源、确认后权限变化、重复确认与执行后断线、跨用户恢复/下载/检索、彻底删除的所有派生引用清理。

仍需完成后才能宣称本批全部验收：

1. 客户式测试部署中，通过实际浏览器 + Next BFF + 完整平台中间件 + Worker 进行一次连续端到端验收；现有测试按边界分层，不等同于该门槛。
2. 不挂载旧 DSH 目录的完整隔离产品链路和 Linux 运行证据。Windows 独立复制目录的构建与真实 Host 测试已通过，仍需连接完整平台 API、数据库和页面进行部署验收。
3. 完整市场 fork 差异审计、必须迁移插件实包验证、生产沙盒；Host Rust 客户端当前每 run 串行 RPC，尚未做多请求客户端并发与长工具主动取消协商。
4. outbox 消费/清理、目录分页、长会话上下文预算、流式异常截断严判和供应商错误矩阵、部署负载与资源限额。
5. 旧 Agent UI 和共享 apps/BYOM 全量业务路径现场回归；当前只完成编译、权限测试及最小改动核对。
6. 空库/已有客户库完整迁移演练；本次仅对隔离 schema 执行 V2 schema，未改当前 public 表。

完整范围的多模态、RAG/检索、工作区、会话搜索/归档/恢复/彻底删除、审批和业务工具继续按原计划，不因首批链路通过而删除。

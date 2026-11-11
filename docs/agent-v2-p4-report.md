# AgentV2 权限与平台工具阶段记录

日期：2026-10-29。状态：开发中，P4 未完成，不具备生产切换条件。

后续规则修订：本文原先的员工应用范围限制已移除，当前为策略 v2：员工能力决定工具，用户当前 RBAC 与任务快照决定资源权限。历史兼容字段仍保留，具体实施及证据见[员工能力与 RBAC 报告](agent-v2-capability-rbac-report.md)。

## 本轮实现

- 工具授权先按员工能力目录限制，再取任务快照和当前 RBAC 的交集；当前管理员通配权限不会给旧任务扩充其启动时没有的能力。策略版本变化、缺失动作快照均拒绝执行。
- 新任务/恢复继续使用统一 `prepare_run`；固定员工内容、工具合同、模型路由、提示词、员工工具和应用范围快照。员工内容发生变化时要求新任务。当前 RBAC、用户状态、员工安装/许可和应用资源权限在执行入口重查。
- 创建/编辑/删除继续统一要求确认；拒绝、过期、取消、资源冲突和执行失败可从确认 API 恢复结果。批准/拒绝记录审计，业务写与 `agent_v2_effects` 同事务提交，effect 已存在时恢复复用。
- 记录读取有界分页/筛选、用户数据范围与字段读策略过滤；Schema 输出过滤隐藏字段及隐藏父容器；导航只返回可见表单和含可见子项的组。自动化只读 DTO 不返回完整数据库行，图节点中常见密钥字段递归遮蔽。
- T10 关联记录执行显式限制在同一应用，并分别校验目标表单、员工/任务应用范围、RBAC、来源行和目标行范围；T17 工作流定义按 `current_version` 读取 `automation_flow_versions` 快照，缺少快照时失败关闭。
- 确认 API DTO 将执行结果纳入 OpenAPI 生成合同。前端确认卡从持久确认 DTO 恢复状态，事件 seq 去重；到期按钮状态由定时器更新。

## 验收矩阵

T01、T02、T04—T06、T08、T12、T15、T16、T19—T30 已有描述符和执行路径，具体剩余证据见[验收矩阵](agent-v2-acceptance.md)。这些状态仅是“已接入”，未因此视为通过完整授权/异常/并发验收。

T07、T32/T33 未开放。T31 独立实现与本地数据库/确认/前端分层测试已通过，真实模型设计端到端待验，详见[设计阶段报告](agent-v2-design-report.md)。T07 未有页面/草稿身份与版本绑定协议；T18 工作流运行态只读路径已接入，完整操作权限和真实 Rig/浏览器链路待验收，审批/撤回等操作未开放。`propose_write` 及未知工具不在描述符中，默认拒绝。

本轮继续开发补充：T09 定义列表补上与 T10 一致的同应用限制；T10 目标表单权限和 T14 明细权限均取当前 RBAC 与任务动作快照的交集，当前管理员不能给旧任务扩权。新增 `tool_read_tests.rs`，通过真实平台动态记录存储覆盖 T09/T10/T11/T14/T17 的关联过滤、来源与目标行范围、字段投影、分页、撤权、当前版本漂移/缺失快照及错误表单类型。测试 fixture 使用当前关联控件的单 ID 存储合同，不以数组 fixture 假定多选已经可用。

T18 新增显式工具描述符和员工别名 `yaya_get_workflow_record_runtime`，调用共享平台运行态读取服务。V2 先检查工作流表单和记录行范围，再返回实例/任务/历史；意见不进入模型，任务和历史各限 200 并标明截断。测试覆盖未运行记录、已运行记录、越权记录、缺失记录、员工能力缺失、动作快照缺少表单权限、截断和原产品意见仍保留。该工具明确只读，不声称具备审批/撤回等操作权限。

## 验证

本轮执行 `scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline` 成功，脚本将 Cargo 构建隔离到 `agent-v2/target/validation`，避免开发 Worker 占用默认二进制。测试包含 5 个 core 单测、确认命令/FIFO/过期/取消/fencing PostgreSQL 测试、命令隔离/恢复测试、旧 Schema 升级测试、Rig 假供应商 + Cordis Worker 恢复、Worker 四边界 kill recovery、API 员工/私有会话/确认写入集成测试、24 个共享 platform 测试（另 1 个要求专用环境变量的既有测试忽略）。3 个真实 Cordis Host Node 测试通过。本次脚本运行 AgentV2 Web client/page/BFF 为 3 个文件、9 条测试，ESLint、HTTP 边界检查通过；此前单独前端测试为 6 个文件/18 条测试。API/OpenAPI 构建和全 workspace 检查通过。

API OpenAPI 导出和 SDK 生成通过，新增确认结果 `result` DTO 字段；`tsc --noEmit` 仍因既有 `web/app/components/my-fields/MyTable.test.tsx:66` children 类型失败，AgentV2 文件无新增 TS 错误。上述数据库检查只在本机隔离 schema 和临时许可证运行，不能等同客户部署或浏览器真实写工具完整验收。真实浏览器与完整 BFF → Rust API → Worker → Rig 写操作链路本轮未验证。此前 PostgreSQL locale/登录失败没有复现，本轮本地隔离 DB 测试已成功。

## 已知风险及回退

### 本次增量验证（2026-10-29）

`powershell.exe -NoProfile -File scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline` 全部通过。脚本现在额外运行 `modules::agent_v2::tools::read_database_tests` 的隔离 PostgreSQL 测试以及 4 条 broker 授权/脱敏单测；原有 API 员工/确认写入测试、24 条 platform 测试、Cordis、Worker 恢复、9 条 Web 测试、ESLint 和 HTTP 边界检查保持通过。共享工作流读取服务的调用回归由上述数据库用例覆盖；本次不改变 OpenAPI DTO、不新增迁移，不重启用户开发服务。

本次证据仍是函数/服务与分层集成测试，未验证真实模型通过浏览器发起这条新工具；不能标记 P4 或完整 V2 完成。启动方式不变，按 `scripts/start-dev.ps1` 重启后载入新代码。回退时关闭 V2 Worker/入口并回退这批代码；无需回滚业务数据或数据库结构。

- 用户与员工动作/数据授权合同虽然有单测，但 RBAC catalog 的真实角色组合、行范围、字段范围和撤权竞态仍缺集成覆盖；T 项未验收前保持相应工具不暴露。
- API/V2 共用平台事务服务，回退 V2 Worker/API 发布即可停止新 V2 写操作；保留迁移表和旧 Agent 数据，不回滚或删除业务数据。共享服务的旧 Agent 回归尚未覆盖全部产品路径。
- 运行 `git diff` 审查本文件提及的改动时要考虑工作树内已有的独立用户改动；本报告不代表这些其它变更已经过审。

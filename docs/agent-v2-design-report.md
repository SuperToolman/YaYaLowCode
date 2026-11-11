# AgentV2 T23/T31 设计写入实施与验证记录

日期：2026-10-29。状态：独立实现、本地数据库/broker 和前端分层验证通过；真实模型设计端到端未完成。不能据此标记整个 P4 或 AgentV2 完成。旧 Agent、数据和原设计器入口继续保留。

后续规则修订：本报告中员工应用范围、策略 v1 与“未重启”的描述属于当时状态。当前使用策略 v2，V2 不再使用员工 `applicationIds` 授权；运营中心已补 T31 目录，正式商品仍须正常选取、发布、更新安装。实际浏览器创建与包同步测试、重启和未完成项以[员工能力与 RBAC 报告](agent-v2-capability-rbac-report.md)为准。

## 实际交付

| 项目 | 实现 |
| --- | --- |
| T23 | `platform_save_form_schema` v2：完整字段授权、身份/合同保持、完整设计校验、基准版本与目标 hash 冻结、公共事务保存 |
| T31 | `platform_apply_design_patch` v1：仅显式 `yaya_apply_design_patch`；normal/workflow；add/replace/remove、严格 Pointer/数组语义、100 操作/1 MiB 限制 |
| T05 | 描述符 v2：完整可读并可编辑设计返回 `designBaseline`；字段过滤结果无可写基准 |
| 预览/确认 | 显示完整字段属性、布局、增删、顺序和页面属性；冻结原始参数、baseline 与 targetHash；确认命令不能替换参数 |
| 一致性 | 保存/effect/确认结果/审计/事件原子提交；资源锁内复核权限与 hash；冲突持久化；恢复复用 effect |
| 前端 | V2 自有确认卡，HeroUI + MySurface + Gravity；展示基准版本、修改、状态/结果；无 CSS Module、无新上传或草稿回填 |
| 公共服务 | Schema 保存增加表单行锁，V2 使用一致的 form → navigation 锁顺序；仍保留原设计器历史版本保存语义 |

补丁与 hash 在 `api/src/modules/agent_v2/design.rs` 独立实现；Schema 规范化复用产品清理规则，避免确认目标与实际保存不同。T23/T31 共用设计校验，整份 Schema 不能绕过路径身份约束或完整字段授权。没有新增数据库迁移，也没有 HTTP DTO 变更，无需重生成 OpenAPI/SDK。现有确认 arguments/preview JSON 字段保存全部冻结信息；现有 migration 在隔离测试中实际创建/使用。

## 命令与环境

从仓库根目录运行：

```powershell
# 完整现有 V2 回归，包含新增设计用例
powershell.exe -NoProfile -File scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline
# 新增的定向设计检查：真实 DB/HTTP broker、设计合同、预览和确认卡
powershell.exe -NoProfile -File scripts/check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline -DesignOnly
# 正常开发启动；按现有流程重启 API/Worker 后载入 Rust 改动
.\scripts\start-dev.ps1
# 在独立开发环境只启动平台与 V2，不要求旧 DSH 构建
.\scripts\start-dev.ps1 -SkipLegacyAgent -SkipDshBuild
```

本机 Windows / PowerShell，rustc/cargo 1.95.0、Node 24.13.0，Rig `rig-core 0.40.0`，Cordis `4.0.0-rc.12`。描述符 T05/T23=2、T31=1，权限策略版本仍为 1；既有 command fingerprint 未改。测试使用 PostgreSQL 随机 schema、临时 RSA 测试许可证与员工包；结束后删除该 schema 和临时许可证目录，不修改客户业务 schema、运营配置或实际员工权限。构建使用 `agent-v2/target/validation`，不替换运行中服务的二进制。

## 已通过的证据

| 层次 | 实际结果与范围 |
| --- | --- |
| 独立合同 | 7 条 design 单测：合法补丁、转义、未知操作、缺失路径、数组插入/删除/追加、边界/限额、hash 键顺序稳定、身份/布局/父子/字段策略；1 条完整差异预览单测 |
| 工具注册 | V2 core 6 条单测通过，包含 T31 显式别名、通用包装器/通配拒绝和确认策略；T05/T23 描述符版本与说明已更新 |
| 真 DB + 内部 HTTP broker | 扩展 `api_employee_permissions_and_private_sessions`，真实 axum/reqwest/平台保存服务；T23/T31 预览、批准、拒绝、恢复、陈旧版本冲突、重复批准和效果去重通过 |
| 权限 | 当前员工工具/应用限制、任务工具/应用/动作快照、当前/快照字段范围、隐藏字段、批准后撤权、参数替换拒绝；T05 完整/过滤结果有无基准均通过 |
| 并发 | 两个任务冻结同一表单版本、并发重复批准、并发执行同一 invocation、批准/拒绝竞争、取消/批准竞争、旧 epoch 拒绝 |
| 故障/恢复 | 效果提交后令原执行权过期并重新领取，返回相同结果/版本且 effect 只增一条；在动态存储同步注入真实 CHECK 约束失败，Schema/版本/effect 及确认执行状态整体回滚；解除故障后可恢复 |
| 业务回归 | 保存立即生效、导航标题同步、workflow 流程及当前版本标题同步、Schema 历史切换/无变更保存、动态存储版本和新增 number 字段真实物理列 |
| 现有分层回归 | core 确认/FIFO/过期/取消/fencing、恢复与升级；Rig 假供应商/真实 Cordis、Worker 故障边界；API 权限/私有会话、只读平台 DB；4 条 broker 授权单测与 24 条 platform 单测通过，另 1 条既有专用 DB 测试忽略 |
| V2 Web | 4 文件 12 测试通过（含确认卡 3 条），覆盖属性/布局/基准版本、决策、过期、持久执行结果及冲突/拒绝/取消恢复；ESLint 与 HTTP 边界检查通过 |
| 原设计器 Web | Schema、布局、toolbox、separator 共 4 文件 25 条测试通过 |

最终完整回归运行日志位于 `agent-v2/target/t23-t31-validation.log`；定向设计运行日志为 `t23-t31-design-validation.log`，设计器与 TypeScript 日志同目录分别为 `t23-t31-designer-validation.log`、`t23-t31-typescript-validation.log`。日志属于本机可重新生成产物，不将其视为持久 CI 发布证据。数据库设计场景集中在 `design_broker_tests.rs`，由上述真实 API 测试调用，不能把同一个测试入口误计为若干独立测试。

原设计器 Web 的独立复现命令（在 web 目录）：

```powershell
node node_modules/vitest/vitest.mjs run 'app/(protected)/(main)/designer/[formUuid]/designer-schema.test.ts' 'app/(protected)/(main)/designer/[formUuid]/designer-layout.test.ts' 'app/(protected)/(main)/designer/[formUuid]/designer-toolbox.test.ts' 'app/(protected)/(main)/designer/[formUuid]/designer-separator.test.tsx'
```

## 未验证项和后续门槛

- 内置浏览器已通过页面提示的本地开发账号登录，打开 `/agent-v2`、切换已授权员工并查看权限说明；仅为工作台冒烟，不是新增设计确认卡的真实写入验收。
- 本机已安装员工包均缺少 `yaya_apply_design_patch`。按本批授权边界，未改写这些包或另一项目运营配置。需准备正式明确许可的测试员工包后，在隔离测试资源上执行 T31 真实链路。
- 本轮没有使用真实 BYOM 发起 T23/T31 修改；完整浏览器 → Next BFF → API → Worker → Rig → 确认 → 保存 → 续答仍待验。分层 mock BFF/假供应商与真实 HTTP broker 不是此链路的替代证据。
- 针对新增设计工具的 Worker 真实进程 kill/restart、确认期间断网刷新/重连、原设计器页面实际保存/历史切换及旧 Agent 页面回归尚待补充。数据库执行权过期/效果恢复模拟、现有通用 Worker kill 测试和函数/组件回归不等同这些场景。
- 未在完全移除/不挂载旧 DSH 目录的全新环境重新构建验收；本批 V2 源码无旧 executor/HTTP/运行时调用，不将源码检查等同环境独立性证明。
- `node node_modules/typescript/bin/tsc --noEmit` 被既有 `web/app/components/my-fields/MyTable.test.tsx:66` 的 children 类型不匹配阻塞；本次未报告 AgentV2 类型错误。构建另有既有 BYOM deprecated 等警告；未借此修改其它模块。
- 压测、真实权限变更瞬间与客户部署长期运行不在本次证据范围。T07 草稿回填、T32 通用写包装器、T33 其它写能力仍未开放；文件、多模态、RAG、会话全生命周期仍按主计划推进。

## 回退

不进行生产切换、旧数据迁移或旧 Agent 删除。回退时停止 V2 新任务/Worker，回退本批 API、core 描述符和前端改动；已有 V2 会话仍属于 V2，不路由给旧引擎重放。保留确认/effect/事件表与审计；本批无新增迁移，无结构回滚。

已确认保存的设计是业务变更，不自动删除/倒退版本；需要恢复设计时通过原设计器读取历史版本并按其现有保存流程操作，再同步存储/导航。未执行确认不应跨代码版本直接续写；旧预览缺失目标 hash 会冲突，重新读取并生成确认。开发服务本轮未被主动重启，运行时需按现有启动流程加载新 Rust 二进制。

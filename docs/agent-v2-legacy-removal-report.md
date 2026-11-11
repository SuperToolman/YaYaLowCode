# 旧 DSH Agent 移除报告

日期：2026-11-02。依据：用户明确要求移除旧版基于 DSH 的 Agent。本次修改替代此前阶段计划中“保留旧实现”的约束，不表示完整 AgentV2 已验收。

## 历史存储最终退役

2026-11-02 用户进一步授权“帮我清理干净”后，已完成本地旧数据退役。本节为当前结论；下文前三轮中“旧表 bootstrap、历史数据、工作区和表单绑定继续保留”的表述仅为当时操作记录，已被本节替代。没有远程执行生产数据库或部署操作，也没有暂存或提交仓库改动。

- 新增平台增量迁移 `m20261102_000105_retire_legacy_agent_storage`，并在实际本地数据库执行及重复执行。显式删除 agent_file_links、agent_files、agent_session_runtime_summaries、agent_transactions、agent_pending_actions、agent_run_steps、agent_runs、agent_messages、agent_sessions、agent_runtime_reset_markers、agent_definitions、agent_config_profiles、platform_agent_assistant_settings；不存在的表跳过，不使用 CASCADE 或前缀删除。
- 本机实际存在的旧表为 6 张，包含 4 条旧会话、4 条运行摘要、1 条 reset marker，其余为空；迁移后上述全部 13 个名称均不存在。删除 3 个 persona 资源及退休归档权限；保留 8 个共享 Skill、模型提供商和 V2 全部内容。
- 删除 main.rs 的 ensure_agent_tables 调用及其整个实现，删除应用删除服务中的旧会话解除引用及旧测试夹具。启动不再主动补建旧表；历史迁移身份不改写，升级完成后由最终迁移移除旧结构。
- 清除 158 个历史 form_schemas 版本中的 pageProps.agent，移除设计器和运行时对应 TS 合同；设计器 Schema 规范化和公共保存服务均过滤退休字段，恢复旧版本再保存不会重建旧绑定。既有待批准设计若依赖旧 hash，应返回冲突并重新预览，不绕过 hash 校验。
- 仓库根 agent/ 剩余 7 个 JSON 工作区文件全部移出，逐文件核对 hash；当前根目录 agent/ 不存在。V2 的 PostgreSQL 文件/工作区及员工安装资源目录保留。

**备份与数据核对。** 私有备份位于 `E:\OverPorject\.codex-backups\yaya-legacy-agent-20261102\data-retirement`，不进入发布包：`before-retirement.dump`、`quiet-before-retirement.dump` 为完整本地数据库 custom 格式备份，已用 pg_restore 列出目录并保存 SHA-256；`workspace-data/` 和 `workspace-manifest.json` 保存旧工作区；`source/` 保存本轮改动前源文件。`quiet-before.json` / `quiet-after.json` 保存表行数和内容摘要；最终结论为 `verification-final.json` 和 `preservation-after-live-use.json`，不输出客户数据或连接密钥。中间 verification.json 保留核对时的差异，不作为最终验收结果。

迁移后首轮核对中，15 张 V2 表的行数和完整行内容摘要一致，共享 Skill 和模型配置一致。服务在本轮核对期间重新启动，原有启动补全刷新了 app_navigation_items、form_storage_definitions、组织和管理员身份相关表的部分 updated_at；已从备份逐列对照，行数、ID 和其它列未变化，详见私有 `bootstrap-differences.json`，不能把这些表宣称为字节级完全不变。form_schemas 的退休属性和退休 RBAC 行是本轮明确执行的删除目标。

之后平台已有新的正常使用写入，V2 会话从 14 增至 15、消息从 28 增至 30、文件从 14 增至 16，共享 Skill 从 8 增至 9，因此最终总量指纹不再等于备份。为避免误判，追加按主键比对备份和当前数据：15 张 V2 表与 3 张共享资源/模型表中，退役前的全部原始行仍在，原始行各列内容未变；新增行独立保留，没有为“对齐备份”回滚或删除它们。最终状态核对中退休对象仍全部为零。

| 验证 | 证据与结果 |
| --- | --- |
| API 构建 | `cargo build --locked --offline`，legacy-storage-build.log，通过；保留既有编译警告 |
| 真实 PostgreSQL 退役安全测试 | `check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline -DesignOnly`，legacy-storage-tests.log：未知外键依赖使整个事务回滚，移除依赖后成功、重复执行安全、共享数据保留、down 明确拒绝；其后员工/私有会话/设计/预览/确认卡检查通过 |
| 共享应用删除回归 | 设置 AUTOMATION_TEST_DATABASE_URL 后运行 `cargo test --locked --offline modules::apps::delete_tests::delete_application_cleans_owned_graph_and_rolls_back_on_failure -- --ignored --test-threads=1`，legacy-storage-regression.log，通过；另有退休 pageProps 清理测试 1 项通过 |
| 前端 | legacy-storage-web.log：设计器 Schema 与独立性 2 文件 13 测试通过；legacy-storage-lint.log：本轮设计器及 runtime 类型文件 ESLint 通过 |
| 实际升级 | 私有 actual-migration.log、verification-final.json、preservation-after-live-use.json：迁移 105 已登记，重复 migrate-only 成功；旧表/退休资源/退休权限/历史 pageProps.agent 均无剩余，服务启动和实际新写入后仍保留原始 V2/共享数据 |
| 实际运行 | API 8788 /healthz 为 200，Web 8787 登录页为 200，Worker 日志 ready；8789/8790 无监听。当前代码已启动，未再次进行登录后的模型浏览器操作 |
| 全新初始化限制 | 当前数据库角色无 CREATEDB 权限；改用临时独立 PG18 实例时，initdb 在 post-bootstrap 阶段发生 Windows 0xC0000005，未运行到应用迁移。测试目录和进程已清理；保存 fresh-postgres.log，不能据此宣称全新安装通过，也没有为测试扩大账号权限 |

运行现有 `./scripts/start-dev.ps1` 即会先升级本地数据库再启动 API/Worker/Web；手工迁移使用已配置 DATABASE_URL 的 `api/target/debug/yaya-api.exe --migrate-only`。禁止在缺少备份时直接套用此破坏性退役步骤。升级后的旧表不是可恢复的数据容器；需要恢复旧会话时，必须从仓库外备份离线提取。

回退要求：先停止写入并备份回退时的 V2/业务数据，再恢复匹配旧代码及退役前数据库/工作区备份。迁移 down 故意返回不可逆错误；不可仅退代码让 bootstrap 重建空表，也不可直接覆盖退役后新增数据。建议先在独立库恢复旧备份再按需导出历史内容。本轮未修改生产库、远端镜像或历史 Docker 卷；旧备份、Git 历史和迁移身份属于恢复材料，不是仍在执行的 DSH 链路。

## 已移除与保留

已从当前项目移除 DSH gitlink 工作目录、旧 agent-assistant / agent-resources / agent-workbench feature、dsh-workbench-client、全局旧 RuntimeProvider、旧聊天页面实现及重复导航、旧归档页与入口、旧 Agent BFF、Rust agents/agent_files 执行模块和只属于旧运行时的实体映射、runtime 身份/员工/明文模型路由 HTTP 桥接、旧前端别名与专用 E2E 脚本。OpenAPI/生成 SDK 已删除旧会话和附件合同。旧实体数据库表及全部历史迁移保留，现有 ensure_agent_tables 历史引导仍供旧增量迁移兼容，不再注册运行接口。

`/agent` 仅作既有书签重定向到 `/agent-v2`。已删除的旧 API 不再有 handler 或 OpenAPI 合同；全局鉴权中间件可能先返回 403，未拦截时为 404，均不会执行旧业务。真实平台 Router 回归覆盖旧会话、列表、归档及三个内部桥接入口被拒绝。

保留：AgentV2 Rust/Rig/Cordis、Office helper、V2 自有组件及文件工作区；平台员工安装/更新/许可证、员工使用权/RBAC、模型 BYOM、通用 Skill/插件资源服务、设计器和平台业务服务。许可证中的 DSH 插件兼容 manifest 字段属于员工包兼容合同，不等于保留 DSH 执行服务。历史员工配置、数据库角色授权记录、业务表数据和旧文件目录未清理；退役归档权限从可分配目录移除，不删除数据库历史授权行。

## 明确的功能缺口

旧表单内聊天/草稿回填面板已替换为停用说明和 V2 工作台链接；设计器保留历史员工配置值并明确告知尚未接入 V2 草稿回填，不继续发出旧请求，不把单纯打开 V2 当自动迁移。旧归档页下线；V2 的会话搜索/归档/恢复/彻底删除仍按正式矩阵待验收。旧会话不会自动变成 V2 会话，历史数据暂不在 UI 中展示。RAG、完整插件市场、生产运行和未完成的浏览器链路也不因旧系统移除而视为完成。

## 本地备份与数据保护

旧 DSH 进程树在确认命令来自旧项目后停止，随后将整个工作目录（包括其 Git 元数据、本地修改及未跟踪文件）移至：

`E:/OverPorject/.codex-backups/yaya-legacy-agent-20261102/agent/deepseek-harness`

备份 HEAD 为 `141eb6fef8`。其余移除的旧模块位于该备份根目录下对应相对路径；主要修改文件的操作前副本位于 `modified/`。该目录在仓库和发布包之外，可能包含原有本地配置，须作为私有本地备份保存，不上传公开仓库。备份可恢复原有源码及脏工作区，不能只靠 gitlink 的提交号恢复本地修改。未执行清库、删除卷或删除历史附件。

旧会话过期文件清理和旧 reset 清理不再由 API 启动执行，避免继续运行旧数据删除逻辑。旧迁移本身没有重写。通用 Skill 新导入使用平台 YAYA_SKILLS_PATH 或 API runtime/skills，不再依赖 DSH_AGENTS_HOME；已安装员工包仍使用现有不可变安装路径，不重导入或改写已有员工包。

## 启动、部署与脚本

```powershell
.\scripts\start-dev.ps1
.\scripts\check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline
.\scripts\test-agent-v2-independence.ps1 -Offline
```

默认启动仅 API、AgentV2 Worker/Cordis/Office helper 和 Web。深度复核后，历史 SkipLegacyAgent、SkipDshBuild 开关及 start-dev-skipDshBuild.ps1 已一并移除；AgentPort 和 8789 就绪依赖已移除。SkipAgentV2 仅用于平台开发。开发启动不再注入旧运行时地址、WebSocket 和共享密钥。

Docker 单容器改为构建 Rust Worker/Office、安装独立 Cordis npm 锁文件，使用符合 Host 要求的 Node 24。Supervisor 运行 agent-v2，无 DSH 进程及 8789 端口。API/Worker 共用 YAYA_AGENT_V2_WORKER_SECRET；Compose、env 示例和 publish 初始化/就绪检查已更新。publish 不把旧 runtime 数据、V2 target、node_modules 或本地 V2 配置打入包。数据库迁移脚本暂停/恢复 agent-v2，防止数据库恢复期间 Worker 写入。

未改实际 deploy/.env 或客户密钥；现有部署升级需提供 Worker secret，publish 缺失时生成，已有值不覆盖。模型加密密钥不能轮换。现有安装包状态路径沿用原默认配置，未通过本次 Compose 变更重定位。旧 agent-state 卷不再挂载到新运行态，已有 Docker 卷不会自动删除，保留用于回退与取证；旧文件不迁入 V2 PostgreSQL 工作区。

## 验证证据

| 证据 | 范围 |
| --- | --- |
| agent-v2/target/legacy-removal-check.log | API cargo check 通过，无旧 DSH 源码 |
| agent-v2/target/legacy-removal-full.log | 完整 V2 检查通过：真实 PostgreSQL/平台 Router、授权/确认/提交/文件/设计、Worker 故障恢复、Office、Cordis；前端 7 文件/34 测试、限定 ESLint、HTTP 边界通过 |
| agent-v2/target/legacy-removal-openapi-tests.log | OpenAPI 合同测试通过，旧路径缺席，V2 submissions 保留 |
| agent-v2/target/legacy-removal-openapi.log / legacy-removal-codegen.log | 实际导出 OpenAPI 并生成 SDK |
| agent-v2/target/legacy-removal-shared-web.log | 公共 Markdown（改为测试 V2 包装）及设计器专项 12 测试通过 |
| agent-v2/target/legacy-removal-permissions-web.log | 权限目录专项 8 测试通过 |
| agent-v2/target/legacy-removal-lint.log / legacy-removal-final-lint.log | 改动的共享页面与旧入口替代说明限定 ESLint 无错误/警告 |
| agent-v2/target/legacy-removal-types-final.log | 全项目类型检查只剩既有 MyTable.test.tsx:66 错误，未声称全 Web 类型通过 |
| agent-v2/target/legacy-removal-independence.log | 独立源码构建和真实 Cordis 生命周期通过 |
| agent-v2/target/legacy-removal-startup.log / legacy-removal-startup-error.log | 默认 start-dev.ps1 启动通过：API 健康 200、Next 8787 ready、Worker ready；8789 无监听 |

全检查初次退役路径断言预期 404，但全局鉴权先返回 403；已按实际 Router 行为修正测试为 403/404，另以 OpenAPI 缺席验证合同已删除，最终完整回归通过。未将中间失败描述为全程通过。PowerShell 四个启动/发布/迁移脚本语法检查通过；Compose YAML、Supervisor 配置已解析校验。当前机器没有 Docker，未执行 Linux 镜像构建、生产迁移或线上发布。本轮没有重新做认证浏览器办公混合附件端到端验收。

日志在本机 target 内，长期发布前应另行归档证据。此次变更只退役旧实现；V2 功能与生产验收缺口仍须跟踪。

## 移除后复核

2026-11-02 再次检查：原 DSH 工作目录已不存在，没有匹配 deepseek-harness / yaya-agent-host 的 Node/Cmd/PowerShell 运行进程，8789 无监听；scripts、deploy、Web 包配置及 API Cargo 配置中未发现旧运行时地址、旧 feature 导入或旧 DSH 路径引用。`agent/runtime` 仅剩历史工作区的 7 个 JSON 文件，合计 14,539 字节，无旧运行时代码，保留不删除。Git 仍显示 `D agent/deepseek-harness`，表示受版本控制的旧 gitlink 已在工作区移除但尚未提交，本轮未代为暂存或提交。仓库外私有回退备份、历史数据/迁移和插件兼容合同继续保留。

## 深度链路复核与二次清理

复核日期：2026-11-02。上次“源码链路已清理”的结论不够完整：旧执行进程虽已退役，但仍发现下列源代码及实际 HTTP 入口。本次按调用方、路由注册、合同和部署依赖继续清理。

| 层次 | 发现与处理 |
| --- | --- |
| Next 中间层 | 删除仍能独立执行的 `/api/agent/development` GET/POST（旧组件/自动化目录、校验、通用补丁预览），删除无人调用的 agent-development-api.ts；它不是 V2 T31 安全设计接口 |
| TS 公共模块 | 移除旧 agent-development-contracts.ts 中的自动化目录和宽松补丁执行器；现用 Excel 导入/表单组件能力依赖的组件元数据提取至 form-component-contracts.ts，保留现用业务语义与测试 |
| 表单运行页 | 删除 FormAgentPanel、旧 agentDraftValues/agentValuePatch 状态、回填回调、布局分支及员工提示词/字段传参；普通表单草稿仍通过 setDrawerValues 更新 |
| 设计器 | 原 AgentPanel 改为明确的 AgentV2Panel 跳转说明，删除无效 onChange 合同；不宣称已经实现 V2 内嵌聊天或草稿回填，历史 pageProps.agent 数据仍保留 |
| Rust 后端 | 删除未被 V2/平台页面使用的 `/api/agent/plugins` CRUD、DTO、旧 HTTP endpoint manifest 校验器及专用资源帮助函数；不影响员工签名包和独立 Cordis Host |
| 缓存/权限中间层 | 删除仅写入无读取的 agent-runtime:version 通知；缓存分类删除 profiles/agents/plugins/skills 旧路径；删除赋予未知旧 Agent URL 模型管理权限的通用匹配 |
| OpenAPI/SDK | 删除旧插件 CRUD 合同后重新导出与生成，不手工修补 SDK；补充退休路径缺席断言和真实 Router 拒绝测试 |
| 启动/目录 | 删除 start-dev-skipDshBuild.ps1 和两个无效 skip 参数；删除 API agent 目录中 config-profiles/personas/knowledge-bases/platform-tools/plugins/skills/providers 等空目录，不删除任何数据 |
| 防回归 | 将旧模块导入/端点依赖扫描从 V2 目录扩大到整个 app/features/components（包含生成 SDK）；增加旧源码和入口文件不存在断言 |

依赖追踪确认继续保留的内容：

- `/agent` 是到 `/agent-v2` 的书签重定向，无旧页面实现；当前导航仅有 AgentV2。
- `/api/agent/providers` 和 `/api/agent/system-ai/status` 属于平台模型配置/可用性服务；员工包安装和 Skill 资源发布仍被当前市场与 V2 使用，不是 DSH 桥接。名称含 agent 不作为删除依据。
- `PlatformAiEmployeeSkill.plugin_manifest_json` 是运营中心签名包兼容字段；V2 独立 Cordis 与 DSH 插件包兼容不等于运行旧 DSH。
- `main.rs` 的 `ensure_agent_tables` 历史 bootstrap、历史增量迁移及应用删除时解除旧 agent_sessions 应用关联仍是保留的数据库兼容代码；启动仍会确保旧表/摘要结构，不能宣称已删除全部旧表维护。它们不注册聊天/工具 HTTP 接口，也不调用 DSH。彻底删除这些表和兼容代码需单独的数据退役方案，本次不删历史数据或重写迁移。
- 通用 `migrate_legacy_runtime_layout` 处理数据库/许可证/通知/上传路径升级，不包含 DSH 路径，继续保留。BACKEND_INTERNAL_TOKEN 与 require_internal 仍供钉钉身份配置 BFF 使用，不是 DSH token；V2 直接复用 BYOM 解析函数，保留的 RuntimeModelRouteQuery 类型没有对应旧 HTTP handler。
- 历史工作区 7 个 JSON、私有仓库外备份、Git 历史和尚未提交的删除记录继续保留。旧 agent-state Docker 卷不再挂载，未删除现有卷。

扫描范围包含应用源代码、前端 BFF/SDK、后端路由/授权/缓存、启动和部署、Next/Tauri 配置、包清单及锁文件。锁文件 hash 中偶然出现 dsh/8789 字符片段不是包依赖。实际本地 env 仅检查变量名，不输出密钥；未发现 DSH/AGENT_RUNTIME/旧 Agent 地址或端口键。历史 docs/CHANGELOG、负向测试和退役说明保留，不把全文零命中当作功能退役标准。

本次操作前副本位于外部备份根目录的 `deep-audit/`。未暂存、提交、清库或发布。

### 本轮验证证据

| 本机日志（agent-v2/target 下） | 实际结果 |
| --- | --- |
| legacy-deep-audit-openapi.log | 3 个 OpenAPI 测试通过，含实际导出；旧插件/会话合同缺席，V2 submissions 保留 |
| legacy-deep-audit-codegen.log | 使用 pnpm run codegen:api 成功重新生成 SDK；先前猜测的 CLI 文件路径不存在，已改为项目正式命令 |
| legacy-deep-audit-full.log | check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline 完整通过：真实 PG/Router、退休路由、员工包安装更新、提交/文件/设计/权限/确认、Worker 恢复、Office、真实 Cordis、前端 7 文件 35 测试、ESLint、HTTP 边界 |
| legacy-deep-audit-shared-web.log | 6 文件 46 测试通过，包含全前端独立性、现用组件合同、表单 Excel 转换、设计器 Schema 和布局组件 |
| legacy-deep-audit-lint.log | 本轮修改的公共组件、表单页面、设计器及独立性测试 ESLint 通过 |
| legacy-deep-audit-types.log | tsc 仅报告此前 MyTable.test.tsx:66 子行类型错误，未声称全项目通过 |
| legacy-deep-audit-startup.log / legacy-deep-audit-startup-error.log | 实际无 skip 开关重新构建启动：API 8788 健康 200、V2 Worker ready、Next 8787 ready；实际旧 development BFF 404 |

中间失败如实记录：扩大的前端扫描首次捕获尚未重新生成 SDK 中的旧插件合同，生成后扫描通过。单独用 settings_employee_tests 名称过滤的命令没有选中测试，不作为员工市场验证证据；真正的 employee_package_tests::verify 已被完整 API 员工集成测试调用并通过。

实际启动后再次读取 API OpenAPI：V2 submissions 存在，旧 plugins/sessions 不存在；没有旧 DSH 进程和 8789 监听。PowerShell 启动脚本解析、限定 git diff --check 通过。此次未重新进行登录后的真实模型浏览器操作、Docker/Linux 镜像或生产部署验收。

## 历史清单交叉复核（第三轮）

2026-11-02 从仓库外移除前备份提取实际路由和旧 Agent 模块公开函数，再与当前源代码逐项对照。机器可读结果见 [agent-v2-retirement-audit.json](agent-v2-retirement-audit.json)，后续测试使用仓库内 [retired-agent-routes.json](../agent-v2/fixtures/retired-agent-routes.json)，不依赖本机备份目录。

- 原路由注册中的 26 条旧 Agent 路径全部缺席，保留的旧命名路径仅 `/api/agent/providers`、`/api/agent/providers/{id}`、`/api/agent/system-ai/status` 三项公共模型服务。
- 原 agents/mod.rs 的 18 个公开异步函数在当前 Rust 源代码中均无引用；TS/JS 包和 Cargo 清单无 DSH/Harness/LangGraph 依赖。
- 对前端实时连接单独追踪：Agent 仅连接 V2 SSE；现用 WebSocket 属于平台 IM 聊天，不是 DSH 会话连接。钉钉的 agent_id 是钉钉应用字段。
- 实际页面和组件只剩 `/agent` 重定向、V2 自有组件、设计器 AgentV2Panel 说明；历史 pageProps.agent 保存兼容值，不再驱动旧表单对话和回填。

本轮进一步修正的遗漏：

| 文件 | 处理 |
| --- | --- |
| deploy/compose.yaml | 删除没有读取方的 YAYA_AGENT_SETTINGS_PATH，保留现有磁盘状态文件不删除 |
| deploy/publish-web.ps1 | 就绪检查与交付 URL 改为 /agent-v2，不再用旧入口重定向判断新版页面 |
| deploy/publish.ps1 | 从打包顶层输入中排除整个旧 agent 目录，防止本地意外恢复旧源码后被重新发布；继续包含 web/app/api/agent/v2 |
| README.md、deploy/README.md | 清除当前推进说明中的 LangGraph、pg-boss、Cordis 模型请求等旧架构描述，改为 Rust Worker/Rig/PostgreSQL；历史 CHANGELOG 不改写 |
| .gitignore | 删除失效 LangGraph __pycache__ 规则；历史私有 Agent 设置忽略规则继续保留，避免泄露旧密钥 |

路由验证加强为 31 条退役路径（含原路由、BFF 和别名）× GET/POST/PUT/PATCH/DELETE，共 155 次请求。测试在独立 PostgreSQL schema 内使用真实管理员角色、真实签名测试许可证和本地许可证状态 HTTP fixture，经过真实平台鉴权/许可证中间层，不接受 403 作为“接口已删除”的证据，也不修改客户许可证。原来较弱的普通用户 GET 403/404 断言已替换。OpenAPI 缺席断言同步使用同一清单。

打包实测中发现，当前 Windows tar 的排除模式即使写作 `--exclude=./agent` 也会误排除嵌套的 `web/app/api/agent`。已改为枚举仓库顶层输入并跳过旧 agent 根目录；实际 tar.exe 的隔离样例验证旧源码和历史工作区未入包，V2 API 和 Rust 源码完整保留。未执行发布脚本的 SSH/上传/远端重启。

新增检查初次因测试许可证配置指向不可访问的本地端口而返回 403；保留初次日志 legacy-route-audit-api-initial-license-gate.log，随后通过本地状态服务让真实签名校验链路通过后再验证路由。此次检查没有放宽生产鉴权或许可证逻辑。

本轮验证结果：

| 证据 | 结果 |
| --- | --- |
| legacy-route-audit-api.log | DesignOnly 检查通过；真实 PG/平台 Router 完成 155 次管理员请求，全部严格 404；其后员工/提交/文件/确认/设计集成流程、7 项设计合同、预览测试和确认卡 3 测试通过 |
| legacy-route-audit-openapi.log | OpenAPI 合同测试 2 通过，显式生成项按默认忽略；31 条退休合同全部缺席。本轮未改变实际 DTO，因此不重复生成 SDK |
| legacy-route-audit-next.json | 实际本地 Next BFF 同一清单 155 次请求全部 404，无失败；独立于 Rust Router 测试 |
| legacy-route-audit-web.log | 全前端独立性、退休文件缺席及启动/部署无旧接线检查共 3 测试通过 |
| legacy-route-audit-lint.log | 修改的前端防回归测试 ESLint 通过 |
| legacy-route-audit-packaging.log | 真实 tar.exe 隔离打包通过，根目录旧 Agent 不入包，嵌套 V2 BFF 和 Rust 源码保留 |

PowerShell start-dev/publish/publish-web 解析通过，Compose YAML 校验通过，限定 diff 空白检查通过。源代码清单无新增 DSH 运行依赖，当前 8789/8790 无监听。本轮没有再跑完整 Worker/Rig/Office 测试（上轮完整检查已通过，相关实现本轮未改动）；未构建 Docker 镜像或执行生产发布。

操作前备份：原私有备份根目录的 route-audit/。本轮不修改历史数据、增量迁移、旧表 bootstrap 或旧文件；不暂存、提交或部署。当前运行服务无需因本轮仅部署配置、文档和测试代码修改而重启。

## 回退步骤

停止新开发/生产进程，使用本地备份的原代码、旧前端/API/配置恢复到匹配版本。DSH 工作目录备份应完整移回，不覆盖期间新增的同名目录。数据库、旧附件目录和原 Docker 卷仍保留；不要为了回退 down migration、清空 V2 表或删除正式 V2 文件。生产回退需恢复匹配镜像与卷挂载，先备份数据库及现有运行状态；旧实现不会自动认识 V2 会话。此轮未部署线上，无线上镜像或数据库替换。

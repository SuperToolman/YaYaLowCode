# AgentV2 本地脚本与会话依赖环境实施报告

日期：2026-11-03。基线提交：`949b8a2` 加当前工作区修改。当前合同替代早期 Docker 执行与依赖镜像预准备规定。本次没有恢复 DSH，没有新增迁移，没有删除或迁移旧执行状态、正式工作区文件或业务数据。

## 执行合同

默认 Rust manager 直接启动当前账户的本地进程。Windows 终端优先 PowerShell 7、缺失时 Windows PowerShell；Linux 为 Bash。Python、Node、`.ps1`、`.sh` 和内联代码入口保留。

Agent 先读取 Skill，再运行脚本；遇到实际缺包结果，通过新的 `workspace_execute_code(language="shell")` invocation 安装，然后再次提交原脚本。manager 不推断包名、不自行安装、不自动重试失败脚本。每次调用新进程，Shell 变量、激活状态和 `cd` 不延续；文件和依赖延续。`outcome_unknown` 不允许自动重复。

**这是会话环境分离，不是系统级隔离。**脚本可访问当前账户可访问的文件、网络、进程和平台存储。最小环境变量、Job Object、进程组与日志脱敏不构成恶意脚本沙箱；Shell 也不能强制落实平台业务工具的 RBAC、写入确认或事务语义。单容器内的脚本同样拥有应用账户权限。

## 持久状态与并发

- API 从已授权 run 生成 `deploymentId/userId/employeeId/sessionId`；模型无法指定 scope、宿主目录、解释器或环境覆盖。
- 根目录默认 `agent-v2/runtime/executions`，四级会话路径使用部署/用户/员工 hash 和会话 UUID，完整 `scope.json` 校验身份。缩短路径解决 Windows venv 长路径问题；Node 子进程使用不带 Windows verbatim 前缀的路径。
- 会话保留 `workspace`、`python` venv、`workspace/node_modules`、`workspace/skills/<资源版本hash>`。每次 job 保留独立 input/output/tmp 与执行记录；job 以 invocation UUID 定位，并在记录中绑定 scope。
- 首次 Python 或可用 Python 的终端调用建立 venv；仅 Node 调用不要求 Python。venv 成功标记防止初始化中断后误认为已经完整就绪。终端 PATH 优先会话 venv，`python -m pip` 安装到该环境。
- workspace 首次调用即建立私有 `package.json`，阻止 npm 向上寻找平台项目作为安装根。依赖应安装到本会话 `node_modules`；Node 本身仍可能读取账户可访问的祖先模块，这不是安全隔离承诺。
- 同会话互斥、全局最多两个调用；manager 独占根目录文件锁，禁止两个 manager 同时管理同一环境。执行 ID 去重、内容冲突、epoch 和终态保护保留。
- Windows Job Object 终止子进程树；Linux 使用进程组及独立 supervisor，manager 管道关闭时清理普通后代。Linux 实际运行尚未验证；主动逃离进程组的程序不受安全隔离保证。
- 重启将未确认完成的 queued/running 调用记为 `outcome_unknown`，不会重放。旧合同调用不会切换为新命令重新执行。员工更新不清空会话目录。
- 新任务冻结 Skill 资源定义、路径及内容 hash；快照不含 `environmentValues`。更新后仍读取已冻结的旧资源。当前 Skill 被撤销、配置 hash 改变或冻结资源被改写时拒绝继续，要求重新提交。旧快照无法证明冻结资源时保留原版本检查，不直接扩权恢复。

## 员工安装与页面

安装/更新仅验证与保存员工、Skill 资源和依赖声明，不调用 pip/npm，不要求 manager 在线。requirements.txt、package.json 可单独存在，锁文件可选，也可以不声明依赖。

`scriptRuntimeReady` 只为旧客户端保留，不作为安装成功、使用权或执行授权依据。脚本执行改为精确能力 ID `skill_run_script` 和 `workspace_execute_code` 检查，不能由读取、通用包装器或通配暗中获得；运营中心目录已补齐两个选项及本地执行风险文案，没有自动修改任何商品勾选。现有员工要执行并安装依赖，需发布包含两个能力的新包，再通过正常市场更新，并提交新任务；旧任务快照不自动增加工具。市场显示已安装/最新版本、按需依赖声明和本地解释器检查；同版本按钮为“检查执行环境”。旧准备诊断标为历史；新版不可用诊断不被误当历史。检查失败不卸载员工或覆盖原有效包。

Skill 配置只注入本次选中的 Skill 进程，不写入模型提示词、快照或公共配置文件。子进程环境从白名单重建，不直接继承数据库连接、JWT、BYOM 密钥等 API 环境。stdout/stderr 合计最多 1 MiB，已知配置值脱敏，UTF-8 游标分页，每页最多 16 KiB。模型摘要每流最多 4096 字符，重试读取已有结果也采用同样限制。

新增已授权会话接口：`GET /api/agent/v2/sessions/{sessionId}/executions/{executionId}/logs?stream=stdout|stderr&offset=N`。OpenAPI 和生成 SDK 同步，沿用 Next BFF。V2 执行卡支持查看日志、截断与错误提示、卸载时取消读取。只有明确 output 目录中的合规产物经原事务规则进入正式会话工作区。

## 启动、发布与维护

```powershell
# 正常开发；先退出旧版本的、由启动脚本管理的进程再重新启动
.\scripts\start-dev.ps1

# 默认检查本机 Python/Node/终端，不再检测 Docker
# 可在 agent-v2/.env 配置解释器绝对路径：
# YAYA_EXECUTION_PYTHON / YAYA_EXECUTION_NODE / YAYA_EXECUTION_SHELL / YAYA_EXECUTION_BASH

cargo build --manifest-path agent-v2/Cargo.toml -p yaya-agent-v2-executor --offline --target-dir agent-v2/target/dependency-alignment
.\agent-v2\scripts\test-local-executor.ps1
```

真实验收脚本只启动并停止自己的随机端口 manager，测试状态保留在同级目录 `.yaya-execution-tests/live-*`，不操作正式员工包或客户业务数据。也可对显式配置的测试 manager 使用 `test-executor-live.ps1`；该脚本会联网安装测试依赖。

管理员显式重建单个环境：

```powershell
# 从管理员终端设置测试/目标 manager URL 与凭据，不向模型或日志暴露凭据
.\scripts\reset-agent-v2-session-environment.ps1 -DeploymentId <uuid> -UserId <uuid> -EmployeeId <id> -SessionId <uuid> -ConfirmReset
```

manager 校验无活跃/排队执行、完整 scope 和最终路径后才删除指定会话依赖与本地工作目录；保留数据库正式消息、正式文件与执行历史。不自动清理其他环境。

发布镜像包含 manager、Python/pip/venv、Node/npm/Bash，Supervisor 启动本地 manager。Compose 已移除执行容器、runtime 构建及 Docker socket；旧执行器 volume 声明已移除，未对宿主执行 volume 删除命令，历史数据没有删除。平台自身仍可使用 Docker 部署，这与脚本不再启动嵌套容器是两件事。Linux 镜像构建和发布实测尚未完成。

## 已执行的验证

| 验证 | 结果与证据 |
|---|---|
| 独立 manager Windows HTTP | `agent-v2/target/local-execution-live.log`：缺 openpyxl → pip 安装 → Excel + 文本产物；缺 exceljs → npm 安装 → 模板 Excel；CommonJS/ESM；脱敏；重复 ID；参数冲突；旧 epoch；取消；120 秒超时；manager 重启 unknown 不重放；重启后 Python/Node 依赖继续可用 |
| 真实测试范围 | 部署 `82e8dbe2-256a-43a4-8e6c-73e1e59e7229`，会话 `9e67b508-33ba-4de6-b011-67fc32c17ee4`；测试状态 `E:/OverPorject/.yaya-execution-tests/live-babe25e4`。仅 manager 合同测试，**没有经过真实模型** |
| Executor 自动化 | 8 例实际执行、0 跳过；实际 pip/npm 离线安装 fixture、环境复用、配置脱敏、最小环境、取消、作用域/epoch/损坏状态拒绝、UTF-8 日志分页、互斥及维护拒绝活跃会话。`local-execution-tests.log` |
| API 定向 | 2 例通过：路径逃逸拒绝；员工元数据/Skill 更新仍使用冻结版本、快照无配置值、撤销或配置变更拒绝。`local-execution-api-tests.log` |
| PostgreSQL 分层 | `check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline -DesignOnly` 通过，随机隔离 schema；含员工安装在 executor 不可用时仍成功、安装不调用准备服务、许可证/版本/资源回归、设计及配置测试。不是全新数据库验收。`local-execution-database.log` |
| Rust workspace | 33 例通过，5 个需隔离 PostgreSQL/真实 Worker 的 ignored 用例在此条命令未执行，不将其计为通过。Office 实际进程用例已运行。`local-execution-workspace-tests.log` |
| 完整统一检查 | `check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline` 最终通过：Rust 按命令合计 84 次通过；宽过滤的一条 ignored 共享记录测试随后显式执行通过；Cordis 3 条、空库防误用 4 条、启动归属检查以及前端 10 文件 46 例。真实 Worker 故障恢复与隔离 PostgreSQL 用例实际执行；假模型不当作真实模型通过。`local-execution-full-check.log` |
| 能力目录 | core 能力测试 6 例、运营中心目录 2 例通过；运营中心 TypeScript 检查通过。`local-execution-capabilities.log` / `local-execution-operation-catalog.log` / `local-execution-operation-tsc.log` |
| Web | 8 文件 32 例通过，含日志读取与取消、市场状态、会话历史与发送恢复。`local-execution-web-tests.log` |
| 合同/静态 | API check、OpenAPI 导出、SDK 生成、HTTP 边界通过；定向 ESLint 无错误，有既有 img 警告。全量 tsc 仍有 `MyTable.test.tsx:66` 既有 children 类型错误，不标全量类型检查通过 |

上述日志均在 `agent-v2/target/`，可能被构建清理；本报告保存结果摘要。实际包下载过程中出现 PyPI 网络重试，最终成功；不将网络重试表述为自动重跑业务脚本。

## 未通过门槛与后续

1. 尚未通过真实浏览器/BFF/API/Worker/Rig，让模型自行决定安装并重跑；两个正式 BOM 员工的市场更新也未在本轮实际操作。当前已有浏览器标签显示“无法访问此站点”，进一步读取被浏览器策略拦截，未绕过。原始 Skill 目录未修改、正式安装包未手工修改。
2. Linux 发布镜像、supervisor 崩溃后的进程树、完整停止与产物收集需在 Linux 实测，当前不标跨平台全部通过。
3. 本轮未重新启动用户的整套开发服务，避免混停无关服务；需要正常退出当前开发脚本后重新启动以加载新版 API/Worker/manager/Web。
4. 无 Docker 不再阻断 Windows 本地脚本；Linux 容器部署、完整真实模型验收和现有全新数据库门槛继续保留。P5-09 仅标实现与本机分层/执行器真实链路通过，未标完整 AgentV2 或生产安全验收完成。
5. npm 根目录边界修复前的测试留下了根目录测试 npm manifest/lock 与下载缓存。自动审批拒绝清理；没有继续批量删除已有 node_modules，也没有建立旧内容备份。它们不用于新会话依赖定位。

回退先停止新 manager 并保留所有会话目录、执行历史与正式文件。旧合同环境不可直接自动重放为本地调用；若回到旧执行方式，必须逐个核对不确定结果，不能用回退清除终态或重复业务副作用。


## 旧运行器移除复核（2026-11-03）

已移除旧 environments 镜像预准备实现、任务容器启动/输出收集、runtime 依赖清单和镜像文件；此次继续删除 executor 独立 Dockerfile、Compose 旧执行器卷声明和无调用方的强制锁文件错误分支。三个旧专项报告改为当前合同入口，不再保留可误用的旧容器启动教程。平台发布 Dockerfile.single 继续用于整个平台部署，内含当前本地 manager，并非旧任务容器。

保留 scriptRuntimeReady 兼容字段、历史诊断识别以及测试中 /environments 禁用探针（用于证明安装不调用旧准备接口），它们不启动旧执行器。未迁移或删除历史执行记录、依赖环境、正式工作区或客户数据，没有建立备份。

旧源码目录中仅剩 `executor/runtime/__pycache__/test_collect.cpython-313.pyc` 测试缓存；删除该指定文件及空目录被自动审批拒绝，未绕过。缓存没有被任何启动、构建或执行路径引用，不属于可运行后端，不能声称磁盘残留全部清零。


## Windows 启动占用修复（2026-11-03）

实际发现本仓库 target/debug Worker 进程仍在运行，但 worker-process.json 不存在，导致旧脚本跳过停止并在 Cargo 替换 exe 时得到拒绝访问。启动函数现增加完整 exe 路径与进程创建时间核验；仅回收当前构建输出的 Worker，保留其它路径的进程，身份无法读取时明确拒绝。构建入口重复执行此检查，并检查 Office helper 占用。已有记录的 PID/时间不匹配仍拒绝停止。

实际停止已核验的残留 Worker 后，原 Worker/Office Cargo 构建成功。新增 test-agent-v2-build-owner.ps1 验证缺记录恢复、其它项目进程不停止、身份不可验证拒绝、无残留进程；PowerShell 7 与 Windows PowerShell 均通过，已纳入统一检查。本次未启动整套 Web/API 服务。

## 执行步数与对话时间线修复（2026-11-03）

真实 run `41d5d5d6-ef6b-416d-8d5b-3950640fd457` 的 checkpoint 显示：第一次 skill_run_script 因 openpyxl 缺失退出 1，后续独立 workspace_execute_code 已成功安装；之后多个文件/路径/配置探查退出 0。任务最终在 12 次模型步骤后被 step_budget_exceeded 停止，不能把后续成功探查当成 BOM 整理已完成，也不能将终止归因于环境未安装。原任务未自动重跑或修改。

Worker 默认 YAYA_AGENT_V2_MAX_STEPS 改为 48，显式环境配置优先。每次模型请求提示剩余步数、每调用输入/输出目录变化、输入文件位于 <fileId>/<原文件名>、每次需要附件均须提交 fileIds、选定 skillId 才注入对应资源和配置，以及缺包安装后重跑原脚本。不得打印配置值，outcome_unknown 仍不得自动重试。默认预算增加不能保证任意任务成功，也未验证原 BOM 完整产物。

Windows Python 子进程明确设置 PYTHONUTF8=1/PYTHONIOENCODING=utf-8，避免输出按本机编码产生乱码；真实子进程测试新增中文文件名输出验证通过。

前端按持久事件顺序生成说明/工具时间线，保留每模型步骤的可见文本，重试只替换同一步骤未提交文本，不展示私有推理。step.completed 保存有界可见正文；历史分页在单条查询中从旧 response_snapshot 补齐旧事件缺失正文，无迁移、无历史数据改写，终态仍过滤大量 token delta。已结束任务刷新后恢复说明与工具顺序，最终正文避免重复显示。工具状态继续从执行记录恢复。

验证：执行器 8 项通过（缺包安装、依赖保持、Node CJS/ESM、取消、日志与归属），追加中文输出定向 1 项通过；Worker 非数据库 5 项通过，真实 PostgreSQL 随机 schema + Rig 假供应商 + 真实 Cordis 综合 1 项通过，新增历史文本保存和旧事件回填断言。前端 runtime-core/ConversationViewport/AgentExecutionLogs 共 15 项通过，定向 ESLint 通过。API 编译与 OpenAPI 导出测试 1 项通过。全 Web tsc 仍仅报告既有 MyTable.test.tsx:66 children 类型错误。本次未在浏览器实测完整 BOM 交付，也未执行原任务或改动 Skill 配置。生效需要重启 API/Worker/execution manager；前端刷新。

## 任务执行规则更新（2026-11-03）

当前任务不再有累计运行预算、模型请求配额或阶段步数上限；前文 48 步、12 小时、1000 次的说明已失效。脚本保留每次 invocation 的冻结超时／deadline，取消累计剩余时间裁剪。缺包安装和原脚本重跑由模型在同一任务内继续，用户无需点击继续。当前上下文回归、持久恢复及验收范围见[长任务报告](agent-v2-long-task-report.md)。

> 2026-11-06 三类知识库管理增量：应用基础设置、全局设置与运营中心员工知识入口已编码，含原件/版本管理及员工更新同步合同。仅编译和静态检查，真实数据库/安装链路待手测；解析、索引和 RAG 尚未接入。详见[本批实现记录](agent-v2-knowledge-management-report.md)。

> 2026-11-06 知识库专项设计：已确定应用、全局、AI 员工自带三类知识库，详见[知识库与 RAG 架构设计](agent-v2-knowledge-rag-architecture.md)。文档覆盖权限、员工包同步、版本与索引、混合检索、重排和引用；当前为目标规格，尚未实施或验收。

> 2026-11-06 会话分叉增量：B05 已实现已完成回复边界、独立消息/文件副本、请求幂等和历史快照展示；不复制执行状态、授权、确认或业务效果。仅编译/静态检查，真实数据库及用户验收待完成，详见[分叉记录](agent-v2-fork-report.md)。

> 2026-11-06 会话管理增量：已实现改名/置顶、服务端搜索分页、归档设置页 `/settings/agent-archives`、单条与批量恢复/彻底删除及持久清理链路。尚未运行数据库或用户链路验收，不据此标记完整生命周期通过；范围与手测步骤见[实施记录](agent-v2-session-lifecycle-report.md)。

> 2026-11-06 当前阶段安排见[现阶段开发计划](agent-v2-current-stage-plan.md)：包含当前能力、后续顺序和用户最新规则；下文历史要求不代表全部仍生效。

> 2026-11-03 当前执行合同：默认当前账户本地子进程；会话持久 Python venv/Node 依赖；锁文件可选，员工安装不运行 pip/npm。`scriptRuntimeReady` 仅兼容，不代表执行许可。Windows 执行器真实链路已通过，真实模型和 Linux 发布链路尚未通过。此规则取代下文历史 Docker/镜像预准备要求，详见[本地执行报告](agent-v2-local-execution-report.md)。

> 2026-11-02 最终退役更新：按用户最新决定，旧 DSH Agent 源码、运行入口、旧表 bootstrap 和应用删除兼容链路已移除。本地数据库已执行增量迁移 `m20261102_000105_retire_legacy_agent_storage`，移除旧会话/文件/运行表、退休资源及权限，并清除历史 Schema 的 pageProps.agent；7 个旧工作区文件已移到仓库外备份。历史迁移身份保留，V2/员工/Skill/BYOM 继续使用。本文早期保留旧链路和旧数据的约束被本更新替代，生产库未远程操作。证据、备份与未验证项见[移除报告](agent-v2-legacy-removal-report.md#历史存储最终退役)。V2 未验收能力不因此标为完成。


> 2026-11-02 规划复核：本文是目标架构，不是全部实现声明。当前能力、代码证据、未完成项及用户后续调整见[规划达成情况复核](agent-v2-progress-review.md)。前端历史分页不等于模型上下文压缩；真实 Cordis 内核不等于插件市场完整接入；旧链路退役不等于 V2 功能全面验收。

# YaYa Agent V2 架构与开发规格

2026-11-03：员工安装环境诊断独立持久化，市场可查询各Skill依赖与准备状态；重试使用已安装资源，更新失败不覆盖原已就绪包。新增接口与边界见[依赖市场报告](agent-v2-dependency-market-report.md)。

2026-11-02 验收补齐更新：执行器已有任务目录的状态损坏/缺失必须拒绝重新执行，重启结果不确定不得被晚到结果覆盖；开发端口重启须验证进程属于当前仓库。新增空库/容器验收入口及实际环境限制见[验收补齐报告](agent-v2-acceptance-closeout-report.md)，不据分层测试推定真实模型、Docker或全新安装已通过。

前端组件独立迁移与剩余链路见[前端迁移记录](agent-v2-frontend-migration.md)：已接入消息、Markdown、工具卡、会话项与独立 V2 runtime；文件产物、归档和资源管理等未完成后端合同的能力仍属待开发，旧系统已按退役更新移除，上述未完成项仍须继续验收。

文档日期：2026-10-28。状态：完整 V2 设计规格，首批独立执行链路已部分实施。配套文档：[开发计划](agent-v2-development-plan.md)、[能力清单与验收矩阵](agent-v2-acceptance.md)。本文的“必须”是开发与发布约束，“建议”是待验证的技术选择。已实现范围及实测证据见[首批实现记录](agent-v2-first-slice-report.md)，未列入完成证据的能力仍属于目标设计。

部署决议：一客户一套独立平台，不引入商业多租户或租赁计费。本文的隔离范围以当前平台部署为界；现有身份/BYOM 的 `tenant_id` 兼容字段不代表新建租户系统。“任务执行锁与心跳”（实现字段 `lease_*`）仅用于 Worker 临时占用任务、防止失效执行者提交及崩溃恢复，与客户购买方式无关。用户与 AI 员工的 RBAC 和会话隔离在每套平台内生效。

## 1. 目标与不可改变的约束

在旧 Agent 保持功能、代码和默认入口可用的前提下，新增一套独立的 YaYa Agent V2。以生产质量为优先，不以短期交付速度为架构依据。先实现、测试、试运行和分批切换，最后移除旧 DSH Agent。

1. Agent 运行核心使用 Rust，模型与 Embedding 适配使用 Rig。
2. 使用真实 Cordis 内核管理 JavaScript 插件的依赖注入、注册和生命周期，不用一个同名自研 Rust 插件容器冒充 Cordis。
3. 支持 DSH 插件市场的包发现、授权、安装元数据和按包适配；不复用旧 DSH Agent 的任何执行能力。兼容性按明确包与版本验收。
4. 保留运营端到客户平台的 AI 员工购买、授权、安装、更新、移除、过期和撤销链路。
5. 保留员工 Persona、Skills、能力目录、客户自有模型与密钥隔离；业务资源范围由使用者 RBAC 决定，不给员工另配应用 ID。
6. 保留工作区、附件、产物、平台工具、用户 RBAC 与数据范围约束；RBAC 明确分配用户可使用的 AI 员工，会话按“平台部署 + 用户 + AI 员工”隔离。
7. 支持会话搜索、置顶、重命名、归档、恢复、分叉、彻底删除及历史导入。
8. 支持文本、图片、文件混合发送，附件预览、处理状态和模型能力检查。
9. 支持 RAG、知识库检索、会话检索、实时业务检索和授权后的联网检索。
10. 保留当前 Agent 的交互与工具能力；对仅在旧 README 中宣称、未验证的能力也必须盘点，不得直接省略或宣称已经支持。
11. 新系统在旧 `agent/deepseek-harness` 不存在、旧进程停止时仍能独立构建、启动和完成全套 V2 验收。

## 2. 现状证据与设计依据

当前 Rust API 为 Axum + Tokio + SeaORM + PostgreSQL，`api/Cargo.toml` 已声明 `rig-core = "0.40.0"`，本轮检查未发现业务源码中实际使用 Rig。版本仅表示当前依赖，不代表已经通过 V2 验证。

| 当前位置 | 可确认职责 | V2 处理 |
| --- | --- | --- |
| `api/src/modules/settings.rs` | AI 员工市场、安装定义和运行配置 | 保留商业链路，提取可共享应用服务 |
| `api/src/platform/license.rs` | 员工及插件授权包、签名与有效期 | 保留授权事实，新增运行协议版本和兼容报告 |
| `api/src/modules/agent_config.rs` | 模型路由、插件资源、Skill 安装 | 复用通用服务，隔离旧 Host 专用接口 |
| `api/src/modules/agents/` | 会话、运行摘要、写入确认事务 | 保留旧接口，V2 新增独立实现与版本化数据 |
| `api/src/modules/agent_files.rs` | 上传、关联、下载和产物登记 | 提取存储服务，补足所有权与引用生命周期 |
| `web/features/agent-workbench/` | 目录、会话状态、命令与事件 | 保留旧路径，增加 V2 客户端适配 |
| `web/features/agent-assistant/` | 消息、工具、图片和文件展示类型 | 可复用纯展示，重新验证协议与交互 |
| `web/app/lib/agent-development-contracts.ts` | 表单组件与自动化节点能力描述 | 作为平台 Schema 合同来源之一，不复制成第二份手写常量 |
| `agent/deepseek-harness/packages/extensions/yaya-*` | 旧身份绑定、工具、宿主和网关 | 只用于行为盘点，不能成为 V2 运行依赖 |

旧实现已观察到动作级权限合并、删除确认路径未统一、恢复绑定 sessionId、逐帧请求会话目录等问题。详细触发条件必须在 P0 形成可复现用例，V2 不能继承这些流程。现有定向测试结果不等同于完整功能基线。

## 3. Cordis、Rust 与“不复用 DSH”的边界

### 3.1 物理限制

当前 Cordis 是 JS/TS 框架。Rust 和 Rig 不能直接执行 npm 插件。DSH 插件还可能依赖 DSH 特有服务；有 Cordis 不意味着自动拥有 DSH API。把 JS 引擎嵌入 Rust 也不能自动提供 Node.js 文件、进程和模块语义。

采用两个新组件：Rust Agent 核心与新建的 Cordis 插件宿主。Cordis 是插件内核，Rust 是会话、任务与执行内核。两者不争夺同一个状态的所有权。

### 3.2 禁止依赖

- V2 不能 import、链接、启动或在运行时访问旧 DSH 的 agent-loop、session、tools、permissions、skills、workflow、subagent、storage、UI client 或 Host 服务。
- 不从旧仓库复制上述模块代码后改包名使用；不通过 HTTP/RPC 调用旧 DSH 来实现 V2 能力。
- 新 Cordis 包从独立且已核验的来源获取、固定版本和完整性；不能从旧 DSH 的 vendor 路径加载。上游 Cordis 与 DSH fork 的差异必须有报告。
- Rig、独立 Cordis、通用数据库驱动、标准协议 SDK 可以使用。第三方插件本身只允许在兼容策略范围内安装；其旧 DSH 运行依赖必须移除或用新 SDK 改写。
- 可阅读旧实现确定行为，允许一次性、只读离线历史导入；历史导入器不能加载或运行旧 DSH npm 包。
- 允许共享平台已有业务与存储服务、许可证服务、RBAC 和纯展示组件；共享不得反向引入 DSH 依赖。

### 3.3 插件兼容等级

| 等级 | 类型 | 实现承诺 |
| --- | --- | --- |
| C1 | Skill、提示词、静态资源 | 独立解析、校验、授权安装与加载 |
| C2 | 标准 HTTP / MCP 工具 | 新客户端执行，校验 Schema、身份与网络策略 |
| C3 | 仅依赖独立 Cordis 和公开 JS API 的插件 | 在新 Cordis 宿主中加载并完成隔离测试 |
| C4 | 依赖 DSH 工具/服务 API 的插件 | 通过源码迁移或独立适配包使用 YaYa SDK；逐包固定版本 |
| C5 | 替换 DSH 循环、存储、权限、审批或 UI 内部实现的插件 | 不能原样加载；以 Rust 原生能力或新插件重实现并验收 |

不能标注“兼容全部 DSH 插件”。市场展示 supported/adapted/unsupported/blocked，并提供缺失依赖、版本、权限、迁移说明。对用户要求必须保留的插件，必须迁移完毕才可完成切换；unsupported 不是静默删减功能的理由。

若后续要求任意 DSH 包原封不动运行且不允许 DSH 服务，这两项在一般情况下不能同时满足，应调整包源码或兼容承诺，禁止隐式恢复旧引擎解决。

## 4. 仓库、进程与部署

### 4.1 决策

同一个产品仓库，建立独立 Rust workspace crate；Web API 负责产品入口与应用服务，Rust Worker 负责持久任务执行，Cordis Host 负责 JS 插件。不是新增独立商业系统，也不把全部代码塞进 Web API 模块。

```text
Browser / Tauri
   -> Next BFF（已有身份传递，V2 路由）
      -> Rust Web API（员工、RBAC、会话、命令、事件、文件）
           -> PostgreSQL（任务、事件、权限关联、outbox）
           <- Rust Agent Worker（领取任务与任务执行锁）
                  -> Rig -> 模型供应商
                  -> Rust 原生工具 -> 平台应用服务 / 受控内部 API
                  -> 检索服务 -> PostgreSQL / pgvector / 对象存储
                  -> 新 Cordis Host -> 已授权 JS 插件
```

旧 Web/API/DSH 链路保持原样；新 Worker 和 Host 使用新服务名、配置、端口、工作目录与健康检查。V2 不占用旧 8789 端口。生产端口由配置决定，不写死到领域代码。

### 4.2 建议目录

```text
Cargo.toml                         # 新增根 workspace；保留 api 的构建入口
api/                               # 既有平台 API
  src/modules/agent_v2/             # HTTP DTO、路由、身份与应用层调用
crates/
  agent-domain/                    # ID、消息、状态机、领域事件、权限请求
  agent-application/               # 会话与命令应用服务、事务和 outbox
  agent-runtime/                   # Rust 模型循环、恢复、队列和调度
  agent-model-rig/                 # Rig 适配；供应商差异集中在这里
  agent-tools/                     # 工具注册、执行记录、确认与策略
  agent-platform-tools/            # YaYa 表单/自动化/工作流工具
  agent-retrieval/                 # 索引、混合检索、重排、引用
  agent-storage/                   # PostgreSQL、对象/本地存储适配
  agent-plugin-protocol/           # Rust 协议类型与能力票据
  agent-worker/                    # 二进制、依赖装配、健康检查与停机
agent-v2/
  cordis-host/                      # 独立 package.json/lockfile，不继承 DSH workspace
  plugin-sdk/                       # YaYa JS 插件 SDK
  plugin-adapters/                  # 已审查的按包迁移适配
  fixtures/                        # 独立测试包与插件样例
web/features/agent-v2/              # 客户端、状态与页面适配
```

目录为设计目标；P1 应防止空 crate 过度拆分，只有依赖方向、发布或测试隔离确有需要才建立独立 crate。同一职责可先以模块承载，但依赖规则不变。

### 4.3 依赖方向

domain 不依赖 Axum、SeaORM、Rig、Cordis；application 依赖 domain 和服务 trait；runtime 通过 trait 使用模型、工具、存储；adapter 实现 trait；API 和 Worker 是装配根。内部 Rust 应用服务共享业务校验，不复用 HTTP handler 签名作为领域 API。

独立进程调用平台写入时使用受控内部入口；同进程调用使用相同应用服务。两种路径必须经过同一授权、确认和幂等检查，不能直接绕过业务规则操作动态表。

AgentV2 的平台只读工具也必须使用对应资源的当前版本快照：例如工作流 process definition 由 `automation_flows.current_version` 解析到 `automation_flow_versions`，不能将活动行的图字段当作该版本的权威定义。找不到当前版本快照时应失败关闭。关联记录查询目前限于同一应用，并同时校验员工能力、任务快照、用户 RBAC、来源行范围和目标行范围；跨应用关联不在已开放能力内。

工作流记录运行态由平台 `load_workflow_record_runtime_with_limit` 共享读取服务提供，原产品 HTTP 入口与 V2 工具分别完成自身授权。V2 额外验证记录属于当前用户的有效数据范围，任务/历史各最多输出 200 条并显式标记截断；自由文本意见不进入模型结果。当前 V2 合同是只读状态元数据（`readOnly=true`、`supportedOperations=[]`），不据此推导审批、撤回或其他写权限；完整操作权限及写能力需要单独实现和确认验收。

## 5. 状态唯一归属

| 数据/规则 | 唯一负责人 | 禁止的第二份事实 |
| --- | --- | --- |
| 员工权益、许可证和安装版本 | 平台已有授权与安装服务 | Worker 自行判断购买或修改授权 |
| 用户 RBAC、行/字段范围 | 平台授权服务 | Prompt 内的权限描述替代校验 |
| 会话/消息/任务/确认 | V2 PostgreSQL 应用服务 | Cordis 内存会话、Rig 自有持久历史 |
| 模型请求执行 | Rust runtime + Rig adapter | 插件默认模型偷偷替代 BYOM |
| JS 插件实例生命周期 | Cordis Host | Rust 伪造 Cordis 插件状态 |
| 运行控制与恢复点 | Rust runtime 的持久状态 | Host 内存 Map 决定任务是否完成 |
| 工作区、附件、产物 | 平台文件服务与 V2 存储协议 | 全盘轮询推断“最终产物” |
| 检索 ACL 与知识版本 | 检索服务 + 平台授权 | 模型生成的文档权限过滤 |

缓存可以存在，但必须带版本、TTL/失效机制、重建路径和内存上限。任何缓存丢失不应改变已确认的业务结果。

## 6. 数据模型与事务

建议 V2 新建 `agent_v2_*` 表，保留旧表结构；如共享目录，使用独立 engine binding，禁止旧代码遍历并执行新会话。所有表至少包含平台部署范围、所有者关联、创建时间和必要索引；关系由外键约束，opaque ID 使用 UUID。

| 表 | 核心字段与约束 |
| --- | --- |
| sessions | id、owner、employee_id、engine、source、context、title、lifecycle、parent_id、version、archived_at；engine 创建后不可变 |
| messages | id、session_id、role、parts、message_version、client_command_id；内容与附件引用版本化 |
| commands | id、session_id、actor、kind、payload_hash、dedupe_key、status；同作用域键唯一 |
| runs | id、session_id、command_id、status、model_route_version、employee_snapshot_id、checkpoint、lease_owner、lease_epoch、lease_until |
| steps | id、run_id、ordinal、attempt、request_snapshot_ref、status、token_usage、provider_request_id |
| tool_invocations | id、run_id、step_id、tool_id/version、action_id、args_hash、effect_key、status、result_ref、retry_class |
| approvals | id、invocation_id、actor_scope、args_hash、policy_version、expires_at、status、decision_actor、decision_time |
| questions | id、run_id、schema、status、answer、expires_at；回复只作用于所属 run |
| events | session_id、seq、schema_version、event_id、run_id、type、payload；(session_id,seq) 唯一 |
| outbox | id、event_id、topic、attempt、available_at、published_at；支持至少一次投递 |
| employee_snapshots | id、employee/package/version、allowed_actions、app_scope、skills、plugin_lock、hash；不存模型密钥 |
| employee_access_assignments | 通过现有 RBAC 角色/主体授权关系分配 employee_id 的使用权；记录 scope、权限版本、授权者和时间。若现有 RBAC 已可表达则复用，不建立第二套权限库 |
| files / file_links | object_key、hash、mime、size、state、owner；关联 session/message/run，引用计数或明确引用查询 |
| artifacts | file_id、run_id、logical_name、kind、producer、status、checksum |
| model_routes | 引用现有客户模型配置；运行快照含版本、能力和密钥引用，不复制明文密钥 |
| child_runs / jobs | parent_run、root_session、depth、budget、status、lease；继承权限上界 |
| plans / todos | session/run、状态、条目与版本；与 UI 展示和执行控制关联 |
| schedules | owner、employee、scope、timezone、trigger、next_run、dedupe；沿用或接入平台已有调度入口 |
| plugin_installations | 包来源、版本、digest、license_ref、compat_level、permissions、lock、status |
| knowledge_* | 见检索章节，独立文档/版本/分块/索引任务 |
| deletion_jobs | subject、generation、phase、cursor、error、retry_at、completed_at；可断点续删 |

### 6.1 命令提交

认证 -> 请求与附件验证 -> 员工及上下文授权 -> 查重 -> 同一数据库事务写 command/message/run/初始事件/outbox -> 提交 -> 返回 accepted。Web 断线不撤回已持久命令。相同幂等键且内容不同返回冲突，不能静默当成重试。

### 6.2 Worker 领取

使用数据库任务表与 `FOR UPDATE SKIP LOCKED` 或等效原子领取；任务执行锁领取递增 fencing epoch。所有任务状态更新必须匹配 owner 与 epoch。任务执行锁过期的新 Worker 不能与旧 Worker 同时提交有效结果。

不能声称外部副作用有全局 exactly-once。平台事务内写入可使用事务和唯一 effect_key；外部 API 必须使用其幂等键或查询对账。已提交外部写入但本地未记录结果时进入 `reconciling`/`manual_review`，不能盲目重试。

### 6.3 事件可靠性

状态、事件和 outbox 同事务提交；事件按会话分配 seq。采用 `session_event_cursors` 等行锁/原子计数分配，事务回滚不发布事件。投递允许重复，消费者按 event_id/seq 去重。摘要是可重建投影，不能决定原始执行结果。

模型流使用有序 chunk buffer；先分批持久化，再向客户端发布该批。提供 message_id、part_id、offset、attempt_id。明确异常时可丢失的是未提交输出，客户端不得把未提交输出当最终答案。工具开始、确认、结果与 run 终态必须立即持久化。

## 7. 状态机与核心流程

### 7.1 会话状态

`active -> archiving -> archived -> active`；`archived -> deleting -> deleted`。失败在带 error 的可重试状态保留，删除墓碑在清理完成后按审计策略保留。归档不等于取消，恢复归档不等于自动恢复失败任务。

归档活动会话默认返回冲突并提示停止；显式 cancel-and-archive 命令先持久取消、等待安全终态再归档。归档会话禁止新增 prompt 和执行历史确认。恢复时重新检查员工许可证、用户和资源权限；历史可以按授权读取，不默认重放工具。

### 7.2 Run 状态

```text
queued -> preparing -> running -> completed
                         | -> waiting_approval -> queued
                         | -> waiting_user -> queued
                         | -> retry_wait -> queued
                         | -> reconciling -> completed / manual_review / failed
queued/preparing/running/waiting_* -> cancel_requested -> cancelled
任意未完成状态 -> failed（不可恢复错误）
```

waiting 状态释放 Worker，不用一个悬挂 Promise 保持审批。重复批准、取消、回答通过条件更新返回原结果或明确冲突。终态不能被晚到的 chunk/result 覆盖。

### 7.3 创建与恢复统一入口

统一 `prepare_run(run_id)`：加载会话 -> 检查 engine/lifecycle -> 当前主体和权益校验 -> 解析员工快照 -> 工作区准备 -> 插件兼容和版本锁检查 -> 模型能力解析 -> 加载 checkpoint -> 建立受限执行上下文。新建、重启恢复、审批恢复、子任务全部调用此入口，禁止各自复制身份绑定逻辑。

### 7.4 执行步骤

1. 校验任务执行锁、取消标记、预算、员工/权限版本。
2. 读取本次步骤输入、已提交工具结果、待注入消息。
3. 组装上下文、检索引用、Skill 和可见工具；保存请求快照及版本。
4. 经 Rig adapter 发起模型请求，限制连接、首 token、空闲和总超时。
5. 流式写入消息块；工具参数必须完整且通过 Schema 后才能执行。
6. 为每个工具创建 invocation；逐个授权、确认、执行和记录。读工具可受限并行；同资源写操作按冲突键串行。
7. 原子保存步骤完成与 checkpoint；有待处理工具结果则继续，无调用则完成 run。
8. 超出预算、中止、外部结果不确定、模型不支持内容时进入明确状态，不能伪造完成。

### 7.5 排队、插入和模型切换

同一会话默认一个主 run 执行，用户普通消息进入 FIFO。steer 只在下一个安全步骤边界生效，不改写已发送请求。队列编辑使用版本控制，只允许编辑未领取消息。模型切换在安全边界创建 route 版本，不能更改运行中的请求；切换后重新检查图片、工具、上下文长度支持。

### 7.6 取消与崩溃恢复

取消令牌贯通模型、检索、插件 RPC、子进程和子任务。平台事务开始后以事务结果为准；外部写请求取消后仍可能完成，进入对账而不是显示“已撤销”。进程重启后扫描超时任务执行锁、待确认、重试与对账任务，从已提交 checkpoint 恢复；不重复已确认 effect_key。

## 8. Rig 使用规范与 BYOM

Rig 固定经验证版本，建立项目自己的 `ModelGateway`/`EmbeddingGateway` trait；Rig 类型不外泄到平台数据库、HTTP DTO、工具协议。模型适配升级通过供应商契约测试后才放行。

优先使用 Rig 的模型和流式请求抽象；只有证明高层工具循环可逐次拦截、持久化、取消与恢复后才使用它。否则由 Rust runtime 驱动循环，Rig 只执行一次模型步骤。不得启用无法经过平台授权入口的自动工具执行。

路由解析返回 provider、model、endpoint、capability profile、版本和 secret_ref。密钥仅在受信任模型适配边界短时解析；不进事件、插件宿主、消息、日志、向量库。不同用户/路由并发不可共享可变 endpoint/key。

能力表至少包含 text/image/document/audio/tool_call/streaming/structured_output、context_window、max_output、支持 MIME、Embedding 维度。能力来自审核配置与真实测试，不从模型名称猜测。无工具调用或图片能力时返回可操作说明；降级必须显式记录并获得符合产品策略的选择，不能偷偷换模型。

每步记录 usage、估算成本、供应商 request_id、延迟和重试原因。限流/网络瞬断指数退避加抖动，遵循 Retry-After；参数错误、认证错误和不支持内容不能无限重试。

## 9. AI 员工、RBAC 与动作授权

### 9.1 员工全链路

运营端商品/订单/许可证 -> 客户验证签名与 entitlement -> 安装包下载和 digest 校验 -> 本地不可编辑安装快照 -> Skill/插件兼容报告 -> 员工可用状态 -> 会话选择 -> 每 run 快照与每次工具实时授权 -> 更新/撤销/卸载。

不新建第二套员工市场、购买或许可证系统。新增协议字段需与运营端兼容版本协商；开发本任务只定义所需合同，不擅自修改另一项目的生产配置。

员工更新影响新 run；活跃 run 固定内容版本，但权限收紧、许可证过期和撤销立即限制后续操作。已运行的不可取消业务事务按结果记录，不能宣称撤销可以回滚已完成行为。插件旧版本在所有引用 run 终态后回收。

### 9.2 RBAC 分配 AI 员工使用权

区分三种权限：平台是否拥有该员工的有效许可证、当前用户是否被分配该员工使用权、该员工允许执行哪些工具/动作。购买并安装员工不代表所有用户自动可以使用；拥有 `agent.window` 只代表可进入工作台，不代表可以使用全部员工。

复用现有 RBAC 的角色、成员与资源授权关系，新增或映射资源级员工使用权限（建议权限标识 `ai_employee:{employee_id}:use`，最终命名遵循现有权限规范）。授权管理操作需要独立管理权限；拥有管理权不自动拥有其他用户会话读取权。未分配默认拒绝，不依赖前端隐藏员工卡片实现安全。

员工列表只返回同时满足许可证有效、安装可用和当前用户使用权的员工。创建/恢复会话、提交消息、领取任务、执行工具、启动调度和子任务时必须核验使用权；角色变更、用户禁用或员工分配撤销后，阻止后续操作并取消尚未执行的任务，正在发生的外部副作用按对账规则处理。缓存需要权限版本和失效机制，不能继续使用过期授权。

撤销员工使用权后，普通工作台会话列表、内容读取、搜索、订阅、下载和归档恢复也必须重新授权，不因知道会话 ID 放行。用户访问或删除本人被撤权历史的需求，通过单独授权的数据管理/删除入口处理；该入口不能恢复执行权。普通管理员不默认可读所有会话，如需要审计访问，必须显式授权并记录审计，不能通过“管理 AI 员工”权限隐式获得。

### 9.3 按用户与 AI 员工隔离会话

会话隔离键固定为 `(deployment/tenant_id, owner_user_id, employee_id)`；session_id 在此范围内指向唯一会话。用户身份从已验证认证上下文取得，员工 ID 从会话记录取得；不能信任浏览器或模型提交的 owner/tenant，也不能通过改 employee_id 把旧会话转交给另一员工。

- 同一用户使用员工 A、B：会话列表、搜索、消息、记忆、待确认、队列、子任务和工作区按员工分别隔离，默认不交叉提供上下文。
- 不同用户使用同一员工：各自历史、附件、产物、事件流、索引和运行状态互不可见；共享员工配置不等于共享会话。
- 同一用户同一员工：可拥有多个会话，每个会话的运行、附件关系和草稿独立；长期记忆等跨会话能力必须按该范围显式授权启用。
- 所有详情、查询、搜索、归档、恢复、分叉、删除、事件补齐、确认、附件与产物接口通过统一 SessionAccess 服务验证 owner、employee、scope 和当前员工使用权。传入员工筛选时必须与会话员工一致。
- 分叉默认保留用户与员工归属；跨员工转交若未来支持，必须是显式新建会话并重新授权、选择可转交内容，不允许原地修改归属。
- 调度和子任务保留原始用户及员工范围，服务账号/Worker 身份不能扩大数据权限。共享知识库是显式授权资源，不作为共享私人会话的通道。

目录和查询索引以隔离字段作为前缀/联合条件；执行器和插件收到不可扩大范围的执行上下文。测试必须验证前端筛选、API、数据库查询、SSE、工作区和检索全部一致，不能只验证列表页面不显示其他会话。

### 9.4 授权公式

前置条件：许可证有效、员工已安装、用户具有该员工使用权、会话归属验证通过。满足前置条件后，`可用工具 = 员工配置能力与已实现工具的显式映射`；`实际执行权限 = 用户当前 RBAC ∩ 任务 RBAC 快照 ∩ 平台执行策略`。插件执行另需对应插件授权。员工能力是功能定义，不是独立业务资源授权体系。。

行级和字段级范围在查询/领域服务执行时应用；会话所有权只代表可以访问会话，不代表可访问其中所有当前业务资源。员工包的 `applicationIds` 仅保留给旧 Agent 合同兼容，V2 不使用该字段授权，也不将空数组转换为通配权限；应用、表单、行、字段均按用户 RBAC 与任务快照校验。权限策略升级为 2；旧策略任务必须重新提交，旧确认不能按新策略直接执行。

读、写、下载、检索、确认和子任务分别授权。所有敏感查询包含平台部署与用户范围。原始 API 路由不能成为绕过 Agent 员工策略的捷径：Agent 写操作只允许调用授权后的应用服务入口，用户直接操作仍按既有产品权限规则执行。

### 9.5 工具定义

```text
ToolDescriptor {
  id, version, description, input_schema, output_schema,
  action_id, resource_resolver, effect_class,
  confirmation_policy, timeout, concurrency_key,
  retry_class, required_capabilities, presentation
}
```

工具实例先按员工权限裁剪可见目录，执行时仍重新校验。工具名不作为最终动作权限；一个工具支持多个动作时按解析出的 action_id 授权。任意 `propose_write` 包装器必须展开到具体动作和资源后执行。

### 9.6 确认

确认记录绑定 invocation、部署、用户、员工、会话、run、精确规范化参数 hash、资源版本和策略版本；默认有效 30 分钟。创建、编辑、删除全部要求用户确认。参数或资源变更后重新预览和确认；停止、拒绝、过期和冲突均持久化确定结果。业务变更与 effect_key 在同一数据库事务提交，恢复只能读取既有业务效果，不重放写入。

批准时重新验证 RBAC、员工许可和资源版本；使用原子 claim 防止重复。待确认参数冻结，插件或浏览器不能用相同 approval_id 替换实际执行内容。确认事件属于会话，不能用“我拥有另一个会话”响应该审批。

## 10. 平台工具与 Agent 通用能力

全部工具清单、原有名称和验收用例见配套矩阵。核心规则如下。

- 应用、导航、表单、Schema、明细表、自动化、工作流读取和写入使用既有平台应用服务。
- 表单值建议只更新前端草稿，经字段和权限校验，不等于提交记录。
- 设计补丁绑定 base_schema_version/hash，先预览、验证再提交；并发改动返回冲突，不覆盖其他用户设计。
- 普通记录与关联/明细数据提供真实筛选、分页和聚合；不能给多个工具不同名称却只调用同一个默认 records 列表冒充实现。
- 自动化创建与图保存应由领域事务/补偿流程统一管理，验证节点、边、字段映射和版本；部分失败不能留下假成功草稿。
- 平台 Schema 合同覆盖当前组件、子表单、布局、公式、自定义按钮和自动化节点；采用生成/版本化合同，不能让 Agent 维护过期字段字典。
- Shell、文件、网络、浏览器、代码执行、子 Agent、后台任务、todo、计划、上下文压缩、记忆、调度、workflow 能力全部独立实现或通过非 DSH 通用库接入。
- 使用标准 HTTP/MCP 和原生 OS 工具等不代表默认授权；每个入口统一经过能力票据与预算控制。
- 专门员工如 BOM 报价的行为由 Skill/插件配置和独立执行资源实现，禁止在通用 runtime 按员工名称硬编码路由。脚本、模板和产物验证也纳入安装包校验。

## 11. 工作区、文件、多模态与产物

### 11.1 工作区

逻辑路径按部署/用户/员工/会话隔离；为兼容旧部署，旧路径保持不动，V2 使用独立根与映射记录。不可通过字符串替换非法字符导致不同 ID 碰撞，优先数据库 UUID 作为物理目录名。

路径需做规范化与目录约束，处理 `..`、绝对路径、UNC、Windows drive/device 名、大小写、junction/symlink 和 TOCTOU。上传与工具文件访问统一存储服务，不把宿主绝对路径直接暴露给浏览器。

目录隔离不是安全沙盒。当前脚本使用系统账户本地执行，不提供系统级沙箱；Windows 子进程用 Job Object 等机制终止进程树，但 Job Object 本身不提供文件与网络隔离。具体 Linux/Windows 支持矩阵在 P1 确认；未实现隔离的平台不得把 unrestricted 模式标为生产安全。

输入目录只读，scratch 可写，outputs 需显式发布；配额在上传和执行期间检查，支持回收后解除阻塞。禁止只在 turn/end 扫描一次。后台任务结束发布产物事件，不依赖长期全盘轮询。

### 11.2 内容模型

```json
{
  "clientCommandId": "uuid",
  "parts": [
    { "type": "text", "text": "分析图片和报价表" },
    { "type": "image", "fileId": "uuid", "detail": "auto" },
    { "type": "file", "fileId": "uuid", "processingMode": "auto" }
  ]
}
```

fileId 由平台签发，提交时验证所有权、会话关系、状态和 MIME；不能接受模型/浏览器提供任意服务器路径读取。模型输出图片或文件也使用受控 file/artifact 引用，不将未验证外部 URL 当平台产物。

### 11.3 上传与处理

创建上传 -> 限流与配额 -> 流式写入临时对象 -> 检测真实 MIME、大小、hash -> 完成对象 -> 关联会话/消息 -> 异步解析/缩略图/OCR -> ready/failed/unsupported。幂等上传、断线清理和孤儿对象回收必须有任务。

第一版需覆盖 PNG/JPEG/WebP、PDF、TXT/Markdown、CSV/XLSX、DOCX；逐格式明确图片原样发送、文档原生发送、提取文本/表格或 OCR 的路径。模型原生文档能力依供应商验证；不能用“支持附件”宣称支持任意文件。加密、损坏、超限和压缩炸弹返回具体原因。

待解析文件允许保存消息但不提前开始依赖它的模型步骤；删除输入或撤销权限后，取消尚未完成的解析与索引任务。并发提交时确保同一个对象不会被提前垃圾回收。

### 11.4 产物

工具发布 artifact 时校验工作区归属、内容类型、hash、size 和生产 run。产物卡片展示生成中/可下载/失败。下载使用鉴权或短期签名；每次签发检查最新权限。支持 UTF-8 文件名、二进制完整性、过期与删除。

## 12. RAG、检索与记忆

### 12.1 四类检索

1. 会话搜索：标题和已提交消息全文，按 owner、employee、source、时间、归档状态筛选。
2. 知识库检索：文档/附件索引，提供来源引用和授权过滤。
3. 实时业务检索：调用平台查询和聚合服务，实时 RBAC；不能默认把全库业务数据复制到向量库。
4. 联网检索：按员工授权调用独立搜索/抓取适配，记录 URL、抓取时间和来源；防止内网访问和凭据泄露。

会话搜索首版采用全文；中文使用经评测的分词/索引方案，不能只使用默认英文配置。可选语义会话搜索必须继承相同 ACL 和删除机制。

### 12.2 数据与索引流程

`knowledge_bases -> documents -> document_versions -> chunks -> embeddings`；另有 document_acl、ingestion_jobs、retrieval_traces。版本包含原文 hash、parser/chunker/OCR 版本、Embedding provider/model/revision/维度、可见范围。不同 Embedding 模型或维度不能混查。

授权导入 -> 文本/表格/OCR 提取 -> 清洗 -> 分块并保留页码/段落/表格位置 -> Embedding -> 原子激活完整索引版本。重建期间旧完整版本继续服务，失败版本不替换成功版本。

建议 PostgreSQL + pgvector 作为初始存储方案，P1 验证扩展部署与中文全文方案；若不满足容量、召回或延迟，再以数据决定独立检索引擎。不把候选方案写成已完成部署。

### 12.3 查询流程

用户上下文 -> 解析可见知识库和文档范围 -> 关键词与向量混合召回 -> 融合 -> 可选 rerank -> 再授权与版本检查 -> 限额上下文 -> 带 citation_id 的模型输入 -> 回答引用校验。

ACL 应进入召回过滤，发送重排服务和模型前再次校验。ANN 过滤导致候选不足时采用受限补召回或精确回退，不能为了凑 top-k 扩大可见范围。索引 ACL 更新失败时按源授权拒绝暴露，不以旧索引为准。

第三方 reranker/Embedding 也属于数据出境路径，遵循客户平台部署策略。不记录未授权候选全文到普通日志。

### 12.4 引用与评测

每条引用可定位文件版本、页码/行/段落、chunk，点击时重新鉴权。无证据时明确不足，不伪造引用。评测包含中文、表格、图片 OCR、版本更新、删除与 ACL 撤销，衡量 Recall@k、MRR/nDCG、引用正确率、拒答质量和延迟。

### 12.5 记忆

会话历史、上下文摘要和长期记忆分别存储。长期记忆按部署/用户/员工/应用范围隔离，支持查看、修正、关闭、保留期和删除；写入需来源及敏感信息规则。摘要记录来源消息范围和版本，不删除原始历史，也不能把未确认工具结果写成事实。

## 13. Cordis 插件协议与市场

### 13.1 Cordis 的真实职责

使用固定版本独立 Cordis，完成插件 apply/dispose、服务注入、依赖检测、事件钩子与卸载。新插件 SDK 公开 `tools.register`、`skills.register`、`retrievers.register`、`processors.register`、受限事件订阅等服务。注册返回 disposer，卸载停止接收新调用并等待/取消旧调用。

Rust 所有跨进程调用显式携带 scope，不能依赖 JS 进程全局“当前用户”。按信任级别/包实例隔离 Host 进程；Cordis scope 不是安全沙盒，互不信任插件不能仅靠 Context 隔离。

### 13.2 协议

本地采用长度有界的 JSON-RPC 2.0 stdio 作为首版候选；stdout 只写协议，stderr 写日志。并发请求用 id 关联，支持版本握手、schema 校验、超时、取消和 backpressure。大文件用对象句柄传递，不通过 JSON 大量 base64。

首版方法：host.initialize、plugin.prepare/activate/drain/dispose、capability.list、tool.invoke、invocation.cancel、health.check。Host 到 Rust 的文件/网络/业务请求通过 broker 方法与最小能力票据完成。不能传平台 JWT、BYOM key、数据库连接串。

能力票据包含 invocation_id、scope、action/resource 上界、过期时间、audience、nonce，服务端校验重放和撤销；不能作为无限通用 Bearer 转发给任意外部 endpoint。RPC 状态由 Rust 持久化，Host 重启重新装配而非恢复自有会话。

### 13.3 包 manifest 与安装

```json
{
  "schemaVersion": 1,
  "id": "vendor.example-tool",
  "version": "1.0.0",
  "runtime": "cordis-node",
  "entry": "dist/index.js",
  "engine": { "yayaPluginApi": "1.x", "cordis": "<validated-range>" },
  "capabilities": ["tool:example.lookup"],
  "permissions": { "networkHosts": ["api.example.com"], "workspace": "read-input" },
  "integrity": { "sha256": "<package-digest>" }
}
```

示例中的版本范围和 digest 是占位符，P1/P5 产出真实锁文件。安装顺序：验证来源/签名权益 -> 下载并核验 hash -> 解包路径与大小校验 -> 依赖/许可扫描 -> 兼容检查 -> 隔离健康检查 -> 原子激活。默认禁止任意 install 脚本执行；确有需要的构建在隔离流程完成并审核产物。

更新固定运行引用的包版本，新 run 使用新版本；失败不替换旧可用版本。重名工具使用包命名空间，不允许先安装者占用其他员工工具名。卸载删除授权可见性、drain 实例、清理资源；活跃引用和数据保留策略明确。

市场是供应来源，不是执行引擎。保存原始市场 ID/version/digest 与 YaYa 适配产物 ID/version/digest 的映射，适配不得破坏原始签名。运营端签发原包权益和适配授权关系，客户平台核验二者，禁止把改写后的包冒充原签名包。

## 14. 对外 API 与前端

V2 使用 `/api/agent/v2`，旧入口保持原样。所有写命令接受 clientCommandId/Idempotency-Key，返回 command_id、run_id 和 accepted 状态。命令成功接收不等于执行成功。

| 路由 | 职责 |
| --- | --- |
| GET /employees | 返回当前可用员工及能力概要 |
| POST /sessions | 创建 engine=v2 会话，绑定员工与上下文 |
| GET /sessions | 标题/全文搜索，cursor、employee、source、status、时间过滤 |
| GET/PATCH /sessions/{id} | 详情、标题、置顶、显示元数据 |
| GET /sessions/{id}/messages | 游标历史，稳定顺序与附件引用 |
| POST /sessions/{id}/commands | prompt/steer/cancel/queue-edit/select-model/compact 等类型化命令 |
| POST /sessions/{id}/archive | 显式归档，冲突规则明确 |
| POST /sessions/{id}/restore | 恢复已归档会话 |
| DELETE /sessions/{id} | 对已归档会话创建彻底删除任务，返回 202 |
| GET /deletions/{id} | 删除进度与失败重试状态 |
| POST /sessions/{id}/fork | 按消息边界创建分叉，不复用副作用执行记录 |
| GET /sessions/{id}/events | SSE，Last-Event-ID 与历史补齐 |
| GET /events | 可选多会话流，显式订阅与逐会话授权 |
| POST /approvals/{id}/decision | 有权限用户批准/拒绝，绑定参数版本 |
| POST /questions/{id}/answer | 类型化回答，防止跨会话响应 |
| POST/GET /sessions/{id}/files | 上传/列出附件，处理状态 |
| GET/DELETE /files/{id} | 鉴权下载与移除引用/删除语义 |
| GET /sessions/{id}/artifacts | 产物列表与下载引用 |
| GET/POST /knowledge-bases/... | 知识库、文档、版本、索引任务管理 |
| POST /retrieval/search | ACL 过滤检索，返回引用与可控调试信息 |
| GET /plugins/... | 安装状态、版本、兼容与权限报告 |

OpenAPI 由 Rust DTO 生成，前端生成 SDK；插件协议 Schema 生成 Rust/TS 类型，单独版本化。以上为设计路由，不表示当前已有实现。

事件 envelope 至少包含 protocol_version、event_id、session_id、seq、run_id、time、type、payload。SSE 采用现有 BFF 同源身份；连接断开不得取消 run。重连从持久事件补齐，过期 cursor 返回 reset_required 和快照入口。多会话流只订阅已授权 ID，不能先接收全部用户数据再在浏览器过滤。

前端包括旧/新引擎选择和不可变会话标识；新页面覆盖流式文本、模型允许显示的推理摘要、工具参数/结果/错误、确认卡片、问题卡片、队列、停止、子任务、计划、后台任务、引用与附件。不得要求供应商输出隐藏推理，也不得把系统提示与凭据显示给用户。

## 15. 彻底删除与历史迁移

### 15.1 删除流程

验证所有权与归档状态 -> 设置 deleting 墓碑并阻止新读写 -> 取消/排空任务与解析/索引作业 -> 撤销 URL/能力票据 -> 删除搜索和向量索引 -> 删除消息/摘要/记忆派生项 -> 按引用删除附件和产物 -> 删除工作区 -> 清理业务行 -> 完成删除任务。每步可重试且重复安全。

共享知识文档只解除该会话引用，不删除其他用户仍有权使用的原文；私有副本和派生内容必须删除。存储故障时展示 deletion_pending，不得先显示“彻底删除完成”。独立审计保留最小操作事实，不能保留已删除对话全文或附件。

备份按保留周期清除，不承诺瞬间删除不可变备份。恢复备份时必须重放独立保留的删除登记，在对外开放前再次清理，防止数据复活。外部模型供应商的数据保留由部署协议与供应商能力约束，产品须明确覆盖范围。

### 15.2 新旧共存

旧会话绑定 legacy，新会话按灰度选择 v2；不能对同一个命令双跑真实写操作。对照测试使用隔离数据库、假工具或无副作用数据。回退路由只影响后续新会话，不能把 V2 活跃会话直接交给旧引擎执行。

旧历史通过独立离线导入器转换为中立消息/事件/附件表示，保留来源 ID、hash、导入版本和缺失项报告。导入默认只读且幂等；继续对话通过 V2 新分叉，重新授权并重建上下文，不重放旧工具。旧日志格式由 fixture 与显式解析实现，不依赖旧 DSH 程序。

如果某类历史无法读取、某必需插件未迁移或工作区存在未交付产物，不能删除旧系统。移除前必须完成逐项验收和数据核对。

## 16. 生产质量与运维

- 配置：并发、预算、超时、配额、保留期、检索 top-k、工具策略均有校验配置；不在插件中硬编码部署变量。
- 观测：trace_id 贯通请求、command、run、step、invocation、plugin、retrieval；记录版本和错误码，敏感内容按权限单独存放。
- 指标：队列等待、首事件/首 token、模型时延、工具成功率、任务执行锁丢失、重复拦截、确认等待、事件积压、检索指标、删除积压和资源消耗。
- 探针：liveness 不依赖外部模型；readiness 检查数据库与必需依赖。可选插件/知识库故障按能力降级，不使全部 API 不可用。
- 停机：停止领取 -> 标记 draining -> 取消或完成在途步骤 -> checkpoint -> 归还任务执行锁 -> 关闭插件；设定最大停机时间。
- 熔断：按供应商和插件实例隔离；一个坏插件不得拖垮其他员工或 Web API。
- 隔离：外部内容是数据，不允许通过文档指令提升工具权限；网络代理限制地址、重定向、DNS 重绑定和请求大小。
- 供应链：Rust/npm 锁文件、SBOM、许可与漏洞审查、插件完整性、独立 Cordis 来源验证。
- 平台支持：Linux 客户部署和 Windows 开发/客户部署分别列能力；不能用 Linux CI 替代 Windows 子进程与路径验证。

发布前必须定义并签入量化 SLO、负载档位、资源预算和 RAG 数据集。建议初始验收负载与阈值见配套矩阵；最终值由目标部署硬件和真实测量确定，禁止测完再降低阈值掩盖退化。

## 17. 设计决议与需验证事项

| 事项 | 当前决议 | 完成门槛 |
| --- | --- | --- |
| Rust Agent 核心 | 已确定 | 不被框架高层隐藏循环替代 |
| Rig | 已确定使用 | P1 供应商、多模态、工具和取消 POC |
| Cordis | 已确定真实使用 | P1 独立来源、版本差异与生命周期 POC |
| 旧 DSH 依赖 | 明确禁止 | 构建检查与断开旧目录验收 |
| 代码组织 | 同仓库独立 Rust crate | P1 编译/部署与依赖检查 |
| Worker | 独立进程，共用平台状态 | 任务执行锁/fencing/停机测试 |
| 插件市场 | 按包兼容且不复用 DSH 服务 | 必需包清单、来源授权和适配 fixture |
| 检索存储 | PostgreSQL + pgvector 候选 | 部署验证、中文检索评测和容量测试 |
| JS 通信 | JSON-RPC stdio 候选 | 取消、并发、大结果、崩溃恢复测试 |
| 生产沙盒 | 必须真实隔离 | P1 明确支持 OS，P10 实测越界防护 |
| 历史迁移 | 中立导入、默认只读 | 数据完整性报告和可读取验收 |

任何变更必须更新本文、计划与验收矩阵。禁止在开发过程中通过引入旧 DSH 暂时代替未完成能力，然后把它保留到最终发布。

## 18. T23/T31 设计写入合同（2026-10-29 实现）

实现位置为 V2 独立 `design.rs`、broker、preview 与工具注册表，不调用旧 Agent executor。T31 的工具 ID 为 `platform_apply_design_patch`，员工包必须明确许可 `yaya_apply_design_patch`；通用写包装器、通配字符串、T23 许可均不授予 T31。T23/T31 均要求确认，仅支持 normal/workflow；defined、HTML/TSX 和逻辑 detail 不支持。

输入固定为 `appId/formUuid/baseVersion/baseHash/patch`。支持 add/replace/remove；JSON Pointer 严格解码 ~0/~1，数组 add 为插入，末尾 - 仅允许 add，remove 后索引前移。父路径必须存在，替换/删除目标必须存在，禁止根替换与身份/合同元数据修改。可编辑根仅 formName、columns、rows、pageProps、fields；最多 100 操作，补丁与生成 Schema 分别最多 1 MiB。

设计 hash 合同为 `sha256-json-v1`：递归排序对象键、保持数组顺序，对紧凑 JSON UTF-8 字节取 SHA-256，返回 64 位小写十六进制。它独立于命令幂等指纹。T05 v2 对完整可读且具备当前/任务设计编辑权限的 normal/workflow 结果返回 `designBaseline: {algorithm, baseVersion, baseHash}`；字段过滤后的结果没有此基准。基准针对平台清理/规范化后的权威 Schema，T31 使用同一表示计算 hash。

设计读写同时检查员工配置能力、任务动作快照与用户当前 RBAC、应用显示、表单显示、设计查看；写入另需编辑权限。整份保存与补丁都要求当前字段策略及任务字段快照可读取每个现有字段，隐藏字段/隐藏父容器同样拒绝；管理员不能绕过这一设计完整性限制。T23 和 T31 共用身份保持、产品组件/字段/布局/父子关系、选项/属性及动态存储编译校验。

预览从数据库当前设计生成，冻结原始 arguments、parameters hash、资源版本、策略版本及 `preview.designBaseline: {algorithm, baseVersion, baseHash, targetHash}`；已有 JSON 持久字段足够，无新增迁移。差异包含字段完整属性、布局、新增/删除、字段顺序及页面属性。确认卡只显示操作信息与设计基准版本，hash 保留在服务端合同中。

执行按 session → run → confirmation 与资源锁协议处理。公共 Schema 保存服务增加表单行锁，与 V2 保持 form → navigation 顺序；原设计器历史 base_version 保存语义保留。执行锁内重查授权、当前基准、补丁生成目标 hash，与冻结信息不符时保存冲突结果和事件；业务保存、effect、确认状态、审计和事件同事务提交。效果提交而 Worker 未 checkpoint 时，恢复读取 effect，不再次修改设计；存储同步失败回滚整个事务。该锁用于单客户平台内并发一致性，不表示商业租约。

实施与验收的实际边界见[设计阶段报告](agent-v2-design-report.md)；目前为本地分层验证通过，不代表真实模型设计端到端或完整 P4/V2 已验收。

## 员工能力与包同步更新（2026-10-29）

运营中心增加 `yaya_apply_design_patch`，并保留既有商品的历史 `applicationIds`。V2 对中心已发布工具名使用明确兼容映射；读取能力不授权写入，未知能力和通用包装器不扩大能力。包安装先校验身份、有效期、版本、重复 Skill，再下载/校验全部归档并写入平台自有不可变版本目录，更新 manifest 前不覆盖旧 Skill。下载、解压和资源冲突失败保留旧包；实际证据及剩余限制见[本批报告](agent-v2-capability-rbac-report.md)。

## 附件与逻辑工作区实施更新（2026-10-29）

本批使用 V2 独立 PostgreSQL 文件对象，以固定会话的部署/用户/员工归属隔离，上传、模型读取、工具输出和私有下载均经服务端授权。文件与事件同事务，生成文件以 run/invocation 去重并受当前执行 epoch 与取消状态限制。前端复用 V2 自有 WorkspaceFiles，通过生成 SDK 上传及鉴权 BFF 下载。模型使用 Rig 原生图片 part 和 UTF-8 文本适配。这里的工作区是逻辑文件集合，物理沙盒仍未实现。格式限额、事务约束、实际证据及回退见[工作区报告](agent-v2-workspace-report.md)。PDF/Office 仅存储下载，真实视觉供应商验收未通过，不代表完整多模态已完成。

## Agent 办公文件工具（2026-10-30）

新增独立 Rust office crate，由 API 的受控 stdio adapter 调用。解析只接收当前会话文件字节，不接收凭据或任意路径；CPU/内存/耗时/展开大小有限额。读工具 v2 按工作表/段落/幻灯片/页分页，新增 Office 生成工具将真实文件保存到当前工作区。Skill 定义业务方法，文件解析由 Agent 工具实现，不新增业务权限。实现、合同和格式缺口见[办公文件报告](agent-v2-office-report.md)。

## 发送请求与基础解析更新（2026-11-02）

当前发送使用独立 submission 信封与临时 PostgreSQL bytea。选择附件不联网；点击发送后冻结、并发两个二进制上传，全部就绪后在单事务创建/复用会话、转正附件并保存消息/命令/run/初始事件。请求、放弃、过期清理以相同锁串行；用户临时配额按声明大小预留。正式会话不会先于提交事务出现。

Worker 首次模型请求前生成持久 Office 样本，按文件/hash/解析器及规则版本缓存，60 秒截止时间持久化，样本按用户内容隔离。localStorage 只恢复已发送请求元数据，不保存文件字节；缺失文件重新选择校验。迁移、接口、限额、安全边界与实际证据见[发送链路报告](agent-v2-send-report.md)。该更新替代早期“先创建会话再上传”的前端行为；旧上传接口仅保留兼容。真实浏览器附件全链路仍待验收。

## 办公工具续答可靠性（2026-11-02）

模型续答现增加独立输出 token 预算配置（默认 8192、最大 32768，含供应商计入的推理 token）；达到预算和空响应分别保存 model_output_limit / empty_model_response 及安全用量事件。空响应沿用有界重试与 checkpoint；不重跑已持久工具，不记录私有推理或供应商正文。详见[办公文件报告的排查记录](agent-v2-office-report.md)。


## P5-09 独立 Skill 执行（2026-11-02）

当前已改为 Rust manager 本地进程、会话持久依赖与工作目录。安装员工不构建依赖镜像，不要求锁文件；Skill 配置只在本次选定进程注入，不进模型。作用域由服务端授权 run 解析，资源按版本/hash 冻结，已知日志配置值脱敏。所有脚本拥有当前系统账户权限，没有文件/网络安全沙箱。Windows 真实执行、安装、重跑、产物和服务重启通过；真实模型及 Linux 尚未验收。见[本地执行报告](agent-v2-local-execution-report.md)。


## 会话历史快照（2026-11-02）

消息接口固定最近 20 轮，使用 queue_seq 独占游标向前读取；同一查询快照携带消息状态、当前页事件和 SSE 接续位置，避免全量历史事件重放。终态按所属 run 恢复，切换到底部、前插保持位置。无迁移。见[历史修复报告](agent-v2-history-report.md)。

## 长任务执行当前规则（2026-11-03）

本节覆盖早期任务预算方案：任务没有累计时长、模型请求次数或步骤上限；模型完成、用户停止或不可恢复错误结束任务。每步 checkpoint 与工具结果持久化，恢复仍遵循权限、幂等、FIFO 和 fencing。移除 48 步阶段切断及预算心跳，历史 budget/stage 字段仅兼容保存，不参与授权或执行条件。

模型上下文窗口按服务端实际路由配置；字节估算只触发自动摘要，不能据此阻止首次调用或要求用户继续。摘要失败保留原历史继续，真实供应商拒绝请求按实际错误处理。旧技术性／预算暂停在无未决执行时由 Worker 自动接续；outcome_unknown 不自动重放。单次网络／脚本超时独立保留，脚本不再受累计任务剩余时间裁剪。详见[长任务报告](agent-v2-long-task-report.md)。

### 知识管理专项验证补充（2026-11-06）

客户真实 PostgreSQL 隔离 schema＋HTTP 专项测试、运营中心真实临时 SQLite 处理器测试各 1 个通过。尚未覆盖浏览器/BFF、真实许可证市场安装同步、完整空库迁移；解析、索引和 Agent 检索尚未实现。详细命令、覆盖与限制见 [知识管理实现报告](agent-v2-knowledge-management-report.md#2026-11-06-专项测试补充)。不将管理层测试通过标记为完整知识库/RAG 完成。

### 低代码开发工程师能力首批调整（2026-11-06）

组件/节点合同按真实设计器源码生成并内嵌 API；接入按需查询、纯设计预检、V2 保存共用校验及已暂停集成自动化的版本化确认更新。当前为首批实现与编译/静态检查通过，LC01—LC18 未实测，不标记复杂应用开发验收完成。范围、授权、生成维护及缺口见[实施记录](agent-v2-low-code-engineer-implementation-report.md)；目标以[专项方案](agent-v2-low-code-engineer-capability-plan.md)为准。


## 2026-11-09：知识库 K2 持久解析进展

已编码三类知识的持久解析任务、完整有界文本层提取、结构定位分块、原子激活/失败保留、epoch 恢复、删除级联、状态/预览/管理者重试；迁移115、OpenAPI和SDK同步。API与Office编译、定向ESLint通过，Web仅原有MyTable测试类型错误。尚未应用当前业务库迁移，未做本批数据库、格式样本、浏览器/模型或回归验收。K2为「已实现，待实测」，KR03/KR04/KR06/KR09不标通过。

K2阶段后的当前增量：K3中文/标识符关键词索引与K4范围、两个Agent工具、持久引用已编码；Embedding、向量/混合检索及重排仍未实现。本轮仅编译与静态检查，未应用业务库迁移或验证真实模型链路，不标记KR检索/引用验收通过。K2细节见[知识解析报告](agent-v2-knowledge-parsing-report.md)，当前模式、迁移116、启用步骤和缺口见[检索引用报告](agent-v2-knowledge-retrieval-report.md)。本批不代表完整RAG或AgentV2完成。


## 2026-11-09：K3 向量、RRF 与重排增量

已编码独立Embedding/Reranker用途设置、用户私有不可变profile、持久批次构建与epoch恢复、PostgreSQL数组精确余弦召回、k=60 RRF及可选重排，继续复用K4权限快照和持久引用。结果明确区分关键词、混合和已重排模式，构建/供应商故障按配置明确降级或拒绝；不把聊天模型当Embedding。配置入口在模型供应商页面“知识检索”，新增迁移117。

当前精确向量后端不等于pgvector/HNSW，ANN优化、容量与质量验收仍待完成。API/AgentV2 workspace/运营API编译、OpenAPI/SDK及定向ESLint通过；Web仅原有MyTable测试类型错误。未应用业务库迁移，未执行数据库、浏览器、真实Embedding/Reranker或回归测试，KR项不标实测通过。详细配置、模式、启动、限制及回退见[混合检索报告](agent-v2-knowledge-hybrid-report.md)。本节覆盖前文“K3仅关键词、向量/RRF/重排尚未实现”的当前状态描述；不改变其历史证据。


## 2026-11-09：客户平台统一知识检索规则（覆盖先前个人配置规则）

Embedding/Reranker由客户平台统一配置、统一构建并共享向量；运营中心只发布员工知识原件。当前所有有效登录用户均可读取平台知识，不叠加知识读取RBAC；管理操作权限、部署隔离、员工安装/许可证/包版本、任务范围和私人会话隔离保留。迁移118保存部署profile和独立密文平台连接，旧个人profile保留停用，管理员需要显式保存一次平台配置。后台自动安排已解析有效资料的共享向量任务。新任务ruleVersion=2，旧任务不自动扩展。

本轮API编译、OpenAPI/SDK及定向ESLint通过；Web仍仅有原MyTable类型错误。未升级业务库、未运行数据库/浏览器/模型或回归测试，不标记完整RAG验收通过。当前实现、启用和限制见[平台统一检索调整报告](agent-v2-knowledge-platform-report.md)。
## 2026-11-10：跨知识库精确片段去重

已实现基于 SHA-256、换行统一及 Unicode NFC 的检索片段去重：授权后合并、重排及最终截取前去重，重复副本不额外提升排名；正文只返回一份，`sources` 保留各有效来源。原件和版本独立，文档分页不变，无新增迁移。API 编译检查通过，当前不标记数据库或真实模型链路验收通过。实现范围、静态验证及回退见[去重报告](agent-v2-knowledge-dedup-report.md)。

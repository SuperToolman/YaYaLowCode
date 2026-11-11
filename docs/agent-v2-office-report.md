# AgentV2 办公文件能力实施记录

日期：2026-10-30。属于 AgentV2 文件工具层，不是低代码平台业务权限，也不要求给员工另装一个 Excel Skill。员工原有 BOM 等 Skill 负责业务流程，文件工具负责真实解析和生成。

## 本批范围

| 格式 | 读取 | 生成 | 明确限制 |
| --- | --- | --- | --- |
| XLSX | 多工作表、类型、行列坐标、公式和缓存值、分页 | 多工作表，字符串/数值/布尔/空值，简单表头 | 不执行公式、宏或外部连接；生成是新值表，不保留原模板样式/图表 |
| XLS | 通过 Calamine 接入 | 不生成旧格式 | 本批没有真实 XLS 样本验收，需补格式兼容回归 |
| ODS | 多工作表与单元格，独立样本通过 | 不生成 | 使用与 XLSX 相同分页合同 |
| CSV/TSV | 正确处理引号、逗号、换行和 UTF-8 BOM，行列分页 | 继续通过文本写工具 | 不自动猜测非 UTF-8 编码 |
| DOCX | 主文档段落及表格单元格坐标 | 标题、段落、矩形表格 | 不含页眉页脚、批注、脚注、图片 OCR 与修订保真 |
| PPTX | 按 presentation 关系顺序读取幻灯片文字 | 标题及短段落的基础幻灯片 | 不提取图表/备注/嵌入表格；不支持复杂模板及视觉保真编辑 |
| PDF | 按页提取文字，空文字页返回 needsOcr | 本批不生成 | 不包含 OCR，不保证复杂表格/阅读顺序；加密或损坏返回错误 |
| DOC/PPT 旧二进制 | 明确拒绝并提示转为 DOCX/PPTX | 不生成 | 不假装已读取 |

本批完成的是常见办公文件读取及基础 Office 生成，不代表“任意办公格式、任意模板及全部编辑功能”已实现。

## 架构与执行

新增独立 Rust crate `agent-v2/office`，依赖 Calamine 0.37.0、rust_xlsxwriter 0.102.0、quick-xml 0.42.0、zip 9.1.3、pdf-extract 0.12.1，版本及传递依赖写入 V2 Cargo.lock。核心及 Worker 仍使用原有锁定 Rig/Cordis，不引用 DSH。

API 的 office adapter 只负责进程协议和资源管理。解析器从 stdin 接收字节和结构化选项，通过 stdout 返回 protocolVersion=1 JSON，不接收数据库连接、用户 JWT、模型密钥或用户磁盘路径。每次请求一个独立进程，环境清空；Windows 仅保留 SystemRoot。解析代码不解析外链、执行宏、脚本或启动外部程序，不将 ZIP 成员解压到磁盘。

解析在数据库锁外运行，避免阻塞心跳/取消。完成后重新检查用户、员工/许可证/安装及任务快照，再验证当前执行 epoch/运行状态；只有有效任务能发布产物。产物继续使用不可变 files 对象、会话归属、配额、事件事务及 run/invocation 去重。XLSX 创建日期固定，ZIP 内容确定性测试跨进程通过，避免恢复时重新生成不同字节。

这是受限文件解析进程，不等同于通用 Shell/插件 OS 沙盒，P8 的任意代码执行能力没有开放。

## 工具合同

- `workspace_read_file` 升至 v2：保持 fileId；可选 sheet、start、limit、column、columns。start/column 为 1 基。表格返回带坐标/类型的 rows，含 sheets、行列总数、nextStart/nextColumn；文档返回按段落/幻灯片/页分页的 units。不得把第一页当作整个文件。
- `workspace_write_document` v1：name 和 document。XLSX 为 `{sheets:[{name,header,rows:[[标量值]]}]}`；DOCX 为 `{title,paragraphs:[string],tables:[{rows:[[string]]}]}`；PPTX 为 `{slides:[{title,paragraphs:[string]}]}`。输出必须为 xlsx/docx/pptx，不能通过扩展名伪装文本。原 `workspace_write_file` 保留。
- 基础工作区工具不新增员工业务权限。可用员工直接获得文件工具，新任务写入能力快照。老运行任务合同 hash 不匹配时要求重新提交；不会扩张旧任务权限。
- Worker 附件适配对 Office 元数据明确引导调用读工具；不再在尝试工具前要求用户转 CSV。大 CSV 不再因自动内联超过文本预算而直接终止整轮任务。
- 损坏/不支持/超限通过可诊断 error 返回，Worker 保存 tool.failed，模型可继续解释或调整分页，不把失败显示为工具成功。
- 文本写工具拒绝 Office、PDF、图片及 ZIP 等二进制扩展名，返回 `binary_output_requires_document_tool`；防止把普通文字命名为 `.xlsx` 后当作有效办公产物。办公文件必须通过真实文档生成工具创建。
- 无新增公开 HTTP DTO，工具定义由既有内部协议传递，故本批不重新生成 OpenAPI/SDK。

## 限额

保留单文件 8 MiB、单会话 100 MiB/200 文件、单消息 8 文件/16 MiB。解析并发最多 2，等待名额 2 秒，墙钟 20 秒，进程 CPU 10 秒、内存 512 MiB（Windows Job Object；Unix setrlimit，Linux 分支尚未实测）。stdio 输入/输出最多 12 MiB。

ZIP 最多 2048 成员、声明总展开 32 MiB、单成员 8 MiB，另有限压缩比；XML 拒绝 DTD、深度最多 128。解析结果最多 192 KiB，过大明确要求减少分页，不静默丢行。表格页最多 200 行 × 64 列，工作表最多 100 个。PDF 最多 1000 页、PPTX 输入最多 500 页；大文档还受进程预算限制。生成输入最多 192 KiB；XLSX 最多 10 表/10000 单元格，DOCX 表格有限行列，PPTX 最多 30 页，并限制每页文字预算。

## 启动、部署与验证

```powershell
.\scripts\start-dev.ps1 -SkipLegacyAgent -SkipDshBuild
.\scripts\check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline
# 单独验证文件工具
$env:CARGO_TARGET_DIR="$PWD/agent-v2/target/validation"
cargo test --manifest-path agent-v2/Cargo.toml -p yaya-agent-v2-office --locked --offline
```

开发启动、独立 API 启动和检查脚本会构建 helper 并设置 `YAYA_AGENT_V2_OFFICE_PATH`。生产可以指定绝对路径或将 helper 放在 API 可执行文件旁。两个现有 API 镜像 Dockerfile 已增加构建/复制步骤，隔离源码检查包含 office crate；没有 Docker 的本机环境不把镜像构建标为已验证。旧 Agent 入口和默认行为保留。

本地证据：

- `agent-v2/target/office-tests.log`：Rust 解析、生成、坐标/分页、Unicode、公式缓存、字符串公式注入防护、确定性、恶意 ZIP/XML，以及真实受限子进程测试。
- `agent-v2/target/office-database-tests.log`：真实 PostgreSQL/HTTP broker 创建 XLSX/DOCX/PPTX、读取、下载 OOXML 字节和重复调用去重通过；既有跨主体/会话、旧 epoch、取消及配额测试保留。
- `agent-v2/target/office-interoperability.log`：独立 openpyxl/python-docx/python-pptx 成功读取工具生成文件；反向读取独立库生成的 XLSX/DOCX/PPTX/PDF 以及 ODS 样本通过。Python 仅为测试依赖，不参与产品运行。
- 前端范围测试 22 项通过、ESLint 通过。完整脚本结果在 `agent-v2/target/office-full-tests-final.log`；不得用第一次因 Windows pipe 未关闭而失败的日志代替最终结果。该缺陷已经修复并由 broker 测试覆盖。
- 最后一轮针对性回归 `agent-v2/target/office-database-final.log` 已通过：真实 PostgreSQL/HTTP broker 综合用例（包含办公文件读写及伪装二进制拒绝）、7 个设计合同测试、1 个预览测试及 3 个确认卡测试。未使用正式业务数据作为测试夹具。
- 开发启动已实测：通过 `start-dev.ps1 -SkipLegacyAgent -SkipDshBuild` 重新构建并启动当前 API、Worker、前端。API `/healthz` 与前端 `/agent-v2` 返回 HTTP 200，Worker 已记录 ready；日志在 `agent-v2/target/office-startup-final.log`。前端可达不代表已登录用户的端到端验收。实际部署到开发环境的 helper 再次通过独立格式互操作检查，证据为 `agent-v2/target/office-runtime-interoperability.log`。

真实已授权员工/模型/浏览器完整办公链路、原生 Office 应用渲染、Linux 进程限制及生产镜像仍需独立登记，不能仅凭文件级/数据库测试标为通过。当前浏览器处于登录页，不使用绕过登录的手段验收用户会话。既有全 Web 类型错误另见工作区报告。

## 回退

本批没有数据库迁移。回退前停止活跃 V2 任务，API/Worker/helper 配套回退；保留已生成的工作区文件，不删除用户对象。工具合同变更后的旧任务需重新提交，不尝试无依据继续执行。旧 DSH 不参与解析或产物生成。

## 办公读取后的续答失败排查（2026-11-02）

原任务 `291be516-73cf-4745-88c3-0ef59525d541` 的真实数据库记录显示三次 workspace_read_file 均 completed：Sheet1 为 18 行 × 5 列，Sheet2/Sheet3 为空；没有解析异常、能力拒绝或许可证失败。失败发生在第 3 次模型请求（step 2），不能把界面的 execution_failed 解释为没有 Excel 解析能力。

旧 Worker 把 empty_model_response 和 invalid_tool_call_id 漏归类成 execution_failed，失败步骤未保存供应商用量，因此无法追溯证明原次失败属于哪一种。新版本保留明确错误码；空响应按现有次数重试，已提交工具结果保持 checkpoint。生成 token 上限由写死 4096 改为默认 8192、环境变量 YAYA_AGENT_V2_MAX_COMPLETION_TOKENS（1–32768）；推理同样消耗此预算。达到预算不把截断输出当成功，返回 model_output_limit 并保存安全用量事件。前端显示对应原因，不归咎于文件解析；不展示或记录私有推理文本。供应商错误日志只追加类别和 HTTP 状态。

读取原 checkpoint 的隔离真实 BYOM 重放没有重新解析文件、执行新工具或修改源会话：首次 4096 预算下返回了有效正文和一个后续工具调用（3904 completion，其中 1837 reasoning）；8192 预算的最终重放成功（5425 completion，其中 2925 reasoning），证明此工作负载确有超过旧预算的风险，但不能据此断言原次历史失败一定由预算耗尽导致。中间一次供应商请求曾返回 provider_rejected，后续同配置成功，未将该次失败隐瞒为通过。

证据：`agent-v2/target/office-replay-diagnostic.log`、`office-replay-final.log`。新增故障注入覆盖推理耗尽预算、空响应、错误码和用量事件，真实 PostgreSQL/假供应商/真实 Cordis 与 Worker 四边界重启均通过（`office-worker-database.log`）；前端 7 文件/34 测试和限定 ESLint 通过（`office-frontend-regression.log`、`office-frontend-lint.log`）。重放只验证续答，不宣称已在原用户会话生成最终整理文件；原失败记录和附件保持原状。无需为本次问题另装 Excel Skill，也未修改正式员工能力勾选。

## 附件预览 Base64 换行与模型调用排查（2026-11-03）

本次 run `3282c33c-74b3-4253-a000-ba5e61dd82e7` 在 step 0 失败，Worker 仅保留 `provider_error_kind=provider,http_status=unknown`，不能据此确认是密钥、额度、网络或模型参数问题。当前相同 BYOM 路由的 HTTP 流式请求可用；新增 `worker/examples/model-probe.rs` 使用相同 Rig 0.40.0、模型、系统提示和工具目录验证到首个解码流式项，不执行工具、不写业务数据。该探针未复现完整附件模型输入，也未等待完整生成，不能当作原任务或端到端通过。原次失败原因仍未确定；新增固定白名单诊断原因，避免打印供应商正文、密钥或私有推理。前端补充模型调用失败提示。

最近三个附件预览均存在独立的确定性问题：`office_document_rejected / Invalid symbol 10, offset 76.`。PostgreSQL `encode(contents,'base64')` 每 76 字符插入 LF，基础预览直接将其交给严格 Base64 解码器；下载及模型附件路径原本已有移除换行逻辑。Office helper 现在先限制原始输入长度，再移除 CR/LF，并继续检查编码长度、解码后二进制长度和非法符号。解析缓存版本从 `office-0.1.0-preview-1` 升为 `office-0.1.0-preview-2`，避免新任务复用旧失败缓存，不删除原失败记录或用户附件。

验证：`cargo test --locked -p yaya-agent-v2-office` 实际 14 项通过，包含 LF/CRLF、非法符号及真实资源受限子进程；从当前数据库只读获取原附件 `b6f61c04-e03f-48ec-8414-7bce3924c8ad`，通过修复后的真实 helper 成功识别 3 个工作表，未输出文件内容。`cargo test --locked -p yaya-agent-v2-worker --bin yaya-agent-v2-worker` 实际 5 项通过（含真实 Cordis），1 项 PostgreSQL 综合测试按环境条件跳过，不计通过。前端 runtime-core/submission-flow 两文件 17 项通过，定向 ESLint 通过。

同时清除发送请求提交成功后的瞬态“已排队”提示，后续执行状态由持久 run 状态负责，避免任务失败后输入框仍显示排队。未重放原失败任务、未修改员工能力、未安装 Skill 业务依赖。需重启开发 API/Worker/helper 后重新发送任务验证完整链路；旧失败任务不会自动恢复。

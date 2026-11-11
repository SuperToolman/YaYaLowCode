# AgentV2 发送与附件处理实施报告

日期：2026-11-02。状态：本批代码与分层测试完成，迁移已应用、开发服务已启动；真实浏览器附件全链路尚未验收，不标记整个 P6 或 AgentV2 完成。

## 当前发送行为

选择、拖放、粘贴、移除文件及输入文字仅修改浏览器内存，不上传、不创建正式会话。点击发送后计算 SHA-256，冻结正文、有序附件清单、员工、可选会话和稳定 clientRequestId，建立独立发送请求。最多两个附件并发以 application/octet-stream 上传；前端通过生成 SDK 和二进制 BFF 原样传输，不再 Base64 JSON 上传。原会话上传接口保留兼容。

上传全部完成后提交冻结请求。正式数据事务成功前保留发送框内容、锁定员工和会话切换，不把临时附件放入工作区，不伪装已发送消息。成功后选择服务端返回的正式会话、重载持久消息与工作区并连接事件。失败可重试，已经上传的文件不重复上传；结果未知先查询原请求。放弃上传中止本地请求并向服务端解析最终状态；若提交已胜出则恢复提交结果，取消执行仍走原停止任务入口。放弃请求的网络查询失败时保持冻结但解锁重试。

## API 与数据一致性

- POST `/api/agent/v2/submissions`：幂等创建冻结请求。
- GET `/api/agent/v2/submissions/{id}`：恢复冻结内容、上传情况及最终结果。
- PUT `/api/agent/v2/submissions/{id}/attachments/{clientFileId}`：单个原始二进制上传。
- POST `/api/agent/v2/submissions/{id}/commit`：无替换正文或附件参数的提交。
- DELETE `/api/agent/v2/submissions/{id}`：放弃未提交请求；已提交返回原结果。
- GET `/api/agent/v2/sessions/{id}/file-previews`：读取持久基础解析状态。

迁移 `m20261102_000104_agent_v2_submissions` 注册于平台现有迁移器；SQL 为 `agent-v2/core/upgrade_submissions.sql`。新增 submissions、staged_files、file_previews，run 新增 attachment_prepare_deadline。不迁移历史附件归属。

请求按部署、认证用户和 clientRequestId 唯一；相同指纹返回原请求，变化返回冲突。上传校验实际长度、SHA-256 和文件签名，不信任浏览器 MIME。同一附件重复相同字节幂等，冲突字节拒绝。

提交锁定请求，再核验用户、员工使用权、安装、许可证、目标会话和额度；在同一 PostgreSQL 事务内创建或复用正式会话、转正文件、调用 submit_in_transaction 保存消息/命令/run/初始事件和标题、记录最终 IDs 并清除临时字节。任何一步失败整体回滚。会话额度在会话锁内检查，临时额度通过用户数据库锁串行预留；提交、放弃、清理锁定相同请求。隔离取认证身份，不接受客户端传入用户身份；旧 Agent 不参与该链路。

| 额度 | 数值 |
| --- | --- |
| 单文件 | 1 字节至 8 MiB |
| 单消息 | 8 附件、合计 16 MiB |
| 正式会话 | 100 MiB、200 文件 |
| 每用户临时预留 | 100 MiB、200 附件，按声明大小预留 |
| 未提交有效期 | 24 小时，不因上传续期 |
| 清理 | API 启动及每 10 分钟分批清理过期/放弃字节 |
| 请求元数据 | 默认保留 30 天供幂等恢复；不删除正式文件或消息 |

## 刷新恢复

localStorage 按用户保存已经点击发送的请求 ID 和冻结元数据，不保存文件字节和密钥；退出登录清除当前用户记录。未发送草稿刷新即丢弃。刷新后已提交则恢复正式会话；全部上传则继续提交；缺失附件则恢复正文并要求重新选择，名称、大小、hash 全部匹配后才上传。请求过期、已放弃或权限失效明确报错，不自动创建新请求。恢复元数据写入失败时不会启动网络提交。此机制不等于分片或字节级断点续传。

## Worker 基础解析

正式消息提交成功后、首次模型请求前，Worker 通过独立 Rust Office helper 对本轮附件生成样本；图片仍以 Rig 原生图片内容发送，小文本仍作为不可信用户数据传入。历史附件只读取既有缓存，并保持现有访问校验。

| 格式 | 基础样本 |
| --- | --- |
| XLSX/XLS/ODS/CSV/TSV | 工作表目录、首个工作表最多 10 行 × 8 列 |
| DOCX | 前 10 个内容单元 |
| PPTX、文字 PDF | 前 3 页/幻灯片 |
| PNG/JPEG/WebP | 不生成文字预览，原生视觉内容 |

单文件样本最多 8 KiB、本轮最多 8 个附件即 64 KiB；通过缩减结构化样本而非截断 JSON 满足预算。输出标明 sampleOnly、完整性、采样缩减、继续读取及不可信内容。完整内容、其他工作表或后续页面通过 workspace_read_file 分页，不把样本等同于全文。损坏、超时、不支持或扫描 PDF 缺文字结果均有明确限制，不新增 OCR。

缓存以正式文件 ID、hash、解析器 `office-0.1.0-preview-1`、规则版本 1 保存，不跨文件或会话共享。run 的持久截止时间控制总预算 60 秒，重启不会重置预算；预算不足跳过并提示后续按需读取。API 保存 parsing/终结结果及 attachment.parsing/attachment.parsed 事件时校验执行权、epoch 和取消状态；旧 Worker 无权覆盖。前端同时读取持久状态，不依赖 SSE 单次投递。取消或失败终止时不会接收晚到结果；查询接口结合持久 run 终态，将未完成解析返回为 skipped 和明确中断原因，避免刷新后长期显示解析中。此路径已由真实数据库/API 用例覆盖，实际浏览器取消场景仍待验收。

## 实际验证与命令

```powershell
.\scripts\start-dev.ps1 -SkipLegacyAgent -SkipDshBuild
.\scripts\check-agent-v2.ps1 -UseLocalDevelopmentDatabase -Offline
.\scripts\test-agent-v2-independence.ps1
Push-Location web
node node_modules/vitest/vitest.mjs run features/agent-v2 "app/(protected)/agent-v2/page.test.tsx" "app/api/agent/v2/[...segments]/route.test.ts"
Pop-Location
```

开发启动已通过，API 8788 健康接口 200，Next 8787 就绪，Worker ready；查询开发库确认新迁移及 attachment_prepare_deadline 已存在。未启动旧 DSH。Rig 0.40.0、Cordis 4.0.0-rc.12，Office crate 0.1.0。

| 本地证据 | 结果与范围 |
| --- | --- |
| agent-v2/target/submissions-full-final.log | 完整检查脚本通过：真实 PostgreSQL/API、Cordis 生命周期、授权/确认/恢复/共享平台回归、假 Rig 及 Worker 终止重启 |
| agent-v2/target/submissions-web-final.log | V2 前端 7 文件 33 测试通过；含并发 2、重试、刷新恢复、丢响应、放弃竞争及放弃失败解锁 |
| agent-v2/target/submissions-office-final.log | Office 13 测试通过，含真实 helper 进程、多工作表/结构化样本预算 |
| agent-v2/target/submissions-independence.log | 不复制旧 DSH 的独立构建及真实 Cordis 验证通过 |
| agent-v2/target/submissions-live-model.log | 已授权 BYOM 的真实 Rig 流式、diagnostic_echo 工具及恢复通过；不代表真实办公/视觉端到端通过 |
| agent-v2/target/submissions-lint-final.log / submissions-lint-followup.log | 本批限定 ESLint 及最后 Hook 修改检查通过 |
| agent-v2/target/submissions-cancel-preview.log | 最后取消解析状态修改后真实 API/数据库、设计/预览及确认卡回归通过 |
| agent-v2/target/submissions-types.log | 全 Web 类型检查仍被既有 MyTable.test.tsx:66 类型错误阻断，未声称全项目类型通过 |
| agent-v2/target/submissions-startup-final.log / submissions-startup-final-error.log | 开发服务启动记录；迁移与健康另经数据库/HTTP 查询确认 |

新增数据库用例包括：临时阶段零正式写入、缺附件零副作用、错误 hash、重复上传/提交、跨用户隔离、响应丢失恢复、清理、撤权、真实 CSV 解析及缓存、旧 epoch/取消拒绝。注入文件转正后数据库失败，确认会话/文件/任务全部回滚；8 个并发 16 MiB 临时预留只接受 6 个，不超过 100 MiB。BFF 用实际 Node HTTP 验证二进制字节不重编码。假供应商检查实际 Rig 图片与缓存样本序列化。

证据日志位于本机 target，非长期 CI 归档。完整脚本执行后又补了 Office 样本、前端放弃失败用例；对应最终专项日志为最后结果，未为文档修改重复运行全量。

## 未验证项与交付边界

本次浏览器访问 localhost 登录页被工具 URL 安全策略拒绝；遵守限制未绕过。尚未通过已登录浏览器、Next BFF、API、Worker、真实 Rig 串联验收图片、Excel、混合附件以及上传/提交边界刷新。真实 BYOM 文本/诊断工具、实际 HTTP 二进制代理、真实 Office helper 和数据库链路分别通过，不能替代该端到端证据。Docker/Linux 生产运行和原生 Office 渲染也未在本批实测。XLS 仍缺真实样本；OCR、旧 DOC/PPT、复杂模板、完整视觉成功验收不属于已通过能力。

## 回退

先停止新发送入口并停止/排空 V2 Worker；回退 API/前端到兼容版本时保留本批表、列、正式文件、消息和任务，不自动 down migration 或删除客户数据。已提交请求不得重新发送成新任务；可保留查询恢复或人工核对结果。临时字节按既定有效期清理，不处理正式工作区。旧附件接口保留，旧 Agent 保持独立入口。此报告仅记录发送与基础附件处理增量，不宣称 P6、P4 或完整 AgentV2 验收完成。

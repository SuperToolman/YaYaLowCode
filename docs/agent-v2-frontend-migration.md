# AgentV2 前端组件与链路迁移

本轮基于实际源码检查三个目录。旧目录保留以维持旧入口；V2 所有组件位于 `web/features/agent-v2`，不 import 旧 feature 或 DSH 客户端。不能将本轮组件迁移等同于完整 V2 功能完成。

## 已接入 V2 的迁移

| 来源 | V2 落点 | 状态 |
| --- | --- | --- |
| agent-assistant/AgentMessageComposer | components/AgentMessageComposer | 独立副本；MySurface、2～10 行、IME、发送和停止 |
| agent-assistant/AgentMarkdown | components/AgentMarkdown | Markdown 展示和文本规范化；复用公共 MarkdownRenderer |
| agent-assistant/AgentMessage | components/AgentMessage | 用户/员工消息、流式等待、执行状态；移除旧文件下载耦合 |
| agent-assistant/AgentThinkBlock | components/AgentThinkBlock | 思考块展示就绪；当前 Worker 尚无 reasoning 事件，不宣称实际推送已支持 |
| agent-assistant/AgentToolCallCard | components/AgentToolCallCard | 接入 V2 持久事件；按 run + call 合并开始/完成，参数、结果、复制 |
| agent-workbench/SessionItem | components/SessionItem | 适配 HeroUI ListBox 和 V2 会话 DTO，运行/失败状态 |
| agent-workbench/AgentEmployeeCard | components/AgentEmployeeAvatar | 整合头像能力到现有员工下拉交互；继续使用平台员工头像服务 |
| agent-workbench/runtime、runtime-core | runtime.ts、runtime-core.ts | 独立实现 V2 状态、命令、SSE、消息投影；不复制 DSH reducer、Mux 或 RPC |
| agent-workbench/platform-api | client.ts | 使用现有 V2 生成 SDK；只访问 V2 会话、员工、消息、命令接口 |

## 文件与资源边界

`agent-resources` 在本轮工作区中为空，没有可复制的组件或接口。后续若资源 UI 位于别处，应按实际文件补充盘点。

`WorkspaceFiles` 已迁为 V2 独立展示组件，文件 DTO 自持，下载 URL 由调用方注入，移除了硬编码旧 `/api/agent/sessions/.../artifacts`。V2 目前没有文件列表、上传、下载和产物 API，因此尚未在工作台挂载该面板；不调用旧接口冒充实现，不生成虚构的 V2 下载地址。

## 尚须开发的完整链路

1. V2 文件上传/下载/产物列表、所有权与员工授权校验、图片预览、文件状态以及模型多模态支持；完成后挂载 WorkspaceFiles 和发送框附件功能。
2. 会话搜索（后端过滤与分页）、置顶、重命名、归档、恢复和彻底删除；不能复用旧 platform-api 的会话接口。
3. 资源/Skill/插件授权列表与安装、独立 Cordis 兼容包、工作区文件访问约束；优先提取平台资源服务，禁止转接 DSH。
4. 审批、写入确认、历史分页、未读活动和页面上下文能力；需 V2 API/事件合同支持，不能机械复制旧 RPC 命令。
5. RAG 与检索入口及结果引用，当前首批协议尚未实现。

旧版删除前必须完成上列链路及权限、故障恢复、历史访问验收。当前不能删除旧系统。

## 验证

页面测试覆盖历史、发送、首次自动建会话、重试幂等键、停止、重连、撤权清理、头像选择、IME。V2 核心测试覆盖工具合并与 run 隔离、流式与持久消息去重和排序。独立性测试禁止 V2 源码引用旧 feature、DSH 或旧会话地址；HTTP 边界检查约束生成 SDK 的使用。

本轮没有浏览器登录验证或新增后端能力。全量 TypeScript 检查仍被既有 `app/components/my-fields/MyTable.test.tsx:66` 的 children 类型错误阻断；V2 无新增类型错误。

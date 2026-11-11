# AgentV2 向量检索、RRF 与重排实现记录

当前业务规则已由[平台统一检索调整](agent-v2-knowledge-platform-report.md)覆盖：不再按用户分别配置和构建，当前所有有效平台用户可读。下文个人profile描述为前序实现记录。

日期：2026-11-09。基线提交：949b8a2c8e5b02c9c6a59f067337257a40f8ac60；当前实现仍为工作区修改。本批为K3/K4的混合检索增量实现，只有编译和定向静态证据，未标记真实模型、数据库或生产验收通过。

## 本批链路

授权知识范围 → 关键词召回40条 + Embedding精确余弦召回40条 → RRF融合 → 最多40条可选Reranker重排 → 当前权限与版本复核 → 最多10条持久引用 → Agent回答与原文面板。

K3关键词首批的工具、权限快照和引用合同继续复用。本批没有增加员工工具许可，也没有自动修改、发布或更新任何员工包。已经拥有 knowledge_search/knowledge_read_document 的员工无需为本次向量功能新增能力。

## 配置与凭据

在 `/settings/model-providers` 增加“知识检索”按钮：

- 启用混合检索后，单独选择已有已启用供应商连接、Embedding模型及其实际输出维度（1—4096）。聊天模型列表不限制Embedding模型名称，也不把聊天模型当成向量模型。
- 可选启用重排，独立选择供应商连接和Reranker模型，可与Embedding使用不同供应商。
- 可选择允许降级：索引尚未就绪或向量请求失败时返回明确标注的关键词结果；重排失败时返回明确标注的RRF结果。关闭降级时返回明确未就绪或失败错误。
- 配置属于当前用户，修改/重试需要现有 `settings.models.manage` 权限。没有自动引入全平台共享密钥或将管理员个人配置分发给其他用户。
- 使用BYOM已加密密钥，只在API内按用户所有权解析。知识配置、任务快照、Worker、Cordis、API响应和日志均不包含明文密钥。
- Embedding协议为 OpenAI-compatible `/embeddings`，请求float输出；验证data/index数量、唯一性、实际维度、有限数值及非零范数。配置维度用于校验，不擅自给不支持降维的模型发送dimensions参数。
- 重排协议为兼容 `/rerank` 的model/query/documents/top_n，响应需包含唯一合法index及有限relevance_score，覆盖送入的全部候选。并不声称支持所有供应商原生协议。
- 供应商地址记录hash；地址变更需重新保存配置，不把旧向量默默交给新端点。密钥轮换继续走原BYOM加密配置，不必把密钥保存到profile。

## 向量存储与构建

新增平台增量迁移117：`knowledge_vector_profiles`、`knowledge_vector_jobs`、`knowledge_vectors` 和精确余弦计算函数。不安装扩展、不扩大数据库角色权限。

当前后端明确为 `postgres-array-exact-cosine-v1`，用PostgreSQL double precision数组持久化归一化向量，在授权版本范围内精确计算余弦并取候选。它是真实向量召回，但不是pgvector/HNSW/ANN索引；大规模扩展优化仍为待办。单次范围最多20000分块，数据库查询超时5秒；超限/超时按配置明确降级或拒绝，不把任意截断的部分范围当作完整混合召回。

首次检索按当前有权访问的已解析文档安排索引任务；保存配置本身不会扫描并外发全部知识。每次后台任务处理最多16分块，使用90秒执行权与epoch，HTTP连接10秒/总计30秒、响应最多8MiB。完成批次后继续入队，不把长远程调用放在数据库锁内。API关闭取消当前等待，重启后任务可重新领取。

每个profile/generation的中间向量只用于继续构建；整份generation的向量数量与完整分块数量一致并标记ready后才参与检索。查询范围内有未就绪文档时，本轮整体降级或报错，不暗中将不完整向量结果当成全部语义召回。查询前后检查完整性，向量召回在同一个可重复读事务快照中复核构建状态与读取候选。

构建前后重新检查用户有效性、当前知识权限、员工包许可证/安装版本和文档当前解析版本。保存向量时检查profile仍生效、generation仍有效、任务epoch与执行权，并锁定对应资源；旧执行者不能覆盖新批次。网络/限流/5xx等可重试故障最多3次，认证/参数/维度/响应合同错误不自动重试。设置页面显示当前文档版本的就绪、构建中、失败计数与安全诊断，可显式重试失败项。

不同用户profile不共享向量缓存。配置内容、模型、维度、供应商地址或重排策略变化会生成新profile，新任务使用新版本并按需重建；完全相同配置保存复用原profile，不打断构建。旧profile及其向量保留，不自动删除用户文件或历史数据；旧索引清理和容量策略仍需发布前补齐。

## 融合、重排与一致性

- 关键词沿用中文双字/ASCII标识符GIN，按查询词覆盖排名；向量使用同一文档解析generation的分块。
- RRF固定k=60、排名从1开始、两路等权，按chunk去重：每个召回列表贡献 `1/(60+rank)`。不会直接相加词覆盖率和余弦分数。最终同分按chunk ID稳定排序。
- 重排只接收融合后的最多40条、已经再次授权且仍属于当前版本的片段；失效/撤权来源在发送给重排供应商前排除。重排返回排序再次校验，异常时按配置退回原RRF，不接受越界、重复或缺失索引。
- 结果模式为 `keyword-cjk-bigram-ascii-v1`、`hybrid-rrf-k60-v1` 或 `hybrid-rrf-k60-reranked-v1`，同时返回semanticSearch、rerankerEnabled和limitations。排名分数不是事实置信度。
- Agent发送事务冻结vectorProfile ID，profile本体不可变。任务期间配置切换/停用不悄悄改用新模型，而返回重新发送提示；缺少此快照的历史任务保持关键词规则。
- 当前用户RBAC、原知识范围和内容版本检查继续是硬条件。供应商故障降级不绕过资源授权；最终片段仍经既有引用事务、fencing及来源hash校验。
- 检索排名模式及降级原因与引用ID一起持久保存。已有检索结果恢复先走缓存并重新过滤撤权来源，不重新调用Embedding/Reranker；同一调用参数变化仍冲突。进程在外部只读请求完成但本地事务提交前崩溃，可能重复供应商请求和计费，不承诺外部请求恰好一次。
- 原文读取不重新Embedding或重排；引用继续绑定用户、run、版本、chunk及hash。知识删除级联清理向量、构建任务和来源引用；已生成会话文字按原历史保留规则处理。

## 接口与前端

- `GET /api/knowledge/retrieval-settings`：当前用户配置、当前版本索引计数与诊断。
- `PUT /api/knowledge/retrieval-settings`：保存独立用途配置，凭据引用已有BYOM连接。
- `POST /api/knowledge/retrieval-settings/retry`：重试当前profile、当前文档版本的失败任务。
- 原knowledge search、Agent broker和citation接口复用；OpenAPI、生成SDK和Next BFF PUT代理同步。
- 供应商设置新增HeroUI模态框、开关与选择器。知识试搜和Agent工具卡显示实际模式及原因提示，继续使用V2组件、HeroUI和Gravity图标，没有CSS Module。

## 本轮检查

遵循用户此前的手动测试安排，本轮没有运行测试套件、浏览器、真实供应商请求或业务数据库迁移，没有改动客户知识文档及正式员工配置，也未重启开发进程。

| 检查 | 结果与日志 |
| --- | --- |
| 客户API cargo check，独立target | 通过；`agent-v2/target/validation/knowledge-hybrid-api-check.log` |
| AgentV2 workspace cargo check，独立target | 通过；`knowledge-hybrid-worker-check.log` |
| 运营中心API cargo check，独立target | 通过；`knowledge-hybrid-operation-check.log`，仅更新能力描述 |
| API export-only OpenAPI导出 | 通过；`knowledge-hybrid-openapi.log`，不启动数据库迁移 |
| `pnpm run codegen:api` | 通过 |
| knowledge目录、供应商设置页面及知识BFF定向ESLint | 通过 |
| Web tsc --noEmit | 仅既有 `MyTable.test.tsx(66,195)` children类型错误；日志 `knowledge-hybrid-web-types.log`。不能标记全Web通过 |

## 启动与手测

1. 正常重启配套服务 `./scripts/start-dev.ps1`，核对平台迁移115/116/117执行结果。本轮只编译和导出，没有代为应用业务库迁移。
2. 在模型供应商页面配置支持 `/embeddings` 的连接与真实向量模型，填写模型实际维度；需要重排则配置支持 `/rerank` 的模型。供应商如果只有聊天协议会明确报不兼容，不会伪造向量。
3. 选择独立测试知识库和测试资料，确认解析完成。首次试搜安排构建，默认会明确显示关键词降级；在知识检索设置中查看构建状态，完成后再次试搜，应显示混合模式或已重排。
4. 使用已有知识工具能力的员工发送新任务，选择有权访问的应用知识库；观察工具结果实际模式、回答来源及刷新后的引用。可分别关闭重排、启用重排对比排序。
5. 由用户手测：错误维度、错误密钥、429/超时、禁用降级、profile切换、文档更新、撤权/删除、跨用户/员工/应用访问、Worker/API重启与重复调用。没有这些证据前不标记KR03—KR09及真实链路通过。

## 明确保留的门槛

- 当前精确数组后端未做真实数据库执行/计划/容量验证。pgvector/HNSW、可部署扩展、ANN参数与大库性能尚未实现或实测，不能把本批标记为原架构所有K3项完成。
- 真实Embedding/Reranker供应商兼容性、实际索引构建、RRF相关性收益、中文/料号样本、忠实度、Windows/Linux与升级迁移仍待实测。本批没有以假模型、静态编译或零用例替代验收。
- 供应商同名模型在远端发生隐式版本漂移无法自动证明一致；应采用可固定的模型版本标识，供应商变更后重新配置/构建，不能只凭维度相同宣称向量空间兼容。
- 当前分块器按结构与UTF-8字节有界，未使用供应商精确tokenizer；超出供应商输入限制会保存明确错误，不静默截断资料。
- 旧profile的自动保留/清理和容量运维规则、质量标注集、生产容量及发布验收继续保留。

## 回退

先停止使用新协议的活跃任务，再回退配套API/Worker/Web及运营中心能力描述代码；保留117表、向量、正式知识原件与会话数据，不执行破坏性down，不恢复旧DSH。关闭混合检索使之后的新任务按关键词运行；它不是清理历史数据或修改旧任务快照的操作。


## 2026-11-09：客户平台统一知识检索规则（覆盖先前个人配置规则）

Embedding/Reranker由客户平台统一配置、统一构建并共享向量；运营中心只发布员工知识原件。当前所有有效登录用户均可读取平台知识，不叠加知识读取RBAC；管理操作权限、部署隔离、员工安装/许可证/包版本、任务范围和私人会话隔离保留。迁移118保存部署profile和独立密文平台连接，旧个人profile保留停用，管理员需要显式保存一次平台配置。后台自动安排已解析有效资料的共享向量任务。新任务ruleVersion=2，旧任务不自动扩展。

本轮API编译、OpenAPI/SDK及定向ESLint通过；Web仍仅有原MyTable类型错误。未升级业务库、未运行数据库/浏览器/模型或回归测试，不标记完整RAG验收通过。当前实现、启用和限制见[平台统一检索调整报告](agent-v2-knowledge-platform-report.md)。

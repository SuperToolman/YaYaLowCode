# 低代码开发工程师首批能力调整实施记录

日期：2026-11-06。状态：首批代码接入和编译/静态检查通过；未做模型、数据库、浏览器或业务验收。本记录不宣称能力方案 E0—E7 已全部完成。

关联：[能力调整方案](agent-v2-low-code-engineer-capability-plan.md)。

## 已落地

1. 从真实设计器 `DesignerFieldProps`、运行时字段类型、组件默认值与现有 Manifest、自动化编辑器配置类型生成产品合同。26 种组件（其中 HTML/TSX 只提供合同、不开放写入）、13 类节点、39 个复用类型定义；详细语义覆盖仍不完整。生成资源由 Rust 编译内嵌，部署后不依赖 Node 解析前端源码、向量索引或运营中心在线查询。
2. 新增组件目录/精确合同、自动化合同/节点合同和两种纯预检工具。读取精确合同只携带其可达的类型定义，不把全量目录一次塞入模型上下文。表单通用合同保留旧字段，增加详细合同入口。
3. 组件属性校验与 V2 Schema/T31 保存共用；补属性类型、枚举、嵌套配置、未知属性、选项重复，以及关联显示字段、回填源/目标字段存在性检查。既有布局、父子、存储、完整字段权限和版本检查保留。没有把未经核验的新规则强加给原设计器保存入口。
4. 自动化纯预检复用产品节点规范化、现协议检查、图检查、节点类型限制、引用表单和现有获取/删除/子表数据校验；不调用执行引擎、不创建业务记录、不请求外部接口。创建预览与实际创建共用预检，保存仍为暂停状态。
5. 新增显式授权的 `platform_update_automation`，仅允许修改已暂停的普通集成自动化。要求 baseVersion，展示完整节点/连线 before/after，复用原确认、资源锁、effect 与事务保存。启用中流程和审批流程拒绝，不新增启用、试跑或凭据写入能力。
6. 设计预检/保存核对引用表单当前权限与任务快照、完整字段可读；补丁生成目标也检查保留引用。初期采取保守策略：部分字段可见时拒绝完整设计预检，而不是泄露被过滤字段。V2 不使用员工 applicationIds。
7. 执行上下文加入产品合同 hash，Worker 首次准备时冻结、恢复及后续工具入口检查。合同变化提示重新提交任务，不自动扩大既有任务能力。工具注册表变化也沿用原版本不兼容提示。确认预览记录当前产品合同身份。
8. 加入空应用开发、按需读取规范、校验修正、真实资源 ID、部分成功保留、无知识资料仍可开始及准确交付指引。不编辑正式员工包或商品，不修改客户业务数据。
9. 运营中心工具目录增加“修改集成自动化设计” `yaya_update_automation`；修正创建自动化错误的 draft 描述为“暂停”，补规范与纯校验的说明。现有勾选结果不变。

## 工具与授权

| 工具 | 员工能力来源 | 行为 |
| --- | --- | --- |
| platform_list_component_contracts / platform_get_component_contract | 既有读取 Schema/规范、创建表单、保存 Schema、T31 中任一明确能力 | 产品元数据，只读；用户仍须有开发相关权限，或 apps.manage |
| platform_validate_form_design | 保存 Schema 或 T31 | 目标表单开发查看、显示与完整字段读取，沿用当前与快照交集；不写入 |
| platform_get_automation_contract / platform_get_automation_node_contract / platform_validate_automation_design | 读取图、创建自动化或显式更新能力 | 合同为只读；实例预检另外检查目标应用自动化权限及引用资源 |
| platform_update_automation | 仅 yaya_update_automation（也接受完全相同的规范工具 ID） | 版本化写预览、人工确认、仅暂停的非审批流程 |

配套只读工具映射是显式代码规则，不把读取权限解释成写入。任务快照只在新任务冻结，不向既有任务补入新工具。运营端新增写能力需人工选取、正常保存发布、客户市场更新安装后对新任务生效。

## 合同覆盖清单

这里的“已导出”仅代表类型与默认值可读取，不代表每个高级组件或节点都已完成业务验收。组件专属属性可见性/互斥、公式语法、跨字段类型兼容等仍需继续补齐。

| 组件 ID | 名称 | 本批 V2 设计写入范围 |
| --- | --- | --- |
| groupContainer | 分组组件 | normal/workflow，仍需校验与确认 |
| subform | 子表单 | normal/workflow，仍需校验与确认 |
| richText | 富文本 | normal/workflow，仍需校验与确认 |
| html | HTML 组件 | 不支持；只提供类型信息 |
| tsx | TSX 组件 | 不支持；只提供类型信息 |
| serialNumber | 流水号 | normal/workflow，仍需校验与确认 |
| associationFormField | 关联表单 | normal/workflow，仍需校验与确认 |
| countryCity | 国家/地区 | normal/workflow，仍需校验与确认 |
| cascader | 级联选择 | normal/workflow，仍需校验与确认 |
| singleLineText | 单行文本 | normal/workflow，仍需校验与确认 |
| description | 描述 | normal/workflow，仍需校验与确认 |
| separator | 分割线 | normal/workflow，仍需校验与确认 |
| multiLineText | 多行文本 | normal/workflow，仍需校验与确认 |
| radio | 单选框 | normal/workflow，仍需校验与确认 |
| checkbox | 复选框 | normal/workflow，仍需校验与确认 |
| select | 下拉菜单 | normal/workflow，仍需校验与确认 |
| multiSelect | 下拉复选 | normal/workflow，仍需校验与确认 |
| link | 链接 | normal/workflow，仍需校验与确认 |
| date | 日期 | normal/workflow，仍需校验与确认 |
| dateRange | 日期区间 | normal/workflow，仍需校验与确认 |
| attachment | 附件 | normal/workflow，仍需校验与确认 |
| imageUpload | 图片上传 | normal/workflow，仍需校验与确认 |
| member | 成员 | normal/workflow，仍需校验与确认 |
| department | 部门 | normal/workflow，仍需校验与确认 |
| button | 按钮 | normal/workflow，仍需校验与确认 |
| number | 数值 | normal/workflow，仍需校验与确认 |

| 节点 ID | 编辑器配置类型 | 本批边界 |
| --- | --- | --- |
| trigger | TriggerConfig | 集成自动化设计；不启用或运行 |
| condition | ConditionConfig | 集成自动化设计；不启用或运行 |
| parallel-condition | ConditionConfig | 集成自动化设计；不启用或运行 |
| get-one | GetDataConfig | 集成自动化设计；不启用或运行 |
| get-many | GetDataConfig | 集成自动化设计；不启用或运行 |
| add-data | AddDataConfig | 集成自动化设计；不启用或运行 |
| update-data | ActionConfig | 集成自动化设计；不启用或运行 |
| delete-data | ActionConfig | 集成自动化设计；不启用或运行 |
| http-request | ActionConfig | 集成自动化设计；不启用或运行 |
| initiate-approval | InitiateApprovalConfig | 集成自动化设计；不启用或运行 |
| approval | AssigneeConfig | 审批流程合同只读，不开放本批写入 |
| executor | AssigneeConfig | 审批流程合同只读，不开放本批写入 |
| copy | CopyConfig | 审批流程合同只读，不开放本批写入 |

## 启动与维护

在 web 目录：

```powershell
# 修改设计器类型/默认值/合同后更新生成资源
node scripts/export-development-contracts.mjs
# 检查已提交资源是否仍与产品源码一致
node scripts/export-development-contracts.mjs --check
```

`web/package.json` 提供 `contract:development:export/check`；predev 和既有 V2 检查脚本已加入陈旧资源检查。生成资源需与源码一起提交，不能只发布前端类型而不更新 API。直接 cargo build 使用随源码保存的资源；发布前必须执行上述 check，尚未实测跨 Windows/Linux 生成一致性。

客户平台重启使用 `./scripts/start-dev.ps1`。运营中心沿用自身启动脚本。API、Worker 配套升级后新建任务；不要期待旧冻结任务自动获取新工具。现有会话/文件保留。当前会话无知识文档不阻止查询规范或设计，空白表单创建仍使用原确认接口。

本次没有新增公共 HTTP 路由、没有变更公共 DTO，也没有新增数据库表或迁移。工具参数通过既有通用 broker JSON 合同传输，新增 hash 属于内部执行上下文；不维护第二套前端 HTTP 客户端，也无需为未变化的公开 DTO 重生成 SDK。

## 实际检查

- 客户 API：`cargo check --locked --manifest-path api/Cargo.toml --target-dir agent-v2/target/validation` 通过；日志 `agent-v2/target/validation/development-contract-check.log`。
- Worker：`cargo check --locked --manifest-path agent-v2/Cargo.toml --target-dir agent-v2/target/validation -p yaya-agent-v2-worker` 通过；日志 `agent-v2/target/validation/development-worker-check.log`。
- 运营 API：在相邻项目执行 `cargo check --locked --manifest-path api/Cargo.toml --target-dir api/target/knowledge-validation` 通过；日志 `api/target/knowledge-validation/development-catalog-check.log`。
- 合同导出与 `--check` 通过，实际统计26组件/13节点/39复用类型；未知源类型仅明确的 `unknown`，并未声称支持对其做完整语义校验。
- 定向 ESLint：导出脚本与修改的前端组件 Manifest 通过。
- 按用户此前偏好，本轮不执行回归、浏览器、数据库与真实模型测试，不将编译成功计为功能验收。

## 尚未完成

- E0 尚不是对所有产品行为、正式安装员工配置的完整盘点；这里只核对并导出了现有源码合同。
- E1/E2 属于首批接入：每组件专属属性/条件、互斥、完整 pageProps、公式语义、关联子表回填类型等仍需精确补齐。Designer-wide props Schema 包含其他组件可用属性，不能宣称每个通用属性对每个组件都有意义。
- E3 接入节点合同与预检/更新入口，但完整变量作用域、全部字段映射类型、错误路径和节点配置业务约束尚未全量覆盖；纯校验通过不代表真实执行成功。
- E4 外部试跑、真实业务集成、审批流程编排、生产启用没有开放。
- E5 运营目录已编码；正式员工方法/能力发布和客户安装更新未操作。
- E6 全部 LC01—LC18 保持待实际验收；没有真实模型从零开发或复杂采购案例证据。
- RAG 检索和 MCP 服务适配按独立专项推进，不作为本批合同查询的依赖。

因此不能标记“复杂低代码开发工程师已全面完成”。下一批应优先补组件专属属性及跨字段语义，再补自动化完整映射/作用域与人工案例验收。

## 回退

先停止受影响活跃任务，再配套回退 API/Worker；保留现有业务资源、确认、effect、消息和文件。无新迁移需要删除，不自动撤销已批准的设计，不恢复旧 DSH。已更新员工包若含新增操作，应在旧版平台上保持未知工具拒绝，不能映射成通用写权限。

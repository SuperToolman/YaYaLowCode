import { Card, Chip, Separator, Typography } from "@heroui/react";

// Customer-facing labels cover both published aliases and versioned tool IDs.
const capabilityGroups: { title: string; labels: Record<string, string> }[] = [
  {
    title: "应用管理",
    labels: {
      list_apps: "查看应用",
      create_app: "创建应用",
      update_app: "编辑应用",
      delete_app: "删除应用",
      get_application_business_context: "了解应用业务背景",
    },
  },
  {
    title: "表单搭建",
    labels: {
      list_forms: "查看表单",
      get_field_outline: "查看字段概览",
      list_navigation_groups: "查看导航分组",
      create_navigation_group: "创建导航分组",
      delete_navigation_group: "删除导航分组",
      move_form_to_group: "调整表单分组",
      get_form_schema: "查看表单结构",
      get_form_schema_contract: "查看表单设计规范",
      list_component_contracts: "查看可用表单组件",
      get_component_contract: "查看组件使用说明",
      validate_form_design: "检查表单设计",
      create_form: "创建表单",
      create_detail_form: "创建明细表",
      save_form_schema: "保存表单设计",
      apply_design_patch: "修改表单设计",
      delete_form: "删除表单",
    },
  },
  {
    title: "业务数据分析",
    labels: {
      get_form_relationships: "查看表单关联关系",
      get_related_records: "追溯关联数据",
      list_form_records: "查看业务数据",
      query_records: "按条件查询数据",
      aggregate_records: "汇总统计数据",
      get_detail_form_definition: "查看明细表结构",
      list_detail_records: "查看明细数据",
    },
  },
  {
    title: "自动化与工作流",
    labels: {
      list_automations: "查看自动化任务",
      get_automation_graph: "查看自动化流程",
      get_automation_contract: "查看自动化设计规范",
      get_automation_node_contract: "查看自动化节点说明",
      validate_automation_design: "检查自动化设计",
      create_automation: "创建自动化流程",
      update_automation: "修改自动化流程",
      delete_automation: "删除自动化流程",
      get_workflow_process_definition: "查看审批流程",
      get_workflow_record_runtime: "跟踪审批进度",
    },
  },
  {
    title: "知识与文件处理",
    labels: {
      knowledge_search: "检索知识库",
      knowledge_read_document: "阅读知识资料",
      skill_list_resources: "查看专业技能资料",
      skill_read_resource: "阅读专业技能资料",
      workspace_list_files: "查看任务文件",
      workspace_read_file: "阅读与分析文件",
      workspace_write_file: "生成文本文件",
      workspace_write_document: "生成办公文档",
      skill_run_script: "运行技能脚本",
      workspace_execute_code: "执行代码与命令",
      diagnostic_echo: "运行连通性检查",
    },
  },
];

const aliases: Record<string, string> = {
  query_form_records: "query_records",
  aggregate_form_records: "aggregate_records",
  create_automation_draft: "create_automation",
};

export function EmployeeCapabilities({
  allowedTools,
  installed,
}: {
  allowedTools?: string[] | null;
  installed: boolean;
}) {
  if (allowedTools == null || allowedTools.length === 0) {
    return (
      <Card aria-label="员工能力" variant="secondary">
        <Card.Content>
          <Card.Description>
            {allowedTools == null
              ? installed
                ? "暂时无法获取能力信息，请更新员工后重试。"
                : "安装后即可查看这位员工的具体能力。"
              : "暂未提供扩展能力信息，可在基础信息中了解这位员工的工作内容。"}
          </Card.Description>
        </Card.Content>
      </Card>
    );
  }

  const tools = [...new Set(allowedTools)].map((id) => {
    const normalized = id.replace(/^(?:platform_|yaya_)/, "");
    return { id, normalized: aliases[normalized] ?? normalized };
  });
  const knownIds = new Set<string>();
  const groups = capabilityGroups.map(({ title, labels }) => {
    const names: Record<string, string> = labels;
    const items = tools.flatMap(({ id, normalized }) => {
      if (!Object.hasOwn(names, normalized)) return [];
      knownIds.add(id);
      return [{ id, label: names[normalized] }];
    });
    return { title, items };
  });
  groups.push({
    title: "扩展能力",
    items: tools
      .filter(({ id }) => !knownIds.has(id))
      .map(({ id }) => ({ id, label: "自定义能力" })),
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <Typography>已配置能力</Typography>
        <Chip.Label>共 {tools.length} 项</Chip.Label>
      </div>
      <div className="space-y-4 mt-2">
        {groups
          .filter(({ items }) => items.length > 0)
          .map(({ title, items }) => (
            <Card key={title} aria-label={title} variant="secondary">
              <Card.Header className="flex-row items-center justify-between">
                <Card.Title className="text-sm">{title}</Card.Title>
                <Chip size="sm" variant="soft">
                  <Chip.Label>{items.length}</Chip.Label>
                </Chip>
              </Card.Header>
              <Card.Content className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map(({ id, label }) => (
                  <Card key={id}>
                    <Card.Content className="min-w-0 space-y-2">
                      <Chip size="md" color="accent" variant="soft">
                        <Chip.Label>{label}</Chip.Label>
                      </Chip>
                      <Card.Description className="break-all font-mono text-xs">
                        {id}
                      </Card.Description>
                    </Card.Content>
                  </Card>
                ))}
              </Card.Content>
            </Card>
          ))}
      </div>
    </div>
  );
}

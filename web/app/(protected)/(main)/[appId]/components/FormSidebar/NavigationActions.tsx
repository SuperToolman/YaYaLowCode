"use client";

import { Dropdown, SearchField, Button } from "@heroui/react";
import {
  Plus as AddIcon,
  FileText as FormIcon,
  Code as DefinedPageIcon,
  ArrowRightArrowLeft as WorkflowFormIcon,
} from "@gravity-ui/icons";
import { AppSidebarToggle } from "../AppSidebarToggle";
import type { useFormSidebar } from "./useFormSidebar";

type Props = Pick<
  ReturnType<typeof useFormSidebar>,
  "canCreateForm" | "canCreateGroup" | "handleCreateForm" | "setCreateGroupOpen"
>;

export function NavigationActions({
  canCreateForm,
  canCreateGroup,
  handleCreateForm,
  setCreateGroupOpen,
}: Props) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <SearchField
        aria-label="搜索表单"
        name="search"
        className="min-w-0 flex-1"
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="搜索表单..." />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      <div className="flex items-center gap-1">
        {canCreateForm || canCreateGroup ? (
          <Dropdown>
            <Button isIconOnly aria-label="新增导航项" variant="secondary">
              <AddIcon />
            </Button>
            <Dropdown.Popover>
              <Dropdown.Menu
                aria-label="新增导航项"
                onAction={(key) => {
                  if (key === "form") {
                    handleCreateForm("normal");
                  }
                  if (key === "workflow-form") {
                    handleCreateForm("workflow");
                  }
                  if (key === "defined-form") {
                    handleCreateForm("defined");
                  }
                  if (key === "group") {
                    setCreateGroupOpen(true);
                  }
                }}
              >
                {canCreateForm ? (
                  <Dropdown.Item id="form" textValue="创建普通表单">
                    <span className="flex items-center gap-2">
                      <FormIcon />
                      创建普通表单
                    </span>
                  </Dropdown.Item>
                ) : null}
                {canCreateForm ? (
                  <Dropdown.Item id="defined-form" textValue="创建自定义页面">
                    <span className="flex items-center gap-2">
                      <DefinedPageIcon />
                      创建自定义页面
                    </span>
                  </Dropdown.Item>
                ) : null}
                {canCreateForm ? (
                  <Dropdown.Item id="workflow-form" textValue="新增流程表单">
                    <span className="flex items-center gap-2">
                      <WorkflowFormIcon />
                      新增流程表单
                    </span>
                  </Dropdown.Item>
                ) : null}
                {canCreateGroup ? (
                  <Dropdown.Item id="group">创建分组</Dropdown.Item>
                ) : null}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        ) : null}
        <AppSidebarToggle />
      </div>
    </div>
  );
}

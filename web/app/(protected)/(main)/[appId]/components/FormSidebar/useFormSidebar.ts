"use client";
import { notifyRequestError } from "@/shared/lib/notify";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createForm, createNavigationGroup, deleteForm, deleteNavigationGroup, moveFormNavigation, updateNavigationGroup, updateFormName } from "@/features/application/api";
import { getAppNavigation, getAppForms } from "@/features/application/resources";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { APP_NAVIGATION_CHANGED_EVENT, notifyAppNavigationChanged, type AppNavigationChangedDetail } from "@/features/application/navigation-events";

import { applyFormTypes, buildNavigationTree, expandGroupsFromItems, filterNavigationTree, flattenGroups, isNavigationDescendant } from "./navigation-utils";
import type { FormSidebarProps, NavigationItem, SidebarNode, GroupAction, FormAction } from "./types";

import { ROOT_PARENT_VALUE } from "./constants";
import { useNavigationDrag } from "./useNavigationDrag";
import { useExpandedGroups } from "./useExpandedGroups";
import { copyEmptyNavigationGroup, copyFormSchema, nextCopyName } from "@/features/application/copy-navigation";
import { notify } from "@/shared/lib/notify";

export function useFormSidebar({ routeAppId }: FormSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { hasPermission, permissionsReady } = useAuth();
  const canCreateForm = hasPermission(`app:${routeAppId}:create_form`);
  const canCreateGroup = hasPermission(`app:${routeAppId}:create_group`);
  const [items, setItems] = useState<NavigationItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useExpandedGroups(routeAppId);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [createFormType, setCreateFormType] = useState<
    "normal" | "workflow" | "defined"
  >("normal");
  const [createFormName, setCreateFormName] = useState("");
  const [createFormSubmitting, setCreateFormSubmitting] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupParentId, setGroupParentId] = useState(ROOT_PARENT_VALUE);
  const [selectedGroup, setSelectedGroup] = useState<NavigationItem | null>(
    null,
  );
  const [groupActionOpen, setGroupActionOpen] = useState(false);
  const [groupAction, setGroupAction] = useState<GroupAction | null>(null);
  const [groupActionValue, setGroupActionValue] = useState("");
  const [groupActionPending, setGroupActionPending] = useState(false);
  const [selectedForm, setSelectedForm] = useState<NavigationItem | null>(null);
  const [formActionOpen, setFormActionOpen] = useState(false);
  const [formAction, setFormAction] = useState<FormAction | null>(null);
  const [formActionValue, setFormActionValue] = useState("");
  const [formActionPending, setFormActionPending] = useState(false);
  const formActionInFlight = useRef(false);
  const copyInFlight = useRef(false);
  const navigationRequestId = useRef(0);
  const tree = useMemo(
    () =>
      buildNavigationTree(
        routeAppId,
        permissionsReady ? (items as unknown as NavigationItem[]) : [],
      ),
    [permissionsReady, routeAppId, items],
  );
  const groupOptions = useMemo(() => flattenGroups(tree), [tree]);
  const visibleTree = useMemo(
    () => filterNavigationTree(tree, searchQuery),
    [searchQuery, tree],
  );
  const visibleExpandedGroups = useMemo(() => {
    if (!searchQuery.trim()) return expandedGroups;
    const next = { ...expandedGroups };
    const expandVisibleGroups = (nodes: SidebarNode[]) => {
      for (const node of nodes) {
        if (node.itemType === "group") next[node.id] = true;
        expandVisibleGroups(node.children);
      }
    };
    expandVisibleGroups(visibleTree);
    return next;
  }, [expandedGroups, searchQuery, visibleTree]);
  const moveGroupOptions = useMemo(() => {
    if (!selectedGroup) return groupOptions;
    return groupOptions.filter(
      (option) =>
        option.id !== selectedGroup.id &&
        !isNavigationDescendant(items, option.id, selectedGroup.id),
    );
  }, [groupOptions, items, selectedGroup]);

  const refreshNavigation = useCallback((force = true) => {
    const requestId = ++navigationRequestId.current;
    void (async () => {
      try {
        const [navigation, forms] = await Promise.all([
          getAppNavigation(routeAppId, force),
          getAppForms(routeAppId, force),
        ]);
        if (requestId !== navigationRequestId.current) return;
        const nextItems = applyFormTypes(
          navigation as unknown as NavigationItem[],
          forms,
        );
        startTransition(() => {
          setItems(nextItems as unknown as NavigationItem[]);
          setErrorMessage("");
          setExpandedGroups((current) =>
            expandGroupsFromItems(
              nextItems as unknown as NavigationItem[],
              current,
            ),
          );
        });
      } catch {
        if (requestId === navigationRequestId.current) {
          setErrorMessage("导航刷新失败，请稍后重试。");
        }
      }
    })();
  }, [routeAppId, setExpandedGroups, startTransition]);

  useEffect(() => {
    if (permissionsReady) refreshNavigation(false);
    return () => {
      // Discard responses from an earlier app, refresh or unmounted sidebar.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- This is a request counter, not a DOM ref.
      navigationRequestId.current++;
    };
  }, [permissionsReady, refreshNavigation]);

  useEffect(() => {
    function handleNavigationChanged(event: Event) {
      const detail = (event as CustomEvent<AppNavigationChangedDetail>).detail;
      if (detail?.appId === routeAppId) {
        refreshNavigation();
      }
    }

    window.addEventListener(
      APP_NAVIGATION_CHANGED_EVENT,
      handleNavigationChanged,
    );
    return () => {
      window.removeEventListener(
        APP_NAVIGATION_CHANGED_EVENT,
        handleNavigationChanged,
      );
    };
  }, [refreshNavigation, routeAppId]);

  function handleCreateForm(
    formType: "normal" | "workflow" | "defined" = "normal",
  ) {
    setCreateFormType(formType);
    setCreateFormName("");
    setCreateFormOpen(true);
  }

  function closeCreateForm() {
    if (!createFormSubmitting) setCreateFormOpen(false);
  }

  function submitCreateForm() {
    if (createFormSubmitting) return;
    setErrorMessage("");
    setCreateFormSubmitting(true);

    void (async () => {
      try {
        const { data, error } = await createForm({
          path: { appId: routeAppId },
          body: { formType: createFormType },
          responseStyle: "fields",
        });
        if (error || !data || data.code !== 0 || !data.data) {
          setErrorMessage(data?.message || "创建表单失败。");
          return;
        }

        let nameUpdateFailed = false;
        if (createFormName.trim()) {
          try {
            const renameResult = await updateFormName({
              path: { formUuid: data.data.id },
              body: { name: createFormName.trim() },
              responseStyle: "fields",
            });
            if (renameResult.error || renameResult.data?.code !== 0) {
              nameUpdateFailed = true;
              setErrorMessage(
                "表单已创建，但名称更新失败。请在侧栏中修改名称。",
              );
            }
          } catch {
            nameUpdateFailed = true;
            setErrorMessage("表单已创建，但名称更新失败。请在侧栏中修改名称。");
          }
        }

        setCreateFormOpen(false);
        notifyAppNavigationChanged(routeAppId);
        if (nameUpdateFailed) return;
        router.push(`/designer/${data.data.id}?appId=${routeAppId}`);
      } catch {
        setErrorMessage("创建表单失败，请稍后重试。");
      } finally {
        setCreateFormSubmitting(false);
      }
    })();
  }

  function handleCreateGroup() {
    const nextTitle = groupName.trim();

    if (!nextTitle) {
      return;
    }

    setErrorMessage("");

    void (async () => {
      try {
        const { data, error } = await createNavigationGroup({
          path: { appId: routeAppId },
          body: {
            title: nextTitle,
            parent_id:
              groupParentId === ROOT_PARENT_VALUE ? null : groupParentId,
          },
          responseStyle: "fields",
        });
        if (error || !data || data.code !== 0) {
          setErrorMessage(data?.message || "创建分组失败。");
          return;
        }

        setGroupName("");
        setGroupParentId(ROOT_PARENT_VALUE);
        setCreateGroupOpen(false);
        notifyAppNavigationChanged(routeAppId);
      } catch {
        setErrorMessage("创建分组失败，请稍后重试。");
      }
    })();
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  }

  async function copyNavigationItem(node: SidebarNode) {
    if (copyInFlight.current) return;
    if (node.itemType === "form" ? !canCreateForm : !canCreateGroup) {
      notify.error("没有创建副本的权限");
      return;
    }
    copyInFlight.current = true;
    try {
      const navigation = await getAppNavigation(routeAppId, true);
      const source = navigation.find((item) => item.id === node.id);
      if (!source) throw new Error("原导航项已不存在，请刷新后重试。");
      const siblings = navigation.filter((item) => (item.parentId ?? null) === (source.parentId ?? null));
      const name = nextCopyName(source.title, siblings.map((item) => item.title));
      if (source.itemType === "group") {
        await copyEmptyNavigationGroup(routeAppId, name, source.parentId);
      } else {
        if (!source.targetFormUuid) throw new Error("原表单不存在");
        await copyFormSchema(routeAppId, source.targetFormUuid, name, node.formType, source.parentId);
      }
      notify.success(`已复制为 ${name}`);
    } catch (error) {
      notifyRequestError(error, "复制失败", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      notifyAppNavigationChanged(routeAppId);
      copyInFlight.current = false;
    }
  }

  function openGroupAction(node: SidebarNode, action: GroupAction) {
    if (action === "copy") { void copyNavigationItem(node); return; }
    const group = items.find((item) => item.id === node.id);
    if (!group) return;
    setSelectedGroup(group);
    setGroupAction(action);
    setGroupActionOpen(true);
    setGroupActionValue(
      action === "rename" ? group.title : (group.parentId ?? ROOT_PARENT_VALUE),
    );
  }

  function closeGroupAction() {
    if (groupActionPending) return;
    setGroupActionOpen(false);
  }

  function handleGroupAction() {
    if (!selectedGroup || !groupAction) return;
    const title =
      groupAction === "rename" ? groupActionValue.trim() : selectedGroup.title;
    if (groupAction === "rename" && !title) return;
    setGroupActionPending(true);
    setErrorMessage("");

    void (async () => {
      try {
        const request =
          groupAction === "delete"
            ? deleteNavigationGroup({
                path: { appId: routeAppId, groupId: selectedGroup.id },
                responseStyle: "fields",
              })
            : updateNavigationGroup({
                path: { appId: routeAppId, groupId: selectedGroup.id },
                body: {
                  title,
                  parent_id:
                    groupAction === "move"
                      ? groupActionValue === ROOT_PARENT_VALUE
                        ? null
                        : groupActionValue
                      : (selectedGroup.parentId ?? null),
                },
                responseStyle: "fields",
              });
        const { data, error } = await request;
        if (error || !data || data.code !== 0) {
          setErrorMessage(
            data?.message ||
              `${groupAction === "delete" ? "删除" : "更新"}分组失败。`,
          );
          return;
        }
        closeGroupAction();
        notifyAppNavigationChanged(routeAppId);
      } catch {
        setErrorMessage(
          `${groupAction === "delete" ? "删除" : "更新"}分组失败，请稍后重试。`,
        );
      } finally {
        setGroupActionPending(false);
      }
    })();
  }

  function openFormAction(node: SidebarNode, action: FormAction) {
    if (action === "copy") { void copyNavigationItem(node); return; }
    const form = items.find((item) => item.id === node.id);
    if (!form?.targetFormUuid) return;
    setSelectedForm(form);
    setFormAction(action);
    setFormActionOpen(true);
    setFormActionValue(
      action === "rename" ? form.title : (form.parentId ?? ROOT_PARENT_VALUE),
    );
  }

  function closeFormAction() {
    if (formActionInFlight.current) return;
    setFormActionOpen(false);
  }

  function handleFormAction() {
    if (formActionInFlight.current || !selectedForm?.targetFormUuid || !formAction) return;
    const name = formActionValue.trim();
    if (formAction === "rename" && !name) return;
    formActionInFlight.current = true;
    setFormActionPending(true);
    setErrorMessage("");

    void (async () => {
      try {
        const request =
          formAction === "delete"
            ? deleteForm({
                path: { formUuid: selectedForm.targetFormUuid! },
                responseStyle: "fields",
              })
            : formAction === "move"
              ? moveFormNavigation({
                  path: {
                    appId: routeAppId,
                    formUuid: selectedForm.targetFormUuid!,
                  },
                  body: {
                    parent_group_id:
                      formActionValue === ROOT_PARENT_VALUE
                        ? null
                        : formActionValue,
                  },
                  responseStyle: "fields",
                })
              : updateFormName({
                  path: { formUuid: selectedForm.targetFormUuid! },
                  body: { name },
                  responseStyle: "fields",
                });
        const result = await request;
        const response = result.data as
          { code?: number; message?: string } | undefined;
        if (result.error || !response || response.code !== 0) {
          const actionLabel = formAction === "delete" ? "删除" : "更新";
          notify.error(`${actionLabel}表单失败`, {
            description: response?.message || "请稍后重试。",
          });
          return;
        }
        if (formAction === "rename") {
          setItems((current) =>
            current.map((item) =>
              item.id === selectedForm.id
                ? { ...item, title: name }
                : item,
            ),
          );
          notify.success("表单名称已更新");
        }
        setFormActionOpen(false);
        if (formAction === "delete") {
          setItems((current) => current.filter(
            (item) => item.targetFormUuid !== selectedForm.targetFormUuid,
          ));
          notify.success("表单已删除");
        }
        notifyAppNavigationChanged(routeAppId);
        if (
          formAction === "delete" &&
          pathname === `/${routeAppId}/${selectedForm.targetFormUuid}`
        ) {
          router.push(`/${routeAppId}`);
        }
      } catch {
        notify.error(`${formAction === "delete" ? "删除" : "更新"}表单失败`, {
          description: "请稍后重试。",
        });
      } finally {
        formActionInFlight.current = false;
        setFormActionPending(false);
      }
    })();
  }

  const {
    dragState,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    clearDragState,
  } = useNavigationDrag({
    routeAppId,
    items,
    setItems,
    setExpandedGroups,
    startTransition,
    setErrorMessage,
  });

  return {
    pathname,
    canCreateForm,
    canCreateGroup,
    items,
    searchQuery,
    setSearchQuery,
    expandedGroups,
    visibleTree,
    visibleExpandedGroups,
    isPending,
    errorMessage,
    createGroupOpen,
    setCreateGroupOpen,
    createFormOpen,
    setCreateFormOpen,
    createFormType,
    createFormName,
    setCreateFormName,
    createFormSubmitting,
    closeCreateForm,
    submitCreateForm,
    groupName,
    setGroupName,
    groupParentId,
    setGroupParentId,
    selectedGroup,
    groupActionOpen,
    groupAction,
    groupActionValue,
    setGroupActionValue,
    groupActionPending,
    selectedForm,
    formActionOpen,
    formAction,
    formActionValue,
    setFormActionValue,
    formActionPending,
    dragState,
    sensors,
    tree,
    groupOptions,
    moveGroupOptions,
    handleCreateForm,
    handleCreateGroup,
    toggleGroup,
    openGroupAction,
    closeGroupAction,
    handleGroupAction,
    openFormAction,
    closeFormAction,
    handleFormAction,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    clearDragState,
  };
}

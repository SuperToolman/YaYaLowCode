"use client";
import { notifyRequestError } from "@lib/notify";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createForm,
  createNavigationGroup,
  deleteForm,
  deleteNavigationGroup,
  moveFormNavigation,
  updateNavigationGroup,
  updateFormName,
} from "@/features/application/api";
import {
  getAppNavigation,
  getAppForms,
  invalidateAppResources,
} from "@lib/app-resources";
import { useAuth } from "@components/AuthProvider";
import {
  APP_NAVIGATION_CHANGED_EVENT,
  type AppNavigationChangedDetail,
} from "../app-navigation-events";

import {
  applyFormTypes,
  buildNavigationTree,
  expandGroupsFromItems,
  flattenGroups,
  isNavigationDescendant,
} from "./navigation-utils";
import type {
  FormSidebarProps,
  NavigationItem,
  SidebarNode,
  GroupAction,
  FormAction,
} from "./types";

import { ROOT_PARENT_VALUE } from "./constants";
import { useNavigationDrag } from "./useNavigationDrag";
import { copyEmptyNavigationGroup, copyFormSchema, nextCopyName } from "@/features/application/copy-navigation";
import { notify } from "@lib/notify";

export function useFormSidebar({ routeAppId }: FormSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { hasPermission, permissionsReady } = useAuth();
  const canCreateForm = hasPermission(`app:${routeAppId}:create_form`);
  const canCreateGroup = hasPermission(`app:${routeAppId}:create_group`);
  const [items, setItems] = useState<NavigationItem[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
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
  const [groupAction, setGroupAction] = useState<GroupAction | null>(null);
  const [groupActionValue, setGroupActionValue] = useState("");
  const [groupActionPending, setGroupActionPending] = useState(false);
  const [selectedForm, setSelectedForm] = useState<NavigationItem | null>(null);
  const [formAction, setFormAction] = useState<FormAction | null>(null);
  const [formActionValue, setFormActionValue] = useState("");
  const [formActionPending, setFormActionPending] = useState(false);
  const formActionInFlight = useRef(false);
  const copyInFlight = useRef(false);
  const tree = useMemo(
    () =>
      buildNavigationTree(
        routeAppId,
        permissionsReady ? (items as unknown as NavigationItem[]) : [],
      ),
    [permissionsReady, routeAppId, items],
  );
  const groupOptions = useMemo(() => flattenGroups(tree), [tree]);
  const moveGroupOptions = useMemo(() => {
    if (!selectedGroup) return groupOptions;
    return groupOptions.filter(
      (option) =>
        option.id !== selectedGroup.id &&
        !isNavigationDescendant(items, option.id, selectedGroup.id),
    );
  }, [groupOptions, items, selectedGroup]);

  useEffect(() => {
    if (!permissionsReady) return;
    let cancelled = false;

    void (async () => {
      try {
        const [navigation, forms] = await Promise.all([
          getAppNavigation(routeAppId),
          getAppForms(routeAppId),
        ]);
        const nextItems = applyFormTypes(
          navigation as unknown as NavigationItem[],
          forms,
        );
        if (!cancelled) {
          startTransition(() => {
            setItems(nextItems as unknown as NavigationItem[]);
            setExpandedGroups((current) =>
              expandGroupsFromItems(
                nextItems as unknown as NavigationItem[],
                current,
              ),
            );
          });
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("导航加载失败，当前展示本地数据。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [permissionsReady, routeAppId]);

  const refreshNavigation = useCallback(() => {
    void (async () => {
      try {
        const [navigation, forms] = await Promise.all([
          getAppNavigation(routeAppId, true),
          getAppForms(routeAppId, true),
        ]);
        const nextItems = applyFormTypes(
          navigation as unknown as NavigationItem[],
          forms,
        );
        startTransition(() => {
          setItems(nextItems as unknown as NavigationItem[]);
          setExpandedGroups((current) =>
            expandGroupsFromItems(
              nextItems as unknown as NavigationItem[],
              current,
            ),
          );
        });
      } catch {
        setErrorMessage("导航刷新失败，请稍后重试。");
      }
    })();
  }, [routeAppId, startTransition]);

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
        invalidateAppResources(routeAppId, ["forms", "navigation"]);
        refreshNavigation();
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
        invalidateAppResources(routeAppId, ["navigation"]);
        refreshNavigation();
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
      invalidateAppResources(routeAppId, ["forms", "navigation"]);
      refreshNavigation();
      copyInFlight.current = false;
    }
  }

  function openGroupAction(node: SidebarNode, action: GroupAction) {
    if (action === "copy") { void copyNavigationItem(node); return; }
    const group = items.find((item) => item.id === node.id);
    if (!group) return;
    setSelectedGroup(group);
    setGroupAction(action);
    setGroupActionValue(
      action === "rename" ? group.title : (group.parentId ?? ROOT_PARENT_VALUE),
    );
  }

  function closeGroupAction() {
    if (groupActionPending) return;
    setSelectedGroup(null);
    setGroupAction(null);
    setGroupActionValue("");
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
        invalidateAppResources(routeAppId, ["navigation"]);
        refreshNavigation();
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
    setFormActionValue(
      action === "rename" ? form.title : (form.parentId ?? ROOT_PARENT_VALUE),
    );
  }

  function closeFormAction() {
    if (formActionInFlight.current) return;
    setSelectedForm(null);
    setFormAction(null);
    setFormActionValue("");
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
        setSelectedForm(null);
        setFormAction(null);
        setFormActionValue("");
        if (formAction === "delete") {
          setItems((current) => current.filter(
            (item) => item.targetFormUuid !== selectedForm.targetFormUuid,
          ));
          notify.success("表单已删除");
        }
        invalidateAppResources(routeAppId, ["forms", "navigation"]);
        refreshNavigation();
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
    expandedGroups,
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
    groupAction,
    groupActionValue,
    setGroupActionValue,
    groupActionPending,
    selectedForm,
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createLocalUser, deleteUser, initializeLocalCredentials, listRoles, listUsers, updateUser, type UpdateUserRequest } from "../api";
import { toUserFormValues } from "./user-form";
import { filterUsers, normalizeUser, type RoleItem, type UserItem } from "./user-list";

export function useUserManagement() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(null); try { const [userResult, roleResult] = await Promise.all([listUsers({ responseStyle: "fields" }), listRoles({ responseStyle: "fields" })]); if (userResult.error || userResult.data?.code !== 0 || !userResult.data.data) throw new Error(userResult.data?.message || "无法加载用户"); if (roleResult.error || roleResult.data?.code !== 0 || !roleResult.data.data) throw new Error(roleResult.data?.message || "无法加载角色"); setUsers(userResult.data.data.map(normalizeUser)); setRoles(roleResult.data.data.filter((role) => role.status === "active")); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载用户"); } finally { setLoading(false); } }, []);
  // Load remote identity data when the controller is mounted.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const filteredUsers = useMemo(() => filterUsers(users, query, "all", "all"), [query, users]);
  const update = useCallback(async (userId: string, body: UpdateUserRequest) => { const result = await updateUser({ path: { userId }, body, responseStyle: "fields" }); if (result.error || result.data?.code !== 0) throw new Error(result.data?.message || "更新用户失败"); await load(); }, [load]);
  const remove = useCallback(async (userId: string) => { const result = await deleteUser({ path: { userId }, responseStyle: "fields" }); if (result.error) throw new Error("删除用户失败"); await load(); }, [load]);
  const create = useCallback(async (body: { username: string; password: string; displayName: string; roleIds: string[] }) => { const result = await createLocalUser({ body, responseStyle: "fields" }); if (result.error || result.data?.code !== 0) throw new Error(result.data?.message || "创建用户失败"); await load(); }, [load]);
  const initializeCredentials = useCallback(() => initializeLocalCredentials({ responseStyle: "fields" }), []);
  return { users: filteredUsers, allUsers: users, roles, loading, error, query, setQuery, reload: load, update, remove, create, initializeCredentials, toUserFormValues };
}

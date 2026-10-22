"use client";

import { unwrapApiResult } from "@lib/api-request";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createLocalUser, deleteUser, initializeLocalCredentials, listRoles, listUsers, updateUser, type UpdateUserRequest, type CreateLocalUserRequest } from "../api";
import { toUserFormValues } from "./user-form";
import { filterUsers, normalizeUser, type RoleItem, type UserItem } from "./user-list";

export function useUserManagement() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(null); try { const [userResult, roleResult] = await Promise.all([listUsers({ responseStyle: "fields" }), listRoles({ responseStyle: "fields" })]); setUsers(unwrapApiResult(userResult, "无法加载用户").map(normalizeUser)); setRoles(unwrapApiResult(roleResult, "无法加载角色").filter(role => role.status === "active")); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载用户"); } finally { setLoading(false); } }, []);
  // Load remote identity data when the controller is mounted.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const filteredUsers = useMemo(() => filterUsers(users, query, "all", "all"), [query, users]);
  const update = useCallback(async (userId: string, body: UpdateUserRequest) => { const result = await updateUser({ path: { userId }, body, responseStyle: "fields" }); unwrapApiResult(result); await load(); }, [load]);
  const remove = useCallback(async (userId: string) => { const result = await deleteUser({ path: { userId }, responseStyle: "fields" }); unwrapApiResult(result); await load(); }, [load]);
  const create = useCallback(async (body: CreateLocalUserRequest) => { const result = await createLocalUser({ body, responseStyle: "fields" }); unwrapApiResult(result); await load(); return unwrapApiResult(result); }, [load]);
  const initializeCredentials = useCallback(() => initializeLocalCredentials({ responseStyle: "fields" }), []);
  return { users: filteredUsers, allUsers: users, roles, loading, error, query, setQuery, reload: load, update, remove, create, initializeCredentials, toUserFormValues };
}

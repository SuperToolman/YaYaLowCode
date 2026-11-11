"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { fetchRuntimeIdentityCatalog } from "./api";
import type { IdentityUser } from "./types";

const EMPTY_USERS: ReadonlyMap<string, IdentityUser> = new Map();

export function useRuntimeMemberUsers(enabled: boolean) {
  const { token, user, permissions } = useAuth();
  const query = useQuery({
    queryKey: ["runtime-member-users", token, user?.id, permissions],
    enabled: enabled && Boolean(token),
    queryFn: ({ signal }) => fetchRuntimeIdentityCatalog(signal),
    select: (catalog) => new Map(catalog.users.map((user) => [user.id, user])),
    staleTime: 60_000,
  });
  return enabled ? query.data ?? EMPTY_USERS : EMPTY_USERS;
}

"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  type AuthUser,
  isTokenUsable,
  readAuthStorage,
  removeAuthStorage,
  writeAuthStorage,
} from "../lib/auth";

type AuthContextValue = {
  isAuthenticated: boolean;
  isReady: boolean;
  token: string | null;
  user: AuthUser | null;
  permissions: string[];
  permissionsReady: boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: readonly string[]) => boolean;
  completeLogin: (token: string, user: AuthUser) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const authListeners = new Set<() => void>();

function subscribeToAuth(listener: () => void) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function emitAuthChange() {
  authListeners.forEach((listener) => listener());
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const token = useSyncExternalStore(
    subscribeToAuth,
    () => {
      const storedToken = readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
      return isTokenUsable(storedToken) ? storedToken : null;
    },
    () => null,
  );
  const isReady = useSyncExternalStore(subscribeToAuth, () => true, () => false);
  const user = useMemo(() => (token ? readStoredUser() : null), [token]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoadedFor, setPermissionsLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetch("/api/authorization/grants", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { code: number; data: string[] | null };
        if (!response.ok || payload.code !== 0 || !payload.data) throw new Error("无法加载权限");
        if (!cancelled) {
          setPermissions(payload.data);
          setPermissionsLoadedFor(token);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPermissions([]);
          setPermissionsLoadedFor(token);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const permissionsReady = !token || permissionsLoadedFor === token;

  useEffect(() => {
    if (!token) return;

    const timer = window.setInterval(() => {
      if (!isTokenUsable(token)) {
        removeAuthStorage(AUTH_TOKEN_STORAGE_KEY);
        removeAuthStorage(AUTH_USER_STORAGE_KEY);
        emitAuthChange();
      }
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [token]);

  function completeLogin(nextToken: string, nextUser: AuthUser) {
    writeAuthStorage(AUTH_TOKEN_STORAGE_KEY, nextToken);
    writeAuthStorage(AUTH_USER_STORAGE_KEY, JSON.stringify(nextUser));
    emitAuthChange();
  }

  function logout() {
    removeAuthStorage(AUTH_TOKEN_STORAGE_KEY);
    removeAuthStorage(AUTH_USER_STORAGE_KEY);
    emitAuthChange();
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: isTokenUsable(token),
      isReady,
      token,
      user,
      permissions,
      permissionsReady,
      hasPermission: (permission) => permissions.includes("*") || permissions.includes(permission),
      hasAnyPermission: (required) => permissions.includes("*") || required.some((permission) => permissions.includes(permission)),
      completeLogin,
      logout,
    }),
    [isReady, permissions, permissionsReady, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

function readStoredUser(): AuthUser | null {
  try {
    const value = readAuthStorage(AUTH_USER_STORAGE_KEY);
    return value ? (JSON.parse(value) as AuthUser) : null;
  } catch {
    return null;
  }
}

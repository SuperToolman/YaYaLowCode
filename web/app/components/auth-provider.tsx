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
import { clearAppResourceCache } from "../lib/app-resources";

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

type SessionResponse = {
  code: number;
  data: { token: string; user: AuthUser } | null;
};

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
  const [sessionReady, setSessionReady] = useState(false);
  const user = useMemo(() => (token ? readStoredUser() : null), [token]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoadedFor, setPermissionsLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_TOKEN_STORAGE_KEY || event.key === AUTH_USER_STORAGE_KEY) {
        emitAuthChange();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as SessionResponse;
        if (!response.ok || payload.code !== 0 || !payload.data || !isTokenUsable(payload.data.token)) {
          throw new Error("未登录");
        }
        writeAuthStorage(AUTH_TOKEN_STORAGE_KEY, payload.data.token);
        writeAuthStorage(AUTH_USER_STORAGE_KEY, JSON.stringify(payload.data.user));
        emitAuthChange();
      })
      .catch(() => {
        removeAuthStorage(AUTH_TOKEN_STORAGE_KEY);
        removeAuthStorage(AUTH_USER_STORAGE_KEY);
        emitAuthChange();
      })
      .finally(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    clearAppResourceCache();
    if (!sessionReady || !token) return;
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
  }, [sessionReady, token]);

  const permissionsReady = sessionReady && (!token || permissionsLoadedFor === token);

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
      isReady: sessionReady,
      token,
      user,
      permissions,
      permissionsReady,
      hasPermission: (permission) => permissions.includes("*") || permissions.includes(permission),
      hasAnyPermission: (required) => permissions.includes("*") || required.some((permission) => permissions.includes(permission)),
      completeLogin,
      logout,
    }),
    [permissions, permissionsReady, sessionReady, token, user],
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

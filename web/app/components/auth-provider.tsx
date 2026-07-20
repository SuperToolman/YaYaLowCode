"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
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
      completeLogin,
      logout,
    }),
    [isReady, token, user],
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

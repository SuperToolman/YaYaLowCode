export const AUTH_TOKEN_STORAGE_KEY = "yaya-auth-token";
export const AUTH_USER_STORAGE_KEY = "yaya-auth-user";

export type AuthUser = {
  id: string;
  displayName: string;
  username: string;
};

export function readAuthStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeAuthStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeAuthStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

type TokenPayload = {
  exp?: number;
};

export function isTokenUsable(token: string | null): token is string {
  if (!token) return false;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const payload = JSON.parse(decodeBase64Url(parts[1])) as TokenPayload;
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return window.atob(`${normalized}${padding}`);
}

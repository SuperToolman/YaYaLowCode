"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
};

const STORAGE_KEY = "yaya-theme-mode";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeMode, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.resolvedTheme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(STORAGE_KEY);
    const initialTheme: ThemeMode =
      savedTheme === "light" || savedTheme === "dark" || savedTheme === "system"
        ? savedTheme
        : "system";
    const initialResolvedTheme =
      initialTheme === "system" ? getSystemTheme() : initialTheme;

    applyTheme(initialTheme, initialResolvedTheme);
    queueMicrotask(() => {
      setThemeState(initialTheme);
      setResolvedTheme(initialResolvedTheme);
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const updateSystemTheme = () => {
      setResolvedTheme((current) => {
        if (theme !== "system") {
          return current;
        }

        const nextResolvedTheme = media.matches ? "dark" : "light";
        applyTheme("system", nextResolvedTheme);
        return nextResolvedTheme;
      });
    };

    media.addEventListener("change", updateSystemTheme);

    return () => {
      media.removeEventListener("change", updateSystemTheme);
    };
  }, [theme]);

  function setTheme(nextTheme: ThemeMode) {
    const nextResolvedTheme = nextTheme === "system" ? getSystemTheme() : nextTheme;

    setThemeState(nextTheme);
    setResolvedTheme(nextResolvedTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme, nextResolvedTheme);
  }

  const value = useMemo(
    () => ({
      resolvedTheme,
      theme,
      setTheme,
    }),
    [resolvedTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}

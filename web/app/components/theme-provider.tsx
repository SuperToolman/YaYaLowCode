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
export type SurfaceVariant = "default" | "secondary" | "tertiary" | "transparent";
export type RadiusSize = "none" | "small" | "medium" | "large" | "xl" | "2xl";
export type FontFamily = "geist" | "inter" | "system" | "serif";
export type ThemePreset = "mengnex" | "heroui" | "ocean" | "emerald" | "rose" | "mono" | "custom";
export type AppearanceSettings = {
  accent: string;
  backgroundLight: string;
  backgroundDark: string;
  baseLight: string;
  baseDark: string;
  foregroundLight: string;
  foregroundDark: string;
  fontFamily: FontFamily;
  preset: ThemePreset;
  surfaceVariant: SurfaceVariant;
  radius: RadiusSize;
  radiusForm: RadiusSize;
  animationsEnabled: boolean;
};

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  appearance: AppearanceSettings;
  setAppearance: (appearance: AppearanceSettings) => void;
  setPreset: (preset: ThemePreset) => void;
};

const STORAGE_KEY = "yaya-theme-mode";
const APPEARANCE_STORAGE_KEY = "yaya-theme-appearance";
export const defaultAppearance: AppearanceSettings = { accent: "#a66cff", backgroundLight: "#dfe3ea", backgroundDark: "#202124", baseLight: "#ffffff", baseDark: "#2a2a2e", foregroundLight: "#171717", foregroundDark: "#f5f5f5", fontFamily: "system", preset: "mengnex", surfaceVariant: "secondary", radius: "medium", radiusForm: "large", animationsEnabled: false };
const radiusTokens: Record<RadiusSize, string> = { none: "0rem", small: "0.25rem", medium: "0.5rem", large: "0.75rem", xl: "1rem", "2xl": "1.5rem" };
const ThemeContext = createContext<ThemeContextValue | null>(null);

function normalizeHex(value: string, fallback: string) {
  const source = value.trim();
  const short = /^#([\da-f]{3})$/i.exec(source);
  const expanded = short ? `#${short[1].split("").map((part) => part + part).join("")}` : source;
  return /^#[\da-f]{6}$/i.test(expanded) ? expanded.toLowerCase() : fallback;
}

function mixHex(source: string, target: string, amount: number) {
  const channels = (value: string) => {
    const normalized = normalizeHex(value, "#000000");
    return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  };
  const from = channels(source);
  const to = channels(target);
  return `#${from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function createSurfacePalette(base: string, foreground: string) {
  return {
    surface: base,
    surfaceSecondary: mixHex(base, foreground, 0.08),
    surfaceTertiary: mixHex(base, foreground, 0.14),
    field: mixHex(base, foreground, 0.05),
  };
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeMode, resolvedTheme: ResolvedTheme, appearance: AppearanceSettings) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.resolvedTheme = resolvedTheme;
  root.dataset.surfaceVariant = appearance.surfaceVariant;
  root.style.colorScheme = resolvedTheme;
  const dark = resolvedTheme === "dark";
  const isHex = (value: string) => /^#[\da-f]{6}$/i.test(value);
  const accent = isHex(appearance.accent) ? appearance.accent : defaultAppearance.accent;
  // Light and dark canvases are intentionally independent; switching mode does not
  // reinterpret one base color through a white/black neutral scale.
  const background = normalizeHex(dark ? appearance.backgroundDark : appearance.backgroundLight, dark ? defaultAppearance.backgroundDark : defaultAppearance.backgroundLight);
  const base = normalizeHex(dark ? appearance.baseDark : appearance.baseLight, dark ? defaultAppearance.baseDark : defaultAppearance.baseLight);
  const foreground = isHex(dark ? appearance.foregroundDark : appearance.foregroundLight)
    ? (dark ? appearance.foregroundDark : appearance.foregroundLight)
    : (dark ? defaultAppearance.foregroundDark : defaultAppearance.foregroundLight);
  const palette = createSurfacePalette(base, foreground);
  const surface = palette.surface;
  const surfaceSecondary = palette.surfaceSecondary;
  const surfaceTertiary = palette.surfaceTertiary;
  const muted = dark ? "#a3a3a3" : "#737373";
  const border = dark ? "rgba(255, 255, 255, 0.20)" : "rgba(0, 0, 0, 0.20)";
  const fieldBackground = palette.field;
  const neutral = {
    canvas: dark ? "#1c1c1c" : "#ededed",
    subtle: palette.surfaceTertiary,
    muted: palette.surfaceSecondary,
    surface: palette.surface,
  };
  const menu = surface;
  const selectedSurface = appearance.surfaceVariant === "default" ? surface : appearance.surfaceVariant === "tertiary" ? surfaceTertiary : appearance.surfaceVariant === "transparent" ? "transparent" : surfaceSecondary;
  const onAccent = (() => {
    const hex = accent.slice(1);
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return red * 0.299 + green * 0.587 + blue * 0.114 > 160 ? "#0f172a" : "#ffffff";
  })();
  const fonts: Record<FontFamily, string> = { geist: "Arial, sans-serif", inter: "Inter, ui-sans-serif, system-ui, sans-serif", system: "ui-sans-serif, system-ui, sans-serif", serif: "Georgia, Cambria, serif" };
  // HeroUI v3 semantic tokens. These are the source of truth for all components.
  const tokens: Record<string, string> = {
    "--background": background,
    "--foreground": foreground,
    "--surface": selectedSurface,
    "--surface-component": selectedSurface,
    "--surface-component-border": appearance.surfaceVariant === "transparent" ? border : "transparent",
    "--surface-component-border-width": appearance.surfaceVariant === "transparent" ? "1px" : "0px",
    "--surface-foreground": foreground,
    "--surface-secondary": surfaceSecondary,
    "--surface-secondary-foreground": foreground,
    "--surface-tertiary": surfaceTertiary,
    "--surface-tertiary-foreground": foreground,
    "--overlay": menu,
    "--overlay-foreground": foreground,
    "--muted": muted,
    "--default": appearance.surfaceVariant === "tertiary" ? surfaceTertiary : appearance.surfaceVariant === "secondary" ? surfaceSecondary : surface,
    "--default-foreground": foreground,
    "--accent": accent,
    "--accent-foreground": onAccent,
    "--field-background": fieldBackground,
    "--field-foreground": foreground,
    "--field-placeholder": muted,
    "--field-border": border,
    "--field-border-width": "0px",
    "--success": dark ? "#72d6a0" : "#16864b",
    "--success-foreground": dark ? "#102218" : "#ffffff",
    "--warning": dark ? "#f5b66c" : "#b45309",
    "--warning-foreground": dark ? "#211307" : "#ffffff",
    "--danger": dark ? "#ff9fbe" : "#c73655",
    "--danger-foreground": dark ? "#2a0d18" : "#ffffff",
    "--border": border,
    "--separator": border,
    "--focus": accent,
    "--link": accent,
    "--backdrop": dark ? "rgba(0, 0, 0, .72)" : "rgba(24, 24, 27, .24)",
    "--surface-shadow": dark ? "0 0 0 0 transparent inset" : "0 2px 4px 0 rgba(0,0,0,.04), 0 1px 2px 0 rgba(0,0,0,.06), 0 0 1px 0 rgba(0,0,0,.06)",
    "--overlay-shadow": dark ? "0 0 1px 0 rgba(255,255,255,.3) inset" : "0 2px 8px 0 rgba(0,0,0,.06), 0 -6px 12px 0 rgba(0,0,0,.03), 0 14px 28px 0 rgba(0,0,0,.12)",
    "--field-shadow": dark ? "0 0 0 0 transparent inset" : "0 2px 4px 0 rgba(0,0,0,.04), 0 1px 2px 0 rgba(0,0,0,.06), 0 0 1px 0 rgba(0,0,0,.06)",
    "--neutral-canvas": neutral.canvas,
    "--neutral-subtle": neutral.subtle,
    "--neutral-muted": neutral.muted,
    "--neutral-surface": neutral.surface,
    "--base": base,
  };
  // Compatibility variables are generated from the same values for legacy CSS and commercial surfaces.
  Object.assign(tokens, {
    "--color-bg-canvas": background,
    "--color-bg-surface": surface,
    "--color-bg-subtle": surfaceSecondary,
    "--color-text-primary": foreground,
    "--color-text-secondary": muted,
    "--color-text-disabled": dark ? "#71717a" : "#a1a1aa",
    "--color-text-on-primary": onAccent,
    "--color-text-on-danger": dark ? "#2a0d18" : "#ffffff",
    "--color-primary": accent,
    "--color-primary-hover": `color-mix(in srgb, ${accent} 78%, white)`,
    "--color-primary-active": `color-mix(in srgb, ${accent} 78%, black)`,
    "--color-primary-soft": `color-mix(in srgb, ${accent} 14%, ${surface})`,
    "--color-secondary": "#2dd4bf",
    "--color-accent": accent,
    "--color-warning": tokens["--warning"],
    "--color-success": tokens["--success"],
    "--color-danger": tokens["--danger"],
    "--color-border": border,
    "--color-bg-input": fieldBackground,
    "--color-bg-menu": menu,
    "--color-bg-hover": `color-mix(in srgb, ${accent} 10%, ${surface})`,
    "--color-code-bg": dark ? "#0c0c0f" : "#111827",
    "--color-code-text": dark ? "#e5e3ea" : "#dbeafe",
    "--color-overlay": dark ? "rgba(17,17,20,.76)" : "rgba(26,29,43,.24)",
    "--color-bg-panel": surfaceSecondary,
    "--color-bg-panel-strong": surface,
    "--color-bg-panel-soft": surfaceTertiary,
    "--color-bg-card-glass": surface,
    "--color-border-card-glass": border,
    "--color-control-soft": dark ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.58)",
    "--color-control-soft-hover": dark ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.82)",
    "--color-control-selected": dark ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.94)",
    "--color-control-thumb": dark ? "#f0eff4" : "#ffffff",
    "--shadow-xs": tokens["--field-shadow"],
    "--shadow-sm": tokens["--surface-shadow"],
    "--shadow-card": tokens["--surface-shadow"],
    "--shadow-card-hover": dark ? "0 8px 24px rgba(0,0,0,.28)" : "0 8px 24px rgba(0,0,0,.10)",
    "--shadow-panel": dark ? "0 16px 40px rgba(0,0,0,.30)" : "0 16px 40px rgba(0,0,0,.08)",
    "--shadow-designer": dark ? "0 20px 70px rgba(0,0,0,.38)" : "0 20px 70px rgba(0,0,0,.10)",
    "--shadow-floating": dark ? "0 16px 32px rgba(0,0,0,.36)" : "0 14px 28px rgba(0,0,0,.16)",
    "--shadow-drawer": dark ? "0 24px 64px rgba(0,0,0,.44)" : "0 24px 64px rgba(0,0,0,.18)",
    "--shadow-dialog": tokens["--overlay-shadow"],
    "--shadow-primary": `0 10px 24px color-mix(in srgb, ${accent} 24%, transparent)`,
    "--shadow-success": `0 10px 24px color-mix(in srgb, ${tokens["--success"]} 20%, transparent)`,
    "--shadow-card-glass": dark ? "0 18px 48px rgba(0,0,0,.28)" : "0 18px 48px rgba(0,0,0,.10)",
    "--input-background": fieldBackground,
    "--menu-background": menu,
    "--menu-item-hover": `color-mix(in srgb, ${accent} 10%, ${surface})`,
    "--accent-soft": `color-mix(in srgb, ${accent} 14%, ${surface})`,
    "--accent-strong": accent,
    "--panel-background": surfaceSecondary,
    "--panel-background-strong": surface,
    "--panel-background-soft": surfaceTertiary,
    "--font-sans-ui": fonts[appearance.fontFamily],
    "--font-mono-ui": "Cascadia Mono, SFMono-Regular, Consolas, monospace",
    "--app-gradient": `linear-gradient(135deg, ${background} 0%, ${mixHex(background, base, 0.35)} 52%, ${mixHex(background, base, 0.58)} 100%)`,
  });
  Object.entries(tokens).forEach(([name, value]) => root.style.setProperty(name, value));
  root.style.setProperty("--font-sans", fonts[appearance.fontFamily]);
  root.style.setProperty("--radius", radiusTokens[appearance.radius]);
  root.style.setProperty("--field-radius", radiusTokens[appearance.radiusForm]);
  root.style.setProperty("--motion-duration", appearance.animationsEnabled ? "150ms" : "0ms");
  root.dataset.motion = appearance.animationsEnabled ? "full" : "reduced";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [appearance, setAppearanceState] = useState<AppearanceSettings>(defaultAppearance);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(STORAGE_KEY);
    const initialTheme: ThemeMode =
      savedTheme === "light" || savedTheme === "dark" || savedTheme === "system"
        ? savedTheme
        : "system";
    const initialResolvedTheme =
      initialTheme === "system" ? getSystemTheme() : initialTheme;
    let initialAppearance = defaultAppearance;
    try {
      const storedAppearance = JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "null") as (Partial<AppearanceSettings> & { base?: string }) | null;
      if (storedAppearance && typeof storedAppearance.accent === "string") {
        const migrated = storedAppearance.base
          ? { baseLight: storedAppearance.base, baseDark: storedAppearance.base }
          : {};
        initialAppearance = { ...defaultAppearance, ...migrated, ...storedAppearance, surfaceVariant: storedAppearance.surfaceVariant === "default" ? "secondary" : storedAppearance.surfaceVariant } as AppearanceSettings;
      }
    } catch { /* use defaults */ }

    applyTheme(initialTheme, initialResolvedTheme, initialAppearance);
    queueMicrotask(() => {
      setThemeState(initialTheme);
      setResolvedTheme(initialResolvedTheme);
      setAppearanceState(initialAppearance);
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
        applyTheme("system", nextResolvedTheme, appearance);
        return nextResolvedTheme;
      });
    };

    media.addEventListener("change", updateSystemTheme);

    return () => {
      media.removeEventListener("change", updateSystemTheme);
    };
  }, [theme, appearance]);

  function setTheme(nextTheme: ThemeMode) {
    const nextResolvedTheme = nextTheme === "system" ? getSystemTheme() : nextTheme;

    setThemeState(nextTheme);
    setResolvedTheme(nextResolvedTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme, nextResolvedTheme, appearance);
  }

  function setAppearance(nextAppearance: AppearanceSettings) {
    setAppearanceState(nextAppearance);
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(nextAppearance));
    applyTheme(theme, resolvedTheme, nextAppearance);
  }

  function setPreset(preset: ThemePreset) {
    if (preset === "custom") {
      setAppearance({ ...appearance, preset });
      return;
    }
    const presets: Record<Exclude<ThemePreset, "custom">, Partial<AppearanceSettings>> = {
      mengnex: { accent: "#a66cff", backgroundLight: "#dfe3ea", backgroundDark: "#202124", baseLight: "#ffffff", baseDark: "#2a2a2e", foregroundLight: "#171717", foregroundDark: "#f5f5f5", surfaceVariant: "secondary", radius: "medium", radiusForm: "large", fontFamily: "system", animationsEnabled: false },
      heroui: { accent: "#2563eb", backgroundLight: "#e4e4e7", backgroundDark: "#18181b", baseLight: "#ffffff", baseDark: "#27272a", foregroundLight: "#18181b", foregroundDark: "#f4f4f5", surfaceVariant: "secondary", radius: "medium", radiusForm: "medium", fontFamily: "system", animationsEnabled: true },
      ocean: { accent: "#0ea5e9", backgroundLight: "#dbeafe", backgroundDark: "#0b1628", baseLight: "#f0f9ff", baseDark: "#14243b", foregroundLight: "#0f172a", foregroundDark: "#e0f2fe", surfaceVariant: "secondary", radius: "large", radiusForm: "large", fontFamily: "inter", animationsEnabled: true },
      emerald: { accent: "#10b981", backgroundLight: "#d9f5e8", backgroundDark: "#10221c", baseLight: "#ecfdf5", baseDark: "#19382c", foregroundLight: "#18181b", foregroundDark: "#ecfdf5", surfaceVariant: "tertiary", radius: "medium", radiusForm: "small", fontFamily: "system", animationsEnabled: true },
      rose: { accent: "#e11d48", backgroundLight: "#fce1e7", backgroundDark: "#24151a", baseLight: "#fff1f2", baseDark: "#38202a", foregroundLight: "#1c1917", foregroundDark: "#fff1f2", surfaceVariant: "secondary", radius: "xl", radiusForm: "large", fontFamily: "serif", animationsEnabled: true },
      mono: { accent: "#52525b", backgroundLight: "#e4e4e7", backgroundDark: "#18181b", baseLight: "#fafafa", baseDark: "#27272a", foregroundLight: "#18181b", foregroundDark: "#fafafa", surfaceVariant: "secondary", radius: "none", radiusForm: "small", fontFamily: "geist", animationsEnabled: false },
    };
    setAppearance({ ...defaultAppearance, ...presets[preset], preset });
  }

  const value = useMemo(
    () => ({
      resolvedTheme,
      theme,
      setTheme,
      appearance,
      setAppearance,
      setPreset,
    }),
    [appearance, resolvedTheme, theme],
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

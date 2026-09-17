import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOBALS_PATH = "app/globals.css";
const TOKENS_PATH = "styles/tokens.css";
const UTILITIES_PATH = "styles/utilities.css";
const CSS_MODULE_CLASS_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+__[a-z][a-z0-9-]*(?:--[a-z][a-z0-9-]*)?$/;

const LEGACY_CSS_MODULES = new Set([
  "app/(protected)/(main)/[appId]/[formUuid]/components/SystemPageView.module.css",
  "app/(protected)/messages/messages.module.css",
  "app/(protected)/settings/about/about.module.css",
  "app/(protected)/settings/logs/logs.module.css",
  "app/(protected)/settings/notifications/notifications.module.css",
  "app/components/my-fields/MyAvatar.module.css",
]);

function normalizeSelector(selector) {
  return selector.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
}

function isThemeRootSelector(selector) {
  return selector.split(",").some((part) => {
    const normalizedPart = part.trim();
    return normalizedPart === ":root"
      || /^html\[data-resolved-theme=(?:"(?:light|dark)"|'(?:light|dark)'|(?:light|dark))\]$/.test(normalizedPart);
  });
}

// Global selectors are limited to application foundations and HeroUI platform overrides.
export const GLOBAL_SELECTOR_ALLOWLIST = new Set([
  "*",
  "*::-webkit-scrollbar",
  ".app-main-glass",
  ".app-main-region",
  ".app-root-shell",
  ".button,button[data-slot=\"button\"],button.button--icon-only,button.button--icon-only.button--sm,button.button--icon-only.button--lg",
  ".license-checking-overlay",
  ".surface,.card",
  ".surface--transparent",
  "a",
  "body",
  "button,input,select",
  "html",
  "html,body,*",
  "html[data-surface-variant=\"secondary\"] .surface--default",
  "html[data-surface-variant=\"tertiary\"] .surface--default",
  "html[data-surface-variant=\"transparent\"] .surface--default",
]);

export const UTILITY_SELECTOR_ALLOWLIST = new Set([
  ".page-app-item",
  ".page-card-description",
  ".page-card-title",
  ".page-content-layout__subtitle",
  ".page-content-layout__subtitle,.page-section-meta,.page-card-description",
  ".page-content-layout__title",
  ".page-content-layout__title,.page-section-title,.page-card-title",
  ".page-quick-item",
  ".page-quick-item,.page-app-item",
  ".page-section-meta",
  ".page-section-title",
  ".page-surface",
  ".theme-card-glass",
  ".theme-menu-surface",
  ".theme-modal-backdrop",
  ".theme-page-shell",
  ".theme-panel,.theme-panel-strong,.theme-panel-soft",
  ".theme-search-surface",
]);

const LEGACY_THEME_DECLARATIONS = new Map();

export function analyzeCss(source, options) {
  const {
    filePath,
    allowedSelectors,
    tokenOwner = false,
    legacyThemeDeclarations = new Map(),
  } = options;
  const errors = [];
  const root = postcss.parse(source, { from: filePath });

  root.walkRules((rule) => {
    const selector = normalizeSelector(rule.selector);
    if (allowedSelectors && !allowedSelectors.has(selector)) {
      errors.push(`${filePath}:${rule.source.start.line} unapproved global selector: ${selector}`);
    }

    if (tokenOwner || !isThemeRootSelector(selector)) {
      return;
    }

    const legacyProperties = legacyThemeDeclarations.get(selector) ?? new Set();
    rule.walkDecls(/^--/, (declaration) => {
      if (!legacyProperties.has(declaration.prop)) {
        errors.push(`${filePath}:${declaration.source.start.line} theme token ${declaration.prop} must be declared in ${TOKENS_PATH}`);
      }
    });
  });

  return errors;
}

export function findForbiddenGlobalCssImports(source, filePath) {
  if (filePath.replaceAll("\\", "/") === "app/layout.tsx") {
    return [];
  }

  const importPattern = /(?:import\s+(?:[^"'`]*?\s+from\s+)?|export\s+[^"'`]*?\s+from\s+|import\s*\()\s*["']([^"']*globals\.css)["']/g;
  return [...source.matchAll(importPattern)].map(
    (match) => `${filePath} must not import ${match[1]}; app/layout.tsx is the only global CSS entrypoint`,
  );
}

export function findInvalidCssModuleClassNames(source, filePath) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  if (LEGACY_CSS_MODULES.has(normalizedPath)) return [];

  const errors = [];
  const root = postcss.parse(source, { from: filePath });
  root.walkRules((rule) => {
    const localSelector = rule.selector.replace(/:global\([^()]*\)/g, "");
    for (const match of localSelector.matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
      if (!CSS_MODULE_CLASS_PATTERN.test(match[1])) {
        errors.push(`${normalizedPath}:${rule.source.start.line} CSS Module class ${match[1]} must match <domain>-<component>__<element>--<state>`);
      }
    }
  });
  return errors;
}

export function findCrossFeatureCssModuleImports(source, filePath) {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const sourceMatch = normalizedPath.match(/^features\/([^/]+)\//);
  if (!sourceMatch) return [];

  const importPattern = /(?:import\s+(?:[^"'`]*?\s+from\s+)?|export\s+[^"'`]*?\s+from\s+|import\s*\()\s*["']([^"']*\.module\.css)["']/g;
  const errors = [];
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    const targetPath = specifier.startsWith("@features/")
      ? specifier.slice(1)
      : specifier.startsWith(".")
        ? path.posix.normalize(path.posix.join(path.posix.dirname(normalizedPath), specifier))
        : null;
    const targetMatch = targetPath?.match(/^features\/([^/]+)\//);
    if (targetMatch && targetMatch[1] !== sourceMatch[1]) {
      errors.push(`${normalizedPath} must not import CSS Module from feature ${targetMatch[1]}: ${specifier}`);
    }
  }
  return errors;
}

async function collectFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath, predicate));
    } else if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

export async function checkStyleBoundaries(projectRoot = PROJECT_ROOT) {
  const errors = [];
  const sourceRoots = ["app", "components", "features", "styles"];
  const cssFiles = (await Promise.all(sourceRoots.map(async (directory) => {
    const absoluteDirectory = path.join(projectRoot, directory);
    try {
      return await collectFiles(absoluteDirectory, (file) => file.endsWith(".css"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }))).flat();

  for (const absolutePath of cssFiles) {
    const filePath = path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
    const source = await readFile(absolutePath, "utf8");
    errors.push(...analyzeCss(source, {
      filePath,
      tokenOwner: filePath === TOKENS_PATH,
      allowedSelectors: filePath === GLOBALS_PATH
        ? GLOBAL_SELECTOR_ALLOWLIST
        : filePath === UTILITIES_PATH
          ? UTILITY_SELECTOR_ALLOWLIST
          : undefined,
      legacyThemeDeclarations: filePath === GLOBALS_PATH ? LEGACY_THEME_DECLARATIONS : new Map(),
    }));
    if (filePath.endsWith(".module.css")) {
      errors.push(...findInvalidCssModuleClassNames(source, filePath));
    }
  }

  const codeRoots = ["app", "components", "features"];
  const codeFiles = (await Promise.all(codeRoots.map(async (directory) => {
    const absoluteDirectory = path.join(projectRoot, directory);
    try {
      return await collectFiles(absoluteDirectory, (file) => /\.[cm]?[jt]sx?$/.test(file));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }))).flat();

  for (const absolutePath of codeFiles) {
    const filePath = path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
    const source = await readFile(absolutePath, "utf8");
    errors.push(...findForbiddenGlobalCssImports(source, filePath));
    errors.push(...findCrossFeatureCssModuleImports(source, filePath));
  }

  return errors;
}

async function main() {
  const errors = await checkStyleBoundaries();
  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Style boundaries passed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

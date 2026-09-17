import { describe, expect, it } from "vitest";
import {
  analyzeCss,
  findCrossFeatureCssModuleImports,
  findForbiddenGlobalCssImports,
  findInvalidCssModuleClassNames,
} from "./check-style-boundaries.mjs";

describe("style boundary checks", () => {
  it("allows theme tokens in the token owner", () => {
    expect(analyzeCss(':root { --color-primary: #000; }', {
      filePath: "styles/tokens.css",
      tokenOwner: true,
    })).toEqual([]);
  });

  it("rejects theme tokens in business CSS", () => {
    expect(analyzeCss(':root { --color-primary: #000; }', {
      filePath: "features/records/records.css",
    })).toEqual([
      "features/records/records.css:1 theme token --color-primary must be declared in styles/tokens.css",
    ]);
  });

  it("allows component-scoped variables below a theme root", () => {
    expect(analyzeCss('html[data-resolved-theme="dark"] .surface { --designer-surface: #111; }', {
      filePath: "app/designer/DesignerTheme.module.css",
    })).toEqual([]);
  });

  it("rejects selectors outside an explicit allowlist", () => {
    expect(analyzeCss(".records-new-global { color: red; }", {
      filePath: "app/globals.css",
      allowedSelectors: new Set([".existing-global"]),
    })).toEqual([
      "app/globals.css:1 unapproved global selector: .records-new-global",
    ]);
  });

  it("allows registered legacy global selectors", () => {
    expect(analyzeCss(".existing-global { color: red; }", {
      filePath: "app/globals.css",
      allowedSelectors: new Set([".existing-global"]),
    })).toEqual([]);
  });

  it("only allows the root layout to import global CSS", () => {
    expect(findForbiddenGlobalCssImports('import "../../app/globals.css";', "features/records/page.tsx"))
      .toEqual([
        "features/records/page.tsx must not import ../../app/globals.css; app/layout.tsx is the only global CSS entrypoint",
      ]);
    expect(findForbiddenGlobalCssImports('import "./globals.css";', "app/layout.tsx"))
      .toEqual([]);
  });

  it("enforces domain component naming for new CSS Modules", () => {
    expect(findInvalidCssModuleClassNames(".records-table__cell--selected { color: red; }", "features/records/NewTable.module.css"))
      .toEqual([]);
    expect(findInvalidCssModuleClassNames(".selected { color: red; }", "features/records/NewTable.module.css"))
      .toEqual([
        "features/records/NewTable.module.css:1 CSS Module class selected must match <domain>-<component>__<element>--<state>",
      ]);
  });

  it("rejects CSS Module imports across feature domains", () => {
    expect(findCrossFeatureCssModuleImports(
      'import styles from "@features/identity/User.module.css";',
      "features/records/components/Table.tsx",
    )).toEqual([
      "features/records/components/Table.tsx must not import CSS Module from feature identity: @features/identity/User.module.css",
    ]);
    expect(findCrossFeatureCssModuleImports(
      'import styles from "../styles/Table.module.css";',
      "features/records/components/Table.tsx",
    )).toEqual([]);
  });
});

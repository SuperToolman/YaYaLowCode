import { describe, expect, it } from "vitest";
import { latestChangelogVersion } from "./changelog";
import { loadPlatformChangelog } from "../server/changelog";

describe("changelog versions", () => {
  it("reads the first release rather than a date or an older release", () => {
    expect(latestChangelogVersion("# 更新日志\n## 1.12a - 2026-09-17\n## 1.11b - 2026-09-11")).toBe("1.12a");
  });

  it("supports bracketed versions and CRLF with a BOM", () => {
    expect(latestChangelogVersion("\uFEFF# Changelog\r\n## [v2.1.0-beta.2] - 2026-10-08\r\n")).toBe("2.1.0-beta.2");
  });

  it("skips release-like headings in fenced examples", () => {
    expect(latestChangelogVersion("```md\n## 9.0a\n```\n~~~md\n## 8.0a\n~~~\n## 1.12a - 2026-09-17")).toBe("1.12a");
  });

  it("does not invent a version when there is no release heading", () => {
    expect(latestChangelogVersion("# 更新日志\n## 未发布\n版本规划 2.0")).toBeNull();
  });

  it("loads the repository document and derives its version", async () => {
    const result = await loadPlatformChangelog();
    expect(result.markdown).toContain("# 更新日志");
    expect(result.version).not.toBeNull();
    expect(result.markdown).toContain(`## ${result.version}`);
  });
});

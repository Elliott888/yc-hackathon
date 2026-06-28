import { describe, expect, test } from "vitest";
import { manifestKindForPath, parseManifestContent } from "../src/manifest.js";

describe("manifest parsing", () => {
  test("extracts package and script signals from package.json", () => {
    const parsed = parseManifestContent(
      "package.json",
      JSON.stringify({
        scripts: { dev: "next dev", test: "vitest" },
        dependencies: { "@supabase/supabase-js": "^2.0.0", ws: "^8.0.0" },
        devDependencies: { typescript: "^5.0.0" }
      })
    );

    expect(parsed.kind).toBe("package_json");
    expect(parsed.package_names).toEqual(["@supabase/supabase-js", "typescript", "ws"]);
    expect(parsed.scripts).toEqual(["dev", "test"]);
  });

  test("recognizes workflow and common manifest paths", () => {
    expect(manifestKindForPath(".github/workflows/ci.yml")).toBe("github_actions_workflow");
    expect(manifestKindForPath("go.mod")).toBe("go_mod");
    expect(manifestKindForPath("src/index.ts")).toBeNull();
  });
});

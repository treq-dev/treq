import { describe, expect, it } from "vitest";
import {
  VITEST_PROJECT_DEFINITIONS,
  assertUniqueGroupOrderPerMaxWorkers,
} from "../vitest.projects";
import {
  integrationProjectOf,
  serialIntegrationFiles,
} from "../vitest.integration.serial";

describe("vitest project sequence", () => {
  it("assigns a unique groupOrder for each distinct maxWorkers value", () => {
    expect(() =>
      assertUniqueGroupOrderPerMaxWorkers(VITEST_PROJECT_DEFINITIONS),
    ).not.toThrow();
  });

  it("rejects the pre-fix layout where unit and integration-parallel shared groupOrder 0", () => {
    const legacyLayout = [
      { name: "unit", groupOrder: 0, maxWorkers: 7 },
      { name: "integration-parallel", groupOrder: 0, maxWorkers: 3 },
    ];
    expect(() => assertUniqueGroupOrderPerMaxWorkers(legacyLayout)).toThrow(
      /same 'sequence\.groupOrder'/,
    );
  });
});

describe("integration project directive", () => {
  it("runs a file marked @include-parallel in the parallel project", () => {
    expect(
      integrationProjectOf(
        '// @include-parallel\nimport { it } from "vitest";\n',
      ),
    ).toBe("parallel");
  });

  it("runs a file marked @include-serial, or with no directive, serially", () => {
    expect(integrationProjectOf("// @include-serial\n")).toBe("serial");
    expect(integrationProjectOf('import { it } from "vitest";\n')).toBe(
      "serial",
    );
  });

  it("ignores the directive when it is not a whole-line comment", () => {
    expect(integrationProjectOf('const note = "// @include-parallel";\n')).toBe(
      "serial",
    );
  });

  it("rejects a file with both directives", () => {
    expect(() =>
      integrationProjectOf("// @include-parallel\n// @include-serial\n"),
    ).toThrow(/both @include-parallel and @include-serial/);
  });

  it("marks at least one real integration file serial", () => {
    expect(serialIntegrationFiles.length).toBeGreaterThan(0);
  });
});

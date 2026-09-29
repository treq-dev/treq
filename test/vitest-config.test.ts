import { describe, expect, it } from "vitest";
import {
  VITEST_PROJECT_DEFINITIONS,
  assertUniqueGroupOrderPerMaxWorkers,
} from "../vitest.projects";
import {
  isSerialTestSource,
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

describe("serial integration file detection", () => {
  it("selects a file that calls runSerially() at its top level", () => {
    expect(
      isSerialTestSource(
        'import { runSerially } from "../utils";\n\nrunSerially();\n\ndescribe("x", () => {});\n',
      ),
    ).toBe(true);
  });

  it("ignores a file that only imports it or calls it inside a block", () => {
    expect(
      isSerialTestSource('import { runSerially } from "../utils";\n'),
    ).toBe(false);
    expect(
      isSerialTestSource('describe("x", () => {\n  runSerially();\n});\n'),
    ).toBe(false);
  });

  it("marks at least one real integration file serial", () => {
    expect(serialIntegrationFiles.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { validateBranchName } from "./branch-name";

describe("validateBranchName", () => {
  it.each([
    "feat/x",
    "chaos/ünïcødé-🚀",
    "a.b/c_d-1",
    "release/v1.2",
  ])("accepts %s", (name) => {
    expect(validateBranchName(name)).toBeNull();
  });

  it.each([
    ["", "name is empty"],
    ["@", "'@' is reserved"],
    ["-feat", "must not start with '-'"],
    ["/feat", "empty path component"],
    ["feat/", "empty path component"],
    ["feat//x", "empty path component"],
    ["feat.", "must not end with '.'"],
    ["feat..x", "contains '..' or '@{'"],
    ["feat@{x", "contains '..' or '@{'"],
    ["has space", "contains ' '"],
    ["a~b", "contains '~'"],
    ["a:b", "contains ':'"],
    ["feat/.hidden", "a component starts with '.' or ends with '.lock'"],
    ["feat/x.lock", "a component starts with '.' or ends with '.lock'"],
  ])("rejects %j with %s", (name, reason) => {
    expect(validateBranchName(name)).toBe(reason);
  });
});

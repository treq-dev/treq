/**
 * Client-side mirror of `validate_branch_name` in
 * src-tauri/src/core/workspaces.rs, so the dialog can reject a name before
 * the round trip. Returns the reason the name is invalid, or null.
 */
export function validateBranchName(name: string): string | null {
  if (name === "") return "name is empty";
  if (name === "@") return "'@' is reserved";
  if (name.startsWith("-")) return "must not start with '-'";
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    return "empty path component";
  }
  if (name.endsWith(".")) return "must not end with '.'";
  if (name.includes("..") || name.includes("@{")) {
    return "contains '..' or '@{'";
  }
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || " ~^:?*[\\".includes(char)) {
      return `contains '${char}'`;
    }
  }
  if (
    name
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  ) {
    return "a component starts with '.' or ends with '.lock'";
  }
  return null;
}

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const API_FILES = [
  join("src", "lib", "api.ts"),
  join("src", "lib", "api-browser.ts"),
  join("src", "lib", "api-extra.ts"),
  join("src", "lib", "api-github.ts"),
];
const SRC_DIR = "src";
const EXTS = new Set([".ts", ".tsx"]);
const EXPORT_REGEX = /^\s*export const ([A-Za-z_]\w*)\s*=/gm;

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(path, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    const ext = dot >= 0 ? entry.name.slice(dot) : "";
    if (EXTS.has(ext)) {
      out.push(path);
    }
  }
  return out;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countIdentifier(text, name) {
  const matches = text.match(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"));
  return matches ? matches.length : 0;
}

function collectApiExports(rootDir) {
  const byFile = new Map();
  const byName = new Map();

  for (const relPath of API_FILES) {
    const text = readFileSync(join(rootDir, relPath), "utf8");
    const exports = [];

    for (const match of text.matchAll(EXPORT_REGEX)) {
      const before = text.slice(0, match.index);
      const line = before.split("\n").length;
      const name = match[1];
      const loc = { name, line, file: relPath };
      exports.push(loc);

      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, loc);
      } else if (existing.file !== relPath) {
        byName.set(name, { ...loc, duplicateOf: existing.file });
      }
    }

    byFile.set(relPath, exports);
  }

  return { byFile, byName };
}

function loadSrcText(rootDir) {
  return collectFiles(join(rootDir, SRC_DIR))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every Tauri API export const to be referenced somewhere under src/",
      recommended: false,
    },
    schema: [],
    messages: {
      duplicateExport:
        'Duplicate Tauri API export "{{name}}" also exists in {{otherFile}}.',
      unusedExport:
        'Tauri API export "{{name}}" is not referenced anywhere under src/ beyond its declaration.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const relFilename = API_FILES.find((file) => filename.endsWith(file));
    if (!API_FILES.includes(relFilename)) {
      return {};
    }

    const rootDir = dirname(dirname(dirname(filename)));
    const { byFile, byName } = collectApiExports(rootDir);
    const allSrcText = loadSrcText(rootDir);
    const exportsInFile = byFile.get(relFilename) ?? [];

    return {
      "Program:exit"(node) {
        for (const exp of exportsInFile) {
          const duplicate = byName.get(exp.name);
          if (duplicate?.file === exp.file && duplicate.duplicateOf) {
            context.report({
              node,
              loc: {
                start: { line: exp.line, column: 0 },
                end: { line: exp.line, column: 1 },
              },
              messageId: "duplicateExport",
              data: { name: exp.name, otherFile: duplicate.duplicateOf },
            });
            continue;
          }

          if (countIdentifier(allSrcText, exp.name) >= 2) {
            continue;
          }

          context.report({
            node,
            loc: {
              start: { line: exp.line, column: 0 },
              end: { line: exp.line, column: 1 },
            },
            messageId: "unusedExport",
            data: { name: exp.name },
          });
        }
      },
    };
  },
};

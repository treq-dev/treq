import { globSync, readFileSync } from "node:fs";

/**
 * Each integration test file declares which project runs it with a
 * directive comment on its own line:
 *
 *   // @include-parallel
 *   // @include-serial
 *
 * A file with no directive runs serially. Serial is the safe default:
 * files that drive the jj working copy and the Changes/Review views hard
 * starve spawn_blocking when they run next to other NAPI forks, and the
 * Changes list then times out. Mark a file parallel only when it does not.
 */
const DIRECTIVE = /^\/\/ @include-(parallel|serial)\s*$/gm;

export type IntegrationProject = "parallel" | "serial";

export function integrationProjectOf(
  source: string,
  file = "<source>",
): IntegrationProject {
  const found = new Set(
    [...source.matchAll(DIRECTIVE)].map(
      (match) => match[1] as IntegrationProject,
    ),
  );
  if (found.size > 1) {
    throw new Error(
      `${file} has both @include-parallel and @include-serial; keep one.`,
    );
  }
  return found.has("parallel") ? "parallel" : "serial";
}

/**
 * Integration files that run in the serial project. The serial project
 * includes exactly these; the parallel project excludes them.
 */
export const serialIntegrationFiles = globSync(
  "test/integration/**/*.test.{ts,tsx}",
)
  .map((file) => file.split("\\").join("/"))
  .filter(
    (file) =>
      integrationProjectOf(readFileSync(file, "utf8"), file) === "serial",
  )
  .sort();

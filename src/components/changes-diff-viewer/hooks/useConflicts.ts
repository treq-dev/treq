import { type ConflictRegion } from "../../../lib/api";
import type { FileHunksData } from "../types";

interface UseConflictsParams {
  allFileHunks: Map<string, FileHunksData>;
  /**
   * Hunks for committed changes. The Changes tab shows committed changes by
   * default, and a conflict produced by a rebase lives in a committed change —
   * so these have to be searched too or the inline conflict card never renders.
   */
  committedFileHunks?: Map<string, FileHunksData>;
  conflictedFilesHint?: string[];
}

const normalizeRegion = (
  filePath: string,
  region: ConflictRegion,
  index: number,
): ConflictRegion => {
  const conflictNumber =
    region.conflict_number && region.conflict_number > 0
      ? region.conflict_number
      : index + 1;
  return {
    ...region,
    file_path: filePath,
    conflict_number: conflictNumber,
    id: `${filePath}-conflict-${conflictNumber}`,
  };
};

export function useConflicts({
  allFileHunks,
  committedFileHunks,
  conflictedFilesHint = [],
}: UseConflictsParams) {
  const actualConflictedFiles = (() => {
    const fileOrder: string[] = [];
    const seen = new Set<string>();
    for (const path of conflictedFilesHint) {
      if (!seen.has(path)) {
        seen.add(path);
        fileOrder.push(path);
      }
    }
    return fileOrder;
  })();

  const conflictRegionsByFile = (() => {
    const regionsByFile = new Map<string, ConflictRegion[]>();
    const rawRegionsFor = (
      source: Map<string, FileHunksData> | undefined,
      filePath: string,
    ) =>
      source?.get(filePath)?.hunks.flatMap((h) => h.conflict_regions ?? []) ??
      [];

    for (const filePath of actualConflictedFiles) {
      const raw = rawRegionsFor(allFileHunks, filePath);
      const rawRegions =
        raw.length > 0 ? raw : rawRegionsFor(committedFileHunks, filePath);

      // The backend repeats a file's regions on every one of its hunks.
      const seen = new Set<string>();
      const regions: ConflictRegion[] = [];
      for (const region of rawRegions) {
        const normalized = normalizeRegion(filePath, region, regions.length);
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        regions.push(normalized);
      }
      regionsByFile.set(filePath, regions);
    }
    return regionsByFile;
  })();

  const conflictLineLookups = (() => {
    const map = new Map<string, Map<number, ConflictRegion>>();
    for (const [filePath, regions] of conflictRegionsByFile) {
      if (!regions || regions.length === 0) continue;
      const lineMap = new Map<number, ConflictRegion>();
      for (const region of regions) {
        for (let line = region.start_line; line <= region.end_line; line++) {
          lineMap.set(line, region);
        }
      }
      map.set(filePath, lineMap);
    }
    return map;
  })();

  const firstConflictRegionIdByFile = (() => {
    const map = new Map<string, string>();
    for (const [filePath, regions] of conflictRegionsByFile) {
      if (regions && regions.length > 0) map.set(filePath, regions[0].id);
    }
    return map;
  })();

  return {
    actualConflictedFiles,
    conflictRegionsByFile,
    conflictLineLookups,
    firstConflictRegionIdByFile,
  };
}

import { useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { FileText, Folder, FolderOpen } from "lucide-react";

// Define BranchDiffFileChange locally since git API was removed
export interface BranchDiffFileChange {
  path: string;
  status: string;
}

interface FileTreeViewProps {
  files: BranchDiffFileChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  isLoading?: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  status?: string;
  children?: TreeNode[];
}

const buildTree = (files: BranchDiffFileChange[]): TreeNode[] => {
  const root: TreeNode = {
    name: "root",
    path: "",
    type: "folder",
    children: [],
  };

  files.forEach((file) => {
    const segments = file.path.split("/").filter(Boolean);
    let current = root;
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      const childPath = current.path ? `${current.path}/${segment}` : segment;

      if (!current.children) {
        current.children = [];
      }

      let child = current.children.find((node) => node.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: childPath,
          type: isFile ? "file" : "folder",
          ...(isFile ? { status: file.status } : { children: [] }),
        };
        current.children.push(child);
      }

      if (!isFile) {
        current = child;
      }
    });
  });

  return root.children ?? [];
};

const sortTree = (nodes: TreeNode[]): TreeNode[] =>
  nodes
    .map((n) => (n.children ? { ...n, children: sortTree(n.children) } : n))
    .sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name)
        : a.type === "folder"
          ? -1
          : 1,
    );

const statusPipClasses: Record<string, string> = {
  A: "bg-green-500",
  M: "bg-yellow-500",
  D: "bg-red-500",
  R: "bg-blue-500",
};

const statusTitles: Record<string, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
};

const StatusPip: React.FC<{ status?: string; className?: string }> = ({
  status,
  className,
}) =>
  status ? (
    <span
      className={cn(
        "w-2 h-2 rounded-full flex-shrink-0",
        statusPipClasses[status] ?? "bg-muted",
        className,
      )}
      title={statusTitles[status]}
    />
  ) : null;

const hasChangesInFolder = (node: TreeNode): boolean =>
  node.type === "file"
    ? !!node.status
    : (node.children?.some(hasChangesInFolder) ?? false);

// Collect all folder paths that have changes (for auto-expanding)
const collectFoldersWithChanges = (
  nodes: TreeNode[],
  paths: string[] = [],
): string[] => {
  for (const node of nodes) {
    if (node.type === "folder" && hasChangesInFolder(node)) {
      paths.push(node.path);
      if (node.children) {
        collectFoldersWithChanges(node.children, paths);
      }
    }
  }
  return paths;
};

export const FileTreeView: React.FC<FileTreeViewProps> = ({
  files,
  selectedPath,
  onSelect,
  isLoading = false,
}) => {
  const tree = sortTree(buildTree(files));

  // Collect all folder paths that have changes (for auto-expanding)
  const foldersWithChanges = collectFoldersWithChanges(tree);

  // Use a stable string key for dependency tracking
  const foldersKey = foldersWithChanges.join(",");

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(foldersWithChanges),
  );

  // Update expanded state when folders with changes update
  useEffect(() => {
    if (foldersWithChanges.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const folder of foldersWithChanges) {
          next.add(folder);
        }
        return next;
      });
    }
  }, [foldersKey]);

  useEffect(() => {
    if (!selectedPath) return;
    const parts = selectedPath.split("/").slice(0, -1);
    const paths = parts.reduce<string[]>(
      (acc, part) => [
        ...acc,
        acc.length ? `${acc[acc.length - 1]}/${part}` : part,
      ],
      [],
    );
    setExpanded((prev) => new Set([...prev, ...paths]));
  }, [selectedPath]);

  const toggleNode = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderNode = (node: TreeNode) => {
    if (node.type === "folder") {
      const isOpen = expanded.has(node.path);
      const hasChanges = hasChangesInFolder(node);
      return (
        <div key={node.path} className="text-sm">
          <button
            type="button"
            className="flex items-center gap-2 w-full px-2 py-1 rounded-md hover:bg-muted/60"
            onClick={() => toggleNode(node.path)}
          >
            {isOpen ? (
              <FolderOpen className="w-4 h-4" />
            ) : (
              <Folder className="w-4 h-4" />
            )}
            <span className="font-medium text-left font-mono">{node.name}</span>
            {hasChanges && <StatusPip status="M" className="ml-auto" />}
          </button>
          {isOpen && node.children && (
            <div className="pl-4 border-l border-border/50 ml-2">
              {node.children.map((child) => renderNode(child))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={node.path}
        type="button"
        onClick={() => onSelect(node.path)}
        className={cn(
          "w-full flex items-center justify-between px-2 py-1 rounded-md text-sm",
          "hover:bg-muted/60 transition",
          selectedPath === node.path && "bg-primary/10",
        )}
      >
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="truncate text-left font-mono">{node.name}</span>
          <StatusPip status={node.status} />
        </div>
      </button>
    );
  };

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Loading file changes...
      </div>
    );
  }

  if (!files.length) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No differences between branches.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-1 overflow-auto h-full">
      {tree.map((node) => renderNode(node))}
    </div>
  );
};

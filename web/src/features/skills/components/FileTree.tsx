"use client";

import { useState, useCallback, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FileCode,
  FileJson,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { FileTreeNode } from "../api/skills-api";

interface FileTreeProps {
  readonly nodes: readonly FileTreeNode[];
  readonly selectedPath: string | null;
  readonly onSelectFile: (path: string) => void;
}

const ICON_BY_EXT: Record<string, typeof File> = {
  ".md": FileText,
  ".txt": FileText,
  ".py": FileCode,
  ".ts": FileCode,
  ".tsx": FileCode,
  ".js": FileCode,
  ".jsx": FileCode,
  ".xml": FileCode,
  ".html": FileCode,
  ".css": FileCode,
  ".sh": FileCode,
  ".yaml": FileCode,
  ".yml": FileCode,
  ".toml": FileCode,
  ".json": FileJson,
};

export function getFileIcon(name: string) {
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
  return ICON_BY_EXT[ext.toLowerCase()] ?? File;
}

/** Collect all ancestor directory paths for the selected file. */
function collectExpandedPaths(
  nodes: readonly FileTreeNode[],
  selectedPath: string | null,
  _parentPath: string = "",
): Set<string> {
  const result = new Set<string>();
  if (!selectedPath) return result;

  for (const node of nodes) {
    if (node.type === "directory" && node.children) {
      const childPaths = collectExpandedPaths(node.children, selectedPath, node.path);
      if (childPaths.size > 0 || selectedPath.startsWith(node.path + "/")) {
        result.add(node.path);
        for (const p of childPaths) result.add(p);
      }
    }
  }
  return result;
}

export function FileTree({ nodes, selectedPath, onSelectFile }: FileTreeProps) {
  // Auto-expand directories containing the selected file
  const autoExpanded = useMemo(
    () => collectExpandedPaths(nodes, selectedPath),
    [nodes, selectedPath],
  );

  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  const [manualCollapsed, setManualCollapsed] = useState<Set<string>>(new Set());

  const isExpanded = useCallback(
    (path: string) => {
      if (manualCollapsed.has(path)) return false;
      if (manualExpanded.has(path)) return true;
      return autoExpanded.has(path);
    },
    [autoExpanded, manualExpanded, manualCollapsed],
  );

  const toggleDir = useCallback((path: string) => {
    // Determine current expanded state to decide the target
    const currentlyExpanded =
      !manualCollapsed.has(path) &&
      (manualExpanded.has(path) || autoExpanded.has(path));

    if (currentlyExpanded) {
      // Collapse: add to collapsed, remove from expanded
      setManualCollapsed((prev) => new Set([...prev, path]));
      setManualExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } else {
      // Expand: add to expanded, remove from collapsed
      setManualExpanded((prev) => new Set([...prev, path]));
      setManualCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [manualExpanded, manualCollapsed, autoExpanded]);

  return (
    <div role="tree" className="py-1">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          isExpanded={isExpanded}
          onToggleDir={toggleDir}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  readonly node: FileTreeNode;
  readonly depth: number;
  readonly selectedPath: string | null;
  readonly onSelectFile: (path: string) => void;
  readonly isExpanded: (path: string) => boolean;
  readonly onToggleDir: (path: string) => void;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelectFile,
  isExpanded,
  onToggleDir,
}: TreeNodeProps) {
  const isDir = node.type === "directory";
  const expanded = isDir && isExpanded(node.path);
  const isSelected = !isDir && node.path === selectedPath;
  const FileIcon = isDir
    ? expanded ? FolderOpen : Folder
    : getFileIcon(node.name);

  const handleClick = () => {
    if (isDir) {
      onToggleDir(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isDir ? undefined : isSelected}
        aria-expanded={isDir ? expanded : undefined}
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left font-sans text-xs",
          "hover:bg-secondary transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          isSelected && "bg-secondary text-foreground",
          !isSelected && "text-muted-foreground",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 opacity-60" />
          ) : (
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 opacity-60" />
          )
        ) : (
          <span aria-hidden="true" className="h-3 w-3 shrink-0" />
        )}
        <FileIcon aria-hidden="true" className={cn(
          "h-3.5 w-3.5 shrink-0",
          isDir ? "text-muted-foreground" : "opacity-60",
        )} />
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              isExpanded={isExpanded}
              onToggleDir={onToggleDir}
            />
          ))}
        </div>
      )}
    </>
  );
}

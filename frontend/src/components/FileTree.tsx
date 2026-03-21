import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { browseFilesystem, FilesystemEntry } from '@/lib/api';
import { FilePreviewDialog } from './FilePreviewDialog';
import { cn } from '@/lib/utils';

interface FileTreeProps {
  projectPath: string;
}

export function FileTree({ projectPath }: FileTreeProps) {
  const [nodeMap, setNodeMap] = useState<Map<string, FilesystemEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set([projectPath]));
  const loadingRef = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const loadDir = useCallback(
    async (dirPath: string) => {
      if (loadingRef.current.has(dirPath)) return;
      loadingRef.current.add(dirPath);
      forceRender((n) => n + 1);
      try {
        const result = await browseFilesystem(dirPath);
        setNodeMap((prev) => new Map(prev).set(dirPath, result.entries));
      } catch (err) {
        console.error('[FileTree] Failed to load:', dirPath, err);
        setNodeMap((prev) => new Map(prev).set(dirPath, []));
      } finally {
        loadingRef.current.delete(dirPath);
        forceRender((n) => n + 1);
      }
    },
    []
  );

  useEffect(() => {
    setNodeMap(new Map());
    setExpanded(new Set([projectPath]));
    void loadDir(projectPath);
  }, [projectPath, loadDir]);

  const toggle = useCallback(
    (dirPath: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          if (!nodeMap.has(dirPath)) void loadDir(dirPath);
        }
        return next;
      });
    },
    [nodeMap, loadDir]
  );

  const refresh = useCallback(() => {
    setNodeMap(new Map());
    setExpanded(new Set([projectPath]));
    loadingRef.current.clear();
    void loadDir(projectPath);
  }, [projectPath, loadDir]);

  const renderNodes = (nodes: FilesystemEntry[], depth: number) =>
    nodes.map((node) => {
      const isExpanded = expanded.has(node.path);
      const isLoading = loadingRef.current.has(node.path);
      const children = nodeMap.get(node.path);
      const isHidden = node.name.startsWith('.');

      return (
        <div key={node.path}>
          <div
            className={cn(
              'flex items-center gap-1 py-[3px] rounded cursor-pointer',
              'hover:bg-muted',
              isHidden && 'opacity-50'
            )}
            style={{ paddingLeft: `${depth * 14 + 6}px`, paddingRight: '6px' }}
            onClick={() => node.type === 'dir' ? toggle(node.path) : setPreviewPath(node.path)}
          >
            <span className="w-3 flex-shrink-0 text-muted-foreground">
              {node.type === 'dir' &&
                (isLoading ? (
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                ) : isExpanded ? (
                  <ChevronDown className="h-2.5 w-2.5" />
                ) : (
                  <ChevronRight className="h-2.5 w-2.5" />
                ))}
            </span>

            {node.type === 'dir' ? (
              isExpanded ? (
                <FolderOpen className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
              ) : (
                <Folder className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
              )
            ) : (
              <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            )}

            <span
              className={cn(
                'text-xs truncate leading-none',
                node.type === 'dir' ? 'text-foreground' : 'text-muted-foreground'
              )}
              title={node.path}
            >
              {node.name}
            </span>
          </div>

          {node.type === 'dir' && isExpanded && (
            <div>
              {!children && !isLoading && (
                <div
                  className="text-xs text-muted-foreground/50 py-0.5"
                  style={{ paddingLeft: `${(depth + 1) * 14 + 6 + 16}px` }}
                >
                  —
                </div>
              )}
              {children?.length === 0 && (
                <div
                  className="text-xs text-muted-foreground/50 py-0.5"
                  style={{ paddingLeft: `${(depth + 1) * 14 + 6 + 16}px` }}
                >
                  empty
                </div>
              )}
              {children && children.length > 0 && renderNodes(children, depth + 1)}
            </div>
          )}
        </div>
      );
    });

  const rootEntries = nodeMap.get(projectPath);
  const rootLoading = loadingRef.current.has(projectPath);
  const rootName = projectPath.split('/').filter(Boolean).pop() ?? projectPath;

  return (
    <>
    {previewPath && (
      <FilePreviewDialog filePath={previewPath} onClose={() => setPreviewPath(null)} />
    )}
    <div className="h-full flex flex-col bg-background text-foreground select-none">
      <div className="flex items-center justify-between px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Files</span>
        <button
          className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
          onClick={refresh}
          title="Refresh file tree"
        >
          <RefreshCw className={cn('h-3 w-3', rootLoading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border flex-shrink-0">
        <FolderOpen className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
        <span className="text-xs text-foreground font-medium truncate" title={projectPath}>
          {rootName}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {rootLoading && !rootEntries ? (
          <div className="text-xs text-muted-foreground px-4 py-3">Loading…</div>
        ) : !rootEntries || rootEntries.length === 0 ? (
          <div className="text-xs text-muted-foreground px-4 py-3">Empty folder</div>
        ) : (
          renderNodes(rootEntries, 0)
        )}
      </div>
    </div>
    </>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Image,
  RefreshCw,
  Download,
  Upload,
} from 'lucide-react';
import { browseFilesystem, FilesystemEntry, getRawFileUrl, getToken, uploadFiles } from '@/lib/api';
import { FilePreviewDialog } from './FilePreviewDialog';
import { cn } from '@/lib/utils';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif']);

function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTS.has(name.slice(dot + 1).toLowerCase());
}

interface FileTreeProps {
  projectPath: string;
}

interface ContextMenu {
  x: number;
  y: number;
  filePath: string;
  fileName: string;
}

export function FileTree({ projectPath }: FileTreeProps) {
  const [nodeMap, setNodeMap] = useState<Map<string, FilesystemEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set([projectPath]));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close context menu on click outside or scroll
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  const handleDownload = (filePath: string, fileName: string) => {
    let url = getRawFileUrl(filePath);
    const token = getToken();
    if (token) url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  };

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      await uploadFiles(projectPath, files);
      void loadDir(projectPath);
    } catch (err) {
      console.error('[FileTree] Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void handleUpload(files);
  };

  const loadDir = useCallback(
    async (dirPath: string) => {
      setLoading((prev) => {
        if (prev.has(dirPath)) return prev; // already loading
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
      try {
        const result = await browseFilesystem(dirPath);
        setNodeMap((prev) => new Map(prev).set(dirPath, result.entries));
      } catch (err) {
        console.error('[FileTree] Failed to load:', dirPath, err);
        setNodeMap((prev) => new Map(prev).set(dirPath, []));
      } finally {
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    []
  );

  useEffect(() => {
    setNodeMap(new Map());
    setExpanded(new Set([projectPath]));
    setLoading(new Set());
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
    setLoading(new Set());
    void loadDir(projectPath);
  }, [projectPath, loadDir]);

  const renderNodes = (nodes: FilesystemEntry[], depth: number) =>
    nodes.map((node) => {
      const isExpanded = expanded.has(node.path);
      const isLoading = loading.has(node.path);
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
            onContextMenu={(e) => {
              if (node.type === 'file') {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, filePath: node.path, fileName: node.name });
              }
            }}
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
            ) : isImageFile(node.name) ? (
              <Image className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
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

          <AnimatePresence initial={false}>
            {node.type === 'dir' && isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    });

  const rootEntries = nodeMap.get(projectPath);
  const rootLoading = loading.has(projectPath);
  const rootName = projectPath.split('/').filter(Boolean).pop() ?? projectPath;

  return (
    <>
    {previewPath && (
      <FilePreviewDialog filePath={previewPath} onClose={() => setPreviewPath(null)} />
    )}
    {ctxMenu && (
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[140px] bg-popover border border-border rounded-md shadow-md py-1"
        style={{ left: ctxMenu.x, top: ctxMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground text-left"
          onClick={() => { handleDownload(ctxMenu.filePath, ctxMenu.fileName); setCtxMenu(null); }}
        >
          <Download className="h-3.5 w-3.5" />
          下载
        </button>
      </div>
    )}
    <div className="h-full flex flex-col bg-background text-foreground select-none">
      <div className="flex items-center justify-between px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Files</span>
        <div className="flex items-center gap-0.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) void handleUpload(files);
              e.target.value = '';
            }}
          />
          <button
            className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="上传文件"
          >
            <Upload className={cn('h-3 w-3', uploading && 'animate-pulse')} />
          </button>
          <button
            className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
            onClick={refresh}
            title="Refresh file tree"
          >
            <RefreshCw className={cn('h-3 w-3', rootLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border flex-shrink-0">
        <FolderOpen className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
        <span className="text-xs text-foreground font-medium truncate" title={projectPath}>
          {rootName}
        </span>
      </div>

      <div
        className={cn(
          'flex-1 overflow-y-auto py-1 min-h-0 transition-colors',
          dragOver && 'bg-accent/30 ring-1 ring-inset ring-accent'
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {uploading && (
          <div className="text-xs text-muted-foreground px-4 py-1">上传中...</div>
        )}
        {dragOver && !uploading && (
          <div className="text-xs text-muted-foreground px-4 py-1">松开以上传文件</div>
        )}
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

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
  Trash2,
  Copy,
  ClipboardCopy,
} from 'lucide-react';
import { toast } from 'sonner';
import { browseFilesystem, FilesystemEntry, getRawFileUrl, getToken, uploadFiles, deletePath } from '@/lib/api';
import { FilePreviewDialog } from './FilePreviewDialog';
import { cn } from '@/lib/utils';
import { copyText } from '@/lib/clipboard';
import { useProjectDialogStore } from '@/lib/stores';
import { useConfirm } from '@/components/ConfirmProvider';
import { useLongPress } from '@/hooks/useLongPress';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif']);

function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTS.has(name.slice(dot + 1).toLowerCase());
}

interface FileTreeProps {
  projectPath: string;
  projectId: string;
}

interface ContextMenu {
  x: number;
  y: number;
  filePath: string;
  fileName: string;
  type: 'file' | 'dir';
}

export function FileTree({ projectPath, projectId }: FileTreeProps) {
  const [nodeMap, setNodeMap] = useState<Map<string, FilesystemEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set([projectPath]));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const previewPath = useProjectDialogStore((s) => s.get(projectId).filePreviewPath);
  const setFilePreviewPath = useProjectDialogStore((s) => s.setFilePreviewPath);
  const setPreviewPath = (path: string | null) => setFilePreviewPath(projectId, path);
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const confirm = useConfirm();
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Touchscreen long-press → same context menu as right-click. Bound per
  // file/dir row inside renderNodes; wasTriggered guards onClick from the
  // release tap.
  const longPress = useLongPress();

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

  const handleDownload = async (filePath: string, fileName: string) => {
    let base = getRawFileUrl(filePath);
    const token = getToken();
    if (token) base += `${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    const downloadUrl = `${base}${base.includes('?') ? '&' : '?'}dl=1`;

    // Pre-check via HEAD so 4xx errors (auth, not-found, out-of-workspace)
    // surface as an in-app toast. A plain <a> click on a forbidden URL
    // would just silently open a blank browser download dialog.
    // IMPORTANT: probe the download URL (with `dl=1`), not the preview URL.
    // Express routes HEAD to the same GET handler, and the preview branch
    // caps size at 20 MB — probing without `dl=1` would 413 any large file
    // and the user would get a false "下载失败" for exactly the files this
    // change was meant to enable.
    try {
      const probe = await fetch(downloadUrl, { method: 'HEAD' });
      if (!probe.ok) {
        toast.error(`下载失败 (${probe.status})`);
        return;
      }
    } catch {
      toast.error('下载失败：网络错误');
      return;
    }

    // Direct-link download: browser streams directly to disk via its
    // native download manager. Replaces the old fetch→blob→anchor flow,
    // which (a) loaded the entire file into memory (OOM'd on multi-GB
    // files) and (b) hung forever when the server's Content-Length didn't
    // match the actual bytes, because `await res.blob()` never resolved —
    // that's the "stuck at 99%" we were hitting. Native download handles
    // arbitrary file sizes, shows real progress, supports cancel/pause.
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const total = files.reduce((s, f) => s + f.size, 0);
    setUploading(true);
    setUploadProgress({ loaded: 0, total });
    try {
      const result = await uploadFiles(projectPath, files, (loaded, t) => {
        setUploadProgress({ loaded, total: t });
      });
      void loadDir(projectPath);
      const ok = result.uploaded.length;
      const skipped = result.skipped?.length ?? 0;
      const failed = result.errors.length;
      if (failed > 0) {
        toast.error(`上传完成：${ok} 成功，${failed} 失败${skipped ? `，${skipped} 跳过` : ''}`);
      } else if (skipped > 0) {
        toast.info(`已上传 ${ok} 个文件，${skipped} 个同名文件被跳过`);
      } else {
        toast.success(`已上传 ${ok} 个文件`);
      }
    } catch (err) {
      console.error('[FileTree] Upload failed:', err);
      toast.error(`上传失败: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  // Inline byte formatter — avoids pulling in a util just for one site.
  const fmtBytes = (b: number): string => {
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  };

  const handleDelete = async (filePath: string, fileName: string, type: 'file' | 'dir') => {
    const label = type === 'dir' ? `文件夹 "${fileName}" 及其所有内容` : `文件 "${fileName}"`;
    const ok = await confirm({
      title: '确认删除',
      description: `确认删除${label}？此操作不可撤销。`,
      destructive: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      await deletePath(filePath);
      toast.success(`已删除: ${fileName}`);
      // Refresh the parent directory
      const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (parentDir && nodeMap.has(parentDir)) {
        void loadDir(parentDir);
      } else {
        void loadDir(projectPath);
      }
    } catch (err) {
      toast.error(`删除失败: ${(err as Error).message}`);
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
              'hover:bg-muted-foreground/10',
              isHidden && 'opacity-50'
            )}
            style={{
              paddingLeft: `${depth * 14 + 6}px`,
              paddingRight: '6px',
              // Suppress iOS Safari's native "text selection / callout"
              // long-press UI — otherwise it races our custom menu.
              WebkitTouchCallout: 'none' as const,
            }}
            onClick={(e) => {
              // Swallow the tap that follows a long-press release: without
              // stopPropagation the click bubbles to window and the menu's
              // outside-click closer fires, closing the menu we just
              // opened. With stopPropagation, the menu stays up until the
              // user actually taps outside it.
              if (longPress.wasTriggered.current) {
                longPress.wasTriggered.current = false;
                e.stopPropagation();
                return;
              }
              if (node.type === 'dir') toggle(node.path);
              else setPreviewPath(node.path);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY, filePath: node.path, fileName: node.name, type: node.type });
            }}
            {...longPress.bind((x, y) => {
              setCtxMenu({ x, y, filePath: node.path, fileName: node.name, type: node.type });
            })}
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
          onClick={() => {
            const relative = ctxMenu.filePath.startsWith(projectPath + '/')
              ? ctxMenu.filePath.slice(projectPath.length + 1)
              : ctxMenu.filePath;
            void copyText(relative).then((ok) => {
              if (ok) toast.success('已复制相对路径');
              else toast.error('复制失败');
            });
            setCtxMenu(null);
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          复制相对路径
        </button>
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground text-left"
          onClick={() => {
            const path = ctxMenu.filePath;
            void copyText(path).then((ok) => {
              if (ok) toast.success('已复制绝对路径');
              else toast.error('复制失败');
            });
            setCtxMenu(null);
          }}
        >
          <ClipboardCopy className="h-3.5 w-3.5" />
          复制绝对路径
        </button>
        {ctxMenu.type === 'file' && (
          <>
          <div className="my-1 border-t border-border" />
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground text-left"
            onClick={() => { handleDownload(ctxMenu.filePath, ctxMenu.fileName); setCtxMenu(null); }}
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </button>
          </>
        )}
        <div className="my-1 border-t border-border" />
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-destructive/80 hover:text-destructive-foreground text-left"
          onClick={() => { handleDelete(ctxMenu.filePath, ctxMenu.fileName, ctxMenu.type); setCtxMenu(null); }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>
    )}
    <div className="h-full flex flex-col text-foreground select-none">
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
        {uploading && uploadProgress && (
          <div className="px-3 py-2 border-b border-border space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>上传中 {Math.floor((uploadProgress.loaded / Math.max(uploadProgress.total, 1)) * 100)}%</span>
              <span className="font-mono">
                {fmtBytes(uploadProgress.loaded)} / {fmtBytes(uploadProgress.total)}
              </span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-150"
                style={{ width: `${(uploadProgress.loaded / Math.max(uploadProgress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
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

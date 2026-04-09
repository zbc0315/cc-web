import { useState, useEffect, useCallback } from 'react';
import { X, Folder, FileText, ArrowLeft, Loader2, Image, FileCode, FileJson, File } from 'lucide-react';
import { browseFilesystem, FilesystemEntry } from '@/lib/api';
import { MobileFilePreview } from './MobileFilePreview';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'swift', 'kt', 'cs', 'php', 'sh', 'bash', 'zsh', 'r', 'lua', 'dart', 'zig', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'sql']);
const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'csv', 'tsv']);

function getExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function FileIcon({ entry }: { entry: FilesystemEntry }) {
  if (entry.type === 'dir') return <Folder className="h-8 w-8 text-blue-400" />;
  const ext = getExt(entry.name);
  if (IMAGE_EXTS.has(ext)) return <Image className="h-8 w-8 text-emerald-400" />;
  if (CODE_EXTS.has(ext)) return <FileCode className="h-8 w-8 text-orange-400" />;
  if (DATA_EXTS.has(ext)) return <FileJson className="h-8 w-8 text-yellow-400" />;
  if (ext === 'md') return <FileText className="h-8 w-8 text-sky-400" />;
  return <File className="h-8 w-8 text-muted-foreground" />;
}

interface MobileFileBrowserProps {
  rootPath: string;
  onClose: () => void;
}

export function MobileFileBrowser({ rootPath, onClose }: MobileFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [entries, setEntries] = useState<FilesystemEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const result = await browseFilesystem(path);
      const sorted = [...result.entries].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
      setCurrentPath(path);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDir(rootPath);
  }, [rootPath, loadDir]);

  const handleEntry = (entry: FilesystemEntry) => {
    if (entry.type === 'dir') {
      void loadDir(entry.path);
    } else {
      setPreviewFile(entry.path);
    }
  };

  const goUp = () => {
    if (currentPath === rootPath) return;
    const parent = currentPath.replace(/\/[^/]+$/, '') || '/';
    if (parent.startsWith(rootPath)) {
      void loadDir(parent);
    }
  };

  const canGoUp = currentPath !== rootPath;

  const displayPath = currentPath.startsWith(rootPath)
    ? currentPath.slice(rootPath.length) || '/'
    : currentPath;

  if (previewFile) {
    return (
      <MobileFilePreview
        filePath={previewFile}
        onBack={() => setPreviewFile(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0">
        <button onClick={onClose} className="text-muted-foreground active:text-foreground p-1">
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm">
          {canGoUp && (
            <button onClick={goUp} className="text-muted-foreground active:text-foreground p-0.5 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <span className="truncate text-muted-foreground font-mono text-xs">{displayPath}</span>
        </div>
      </div>

      {/* File grid — icon tiles */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-12">
            空目录
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-3 gap-1">
            {entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => handleEntry(entry)}
                className="flex flex-col items-center gap-1 p-2 rounded-lg active:bg-accent transition-colors"
              >
                <FileIcon entry={entry} />
                <span className="text-[11px] text-center leading-tight w-full line-clamp-2 break-all">
                  {entry.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

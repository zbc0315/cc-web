import { useState, useEffect, useCallback } from 'react';
import { X, Folder, FileText, ChevronRight, ArrowLeft, Loader2 } from 'lucide-react';
import { browseFilesystem, FilesystemEntry } from '@/lib/api';
import { MobileFilePreview } from './MobileFilePreview';

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
      // Sort: folders first, then files, alphabetically
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
    // Don't navigate above root
    if (currentPath === rootPath) return;
    const parent = currentPath.replace(/\/[^/]+$/, '') || '/';
    if (parent.startsWith(rootPath)) {
      void loadDir(parent);
    }
  };

  const canGoUp = currentPath !== rootPath;

  // Relative path display
  const displayPath = currentPath.startsWith(rootPath)
    ? currentPath.slice(rootPath.length) || '/'
    : currentPath;

  // File preview mode
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

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
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

        {!loading && entries.map((entry) => (
          <button
            key={entry.path}
            onClick={() => handleEntry(entry)}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/50 active:bg-accent transition-colors text-left"
          >
            {entry.type === 'dir' ? (
              <Folder className="h-4 w-4 text-blue-400 shrink-0" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="flex-1 text-sm truncate">{entry.name}</span>
            {entry.type === 'dir' && (
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

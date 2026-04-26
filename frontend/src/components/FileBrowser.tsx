import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Folder, File, Home, ArrowLeft, FolderPlus, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { browseFilesystem, createFolder, FilesystemEntry } from '@/lib/api';
import { cn } from '@/lib/utils';

interface FileBrowserProps {
  onSelect: (path: string) => void;
}

export function FileBrowser({ onSelect }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FilesystemEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-folder inline state
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadPath = async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await browseFilesystem(path);
      setCurrentPath(result.path);
      setParentPath(result.parent);
      setEntries(result.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPath();
  }, []);

  // Focus the input when the inline form opens
  useEffect(() => {
    if (creatingFolder) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [creatingFolder]);

  const startCreatingFolder = () => {
    setNewFolderName('');
    setCreateError(null);
    setCreatingFolder(true);
  };

  const cancelCreatingFolder = () => {
    setCreatingFolder(false);
    setNewFolderName('');
    setCreateError(null);
  };

  const confirmCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const { path: newPath } = await createFolder(currentPath, name);
      setCreatingFolder(false);
      setNewFolderName('');
      // Refresh and navigate into the new folder
      await loadPath(currentPath);
      void loadPath(newPath);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleNewFolderKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void confirmCreateFolder();
    } else if (e.key === 'Escape') {
      cancelCreatingFolder();
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  const navigateToBreadcrumb = (index: number) => {
    const targetPath = '/' + pathParts.slice(0, index + 1).join('/');
    void loadPath(targetPath);
  };

  return (
    <div className="flex flex-col h-64 border rounded-md overflow-hidden">
      {/* Breadcrumb + New Folder button */}
      <div className="flex items-center gap-1 px-2 py-2 bg-muted border-b flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1 flex-shrink-0"
          onClick={() => void loadPath()}
          title="Home"
        >
          <Home className="h-3 w-3" />
        </Button>
        <div className="flex items-center gap-1 flex-1 overflow-x-auto min-w-0">
          {pathParts.map((part, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <button
                className="text-xs hover:text-foreground text-muted-foreground whitespace-nowrap"
                onClick={() => navigateToBreadcrumb(i)}
              >
                {part}
              </button>
            </React.Fragment>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 flex-shrink-0 gap-1 text-xs"
          onClick={startCreatingFolder}
          disabled={creatingFolder || loading || !!error}
          title="New folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New folder</span>
        </Button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Loading...
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full text-sm text-destructive px-4 text-center">
            {error}
          </div>
        )}
        {!loading && !error && (
          <div className="p-1">
            {/* Up directory */}
            {parentPath && (
              <button
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground"
                onClick={() => void loadPath(parentPath)}
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                <span>..</span>
              </button>
            )}

            {/* Inline new-folder row */}
            {creatingFolder && (
              <div className="flex items-center gap-1 px-2 py-1.5">
                <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <input
                  ref={inputRef}
                  className={cn(
                    'flex-1 text-sm bg-background border rounded px-1.5 py-0.5 outline-none',
                    'focus:ring-1 focus:ring-ring',
                    createError && 'border-destructive'
                  )}
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => {
                    setNewFolderName(e.target.value);
                    setCreateError(null);
                  }}
                  onKeyDown={handleNewFolderKeyDown}
                  disabled={createLoading}
                />
                <button
                  className="p-1 rounded hover:bg-accent disabled:opacity-50"
                  onClick={() => void confirmCreateFolder()}
                  disabled={!newFolderName.trim() || createLoading}
                  title="Create"
                >
                  <Check className="h-3.5 w-3.5 text-green-600" />
                </button>
                <button
                  className="p-1 rounded hover:bg-accent"
                  onClick={cancelCreatingFolder}
                  disabled={createLoading}
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            )}
            {createError && (
              <p className="px-3 pb-1 text-xs text-destructive">{createError}</p>
            )}

            {entries.length === 0 && !creatingFolder && (
              <div className="text-sm text-muted-foreground px-2 py-4 text-center">
                Empty directory
              </div>
            )}
            {entries.map((entry) => (
              <button
                key={entry.path}
                className={cn(
                  'flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded text-left',
                  entry.type === 'dir'
                    ? 'hover:bg-accent hover:text-accent-foreground cursor-pointer'
                    : 'opacity-40 cursor-not-allowed'
                )}
                onClick={() => {
                  if (entry.type === 'dir') {
                    void loadPath(entry.path);
                  }
                }}
                disabled={entry.type === 'file'}
              >
                {entry.type === 'dir' ? (
                  <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Select button */}
      <div className="border-t px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0 bg-background">
        <span className="text-xs text-muted-foreground truncate flex-1">{currentPath}</span>
        <Button
          size="sm"
          onClick={() => onSelect(currentPath)}
          disabled={!currentPath}
        >
          Select this folder
        </Button>
      </div>
    </div>
  );
}

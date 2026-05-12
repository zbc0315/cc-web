import { X, FileText, Code, Image as ImageIcon, FileSpreadsheet, Presentation, Network, File as FileIcon } from 'lucide-react';
import { useProjectDialogStore } from '@/lib/stores';
import { cn } from '@/lib/utils';

interface PreviewDockProps {
  projectId: string;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif']);
const CODE_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cpp', 'h', 'cs', 'php', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'json',
  'toml', 'html', 'htm', 'xml', 'css', 'scss', 'less', 'sql', 'graphql',
  'gql', 'r', 'lua', 'dart', 'zig',
]);

function getFileExt(path: string): string {
  const name = path.split('/').pop() ?? '';
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile') return 'makefile';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function getFileName(path: string): string {
  return path.split('/').pop() ?? path;
}

function iconForPath(path: string) {
  if (path.endsWith('/.notebook/graph.yaml')) return Network;
  const ext = getFileExt(path);
  if (IMAGE_EXTS.has(ext)) return ImageIcon;
  if (ext === 'pdf') return FileText;
  if (ext === 'xlsx' || ext === 'xls') return FileSpreadsheet;
  if (ext === 'pptx') return Presentation;
  if (ext === 'docx') return FileText;
  if (ext === 'md') return FileText;
  if (CODE_EXTS.has(ext)) return Code;
  return FileIcon;
}

export function PreviewDock({ projectId }: PreviewDockProps) {
  const filePreviews = useProjectDialogStore((s) => s.get(projectId).filePreviews);
  const activePreviewPath = useProjectDialogStore((s) => s.get(projectId).activePreviewPath);
  const setActivePreview = useProjectDialogStore((s) => s.setActivePreview);
  const closeFilePreview = useProjectDialogStore((s) => s.closeFilePreview);
  const minimizeFilePreview = useProjectDialogStore((s) => s.minimizeFilePreview);

  if (filePreviews.length === 0) return null;

  return (
    <div
      className="absolute top-2 left-1/2 -translate-x-1/2 z-[60] pointer-events-auto"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1 rounded-full border border-border bg-background/85 backdrop-blur-sm shadow-sm px-1.5 py-1">
        {filePreviews.map((item) => {
          const Icon = iconForPath(item.path);
          const isActive = item.path === activePreviewPath && !item.minimized;
          const handleClick = () => {
            if (isActive) {
              minimizeFilePreview(projectId, item.path);
            } else {
              setActivePreview(projectId, item.path);
            }
          };
          return (
            <div
              key={item.path}
              className={cn(
                'group flex items-center gap-1 rounded-full pl-1.5 pr-1 py-0.5 max-w-[180px] cursor-pointer transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted text-muted-foreground'
              )}
              onClick={handleClick}
              title={item.path}
            >
              <Icon className="size-3.5 flex-shrink-0" />
              <span className="text-xs truncate min-w-0">{getFileName(item.path)}</span>
              <button
                className="flex-shrink-0 size-4 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-background/60 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFilePreview(projectId, item.path);
                }}
                title="关闭"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

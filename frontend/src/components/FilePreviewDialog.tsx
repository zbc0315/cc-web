import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { X, FileText, Code, Eye, Maximize, Minimize, ZoomIn, ZoomOut, Pencil, Save } from 'lucide-react';
import { readFile, writeFile, FileContent } from '@/lib/api';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from './theme-provider';

interface FilePreviewDialogProps {
  filePath: string;
  onClose: () => void;
}

const EXT_LANG_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp', h: 'c',
  cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  yaml: 'yaml', yml: 'yaml', json: 'json', toml: 'toml',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'docker', makefile: 'makefile',
  r: 'r', lua: 'lua', dart: 'dart', zig: 'zig',
};

function getFileExt(path: string): string {
  const name = path.split('/').pop() ?? '';
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile') return 'makefile';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

type ViewMode = 'plain' | 'rendered' | 'edit';

function canRender(ext: string): boolean {
  return ext === 'md' || ext === 'html' || ext === 'htm' || ext in EXT_LANG_MAP;
}

function getRenderLabel(ext: string): string {
  if (ext === 'md') return 'Markdown';
  if (ext === 'html' || ext === 'htm') return 'HTML';
  return '高亮';
}

const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 250, 300];
const DEFAULT_ZOOM = 100;
const ZOOM_STORAGE_KEY = 'cc_file_zoom';

function getSavedZoom(filePath: string): number {
  try {
    const map = JSON.parse(localStorage.getItem(ZOOM_STORAGE_KEY) || '{}') as Record<string, number>;
    return map[filePath] ?? DEFAULT_ZOOM;
  } catch { return DEFAULT_ZOOM; }
}

function saveZoom(filePath: string, zoom: number): void {
  try {
    const map = JSON.parse(localStorage.getItem(ZOOM_STORAGE_KEY) || '{}') as Record<string, number>;
    if (zoom === DEFAULT_ZOOM) {
      delete map[filePath];
    } else {
      map[filePath] = zoom;
    }
    localStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify(map));
  } catch { /**/ }
}

export function FilePreviewDialog({ filePath, onClose }: FilePreviewDialogProps) {
  const [result, setResult] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('rendered');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const { resolved } = useTheme();

  const fileName = filePath.split('/').pop() ?? filePath;
  const ext = useMemo(() => getFileExt(filePath), [filePath]);
  const hasRendered = canRender(ext);
  const lang = EXT_LANG_MAP[ext] || ext;

  useEffect(() => {
    setResult(null);
    setError(null);
    setMode('rendered');
    setZoom(getSavedZoom(filePath));
    setDirty(false);
    readFile(filePath)
      .then((r) => {
        setResult(r);
        setEditContent(r.content ?? '');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load file'));
  }, [filePath]);

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      if (dirty && !confirm('有未保存的修改，确定关闭？')) return;
      onClose();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dirty && !confirm('有未保存的修改，确定关闭？')) return;
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, dirty]);

  // Cmd+S to save in edit mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && mode === 'edit') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, editContent, filePath]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await writeFile(filePath, editContent);
      setResult((prev) => prev ? { ...prev, content: editContent, size: new Blob([editContent]).size } : prev);
      setDirty(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [filePath, editContent]);

  const enterEdit = () => {
    setEditContent(result?.content ?? '');
    setDirty(false);
    setMode('edit');
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const exitEdit = () => {
    if (dirty && !confirm('有未保存的修改，确定退出编辑？')) return;
    setMode(hasRendered ? 'rendered' : 'plain');
    setDirty(false);
  };

  const applyZoom = (value: number) => {
    setZoom(value);
    saveZoom(filePath, value);
  };
  const zoomIn = () => {
    const next = ZOOM_STEPS.find((s) => s > zoom);
    if (next) applyZoom(next);
  };
  const zoomOut = () => {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < zoom);
    if (prev) applyZoom(prev);
  };
  const zoomReset = () => applyZoom(DEFAULT_ZOOM);

  const content = result?.content ?? '';
  const syntaxStyle = resolved === 'dark' ? oneDark : oneLight;
  const baseFontSize = 12 * (zoom / 100);

  const canEdit = result && !result.binary && !result.tooLarge;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div
        className={cn(
          'relative flex flex-col bg-background border border-border shadow-2xl transition-all duration-200',
          isFullscreen
            ? 'w-screen h-screen rounded-none'
            : 'w-[72vw] max-w-4xl h-[80vh] rounded-lg'
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 h-10 border-b border-border flex-shrink-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="flex-1 text-sm text-foreground font-medium truncate" title={filePath}>
            {fileName}
            {dirty && <span className="text-muted-foreground ml-1">*</span>}
          </span>

          {/* View mode toggle */}
          {canEdit && (
            <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
              {hasRendered && (
                <>
                  <button
                    onClick={() => mode === 'edit' ? exitEdit() : setMode('plain')}
                    className={cn(
                      'p-1 rounded-sm transition-colors flex items-center gap-1 text-xs',
                      mode === 'plain'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    title="纯文本"
                  >
                    <Code className="h-3 w-3" />
                    <span className="hidden sm:inline">源码</span>
                  </button>
                  <button
                    onClick={() => mode === 'edit' ? exitEdit() : setMode('rendered')}
                    className={cn(
                      'p-1 rounded-sm transition-colors flex items-center gap-1 text-xs',
                      mode === 'rendered'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    title={getRenderLabel(ext)}
                  >
                    <Eye className="h-3 w-3" />
                    <span className="hidden sm:inline">{getRenderLabel(ext)}</span>
                  </button>
                </>
              )}
              <button
                onClick={() => mode === 'edit' ? exitEdit() : enterEdit()}
                className={cn(
                  'p-1 rounded-sm transition-colors flex items-center gap-1 text-xs',
                  mode === 'edit'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                title="编辑"
              >
                <Pencil className="h-3 w-3" />
                <span className="hidden sm:inline">编辑</span>
              </button>
            </div>
          )}

          {/* Save button (edit mode) */}
          {mode === 'edit' && (
            <button
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className={cn(
                'flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors',
                dirty
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-muted text-muted-foreground'
              )}
              title="保存 (⌘S)"
            >
              <Save className="h-3 w-3" />
              {saving ? '保存中...' : '保存'}
            </button>
          )}

          {/* Zoom controls (not in edit mode) */}
          {canEdit && mode !== 'edit' && (
            <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5 gap-0.5">
              <button
                onClick={zoomOut}
                disabled={zoom <= ZOOM_STEPS[0]}
                className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                title="缩小"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <button
                onClick={zoomReset}
                className="px-1 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-[36px] text-center"
                title="重置缩放"
              >
                {zoom}%
              </button>
              <button
                onClick={zoomIn}
                disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                title="放大"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Fullscreen toggle */}
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
          </button>

          <button
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              if (dirty && !confirm('有未保存的修改，确定关闭？')) return;
              onClose();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0">
          {!result && !error && (
            <p className="text-sm text-muted-foreground p-4">Loading…</p>
          )}

          {error && (
            <p className="text-sm text-red-400 p-4">{error}</p>
          )}

          {result && result.binary && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground p-4">
              <FileText className="h-8 w-8" />
              <p className="text-sm">Binary file — cannot preview</p>
              <p className="text-xs text-muted-foreground">{(result.size / 1024).toFixed(1)} KB</p>
            </div>
          )}

          {result && result.tooLarge && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground p-4">
              <FileText className="h-8 w-8" />
              <p className="text-sm">File too large to preview</p>
              <p className="text-xs text-muted-foreground">{(result.size / 1024 / 1024).toFixed(2)} MB (limit 1 MB)</p>
            </div>
          )}

          {canEdit && content !== null && (
            <>
              {/* Edit mode */}
              {mode === 'edit' && (
                <textarea
                  ref={editorRef}
                  value={editContent}
                  onChange={(e) => { setEditContent(e.target.value); setDirty(true); }}
                  className="w-full h-full bg-transparent text-foreground font-mono outline-none resize-none p-4 leading-relaxed"
                  style={{ fontSize: `${baseFontSize}px`, minHeight: '100%' }}
                  spellCheck={false}
                />
              )}

              {/* Preview modes */}
              {mode !== 'edit' && (
                <div className="p-4" style={{ fontSize: `${baseFontSize}px` }}>
                  {mode === 'plain' && (
                    <pre className="font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed" style={{ fontSize: 'inherit' }}>
                      {content}
                    </pre>
                  )}

                  {mode === 'rendered' && ext === 'md' && (
                    <div
                      className="prose dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-code:text-foreground"
                      style={{ fontSize: 'inherit' }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            const inline = !match && !className;
                            return inline ? (
                              <code className={className} {...props}>{children}</code>
                            ) : (
                              <SyntaxHighlighter
                                style={syntaxStyle}
                                language={match?.[1] || 'text'}
                                PreTag="div"
                                customStyle={{ fontSize: 'inherit', borderRadius: '6px', margin: 0 }}
                              >
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            );
                          },
                        }}
                      >
                        {content}
                      </ReactMarkdown>
                    </div>
                  )}

                  {mode === 'rendered' && (ext === 'html' || ext === 'htm') && (
                    <iframe
                      srcDoc={content}
                      className="w-full h-full border-0 rounded bg-white"
                      sandbox="allow-scripts"
                      title={fileName}
                      style={{ minHeight: '60vh', transform: `scale(${zoom / 100})`, transformOrigin: 'top left', width: `${10000 / zoom}%`, height: `${10000 / zoom}%` }}
                    />
                  )}

                  {mode === 'rendered' && ext !== 'md' && ext !== 'html' && ext !== 'htm' && lang && (
                    <SyntaxHighlighter
                      style={syntaxStyle}
                      language={lang}
                      showLineNumbers
                      lineNumberStyle={{ color: resolved === 'dark' ? '#555' : '#aaa', fontSize: 'inherit' }}
                      customStyle={{ fontSize: 'inherit', borderRadius: '6px', margin: 0, background: 'transparent' }}
                    >
                      {content}
                    </SyntaxHighlighter>
                  )}

                  {mode === 'rendered' && !hasRendered && (
                    <pre className="font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed" style={{ fontSize: 'inherit' }}>
                      {content}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

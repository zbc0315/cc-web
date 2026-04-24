import React, { Suspense, useEffect, useState, useMemo, useRef, useCallback, useDeferredValue } from 'react';
import { X, FileText, Code, Eye, Maximize, Minimize, ZoomIn, ZoomOut, Pencil, Save, Network } from 'lucide-react';
import DOMPurify from 'dompurify';
import { toast } from 'sonner';
import { readFile, writeFile, FileContent, getRawFileUrl, getToken } from '@/lib/api';
import { resolveMarkdownImageSrc } from '@/lib/markdownImg';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/ConfirmProvider';
import { STORAGE_KEYS, getStorage, setStorage } from '@/lib/storage';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from './theme-provider';
const GraphPreview = React.lazy(() => import('./GraphPreview').then((m) => ({ default: m.GraphPreview })));
const OfficePreviewLazy = React.lazy(() => import('./OfficePreview').then((m) => ({ default: m.OfficePreview })));

const OFFICE_EXTS = new Set(['docx', 'xlsx', 'xls', 'pptx']);

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

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff', 'tif']);

type ViewMode = 'plain' | 'rendered' | 'edit' | 'graph';

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

function getSavedZoom(filePath: string): number {
  const map = getStorage<Record<string, number>>(STORAGE_KEYS.fileZoom, {}, true);
  const val = map[filePath];
  return ZOOM_STEPS.includes(val) ? val : DEFAULT_ZOOM;
}

function saveZoom(filePath: string, zoom: number): void {
  const map = getStorage<Record<string, number>>(STORAGE_KEYS.fileZoom, {}, true);
  if (zoom === DEFAULT_ZOOM) {
    delete map[filePath];
  } else {
    map[filePath] = zoom;
  }
  setStorage(STORAGE_KEYS.fileZoom, map, true);
}

export function FilePreviewDialog({ filePath, onClose }: FilePreviewDialogProps) {
  const confirm = useConfirm();
  const isGraphYaml = filePath.endsWith('/.notebook/graph.yaml');
  const graphFolderPath = isGraphYaml ? filePath.replace(/\/.notebook\/graph\.yaml$/, '') : '';

  const [result, setResult] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>(() => isGraphYaml ? 'graph' : 'rendered');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(true);
  const { resolved } = useTheme();

  const fileName = filePath.split('/').pop() ?? filePath;
  const ext = useMemo(() => getFileExt(filePath), [filePath]);
  const isImage = IMAGE_EXTS.has(ext);
  const isOffice = OFFICE_EXTS.has(ext);
  const hasRendered = canRender(ext);
  const lang = EXT_LANG_MAP[ext] || ext;

  // Build authenticated raw URL for images — include timestamp to bust browser cache on re-open
  const imageUrl = useMemo(() => {
    if (!isImage) return '';
    const base = getRawFileUrl(filePath);
    const token = getToken();
    const ts = Date.now();
    const withTs = `${base}&t=${ts}`;
    return token ? `${withTs}&token=${encodeURIComponent(token)}` : withTs;
  }, [filePath, isImage]);

  useEffect(() => {
    setIsFocused(true);
    setResult(null);
    setError(null);
    setZoom(getSavedZoom(filePath));
    setDirty(false);
    if (isImage || isOffice) {
      // For images and office files, we don't need to fetch content via readFile
      setResult({ path: filePath, binary: false, tooLarge: false, size: 0, content: null } as FileContent);
      setMode('rendered');
      return;
    }
    setMode(filePath.endsWith('/.notebook/graph.yaml') ? 'graph' : 'rendered');
    readFile(filePath)
      .then((r) => {
        setResult(r);
        setEditContent(r.content ?? '');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load file'));
  }, [filePath, isImage, isOffice]);

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setIsFocused(false);
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await writeFile(filePath, editContent);
      setResult((prev) => prev ? { ...prev, content: editContent, size: new Blob([editContent]).size } : prev);
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [filePath, editContent]);

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
  }, [mode, handleSave]);

  // Escape key closes dialog when focused
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFocused) {
        if (dirty) {
          const ok = await confirm({
            description: '有未保存的修改，确定关闭？',
            confirmLabel: '放弃修改',
            destructive: true,
          });
          if (!ok) return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFocused, onClose, dirty, confirm]);

  const enterEdit = () => {
    setEditContent(result?.content ?? '');
    setDirty(false);
    setMode('edit');
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const exitEdit = async () => {
    if (dirty) {
      const ok = await confirm({
        description: '有未保存的修改，确定退出编辑？',
        confirmLabel: '放弃修改',
        destructive: true,
      });
      if (!ok) return;
    }
    setMode(isGraphYaml ? 'graph' : hasRendered ? 'rendered' : 'plain');
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

  // Text stats (bytes / words / lines) — shown for any previewable text file,
  // not just markdown. In edit mode each keystroke updates `editContent`, so
  // we defer the source string via `useDeferredValue` to avoid running the
  // full UTF-8 size + two regex scans on every keystroke (measurably laggy
  // past ~1 MB).  React coalesces updates; stats lag slightly behind typing
  // but never block input.
  const deferredEditContent = useDeferredValue(editContent);
  const textStats = useMemo(() => {
    if (!result || result.binary || result.tooLarge) return null;
    if (isImage || isOffice) return null;
    const text = mode === 'edit' ? deferredEditContent : content;
    if (text == null) return null;
    const bytes = new Blob([text]).size;
    const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
    const eng = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9]+/g)?.length ?? 0;
    const words = cjk + eng;
    const lines = text === '' ? 0 : text.split('\n').length;
    return { bytes, words, lines };
  }, [result, isImage, isOffice, mode, deferredEditContent, content]);

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center transition-all duration-200',
        isFocused ? 'bg-black/60 backdrop-blur-sm pointer-events-auto' : 'bg-transparent pointer-events-none'
      )}
      onClick={handleBackdrop}
    >
      <div
        className={cn(
          'relative flex flex-col bg-background border border-border shadow-sm transition-all duration-200 pointer-events-auto',
          isFullscreen
            ? 'w-screen h-screen rounded-none'
            : 'w-[72vw] max-w-4xl h-[80vh] rounded-xl',
          !isFocused && !isFullscreen && 'opacity-50'
        )}
        onClick={() => setIsFocused(true)}
        onFocus={(e) => { e.stopPropagation(); setIsFocused(true); }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 h-10 border-b border-border flex-shrink-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="flex-1 text-sm text-foreground font-medium truncate" title={filePath}>
            {fileName}
            {dirty && <span className="text-muted-foreground ml-1">*</span>}
            {textStats && (
              <span className="text-muted-foreground font-normal ml-2 text-xs tabular-nums">
                {formatBytes(textStats.bytes)} · {textStats.words.toLocaleString()} 词 · {textStats.lines.toLocaleString()} 行
              </span>
            )}
          </span>

          {/* View mode toggle */}
          {canEdit && !isImage && !isOffice && (
            <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
              {hasRendered && (
                <>
                  <button
                    onClick={() => mode === 'edit' ? exitEdit() : setMode('plain')}
                    className={cn(
                      'p-1 rounded-md transition-colors flex items-center gap-1 text-xs',
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
                      'p-1 rounded-md transition-colors flex items-center gap-1 text-xs',
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
              {isGraphYaml && (
                <button
                  onClick={() => mode === 'edit' ? exitEdit() : setMode('graph')}
                  className={cn(
                    'p-1 rounded-md transition-colors flex items-center gap-1 text-xs',
                    mode === 'graph'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="图谱"
                >
                  <Network className="h-3 w-3" />
                  <span className="hidden sm:inline">图谱</span>
                </button>
              )}
              <button
                onClick={() => mode === 'edit' ? exitEdit() : enterEdit()}
                className={cn(
                  'p-1 rounded-md transition-colors flex items-center gap-1 text-xs',
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

          {/* Zoom controls (not in edit or graph mode) */}
          {(canEdit || isImage) && mode !== 'edit' && mode !== 'graph' && (
            <div className="flex items-center rounded-md border border-border bg-muted/50 p-0.5 gap-0.5">
              <button
                onClick={zoomOut}
                disabled={zoom <= ZOOM_STEPS[0]}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
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
                className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
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
            onClick={async () => {
              if (dirty) {
                const ok = await confirm({
                  description: '有未保存的修改，确定关闭？',
                  confirmLabel: '放弃修改',
                  destructive: true,
                });
                if (!ok) return;
              }
              onClose();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className={cn('flex-1 min-h-0', mode === 'graph' ? 'overflow-hidden' : 'overflow-auto')}>
          {/* Graph visualization mode */}
          {mode === 'graph' && (
            <Suspense fallback={<p className="text-sm text-muted-foreground p-4">Loading…</p>}>
              <GraphPreview folderPath={graphFolderPath} />
            </Suspense>
          )}

          {mode !== 'graph' && !result && !error && (
            <p className="text-sm text-muted-foreground p-4">Loading…</p>
          )}

          {mode !== 'graph' && error && (
            <p className="text-sm text-red-400 p-4">{error}</p>
          )}

          {mode !== 'graph' && isImage && result && (
            <div className="flex items-center justify-center p-4 h-full">
              <img
                src={imageUrl}
                alt={fileName}
                className="max-w-full max-h-full object-contain rounded"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
                draggable={false}
              />
            </div>
          )}

          {mode !== 'graph' && isOffice && result && (
            <Suspense fallback={<p className="text-sm text-muted-foreground p-4">Loading…</p>}>
              <OfficePreviewLazy filePath={filePath} ext={ext} zoom={zoom} />
            </Suspense>
          )}

          {mode !== 'graph' && !isImage && !isOffice && result && result.binary && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground p-4">
              <FileText className="h-8 w-8" />
              <p className="text-sm">Binary file — cannot preview</p>
              <p className="text-xs text-muted-foreground">{(result.size / 1024).toFixed(1)} KB</p>
            </div>
          )}

          {mode !== 'graph' && !isOffice && result && result.tooLarge && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground p-4">
              <FileText className="h-8 w-8" />
              <p className="text-sm">File too large to preview</p>
              <p className="text-xs text-muted-foreground">{(result.size / 1024 / 1024).toFixed(2)} MB (limit 5 MB)</p>
            </div>
          )}

          {mode !== 'graph' && canEdit && content !== null && (
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
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        // react-markdown's default urlTransform strips
                        // `data:` URIs (security guard against JS-in-links).
                        // For <img src> we bypass it: data-URI images are
                        // benign, and our own resolver normalizes relative
                        // filesystem paths. For hrefs we still apply the
                        // default sanitizer so a malicious markdown can't
                        // ship a `javascript:` link.
                        // Let the default sanitizer run for every URL EXCEPT
                        // `<img src>` — our resolver handles those (including
                        // data: URIs which default sanitizer would strip).
                        // Guarding on `tagName === 'img'` is defense-in-depth:
                        // if someone later adds `rehype-raw`, raw <iframe> /
                        // <script src="…"> won't bypass the sanitizer just
                        // because `key === 'src'`.
                        urlTransform={(url, key, node) =>
                          key === 'src' && node.tagName === 'img'
                            ? url
                            : defaultUrlTransform(url)
                        }
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
                          img({ src, alt, ...rest }) {
                            return (
                              <img
                                {...rest}
                                src={resolveMarkdownImageSrc(filePath, src as string | undefined, getToken())}
                                alt={alt ?? ''}
                                loading="lazy"
                                style={{ maxWidth: '100%', height: 'auto' }}
                              />
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
                      srcDoc={DOMPurify.sanitize(content, { WHOLE_DOCUMENT: true, ADD_TAGS: ['style', 'link'] })}
                      className="w-full h-full border-0 rounded bg-white"
                      sandbox=""
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

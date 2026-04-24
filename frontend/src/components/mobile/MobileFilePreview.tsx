import React, { Suspense, useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { readFile, getRawFileUrl, getToken, FileContent } from '@/lib/api';
import { resolveMarkdownImageSrc } from '@/lib/markdownImg';
import { useTheme } from '@/components/theme-provider';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

const OfficePreviewLazy = React.lazy(() => import('../OfficePreview').then((m) => ({ default: m.OfficePreview })));

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const OFFICE_EXTS = new Set(['docx', 'xlsx', 'xls', 'pptx']);

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

function getFileName(path: string): string {
  return path.split('/').pop() ?? path;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface MobileFilePreviewProps {
  filePath: string;
  onBack: () => void;
}

export function MobileFilePreview({ filePath, onBack }: MobileFilePreviewProps) {
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { resolved } = useTheme();

  const ext = getFileExt(filePath);
  const isImage = IMAGE_EXTS.has(ext);
  const isOffice = OFFICE_EXTS.has(ext);
  const lang = EXT_LANG_MAP[ext];
  const isDark = resolved === 'dark';

  useEffect(() => {
    if (isImage || isOffice) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    readFile(filePath)
      .then(setFileContent)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [filePath, isImage, isOffice]);

  const rawUrl = getRawFileUrl(filePath);
  const authUrl = useMemo(() => {
    const token = getToken();
    return token ? `${rawUrl}&token=${encodeURIComponent(token)}` : rawUrl;
  }, [rawUrl]);
  const imageUrl = useMemo(() => {
    if (!isImage) return '';
    return `${authUrl}&t=${Date.now()}`;
  }, [authUrl, isImage]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0">
        <button onClick={onBack} className="text-muted-foreground active:text-foreground p-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="flex-1 text-sm font-medium truncate">{getFileName(filePath)}</span>
        <a
          href={authUrl}
          download
          className="text-muted-foreground active:text-foreground p-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-4 w-4" />
        </a>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-center text-destructive text-sm py-12 px-4">{error}</div>
        )}

        {/* Image */}
        {isImage && (
          <div className="flex items-center justify-center p-4 h-full">
            <img
              src={imageUrl}
              alt={getFileName(filePath)}
              className="max-w-full max-h-full object-contain rounded"
              style={{ touchAction: 'pinch-zoom' }}
            />
          </div>
        )}

        {/* Office files */}
        {isOffice && (
          <Suspense fallback={
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          }>
            <OfficePreviewLazy filePath={filePath} ext={ext} zoom={100} />
          </Suspense>
        )}

        {/* Binary or too large */}
        {fileContent && (fileContent.binary || fileContent.tooLarge) && (
          <div className="text-center py-12 px-4 space-y-3">
            <p className="text-muted-foreground text-sm">
              {fileContent.binary ? '二进制文件' : '文件过大'}
              {fileContent.size > 0 && ` (${formatSize(fileContent.size)})`}
            </p>
            <a
              href={authUrl}
              download
              className="inline-flex items-center gap-1.5 text-sm text-blue-500 active:text-blue-400"
            >
              <Download className="h-4 w-4" />
              下载文件
            </a>
          </div>
        )}

        {/* Text content */}
        {fileContent && !fileContent.binary && !fileContent.tooLarge && fileContent.content != null && (
          <>
            {/* Markdown */}
            {ext === 'md' && (
              <div className="prose prose-sm dark:prose-invert max-w-none px-4 py-3">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  urlTransform={(url, key, node) =>
                    key === 'src' && node.tagName === 'img'
                      ? url
                      : defaultUrlTransform(url)
                  }
                  components={{
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
                  {fileContent.content}
                </ReactMarkdown>
              </div>
            )}

            {/* Syntax highlighted code */}
            {ext !== 'md' && lang && (
              <SyntaxHighlighter
                language={lang}
                style={isDark ? oneDark : oneLight}
                customStyle={{ margin: 0, fontSize: '12px', borderRadius: 0 }}
                showLineNumbers
              >
                {fileContent.content}
              </SyntaxHighlighter>
            )}

            {/* Plain text */}
            {ext !== 'md' && !lang && (
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words">
                {fileContent.content}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

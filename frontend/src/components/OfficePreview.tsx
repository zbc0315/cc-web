import { useEffect, useState } from 'react';
import { getRawFileUrl, getToken } from '@/lib/api';

interface OfficePreviewProps {
  filePath: string;
  ext: string;
  zoom: number;
}

async function fetchBlob(filePath: string): Promise<ArrayBuffer> {
  let url = getRawFileUrl(filePath);
  const token = getToken();
  if (token) url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
  return res.arrayBuffer();
}

// ── DOCX Preview ─────────────────────────────────────────────────────────────

function DocxPreview({ filePath, zoom }: { filePath: string; zoom: number }) {
  const [html, setHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const mammoth = await import('mammoth');
        const buf = await fetchBlob(filePath);
        const result = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) setHtml(result.value);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render docx');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  if (loading) return <p className="text-sm text-muted-foreground p-4">加载 Word 文档中...</p>;
  if (error) return <p className="text-sm text-destructive p-4">{error}</p>;

  return (
    <div
      className="p-6 prose dark:prose-invert max-w-none"
      style={{ fontSize: `${12 * zoom / 100}px` }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── XLSX Preview ─────────────────────────────────────────────────────────────

function XlsxPreview({ filePath, zoom }: { filePath: string; zoom: number }) {
  const [sheets, setSheets] = useState<{ name: string; html: string }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const XLSX = await import('xlsx');
        const buf = await fetchBlob(filePath);
        const wb = XLSX.read(buf, { type: 'array' });
        const result = wb.SheetNames.map((name) => ({
          name,
          html: XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false }),
        }));
        if (!cancelled) {
          setSheets(result);
          setActiveSheet(0);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render xlsx');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  if (loading) return <p className="text-sm text-muted-foreground p-4">加载 Excel 文件中...</p>;
  if (error) return <p className="text-sm text-destructive p-4">{error}</p>;
  if (sheets.length === 0) return <p className="text-sm text-muted-foreground p-4">空文件</p>;

  return (
    <div className="flex flex-col h-full">
      {sheets.length > 1 && (
        <div className="flex gap-0.5 px-3 py-1.5 border-b border-border bg-muted/30 flex-shrink-0 overflow-x-auto">
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              className={`px-3 py-1 text-xs rounded-t transition-colors whitespace-nowrap ${
                i === activeSheet
                  ? 'bg-background text-foreground border border-b-0 border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div
        className="flex-1 overflow-auto p-2 xlsx-preview"
        style={{ fontSize: `${12 * zoom / 100}px` }}
        dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html ?? '' }}
      />
      <style>{`
        .xlsx-preview table { border-collapse: collapse; width: auto; min-width: 100%; }
        .xlsx-preview td, .xlsx-preview th {
          border: 1px solid hsl(var(--border));
          padding: 4px 8px;
          text-align: left;
          white-space: nowrap;
          font-size: inherit;
        }
        .xlsx-preview th { background: hsl(var(--muted)); font-weight: 600; }
        .xlsx-preview tr:hover td { background: hsl(var(--accent) / 0.3); }
      `}</style>
    </div>
  );
}

// ── PPTX Preview ─────────────────────────────────────────────────────────────

interface SlideContent {
  index: number;
  texts: string[];
}

async function parsePptxSlides(buf: ArrayBuffer): Promise<SlideContent[]> {
  const { default: zip } = await import('jszip');
  const z = await zip.loadAsync(buf);
  const slides: SlideContent[] = [];

  // PPTX slides are in ppt/slides/slide{N}.xml
  const slideFiles = Object.keys(z.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0');
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0');
      return na - nb;
    });

  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await z.file(slideFiles[i])!.async('text');
    // Extract text from <a:t> tags
    const texts: string[] = [];
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const text = match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
      if (text) texts.push(text);
    }
    slides.push({ index: i + 1, texts });
  }
  return slides;
}

function PptxPreview({ filePath, zoom }: { filePath: string; zoom: number }) {
  const [slides, setSlides] = useState<SlideContent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const buf = await fetchBlob(filePath);
        const result = await parsePptxSlides(buf);
        if (!cancelled) setSlides(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render pptx');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  if (loading) return <p className="text-sm text-muted-foreground p-4">加载 PPT 文件中...</p>;
  if (error) return <p className="text-sm text-destructive p-4">{error}</p>;
  if (slides.length === 0) return <p className="text-sm text-muted-foreground p-4">空文件</p>;

  return (
    <div className="p-4 space-y-4" style={{ fontSize: `${12 * zoom / 100}px` }}>
      {slides.map((slide) => (
        <div
          key={slide.index}
          className="border border-border rounded-lg p-5 bg-muted/20"
        >
          <div className="text-xs text-muted-foreground mb-2 font-medium">
            Slide {slide.index}
          </div>
          {slide.texts.length > 0 ? (
            <div className="space-y-1.5">
              {slide.texts.map((t, i) => (
                <p key={i} className="text-foreground leading-relaxed" style={{ fontSize: 'inherit' }}>{t}</p>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm italic">（无文本内容）</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export const OFFICE_EXTS = new Set(['docx', 'xlsx', 'xls', 'pptx']);

export function OfficePreview({ filePath, ext, zoom }: OfficePreviewProps) {
  if (ext === 'docx') return <DocxPreview filePath={filePath} zoom={zoom} />;
  if (ext === 'xlsx' || ext === 'xls') return <XlsxPreview filePath={filePath} zoom={zoom} />;
  if (ext === 'pptx') return <PptxPreview filePath={filePath} zoom={zoom} />;
  return null;
}

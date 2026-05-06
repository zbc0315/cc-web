import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getRawFileUrl, getToken } from '@/lib/api';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfPreviewProps {
  filePath: string;
  zoom: number;
}

async function fetchBlob(filePath: string, signal: AbortSignal): Promise<ArrayBuffer> {
  let url = getRawFileUrl(filePath);
  const token = getToken();
  if (token) url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
  return res.arrayBuffer();
}

// scale=1 baseline; multiplied by zoom — placeholder height before
// IntersectionObserver triggers Page render. Real height takes over once
// pdfjs reports page viewport.
const ESTIMATED_PAGE_HEIGHT_BASE = 1000;

function LazyPage({ pageNumber, scale }: { pageNumber: number; scale: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !wrapRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(wrapRef.current);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div
      ref={wrapRef}
      style={visible ? undefined : { minHeight: ESTIMATED_PAGE_HEIGHT_BASE * scale, width: '100%' }}
    >
      {visible && (
        <Page
          pageNumber={pageNumber}
          scale={scale}
          renderTextLayer
          renderAnnotationLayer
          className="rounded-md shadow-sm"
        />
      )}
    </div>
  );
}

export const PDF_EXTS = new Set(['pdf']);

export function PdfPreview({ filePath, zoom }: PdfPreviewProps) {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    setNumPages(0);
    (async () => {
      try {
        const buf = await fetchBlob(filePath, controller.signal);
        setData(buf);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(err instanceof Error && err.message ? err.message : 'Failed to load PDF');
      }
    })();
    return () => controller.abort();
  }, [filePath]);

  // pdfjs reads (does not mutate) the buffer; no clone needed. useMemo
  // freezes file identity so <Document> doesn't re-parse on parent re-render.
  const file = useMemo(() => (data ? { data } : null), [data]);

  if (error) return <p className="text-sm text-destructive p-4">{error}</p>;
  if (!file) return <p className="text-sm text-muted-foreground p-4">加载 PDF 中...</p>;

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <Document
        file={file}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={(err) => setError(err?.message || '未知错误')}
        loading={<p className="text-sm text-muted-foreground">解析 PDF...</p>}
        error={<p className="text-sm text-destructive">PDF 解析失败</p>}
      >
        {Array.from({ length: numPages }, (_, i) => (
          <LazyPage key={i} pageNumber={i + 1} scale={zoom / 100} />
        ))}
      </Document>
    </div>
  );
}

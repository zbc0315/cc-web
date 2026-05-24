import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Copy, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { STORAGE_KEYS, getStorage, setStorage } from '@/lib/storage';
import { getToken } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const DEFAULT_URL = 'http://127.0.0.1';
const HISTORY_CAP = 20;

interface HistoryState {
  urls: string[];
  cursor: number;
}

function loadHistory(): HistoryState {
  const raw = getStorage<HistoryState | null>(STORAGE_KEYS.browserHistory, null, true);
  if (!raw || !Array.isArray(raw.urls) || raw.urls.length === 0) {
    const last = getStorage(STORAGE_KEYS.browserLastUrl, '');
    const seed = last || DEFAULT_URL;
    return { urls: [seed], cursor: 0 };
  }
  const cursor = Math.max(0, Math.min(raw.cursor ?? 0, raw.urls.length - 1));
  return { urls: raw.urls, cursor };
}

function toProxyPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { return null; }
  // v0 backend only proxies http: (https would need TLS SNI handling to
  // keep DNS-pinning safe). Reject https here so the user sees a clear
  // toast instead of an opaque 400 from the proxy.
  if (u.protocol !== 'http:') return null;
  const port = u.port || '80';
  const hostport = `${u.hostname}:${port}`;
  const tail = `${u.pathname || '/'}${u.search}${u.hash}`;
  return `/api/browser-proxy/${hostport}${tail}`;
}

function normalizeForDisplay(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function BrowserPanel() {
  const [history, setHistory] = useState<HistoryState>(() => loadHistory());
  const currentUrl = history.urls[history.cursor] || DEFAULT_URL;
  const [draftUrl, setDraftUrl] = useState<string>(currentUrl);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [sessionReady, setSessionReady] = useState<boolean>(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Iframe requests don't carry our Authorization header, so we mint a
  // path-scoped HttpOnly cookie that the iframe automatically presents.
  // Without a valid session the proxy returns 403 (admin-only).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = getToken();
        const res = await fetch('/api/browser-proxy/_session', {
          method: 'POST',
          credentials: 'same-origin',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled) return;
        if (res.status === 403) {
          setSessionError('Browser proxy 仅限 admin 用户');
        } else if (!res.ok) {
          setSessionError(`无法建立 proxy 会话 (HTTP ${res.status})`);
        } else {
          setSessionReady(true);
        }
      } catch {
        if (!cancelled) setSessionError('无法连接 daemon');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setDraftUrl(currentUrl);
  }, [currentUrl]);

  useEffect(() => {
    setStorage(STORAGE_KEYS.browserLastUrl, currentUrl);
    setStorage(STORAGE_KEYS.browserHistory, history, true);
  }, [currentUrl, history]);

  const proxySrc = useMemo(() => toProxyPath(currentUrl), [currentUrl]);

  const navigate = useCallback((nextUrl: string) => {
    const normalized = normalizeForDisplay(nextUrl);
    if (!normalized) return;
    if (!toProxyPath(normalized)) {
      toast.error('无效 URL — 仅支持 http:// 或 https://，host 必须为 127.0.0.1 或局域网');
      return;
    }
    setHistory((prev) => {
      if (prev.urls[prev.cursor] === normalized) return prev;
      const truncated = prev.urls.slice(0, prev.cursor + 1);
      truncated.push(normalized);
      const overflow = Math.max(0, truncated.length - HISTORY_CAP);
      const next = truncated.slice(overflow);
      return { urls: next, cursor: next.length - 1 };
    });
  }, []);

  const onSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    navigate(draftUrl);
  }, [draftUrl, navigate]);

  const goBack = useCallback(() => {
    setHistory((prev) => prev.cursor > 0 ? { ...prev, cursor: prev.cursor - 1 } : prev);
  }, []);

  const goForward = useCallback(() => {
    setHistory((prev) => prev.cursor < prev.urls.length - 1 ? { ...prev, cursor: prev.cursor + 1 } : prev);
  }, []);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const openExternal = useCallback(() => {
    if (currentUrl) window.open(currentUrl, '_blank', 'noopener,noreferrer');
  }, [currentUrl]);

  const copyUrl = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(currentUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = currentUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast.success('URL 已复制');
    } catch {
      toast.error('复制失败');
    }
  }, [currentUrl]);

  const canBack = history.cursor > 0;
  const canForward = history.cursor < history.urls.length - 1;

  return (
    <div className="h-full flex flex-col bg-background min-h-0">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/40">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goBack}
          disabled={!canBack}
          title="后退"
          aria-label="后退"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goForward}
          disabled={!canForward}
          title="前进"
          aria-label="前进"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={reload}
          title="刷新"
          aria-label="刷新"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        <form className="flex-1 min-w-0" onSubmit={onSubmit}>
          <Input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="http://127.0.0.1:8080"
            className="h-7 text-xs font-mono"
            spellCheck={false}
            autoComplete="off"
          />
        </form>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={copyUrl}
          title="复制 URL"
          aria-label="复制 URL"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={openExternal}
          title="在新窗口打开（直连，不走代理）"
          aria-label="在新窗口打开"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 bg-white">
        {sessionError ? (
          <div className={cn('h-full flex flex-col items-center justify-center gap-2 text-destructive text-xs px-4 text-center')}>
            <Globe className="h-8 w-8 opacity-40" />
            <div>{sessionError}</div>
          </div>
        ) : !sessionReady ? (
          <div className={cn('h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs')}>
            <Globe className="h-8 w-8 opacity-40 animate-pulse" />
            <div>建立 proxy 会话…</div>
          </div>
        ) : proxySrc ? (
          <iframe
            ref={iframeRef}
            key={`${proxySrc}#${reloadKey}`}
            src={proxySrc}
            className="w-full h-full border-0"
            // No allow-same-origin: the proxied page must not be able to read
            // ccweb's localStorage/cookies even though the iframe URL is
            // technically same-origin. Backend also sends CSP sandbox.
            sandbox="allow-scripts allow-forms allow-popups"
            referrerPolicy="no-referrer"
            title="ccweb browser"
          />
        ) : (
          <div className={cn('h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs')}>
            <Globe className="h-8 w-8 opacity-40" />
            <div>无效 URL — 仅支持 127.0.0.1 / localhost / 192.168.x.x 等局域网地址</div>
          </div>
        )}
      </div>
    </div>
  );
}

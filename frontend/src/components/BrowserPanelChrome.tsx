import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { STORAGE_KEYS, getStorage, setStorage } from '@/lib/storage';
import { getToken } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const DEFAULT_URL = 'http://127.0.0.1';

interface SessionInfo {
  sid: string;
  token: string;
  viewport: { w: number; h: number };
  url: string;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

// LAN HTTP (not localhost) is not a secure context, so navigator.clipboard
// is undefined. We attempt the modern API first, then a textarea+execCommand
// fallback that works in non-secure contexts. Toast on total failure so the
// user knows something silent went wrong.
async function writeHostClipboard(text: string): Promise<void> {
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* fall through to legacy */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    toast.error('剪贴板写入失败');
  }
}

// Reading clipboard from JS without a user gesture / secure context is much
// stricter than writing — execCommand('paste') doesn't work either. We
// return null when we genuinely can't read, so the caller can prompt the
// user instead of silently failing.
async function readHostClipboard(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch { /* permission denied or insecure context */ }
  return null;
}

export function BrowserPanelChrome() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState<string>('');
  const [currentUrl, setCurrentUrl] = useState<string>(() =>
    getStorage(STORAGE_KEYS.browserLastUrl, DEFAULT_URL));
  const [draftUrl, setDraftUrl] = useState<string>(currentUrl);
  const [navigating, setNavigating] = useState<boolean>(false);
  const [history, setHistory] = useState<string[]>([currentUrl]);
  const [cursor, setCursor] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // ── 1. Bootstrap session (POST /_session) ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = getToken();
        const res = await fetch('/api/browser-chrome/_session', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled) return;
        if (res.status === 403) {
          setSessionError('Browser 仅限 admin 用户');
          return;
        }
        if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          setSessionError(`已达浏览器会话上限 (${body?.limit ?? 'max'} 个并发)，请等空闲 5 分钟自动回收或让其它用户关闭`);
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSessionError(body?.error || `会话创建失败 (HTTP ${res.status})`);
          return;
        }
        const data: SessionInfo = await res.json();
        setSession(data);
        if (data.url && data.url !== 'about:blank') {
          setCurrentUrl(data.url);
          setDraftUrl(data.url);
        }
      } catch (err) {
        if (!cancelled) setSessionError('无法连接 daemon');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 2. WebSocket: receive frames, send input ───────────────────────────
  useEffect(() => {
    if (!session) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/browser-chrome/${session.sid}?token=${encodeURIComponent(session.token)}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      let msg: {
        type: string; data?: string; format?: string;
        title?: string; text?: string;
        dlId?: string; filename?: string; size?: number; error?: string;
      };
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'frame' && msg.data && canvasRef.current) {
        const img = imgRef.current || new Image();
        imgRef.current = img;
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          // Adapt canvas backing store to image dimensions to avoid blurring.
          if (canvas.width !== img.width) canvas.width = img.width;
          if (canvas.height !== img.height) canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0);
        };
        img.src = `data:image/${msg.format || 'jpeg'};base64,${msg.data}`;
      } else if (msg.type === 'title' && typeof msg.title === 'string') {
        setPageTitle(msg.title);
      } else if (msg.type === 'clipboard-text' && typeof msg.text === 'string') {
        // chromium pushed the current selection in response to our copy intent
        void writeHostClipboard(msg.text);
      } else if (msg.type === 'download-ready' && msg.dlId && msg.filename) {
        // chromium finished saving the download into daemon memory; ping the
        // user's browser to fetch + save it via a fake <a download> click.
        const a = document.createElement('a');
        a.href = `/api/browser-chrome/${session.sid}/download/${msg.dlId}?token=${encodeURIComponent(session.token)}`;
        a.download = msg.filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success(`下载: ${msg.filename}`);
      } else if (msg.type === 'download-error' && msg.error) {
        toast.error(`下载失败: ${msg.error}`);
      }
    };
    ws.onerror = () => { /* logged in onclose */ };
    ws.onclose = (ev) => {
      if (ev.code !== 1000 && ev.code !== 1001) {
        toast.error(`Browser 连接断开 (${ev.code})`);
      }
    };
    return () => {
      ws.close(1000);
      wsRef.current = null;
    };
  }, [session]);

  // ── 3. Persist URL ──────────────────────────────────────────────────────
  useEffect(() => {
    setStorage(STORAGE_KEYS.browserLastUrl, currentUrl);
  }, [currentUrl]);

  // ── 3.5. Forward container resize to daemon viewport ───────────────────
  // ResizeObserver fires often (every pixel during a drag); throttle to
  // 200ms idle before sending so we don't flood the WS with resize msgs.
  useEffect(() => {
    if (!session) return;
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const lastSent = { w: 0, h: 0 };
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      const w = Math.max(200, Math.round(rect.width));
      const h = Math.max(200, Math.round(rect.height));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (w === lastSent.w && h === lastSent.h) return;
        lastSent.w = w; lastSent.h = h;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'resize', w, h }));
      }, 200);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [session]);

  // ── 4. Navigation ───────────────────────────────────────────────────────
  const doNav = useCallback(async (rawUrl: string) => {
    if (!session) return;
    const url = normalizeUrl(rawUrl);
    if (!url) return;
    const token = getToken();
    setNavigating(true);
    try {
      const res = await fetch(`/api/browser-chrome/${session.sid}/nav`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error || `导航失败 (${res.status})`);
        return;
      }
      const data = await res.json() as { url: string; title: string };
      setCurrentUrl(data.url);
      setDraftUrl(data.url);
      setHistory((prev) => {
        const truncated = prev.slice(0, cursor + 1);
        truncated.push(data.url);
        return truncated.slice(-20);
      });
      setCursor((c) => Math.min(c + 1, 19));
    } catch {
      toast.error('导航网络错误');
    } finally {
      setNavigating(false);
    }
  }, [session, cursor]);

  const onSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    doNav(draftUrl);
  }, [draftUrl, doNav]);

  const goBack = useCallback(() => {
    if (cursor > 0) {
      const next = cursor - 1;
      setCursor(next);
      doNav(history[next]);
    }
  }, [cursor, history, doNav]);
  const goForward = useCallback(() => {
    if (cursor < history.length - 1) {
      const next = cursor + 1;
      setCursor(next);
      doNav(history[next]);
    }
  }, [cursor, history, doNav]);
  const reload = useCallback(() => doNav(currentUrl), [currentUrl, doNav]);

  // ── 5. Canvas input → WS ────────────────────────────────────────────────
  const sendInput = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  const canvasToBrowserCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !session) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // Map display rect → canvas backing store coords → daemon viewport coords.
    const scaleX = session.viewport.w / rect.width;
    const scaleY = session.viewport.h / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, [session]);

  const onCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Focus canvas so keydown events route here (canvas needs tabindex).
    canvasRef.current?.focus();
    const { x, y } = canvasToBrowserCoords(e);
    const modifiers: string[] = [];
    if (e.shiftKey) modifiers.push('Shift');
    if (e.ctrlKey) modifiers.push('Control');
    if (e.altKey) modifiers.push('Alt');
    if (e.metaKey) modifiers.push('Meta');
    sendInput({ type: 'click', x, y, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left', modifiers });
  }, [canvasToBrowserCoords, sendInput]);

  const onCanvasWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasToBrowserCoords(e);
    sendInput({ type: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY });
  }, [canvasToBrowserCoords, sendInput]);

  // Keys that backend should treat as named events rather than as text input.
  const SPECIAL_KEYS = useMemo(() => new Set([
    'Enter', 'Escape', 'Tab', 'Backspace', 'Delete',
    'Home', 'End', 'PageUp', 'PageDown',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
    'Insert', 'CapsLock',
  ]), []);

  // Combos that should stay with the user's local browser/OS — refresh, close
  // tab, open new tab, dev tools, switch app etc. Without this allowlist the
  // user would lose those shortcuts whenever the canvas has focus.
  const isLocalShortcut = useCallback((e: React.KeyboardEvent): boolean => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'F5') return true;
    if (mod && ['w', 'W', 't', 'T', 'n', 'N', 'r', 'R'].includes(e.key)) return true;
    if (mod && e.shiftKey && ['i', 'I', 'j', 'J', 'c', 'C'].includes(e.key)) return true; // dev tools
    if (e.metaKey && (e.key === 'Tab' || e.key === '`')) return true; // app switch
    return false;
  }, []);

  // Cmd/Ctrl + C/V/X: bridge to host clipboard. Without this, Cmd+C would
  // forward as a generic key event and chromium's internal clipboard would
  // capture the selection without the user's host clipboard ever seeing it.
  const isClipboardCombo = useCallback((e: React.KeyboardEvent): 'copy' | 'paste' | 'cut' | null => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.shiftKey || e.altKey) return null;
    if (e.key === 'c' || e.key === 'C') return 'copy';
    if (e.key === 'v' || e.key === 'V') return 'paste';
    if (e.key === 'x' || e.key === 'X') return 'cut';
    return null;
  }, []);

  const onCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (isLocalShortcut(e)) return; // let browser handle
    // IME composition in progress: drop all keydown events. The IME runs in
    // the user's OS — they see the candidate popup locally. The final text
    // comes via compositionend, which we forward as 'type'. Without this
    // guard the keystrokes that drive the IME (e.g. 'n','i' for 你) would
    // leak to chromium as literal Latin chars.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Unidentified' || e.key === 'Process' || e.key === 'Dead') return;

    // Clipboard combos: bridge between chromium's internal clipboard and
    // the user's host clipboard. We intercept before generic key forwarding
    // so chromium doesn't see Ctrl+C as a "kbd shortcut" with no effect.
    const clip = isClipboardCombo(e);
    if (clip === 'copy') {
      e.preventDefault();
      sendInput({ type: 'clipboard-read' });
      return;
    }
    if (clip === 'paste') {
      e.preventDefault();
      void readHostClipboard().then((text) => {
        if (text === null) {
          toast.error('剪贴板读取失败（需 HTTPS 或 localhost）');
          return;
        }
        if (text) sendInput({ type: 'type', text });
      });
      return;
    }
    if (clip === 'cut') {
      // Read selection, then dispatch native Cmd+X to chromium so it deletes.
      e.preventDefault();
      sendInput({ type: 'clipboard-read' });
      sendInput({ type: 'key', action: 'press', key: e.key, modifiers: e.metaKey ? ['Meta'] : ['Control'] });
      return;
    }

    e.preventDefault();

    const modifiers: string[] = [];
    if (e.shiftKey) modifiers.push('Shift');
    if (e.ctrlKey) modifiers.push('Control');
    if (e.altKey) modifiers.push('Alt');
    if (e.metaKey) modifiers.push('Meta');

    const isPrintable = e.key.length === 1;
    const hasNonShiftModifier = modifiers.some(m => m !== 'Shift');

    if (SPECIAL_KEYS.has(e.key) || hasNonShiftModifier) {
      // Named key (Enter / ArrowLeft / etc.) or modifier combo (Ctrl+C / Cmd+A).
      // Backend uses playwright.keyboard.press(key) which respects modifiers.
      sendInput({ type: 'key', action: 'press', key: e.key, modifiers });
    } else if (isPrintable) {
      // Plain printable char (or Shift+letter for uppercase). e.key already
      // reflects shift state, so use 'type' which goes via keyboard.type and
      // is more reliable for arbitrary printable chars than press().
      sendInput({ type: 'type', text: e.key });
    }
    // else: multi-char unidentified, drop.
  }, [isLocalShortcut, isClipboardCombo, SPECIAL_KEYS, sendInput]);

  // IME (中文 / 日文 / 韩文 输入法) commit. e.data is the final composed
  // string after the user picks a candidate from the OS-level IME popup.
  // Forward as a single 'type' msg — daemon resolves to keyboard.type which
  // dispatches chars in order. User perceives instant commit.
  const onCanvasCompositionEnd = useCallback((e: React.CompositionEvent<HTMLCanvasElement>) => {
    if (!e.data) return;
    sendInput({ type: 'type', text: e.data });
  }, [sendInput]);

  const canBack = cursor > 0;
  const canForward = cursor < history.length - 1;

  return (
    <div className="h-full flex flex-col bg-background min-h-0">
      {pageTitle && (
        <div className="shrink-0 px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground bg-muted/40 truncate" title={pageTitle}>
          {pageTitle}
        </div>
      )}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/40">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goBack} disabled={!canBack || !session} title="后退" aria-label="后退">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goForward} disabled={!canForward || !session} title="前进" aria-label="前进">
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={reload} disabled={!session || navigating} title="刷新" aria-label="刷新">
          {navigating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
        </Button>
        <form className="flex-1 min-w-0" onSubmit={onSubmit}>
          <Input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="http://127.0.0.1:8080"
            className="h-7 text-xs font-mono"
            spellCheck={false}
            autoComplete="off"
            disabled={!session}
          />
        </form>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 bg-white relative overflow-hidden">
        {sessionError ? (
          <div className={cn('h-full flex flex-col items-center justify-center gap-2 text-destructive text-xs px-4 text-center')}>
            <Globe className="h-8 w-8 opacity-40" />
            <div>{sessionError}</div>
          </div>
        ) : !session ? (
          <div className={cn('h-full flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs')}>
            <Loader2 className="h-8 w-8 opacity-40 animate-spin" />
            <div>启动浏览器…</div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onClick={onCanvasClick}
            onWheel={onCanvasWheel}
            onKeyDown={onCanvasKeyDown}
            onCompositionEnd={onCanvasCompositionEnd}
            onContextMenu={(e) => e.preventDefault()}
            className="w-full h-full block cursor-pointer outline-none focus:ring-2 focus:ring-primary/30"
            style={{ imageRendering: 'pixelated' }}
          />
        )}
      </div>
      <div className="shrink-0 px-2 py-1 text-[10px] text-muted-foreground border-t border-border bg-muted/20">
        点击页面可聚焦输入键盘（含中文/日韩 IME） · 仅 RFC1918/loopback · 上传下载 / 剪贴板 Phase 4 跟进
      </div>
    </div>
  );
}

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Minus, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PluginInfo, PluginUserConfig } from '@/lib/api';
import { getToken } from '@/lib/api';

interface FloatWindowProps {
  plugin: PluginInfo;
  onConfigChange: (id: string, config: Partial<PluginUserConfig>) => void;
  onClose: (id: string) => void;
}

export function FloatWindow({ plugin, onConfigChange, onClose }: FloatWindowProps) {
  const { float, userConfig } = plugin;

  // Position state
  const [pos, setPos] = useState(() => ({
    x: userConfig.floatPosition?.x ?? window.innerWidth * 0.5 - float.defaultWidth / 2,
    y: userConfig.floatPosition?.y ?? window.innerHeight * 0.3,
  }));
  const [size, setSize] = useState(() => ({
    w: userConfig.floatSize?.w ?? float.defaultWidth,
    h: userConfig.floatSize?.h ?? float.defaultHeight,
  }));
  const [minimized, setMinimized] = useState(false);
  const [zIndex, setZIndex] = useState(100);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Click to raise z-index
  const bringToFront = useCallback(() => {
    setZIndex(Date.now() % 100000 + 100);
  }, []);

  // ── Drag ─────────────────────────────────────────────────────────────────
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    bringToFront();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };

    // Disable iframe pointer events during drag
    if (iframeRef.current) iframeRef.current.style.pointerEvents = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 100, dragRef.current.ox + ev.clientX - dragRef.current.sx));
      const ny = Math.max(0, Math.min(window.innerHeight - 40, dragRef.current.oy + ev.clientY - dragRef.current.sy));
      if (containerRef.current) {
        containerRef.current.style.left = nx + 'px';
        containerRef.current.style.top = ny + 'px';
      }
    };

    const handleUp = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 100, dragRef.current.ox + ev.clientX - dragRef.current.sx));
      const ny = Math.max(0, Math.min(window.innerHeight - 40, dragRef.current.oy + ev.clientY - dragRef.current.sy));
      dragRef.current = null;
      if (iframeRef.current) iframeRef.current.style.pointerEvents = '';
      setPos({ x: nx, y: ny });
      onConfigChange(plugin.id, { floatPosition: { x: nx, y: ny } });
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [pos, bringToFront, plugin.id, onConfigChange]);

  // ── Resize ───────────────────────────────────────────────────────────────
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!float.resizable) return;
    e.preventDefault();
    e.stopPropagation();
    bringToFront();
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: size.w, oh: size.h };

    if (iframeRef.current) iframeRef.current.style.pointerEvents = 'none';

    const minW = float.minWidth ?? 150;
    const minH = float.minHeight ?? 100;

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const nw = Math.max(minW, resizeRef.current.ow + ev.clientX - resizeRef.current.sx);
      const nh = Math.max(minH, resizeRef.current.oh + ev.clientY - resizeRef.current.sy);
      if (containerRef.current) {
        containerRef.current.style.width = nw + 'px';
        containerRef.current.style.height = nh + 'px';
      }
    };

    const handleUp = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const nw = Math.max(minW, resizeRef.current.ow + ev.clientX - resizeRef.current.sx);
      const nh = Math.max(minH, resizeRef.current.oh + ev.clientY - resizeRef.current.sy);
      resizeRef.current = null;
      if (iframeRef.current) iframeRef.current.style.pointerEvents = '';
      setSize({ w: nw, h: nh });
      onConfigChange(plugin.id, { floatSize: { w: nw, h: nh } });
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [size, float, bringToFront, plugin.id, onConfigChange]);

  // ── postMessage bridge ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const { callId, method, args } = e.data as { callId: string; method: string; args: Record<string, unknown> };
      if (!callId || !method) return;

      try {
        const token = getToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Plugin-Id': plugin.id,
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let url: string;
        let fetchOpts: RequestInit;

        if (method === 'storage:get') {
          url = `/api/plugin-bridge/storage/${plugin.id}`;
          fetchOpts = { method: 'GET', headers };
        } else if (method === 'storage:set') {
          url = `/api/plugin-bridge/storage/${plugin.id}`;
          fetchOpts = { method: 'PUT', headers, body: JSON.stringify(args) };
        } else {
          // Map method to bridge endpoint
          const map: Record<string, { path: string; httpMethod: string }> = {
            'project:status': { path: `/api/plugin-bridge/project/status/${args.projectId}`, httpMethod: 'GET' },
            'project:list': { path: '/api/plugin-bridge/project/list', httpMethod: 'GET' },
            'terminal:send': { path: '/api/plugin-bridge/terminal/send', httpMethod: 'POST' },
            'session:read': { path: `/api/plugin-bridge/session/${args.projectId}`, httpMethod: 'GET' },
            'system:info': { path: '/api/plugin-bridge/system/info', httpMethod: 'GET' },
          };
          // backend:api — proxy to plugin's own backend
          if (method === 'backend:api') {
            const { method: httpMethod, path: apiPath, body } = args as { method: string; path: string; body?: unknown };
            url = `/api/plugins/${plugin.id}${apiPath}`;
            fetchOpts = { method: httpMethod || 'GET', headers };
            if (body && (httpMethod === 'POST' || httpMethod === 'PUT')) {
              fetchOpts.body = JSON.stringify(body);
            }
          } else {
          const route = map[method];
          if (!route) throw new Error(`Unknown method: ${method}`);

          url = route.path;
          fetchOpts = { method: route.httpMethod, headers };
          if (route.httpMethod === 'POST') {
            fetchOpts.body = JSON.stringify(args);
          }
          } // close else
        }

        const resp = await fetch(url, fetchOpts);
        const result = await resp.json();
        iframeRef.current?.contentWindow?.postMessage({ callId, result, error: null }, '*');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bridge error';
        iframeRef.current?.contentWindow?.postMessage({ callId, result: null, error: message }, '*');
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [plugin.id]);

  const clickable = userConfig.clickable ?? float.clickable.default;

  const iframeSrc = `/plugins/${plugin.id}/${plugin.float ? 'index.html' : ''}`;

  return (
    <motion.div
      ref={containerRef}
      className={cn(
        'fixed rounded-lg border border-border shadow-xl overflow-hidden flex flex-col',
        'bg-background/95 backdrop-blur-sm',
      )}
      style={{
        left: pos.x,
        top: pos.y,
        width: minimized ? 200 : size.w,
        height: minimized ? 32 : size.h,
        zIndex,
      }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      onMouseDown={bringToFront}
    >
      {/* Title bar */}
      <div
        className="h-8 flex items-center gap-1 px-2 bg-muted/50 border-b border-border cursor-grab active:cursor-grabbing flex-shrink-0 select-none"
        onMouseDown={handleDragStart}
      >
        <GripHorizontal className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
        <span className="text-xs text-muted-foreground truncate flex-1">{plugin.name}</span>
        <button
          onClick={() => setMinimized((v) => !v)}
          className="p-0.5 rounded hover:bg-white/10 text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          onClick={() => onClose(plugin.id)}
          className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground/60 hover:text-red-400 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Plugin iframe */}
      {!minimized && (
        <div className="flex-1 min-h-0 relative">
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
            style={{ pointerEvents: clickable ? 'auto' : 'none' }}
          />

          {/* Resize handle */}
          {float.resizable && (
            <div
              className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
              onMouseDown={handleResizeStart}
            >
              <svg viewBox="0 0 12 12" className="w-3 h-3 text-muted-foreground/30">
                <path d="M11 1v10H1" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 5v6H5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

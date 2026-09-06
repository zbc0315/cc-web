import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from './theme-provider';

export interface WebTerminalHandle {
  write: (data: string) => void;
  /** Wipe screen + scrollback. Used after a server-driven CLI swap so the new
   *  CLI's banner doesn't paint on top of the old session's output. */
  reset: () => void;
  search: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  searchNext: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  searchPrevious: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  clearSearch: () => void;
  /** DECCKM state — true when the app requested application cursor keys, so
   *  arrow keys must be sent as `ESC O A` rather than `ESC [ A`. Used by the
   *  on-screen arrow pad to match what xterm emits for physical keys. */
  isApplicationCursorMode: () => boolean;
}

interface WebTerminalProps {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady?: (cols: number, rows: number) => void;
  cliTool?: string;
}

/** Copy via hidden textarea + execCommand — the clipboard API needs a secure
 *  context (https / localhost), which LAN- and public-IP http deployments of
 *  ccweb don't have. */
function fallbackCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* best effort */ }
  document.body.removeChild(ta);
  return ok;
}

const COPY_BTN_H = 28;   // px, matches h-7
const COPY_BTN_W = 72;   // px, generous clamp width incl. "已复制 ✓"
const COPY_BTN_GAP = 6;  // px between button and selection edge

const darkTheme = {
  background: '#09090b',   // zinc-950
  foreground: '#e4e4e7',   // zinc-200
  cursor: '#a1a1aa',       // zinc-400
  cursorAccent: '#09090b',
  selectionBackground: '#3f3f46', // zinc-700
  black: '#18181b',
  brightBlack: '#3f3f46',
  red: '#ef4444',
  brightRed: '#f87171',
  green: '#22c55e',
  brightGreen: '#4ade80',
  yellow: '#eab308',
  brightYellow: '#facc15',
  blue: '#3b82f6',
  brightBlue: '#60a5fa',
  magenta: '#a855f7',
  brightMagenta: '#c084fc',
  cyan: '#06b6d4',
  brightCyan: '#22d3ee',
  white: '#e4e4e7',
  brightWhite: '#f4f4f5',
};

const lightTheme = {
  background: '#ffffff',
  foreground: '#1c1c1c',
  cursor: '#6b7280',
  cursorAccent: '#ffffff',
  selectionBackground: '#d1d5db',
  black: '#1c1c1c',
  brightBlack: '#6b7280',
  red: '#dc2626',
  brightRed: '#ef4444',
  green: '#16a34a',
  brightGreen: '#22c55e',
  yellow: '#ca8a04',
  brightYellow: '#eab308',
  blue: '#2563eb',
  brightBlue: '#3b82f6',
  magenta: '#9333ea',
  brightMagenta: '#a855f7',
  cyan: '#0891b2',
  brightCyan: '#06b6d4',
  white: '#e5e7eb',
  brightWhite: '#f9fafb',
};

export const WebTerminal = forwardRef<WebTerminalHandle, WebTerminalProps>(
  ({ onInput, onResize, onReady, cliTool = 'claude' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    // Floating copy button over the current selection. null = hidden.
    const [copyBtn, setCopyBtn] = useState<{ top: number; left: number } | null>(null);
    const [copied, setCopied] = useState(false);
    const copiedTimerRef = useRef<number | null>(null);
    // Screen coords of the mouse-drag that creates a selection — the copy
    // button is positioned from these, NOT from xterm buffer coordinates
    // (viewportY/cell-size math proved unreliable across buffer states).
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const mouseUpTimerRef = useRef<number | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const onInputRef = useRef(onInput);
    const onResizeRef = useRef(onResize);
    const onReadyRef = useRef(onReady);
    const readyFiredRef = useRef(false);
    const prevResolvedRef = useRef<string | null>(null);
    onInputRef.current = onInput;
    onResizeRef.current = onResize;
    onReadyRef.current = onReady;

    const { resolved } = useTheme();

    useImperativeHandle(ref, () => ({
      write: (data: string) => { terminalRef.current?.write(data); },
      reset: () => {
        const t = terminalRef.current;
        if (!t) return;
        // reset() resets terminal state (cursor, modes, etc); clear() wipes the
        // viewport + scrollback. Both needed: reset alone leaves old rows
        // behind, clear alone leaves DECSC/altscreen state from the previous
        // CLI which makes the next CLI's TUI render incorrectly.
        t.reset();
        t.clear();
      },
      search: (term, options) => searchAddonRef.current?.findNext(term, options) ?? false,
      searchNext: (term, options) => searchAddonRef.current?.findNext(term, options) ?? false,
      searchPrevious: (term, options) => searchAddonRef.current?.findPrevious(term, options) ?? false,
      clearSearch: () => { searchAddonRef.current?.clearDecorations(); },
      isApplicationCursorMode: () => terminalRef.current?.modes.applicationCursorKeysMode ?? false,
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const terminal = new Terminal({
        theme: resolved === 'dark' ? darkTheme : lightTheme,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        cursorBlink: true,
        convertEol: false,
        scrollback: 5000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      const searchAddon = new SearchAddon();
      terminal.loadAddon(searchAddon);
      searchAddonRef.current = searchAddon;
      terminal.open(containerRef.current);

      requestAnimationFrame(() => {
        fitAddon.fit();
        const { cols, rows } = terminal;
        if (!readyFiredRef.current) {
          readyFiredRef.current = true;
          onReadyRef.current?.(cols, rows);
        }
        onResizeRef.current(cols, rows);
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      prevResolvedRef.current = resolved;

      terminal.onData((data) => {
        onInputRef.current(data);
      });

      // ── Floating copy button ──
      // Positioned from the mouse drag in SCREEN space (mousedown start +
      // mouseup end), not xterm buffer coords. Placed above the selection's
      // bounding box when there's room, otherwise below it.
      const el = containerRef.current;
      const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return; // primary button only
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        setCopyBtn(null);
        setCopied(false);
      };
      // Drag can end outside the terminal → listen on window.
      const onMouseUp = (e: MouseEvent) => {
        // Releasing on the copy button itself must not reposition/hide it —
        // let its own onClick handle the copy.
        if ((e.target as HTMLElement | null)?.closest?.('[data-copy-btn]')) {
          dragStartRef.current = null;
          return;
        }
        const start = dragStartRef.current;
        dragStartRef.current = null;
        // Defer a tick so xterm has finalized the selection.
        mouseUpTimerRef.current = window.setTimeout(() => {
          const t = terminalRef.current;
          const wrapper = wrapperRef.current;
          if (!t || !wrapper || !t.hasSelection() || !t.getSelection().trim()) {
            setCopyBtn(null);
            return;
          }
          const wRect = wrapper.getBoundingClientRect();
          const sx = start ? start.x : e.clientX;
          const sy = start ? start.y : e.clientY;
          const topY = Math.min(sy, e.clientY) - wRect.top;
          const botY = Math.max(sy, e.clientY) - wRect.top;
          const leftX = Math.min(sx, e.clientX) - wRect.left;
          const above = topY - COPY_BTN_H - COPY_BTN_GAP;
          const top = above >= 0
            ? above
            : Math.max(0, Math.min(botY + COPY_BTN_GAP, wRect.height - COPY_BTN_H - 2));
          const left = Math.min(
            Math.max(leftX, 4),
            Math.max(wRect.width - COPY_BTN_W, 4),
          );
          if (copiedTimerRef.current) {
            window.clearTimeout(copiedTimerRef.current);
            copiedTimerRef.current = null;
          }
          setCopied(false);
          setCopyBtn({ top, left });
        }, 0);
      };
      el?.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      // Scrolling moves the selection off its screen anchor — just hide.
      const scrollDisposable = terminal.onScroll(() => setCopyBtn(null));

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          // Skip fit when container is hidden (display: none) to prevent 0x0 PTY resize
          if (!containerRef.current || containerRef.current.offsetParent === null) return;
          fitAddon.fit();
          onResizeRef.current(terminal.cols, terminal.rows);
          setCopyBtn(null); // metrics changed — drop stale button
        });
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        el?.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        scrollDisposable.dispose();
        if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
        if (mouseUpTimerRef.current) window.clearTimeout(mouseUpTimerRef.current);
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }, []); // intentionally empty — runs once on mount

    const handleCopy = useCallback(() => {
      const terminal = terminalRef.current;
      const text = terminal?.getSelection() ?? '';
      if (!text) {
        setCopyBtn(null);
        return;
      }
      // Failed copies hide the button instead of lying "已复制" —
      // execCommand returns false on failure rather than throwing.
      const finish = (ok: boolean) => {
        if (!ok) {
          setCopyBtn(null);
          return;
        }
        setCopied(true);
        if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(() => {
          setCopyBtn(null);
          setCopied(false);
        }, 900);
      };
      // The textarea select() steals focus; hand it back so keystrokes keep
      // flowing into the terminal (the fallback IS the main path on http).
      const viaFallback = () => {
        const ok = fallbackCopy(text);
        terminal?.focus();
        finish(ok);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => finish(true)).catch(viaFallback);
      } else {
        viaFallback();
      }
    }, []);

    // Update terminal theme when resolved theme changes
    useEffect(() => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      // Skip the initial render (already set in constructor)
      if (prevResolvedRef.current === resolved) return;
      prevResolvedRef.current = resolved;

      terminal.options.theme = resolved === 'dark' ? darkTheme : lightTheme;

      // Sync CLI tool theme via tool-specific commands
      if (cliTool === 'claude') {
        const claudeTheme = resolved === 'dark' ? 'dark' : 'light';
        onInputRef.current(`/theme ${claudeTheme}\r`);
      } else if (cliTool === 'gemini') {
        // Gemini CLI: set theme via /settings command
        const geminiTheme = resolved === 'dark' ? 'dark' : 'light';
        onInputRef.current(`/settings theme ${geminiTheme}\r`);
      } else if (cliTool === 'codex') {
        // Codex: set theme via /theme command
        const codexTheme = resolved === 'dark' ? 'dark' : 'light';
        onInputRef.current(`/theme ${codexTheme}\r`);
      }
    }, [resolved, cliTool]);

    return (
      <div ref={wrapperRef} className="relative h-full w-full bg-background">
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ overflow: 'hidden', padding: '4px' }}
        />
        {copyBtn && (
          <button
            type="button"
            data-copy-btn=""
            className="absolute z-30 h-7 px-2.5 rounded-md border border-border bg-background/95 text-xs shadow-md hover:bg-accent"
            style={{ top: copyBtn.top, left: copyBtn.left }}
            // Keep the click from stealing focus / clearing the xterm selection.
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={handleCopy}
          >
            {copied ? '已复制 ✓' : '复制'}
          </button>
        )}
      </div>
    );
  }
);

WebTerminal.displayName = 'WebTerminal';

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from './theme-provider';

export interface WebTerminalHandle {
  write: (data: string) => void;
  search: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  searchNext: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  searchPrevious: (term: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean;
  clearSearch: () => void;
}

interface WebTerminalProps {
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady?: (cols: number, rows: number) => void;
  cliTool?: string;
}

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
    const terminalRef = useRef<Terminal | null>(null);
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
      search: (term, options) => searchAddonRef.current?.findNext(term, options) ?? false,
      searchNext: (term, options) => searchAddonRef.current?.findNext(term, options) ?? false,
      searchPrevious: (term, options) => searchAddonRef.current?.findPrevious(term, options) ?? false,
      clearSearch: () => { searchAddonRef.current?.clearDecorations(); },
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

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          // Skip fit when container is hidden (display: none) to prevent 0x0 PTY resize
          if (!containerRef.current || containerRef.current.offsetParent === null) return;
          fitAddon.fit();
          onResizeRef.current(terminal.cols, terminal.rows);
        });
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }, []); // intentionally empty — runs once on mount

    // Update terminal theme when resolved theme changes
    useEffect(() => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      // Skip the initial render (already set in constructor)
      if (prevResolvedRef.current === resolved) return;
      prevResolvedRef.current = resolved;

      terminal.options.theme = resolved === 'dark' ? darkTheme : lightTheme;

      // Send /theme command only to Claude Code to sync its theme
      if (cliTool === 'claude') {
        const claudeTheme = resolved === 'dark' ? 'dark' : 'light';
        onInputRef.current(`/theme ${claudeTheme}\r`);
      }
    }, [resolved, cliTool]);

    return (
      <div
        ref={containerRef}
        className="h-full w-full bg-background"
        style={{ overflow: 'hidden', padding: '4px' }}
      />
    );
  }
);

WebTerminal.displayName = 'WebTerminal';

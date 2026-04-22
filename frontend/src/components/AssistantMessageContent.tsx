import { useState, useEffect, useRef } from 'react';
import {
  ChevronDown, ChevronUp, Wrench, Terminal, FileText, Edit3, FileSearch, Globe, ListTodo,
  CircleDashed, Circle, CheckCircle2, Brain, Keyboard, Users, Clock,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import type { ChatBlockItem } from '@/lib/websocket';
import { useTheme } from './theme-provider';

/** Map file extension (lowercase, no dot) → prism language name. Kept narrow:
 *  common code, config, and shell files. Anything unknown renders as plain
 *  text (prism's `text` language). */
const EXT_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  yaml: 'yaml', yml: 'yaml', json: 'json', jsonc: 'json', toml: 'toml', ini: 'ini',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  md: 'markdown', markdown: 'markdown',
  r: 'r', lua: 'lua', dart: 'dart', zig: 'zig', vue: 'markup',
};

function langFromPath(path: string | undefined): string {
  if (!path) return 'text';
  const base = path.split('/').pop() ?? path;
  const lower = base.toLowerCase();
  if (lower === 'dockerfile') return 'docker';
  if (lower === 'makefile') return 'makefile';
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
  return EXT_LANG[ext] ?? 'text';
}

interface BaseProps {
  content: string;
  isLatest: boolean;
  proseClassName?: string;
}

/**
 * Discriminated union — `plain: true` (user bubble) and `blocks: ChatBlockItem[]`
 * (assistant bubble with rich tool rendering) are mutually exclusive.
 * Callers that tried to pass both were silently dropping `blocks` before
 * this was enforced at the type level.
 */
type Props =
  | (BaseProps & { plain: true; blocks?: never })
  | (BaseProps & { plain?: false; blocks?: ChatBlockItem[] });

const DEFAULT_PROSE =
  'prose prose-sm dark:prose-invert max-w-none text-inherit ' +
  '[&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:text-xs [&_pre]:my-1 [&_pre]:p-2 [&_pre]:rounded ' +
  '[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 ' +
  '[&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_hr]:my-2 ' +
  '[&_code]:text-xs [&_code]:px-1 [&_code]:rounded [&_table]:text-xs [&_a]:text-blue-400';

function plainPreview(content: string): string {
  const line = content.split('\n').find((l) => l.trim()) ?? content.trim();
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^\|/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

interface ToolSummary {
  name: string;
  /** Per-call identifying detail — file_path for Edit/Write/MultiEdit,
   *  subagent_type for Agent — deduped, order-preserved.  Empty for other
   *  tools. */
  details: string[];
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/** Pull the per-call identifying detail from a tool_use input, if any. */
function detailOf(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if (FILE_TOOLS.has(name)) {
    const fp = (input as { file_path?: unknown }).file_path;
    return typeof fp === 'string' && fp ? fp : undefined;
  }
  if (name === 'Agent') {
    const st = (input as { subagent_type?: unknown }).subagent_type;
    return typeof st === 'string' && st ? st : undefined;
  }
  return undefined;
}

/** Group tool_use blocks by tool name (order of first occurrence). Collects
 *  per-call identifying detail so the collapsed summary row can show
 *  `Edit foo.ts +2` or `Agent code-reviewer`. */
function extractToolSummaries(blocks: ChatBlockItem[] | undefined): ToolSummary[] {
  if (!blocks?.length) return [];
  const byName = new Map<string, ToolSummary>();
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    const name = (b.tool || b.content.split('(')[0] || '').trim();
    if (!name) continue;
    let summary = byName.get(name);
    if (!summary) {
      summary = { name, details: [] };
      byName.set(name, summary);
    }
    const detail = detailOf(name, b.input);
    if (detail && !summary.details.includes(detail)) {
      summary.details.push(detail);
    }
  }
  return Array.from(byName.values());
}

/** Format a tool summary for the collapsed strip: `Edit foo.ts +2`,
 *  `Agent code-reviewer`, or just `Bash` when no detail is tracked. */
function formatToolSummary(s: ToolSummary): string {
  if (s.details.length === 0) return s.name;
  const first = s.details[0];
  const more = s.details.length > 1 ? ` +${s.details.length - 1}` : '';
  return `${s.name} ${first}${more}`;
}

function firstTextContent(blocks: ChatBlockItem[] | undefined, fallback: string): string {
  if (!blocks?.length) return fallback;
  for (const b of blocks) {
    if (b.type === 'text' && b.content.trim()) return b.content;
  }
  return '';
}

// ── Tool-specific rich views ─────────────────────────────────────────────────

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  if (!todos.length) {
    return <div className="text-xs text-muted-foreground italic">(空列表)</div>;
  }
  return (
    <ul className="space-y-0.5 text-xs">
      {todos.map((t, i) => {
        const Icon =
          t.status === 'completed' ? CheckCircle2 :
          t.status === 'in_progress' ? CircleDashed :
          Circle;
        const color =
          t.status === 'completed' ? 'text-green-500' :
          t.status === 'in_progress' ? 'text-blue-400 animate-pulse' :
          'text-muted-foreground/50';
        return (
          <li key={i} className="flex items-start gap-1.5">
            <Icon className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', color)} />
            <span className={cn(
              'flex-1 break-words',
              t.status === 'completed' && 'text-muted-foreground line-through',
              t.status === 'in_progress' && 'text-foreground font-medium',
            )}>
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Icon for a given tool name — falls back to a generic wrench.
 *  Covers both Claude (Bash/Edit/Write/TodoWrite/…) and Codex
 *  (exec_command/write_stdin/spawn_agent/wait_agent/update_plan/…) naming. */
function iconForTool(tool: string): typeof Wrench {
  const t = tool.toLowerCase();
  // Claude (Anthropic tool_use schema)
  if (t === 'bash') return Terminal;
  if (t === 'read' || t === 'notebookread') return FileText;
  if (t === 'edit' || t === 'write' || t === 'multiedit' || t === 'notebookedit') return Edit3;
  if (t === 'grep' || t === 'glob') return FileSearch;
  if (t === 'webfetch' || t === 'websearch') return Globe;
  if (t === 'todowrite' || t === 'update_plan') return ListTodo;
  // Codex (OpenAI function_call schema — verified against real rollouts)
  if (t === 'exec_command') return Terminal;
  if (t === 'write_stdin' || t === 'send_input') return Keyboard;
  if (t === 'spawn_agent' || t === 'wait_agent') return Users;
  return Wrench;
}

function ToolUseBlock({ block }: { block: ChatBlockItem }) {
  const tool = block.tool ?? block.content.split('(')[0] ?? 'tool';
  const Icon = iconForTool(tool);
  const input = block.input;

  // TodoWrite gets a first-class checklist render.
  if (tool === 'TodoWrite' && input && typeof input === 'object') {
    const todos = (input as { todos?: TodoItem[] }).todos ?? [];
    return (
      <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 my-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-blue-400 mb-1.5">
          <Icon className="h-3 w-3" />
          <span>Todo List</span>
          <span className="text-muted-foreground/60">({todos.length})</span>
        </div>
        <TodoList todos={todos} />
      </div>
    );
  }

  // Bash: highlight the command; hide the description-only stuff.
  if (tool === 'Bash' && input && typeof input === 'object') {
    const { command, description } = input as { command?: string; description?: string };
    return (
      <div className="rounded-md border border-border bg-muted/30 p-2 my-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
          <Icon className="h-3 w-3" />
          <span>Bash</span>
          {description && <span className="text-muted-foreground/60 truncate">· {description}</span>}
        </div>
        {command && (
          <div className="rounded border border-border/50 bg-background/50 overflow-hidden">
            <CodeSnippet content={command} language="bash" />
          </div>
        )}
      </div>
    );
  }

  // Edit / Write / MultiEdit: file path + collapsible diff/content.
  if ((tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') && input && typeof input === 'object') {
    const i = input as {
      file_path?: string;
      old_string?: string;
      new_string?: string;
      content?: string;
      edits?: Array<{ old_string?: string; new_string?: string }>;
    };
    const filePath = i.file_path;
    // Write shows a full file body → highlight as the file's own language.
    // Edit / MultiEdit wrap old/new fragments with `--- old` / `+++ new`
    // marker lines that resemble diff headers — highlighting those fragments
    // as e.g. TypeScript makes the markers lex as mangled operators.  Use
    // `diff` so the markers render as header styling and the bodies as
    // plain context lines.
    const bodyLang = tool === 'Write' ? langFromPath(filePath) : 'diff';
    return (
      <div className="rounded-md border border-border bg-muted/30 p-2 my-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
          <Icon className="h-3 w-3" />
          <span>{tool}</span>
          {filePath && <code className="text-[11px] text-blue-400 truncate">{filePath}</code>}
        </div>
        <ToolDetails
          content={
            tool === 'Write'
              ? (i.content ?? '')
              : tool === 'MultiEdit'
                ? (i.edits ?? []).map((e, n) => `# edit ${n + 1}\n--- old\n${e.old_string ?? ''}\n+++ new\n${e.new_string ?? ''}`).join('\n\n')
                : `--- old\n${i.old_string ?? ''}\n+++ new\n${i.new_string ?? ''}`
          }
          language={bodyLang}
        />
      </div>
    );
  }

  // Read / Grep / Glob: show the target compactly.
  if ((tool === 'Read' || tool === 'Grep' || tool === 'Glob') && input && typeof input === 'object') {
    const i = input as { file_path?: string; pattern?: string; path?: string; glob?: string };
    const target = i.file_path ?? i.pattern ?? i.path ?? i.glob;
    return (
      <div className="flex items-center gap-1.5 text-[11px] my-1 text-muted-foreground">
        <Icon className="h-3 w-3 text-muted-foreground/70" />
        <span className="font-medium">{tool}</span>
        {target && <code className="text-[11px] truncate">{target}</code>}
      </div>
    );
  }

  // ── Codex (OpenAI function_call schema) ─────────────────────────────────
  // Top-5 tools from real rollouts: exec_command (~75% of calls) dominates,
  // then write_stdin / send_input (stdin), spawn_agent / wait_agent, update_plan.

  // exec_command — Codex's unified shell. args = { cmd, workdir?, max_output_tokens?, yield_time_ms? }
  if (tool === 'exec_command' && input && typeof input === 'object') {
    const i = input as { cmd?: string | string[]; workdir?: string; max_output_tokens?: number; yield_time_ms?: number };
    const cmdStr = Array.isArray(i.cmd) ? i.cmd.join(' ') : (i.cmd ?? '');
    return (
      <div className="rounded-md border border-border bg-muted/30 p-2 my-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
          <Icon className="h-3 w-3" />
          <span>exec_command</span>
          {i.workdir && <code className="text-[11px] text-muted-foreground/70 truncate">· {i.workdir}</code>}
        </div>
        {cmdStr && (
          <div className="rounded border border-border/50 bg-background/50 overflow-hidden">
            <CodeSnippet content={cmdStr} language="bash" />
          </div>
        )}
        {(i.max_output_tokens || i.yield_time_ms) && (
          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60">
            {i.max_output_tokens ? <span>max={i.max_output_tokens}</span> : null}
            {i.yield_time_ms ? <span><Clock className="inline h-2.5 w-2.5" /> {i.yield_time_ms}ms</span> : null}
          </div>
        )}
      </div>
    );
  }

  // write_stdin / send_input — stdin injection into an active exec_command
  if ((tool === 'write_stdin' || tool === 'send_input') && input && typeof input === 'object') {
    const i = input as { session_id?: string; text?: string; input?: string };
    const text = i.text ?? i.input ?? '';
    return (
      <div className="rounded-md border border-border bg-muted/20 p-2 my-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
          <Icon className="h-3 w-3" />
          <span>stdin</span>
          {i.session_id && <code className="text-[10px] text-muted-foreground/60 truncate">· {i.session_id.slice(0, 12)}…</code>}
        </div>
        {text && <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap break-all">{text.slice(0, 400)}{text.length > 400 ? '…' : ''}</pre>}
      </div>
    );
  }

  // spawn_agent — launch sub-agent. args = { role?, goal?, model?, … }
  if (tool === 'spawn_agent' && input && typeof input === 'object') {
    const i = input as { role?: string; goal?: string; model?: string };
    return (
      <div className="rounded-md border border-border bg-muted/30 p-2 my-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
          <Icon className="h-3 w-3" />
          <span>spawn_agent</span>
          {i.role && <span className="text-muted-foreground/70">· {i.role}</span>}
          {i.model && <code className="text-[10px] text-muted-foreground/60">{i.model}</code>}
        </div>
        {i.goal && <div className="text-[11px] text-foreground/80 italic">"{i.goal.slice(0, 200)}{i.goal.length > 200 ? '…' : ''}"</div>}
      </div>
    );
  }

  // wait_agent — block on spawned agent. args = { agent_id, timeout_ms? }
  if (tool === 'wait_agent' && input && typeof input === 'object') {
    const i = input as { agent_id?: string; timeout_ms?: number };
    return (
      <div className="flex items-center gap-1.5 text-[11px] my-1 text-muted-foreground">
        <Icon className="h-3 w-3 text-muted-foreground/70" />
        <span className="font-medium">wait_agent</span>
        {i.agent_id && <code className="text-[10px] truncate">{i.agent_id.slice(0, 12)}…</code>}
        {i.timeout_ms && <span className="text-muted-foreground/60">· {i.timeout_ms}ms</span>}
      </div>
    );
  }

  // update_plan — Codex's TodoWrite analogue. args = { plan: [{status, step, ...}] } or similar
  if (tool === 'update_plan' && input && typeof input === 'object') {
    const i = input as { plan?: Array<{ step?: string; status?: string }>; steps?: Array<{ step?: string; status?: string }> };
    const items = i.plan ?? i.steps ?? [];
    // Map Codex plan item status to Claude TodoWrite shape so TodoList renders uniformly
    const todos: TodoItem[] = items.map((it) => ({
      content: it.step ?? '',
      status: (it.status === 'done' || it.status === 'completed') ? 'completed'
            : it.status === 'in_progress' ? 'in_progress'
            : 'pending',
    }));
    return (
      <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 my-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-blue-400 mb-1.5">
          <Icon className="h-3 w-3" />
          <span>Plan</span>
          <span className="text-muted-foreground/60">({todos.length})</span>
        </div>
        <TodoList todos={todos} />
      </div>
    );
  }

  // Default: generic pretty-printed JSON.
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2 my-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1">
        <Icon className="h-3 w-3" />
        <span>{tool}</span>
      </div>
      {input !== undefined && (
        <ToolDetails content={typeof input === 'string' ? input : JSON.stringify(input, null, 2)} />
      )}
    </div>
  );
}

/** Shared highlighter wrapper — prism with project theme, size-matched to
 *  `<pre>` call sites.  `language` falls back to `text` (no highlighting).
 *  When `language === 'text'` we render a plain `<pre>` to skip the prism
 *  pipeline for generic JSON / unknown content. */
function CodeSnippet({ content, language, className }: { content: string; language: string; className?: string }) {
  const { resolved } = useTheme();
  const style = resolved === 'dark' ? oneDark : oneLight;
  if (language === 'text') {
    return (
      <pre className={cn(
        'text-[11px] font-mono whitespace-pre-wrap break-all text-foreground/80 bg-background/50 rounded px-1.5 py-1 border border-border/50',
        className,
      )}>
        {content}
      </pre>
    );
  }
  return (
    <SyntaxHighlighter
      language={language}
      style={style}
      PreTag="div"
      customStyle={{
        fontSize: '11px',
        margin: 0,
        padding: '4px 6px',
        borderRadius: '4px',
        background: 'transparent',
      }}
      codeTagProps={{ style: { fontSize: '11px', fontFamily: 'ui-monospace, monospace' } }}
      wrapLongLines
    >
      {content}
    </SyntaxHighlighter>
  );
}

/** Collapsible details panel — shows first 2 lines by default, full on click.
 *  Used for tool_use input bodies that can be long.  `language` optionally
 *  enables syntax highlighting; omit for plain text / generic JSON. */
function ToolDetails({ content, language = 'text' }: { content: string; language?: string }) {
  const [open, setOpen] = useState(false);
  const lines = content.split('\n');
  const needsCollapse = lines.length > 2 || content.length > 160;
  if (!content.trim()) return null;
  if (!needsCollapse) {
    return (
      <div className="rounded border border-border/50 bg-background/50 overflow-hidden">
        <CodeSnippet content={content} language={language} />
      </div>
    );
  }
  return (
    <div>
      <div className={cn(
        'rounded border border-border/50 bg-background/50 overflow-hidden',
        !open && 'max-h-10',
      )}>
        <CodeSnippet content={content} language={language} />
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="mt-1 text-[10px] text-blue-400/80 hover:text-blue-400 transition-colors"
      >
        {open ? '收起' : `展开（${lines.length} 行）`}
      </button>
    </div>
  );
}

function ToolResultBlock({ block }: { block: ChatBlockItem }) {
  const text = block.output || block.content;
  if (!text.trim()) return null;
  return (
    <div className="my-1.5">
      <div className="text-[10px] text-muted-foreground/60 mb-0.5 uppercase tracking-wider">Result</div>
      <ToolDetails content={text} />
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 rounded-md border border-dashed border-border/50 p-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <Brain className="h-3 w-3" />
        <span>思考{open ? '' : '…'}</span>
      </button>
      {open && (
        <div className="mt-1 text-[11px] italic text-muted-foreground/80 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

// ── Block-by-block renderer ──────────────────────────────────────────────────

function BlockView({ block, proseClassName }: { block: ChatBlockItem; proseClassName: string }) {
  if (block.type === 'text') {
    if (!block.content.trim()) return null;
    return (
      <div className={cn(proseClassName)}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
      </div>
    );
  }
  if (block.type === 'thinking') return <ThinkingBlock content={block.content} />;
  if (block.type === 'tool_use') return <ToolUseBlock block={block} />;
  if (block.type === 'tool_result') return <ToolResultBlock block={block} />;
  return null;
}

/** Single-line messages have nothing to fold — skip the collapse UI entirely.
 *  Assistant messages with any tool_use / thinking / tool_result block, or any
 *  multi-line text, remain collapsible. */
function isCollapsible(
  plain: boolean | undefined,
  content: string,
  blocks: ChatBlockItem[] | undefined,
): boolean {
  const multiline = (s: string) => s.includes('\n');
  if (plain) return multiline(content);
  if (blocks && blocks.length > 0) {
    return blocks.some((b) => b.type !== 'text' || multiline(b.content));
  }
  return multiline(content);
}

export function AssistantMessageContent({ content, isLatest, blocks, plain, proseClassName }: Props) {
  const prefersReducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(isLatest);
  const wasLatestRef = useRef(isLatest);
  useEffect(() => {
    if (isLatest && !wasLatestRef.current) setExpanded(true);
    wasLatestRef.current = isLatest;
  }, [isLatest]);
  const toggle = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpanded((v) => !v);
  };

  // User bubbles (`plain`) have no blocks + no tool names; preview is just the
  // first non-empty line of plain text.
  const toolSummaries = plain ? [] : extractToolSummaries(blocks);
  const textPreview = plain
    ? (plainPreview(content) || '(空)')
    : (plainPreview(firstTextContent(blocks, content)) || (toolSummaries.length ? '' : '(空)'));

  const anim = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: 'auto' as const },
        exit: { opacity: 0, height: 0 },
        transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const },
      };

  const proseCn = proseClassName ?? DEFAULT_PROSE;
  const collapsible = isCollapsible(plain, content, blocks);

  // No collapse affordance when there's nothing to fold: render the expanded
  // body directly with no chevron, no toggle button.  Matches user request:
  // "如果只有一行，那就不用再有折叠功能了".
  if (!collapsible) {
    return plain ? (
      <div className="whitespace-pre-wrap break-words">{content}</div>
    ) : blocks && blocks.length > 0 ? (
      <div className="space-y-0.5">
        {blocks.map((block, i) => (
          <BlockView key={i} block={block} proseClassName={proseCn} />
        ))}
      </div>
    ) : (
      <div className={cn(proseCn)}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      {!expanded ? (
        <motion.button
          key="collapsed"
          {...anim}
          type="button"
          onClick={toggle}
          aria-expanded={false}
          className="w-full overflow-hidden flex items-center gap-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
          title="展开"
        >
          {toolSummaries.length > 0 && (
            <span className="flex items-center gap-1 min-w-0 text-blue-400/80">
              <Wrench className="h-3 w-3 shrink-0" />
              <span className="font-mono text-[11px] truncate">
                {toolSummaries.slice(0, 3).map(formatToolSummary).join(' · ')}
                {toolSummaries.length > 3 && ` +${toolSummaries.length - 3}`}
              </span>
            </span>
          )}
          {textPreview && <span className="truncate flex-1 min-w-0">{textPreview}</span>}
          {!textPreview && toolSummaries.length > 0 && <span className="flex-1" />}
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </motion.button>
      ) : (
        <motion.div key="expanded" {...anim} className="overflow-hidden">
          {plain ? (
            // User-message mode: pre-wrap plain text (matches original
            // user-bubble rendering in ChatOverlay).
            <div className="whitespace-pre-wrap break-words">{content}</div>
          ) : blocks && blocks.length > 0 ? (
            // Rich block-by-block render: structured views per tool type.
            <div className="space-y-0.5">
              {blocks.map((block, i) => (
                <BlockView key={i} block={block} proseClassName={proseCn} />
              ))}
            </div>
          ) : (
            // Legacy fallback: single-string content through ReactMarkdown.
            <div className={cn(proseCn)}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={true}
            aria-label="折叠"
            className="mt-1 flex items-center text-muted-foreground/70 hover:text-foreground transition-colors"
            title="折叠"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

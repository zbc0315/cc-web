import { useState, useEffect, useRef } from 'react';
import {
  ChevronDown, ChevronUp, Wrench, Terminal, FileText, Edit3, FileSearch, Globe, ListTodo,
  CircleDashed, Circle, CheckCircle2, Brain,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { ChatBlockItem } from '@/lib/websocket';

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

/** Extract unique tool names (in order) from tool_use blocks.  Prefers
 *  structured `tool` field, falls back to parsing `content` as `name(...)`. */
function extractToolNames(blocks: ChatBlockItem[] | undefined): string[] {
  if (!blocks?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    const name = (b.tool || b.content.split('(')[0] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
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

/** Icon for a given tool name — falls back to a generic wrench. */
function iconForTool(tool: string): typeof Wrench {
  const t = tool.toLowerCase();
  if (t === 'bash') return Terminal;
  if (t === 'read' || t === 'notebookread') return FileText;
  if (t === 'edit' || t === 'write' || t === 'multiedit' || t === 'notebookedit') return Edit3;
  if (t === 'grep' || t === 'glob') return FileSearch;
  if (t === 'webfetch' || t === 'websearch') return Globe;
  if (t === 'todowrite') return ListTodo;
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
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-foreground/90 bg-background/50 rounded px-1.5 py-1 border border-border/50">
            $ {command}
          </pre>
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

/** Collapsible details panel — shows first 2 lines by default, full on click.
 *  Used for tool_use input bodies that can be long. */
function ToolDetails({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const lines = content.split('\n');
  const needsCollapse = lines.length > 2 || content.length > 160;
  if (!content.trim()) return null;
  if (!needsCollapse) {
    return (
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-foreground/80 bg-background/50 rounded px-1.5 py-1 border border-border/50">
        {content}
      </pre>
    );
  }
  return (
    <div>
      <pre className={cn(
        'text-[11px] font-mono whitespace-pre-wrap break-all text-foreground/80 bg-background/50 rounded px-1.5 py-1 border border-border/50',
        !open && 'max-h-10 overflow-hidden',
      )}>
        {content}
      </pre>
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
  const toolNames = plain ? [] : extractToolNames(blocks);
  const textPreview = plain
    ? (plainPreview(content) || '(空)')
    : (plainPreview(firstTextContent(blocks, content)) || (toolNames.length ? '' : '(空)'));

  const anim = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: 'auto' as const },
        exit: { opacity: 0, height: 0 },
        transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const },
      };

  const proseCn = proseClassName ?? DEFAULT_PROSE;

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
          {toolNames.length > 0 && (
            <span className="flex items-center gap-1 shrink-0 text-blue-400/80">
              <Wrench className="h-3 w-3" />
              <span className="font-mono text-[11px]">
                {toolNames.slice(0, 3).join(' · ')}
                {toolNames.length > 3 && ` +${toolNames.length - 3}`}
              </span>
            </span>
          )}
          {textPreview && <span className="truncate flex-1">{textPreview}</span>}
          {!textPreview && toolNames.length > 0 && <span className="flex-1" />}
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

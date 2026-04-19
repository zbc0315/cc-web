import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { ChatBlockItem } from '@/lib/websocket';

interface Props {
  content: string;
  isLatest: boolean;
  /** When provided, collapsed-state preview becomes block-aware and surfaces
   *  tool_use names (bash, grep, …) that would otherwise be swallowed by the
   *  single-line text preview. */
  blocks?: ChatBlockItem[];
  /** Optional prose className override (default matches ChatOverlay/MobileChatView styles). */
  proseClassName?: string;
}

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

/** Extract unique tool names (in order) from tool_use blocks. Content form is
 *  `toolName(args)` per backend adapters. */
function extractToolNames(blocks: ChatBlockItem[] | undefined): string[] {
  if (!blocks?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    const name = b.content.split('(')[0].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** First meaningful text content (skipping tool_use/thinking). */
function firstTextContent(blocks: ChatBlockItem[] | undefined, fallback: string): string {
  if (!blocks?.length) return fallback;
  for (const b of blocks) {
    if (b.type === 'text' && b.content.trim()) return b.content;
  }
  return '';
}

export function AssistantMessageContent({ content, isLatest, blocks, proseClassName }: Props) {
  const prefersReducedMotion = useReducedMotion();
  // `isLatest` is read at mount to decide the default (latest → expanded,
  // older → collapsed), and again ONLY when a message newly becomes the
  // latest (reactivates its default). It is NOT re-consulted when isLatest
  // flips from true → false — previously that path auto-collapsed the
  // message the user was actively reading, which felt like disappearing content.
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

  const toolNames = extractToolNames(blocks);
  const textPreview = plainPreview(firstTextContent(blocks, content)) || (toolNames.length ? '' : '(空)');

  const anim = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: 'auto' as const },
        exit: { opacity: 0, height: 0 },
        transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const },
      };

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
          <div className={cn(proseClassName ?? DEFAULT_PROSE)}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
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

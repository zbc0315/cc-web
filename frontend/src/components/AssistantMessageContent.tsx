import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface Props {
  content: string;
  isLatest: boolean;
  /** Optional prose className override (default matches ChatOverlay/MobileChatView styles). */
  proseClassName?: string;
}

const DEFAULT_PROSE =
  'prose prose-sm dark:prose-invert max-w-none text-inherit ' +
  '[&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:text-xs [&_pre]:my-1 [&_pre]:p-2 [&_pre]:rounded ' +
  '[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 ' +
  '[&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_hr]:my-2 ' +
  '[&_code]:text-xs [&_code]:px-1 [&_code]:rounded [&_table]:text-xs [&_a]:text-blue-400';

function previewLine(content: string): string {
  const line = content.split('\n').find((l) => l.trim()) ?? content.trim();
  return line
    .replace(/^#{1,6}\s+/, '')                 // heading markers
    .replace(/^>\s*/, '')                       // blockquote
    .replace(/^[-*+]\s+/, '')                   // unordered list
    .replace(/^\d+\.\s+/, '')                   // ordered list
    .replace(/^\|/, '')                         // leading table pipe
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')  // links & images → alt text
    .replace(/`([^`]+)`/g, '$1')                // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // bold
    .replace(/\*([^*]+)\*/g, '$1')              // italic
    .trim();
}

export function AssistantMessageContent({ content, isLatest, proseClassName }: Props) {
  // `isLatest` is read at mount to decide the default (latest → expanded,
  // older → collapsed), and again ONLY when a message newly becomes the
  // latest (reactivates its default). It is NOT re-consulted when isLatest
  // flips from true → false — previously that path auto-collapsed the
  // message the user was actively reading, which felt like disappearing content.
  // Once collapsed, manual expand/collapse via the button sticks.
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

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-expanded={false}
        className="w-full flex items-center gap-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
        title="展开"
      >
        <span className="truncate flex-1">{previewLine(content) || '(空)'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <div>
      <div className={cn(proseClassName ?? DEFAULT_PROSE)}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={true}
        className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
        title="折叠"
      >
        <ChevronUp className="h-3 w-3" />
        折叠
      </button>
    </div>
  );
}

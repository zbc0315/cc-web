import { useRef } from 'react';
import { MoreVertical, Pencil, Trash2, Share2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';

export type PromptCardKind = 'quick-prompt' | 'agent-prompt';

export interface PromptCardProps {
  kind: PromptCardKind;
  label: string;
  /** First meaningful line of the content, already plain-text (no markdown). */
  preview: string;
  /** Only meaningful for `agent-prompt` / memory: controls the green status dot. */
  inserted?: boolean;
  /** Only meaningful for `quick-prompt`: card highlights in light blue until
   *  it's been clicked/sent at least once.  Used so a just-created shortcut is
   *  visually distinct from one the user already tries routinely. */
  unclicked?: boolean;
  /** Left-click action — send for quick-prompt, insert/remove toggle for agent-prompt. */
  onLeftClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onShare?: () => void;
  /** When provided, adds a "更新" (refresh) menu item — used by Memory
   *  Prompts: re-reads the .md file from disk and replaces the existing
   *  block in CLAUDE.md in-place. */
  onRefresh?: () => void;
  /** Optional extra hint under the label (e.g. "继承: 父快捷"). */
  footer?: React.ReactNode;
  /** When set, hides edit/delete from the context menu; share stays. */
  readOnly?: boolean;
  /** When set, no right-click menu, no kebab, no edit/delete/share whatsoever
   *  (used by Memory Prompts — filesystem-backed, users edit the .md file
   *  externally). */
  noContextMenu?: boolean;
}

/**
 * Unified card used by both Quick Prompts (Shortcuts) and Agent Prompts.
 *
 * Interaction model:
 *   - Left click anywhere on the card → `onLeftClick` (send or toggle).
 *   - Right click anywhere on the card → shadcn ContextMenu (Edit / Delete / Share).
 *   - Kebab `⋮` in the top-right dispatches a synthetic `contextmenu` event on
 *     the card itself — the SAME menu opens, so touch users get feature parity
 *     with desktop right-click without maintaining a second menu tree.
 *   - Green dot in the top-left is shown only for `agent-prompt` when
 *     `inserted` is true (matches AgentPromptsPanel's original indicator).
 *
 * Kebab visibility: on devices with hover (desktop), invisible until
 * `group-hover`; on touch devices (no hover), always visible so users can reach
 * the menu — without this, touch users had no way to Edit/Delete/Share.
 */
export function PromptCard({
  kind, label, preview, inserted, unclicked, onLeftClick,
  onEdit, onDelete, onShare, onRefresh, footer, readOnly, noContextMenu,
}: PromptCardProps) {
  const triggerRef = useRef<HTMLDivElement>(null);

  // NOTE: PromptCard renders inside LeftPanel / RightPanel, both on `bg-muted`.
  // Tone intent: card is perceptibly LIGHTER than sidebar in both themes so
  // it reads as raised, not inset.
  // - Light: `bg-background` (white 100%) > sidebar muted (95.9%) → raised.
  // - Dark: `bg-background` (3.9%) < sidebar muted (15.9%) → would read as
  //   INSET.  Fix via `dark:bg-muted-foreground/10` which paints a ~+4%
  //   lightness overlay on the muted sidebar, keeping the card raised.
  // Hover needs to be visibly stronger than inert in both themes:
  // - Light hover `bg-muted-foreground/10` darkens white card by ~5%.
  // - Dark hover needs `dark:hover:bg-muted-foreground/20` (dark inert is
  //   already /10, so same-value hover would be invisible).
  // NOTE: values are Tailwind default opacity scale stops (…, 5, 10, 15,
  //   20, 25, …).  Non-default stops like /8 silently emit no CSS.
  const kindClasses = kind === 'agent-prompt'
    ? cn(
        inserted
          ? 'border-green-500/50 bg-green-500/10 hover:bg-green-500/15'
          : 'border-dashed border-border hover:border-border/80 hover:bg-muted-foreground/10 dark:hover:bg-muted-foreground/20',
      )
    : cn(
        // Quick-prompt visual states: unclicked (never sent) stands out in
        // light blue so freshly-created shortcuts are obvious; once the user
        // has sent it at least once the card settles into the neutral style —
        // still raised vs the sidebar in both themes.
        unclicked
          ? 'border-blue-500/30 bg-blue-500/15 hover:bg-blue-500/20 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
          : 'border-transparent bg-background dark:bg-muted-foreground/10 hover:bg-muted-foreground/10 dark:hover:bg-muted-foreground/20 hover:border-muted-foreground/30',
      );

  const handleKebabClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const target = triggerRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    // Synthetic contextmenu event fired at the card — Radix ContextMenu
    // Trigger listens for `contextmenu` and uses its clientX/clientY for
    // positioning. Anchoring to the card center keeps the menu near the kebab.
    const evt = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.right - 8,
      clientY: rect.top + rect.height / 2,
      button: 2,
    });
    target.dispatchEvent(evt);
  };

  const isAgentKind = kind === 'agent-prompt';
  // Hint "右键更多" when any menu action exists, even if kebab is hidden
  // (Memory inserted cards: noContextMenu but onRefresh present).
  const menuHint = (!noContextMenu || onRefresh) ? ' · 右键更多' : '';
  const cardTitle =
    kind === 'quick-prompt'
      ? `点击发送${menuHint}`
      : (inserted ? '点击从 CLAUDE.md 移除' : '点击插入 CLAUDE.md') + menuHint;

  const cardInner = (
    <div
      ref={triggerRef}
      className={cn(
        'group relative rounded-md border text-xs transition-colors cursor-pointer select-none',
        kindClasses,
      )}
      onClick={onLeftClick}
      title={cardTitle}
    >
      {/* Status dot for agent-prompt / memory (both use inserted flag) */}
      {isAgentKind && (
        <span
          aria-hidden
          className={cn(
            'absolute top-1.5 left-1.5 h-2 w-2 rounded-full transition-colors',
            inserted
              ? 'bg-green-500 ring-1 ring-green-500/40'
              : 'border border-muted-foreground/40 bg-transparent',
          )}
        />
      )}
      <div className={cn(
        'py-1.5',
        noContextMenu ? 'pr-2' : 'pr-7',
        isAgentKind ? 'pl-5' : 'pl-3',
      )}>
        <div className="font-medium truncate">{label}</div>
        {preview && preview !== label && (
          <div className="mt-0.5 text-muted-foreground/80 truncate font-mono">{preview}</div>
        )}
        {footer}
      </div>
      {!noContextMenu && (
        <button
          onClick={handleKebabClick}
          className={cn(
            'absolute top-1 right-1 p-0.5 rounded transition-opacity',
            'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
            'hover:bg-muted-foreground/10 focus-visible:bg-muted-foreground/10',
            'text-muted-foreground hover:text-foreground',
          )}
          title="更多"
          aria-label="更多操作"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  // Memory / noContextMenu cards have no right-click / no kebab — just a bare
  // clickable card.  Skip the ContextMenu wrapper but still suppress the
  // browser native menu on right-click so the UX stays consistent with
  // Quick / Agent cards (no "View source" popup appearing on Memory cards).
  // Exception: even when `noContextMenu` is set, if any menu action was
  // explicitly provided (e.g. Memory Prompts passes `onRefresh` for inserted
  // cards), we do render the menu — the flag means "no default Edit/Delete/
  // Share triad", not "never a menu".
  const hasAnyMenuAction = !!onRefresh || (!noContextMenu && (!!onEdit || !!onDelete || !!onShare));
  if (!hasAnyMenuAction) {
    return (
      <div onContextMenu={(e) => e.preventDefault()}>
        {cardInner}
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {cardInner}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onRefresh && (
          <ContextMenuItem onSelect={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            更新
          </ContextMenuItem>
        )}
        {!noContextMenu && !readOnly && onEdit && onDelete && (
          <>
            {onRefresh && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </ContextMenuItem>
            <ContextMenuItem destructive onSelect={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </ContextMenuItem>
            {onShare && <ContextMenuSeparator />}
          </>
        )}
        {!noContextMenu && onShare && (
          <ContextMenuItem onSelect={onShare}>
            <Share2 className="h-3.5 w-3.5" />
            共享到 ccweb-hub
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

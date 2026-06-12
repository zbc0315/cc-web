import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * On-screen arrow keys for touchscreen devices. Emits a direction; the parent
 * maps it to the correct cursor-key escape sequence based on the terminal's
 * live DECCKM (application-cursor) mode, so it matches what xterm sends for a
 * physical arrow key in both normal and application modes.
 */
export type ArrowDir = 'up' | 'down' | 'left' | 'right';

const ICONS: Record<ArrowDir, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
};

function Btn({ dir, onArrow }: { dir: ArrowDir; onArrow: (dir: ArrowDir) => void }) {
  const Icon = ICONS[dir];
  return (
    <button
      type="button"
      aria-label={`Arrow ${dir}`}
      // Keep terminal focus — don't let the button steal it on press.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onArrow(dir)}
      className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background/70 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function TerminalArrowPad({
  onArrow,
  className,
}: {
  onArrow: (dir: ArrowDir) => void;
  className?: string;
}) {
  return (
    <div className={cn('grid w-fit select-none grid-cols-3 grid-rows-2 gap-1 opacity-70 transition-opacity hover:opacity-100', className)}>
      <div />
      <Btn dir="up" onArrow={onArrow} />
      <div />
      <Btn dir="left" onArrow={onArrow} />
      <Btn dir="down" onArrow={onArrow} />
      <Btn dir="right" onArrow={onArrow} />
    </div>
  );
}

import { cn } from '@/lib/utils';

/**
 * Three-dot typing/loading indicator. Dots inherit their parent's text
 * color via `bg-current` so it blends with any containing bubble (muted
 * foreground inside activity bubbles, accent color inside highlight
 * contexts, etc). Staggered 160ms phases are applied inline because
 * Tailwind doesn't ship a custom-duration bounce keyframe for this scale
 * (the `animate-bounce` utility uses -25% translate which looks wrong on
 * 6px dots — see @keyframes typing-dot in index.css).
 */
export function TypingDots({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)} aria-label="loading" role="status">
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        style={{ animation: 'typing-dot 1.2s ease-in-out infinite', animationDelay: '0ms' }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        style={{ animation: 'typing-dot 1.2s ease-in-out infinite', animationDelay: '160ms' }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        style={{ animation: 'typing-dot 1.2s ease-in-out infinite', animationDelay: '320ms' }}
      />
    </div>
  );
}

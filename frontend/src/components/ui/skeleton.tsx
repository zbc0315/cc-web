import { cn } from '@/lib/utils';

/**
 * Skeleton — shadcn placeholder for loading content.
 *
 * Replaces the `<Loader2 className="animate-spin" />` center-of-screen pattern
 * for list/card loading states where the viewer knows roughly what shape the
 * loaded content will take. The shape match makes content-in feel instant.
 *
 * Usage:
 *   {loading
 *     ? <Skeleton className="h-4 w-32" />
 *     : <span>{user.name}</span>}
 *
 *   {loading
 *     ? Array.from({ length: 3 }).map((_, i) => (
 *         <Skeleton key={i} className="h-20 w-full rounded-xl" />
 *       ))
 *     : projects.map((p) => <ProjectCard key={p.id} project={p} />)}
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

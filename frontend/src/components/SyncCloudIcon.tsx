import { useId } from 'react';
import { cn } from '@/lib/utils';
import type { ProjectSyncStatus } from '@/lib/api';

/**
 * Sync-status cloud for a project card:
 *  - dashed outline (muted)  → no remote path set
 *  - half-filled (amber)     → local changes not yet synced
 *  - solid (muted)           → synced / up to date
 *  - pulsing                 → sync in progress
 * Clicking opens the project's sync settings.
 */
const CLOUD_PATH = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'; // lucide "cloud"

export function SyncCloudIcon({
  status,
  onClick,
  title,
  className,
}: {
  status?: ProjectSyncStatus;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  className?: string;
}) {
  const gradId = useId();
  const hasPath = !!status?.hasPath;
  const dirty = status?.dirty === true;
  const syncing = !!status?.syncing;

  let colorClass = 'text-muted-foreground';
  let fill = 'none';
  let dashed = false;
  if (!hasPath) {
    dashed = true;
    colorClass = 'text-muted-foreground/60';
  } else if (dirty) {
    colorClass = 'text-amber-500';
    fill = `url(#${gradId})`;
  } else {
    colorClass = 'text-muted-foreground';
    fill = 'currentColor';
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent',
        colorClass,
        syncing && 'animate-pulse',
        className
      )}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {dirty && (
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0" />
              <stop offset="0.5" stopColor="currentColor" stopOpacity="0" />
              <stop offset="0.5" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.9" />
            </linearGradient>
          </defs>
        )}
        <path d={CLOUD_PATH} fill={fill} strokeDasharray={dashed ? '3 2.5' : undefined} />
      </svg>
    </button>
  );
}

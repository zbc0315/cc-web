import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { TodoItem } from '@/components/TodoView';

/**
 * Gantt timeline. Each todo's bar spans [createdAt-date → end], where end is
 * actualDate (if completed), else plannedDate (target), else today (still
 * open). Rows are grouped by project; a red line marks today. Project filtering
 * is applied by the caller before passing `items`.
 */

const BAR_CLS = { todo: 'bg-muted-foreground/50', doing: 'bg-amber-500', done: 'bg-green-500' } as const;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function TodoGanttView({ items }: { items: TodoItem[] }) {
  const { t } = useTranslation();
  const todayStr = ymd(new Date());

  const rows = useMemo(() =>
    items.map((it) => {
      const start = it.todo.createdAt.slice(0, 10);
      const rawEnd = it.todo.actualDate || it.todo.plannedDate || todayStr;
      return { it, start: start <= rawEnd ? start : rawEnd, end: start <= rawEnd ? rawEnd : start };
    }), [items, todayStr]);

  if (rows.length === 0) {
    return <div className="text-center py-16 text-muted-foreground text-sm">{t('todo.gantt_empty')}</div>;
  }

  let min = rows[0].start, max = rows[0].end;
  for (const r of rows) { if (r.start < min) min = r.start; if (r.end > max) max = r.end; }
  const minD = parseYmd(min); minD.setDate(minD.getDate() - 1);
  const maxD = parseYmd(max); maxD.setDate(maxD.getDate() + 1);
  const total = Math.max(1, dayDiff(minD, maxD));
  const pct = (s: string) => (dayDiff(minD, parseYmd(s)) / total) * 100;

  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const a = groups.get(r.it.projectName); if (a) a.push(r); else groups.set(r.it.projectName, [r]); }

  const TICKS = 6;
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => {
    const d = new Date(minD); d.setDate(minD.getDate() + Math.round((total * i) / TICKS)); return d;
  });
  const todayInRange = todayStr >= ymd(minD) && todayStr <= ymd(maxD);

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card p-2">
      <div className="min-w-[640px]">
        {/* Date axis */}
        <div className="flex">
          <div className="w-40 shrink-0" />
          <div className="relative flex-1 h-5 border-b border-border">
            {ticks.map((d, i) => (
              <div key={i} className="absolute -translate-x-1/2 text-[10px] text-muted-foreground" style={{ left: `${(i / TICKS) * 100}%` }}>
                {d.getMonth() + 1}/{d.getDate()}
              </div>
            ))}
          </div>
        </div>

        {[...groups.entries()].map(([proj, grp]) => (
          <div key={proj}>
            <div className="text-xs font-medium text-muted-foreground px-1 pt-2 pb-1">{proj}</div>
            {grp.map((r) => {
              const left = pct(r.start);
              const width = Math.max(1.5, pct(r.end) - left);
              const overdue = r.it.todo.status !== 'done' && !!r.it.todo.plannedDate && r.it.todo.plannedDate < todayStr;
              return (
                <div key={r.it.todo.id} className="flex items-center h-7">
                  <div className={cn('w-40 shrink-0 pr-2 truncate text-xs', r.it.todo.status === 'done' && 'line-through text-muted-foreground')}
                    title={r.it.todo.title}>
                    {r.it.todo.title}
                  </div>
                  <div className="relative flex-1 h-full">
                    {todayInRange && <div className="absolute top-0 bottom-0 w-px bg-red-400/60" style={{ left: `${pct(todayStr)}%` }} />}
                    <div
                      title={`${r.start} → ${r.end}`}
                      className={cn('absolute top-1.5 h-4 rounded', overdue ? 'bg-red-500' : BAR_CLS[r.it.todo.status])}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

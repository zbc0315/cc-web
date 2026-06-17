import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { TodoItem } from '@/components/TodoView';

/**
 * Month calendar of todo DEADLINES — each todo is placed on its plannedDate.
 * Todos without a planned date have no deadline and are not shown. Project
 * filtering is applied by the caller (TodoView) before passing `items`.
 */

const STATUS_DOT = { todo: 'bg-muted-foreground', doing: 'bg-amber-500', done: 'bg-green-500' } as const;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function TodoCalendarView({ items }: { items: TodoItem[] }) {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const today = ymd(new Date());

  const byDate = new Map<string, TodoItem[]>();
  for (const it of items) {
    if (!it.todo.plannedDate) continue;
    const arr = byDate.get(it.todo.plannedDate);
    if (arr) arr.push(it); else byDate.set(it.todo.plannedDate, [it]);
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-start
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weekdays = t('todo.weekdays').split(',');

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium w-28 text-center">{t('todo.cal_month', { y: year, m: month + 1 })}</span>
          <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>
          {t('todo.today')}
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
        {weekdays.map((w, i) => (
          <div key={i} className="bg-card text-center text-xs text-muted-foreground py-1">{w}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="bg-background/40 min-h-[84px]" />;
          const key = ymd(date);
          const dayItems = byDate.get(key) ?? [];
          const isToday = key === today;
          return (
            <div key={i} className="bg-card min-h-[84px] p-1">
              <div className={cn('text-xs mb-1 text-right', isToday ? 'font-bold text-primary' : 'text-muted-foreground')}>
                {date.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 4).map((it) => {
                  const overdue = it.todo.status !== 'done' && key < today;
                  return (
                    <div
                      key={it.todo.id}
                      title={`${it.projectName} · ${it.todo.title}`}
                      className={cn('flex items-center gap-1 text-[11px] rounded px-1 py-0.5',
                        it.todo.status === 'done' && 'line-through text-muted-foreground',
                        overdue ? 'bg-red-500/15 text-red-600 dark:text-red-300' : 'bg-muted')}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATUS_DOT[it.todo.status])} />
                      <span className="truncate">{it.todo.title}</span>
                    </div>
                  );
                })}
                {dayItems.length > 4 && (
                  <div className="text-[10px] text-muted-foreground px-1">+{dayItems.length - 4}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {byDate.size === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">{t('todo.no_dated')}</div>
      )}
    </div>
  );
}

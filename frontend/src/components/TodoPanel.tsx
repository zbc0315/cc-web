import { useState, useEffect } from 'react';
import { CheckSquare, Clock, Circle, AlertCircle } from 'lucide-react';
import { getProjectTodos, TodoItem } from '@/lib/api';
import { cn } from '@/lib/utils';

interface TodoPanelProps {
  projectId: string;
}

export function TodoPanel({ projectId }: TodoPanelProps) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await getProjectTodos(projectId);
        if (active) setTodos(data);
      } catch {
        if (active) setTodos([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50 text-xs">
        <CheckSquare className="h-5 w-5" />
        <p>加载中…</p>
      </div>
    );
  }

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/50 text-xs">
        <CheckSquare className="h-5 w-5" />
        <p className="text-center">暂无任务</p>
        <p className="text-center text-[10px]">当 Claude 使用 TodoWrite 工具时，任务将显示在这里</p>
      </div>
    );
  }

  const inProgress = todos.filter((t) => t.status === 'in_progress');
  const pending = todos.filter((t) => t.status === 'pending');
  const completed = todos.filter((t) => t.status === 'completed');

  const statusIcon = (status: TodoItem['status']) => {
    if (status === 'completed') return <CheckSquare className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />;
    if (status === 'in_progress') return <Clock className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />;
    return <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
  };

  const priorityColor: Record<NonNullable<TodoItem['priority']>, string> = {
    high: 'text-red-400',
    medium: 'text-yellow-400',
    low: 'text-muted-foreground',
  };

  const Section = ({ title, items }: { title: string; items: TodoItem[] }) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 font-medium">{title}</div>
        <div className="space-y-0.5">
          {items.map((todo) => (
            <div key={todo.id} className="flex items-start gap-1.5 px-1 py-1.5 rounded hover:bg-muted transition-colors">
              {statusIcon(todo.status)}
              <span className={cn(
                'flex-1 text-xs leading-snug',
                todo.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground'
              )}>
                {todo.content}
              </span>
              {todo.priority && todo.priority !== 'medium' && (
                <AlertCircle className={cn('h-2.5 w-2.5 flex-shrink-0 mt-0.5', priorityColor[todo.priority])} />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-3 min-h-0">
      <Section title="进行中" items={inProgress} />
      <Section title="待处理" items={pending} />
      <Section title="已完成" items={completed} />
    </div>
  );
}

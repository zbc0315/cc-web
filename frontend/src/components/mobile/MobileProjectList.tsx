import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/lib/stores';
import { useDashboardWebSocket, ActivityUpdate } from '@/lib/websocket';

interface MobileProjectListProps {
  onSelectProject: (projectId: string) => void;
}

export function MobileProjectList({ onSelectProject }: MobileProjectListProps) {
  const navigate = useNavigate();
  const { projects, fetchProjects, hasFetched, loading } = useProjectStore();
  const [statuses, setStatuses] = useState<Map<string, 'running' | 'stopped' | 'restarting'>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Real-time status via dashboard WS
  const handleActivity = useCallback((update: ActivityUpdate) => {
    if (update.status) {
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(update.projectId, update.status!);
        return next;
      });
    }
  }, []);

  useDashboardWebSocket({ onActivityUpdate: handleActivity });

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchProjects(); } finally { setRefreshing(false); }
  };

  const activeProjects = projects.filter((p) => !p.archived);

  const getStatus = (p: typeof projects[0]) => statuses.get(p.id) ?? p.status ?? 'stopped';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
        <span className="font-semibold text-base flex-1">CC Web</span>
        <button
          onClick={() => void handleRefresh()}
          className="text-muted-foreground active:text-foreground"
          disabled={refreshing}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </button>
        <button onClick={() => navigate('/')} className="text-muted-foreground active:text-foreground" title="桌面模式">
          <Monitor className="h-4 w-4" />
        </button>
      </div>

      {/* Project grid — 2 columns */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && !hasFetched && (
          <div className="text-center text-muted-foreground text-sm py-12">
            加载中...
          </div>
        )}

        {hasFetched && activeProjects.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-12">
            暂无项目
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {activeProjects.map((project) => {
            const status = getStatus(project);
            const isRunning = status === 'running';
            return (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className="text-left rounded-lg border border-border bg-card p-2.5 active:bg-accent transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    isRunning ? 'bg-green-500' : 'bg-zinc-400',
                  )} />
                  <span className="font-medium text-sm truncate flex-1">{project.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {project.cliTool ?? 'claude'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

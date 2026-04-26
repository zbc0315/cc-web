import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, RefreshCw, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProjectStore, useAuthStore } from '@/lib/stores';
import { useDashboardWebSocket, ActivityUpdate } from '@/lib/websocket';
import { UpdateButton } from '@/components/UpdateButton';
import { useProjectOrder } from '@/hooks/useProjectOrder';

interface MobileProjectListProps {
  onSelectProject: (projectId: string) => void;
}

const IS_MOBILE_DEVICE =
  window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;

export function MobileProjectList({ onSelectProject }: MobileProjectListProps) {
  const navigate = useNavigate();
  const clearToken = useAuthStore((s) => s.clearToken);
  const { projects, fetchProjects, hasFetched, loading } = useProjectStore();
  const handleLogout = useCallback(() => {
    // clearToken only drops the auth token — also flush the project cache so
    // the next user (or re-login) starts from a clean slate, not stale data
    // from the previous session (codex Q9 finding).
    useProjectStore.getState().setProjects([]);
    clearToken();
    navigate('/login');
  }, [clearToken, navigate]);
  const [statuses, setStatuses] = useState<Map<string, 'running' | 'stopped' | 'restarting'>>(new Map());
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
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
    if (update.active !== undefined) {
      setActiveIds((prev) => {
        const next = new Set(prev);
        if (update.active) next.add(update.projectId);
        else next.delete(update.projectId);
        return next;
      });
    }
  }, []);

  useDashboardWebSocket({ onActivityUpdate: handleActivity });

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchProjects(); } finally { setRefreshing(false); }
  };

  const { applyOrder } = useProjectOrder();
  const activeProjects = applyOrder(projects.filter((p) => !p.archived));

  const getStatus = (p: typeof projects[0]) => statuses.get(p.id) ?? p.status ?? 'stopped';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
        <span className="font-semibold text-base flex-1">CC Web</span>
        <UpdateButton />
        <button
          onClick={() => void handleRefresh()}
          className="text-muted-foreground active:text-foreground"
          disabled={refreshing}
          aria-label="Refresh"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="text-muted-foreground active:text-foreground"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          onClick={handleLogout}
          className="text-muted-foreground active:text-foreground"
          aria-label="Logout"
        >
          <LogOut className="h-4 w-4" />
        </button>
        {!IS_MOBILE_DEVICE && (
          <button onClick={() => navigate('/')} className="text-muted-foreground active:text-foreground" aria-label="Desktop mode">
            <Monitor className="h-4 w-4" />
          </button>
        )}
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
            const isActive = activeIds.has(project.id);
            const card = (
              <button
                onClick={() => onSelectProject(project.id)}
                className={cn(
                  'w-full text-left rounded-xl border bg-card p-2.5 active:bg-accent transition-colors',
                  isActive ? 'border-transparent' : 'border-border',
                )}
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
            return (
              <div key={project.id} className={isActive ? 'card-active-glow rounded-xl' : undefined}>
                {card}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

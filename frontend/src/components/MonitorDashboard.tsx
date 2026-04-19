import { useMemo, useState, useCallback, useRef } from 'react';
import { Project } from '@/types';
import { MonitorPane } from './MonitorPane';
import { useProjectOrder } from '@/hooks/useProjectOrder';
import { cn } from '@/lib/utils';

interface MonitorDashboardProps {
  projects: Project[];
  projectStatuses: Map<string, 'running' | 'stopped' | 'restarting'>;
  activeProjectIds: Set<string>;
}

function calcGrid(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count <= 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 9) return { cols: 3, rows: 3 };
  if (count <= 12) return { cols: 4, rows: 3 };
  return { cols: 4, rows: Math.ceil(count / 4) };
}

export function MonitorDashboard({ projects, projectStatuses, activeProjectIds }: MonitorDashboardProps) {
  const activeProjects = useMemo(
    () => projects.filter(p => !p.archived),
    [projects],
  );

  const { order, setOrder, applyOrder } = useProjectOrder();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(() => applyOrder(activeProjects), [activeProjects, applyOrder]);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Transparent drag image — we show visual feedback via CSS instead
    const ghost = document.createElement('div');
    ghost.style.width = '1px';
    ghost.style.height = '1px';
    ghost.style.opacity = '0.01';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    dragGhostRef.current = ghost;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverId(id);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    // Use saved order as base (shared across clients); fall back to current view
    const displayIds = sorted.map(p => p.id);
    const base = order.length ? [...order] : displayIds;
    for (const id of displayIds) if (!base.includes(id)) base.push(id);
    const fromIdx = base.indexOf(dragId);
    const toIdx = base.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDragId(null); setOverId(null); return; }
    base.splice(fromIdx, 1);
    base.splice(toIdx, 0, dragId);
    setOrder(base);
    setDragId(null);
    setOverId(null);
  }, [dragId, sorted, order, setOrder]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
    if (dragGhostRef.current) {
      dragGhostRef.current.remove();
      dragGhostRef.current = null;
    }
  }, []);

  const { cols, rows } = calcGrid(sorted.length);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
        没有活跃项目
      </div>
    );
  }

  const fitsOnScreen = rows <= 3;

  return (
    <div
      className="h-full w-full p-2 gap-2 overflow-y-auto"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: fitsOnScreen ? `minmax(180px, min(${Math.floor(100 / rows)}vh, 350px))` : '280px',
      }}
    >
      {sorted.map(project => (
        <div
          key={project.id}
          draggable
          onDragStart={(e) => handleDragStart(e, project.id)}
          onDragOver={(e) => handleDragOver(e, project.id)}
          onDrop={(e) => handleDrop(e, project.id)}
          onDragEnd={handleDragEnd}
          className={cn(
            'transition-all duration-200',
            dragId === project.id && 'opacity-40 scale-95',
            overId === project.id && dragId !== project.id && 'ring-2 ring-blue-500/50 rounded-lg',
          )}
        >
          <MonitorPane
            project={project}
            externalStatus={projectStatuses.get(project.id)}
            active={activeProjectIds.has(project.id)}
          />
        </div>
      ))}
    </div>
  );
}

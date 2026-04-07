import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Project } from '@/types';
import { MonitorPane } from './MonitorPane';
import { cn } from '@/lib/utils';

const ORDER_KEY = 'ccweb:monitor-order';

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

function loadOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch { return []; }
}

function saveOrder(ids: string[]) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
}

/** Sort projects by saved order; unknown IDs go to end in original order */
function applyOrder(projects: Project[], order: string[]): Project[] {
  const idxMap = new Map(order.map((id, i) => [id, i]));
  return [...projects].sort((a, b) => {
    const ia = idxMap.get(a.id) ?? Infinity;
    const ib = idxMap.get(b.id) ?? Infinity;
    if (ia === ib) return 0;
    return ia - ib;
  });
}

export function MonitorDashboard({ projects, projectStatuses, activeProjectIds }: MonitorDashboardProps) {
  const activeProjects = useMemo(
    () => projects.filter(p => !p.archived),
    [projects],
  );

  const [order, setOrder] = useState<string[]>(loadOrder);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(() => applyOrder(activeProjects, order), [activeProjects, order]);

  // Persist order whenever sorted projects change and we have a user-defined order
  useEffect(() => {
    if (order.length > 0) saveOrder(order);
  }, [order]);

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
    const ids = sorted.map(p => p.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDragId(null); setOverId(null); return; }
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    setOrder(ids);
    setDragId(null);
    setOverId(null);
  }, [dragId, sorted]);

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
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
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

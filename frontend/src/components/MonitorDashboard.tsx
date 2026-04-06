import { useMemo } from 'react';
import { Project } from '@/types';
import { MonitorPane } from './MonitorPane';

interface MonitorDashboardProps {
  projects: Project[];
  projectStatuses: Map<string, 'running' | 'stopped' | 'restarting'>;
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

export function MonitorDashboard({ projects, projectStatuses }: MonitorDashboardProps) {
  const activeProjects = useMemo(
    () => projects.filter(p => !p.archived),
    [projects],
  );

  const { cols, rows } = calcGrid(activeProjects.length);

  if (activeProjects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
        没有活跃项目
      </div>
    );
  }

  // If rows fit on screen, use 1fr to fill evenly; otherwise fixed height + scroll
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
      {activeProjects.map(project => (
        <MonitorPane
          key={project.id}
          project={project}
          externalStatus={projectStatuses.get(project.id)}
        />
      ))}
    </div>
  );
}

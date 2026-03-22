import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, FolderOpen } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Project } from '@/types';
import { cn } from '@/lib/utils';

interface ProjectCardProps {
  project: Project;
  active?: boolean;
  onDelete: (id: string) => void;
}

function StatusDot({ status }: { status: Project['status'] }) {
  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full', {
        'bg-green-500': status === 'running',
        'bg-zinc-400': status === 'stopped',
        'bg-yellow-400 animate-pulse': status === 'restarting',
      })}
    />
  );
}

export function ProjectCard({ project, active = false, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
      onDelete(project.id);
    }
  };

  const card = (
    <Card
      className={cn(
        'group cursor-pointer transition-colors relative',
        active ? 'border-transparent hover:border-transparent' : 'hover:border-zinc-400'
      )}
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{project.name}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDelete}
            title="Delete project"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={project.status} />
          <span className="text-xs text-muted-foreground capitalize">{project.status}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate font-mono">{project.folderPath}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono">
            {project.cliTool ?? 'claude'}
          </Badge>
          <Badge variant={project.permissionMode === 'unlimited' ? 'destructive' : 'secondary'} className="text-xs">
            {project.permissionMode === 'unlimited' ? 'Unlimited' : 'Limited'}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );

  if (active) {
    return <div className="card-active-glow rounded-lg">{card}</div>;
  }

  return card;
}

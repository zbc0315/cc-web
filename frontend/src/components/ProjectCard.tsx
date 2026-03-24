import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, FolderOpen, Archive, ArchiveRestore, Users, Eye, Pencil } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShareDialog } from './ShareDialog';
import { Project } from '@/types';
import { SemanticStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ProjectCardProps {
  project: Project;
  active?: boolean;
  semanticStatus?: SemanticStatus;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onUpdated?: (project: Project) => void;
}

function phaseLabel(phase: SemanticStatus['phase'], detail?: string): string {
  switch (phase) {
    case 'thinking': return 'Thinking…';
    case 'tool_use': return detail ? `${detail}` : 'Tool…';
    case 'tool_result': return 'Reading…';
    case 'text': return 'Writing…';
  }
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

export function ProjectCard({ project, active = false, semanticStatus, onDelete, onArchive, onUnarchive, onUpdated }: ProjectCardProps) {
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(false);
  const isShared = !!project._sharedPermission;
  const isViewOnly = project._sharedPermission === 'view';

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
      onDelete(project.id);
    }
  };

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    onArchive(project.id);
  };

  const handleUnarchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUnarchive(project.id);
  };

  const card = (
    <Card
      className={cn(
        'group cursor-pointer transition-colors relative',
        project.archived
          ? 'opacity-60 hover:opacity-80 hover:border-zinc-400'
          : active
            ? 'border-transparent hover:border-transparent'
            : 'hover:border-zinc-400'
      )}
      onClick={() => !project.archived && navigate(`/projects/${project.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className={cn('text-base leading-tight', project.archived && 'text-muted-foreground')}>
            {project.name}
          </CardTitle>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {!isShared && (
              <>
                {project.archived ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={handleUnarchive}
                    title="Restore project"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={(e) => { e.stopPropagation(); setShareOpen(true); }}
                      title="共享设置"
                    >
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={handleArchive}
                      title="Archive project"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDelete}
                  title="Delete project"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {project.archived ? (
            <Badge variant="secondary" className="text-xs">Archived</Badge>
          ) : (
            <>
              <StatusDot status={project.status} />
              <span className="text-xs text-muted-foreground capitalize">{project.status}</span>
              {active && semanticStatus && (
                <Badge variant="outline" className="text-xs ml-auto animate-pulse font-normal">
                  {phaseLabel(semanticStatus.phase, semanticStatus.detail)}
                </Badge>
              )}
            </>
          )}
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
          {isShared && (
            <Badge variant="outline" className="text-xs gap-0.5">
              {isViewOnly ? <Eye className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              {isViewOnly ? '可见' : '可编辑'}
            </Badge>
          )}
          {!isShared && project.shares && project.shares.length > 0 && (
            <Badge variant="outline" className="text-xs gap-0.5">
              <Users className="h-3 w-3" />
              {project.shares.length}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );

  const wrappedCard = active && !project.archived
    ? <div className="card-active-glow rounded-lg">{card}</div>
    : card;

  return (
    <>
      {wrappedCard}
      {!isShared && onUpdated && (
        <ShareDialog
          project={project}
          open={shareOpen}
          onOpenChange={setShareOpen}
          onUpdated={onUpdated}
        />
      )}
    </>
  );
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, FolderOpen, Archive, ArchiveRestore, Users, Eye, Pencil } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShareDialog } from './ShareDialog';
import { Project } from '@/types';
import { SemanticStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface StatusEntry {
  id: number;
  phase: SemanticStatus['phase'];
  detail?: string;
  ts: number;
}

interface ProjectCardProps {
  project: Project;
  active?: boolean;
  statusStack?: StatusEntry[];
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

export const ProjectCard = React.memo(function ProjectCard({ project, active = false, statusStack = [], onDelete, onArchive, onUnarchive, onUpdated }: ProjectCardProps) {
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
    <motion.div whileHover={!project.archived && !active ? { y: -2 } : {}} transition={{ duration: 0.2 }}>
    <Card
      className={cn(
        'group cursor-pointer transition-colors relative',
        project.archived
          ? 'opacity-60 hover:opacity-80 hover:border-zinc-400'
          : active
            ? 'border-transparent hover:border-transparent bg-transparent shadow-none'
            : 'hover:border-zinc-400 hover:shadow-md'
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
              {active && statusStack.length > 0 && (
                <div className="ml-auto">
                  <AnimatePresence mode="wait">
                    {statusStack.slice(-1).map((entry) => (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                      >
                        <Badge variant="outline" className="text-xs font-normal whitespace-nowrap">
                          {phaseLabel(entry.phase, entry.detail)}
                        </Badge>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
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
        {/* Tags */}
        {(project.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {(project.tags ?? []).slice(0, 3).map((tag) => (
              <span key={tag} className="px-1.5 py-0 rounded-full text-[10px] bg-muted text-muted-foreground border border-border">
                #{tag}
              </span>
            ))}
            {(project.tags?.length ?? 0) > 3 && (
              <span className="text-[10px] text-muted-foreground">+{(project.tags?.length ?? 0) - 3}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
    </motion.div>
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
});

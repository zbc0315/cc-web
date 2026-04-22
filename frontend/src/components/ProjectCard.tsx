import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, FolderOpen, Archive, ArchiveRestore, Users, Eye, Pencil } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShareDialog } from './ShareDialog';
import { Project } from '@/types';
import { SemanticStatus, getProjectDiskSize, renameProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ConfirmProvider';
import { MOTION } from '@/lib/motion';

function formatDiskSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

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
  const confirm = useConfirm();
  const [shareOpen, setShareOpen] = useState(false);
  const [diskSize, setDiskSize] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isShared = !!project._sharedPermission;

  useEffect(() => {
    let cancelled = false;
    getProjectDiskSize(project.id).then(({ bytes }) => { if (!cancelled) setDiskSize(bytes); }).catch(() => {});
    return () => { cancelled = true; };
  }, [project.id]);
  const isViewOnly = project._sharedPermission === 'view';

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: '删除项目',
      description: `确认删除项目 "${project.name}"？此操作不可撤销。`,
      destructive: true,
      confirmLabel: '删除',
    });
    if (ok) onDelete(project.id);
  };

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    onArchive(project.id);
  };

  const handleUnarchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUnarchive(project.id);
  };

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(project.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === project.name) {
      setEditing(false);
      return;
    }
    try {
      const updated = await renameProject(project.id, trimmed);
      onUpdated?.(updated);
      setEditing(false);
    } catch (err: any) {
      toast.error('Rename failed', { description: err?.message });
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
    if (e.key === 'Escape') { setEditing(false); }
  };

  const card = (
    <motion.div whileHover={!project.archived && !active ? { y: -2 } : {}} transition={MOTION.fast}>
    <Card
      className={cn(
        'group cursor-pointer transition-colors relative',
        project.archived
          ? 'opacity-60 hover:opacity-80 hover:border-muted-foreground/40'
          : active
            ? 'border-transparent hover:border-transparent bg-transparent shadow-none'
            : 'hover:border-muted-foreground/40'
      )}
      onClick={() => !project.archived && navigate(`/projects/${project.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          {editing ? (
            <input
              ref={inputRef}
              className="text-base leading-tight font-semibold bg-transparent border-b border-primary outline-none w-full min-w-0"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={handleNameKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <CardTitle
              className={cn('text-base leading-tight', project.archived && 'text-muted-foreground')}
              onDoubleClick={!isShared && !project.archived ? startEditing : undefined}
            >
              {project.name}
            </CardTitle>
          )}
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
                      onClick={startEditing}
                      title="Rename project"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
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
                        transition={MOTION.default}
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
          {diskSize !== null && (
            <span className="flex-shrink-0 ml-auto text-muted-foreground/70">{formatDiskSize(diskSize)}</span>
          )}
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
    ? <div className="card-active-glow rounded-xl">{card}</div>
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

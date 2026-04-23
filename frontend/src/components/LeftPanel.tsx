import { FolderOpen, GitBranch, Clock, Archive } from 'lucide-react';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { ScheduledTasksPanel } from './ScheduledTasksPanel';
import { SessionsBackupPanel } from './SessionsBackupPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { cn } from '@/lib/utils';
import type { CliTool } from '@/types';

type LeftTab = 'files' | 'git' | 'scheduled' | 'backup';

interface LeftPanelProps {
  projectPath: string;
  projectId: string;
  cliTool: CliTool;
  onSend?: (text: string) => void;
}

/**
 * LeftPanel: vertical tab rail on the LEFT edge.  Entire sidebar (rail +
 * content) is `bg-muted` — perceptibly gray in both themes vs adjacent
 * `bg-background` main content.  Do NOT use `bg-muted/40`: with light
 * `--muted` at 95.9% lightness, 40% over pure white is indistinguishable
 * from white.  Separation between rail and content comes from the
 * `border-l border-border` on the content wrapper, not a bg difference.
 * Selection persists in `cc_left_panel_tab`.
 *
 * The scheduled tab is only mounted for Claude projects — the
 * `~/.claude/scheduled_tasks.json` backing store is Claude-specific; Codex
 * et al. have no equivalent.  The backup tab is available for every tool
 * except terminal (no chat to back up).
 */
export function LeftPanel({ projectPath, projectId, cliTool }: LeftPanelProps) {
  const [tabStr, setTab] = usePersistedState(STORAGE_KEYS.leftPanelTab, 'files');
  const showScheduled = cliTool === 'claude';
  const showBackup = cliTool !== 'terminal';
  let tab: LeftTab;
  if (tabStr === 'git') tab = 'git';
  else if (tabStr === 'scheduled' && showScheduled) tab = 'scheduled';
  else if (tabStr === 'backup' && showBackup) tab = 'backup';
  else tab = 'files';

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v)}
      orientation="vertical"
      className="h-full flex bg-muted text-foreground overflow-hidden"
    >
      <TabsList
        className={cn(
          'flex flex-col items-center justify-start shrink-0',
          'h-full w-9 border-r border-border rounded-none p-1 gap-1',
        )}
      >
        <TabsTrigger
          value="files"
          title="Files"
          aria-label="Files"
          className={cn('h-7 w-7 p-0 rounded-md flex items-center justify-center')}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </TabsTrigger>
        <TabsTrigger
          value="git"
          title="Git"
          aria-label="Git"
          className={cn('h-7 w-7 p-0 rounded-md flex items-center justify-center')}
        >
          <GitBranch className="h-3.5 w-3.5" />
        </TabsTrigger>
        {showScheduled && (
          <TabsTrigger
            value="scheduled"
            title="已排程任务"
            aria-label="Scheduled tasks"
            className={cn('h-7 w-7 p-0 rounded-md flex items-center justify-center')}
          >
            <Clock className="h-3.5 w-3.5" />
          </TabsTrigger>
        )}
        {showBackup && (
          <TabsTrigger
            value="backup"
            title="聊天记录备份"
            aria-label="Sessions backup"
            className={cn('h-7 w-7 p-0 rounded-md flex items-center justify-center')}
          >
            <Archive className="h-3.5 w-3.5" />
          </TabsTrigger>
        )}
      </TabsList>
      <div className="flex-1 min-w-0 flex flex-col border-l border-border">
        <TabsContent value="files" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <FileTree projectPath={projectPath} projectId={projectId} />
        </TabsContent>
        <TabsContent value="git" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <GitPanel projectId={projectId} />
        </TabsContent>
        {showScheduled && (
          <TabsContent value="scheduled" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
            <ScheduledTasksPanel projectId={projectId} />
          </TabsContent>
        )}
        {showBackup && (
          <TabsContent value="backup" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
            <SessionsBackupPanel projectId={projectId} />
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}

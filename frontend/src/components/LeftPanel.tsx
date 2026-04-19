import { FolderOpen, GitBranch } from 'lucide-react';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { cn } from '@/lib/utils';

type LeftTab = 'files' | 'git';

interface LeftPanelProps {
  projectPath: string;
  projectId: string;
  onSend?: (text: string) => void;
}

/**
 * LeftPanel: vertical tab rail on the LEFT edge (IDE-style activity bar), icon-only
 * triggers with native tooltips. Selection persists in `cc_left_panel_tab`.
 */
export function LeftPanel({ projectPath, projectId }: LeftPanelProps) {
  const [tabStr, setTab] = usePersistedState(STORAGE_KEYS.leftPanelTab, 'files');
  const tab: LeftTab = tabStr === 'git' ? 'git' : 'files';

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v)}
      orientation="vertical"
      className="h-full flex bg-background text-foreground overflow-hidden"
    >
      <TabsList
        className={cn(
          'flex flex-col items-center justify-start shrink-0',
          'h-full w-9 bg-muted/40 border-r border-border rounded-none p-1 gap-1',
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
      </TabsList>
      <div className="flex-1 min-w-0 flex flex-col">
        <TabsContent value="files" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <FileTree projectPath={projectPath} projectId={projectId} />
        </TabsContent>
        <TabsContent value="git" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <GitPanel projectId={projectId} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

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
 * LeftPanel mirrors RightPanel's horizontal shadcn Tabs (Files / Git), with
 * TabsList `ml-auto` so the tab strip sits flush against the divider next to
 * the center terminal column. Selection persists in `cc_left_panel_tab`.
 */
export function LeftPanel({ projectPath, projectId }: LeftPanelProps) {
  const [tabStr, setTab] = usePersistedState(STORAGE_KEYS.leftPanelTab, 'files');
  const tab: LeftTab = tabStr === 'git' ? 'git' : 'files';

  return (
    <div className="h-full bg-background text-foreground overflow-hidden flex flex-col">
      <Tabs value={tab} onValueChange={(v) => setTab(v)} className="h-full flex flex-col">
        <div className="flex px-2 mt-2 shrink-0">
          <TabsList className="ml-auto h-8 w-auto">
            <TabsTrigger value="files" className={cn('h-6 text-xs flex items-center gap-1')}>
              <FolderOpen className="h-3 w-3" />
              Files
            </TabsTrigger>
            <TabsTrigger value="git" className={cn('h-6 text-xs flex items-center gap-1')}>
              <GitBranch className="h-3 w-3" />
              Git
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="files" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <FileTree projectPath={projectPath} projectId={projectId} />
        </TabsContent>
        <TabsContent value="git" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <GitPanel projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { lazy, Suspense } from 'react';
import { FolderOpen, GitBranch, ListChecks } from 'lucide-react';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { cn } from '@/lib/utils';

const PlanPanel = lazy(() => import('./PlanPanel').then(m => ({ default: m.PlanPanel })));

type LeftTab = 'files' | 'git' | 'plan';

interface LeftPanelProps {
  projectPath: string;
  projectId: string;
  planStatus?: { status: string; executed_tasks: number; estimated_tasks: number; current_line: number } | null;
  planNodeUpdate?: { node_id: string; status: string; summary: string | null } | null;
  planReplan?: number;
  onSend?: (text: string) => void;
}

/**
 * LeftPanel mirrors RightPanel's horizontal shadcn Tabs (Files / Git / Plan),
 * but the TabsList is right-aligned within the panel (`ml-auto`) so the tab
 * strip sits flush against the divider next to the center terminal column —
 * keeping the user's focus of "what tab am I on" close to the main work area.
 *
 * Tab selection is persisted in localStorage under `cc_left_panel_tab`.
 */
export function LeftPanel({ projectPath, projectId, planStatus, planNodeUpdate, planReplan }: LeftPanelProps) {
  const [tabStr, setTab] = usePersistedState(STORAGE_KEYS.leftPanelTab, 'files');
  const tab: LeftTab = tabStr === 'git' || tabStr === 'plan' ? tabStr : 'files';

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
            <TabsTrigger value="plan" className={cn('h-6 text-xs flex items-center gap-1')}>
              <ListChecks className="h-3 w-3" />
              Plan
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="files" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <FileTree projectPath={projectPath} projectId={projectId} />
        </TabsContent>
        <TabsContent value="git" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <GitPanel projectId={projectId} />
        </TabsContent>
        <TabsContent value="plan" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>}>
            <PlanPanel projectId={projectId} projectPath={projectPath} planStatus={planStatus} planNodeUpdate={planNodeUpdate} planReplan={planReplan} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

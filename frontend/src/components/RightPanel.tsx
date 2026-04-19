import { Zap, Sparkles } from 'lucide-react';
import { ShortcutPanel } from './ShortcutPanel';
import { AgentPromptsPanel } from './AgentPromptsPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { cn } from '@/lib/utils';

interface RightPanelProps {
  projectId: string;
  onSend: (text: string) => void;
}

type RightPanelTab = 'shortcuts' | 'prompts';

/**
 * RightPanel hosts two tabs:
 *   - "Shortcuts": one-click send commands to the CLI
 *   - "Agent Prompts": reusable prompt blocks that plug/unplug into CLAUDE.md
 *
 * Tab selection is persisted per-user (not per-project) so the user returns
 * to their last-used surface.
 */
export function RightPanel({ projectId, onSend }: RightPanelProps) {
  const [tabStr, setTab] = usePersistedState(STORAGE_KEYS.rightPanelTab, 'shortcuts');
  const tab: RightPanelTab = tabStr === 'prompts' ? 'prompts' : 'shortcuts';

  return (
    <div className="h-full bg-background text-foreground overflow-hidden flex flex-col">
      <Tabs value={tab} onValueChange={(v) => setTab(v)} className="h-full flex flex-col">
        <TabsList className="mx-2 mt-2 h-8 w-auto grid grid-cols-2 shrink-0">
          <TabsTrigger value="shortcuts" className={cn('h-6 text-xs flex items-center gap-1')}>
            <Zap className="h-3 w-3" />
            Shortcuts
          </TabsTrigger>
          <TabsTrigger value="prompts" className={cn('h-6 text-xs flex items-center gap-1')}>
            <Sparkles className="h-3 w-3" />
            Agent Prompts
          </TabsTrigger>
        </TabsList>
        <TabsContent value="shortcuts" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <ShortcutPanel projectId={projectId} onSend={onSend} />
        </TabsContent>
        <TabsContent value="prompts" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <AgentPromptsPanel projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

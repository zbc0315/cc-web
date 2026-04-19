import { Zap, Sparkles, Database } from 'lucide-react';
import { ShortcutPanel } from './ShortcutPanel';
import { AgentPromptsPanel } from './AgentPromptsPanel';
import { MemoryPromptsPanel } from './MemoryPromptsPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { cn } from '@/lib/utils';

interface RightPanelProps {
  projectId: string;
  onSend: (text: string) => void;
}

type RightPanelTab = 'shortcuts' | 'prompts' | 'memory';

/**
 * RightPanel: vertical tab rail on the RIGHT edge, icon-only triggers with
 * native tooltips.  Entire sidebar (rail + content) is `bg-muted` —
 * perceptibly gray vs adjacent `bg-background` main content.  Separation
 * between content and rail comes from `border-r border-border` on the
 * content wrapper, not a bg gradient.
 */
export function RightPanel({ projectId, onSend }: RightPanelProps) {
  const [tabStr, setTab] = usePersistedState(STORAGE_KEYS.rightPanelTab, 'shortcuts');
  const tab: RightPanelTab =
    tabStr === 'prompts' ? 'prompts' :
    tabStr === 'memory' ? 'memory' :
    'shortcuts';

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v)}
      orientation="vertical"
      className="h-full flex bg-muted text-foreground overflow-hidden"
    >
      <div className="flex-1 min-w-0 flex flex-col border-r border-border">
        <TabsContent value="shortcuts" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <ShortcutPanel projectId={projectId} onSend={onSend} />
        </TabsContent>
        <TabsContent value="prompts" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <AgentPromptsPanel projectId={projectId} />
        </TabsContent>
        <TabsContent value="memory" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
          <MemoryPromptsPanel projectId={projectId} />
        </TabsContent>
      </div>
      <TabsList
        className={cn(
          'flex flex-col items-center justify-start shrink-0',
          'h-full w-9 border-l border-border rounded-none p-1 gap-1',
        )}
      >
        <TabsTrigger
          value="shortcuts"
          title="Quick Prompts (快捷 Prompts)"
          aria-label="Quick Prompts"
          className={cn('h-7 w-7 p-0 rounded-md flex items-center justify-center')}
        >
          <Zap className="h-3.5 w-3.5" />
        </TabsTrigger>
        <TabsTrigger
          value="prompts"
          title="Agent Prompts"
          aria-label="Agent Prompts"
          className={cn('h-7 w-7 p-0 rounded-md flex items-center justify-center')}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </TabsTrigger>
        <TabsTrigger
          value="memory"
          title="Memory Prompts (.ccweb/memory/*.md)"
          aria-label="Memory Prompts"
          className={cn('h-7 w-7 p-0 rounded-md flex items-center justify-center')}
        >
          <Database className="h-3.5 w-3.5" />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

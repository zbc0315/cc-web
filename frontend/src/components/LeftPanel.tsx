import { useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { cn } from '@/lib/utils';

const PlanPanel = lazy(() => import('./PlanPanel').then(m => ({ default: m.PlanPanel })));

type LeftTab = 'files' | 'git' | 'plan';

const TAB_LABELS: Record<LeftTab, string> = {
  files: '文件',
  git: 'Git',
  plan: '计划',
};

interface LeftPanelProps {
  projectPath: string;
  projectId: string;
  planStatus?: { status: string; executed_tasks: number; estimated_tasks: number; current_line: number } | null;
  planNodeUpdate?: { node_id: string; status: string; summary: string | null } | null;
  planReplan?: number;
  onSend?: (text: string) => void;
}

export function LeftPanel({ projectPath, projectId, planStatus, planNodeUpdate, planReplan }: LeftPanelProps) {
  const [tab, setTab] = useState<LeftTab>('files');

  return (
    <div className="h-full flex flex-row">
      {/* Tab strip on the left */}
      <div className="flex flex-col flex-shrink-0 w-7 border-r border-border bg-background">
        {(['files', 'git', 'plan'] as LeftTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-label={TAB_LABELS[t]}
            className={cn(
              'flex-none px-1.5 py-3 text-[11px] font-medium transition-colors select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500',
              tab === t
                ? 'text-blue-400 bg-muted/50 border-r-2 border-blue-500 -mr-px'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            )}
            style={{ writingMode: 'vertical-rl' }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {tab === 'files' && (
          <motion.div
            key="files"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 min-w-0 overflow-hidden"
          >
            <FileTree projectPath={projectPath} projectId={projectId} />
          </motion.div>
        )}
        {tab === 'git' && (
          <motion.div
            key="git"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 min-w-0 overflow-hidden"
          >
            <GitPanel projectId={projectId} />
          </motion.div>
        )}
        {tab === 'plan' && (
          <motion.div
            key="plan"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 min-w-0 overflow-hidden"
          >
            <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-muted-foreground">加载中...</div>}>
              <PlanPanel projectId={projectId} projectPath={projectPath} planStatus={planStatus} planNodeUpdate={planNodeUpdate} planReplan={planReplan} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

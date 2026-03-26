import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { cn } from '@/lib/utils';

type LeftTab = 'files' | 'git';

const TAB_LABELS: Record<LeftTab, string> = {
  files: '文件',
  git: 'Git',
};

interface LeftPanelProps {
  projectPath: string;
  projectId: string;
}

export function LeftPanel({ projectPath, projectId }: LeftPanelProps) {
  const [tab, setTab] = useState<LeftTab>('files');

  return (
    <div className="h-full flex flex-row">
      {/* Tab strip on the left */}
      <div className="flex flex-col flex-shrink-0 w-7 border-r border-border bg-background">
        {(['files', 'git'] as LeftTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-none px-1.5 py-3 text-[11px] font-medium transition-colors select-none',
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
            <FileTree projectPath={projectPath} />
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
      </AnimatePresence>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Puzzle } from 'lucide-react';
import { getInstalledPlugins, type PluginInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PluginDockProps {
  onTogglePlugin: (plugin: PluginInfo) => void;
  activeIds: Set<string>;
}

export function PluginDock({ onTogglePlugin, activeIds }: PluginDockProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

  useEffect(() => {
    getInstalledPlugins()
      .then((list) => setPlugins(list.filter((p) => p.enabled)))
      .catch(() => setPlugins([]));
  }, []);

  // Re-fetch when navigating back from SkillHub (plugin may have been installed)
  useEffect(() => {
    const handler = () => {
      getInstalledPlugins()
        .then((list) => setPlugins(list.filter((p) => p.enabled)))
        .catch(() => {});
    };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, []);

  if (plugins.length === 0) return null;

  return (
    <div className="border-b border-border bg-muted/30 px-4">
      <div className="max-w-6xl mx-auto flex items-center gap-1 h-9 overflow-x-auto">
        <Puzzle className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0 mr-1" />
        {plugins.map((p) => {
          const isActive = activeIds.has(p.id);
          return (
            <motion.button
              key={p.id}
              onClick={() => onTogglePlugin(p)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors flex-shrink-0',
                isActive
                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              title={p.description}
            >
              <span className={cn(
                'h-1.5 w-1.5 rounded-full flex-shrink-0',
                isActive ? 'bg-blue-400' : 'bg-muted-foreground/30',
              )} />
              {p.name}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <motion.div
        className="pointer-events-auto flex items-center gap-1 px-2 py-1 rounded-full bg-background/60 backdrop-blur-md border border-border/50 shadow-md"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {plugins.map((p) => {
          const isActive = activeIds.has(p.id);
          const initials = p.name.slice(0, 2);
          return (
            <motion.button
              key={p.id}
              onClick={() => onTogglePlugin(p)}
              className={cn(
                'relative flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-medium transition-colors',
                isActive
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-muted-foreground/70 hover:text-foreground hover:bg-muted/80',
              )}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.92 }}
              title={p.name + (p.description ? ` — ${p.description}` : '')}
            >
              {initials}
              <AnimatePresence>
                {isActive && (
                  <motion.span
                    className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-blue-400"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                  />
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}

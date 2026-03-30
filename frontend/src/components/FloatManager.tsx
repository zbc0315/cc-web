import { useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { FloatWindow } from '@/components/FloatWindow';
import { updatePluginConfig, type PluginInfo, type PluginUserConfig } from '@/lib/api';

interface FloatManagerProps {
  plugins: PluginInfo[];
  onPluginsChange: (updater: (prev: PluginInfo[]) => PluginInfo[]) => void;
  onClose: (id: string) => void;
}

/**
 * FloatManager — renders floating windows for the given plugins.
 * State (which plugins to show) is managed by the parent.
 */
export function FloatManager({ plugins, onPluginsChange, onClose }: FloatManagerProps) {
  const handleConfigChange = useCallback(async (id: string, config: Partial<PluginUserConfig>) => {
    onPluginsChange((prev) =>
      prev.map((p) => (p.id === id ? { ...p, userConfig: { ...p.userConfig, ...config } } : p)),
    );
    try {
      await updatePluginConfig(id, config);
    } catch { /* best effort */ }
  }, [onPluginsChange]);

  if (plugins.length === 0) return null;

  return (
    <AnimatePresence>
      {plugins.map((p) => (
        <FloatWindow
          key={p.id}
          plugin={p}
          onConfigChange={handleConfigChange}
          onClose={onClose}
        />
      ))}
    </AnimatePresence>
  );
}

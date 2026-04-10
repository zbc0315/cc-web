import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MobileProjectList } from '@/components/mobile/MobileProjectList';
import { MobileChatView } from '@/components/mobile/MobileChatView';
import { MobileSidePanel } from '@/components/mobile/MobileSidePanel';
import { useProjectStore } from '@/lib/stores';
import { ContextUpdate } from '@/lib/websocket';

/** Lock viewport: disable pinch-zoom and ensure width matches device */
function useMobileViewport() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute('content') ?? '';
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    return () => { meta.setAttribute('content', original); };
  }, []);
}

type MobileView =
  | { screen: 'list' }
  | { screen: 'chat'; projectId: string }
  | { screen: 'panel'; projectId: string };

export function MobilePage() {
  useMobileViewport();
  const [view, setView] = useState<MobileView>({ screen: 'list' });
  const [contextData, setContextData] = useState<ContextUpdate | null>(null);
  const projects = useProjectStore((s) => s.projects);

  const openChat = useCallback((projectId: string) => {
    setView({ screen: 'chat', projectId });
    setContextData(null);
  }, []);

  const openPanel = useCallback((projectId: string) => {
    setView({ screen: 'panel', projectId });
  }, []);

  const goBack = useCallback(() => {
    setView((prev) => {
      if (prev.screen === 'panel') return { screen: 'chat', projectId: prev.projectId };
      return { screen: 'list' };
    });
  }, []);

  const currentProject = view.screen !== 'list'
    ? projects.find((p) => p.id === view.projectId)
    : undefined;

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      <AnimatePresence mode="wait">
        {view.screen === 'list' && (
          <motion.div
            key="list"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ x: '-30%', opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <MobileProjectList onSelectProject={openChat} />
          </motion.div>
        )}

        {view.screen === 'chat' && currentProject && (
          <motion.div
            key={`chat-${view.projectId}`}
            className="absolute inset-0"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <MobileChatView
              project={currentProject}
              onBack={goBack}
              onOpenPanel={() => openPanel(view.projectId)}
              onContextUpdate={setContextData}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Side panel — slides in from right */}
      <AnimatePresence>
        {view.screen === 'panel' && currentProject && (
          <motion.div
            key="panel"
            className="absolute inset-0 z-50 bg-background"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <MobileSidePanel
              projectName={currentProject.name}
              cliTool={currentProject.cliTool ?? 'claude'}
              folderPath={currentProject.folderPath}
              contextData={contextData}
              onClose={goBack}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

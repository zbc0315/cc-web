import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MobileProjectList } from '@/components/mobile/MobileProjectList';
import { MobileChatView } from '@/components/mobile/MobileChatView';
import { MobileFileBrowser } from '@/components/mobile/MobileFileBrowser';
import { useProjectStore } from '@/lib/stores';

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
  | { screen: 'files'; projectId: string; folderPath: string };

export function MobilePage() {
  useMobileViewport();
  const [view, setView] = useState<MobileView>({ screen: 'list' });
  const projects = useProjectStore((s) => s.projects);

  const openChat = useCallback((projectId: string) => {
    setView({ screen: 'chat', projectId });
  }, []);

  const openFiles = useCallback((projectId: string, folderPath: string) => {
    setView({ screen: 'files', projectId, folderPath });
  }, []);

  const goBack = useCallback(() => {
    setView((prev) => {
      if (prev.screen === 'files') return { screen: 'chat', projectId: prev.projectId };
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
              onOpenFiles={() => openFiles(view.projectId, currentProject.folderPath)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* File browser overlay — slides up independently */}
      <AnimatePresence>
        {view.screen === 'files' && currentProject && (
          <motion.div
            key="files"
            className="absolute inset-0 z-50 bg-background"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <MobileFileBrowser
              rootPath={currentProject.folderPath}
              onClose={goBack}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

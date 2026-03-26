import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, FolderOpen, Terminal as TerminalIcon, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SoundConfig } from '@/lib/api';
import { useProjectStore } from '@/lib/stores';
import { FileTree } from '@/components/FileTree';
import { RightPanel } from '@/components/RightPanel';
import { ProjectHeader } from '@/components/ProjectHeader';
import { TerminalView, TerminalViewHandle } from '@/components/TerminalView';
import { Project } from '@/types';
import { STORAGE_KEYS, usePersistedState } from '@/lib/storage';
import { cn } from '@/lib/utils';

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [soundConfig, setSoundConfig] = useState<SoundConfig>({
    enabled: false, source: 'preset:rain', playMode: 'auto', volume: 0.5, intervalRange: [3, 8],
  });

  // Panel visibility
  const [showFileTree, setShowFileTree] = usePersistedState(STORAGE_KEYS.panelFileTree, 'true');
  const [showShortcuts, setShowShortcuts] = usePersistedState(STORAGE_KEYS.panelShortcuts, 'true');
  const toggleFileTree = () => setShowFileTree((v) => v === 'true' ? 'false' : 'true');
  const toggleShortcuts = () => setShowShortcuts((v) => v === 'true' ? 'false' : 'true');

  const terminalViewRef = useRef<TerminalViewHandle>(null);

  // Mobile layout
  type MobilePanel = 'files' | 'terminal' | 'panel';
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('terminal');
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load project from store
  const { fetchProjects, hasFetched } = useProjectStore();

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      if (!hasFetched) await fetchProjects();
      const proj = useProjectStore.getState().projects.find((p) => p.id === id) ?? null;
      setProject(proj);
      if ((proj as any)?.sound) setSoundConfig((proj as any).sound);
      setLoading(false);
    };
    void load();
  }, [id, hasFetched, fetchProjects]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </div>
    );
  }

  if (!project || !id) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <p className="text-muted-foreground">Project not found.</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <ProjectHeader
        project={project}
        projectId={id}
        showFileTree={showFileTree === 'true'}
        showShortcuts={showShortcuts === 'true'}
        onToggleFileTree={toggleFileTree}
        onToggleShortcuts={toggleShortcuts}
        onProjectUpdate={setProject}
      />

      {isMobile ? (
        /* Mobile: single column + bottom tab nav */
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 overflow-hidden min-h-0">
            {mobilePanel === 'files' && (
              <FileTree projectPath={project.folderPath} />
            )}
            {mobilePanel === 'terminal' && (
              <TerminalView
                ref={terminalViewRef}
                projectId={id}
                project={project}
                soundConfig={soundConfig}
                onStatusChange={(status) =>
                  setProject((prev) => (prev ? { ...prev, status: status as Project['status'] } : prev))
                }
              />
            )}
            {mobilePanel === 'panel' && (
              <RightPanel
                projectId={id}
                onSend={(text) => terminalViewRef.current?.sendTerminalInput(text)}
              />
            )}
          </div>

          {/* Bottom Tab Nav */}
          <div className="flex-shrink-0 flex border-t border-border bg-background">
            {([
              { id: 'files' as MobilePanel, icon: FolderOpen, label: '文件' },
              { id: 'terminal' as MobilePanel, icon: TerminalIcon, label: '终端' },
              { id: 'panel' as MobilePanel, icon: PanelRight, label: '面板' },
            ]).map(({ id: panelId, icon: Icon, label }) => (
              <button
                key={panelId}
                onClick={() => setMobilePanel(panelId)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors',
                  mobilePanel === panelId
                    ? 'text-blue-400'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Desktop: 3-column layout */
        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* Left: File tree */}
          <AnimatePresence initial={false}>
            {showFileTree === 'true' && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 224, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="flex-shrink-0 border-r border-border overflow-hidden"
              >
                <FileTree projectPath={project.folderPath} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Center: Terminal + Chat */}
          <TerminalView
            ref={terminalViewRef}
            projectId={id}
            project={project}
            soundConfig={soundConfig}
            onStatusChange={(status) =>
              setProject((prev) => (prev ? { ...prev, status: status as Project['status'] } : prev))
            }
          />

          {/* Right: Shortcuts / History tabs */}
          <AnimatePresence initial={false}>
            {showShortcuts === 'true' && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 208, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="flex-shrink-0 border-l border-border overflow-hidden"
              >
                <RightPanel
                  projectId={id}
                  onSend={(text) => terminalViewRef.current?.sendTerminalInput(text)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

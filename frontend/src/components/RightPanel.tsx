import { ShortcutPanel } from './ShortcutPanel';

interface RightPanelProps {
  projectId: string;
  onSend: (text: string) => void;
}

/**
 * RightPanel: shortcut command palette for the project.
 * Previously hosted a "history" tab backed by `.ccweb/sessions/` — that
 * subsystem has been removed; chat history now lives solely in the JSONL
 * file surfaced by the /chat-history endpoint and rendered in ChatOverlay.
 */
export function RightPanel({ projectId, onSend }: RightPanelProps) {
  return (
    <div className="h-full bg-background text-foreground overflow-hidden">
      <ShortcutPanel projectId={projectId} onSend={onSend} />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const LABEL_MAX = 100;
const COMMAND_MAX = 8000;

interface AgentPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialLabel: string;
  initialCommand: string;
  onSave: (label: string, command: string) => void;
}

/**
 * Modal editor for an Agent Prompt's label + command. Matches the visual style
 * of ShortcutEditorDialog: `modal={false}` + `noOverlay` so the user can click
 * out to dim the dialog (signalling "come back later") without losing focus of
 * the underlying project page.
 */
export function AgentPromptDialog({
  open,
  onOpenChange,
  title,
  initialLabel,
  initialCommand,
  onSave,
}: AgentPromptDialogProps) {
  const [label, setLabel] = useState(initialLabel);
  const [command, setCommand] = useState(initialCommand);
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => {
    if (open) {
      setLabel(initialLabel);
      setCommand(initialCommand);
      setIsFocused(true);
    }
  }, [open, initialLabel, initialCommand]);

  const labelTrim = label.trim();
  const commandTrim = command.trim();
  const labelOverflow = labelTrim.length > LABEL_MAX;
  const commandOverflow = commandTrim.length > COMMAND_MAX;
  const canSave = commandTrim.length > 0 && labelTrim.length > 0 && !labelOverflow && !commandOverflow;

  const handleSave = () => {
    if (!canSave) return;
    onSave(labelTrim, command);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        noOverlay
        className={cn(
          'sm:max-w-2xl max-h-[85vh] flex flex-col transition-opacity',
          !isFocused && 'opacity-50',
        )}
        onInteractOutside={(e) => { e.preventDefault(); setIsFocused(false); }}
        onClick={() => setIsFocused(true)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            This prompt can be clicked once in the sidebar to insert into CLAUDE.md, and clicked again to remove (by exact text match).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt-label">Label</Label>
              <span className={cn('text-xs text-muted-foreground', labelOverflow && 'text-red-500')}>
                {labelTrim.length} / {LABEL_MAX}
              </span>
            </div>
            <Input
              id="prompt-label"
              placeholder="A short name for this prompt"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="text-base"
              autoFocus
            />
          </div>
          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt-command">Prompt</Label>
              <span className={cn('text-xs text-muted-foreground', commandOverflow && 'text-red-500')}>
                {commandTrim.length} / {COMMAND_MAX}
              </span>
            </div>
            <textarea
              id="prompt-command"
              placeholder="The exact text that will be appended to CLAUDE.md..."
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className={cn(
                'flex-1 min-h-[200px] w-full rounded-md border border-input bg-background px-4 py-3',
                'text-sm leading-relaxed font-mono',
                'ring-offset-background placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'resize-none',
              )}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">⌘↩ to save</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!canSave}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

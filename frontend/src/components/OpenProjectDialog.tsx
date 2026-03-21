import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FileBrowser } from './FileBrowser';
import { openProject } from '@/lib/api';
import { Project } from '@/types';

interface OpenProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (project: Project) => void;
}

export function OpenProjectDialog({ open, onOpenChange, onOpened }: OpenProjectDialogProps) {
  const [folderPath, setFolderPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFolderPath('');
    setError(null);
    setLoading(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handleFolderSelect = async (path: string) => {
    setFolderPath(path);
    setLoading(true);
    setError(null);
    try {
      const project = await openProject(path);
      onOpened(project);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open project');
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open Existing Project</DialogTitle>
          <DialogDescription>
            Select a folder that contains a <code className="bg-muted px-1 rounded text-xs">.ccweb/</code> configuration.
            The project's history and settings will be restored.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Project Folder</Label>
          <FileBrowser onSelect={(path) => void handleFolderSelect(path)} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {folderPath && !error && loading && (
          <p className="text-sm text-muted-foreground">Opening project from {folderPath}...</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileBrowser } from './FileBrowser';
import { createProject } from '@/lib/api';
import { Project } from '@/types';

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
}

type Step = 'name' | 'folder' | 'permissions';

export function NewProjectDialog({ open, onOpenChange, onCreated }: NewProjectDialogProps) {
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [permissionMode, setPermissionMode] = useState<'limited' | 'unlimited'>('limited');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('name');
    setName('');
    setFolderPath('');
    setPermissionMode('limited');
    setError(null);
    setLoading(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handleNameNext = () => {
    if (!name.trim()) {
      setError('Please enter a project name');
      return;
    }
    setError(null);
    setStep('folder');
  };

  const handleFolderSelect = (path: string) => {
    setFolderPath(path);
    setStep('permissions');
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        folderPath,
        permissionMode,
      });
      onCreated(project);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const stepTitles: Record<Step, string> = {
    name: 'New Project — Name',
    folder: 'New Project — Select Folder',
    permissions: 'New Project — Permissions',
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>
            {step === 'name' && 'Give your project a name.'}
            {step === 'folder' && 'Choose the working directory for this project.'}
            {step === 'permissions' && 'Choose how Claude will run for this project.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-2 mb-2">
          {(['name', 'folder', 'permissions'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${
                step === s
                  ? 'bg-primary'
                  : ['name', 'folder', 'permissions'].indexOf(step) > i
                  ? 'bg-primary/40'
                  : 'bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Name */}
        {step === 'name' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                placeholder="My Claude Project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNameNext();
                }}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {/* Step 2: Folder */}
        {step === 'folder' && (
          <div className="space-y-2">
            <Label>Working Directory</Label>
            <FileBrowser onSelect={handleFolderSelect} />
          </div>
        )}

        {/* Step 3: Permissions */}
        {step === 'permissions' && (
          <div className="space-y-4">
            <div className="space-y-3">
              <Label>Permission Mode</Label>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border hover:bg-accent transition-colors">
                  <input
                    type="radio"
                    name="permissionMode"
                    value="limited"
                    checked={permissionMode === 'limited'}
                    onChange={() => setPermissionMode('limited')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">Limited</div>
                    <div className="text-xs text-muted-foreground">
                      Runs <code className="bg-muted px-1 rounded">claude</code> — Claude will ask
                      for permission before making file changes or running commands.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border hover:bg-accent transition-colors">
                  <input
                    type="radio"
                    name="permissionMode"
                    value="unlimited"
                    checked={permissionMode === 'unlimited'}
                    onChange={() => setPermissionMode('unlimited')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">Unlimited</div>
                    <div className="text-xs text-muted-foreground">
                      Runs{' '}
                      <code className="bg-muted px-1 rounded">
                        claude --dangerously-skip-permissions
                      </code>{' '}
                      — Claude will act autonomously without asking for permission.
                    </div>
                  </div>
                </label>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">Folder:</span>{' '}
              <span className="font-mono text-xs">{folderPath}</span>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {step !== 'name' && (
            <Button
              variant="outline"
              onClick={() => setStep(step === 'permissions' ? 'folder' : 'name')}
              disabled={loading}
            >
              Back
            </Button>
          )}
          {step === 'name' && (
            <Button onClick={handleNameNext}>Next</Button>
          )}
          {step === 'folder' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          {step === 'permissions' && (
            <Button onClick={() => void handleSubmit()} disabled={loading}>
              {loading ? 'Creating...' : 'Create Project'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Project, CliTool } from '@/types';

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
}

type Step = 'name' | 'folder' | 'settings';

const CLI_TOOLS: { value: CliTool; label: string; desc: string }[] = [
  { value: 'claude',    label: 'Claude',    desc: 'Anthropic Claude Code CLI' },
  { value: 'opencode',  label: 'OpenCode',  desc: 'OpenCode CLI (sst/opencode)' },
  { value: 'codex',     label: 'Codex',     desc: 'OpenAI Codex CLI' },
  { value: 'qwen',      label: 'Qwen',      desc: 'Qwen Code CLI (QwenLM)' },
];

const PERMISSION_DESC: Record<CliTool, { limited: string; unlimited: string }> = {
  claude: {
    limited:   'claude',
    unlimited: 'claude --dangerously-skip-permissions',
  },
  opencode: {
    limited:   'opencode',
    unlimited: 'opencode --dangerously-skip-permissions',
  },
  codex: {
    limited:   'codex',
    unlimited: 'codex --ask-for-approval never --sandbox danger-full-access',
  },
  qwen: {
    limited:   'qwen-code',
    unlimited: 'qwen-code --yolo',
  },
};

export function NewProjectDialog({ open, onOpenChange, onCreated }: NewProjectDialogProps) {
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [cliTool, setCliTool] = useState<CliTool>('claude');
  const [permissionMode, setPermissionMode] = useState<'limited' | 'unlimited'>('limited');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('name');
    setName('');
    setFolderPath('');
    setCliTool('claude');
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
    setStep('settings');
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        folderPath,
        permissionMode,
        cliTool,
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
    settings: 'New Project — Settings',
  };

  const steps: Step[] = ['name', 'folder', 'settings'];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>
            {step === 'name' && 'Give your project a name.'}
            {step === 'folder' && 'Choose the working directory for this project.'}
            {step === 'settings' && 'Choose the AI coding tool and run mode.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-2 mb-2">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${
                step === s ? 'bg-primary' : steps.indexOf(step) > i ? 'bg-primary/40' : 'bg-muted'
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
                placeholder="My Project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNameNext(); }}
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

        {/* Step 3: Settings */}
        {step === 'settings' && (
          <div className="space-y-5">
            {/* CLI Tool */}
            <div className="space-y-2">
              <Label>AI Coding Tool</Label>
              <div className="grid grid-cols-2 gap-2">
                {CLI_TOOLS.map((tool) => (
                  <label
                    key={tool.value}
                    className={`flex items-center gap-2.5 cursor-pointer p-3 rounded-md border transition-colors ${
                      cliTool === tool.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-accent'
                    }`}
                  >
                    <input
                      type="radio"
                      name="cliTool"
                      value={tool.value}
                      checked={cliTool === tool.value}
                      onChange={() => setCliTool(tool.value)}
                      className="accent-primary"
                    />
                    <div>
                      <div className="font-medium text-sm">{tool.label}</div>
                      <div className="text-xs text-muted-foreground">{tool.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Permission Mode */}
            <div className="space-y-2">
              <Label>Permission Mode</Label>
              <div className="space-y-2">
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
                      Runs <code className="bg-muted px-1 rounded">{PERMISSION_DESC[cliTool].limited}</code> — asks for permission before file changes.
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
                      Runs <code className="bg-muted px-1 rounded">{PERMISSION_DESC[cliTool].unlimited}</code> — acts autonomously.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Folder:</span>{' '}
              <span className="font-mono">{folderPath}</span>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {step !== 'name' && (
            <Button
              variant="outline"
              onClick={() => setStep(step === 'settings' ? 'folder' : 'name')}
              disabled={loading}
            >
              Back
            </Button>
          )}
          {step === 'name' && <Button onClick={handleNameNext}>Next</Button>}
          {step === 'folder' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {step === 'settings' && (
            <Button onClick={() => void handleSubmit()} disabled={loading}>
              {loading ? 'Creating...' : 'Create Project'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

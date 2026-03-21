import { useState } from 'react';
import { Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  checkRunningProjects,
  prepareForUpdate,
  type RunningProjectInfo,
  type ProjectUpdateResult,
} from '@/lib/api';

const GITHUB_REPO = 'zbc0315/cc-web';
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

type Stage =
  | 'idle'
  | 'checking'        // checking GitHub for new release
  | 'no_update'       // already on latest
  | 'update_available' // new version found
  | 'confirm_prepare' // asking user to confirm saving project memory
  | 'preparing'       // sending save commands to running projects
  | 'prepared'        // all projects stopped, ready to download
  | 'error';

interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  dmgUrl: string | null;
}

export function UpdateButton() {
  const [stage, setStage] = useState<Stage>('idle');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [runningProjects, setRunningProjects] = useState<RunningProjectInfo[]>([]);
  const [prepareResults, setPrepareResults] = useState<ProjectUpdateResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const currentVersion = 'v1.0.0'; // match package.json version

  const handleCheckUpdate = async () => {
    setStage('checking');
    setError(null);
    setDialogOpen(true);

    try {
      // Fetch latest release from GitHub API
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
      );

      if (res.status === 404) {
        setStage('no_update');
        return;
      }

      if (!res.ok) {
        throw new Error(`GitHub API returned ${res.status}`);
      }

      const data = await res.json();
      const latestTag = data.tag_name as string;

      // Compare versions (strip 'v' prefix)
      const latest = latestTag.replace(/^v/, '');
      const current = currentVersion.replace(/^v/, '');
      if (latest <= current) {
        setStage('no_update');
        return;
      }

      // Find DMG asset
      const assets = (data.assets || []) as { name: string; browser_download_url: string }[];
      const dmgAsset = assets.find((a) => a.name.endsWith('.dmg'));

      setRelease({
        tag: latestTag,
        name: data.name || latestTag,
        url: data.html_url,
        dmgUrl: dmgAsset?.browser_download_url || null,
      });

      // Check for running projects
      const running = await checkRunningProjects();
      setRunningProjects(running.projects);

      if (running.runningCount > 0) {
        setStage('confirm_prepare');
      } else {
        setStage('update_available');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
      setStage('error');
    }
  };

  const handlePrepare = async () => {
    setStage('preparing');
    setError(null);

    try {
      const result = await prepareForUpdate();
      setPrepareResults(result.results);
      setStage('prepared');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare for update');
      setStage('error');
    }
  };

  const handleDownload = () => {
    const url = release?.dmgUrl || release?.url || GITHUB_RELEASES_URL;
    window.open(url, '_blank');
  };

  const handleClose = () => {
    setDialogOpen(false);
    // Reset state after close animation
    setTimeout(() => {
      setStage('idle');
      setRelease(null);
      setRunningProjects([]);
      setPrepareResults([]);
      setError(null);
    }, 200);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void handleCheckUpdate()}
        disabled={stage === 'checking' || stage === 'preparing'}
      >
        {stage === 'checking' || stage === 'preparing' ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Download className="h-4 w-4 mr-2" />
        )}
        Update
      </Button>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {stage === 'checking' && 'Checking for updates...'}
              {stage === 'no_update' && 'Up to date'}
              {stage === 'update_available' && 'Update available'}
              {stage === 'confirm_prepare' && 'Save project memory first'}
              {stage === 'preparing' && 'Saving project memory...'}
              {stage === 'prepared' && 'Ready to update'}
              {stage === 'error' && 'Update error'}
            </DialogTitle>
            <DialogDescription>
              {stage === 'checking' && 'Fetching the latest release from GitHub...'}
              {stage === 'no_update' && `Current version ${currentVersion} is the latest.`}
              {stage === 'update_available' && `New version ${release?.tag} is available.`}
              {stage === 'confirm_prepare' && (
                <>
                  {runningProjects.length} project(s) are currently running.
                  Before updating, each project's Claude will be asked to save its memory,
                  then all terminals will be stopped.
                </>
              )}
              {stage === 'preparing' && 'Sending memory save commands and waiting for Claude to finish...'}
              {stage === 'prepared' && 'All projects have been saved and stopped. You can now download the update.'}
              {stage === 'error' && (error || 'An unknown error occurred.')}
            </DialogDescription>
          </DialogHeader>

          {/* Running projects list */}
          {stage === 'confirm_prepare' && runningProjects.length > 0 && (
            <div className="space-y-1 text-sm">
              {runningProjects.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted">
                  <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                  <span className="truncate">{p.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Preparing spinner */}
          {stage === 'preparing' && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Prepare results */}
          {stage === 'prepared' && prepareResults.length > 0 && (
            <div className="space-y-1 text-sm">
              {prepareResults.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted">
                  {r.status === 'stopped' ? (
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
                  )}
                  <span className="truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {r.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            {stage === 'no_update' && (
              <Button onClick={handleClose}>OK</Button>
            )}
            {stage === 'update_available' && (
              <>
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleDownload}>Download {release?.tag}</Button>
              </>
            )}
            {stage === 'confirm_prepare' && (
              <>
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={() => void handlePrepare()}>
                  Save Memory & Stop All
                </Button>
              </>
            )}
            {stage === 'prepared' && (
              <>
                <Button variant="outline" onClick={handleClose}>Close</Button>
                <Button onClick={handleDownload}>Download {release?.tag}</Button>
              </>
            )}
            {stage === 'error' && (
              <Button onClick={handleClose}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

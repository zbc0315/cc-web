import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2 } from 'lucide-react';
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
  checkVersion,
  executeUpdate,
  getUpdateStatus,
} from '@/lib/api';

export const currentVersion = 'v2026.4.19-e'; // match package.json version

// Electron updater API exposed via preload
interface ElectronUpdater {
  checkForUpdate: () => Promise<{ available: boolean; version?: string; error?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  quitAndInstall: (zipPath?: string) => void;
  onUpdateStatus: (cb: (status: { type: string; info?: unknown }) => void) => () => void;
}

declare global {
  interface Window {
    electronUpdater?: ElectronUpdater;
  }
}

const isElectron = !!window.electronUpdater;

type Stage =
  | 'idle'
  | 'checking'
  | 'no_update'
  | 'update_available'
  | 'downloading'
  | 'downloaded'
  | 'executing'
  | 'reconnecting'
  | 'update_complete'
  | 'update_failed'
  | 'error';

export function UpdateButton() {
  const [stage, setStage] = useState<Stage>('idle');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloadedZipPath, setDownloadedZipPath] = useState<string | null>(null);

  // Listen for Electron updater status events
  useEffect(() => {
    if (!window.electronUpdater) return;
    const unsub = window.electronUpdater.onUpdateStatus((status) => {
      switch (status.type) {
        case 'progress': {
          const p = status.info as { percent?: number };
          setDownloadPercent(Math.round(p?.percent ?? 0));
          break;
        }
        case 'downloaded':
          setStage('downloaded');
          break;
        case 'error':
          setError(status.info as string || 'Download failed');
          setStage('error');
          break;
      }
    });
    return unsub;
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setStage('checking');
    setError(null);
    setDialogOpen(true);

    try {
      if (isElectron) {
        // Use Electron auto-updater
        const result = await window.electronUpdater!.checkForUpdate();
        if (result.error) throw new Error(result.error);
        if (!result.available) {
          setStage('no_update');
          return;
        }
        setNewVersion(result.version ? `v${result.version}` : 'new version');
      } else {
        // Check via backend (queries npm registry server-side)
        const versionInfo = await checkVersion();
        if (!versionInfo.updateAvailable) {
          setStage('no_update');
          return;
        }
        setNewVersion(`v${versionInfo.latest}`);
      }

      setStage('update_available');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed');
      setStage('error');
    }
  }, []);

  const handleDownload = async () => {
    if (isElectron) {
      setStage('downloading');
      setDownloadPercent(0);
      const result = await window.electronUpdater!.downloadUpdate() as { success: boolean; error?: string; path?: string };
      if (!result.success) {
        setError(result.error || 'Download failed');
        setStage('error');
      } else if (result.path) {
        setDownloadedZipPath(result.path);
      }
      // 'downloaded' stage is set by the onUpdateStatus listener
    } else {
      // Browser mode: trigger remote self-update
      setStage('executing');
      try {
        await executeUpdate();
        // Server will shut down — start polling for reconnect
        setStage('reconnecting');
        pollForReconnect();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Execute failed');
        setStage('error');
      }
    }
  };

  const pollForReconnect = useCallback(() => {
    const POLL_INTERVAL = 3000;
    const TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();

    const poll = () => {
      if (Date.now() - startTime > TIMEOUT) {
        setError('更新超时（5 分钟）— 请检查服务器状态');
        setStage('update_failed');
        return;
      }
      getUpdateStatus()
        .then((status) => {
          if (!status) {
            // Server is up but no status yet — keep polling
            setTimeout(poll, POLL_INTERVAL);
            return;
          }
          if (status.success) {
            setNewVersion(status.newVersion ? `v${status.newVersion}` : 'new version');
            setStage('update_complete');
          } else {
            setError(status.error || 'Update failed');
            setStage('update_failed');
          }
        })
        .catch(() => {
          // Server still down — keep polling
          setTimeout(poll, POLL_INTERVAL);
        });
    };

    setTimeout(poll, POLL_INTERVAL);
  }, []);

  const handleInstall = () => {
    window.electronUpdater?.quitAndInstall(downloadedZipPath || undefined);
  };

  const handleClose = () => {
    setDialogOpen(false);
    setTimeout(() => {
      setStage('idle');
      setNewVersion('');
      setError(null);
      setDownloadPercent(0);
      setDownloadedZipPath(null);
    }, 200);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => void handleCheckUpdate()}
        disabled={stage === 'checking' || stage === 'downloading' || stage === 'executing' || stage === 'reconnecting'}
        title="检查更新"
      >
        {(stage === 'checking' || stage === 'downloading' || stage === 'executing' || stage === 'reconnecting') ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {stage === 'checking' && 'Checking for updates...'}
              {stage === 'no_update' && 'Up to date'}
              {stage === 'update_available' && `Update ${newVersion} available`}
              {stage === 'downloading' && 'Downloading update...'}
              {stage === 'downloaded' && 'Update ready to install'}
              {stage === 'executing' && 'Updating server...'}
              {stage === 'reconnecting' && 'Waiting for server restart...'}
              {stage === 'update_complete' && `Updated to ${newVersion}`}
              {stage === 'update_failed' && 'Update failed'}
              {stage === 'error' && 'Update error'}
            </DialogTitle>
            <DialogDescription>
              {stage === 'checking' && 'Checking for the latest version...'}
              {stage === 'no_update' && `Current version ${currentVersion} is the latest.`}
              {stage === 'update_available' && `A new version is available. ${isElectron ? 'Click download to update automatically.' : ''}`}
              {stage === 'downloading' && `Downloading... ${downloadPercent}%`}
              {stage === 'downloaded' && 'The update has been downloaded. Click install to restart and apply.'}
              {stage === 'executing' && 'Server is shutting down and installing the update. Please wait...'}
              {stage === 'reconnecting' && 'Update installed. Waiting for server to restart...'}
              {stage === 'update_complete' && `Successfully updated from ${currentVersion} to ${newVersion}. Click reload to use the new version.`}
              {stage === 'update_failed' && (error || 'Update failed. You may need to restart the server manually.')}
              {stage === 'error' && (error || 'An error occurred.')}
            </DialogDescription>
          </DialogHeader>

          {/* Progress bar for download */}
          {stage === 'downloading' && (
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
          )}

          {/* Executing / reconnecting spinner */}
          {(stage === 'executing' || stage === 'reconnecting') && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          <DialogFooter>
            {stage === 'no_update' && (
              <Button onClick={handleClose}>OK</Button>
            )}
            {stage === 'update_available' && (
              <>
                <Button variant="outline" onClick={handleClose}>Later</Button>
                <Button onClick={() => void handleDownload()}>
                  {isElectron ? 'Download & Install' : `Update to ${newVersion}`}
                </Button>
              </>
            )}
            {stage === 'downloaded' && (
              <>
                <Button variant="outline" onClick={handleClose}>Later</Button>
                <Button onClick={handleInstall}>Restart & Install</Button>
              </>
            )}
            {stage === 'update_complete' && (
              <Button onClick={() => window.location.reload()}>Reload Page</Button>
            )}
            {stage === 'update_failed' && (
              <Button onClick={handleClose}>Close</Button>
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

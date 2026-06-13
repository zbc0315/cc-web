import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FolderSync, Loader2, Save, RefreshCw, X, Cloud, CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  getProjectSyncSettings, updateProjectSyncSettings, syncProjectOnce, cancelSyncProject,
  type ProjectSyncSettings,
} from '@/lib/api';
import { useProjectStore } from '@/lib/stores';
import { useSyncEvents } from '@/lib/websocket';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

function relTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(ms).toLocaleString();
}

export function ProjectSettingsPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === id));

  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [settings, setSettings] = useState<ProjectSyncSettings | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [excludesText, setExcludesText] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncFiles, setSyncFiles] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const s = await getProjectSyncSettings(id);
      setSettings(s);
      setPathInput(s.path);
      setExcludesText(s.excludes.join('\n'));
      setState('ready');
    } catch (err) {
      // request() redirects on 401; here a thrown error is most likely 403
      // (non-owner) or a network failure. Treat both as a friendly block.
      setState(err instanceof Error && /forbidden/i.test(err.message) ? 'forbidden' : 'error');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Live rsync progress for THIS project (dashboard WS broadcasts all of the
  // user's syncs — filter by id).
  useSyncEvents({
    onStart: (e) => { if (e.projectId === id) { setSyncing(true); setSyncFiles(0); } },
    onProgress: (e) => { if (e.projectId === id) setSyncFiles(e.filesTransferred); },
    onDone: (e) => { if (e.projectId === id) { setSyncing(false); setSyncFiles(0); void load(); } },
  });

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const excludes = excludesText.split('\n').map((s) => s.trim()).filter(Boolean);
      const s = await updateProjectSyncSettings(id, { path: pathInput.trim(), excludes });
      setSettings(s);
      setPathInput(s.path);
      setExcludesText(s.excludes.join('\n'));
      toast.success(t('projsync.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('projsync.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSyncNow = async () => {
    if (!id) return;
    setSyncing(true);
    try {
      const r = await syncProjectOnce(id);
      if (r.ok) toast.success(t('projsync.sync_done', { files: r.filesTransferred }));
      else toast.error(t('projsync.sync_failed_reason', { reason: r.reason ?? '' }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('projsync.sync_failed'));
    } finally {
      setSyncing(false);
      void load();
    }
  };

  const handleCancel = async () => {
    if (!id) return;
    try { await cancelSyncProject(id); } catch { /* ignore */ }
  };

  const title = project?.name ?? id ?? '';

  const Header = (
    <header className="border-b sticky top-0 bg-background z-10">
      <div className="w-full px-4 sm:px-6 h-14 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t('projsync.back')}
        </Button>
        <div className="flex items-center gap-2 min-w-0">
          <FolderSync className="h-5 w-5 shrink-0" />
          <span className="font-semibold text-lg truncate">{title}</span>
          <span className="text-muted-foreground text-sm shrink-0">· {t('projsync.title')}</span>
        </div>
      </div>
    </header>
  );

  if (state === 'loading') return <div className="min-h-screen bg-background">{Header}</div>;

  if (state === 'forbidden' || state === 'error') {
    return (
      <div className="min-h-screen bg-background">
        {Header}
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <CloudOff className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">
            {state === 'forbidden' ? t('projsync.forbidden') : t('projsync.load_error')}
          </p>
        </div>
      </div>
    );
  }

  const s = settings!;
  const hasPath = !!s.path;

  return (
    <div className="min-h-screen bg-background">
      {Header}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Connection warning */}
        {!s.connectionReady && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            {t('projsync.no_connection')}{' '}
            <button className="underline hover:text-foreground" onClick={() => navigate('/settings')}>
              {t('projsync.go_global')}
            </button>
          </div>
        )}

        {/* Remote path */}
        <section className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Cloud className="h-4 w-4 text-muted-foreground" />
            {t('projsync.remote_path')}
          </label>
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="/home/user/backups/my-project"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">{t('projsync.remote_path_hint')}</p>
        </section>

        {/* Excludes */}
        <section className="space-y-2">
          <label className="text-sm font-medium">{t('projsync.excludes')}</label>
          <Textarea
            value={excludesText}
            onChange={(e) => setExcludesText(e.target.value)}
            placeholder={'*.log\ntmp/'}
            rows={4}
            spellCheck={false}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">{t('projsync.excludes_hint')}</p>
        </section>

        <div className="flex items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {t('projsync.save')}
          </Button>
        </div>

        {/* Status + run */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('projsync.status')}</span>
            <span className={cn('font-medium', s.dirty ? 'text-amber-500' : hasPath ? 'text-green-500' : 'text-muted-foreground')}>
              {!hasPath ? t('projsync.not_configured')
                : s.dirty ? t('projsync.dirty')
                : t('projsync.synced')}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('projsync.last_sync')}</span>
            <span>{s.lastSyncAt ? relTime(s.lastSyncAt) : t('projsync.never')}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('projsync.direction')}</span>
            <span className="capitalize">{s.direction}</span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {syncing ? (
              <Button variant="outline" size="sm" onClick={() => void handleCancel()}>
                <X className="h-4 w-4 mr-1" />
                {t('projsync.cancel')}{syncFiles > 0 ? ` (${syncFiles})` : ''}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void handleSyncNow()}
                disabled={!hasPath || !s.connectionReady}
                title={!hasPath ? t('projsync.set_path_first') : undefined}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {t('projsync.sync_now')}
              </Button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

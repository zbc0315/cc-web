import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save, Upload, Download, Plug, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  getSyncConfig, updateSyncConfig, testSyncConnection, syncAll,
  cancelSyncAll,
  type SyncConfigPublic, type SyncDirection, type SyncAuthMethod,
} from '@/lib/api';
import { useSyncEvents } from '@/lib/websocket';

const PASSWORD_KEEP = '__keep__';

export function SyncSection() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<SyncConfigPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  // Live progress during the bulk sync action: which project is currently
  // rsync'ing and how many files have moved so far. Reset on each new start event.
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentFiles, setCurrentFiles] = useState(0);

  const [pwInput, setPwInput] = useState(''); // empty → keep existing; value → set
  const [excludesText, setExcludesText] = useState('');

  useSyncEvents({
    onStart: (e) => {
      setCurrentProjectId(e.projectId);
      setCurrentFiles(0);
    },
    onProgress: (e) => {
      setCurrentProjectId(e.projectId);
      setCurrentFiles(e.filesTransferred);
    },
    onDone: () => {
      setCurrentProjectId(null);
      setCurrentFiles(0);
    },
  });

  useEffect(() => {
    let cancelled = false;
    getSyncConfig()
      .then((c) => {
        if (cancelled) return;
        setCfg(c);
        setExcludesText(c.defaultExcludes.join('\n'));
      })
      .catch((err: Error) => toast.error(t('sync_section.load_failed', { message: err.message })))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  const patch = <K extends keyof SyncConfigPublic>(key: K, val: SyncConfigPublic[K]) => {
    setCfg((prev) => prev ? { ...prev, [key]: val } : prev);
  };

  const handleSave = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const excludes = excludesText.split('\n').map((s) => s.trim()).filter(Boolean);
      const body: Parameters<typeof updateSyncConfig>[0] = {
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        authMethod: cfg.authMethod,
        keyPath: cfg.keyPath,
        remoteRoot: cfg.remoteRoot,
        direction: cfg.direction,
        defaultExcludes: excludes,
        schedule: cfg.schedule,
      };
      if (pwInput && pwInput !== PASSWORD_KEEP) body.password = pwInput;
      const next = await updateSyncConfig(body);
      setCfg(next);
      setExcludesText(next.defaultExcludes.join('\n'));
      setPwInput('');
      toast.success(t('sync_section.saved'));
    } catch (err) {
      toast.error(t('sync_section.save_failed', { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await testSyncConnection();
      if (r.ok) toast.success(r.message || t('sync_section.test_ok'));
      else toast.error(r.message || t('sync_section.test_failed'));
    } catch (err) {
      toast.error(t('sync_section.test_failed_with_reason', { message: (err as Error).message }));
    } finally {
      setTesting(false);
    }
  };

  const handleBulk = async (which: 'all-default') => {
    setBulk(true);
    try {
      const r = await syncAll();
      const ok = r.results.filter((x) => x.ok).length;
      const skipped = r.results.filter((x) => x.skipped).length;
      const cancelled = r.results.filter((x) => x.reason === 'cancelled').length;
      const failed = r.total - ok - skipped - cancelled;
      if (cancelled > 0) {
        toast.info(t('sync_section.bulk_cancelled_toast', { ok, skipped, cancelled, failed }));
      } else {
        toast.success(t('sync_section.bulk_done_toast', { ok, skipped, failed }));
      }
    } catch (err) {
      toast.error(t('sync_section.bulk_failed_toast', { message: (err as Error).message }));
    } finally {
      setBulk(false);
      setBulkCancelling(false);
      setCurrentProjectId(null);
      setCurrentFiles(0);
    }
    void which;
  };

  const handleBulkCancel = async () => {
    if (!bulk || bulkCancelling) return;
    setBulkCancelling(true);
    try {
      await cancelSyncAll();
      toast.info(t('sync_section.cancel_requested'));
    } catch (err) {
      toast.error(t('sync_section.cancel_failed', { message: (err as Error).message }));
      setBulkCancelling(false);
    }
  };

  if (loading || !cfg) {
    return <div className="text-sm text-muted-foreground">{t('sync_section.loading')}</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-3">{t('sync_section.server_section')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sync-host">{t('sync_section.host')}</Label>
            <Input id="sync-host" value={cfg.host} onChange={(e) => patch('host', e.target.value)} placeholder="example.com" />
          </div>
          <div>
            <Label htmlFor="sync-port">{t('sync_section.port')}</Label>
            <Input id="sync-port" type="number" value={cfg.port} onChange={(e) => patch('port', Number(e.target.value) || 22)} />
          </div>
          <div>
            <Label htmlFor="sync-user">{t('sync_section.user')}</Label>
            <Input id="sync-user" value={cfg.user} onChange={(e) => patch('user', e.target.value)} placeholder="tom" />
          </div>
          <div>
            <Label htmlFor="sync-remote">{t('sync_section.remote_root')}</Label>
            <Input
              id="sync-remote"
              value={cfg.remoteRoot}
              onChange={(e) => patch('remoteRoot', e.target.value)}
              placeholder="/data/projects"
            />
            <p
              className="text-xs text-muted-foreground mt-1"
              // XSS-safe: source is static locale JSON (no user input) — escapeValue intentionally bypassed to render the embedded <code> tag.
              dangerouslySetInnerHTML={{ __html: t('sync_section.remote_root_hint') }}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">{t('sync_section.auth_section')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>{t('sync_section.auth_method')}</Label>
            <Select value={cfg.authMethod} onValueChange={(v) => patch('authMethod', v as SyncAuthMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="key">SSH key</SelectItem>
                <SelectItem value="password">{t('sync_section.auth_password')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cfg.authMethod === 'key' ? (
            <div>
              <Label htmlFor="sync-key">{t('sync_section.key_path')}</Label>
              <Input
                id="sync-key"
                value={cfg.keyPath ?? ''}
                onChange={(e) => patch('keyPath', e.target.value)}
                placeholder="~/.ssh/id_rsa"
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="sync-pw">{t('sync_section.password')}</Label>
              <Input
                id="sync-pw"
                type="password"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                placeholder={cfg.passwordSet ? t('sync_section.password_set_placeholder') : t('sync_section.password_unset_placeholder')}
              />
              <p
                className="text-xs text-muted-foreground mt-1"
                // XSS-safe: source is static locale JSON (no user input) — escapeValue intentionally bypassed to render the embedded <code> tag.
                dangerouslySetInnerHTML={{ __html: t('sync_section.sshpass_hint') }}
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">{t('sync_section.strategy_section')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>{t('sync_section.direction')}</Label>
            <Select value={cfg.direction} onValueChange={(v) => patch('direction', v as SyncDirection)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="push">{t('sync_section.push_label')}</SelectItem>
                <SelectItem value="pull">{t('sync_section.pull_label')}</SelectItem>
                <SelectItem value="bidirectional">{t('sync_section.bidirectional_label')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="sync-cron">{t('sync_section.cron_label')}</Label>
              <Input
                id="sync-cron"
                value={cfg.schedule.cron}
                onChange={(e) => patch('schedule', { ...cfg.schedule, cron: e.target.value })}
                placeholder="0 3 * * *"
              />
              <p
                className="text-xs text-muted-foreground mt-1"
                // XSS-safe: source is static locale JSON (no user input) — escapeValue intentionally bypassed to render the embedded <code> tag.
                dangerouslySetInnerHTML={{ __html: t('sync_section.cron_hint') }}
              />
            </div>
            <div className="flex items-center gap-2 pb-1.5">
              <Switch
                checked={cfg.schedule.enabled}
                onCheckedChange={(b) => patch('schedule', { ...cfg.schedule, enabled: b })}
              />
              <span className="text-xs text-muted-foreground">{t('sync_section.enable_label')}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">{t('sync_section.exclude_section')}</h3>
        <textarea
          value={excludesText}
          onChange={(e) => setExcludesText(e.target.value)}
          rows={6}
          className="w-full font-mono text-xs p-2 rounded border border-input bg-background resize-y"
          placeholder={'node_modules/\n.git/objects/\n*.log'}
        />
        <p
          className="text-xs text-muted-foreground mt-1"
          // XSS-safe: source is static locale JSON (no user input) — escapeValue intentionally bypassed to render the embedded <code> tag.
          dangerouslySetInnerHTML={{ __html: t('sync_section.exclude_hint') }}
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          {t('sync_section.save_button')}
        </Button>
        <Button variant="outline" onClick={() => void handleTest()} disabled={testing}>
          {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plug className="h-3.5 w-3.5 mr-1.5" />}
          {t('sync_section.test_button')}
        </Button>
        <div className="flex-1" />
        {bulk && currentProjectId && (
          <span className="text-xs text-muted-foreground self-center mr-1 tabular-nums">
            {currentFiles > 0
              ? t('sync_section.syncing_with_files', { project: currentProjectId, files: currentFiles })
              : t('sync_section.syncing_no_files', { project: currentProjectId })}
          </span>
        )}
        <Button variant="outline" onClick={() => void handleBulk('all-default')} disabled={bulk} title={t('sync_section.sync_all_title')}>
          {bulk ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          {t('sync_section.sync_all_button')}
        </Button>
        {bulk && (
          <Button
            variant="outline"
            onClick={() => void handleBulkCancel()}
            disabled={bulkCancelling}
            title={t('sync_section.cancel_button_title')}
          >
            {bulkCancelling ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <X className="h-3.5 w-3.5 mr-1.5" />}
            {t('sync_section.cancel_button')}
          </Button>
        )}
      </div>

      <div className="border-t pt-4 text-xs text-muted-foreground">
        {/* Hint text — kept inline for the embedded icons; covered by sync_section.footer_hint key for future markdown variant. */}
        Per-project push/pull: from inside a project, click the <Upload className="inline h-3 w-3" /> / <Download className="inline h-3 w-3" /> buttons in the header.
        Or call <code>POST /api/sync/project/:id</code> with body <code>{'{ "direction": "push" }'}</code>.
      </div>
    </div>
  );
}

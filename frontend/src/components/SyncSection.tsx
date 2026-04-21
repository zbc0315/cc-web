import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save, Upload, Download, Plug, X } from 'lucide-react';
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
  const [cfg, setCfg] = useState<SyncConfigPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  // Live progress during "立即同步全部": which project is currently rsync'ing
  // and how many files have moved so far. Reset on each new start event.
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
      .catch((err: Error) => toast.error(`加载同步配置失败: ${err.message}`))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
      toast.success('已保存');
    } catch (err) {
      toast.error(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await testSyncConnection();
      if (r.ok) toast.success(r.message || '连接成功');
      else toast.error(r.message || '连接失败');
    } catch (err) {
      toast.error(`测试失败: ${(err as Error).message}`);
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
        toast.info(`已取消：${ok} 成功 / ${skipped} 跳过 / ${cancelled} 取消 / ${failed} 失败`);
      } else {
        toast.success(`同步完成：${ok} 成功 / ${skipped} 跳过 / ${failed} 失败`);
      }
    } catch (err) {
      toast.error(`同步失败: ${(err as Error).message}`);
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
      toast.info('已请求取消');
    } catch (err) {
      toast.error(`取消失败: ${(err as Error).message}`);
      setBulkCancelling(false);
    }
  };

  if (loading || !cfg) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3">服务器配置</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sync-host">主机 (host)</Label>
            <Input id="sync-host" value={cfg.host} onChange={(e) => patch('host', e.target.value)} placeholder="example.com" />
          </div>
          <div>
            <Label htmlFor="sync-port">端口</Label>
            <Input id="sync-port" type="number" value={cfg.port} onChange={(e) => patch('port', Number(e.target.value) || 22)} />
          </div>
          <div>
            <Label htmlFor="sync-user">用户名</Label>
            <Input id="sync-user" value={cfg.user} onChange={(e) => patch('user', e.target.value)} placeholder="tom" />
          </div>
          <div>
            <Label htmlFor="sync-remote">远端根路径</Label>
            <Input
              id="sync-remote"
              value={cfg.remoteRoot}
              onChange={(e) => patch('remoteRoot', e.target.value)}
              placeholder="/data/projects"
            />
            <p className="text-xs text-muted-foreground mt-1">每个项目会同步到 <code>远端路径/项目文件夹</code></p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">认证</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>方式</Label>
            <Select value={cfg.authMethod} onValueChange={(v) => patch('authMethod', v as SyncAuthMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="key">SSH key</SelectItem>
                <SelectItem value="password">密码</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cfg.authMethod === 'key' ? (
            <div>
              <Label htmlFor="sync-key">私钥路径</Label>
              <Input
                id="sync-key"
                value={cfg.keyPath ?? ''}
                onChange={(e) => patch('keyPath', e.target.value)}
                placeholder="~/.ssh/id_rsa"
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="sync-pw">密码</Label>
              <Input
                id="sync-pw"
                type="password"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                placeholder={cfg.passwordSet ? '已设置，留空保持不变' : '未设置'}
              />
              <p className="text-xs text-muted-foreground mt-1">
                需要系统安装 <code>sshpass</code>（密码通过 SSHPASS env 传递，不会出现在 argv 里）
              </p>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">同步策略</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>方向</Label>
            <Select value={cfg.direction} onValueChange={(v) => patch('direction', v as SyncDirection)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="push">单向：本地 → 远端（--delete）</SelectItem>
                <SelectItem value="pull">单向：远端 → 本地</SelectItem>
                <SelectItem value="bidirectional">双向（先 push 再 pull）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="sync-cron">定时 cron 表达式</Label>
              <Input
                id="sync-cron"
                value={cfg.schedule.cron}
                onChange={(e) => patch('schedule', { ...cfg.schedule, cron: e.target.value })}
                placeholder="0 3 * * *"
              />
              <p className="text-xs text-muted-foreground mt-1">5 段：分 时 日 月 周。例：<code>0 3 * * *</code> 每天 03:00</p>
            </div>
            <div className="flex items-center gap-2 pb-1.5">
              <Switch
                checked={cfg.schedule.enabled}
                onCheckedChange={(b) => patch('schedule', { ...cfg.schedule, enabled: b })}
              />
              <span className="text-xs text-muted-foreground">启用</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">默认排除（每行一个 glob）</h3>
        <textarea
          value={excludesText}
          onChange={(e) => setExcludesText(e.target.value)}
          rows={6}
          className="w-full font-mono text-xs p-2 rounded border border-input bg-background resize-y"
          placeholder={'node_modules/\n.git/objects/\n*.log'}
        />
        <p className="text-xs text-muted-foreground mt-1">
          作为 <code>rsync --exclude</code> 传入。项目级的额外排除暂通过 API 设置。
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          保存
        </Button>
        <Button variant="outline" onClick={() => void handleTest()} disabled={testing}>
          {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plug className="h-3.5 w-3.5 mr-1.5" />}
          测试连接
        </Button>
        <div className="flex-1" />
        {bulk && currentProjectId && (
          <span className="text-xs text-muted-foreground self-center mr-1 tabular-nums">
            {currentFiles > 0
              ? `同步中: ${currentProjectId} (${currentFiles} 文件)`
              : `同步中: ${currentProjectId}`}
          </span>
        )}
        <Button variant="outline" onClick={() => void handleBulk('all-default')} disabled={bulk} title="按当前方向同步所有项目">
          {bulk ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          立即同步全部
        </Button>
        {bulk && (
          <Button
            variant="outline"
            onClick={() => void handleBulkCancel()}
            disabled={bulkCancelling}
            title="取消批量同步：SIGTERM 当前 rsync 并停止后续项目"
          >
            {bulkCancelling ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <X className="h-3.5 w-3.5 mr-1.5" />}
            取消
          </Button>
        )}
      </div>

      <div className="border-t pt-4 text-xs text-muted-foreground">
        一次性 push/pull 工具：进入项目内部，点击 header 的 <Upload className="inline h-3 w-3" /> / <Download className="inline h-3 w-3" /> 按钮。
        或通过 API 调用 <code>POST /api/sync/project/:id</code> with body <code>{'{ "direction": "push" }'}</code>。
      </div>
    </div>
  );
}

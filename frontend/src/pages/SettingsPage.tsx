import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, RefreshCw, X, Save, Bell, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AddProviderDialog } from '@/components/AddProviderDialog';
import { BackupProviderCard } from '@/components/BackupProviderCard';
import { BackupHistoryTable } from '@/components/BackupHistoryTable';
import {
  getBackupProviders,
  deleteBackupProvider,
  getBackupAuthUrl,
  getBackupSchedule,
  updateBackupSchedule,
  getBackupExcludes,
  updateBackupExcludes,
  getBackupHistory,
  getNotifyConfig,
  updateNotifyConfig,
  type BackupProvider,
  type BackupSchedule,
  type BackupHistoryEntry,
  type NotifyConfig,
} from '@/lib/api';
import {
  getPomodoroConfig,
  type PomodoroConfig,
} from '@/components/PomodoroTimer';
import { setStorage, STORAGE_KEYS } from '@/lib/storage';
import { toast } from 'sonner';

const DEFAULT_EXCLUDES = [
  'node_modules', '.git', 'dist', 'build', '*.log',
  '.DS_Store', '*.tmp', '.venv', '__pycache__', '.env',
];

const INTERVAL_OPTIONS = [
  { value: '30', label: '30分钟' },
  { value: '60', label: '1小时' },
  { value: '360', label: '6小时' },
  { value: '720', label: '12小时' },
  { value: '1440', label: '24小时' },
];

export function SettingsPage() {
  const navigate = useNavigate();

  // Cloud accounts
  const [providers, setProviders] = useState<BackupProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Schedule
  const [schedule, setSchedule] = useState<BackupSchedule>({ enabled: false, intervalMinutes: 60 });
  const [scheduleLoading, setScheduleLoading] = useState(true);

  // Excludes
  const [excludes, setExcludes] = useState<string[]>([]);
  const [excludesLoading, setExcludesLoading] = useState(true);
  const [newPattern, setNewPattern] = useState('');
  const [excludesDirty, setExcludesDirty] = useState(false);
  const [excludesSaving, setExcludesSaving] = useState(false);

  // History
  const [history, setHistory] = useState<BackupHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Pomodoro
  const [pomodoroConfig, setPomodoroConfig] = useState<PomodoroConfig>(() => getPomodoroConfig());
  const [pomodoroDirty, setPomodoroDirty] = useState(false);

  // Notify
  const [notifyConfig, setNotifyConfig] = useState<NotifyConfig>({ webhookEnabled: false });
  const [webhookInput, setWebhookInput] = useState('');
  const [webhookSaving, setWebhookSaving] = useState(false);

  const fetchProviders = async () => {
    try {
      const data = await getBackupProviders();
      setProviders(data);
    } catch {
      // silently handle
    } finally {
      setProvidersLoading(false);
    }
  };

  const fetchSchedule = async () => {
    try {
      const data = await getBackupSchedule();
      setSchedule(data);
    } catch {
      // silently handle
    } finally {
      setScheduleLoading(false);
    }
  };

  const fetchExcludes = async () => {
    try {
      const data = await getBackupExcludes();
      setExcludes(data.length > 0 ? data : DEFAULT_EXCLUDES);
    } catch {
      setExcludes(DEFAULT_EXCLUDES);
    } finally {
      setExcludesLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const data = await getBackupHistory();
      setHistory(data);
    } catch {
      // silently handle
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    void fetchProviders();
    void fetchSchedule();
    void fetchExcludes();
    void fetchHistory();
    getNotifyConfig()
      .then((c) => {
        setNotifyConfig(c);
        setWebhookInput(c.webhookUrl ?? '');
      })
      .catch(() => {});
  }, []);

  const handleSavePomodoroConfig = () => {
    setStorage(STORAGE_KEYS.pomodoroConfig, pomodoroConfig, true);
    setPomodoroDirty(false);
    toast.success('番茄钟设置已保存');
  };

  const handlePomodoroChange = (field: keyof PomodoroConfig, raw: string) => {
    const value = parseInt(raw, 10);
    if (isNaN(value) || value < 1) return;
    setPomodoroConfig((prev) => ({ ...prev, [field]: value }));
    setPomodoroDirty(true);
  };

  const handleSaveWebhook = async () => {
    setWebhookSaving(true);
    try {
      const updated = await updateNotifyConfig({
        webhookEnabled: webhookInput.trim().length > 0,
        webhookUrl: webhookInput.trim() || undefined,
      });
      setNotifyConfig(updated);
      toast.success('Webhook 配置已保存');
    } catch {
      toast.error('保存失败');
    } finally {
      setWebhookSaving(false);
    }
  };

  // Provider actions
  const handleDeleteProvider = async (id: string) => {
    try {
      await deleteBackupProvider(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // silently handle
    }
  };

  const handleReauth = async (id: string) => {
    try {
      const { url } = await getBackupAuthUrl(id);
      window.open(url, '_blank');
    } catch {
      // silently handle
    }
  };

  // Schedule actions
  const handleScheduleToggle = async (enabled: boolean) => {
    const updated = { ...schedule, enabled };
    setSchedule(updated);
    try {
      await updateBackupSchedule({ enabled });
    } catch {
      setSchedule(schedule);
    }
  };

  const handleIntervalChange = async (value: string) => {
    const intervalMinutes = parseInt(value, 10);
    const updated = { ...schedule, intervalMinutes };
    setSchedule(updated);
    try {
      await updateBackupSchedule({ intervalMinutes });
    } catch {
      setSchedule(schedule);
    }
  };

  // Excludes actions
  const handleAddPattern = () => {
    const pattern = newPattern.trim();
    if (!pattern || excludes.includes(pattern)) return;
    setExcludes((prev) => [...prev, pattern]);
    setNewPattern('');
    setExcludesDirty(true);
  };

  const handleRemovePattern = (pattern: string) => {
    setExcludes((prev) => prev.filter((p) => p !== pattern));
    setExcludesDirty(true);
  };

  const handleSaveExcludes = async () => {
    setExcludesSaving(true);
    try {
      await updateBackupExcludes(excludes);
      setExcludesDirty(false);
    } catch {
      // silently handle
    } finally {
      setExcludesSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="text-2xl font-bold">设置</h1>
        </div>

        <Tabs defaultValue="providers">
          <TabsList className="mb-4">
            <TabsTrigger value="providers">云盘账号</TabsTrigger>
            <TabsTrigger value="strategy">备份策略</TabsTrigger>
            <TabsTrigger value="history">备份记录</TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="h-3.5 w-3.5 mr-1.5" />
              通知
            </TabsTrigger>
            <TabsTrigger value="pomodoro">
              <Timer className="h-3.5 w-3.5 mr-1.5" />
              番茄钟
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Cloud Accounts */}
          <TabsContent value="providers">
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={() => setAddDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  添加云盘
                </Button>
              </div>

              {providersLoading ? (
                <p className="text-sm text-muted-foreground text-center py-8">加载中...</p>
              ) : providers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  暂无云盘账号，点击上方按钮添加
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {providers.map((provider) => (
                    <BackupProviderCard
                      key={provider.id}
                      provider={provider}
                      onDelete={handleDeleteProvider}
                      onReauth={handleReauth}
                    />
                  ))}
                </div>
              )}
            </div>

            <AddProviderDialog
              open={addDialogOpen}
              onOpenChange={setAddDialogOpen}
              onAdded={() => void fetchProviders()}
            />
          </TabsContent>

          {/* Tab 2: Backup Strategy */}
          <TabsContent value="strategy">
            <div className="space-y-8">
              {/* Exclude patterns */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">排除规则</h3>
                <p className="text-sm text-muted-foreground">
                  匹配这些模式的文件和目录将不会被备份
                </p>

                {excludesLoading ? (
                  <p className="text-sm text-muted-foreground">加载中...</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <AnimatePresence>
                        {excludes.map((pattern) => (
                          <motion.span
                            key={pattern}
                            layout
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ duration: 0.2 }}
                            className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-sm"
                          >
                            {pattern}
                            <button
                              onClick={() => handleRemovePattern(pattern)}
                              className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </div>

                    <div className="flex gap-2">
                      <Input
                        placeholder="输入排除模式，例如 *.log"
                        value={newPattern}
                        onChange={(e) => setNewPattern(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddPattern(); }}
                        className="max-w-xs"
                      />
                      <Button variant="outline" size="sm" onClick={handleAddPattern}>
                        添加
                      </Button>
                    </div>

                    {excludesDirty && (
                      <Button onClick={handleSaveExcludes} disabled={excludesSaving}>
                        <Save className="h-4 w-4 mr-1" />
                        {excludesSaving ? '保存中...' : '保存'}
                      </Button>
                    )}
                  </>
                )}
              </div>

              {/* Schedule */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">定时备份</h3>

                {scheduleLoading ? (
                  <p className="text-sm text-muted-foreground">加载中...</p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={handleScheduleToggle}
                      />
                      <Label>{schedule.enabled ? '已开启' : '已关闭'}</Label>
                    </div>

                    <div className="space-y-2">
                      <Label>备份间隔</Label>
                      <Select
                        value={String(schedule.intervalMinutes)}
                        onValueChange={handleIntervalChange}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTERVAL_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Tab 3: Backup History */}
          <TabsContent value="history">
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHistoryLoading(true);
                    void fetchHistory();
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  刷新
                </Button>
              </div>

              {historyLoading ? (
                <p className="text-sm text-muted-foreground text-center py-8">加载中...</p>
              ) : (
                <BackupHistoryTable history={history} />
              )}
            </div>
          </TabsContent>

          {/* Tab 4: Notifications */}
          <TabsContent value="notifications">
            <div className="space-y-6">
              {/* Browser notification info */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <h3 className="text-sm font-medium">浏览器通知</h3>
                <p className="text-xs text-muted-foreground">
                  当 Claude 完成任务时，浏览器将自动弹出通知。首次打开 Dashboard 时会请求通知权限。
                </p>
              </div>

              {/* Webhook config */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-medium">Webhook 通知</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Claude 完成任务时向指定 URL 发送 POST 请求（JSON: event, projectId, projectName, timestamp）
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Webhook URL</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://hooks.slack.com/..."
                      value={webhookInput}
                      onChange={(e) => setWebhookInput(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      onClick={() => void handleSaveWebhook()}
                      disabled={webhookSaving}
                    >
                      {webhookSaving ? '保存中…' : '保存'}
                    </Button>
                  </div>
                  {notifyConfig.webhookEnabled && notifyConfig.webhookUrl && (
                    <p className="text-xs text-green-500">已启用 → {notifyConfig.webhookUrl}</p>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
          {/* Tab 5: Pomodoro */}
          <TabsContent value="pomodoro">
            <div className="space-y-6">
              <div className="rounded-lg border border-border p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-medium">番茄钟时间设置</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    修改后重新启动番茄钟生效
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-6 max-w-xs">
                  <div className="space-y-1.5">
                    <Label className="text-xs">工作时长（分钟）</Label>
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      value={pomodoroConfig.workMinutes}
                      onChange={(e) => handlePomodoroChange('workMinutes', e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">休息时长（分钟）</Label>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={pomodoroConfig.breakMinutes}
                      onChange={(e) => handlePomodoroChange('breakMinutes', e.target.value)}
                      className="w-full"
                    />
                  </div>
                </div>

                {pomodoroDirty && (
                  <Button size="sm" onClick={handleSavePomodoroConfig}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    保存
                  </Button>
                )}
              </div>

              <div className="rounded-lg border border-border p-4 space-y-2">
                <h3 className="text-sm font-medium">使用说明</h3>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>在项目页面 Header 点击 <Timer className="h-3 w-3 inline-block mx-0.5" /> 图标启动番茄钟</li>
                  <li>倒计时以大字体悬浮在屏幕上，不影响操作</li>
                  <li>工作阶段结束后自动切换为休息，并弹出通知</li>
                  <li>休息结束后自动切换回工作阶段</li>
                  <li>再次点击图标可停止并重置</li>
                </ul>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

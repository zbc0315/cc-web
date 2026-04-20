import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bell, Timer, Activity, UploadCloud, Github, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SyncSection } from '@/components/SyncSection';
import { HubTokenSection } from '@/components/HubTokenSection';
import {
  getNotifyConfig,
  updateNotifyConfig,
  type NotifyConfig,
} from '@/lib/api';
import {
  getPomodoroConfig,
  type PomodoroConfig,
} from '@/components/PomodoroTimer';
import { setStorage, getStorage, STORAGE_KEYS } from '@/lib/storage';
import { toast } from 'sonner';

export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Accept ?tab=<value> so other pages can deep-link to a specific section
  // (SharePromptDialog → ?tab=hub when prompting the user to configure their PAT).
  const initialTab = searchParams.get('tab') || 'sync';

  // Pomodoro
  const [pomodoroConfig, setPomodoroConfig] = useState<PomodoroConfig>(() => getPomodoroConfig());
  const [pomodoroDirty, setPomodoroDirty] = useState(false);

  // Notify
  const [notifyConfig, setNotifyConfig] = useState<NotifyConfig>({ webhookEnabled: false });
  const [webhookInput, setWebhookInput] = useState('');
  const [webhookSaving, setWebhookSaving] = useState(false);

  // Usage monitor
  const [usageTool, setUsageTool] = useState(() => getStorage(STORAGE_KEYS.usageMonitorTool, 'claude'));

  useEffect(() => {
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

        <Tabs defaultValue={initialTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="sync">
              <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
              同步 (rsync)
            </TabsTrigger>
            <TabsTrigger value="hub">
              <Github className="h-3.5 w-3.5 mr-1.5" />
              CCWeb Hub
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="h-3.5 w-3.5 mr-1.5" />
              通知
            </TabsTrigger>
            <TabsTrigger value="pomodoro">
              <Timer className="h-3.5 w-3.5 mr-1.5" />
              番茄钟
            </TabsTrigger>
            <TabsTrigger value="usage">
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              用量监控
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sync">
            <SyncSection />
          </TabsContent>

          <TabsContent value="hub">
            <HubTokenSection />
          </TabsContent>

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

          {/* Tab 6: Usage Monitor */}
          <TabsContent value="usage">
            <div className="space-y-6">
              <div className="rounded-lg border border-border p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-medium">监控工具</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    选择要监控用量的 CLI 工具，首页和项目页会显示对应的实时用量
                  </p>
                </div>

                <div className="grid gap-3 max-w-md">
                  {[
                    { key: 'claude', label: 'Claude Code', desc: 'Anthropic API — 5h/7d 用量窗口' },
                    { key: 'codex', label: 'Codex', desc: 'OpenAI — 用量查询暂未实现' },
                    { key: 'opencode', label: 'OpenCode', desc: 'OpenCode — 用量查询暂未实现' },
                    { key: 'qwen', label: 'Qwen Code', desc: 'Qwen — 用量查询暂未实现' },
                    { key: 'gemini', label: 'Gemini CLI', desc: 'Google — 用量查询暂未实现' },
                  ].map((tool) => (
                    <label
                      key={tool.key}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        usageTool === tool.key
                          ? 'border-blue-500/50 bg-blue-500/5'
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name="usageTool"
                        value={tool.key}
                        checked={usageTool === tool.key}
                        onChange={() => {
                          setUsageTool(tool.key);
                          setStorage(STORAGE_KEYS.usageMonitorTool, tool.key);
                          window.dispatchEvent(new Event('ccweb:usage-tool-change'));
                          toast.success(`用量监控已切换为 ${tool.label}`);
                        }}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm font-medium">{tool.label}</div>
                        <div className="text-xs text-muted-foreground">{tool.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 space-y-2">
                <h3 className="text-sm font-medium">说明</h3>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>用量数据显示在首页 Header 和项目页底部状态栏</li>
                  <li>Claude Code 通过 OAuth API 实时查询，每 5 分钟自动刷新</li>
                  <li>其他工具的用量查询将在后续版本中支持</li>
                  <li>切换后无需刷新页面，用量会自动更新</li>
                </ul>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

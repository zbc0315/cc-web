import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Bell, Timer, Activity, UploadCloud, Github, Save, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SyncSection } from '@/components/SyncSection';
import { HubTokenSection } from '@/components/HubTokenSection';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
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
  const { t } = useTranslation();
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
    toast.success(t('settings.pomodoro.saved'));
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
      toast.success(t('settings.webhook.saved'));
    } catch {
      toast.error(t('settings.webhook.save_failed'));
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
            {t('common.back')}
          </Button>
          <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
        </div>

        <Tabs defaultValue={initialTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="sync">
              <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
              {t('settings.tab_sync')}
            </TabsTrigger>
            <TabsTrigger value="hub">
              <Github className="h-3.5 w-3.5 mr-1.5" />
              {t('settings.tab_hub')}
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="h-3.5 w-3.5 mr-1.5" />
              {t('settings.tab_notifications')}
            </TabsTrigger>
            <TabsTrigger value="pomodoro">
              <Timer className="h-3.5 w-3.5 mr-1.5" />
              {t('settings.tab_pomodoro')}
            </TabsTrigger>
            <TabsTrigger value="usage">
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              {t('settings.tab_usage')}
            </TabsTrigger>
            <TabsTrigger value="language">
              <Languages className="h-3.5 w-3.5 mr-1.5" />
              {t('settings.tab_language')}
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
                <h3 className="text-sm font-medium">{t('settings.browser_notify.title')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('settings.browser_notify.description')}
                </p>
              </div>

              {/* Webhook config */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-medium">{t('settings.webhook.title')}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings.webhook.description')}
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
                      {webhookSaving ? t('common.saving') : t('common.save')}
                    </Button>
                  </div>
                  {notifyConfig.webhookEnabled && notifyConfig.webhookUrl && (
                    <p className="text-xs text-green-500">{t('settings.webhook.enabled_prefix')} {notifyConfig.webhookUrl}</p>
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
                  <h3 className="text-sm font-medium">{t('settings.pomodoro.section_title')}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings.pomodoro.section_desc')}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-6 max-w-xs">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('settings.pomodoro.work_minutes')}</Label>
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
                    <Label className="text-xs">{t('settings.pomodoro.break_minutes')}</Label>
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
                    {t('common.save')}
                  </Button>
                )}
              </div>

              <div className="rounded-lg border border-border p-4 space-y-2">
                <h3 className="text-sm font-medium">{t('settings.pomodoro.howto_title')}</h3>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>
                    <Timer className="h-3 w-3 inline-block mx-0.5" />
                    {' '}
                    {t('settings.pomodoro.howto_item_1')}
                  </li>
                  <li>{t('settings.pomodoro.howto_item_2')}</li>
                  <li>{t('settings.pomodoro.howto_item_3')}</li>
                  <li>{t('settings.pomodoro.howto_item_4')}</li>
                  <li>{t('settings.pomodoro.howto_item_5')}</li>
                </ul>
              </div>
            </div>
          </TabsContent>

          {/* Tab 6: Usage Monitor */}
          <TabsContent value="usage">
            <div className="space-y-6">
              <div className="rounded-lg border border-border p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-medium">{t('settings.usage.section_title')}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('settings.usage.section_desc')}
                  </p>
                </div>

                <div className="grid gap-3 max-w-md">
                  {[
                    { key: 'claude', label: 'Claude Code', desc: t('settings.usage.tool_claude_desc') },
                    { key: 'codex', label: 'Codex', desc: t('settings.usage.tool_codex_desc') },
                    { key: 'opencode', label: 'OpenCode', desc: t('settings.usage.tool_opencode_desc') },
                    { key: 'qwen', label: 'Qwen Code', desc: t('settings.usage.tool_qwen_desc') },
                    { key: 'gemini', label: 'Gemini CLI', desc: t('settings.usage.tool_gemini_desc') },
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
                          toast.success(t('settings.usage.switched_toast', { tool: tool.label }));
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
                <h3 className="text-sm font-medium">{t('settings.usage.info_title')}</h3>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>{t('settings.usage.info_item_1')}</li>
                  <li>{t('settings.usage.info_item_2')}</li>
                  <li>{t('settings.usage.info_item_3')}</li>
                  <li>{t('settings.usage.info_item_4')}</li>
                </ul>
              </div>
            </div>
          </TabsContent>

          {/* Tab 7: Language */}
          <TabsContent value="language">
            <div className="space-y-6">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-medium">{t('language.label')}</h3>
                </div>
                <LanguageSwitcher />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

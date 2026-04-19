import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, Trash2, ExternalLink, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  getHubAuthStatus, setHubToken, clearHubToken,
  type HubAuthStatus,
} from '@/lib/api';

/**
 * Settings section for managing the per-user GitHub PAT used by the
 * "direct submit" share flow (SharePromptDialog → `/api/skillhub/submit`).
 *
 * Design decisions worth calling out:
 * - The token is never read back from the server once stored (the backend
 *   only exposes GET /auth as a boolean + fingerprint-validity flag), so
 *   this component can only *replace* or *clear*, never display.
 * - We link to GitHub's fine-grained PAT creation page with clear
 *   instructions rather than hosting a deep-link builder — fine-grained PATs
 *   have a lot of options that deserve user review, not a silent flow.
 * - pitfalls #30: ccweb itself must never carry a token in the npm package.
 */
export function HubTokenSection() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<HubAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHubAuthStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ configured: false, needsReset: false }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    const t = token.trim();
    if (!t) { toast.error('请输入 token'); return; }
    setSaving(true);
    try {
      const next = await setHubToken(t);
      setStatus(next);
      setToken('');
      toast.success('已保存');
    } catch (err) {
      toast.error(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: '清除 Hub Token',
      description: '清除后将无法直接提交到 ccweb-hub，需要重新配置 token。确认？',
      destructive: true,
      confirmLabel: '清除',
    });
    if (!ok) return;
    try {
      await clearHubToken();
      setStatus({ configured: false, needsReset: false });
      toast.success('已清除');
    } catch (err) {
      toast.error(`清除失败: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-1">CCWeb Hub 直接提交</h3>
        <p className="text-xs text-muted-foreground">
          配置你的 GitHub PAT 后，在 Quick Prompts / Agent Prompts 卡片右键选择"共享"时可一键直接提交 Issue 到 <code>zbc0315/ccweb-hub</code>。
          ccweb 本身不自带 token —— 使用你自己的账号身份提交，归属清晰，互不影响。
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <>
          {/* Current status */}
          <div className="rounded-md border px-3 py-2.5 text-xs flex items-center gap-2">
            {status?.configured ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                <span>已配置 token，可直接提交</span>
                <div className="flex-1" />
                <Button size="sm" variant="outline" onClick={() => void handleClear()}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  清除
                </Button>
              </>
            ) : status?.needsReset ? (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <span>之前的 token 已失效（服务端密钥可能已轮换），请重新设置</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>尚未配置 token</span>
              </>
            )}
          </div>

          {/* How-to */}
          <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs space-y-2">
            <div className="font-medium text-foreground">如何获取 token</div>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                打开{' '}
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
                >
                  GitHub fine-grained PAT
                  <ExternalLink className="h-3 w-3" />
                </a>{' '}
                创建页
              </li>
              <li>
                <strong className="text-foreground">Repository access</strong>：选 "Only select repositories"，添加 <code>zbc0315/ccweb-hub</code>
              </li>
              <li>
                <strong className="text-foreground">Repository permissions → Issues</strong>：设置为 "Read and write"
              </li>
              <li>其余权限保持默认（全部无访问）</li>
              <li>生成后复制 token 粘贴到下方</li>
            </ol>
          </div>

          {/* Input */}
          <div className="space-y-2">
            <Label htmlFor="hub-token" className="text-xs">
              GitHub Token {status?.configured && <span className="text-muted-foreground">（填写会覆盖现有 token）</span>}
            </Label>
            <Input
              id="hub-token"
              type="password"
              placeholder="github_pat_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Token 以 AES-256-GCM 加密存储于 <code>~/.ccweb/hub-auth/</code>；per-user 独立，不会被其他用户读到。
            </p>
          </div>

          <div className="flex gap-2 pt-2 border-t">
            <Button onClick={() => void handleSave()} disabled={saving || !token.trim()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              保存
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { STORAGE_KEYS, getStorage, setStorage } from '@/lib/storage';
import { getHubAuthStatus, submitToHub, type HubAuthStatus } from '@/lib/api';
import type { PromptCardKind } from './PromptCard';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PromptCardKind;
  label: string;
  content: string;
}

/**
 * "Share to ccweb-hub" dialog — one-click submit using the user's stored
 * GitHub PAT.
 *
 * If no token is configured yet, the dialog shows a setup prompt with a
 * "Go to Settings" button instead of the submit form.  The token is stored
 * server-side encrypted (per-user, AES-GCM with jwtSecret-derived key) —
 * ccweb itself NEVER ships with a token (pitfalls #30: any bundled token
 * would be extractable from the published npm package).
 */
export function SharePromptDialog({ open, onOpenChange, kind, label, content }: Props) {
  const navigate = useNavigate();

  const [author, setAuthor] = useState(() => getStorage(STORAGE_KEYS.skillhubAuthor, ''));
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authStatus, setAuthStatus] = useState<HubAuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setAuthor(getStorage(STORAGE_KEYS.skillhubAuthor, ''));
    setDescription('');
    setTags('');
    setAuthLoading(true);
    getHubAuthStatus()
      .then(setAuthStatus)
      .catch(() => setAuthStatus({ configured: false, needsReset: false }))
      .finally(() => setAuthLoading(false));
  }, [open]);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setStorage(STORAGE_KEYS.skillhubAuthor, author);
    try {
      const res = await submitToHub({
        kind,
        label,
        body: content,
        description: description.trim() || undefined,
        author: author.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      toast.success(`已提交：Issue #${res.issueNumber}`, {
        action: {
          label: '查看',
          onClick: () => window.open(res.issueUrl, '_blank', 'noopener,noreferrer'),
        },
      });
      onOpenChange(false);
    } catch (err) {
      const msg = (err as Error).message;
      toast.error(msg);
      // 401 → token invalid; refresh auth status so UI swaps to setup prompt
      if (/invalid|expired|401/.test(msg)) {
        setAuthStatus({ configured: false, needsReset: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const goToTokenSetup = () => {
    onOpenChange(false);
    navigate('/settings?tab=hub');
  };

  const kindLabel = kind === 'quick-prompt' ? '快捷 Prompt' : 'Agent Prompt';
  const needsSetup = !authLoading && authStatus && !authStatus.configured;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle>共享到 ccweb-hub</DialogTitle>
          <DialogDescription>
            「{label}」将以 GitHub Issue 形式提交到 <code>zbc0315/ccweb-hub</code>，
            使用你配置的 GitHub token。审核通过后会合入为社区 prompt。
          </DialogDescription>
        </DialogHeader>

        {authLoading ? (
          <div className="py-8 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            检查 token 配置…
          </div>
        ) : needsSetup ? (
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs">
              <div className="flex items-start gap-2">
                <KeyRound className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-medium text-foreground">
                    {authStatus?.needsReset
                      ? '之前配置的 token 已失效（服务端密钥可能已轮换），请重新设置'
                      : '还没配置 GitHub token'}
                  </div>
                  <div className="text-muted-foreground">
                    为保护你的 GitHub 账号，ccweb 不自带 token，需要你用自己的 GitHub
                    fine-grained PAT（只勾 <code>ccweb-hub</code> 仓库的
                    <code> Issues: Read and write</code>）。
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                稍后
              </Button>
              <Button onClick={goToTokenSetup} className="flex-1">
                去设置页配置
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="share-author" className="text-xs">GitHub 用户名（可选，用于作者标注）</Label>
                <Input
                  id="share-author"
                  placeholder="zbc0315"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="share-desc" className="text-xs">一句话描述（可选）</Label>
                <Input
                  id="share-desc"
                  placeholder={kind === 'quick-prompt' ? '这个命令用来...' : '这段 prompt 让 Claude...'}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="share-tags" className="text-xs">标签（逗号分隔，可选）</Label>
                <Input
                  id="share-tags"
                  placeholder="review, 中文, 代码"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <div className="font-medium text-foreground mb-1">预览：{kindLabel} · {label}</div>
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug max-h-32 overflow-y-auto">
                {Array.from(content).slice(0, 500).join('')}
                {Array.from(content).length > 500 && '…'}
              </pre>
            </div>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={goToTokenSetup} className="mr-auto" title="更换或清除 token">
                <KeyRound className="h-3.5 w-3.5 mr-1" />
                管理 token
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                取消
              </Button>
              <Button onClick={() => void handleSubmit()} disabled={submitting}>
                {submitting
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />提交中</>
                  : <><Send className="h-3.5 w-3.5 mr-1.5" />直接提交</>}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Convenience helper — opens GitHub's fine-grained PAT page pre-configured
 *  for ccweb-hub Issue permissions.  Exported so the Settings page can reuse. */
export function openHubTokenSetupLink(): void {
  // GitHub's fine-grained PAT creation page; we can't pre-select the repo via
  // URL, but we can link to the page and tell the user what to pick.
  window.open(
    'https://github.com/settings/personal-access-tokens/new',
    '_blank',
    'noopener,noreferrer',
  );
  // eslint-disable-next-line no-console
  console.info('[ccweb-hub] creating a token: select "Only select repositories" → zbc0315/ccweb-hub; Repository permissions → Issues: Read and write.');
}

export { ExternalLink }; // re-export for shared icon in Settings
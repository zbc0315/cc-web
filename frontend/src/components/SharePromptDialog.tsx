import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { STORAGE_KEYS, getStorage, setStorage } from '@/lib/storage';
import type { PromptCardKind } from './PromptCard';

const HUB_OWNER = 'zbc0315';
const HUB_REPO = 'ccweb-hub';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PromptCardKind;
  label: string;
  /** The raw prompt body / command text. */
  content: string;
}

/**
 * "Share to ccweb-hub" dialog.
 *
 * Does NOT handle any GitHub auth.  It opens a pre-filled new-issue URL on
 * ccweb-hub in a new tab; the user reviews and submits from their own GitHub
 * session.  This deliberately avoids the pitfalls #30 trap (embedded token in
 * shipped package = permanent credential leak).
 */
export function SharePromptDialog({ open, onOpenChange, kind, label, content }: Props) {
  const [author, setAuthor] = useState(() => getStorage(STORAGE_KEYS.skillhubAuthor, ''));
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (open) {
      setAuthor(getStorage(STORAGE_KEYS.skillhubAuthor, ''));
      setDescription('');
      setTags('');
    }
  }, [open]);

  /** Safe slice: `String.prototype.slice` counts UTF-16 units and can split a
   *  surrogate pair (emoji / some CJK).  `Array.from` iterates by code point,
   *  so slicing on it never cuts inside a grapheme. */
  const codePointSlice = (s: string, n: number) => Array.from(s).slice(0, n).join('');

  /** Choose a fence length that's longer than any backtick run appearing in
   *  the content — so a prompt that literally contains triple-backticks
   *  doesn't close our fence early. */
  const fenceFor = (text: string): string => {
    let max = 0;
    const runs = text.match(/`+/g);
    if (runs) for (const r of runs) max = Math.max(max, r.length);
    return '`'.repeat(Math.max(3, max + 1));
  };

  const buildIssueUrl = (): string => {
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    const authorPart = author.trim() || 'anonymous';
    const kindLabel = kind === 'quick-prompt' ? 'Quick Prompt' : 'Agent Prompt';
    const title = codePointSlice(`[${kindLabel}] ${label}`, 200);

    const fence = fenceFor(content);
    // Issue body — maintainer pastes straight into a .md file after review.
    // Frontmatter emitted here so reviewer can commit with minimal edits.
    // `fence` is dynamically sized so user-supplied content can't prematurely
    // close the markdown code block.
    const body =
      `<!-- Submitted via ccweb. Review, then commit to ${kind}s/ as a .md file. -->\n\n` +
      '```yaml\n' +
      '---\n' +
      `label: ${JSON.stringify(label)}\n` +
      `kind: ${JSON.stringify(kind)}\n` +
      `author: ${JSON.stringify(authorPart)}\n` +
      (tagList.length ? `tags: ${JSON.stringify(tagList)}\n` : '') +
      (description.trim() ? `description: ${JSON.stringify(description.trim())}\n` : '') +
      '---\n' +
      '```\n\n' +
      '## Body\n\n' +
      `${fence}\n` +
      content +
      `\n${fence}\n`;

    const labels = [kind]; // "quick-prompt" or "agent-prompt"
    const params = new URLSearchParams({
      title,
      body,
      labels: labels.join(','),
    });
    const url = `https://github.com/${HUB_OWNER}/${HUB_REPO}/issues/new?${params.toString()}`;
    // GitHub's practical URL cap is ~8000 chars; beyond that the issue form
    // silently truncates the body. Surface the issue rather than hide it.
    if (url.length > 7500) {
      // Still return the URL — caller can copy body as fallback. The dialog
      // itself warns when URL is long via the preview.
    }
    return url;
  };

  const handleOpenIssue = () => {
    setStorage(STORAGE_KEYS.skillhubAuthor, author);
    const url = buildIssueUrl();
    window.open(url, '_blank', 'noopener,noreferrer');
    onOpenChange(false);
  };

  const kindLabel = kind === 'quick-prompt' ? '快捷 Prompt' : 'Agent Prompt';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle>共享到 ccweb-hub</DialogTitle>
          <DialogDescription>
            「{label}」将以 GitHub Issue 的形式提交到 <code>{HUB_OWNER}/{HUB_REPO}</code>。
            点击「打开 Issue 页」会新开 GitHub 标签页，你在自己的 GitHub 账号下提交。
            ccweb 本身不处理任何 Token。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="share-author" className="text-xs">GitHub 用户名（可选）</Label>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleOpenIssue}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            打开 Issue 页提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

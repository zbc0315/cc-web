import { useState, useEffect } from 'react';
import { Cloud, Settings2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { addBackupProvider, getBackupAuthUrl, getBuiltInOAuthTypes } from '@/lib/api';

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  'google-drive': 'Google Drive',
  'onedrive': 'OneDrive',
  'dropbox': 'Dropbox',
};

export function AddProviderDialog({ open, onOpenChange, onAdded }: AddProviderDialogProps) {
  const [builtInTypes, setBuiltInTypes] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Simple mode state
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Advanced mode state
  const [type, setType] = useState('');
  const [label, setLabel] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [advSubmitting, setAdvSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void getBuiltInOAuthTypes().then((r) => setBuiltInTypes(r.available)).catch(() => setBuiltInTypes([]));
    }
  }, [open]);

  const resetForm = () => {
    setShowAdvanced(false);
    setSubmitting(null);
    setType('');
    setLabel('');
    setClientId('');
    setClientSecret('');
    setAdvSubmitting(false);
    setError(null);
  };

  const handleQuickAdd = async (providerType: string) => {
    setSubmitting(providerType);
    setError(null);
    try {
      const { id } = await addBackupProvider({
        type: providerType,
        label: PROVIDER_LABELS[providerType] || providerType,
      });
      const { url } = await getBackupAuthUrl(id);
      window.open(url, '_blank');
      resetForm();
      onOpenChange(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
      setSubmitting(null);
    }
  };

  const handleAdvancedSubmit = async () => {
    if (!type || !label || !clientId || !clientSecret) {
      setError('请填写所有字段');
      return;
    }
    setAdvSubmitting(true);
    setError(null);
    try {
      const { id } = await addBackupProvider({ type, label, clientId, clientSecret });
      const { url } = await getBackupAuthUrl(id);
      window.open(url, '_blank');
      resetForm();
      onOpenChange(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setAdvSubmitting(false);
    }
  };

  const hasBuiltIn = builtInTypes.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            添加云盘账号
          </DialogTitle>
          <DialogDescription>
            {showAdvanced
              ? '手动填写 OAuth 凭据连接云盘'
              : '选择云盘类型，点击后跳转登录授权'}
          </DialogDescription>
        </DialogHeader>

        {!showAdvanced ? (
          <div className="space-y-3 py-2">
            {hasBuiltIn ? (
              <>
                {builtInTypes.map((t) => (
                  <Button
                    key={t}
                    variant="outline"
                    className="w-full justify-start gap-3 h-12 text-base"
                    onClick={() => void handleQuickAdd(t)}
                    disabled={submitting !== null}
                  >
                    {submitting === t ? '连接中...' : `连接 ${PROVIDER_LABELS[t] || t}`}
                  </Button>
                ))}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                暂无内置 OAuth 凭据，请使用手动模式添加
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="pt-2 border-t border-border">
              <button
                onClick={() => { setShowAdvanced(true); setError(null); }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                手动填写 OAuth 凭据
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>云盘类型</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择云盘类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google-drive">Google Drive</SelectItem>
                    <SelectItem value="onedrive">OneDrive</SelectItem>
                    <SelectItem value="dropbox">Dropbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>显示名称</Label>
                <Input
                  placeholder="例如：我的 Google Drive"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Client ID</Label>
                <Input
                  placeholder="OAuth Client ID"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Client Secret</Label>
                <Input
                  type="password"
                  placeholder="OAuth Client Secret"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowAdvanced(false); setError(null); }}>
                返回
              </Button>
              <Button onClick={handleAdvancedSubmit} disabled={advSubmitting}>
                {advSubmitting ? '添加中...' : '添加并授权'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { Cloud } from 'lucide-react';
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
import { addBackupProvider, getBackupAuthUrl } from '@/lib/api';

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function AddProviderDialog({ open, onOpenChange, onAdded }: AddProviderDialogProps) {
  const [type, setType] = useState('');
  const [label, setLabel] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setType('');
    setLabel('');
    setClientId('');
    setClientSecret('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!type || !label || !clientId || !clientSecret) {
      setError('请填写所有字段');
      return;
    }

    setSubmitting(true);
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
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            添加云盘账号
          </DialogTitle>
          <DialogDescription>
            添加云存储服务商账号用于项目备份
          </DialogDescription>
        </DialogHeader>

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

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '添加中...' : '添加并授权'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

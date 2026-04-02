import { useState, useRef, useEffect } from 'react';
import { HardDrive, Cloud, Trash2, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BackupProvider } from '@/lib/api';

interface BackupProviderCardProps {
  provider: BackupProvider;
  onDelete: (id: string) => void;
  onReauth: (id: string) => void;
}

const providerTypeLabels: Record<string, string> = {
  'google-drive': 'Google Drive',
  'onedrive': 'OneDrive',
  'dropbox': 'Dropbox',
};

function ProviderIcon({ type }: { type: string }) {
  switch (type) {
    case 'google-drive':
      return <HardDrive className="h-5 w-5 text-blue-500" />;
    case 'onedrive':
      return <Cloud className="h-5 w-5 text-sky-500" />;
    case 'dropbox':
      return <HardDrive className="h-5 w-5 text-indigo-500" />;
    default:
      return <Cloud className="h-5 w-5" />;
  }
}

export function BackupProviderCard({ provider, onDelete, onReauth }: BackupProviderCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(provider.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <ProviderIcon type={provider.type} />
            <div>
              <CardTitle className="text-base">{provider.label}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {providerTypeLabels[provider.type] || provider.type}
              </p>
            </div>
          </div>
          <Badge
            variant={provider.authorized ? 'default' : 'destructive'}
            className={provider.authorized ? 'bg-green-600 hover:bg-green-700' : ''}
          >
            {provider.authorized ? '已授权' : '未授权'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {provider.authorized && provider.tokens?.expiry && (
          <p className="text-xs text-muted-foreground mb-3">
            授权到期：{new Date(provider.tokens.expiry).toLocaleDateString('zh-CN')}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReauth(provider.id)}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            重新授权
          </Button>
          <Button
            variant={confirmDelete ? 'destructive' : 'outline'}
            size="sm"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {confirmDelete ? '确认删除？' : '删除'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

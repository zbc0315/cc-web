import { Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { BackupHistoryEntry } from '@/lib/api';

interface BackupHistoryTableProps {
  history: BackupHistoryEntry[];
}

const statusConfig = {
  success: { label: '成功', icon: CheckCircle2, className: 'bg-green-600 hover:bg-green-700' },
  failed: { label: '失败', icon: XCircle, className: 'bg-red-600 hover:bg-red-700' },
  partial: { label: '部分完成', icon: AlertTriangle, className: 'bg-yellow-600 hover:bg-yellow-700' },
};

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}分${remainSec}秒`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BackupHistoryTable({ history }: BackupHistoryTableProps) {
  const entries = history.slice(0, 20);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Clock className="h-10 w-10 mb-3 opacity-50" />
        <p className="text-sm">暂无备份记录</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-2 font-medium text-muted-foreground">时间</th>
            <th className="text-left py-3 px-2 font-medium text-muted-foreground">项目</th>
            <th className="text-left py-3 px-2 font-medium text-muted-foreground">云盘</th>
            <th className="text-left py-3 px-2 font-medium text-muted-foreground">状态</th>
            <th className="text-left py-3 px-2 font-medium text-muted-foreground">文件数</th>
            <th className="text-left py-3 px-2 font-medium text-muted-foreground">耗时</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const config = statusConfig[entry.status];
            const StatusIcon = config.icon;
            return (
              <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/50">
                <td className="py-2.5 px-2 whitespace-nowrap">
                  {formatTime(entry.startTime)}
                </td>
                <td className="py-2.5 px-2">{entry.projectName}</td>
                <td className="py-2.5 px-2">{entry.providerLabel}</td>
                <td className="py-2.5 px-2">
                  <Badge className={config.className}>
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {config.label}
                  </Badge>
                  {entry.error && (
                    <p className="text-xs text-destructive mt-1">{entry.error}</p>
                  )}
                </td>
                <td className="py-2.5 px-2 whitespace-nowrap">
                  {entry.filesUploaded}/{entry.filesTotal}
                </td>
                <td className="py-2.5 px-2 whitespace-nowrap">
                  {formatDuration(entry.startTime, entry.endTime)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

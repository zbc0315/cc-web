import { useState, useCallback } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/lib/stores';
import { useLoginAlerts, type LoginAlert } from '@/lib/websocket';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

/**
 * App-wide listener for real-time "new login" security alerts. Mounted once at
 * the app root. Whenever ANY login succeeds for the current user (any IP, any
 * device), every other live session pops this modal. The session that just
 * logged in does not alert itself — it opens its alert socket only after the
 * server has already broadcast.
 */
function LoginAlertInner() {
  const [alert, setAlert] = useState<LoginAlert | null>(null);

  useLoginAlerts(useCallback((a: LoginAlert) => setAlert(a), []));

  const when = alert
    ? new Date(alert.at).toLocaleString('zh-CN', { hour12: false })
    : '';

  return (
    <Dialog open={!!alert} onOpenChange={(o) => { if (!o) setAlert(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-500 shrink-0" />
            检测到新的登录
          </DialogTitle>
          <DialogDescription>
            你的账号刚刚有一次新的登录。如果不是你本人操作，请立即修改密码并轮换密钥。
          </DialogDescription>
        </DialogHeader>

        {alert && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1.5">
            <div className="flex gap-2">
              <span className="shrink-0 w-16 text-muted-foreground">账号</span>
              <span className="font-medium">{alert.username}</span>
            </div>
            <div className="flex gap-2">
              <span className="shrink-0 w-16 text-muted-foreground">IP</span>
              <span className="font-mono">{alert.ip}</span>
            </div>
            <div className="flex gap-2">
              <span className="shrink-0 w-16 text-muted-foreground">时间</span>
              <span>{when}</span>
            </div>
            <div className="flex gap-2">
              <span className="shrink-0 w-16 text-muted-foreground">设备</span>
              <span className="break-all text-foreground/80">{alert.userAgent}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => setAlert(null)}>知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LoginAlertListener() {
  const token = useAuthStore((s) => s.token);
  // Gate the hook behind a token: mounting the inner component only once a
  // token exists means useLoginAlerts always connects with credentials, and
  // logout (token cleared) unmounts it → the WS closes via hook cleanup.
  if (!token) return null;
  return <LoginAlertInner />;
}

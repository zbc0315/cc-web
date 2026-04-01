import { toast } from 'sonner';

/**
 * Show a persistent browser notification for project task completion.
 * - requireInteraction: stays until user clicks or dismisses
 * - Click navigates to project page and closes notification
 * - Falls back to toast on non-secure contexts (LAN HTTP)
 */
export function notifyProjectStopped(projectId: string, projectName: string): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification('任务已完成', {
      body: `项目「${projectName}」的任务已完成`,
      icon: '/terminal.svg',
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      window.location.href = `/projects/${projectId}`;
      n.close();
    };
  } else {
    toast.success(`项目「${projectName}」的任务已完成`, {
      duration: Infinity,
      action: {
        label: '查看',
        onClick: () => { window.location.href = `/projects/${projectId}`; },
      },
    });
  }
}

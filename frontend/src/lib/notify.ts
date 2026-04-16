import { toast } from 'sonner';

/**
 * Show a toast notification for project task completion.
 */
export function notifyProjectStopped(projectId: string, projectName: string): void {
  toast.success(`项目「${projectName}」的任务已完成`, {
    duration: Infinity,
    action: {
      label: '查看',
      onClick: () => { window.location.href = `/projects/${projectId}`; },
    },
  });
}

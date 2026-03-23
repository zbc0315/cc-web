import { useState, useEffect } from 'react';
import { Users, Trash2, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getAllUsers, updateProjectShares } from '@/lib/api';
import { Project, ProjectShare } from '@/types';

interface ShareDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (project: Project) => void;
}

export function ShareDialog({ project, open, onOpenChange, onUpdated }: ShareDialogProps) {
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [allUsers, setAllUsers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setShares(project.shares ? [...project.shares] : []);
    setError(null);
    getAllUsers().then(setAllUsers).catch(() => {});
  }, [open, project]);

  // Users available to add (not owner, not already shared)
  const sharedUsernames = new Set(shares.map((s) => s.username));
  const availableUsers = allUsers.filter(
    (u) => u !== project.owner && !sharedUsernames.has(u)
  );

  const addUser = (username: string) => {
    setShares((prev) => [...prev, { username, permission: 'view' }]);
  };

  const removeUser = (username: string) => {
    setShares((prev) => prev.filter((s) => s.username !== username));
  };

  const togglePermission = (username: string) => {
    setShares((prev) =>
      prev.map((s) =>
        s.username === username
          ? { ...s, permission: s.permission === 'view' ? 'edit' : 'view' }
          : s
      )
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProjectShares(project.id, shares);
      onUpdated(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update shares');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            共享设置
          </DialogTitle>
          <DialogDescription>
            选择用户并设置权限：可见（只读）或可编辑（读写+终端）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-64 overflow-y-auto">
          {shares.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              尚未共享给任何用户
            </p>
          )}
          {shares.map((share) => (
            <div key={share.username} className="flex items-center justify-between gap-2 px-1">
              <span className="text-sm font-medium">{share.username}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => togglePermission(share.username)}
                  className="focus:outline-none"
                >
                  <Badge
                    variant={share.permission === 'edit' ? 'default' : 'secondary'}
                    className="cursor-pointer text-xs"
                  >
                    {share.permission === 'edit' ? '可编辑' : '可见'}
                  </Badge>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => removeUser(share.username)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Add user */}
        {availableUsers.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground mb-2">添加用户</p>
            <div className="flex flex-wrap gap-1.5">
              {availableUsers.map((u) => (
                <Button
                  key={u}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => addUser(u)}
                >
                  <Plus className="h-3 w-3" />
                  {u}
                </Button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

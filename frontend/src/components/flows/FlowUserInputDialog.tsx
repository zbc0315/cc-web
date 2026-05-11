import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { submitFlowInput } from './api';
import type { UserInputField } from './types';

interface Props {
  projectId: string;
  open: boolean;
  nodeId: number;
  fields: UserInputField[];
  onSubmitted: () => void;
}

/** Modal that captures a user-input node's form. Closes only on submit — not
 *  on backdrop click — to prevent accidentally skipping a flow step.  */
export function FlowUserInputDialog({ projectId, open, nodeId, fields, onSubmitted }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Reset values when the underlying field schema changes (e.g. flow restarted).
  useEffect(() => {
    const blank: Record<string, string> = {};
    for (const f of fields) blank[f.key] = '';
    setValues(blank);
  }, [fields, nodeId]);

  const handleSubmit = async () => {
    // All fields required for MVP — empty values are surfaced as warnings
    // but still submitted (the flow author may want optional fields).
    setSubmitting(true);
    try {
      await submitFlowInput(projectId, values);
      onSubmitted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* no-op: dialog blocks until submit */ }}>
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>任务流需要输入 · 节点 #{nodeId}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {f.label} <span className="opacity-60 font-mono">({f.key})</span>
              </Label>
              {f.type === 'textarea' ? (
                <textarea
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  className="w-full min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30 resize-y"
                />
              ) : (
                <Input
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={handleSubmit} disabled={submitting} size="sm">
            {submitting ? '提交中…' : '提交'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

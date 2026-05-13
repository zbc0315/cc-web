import { useState } from 'react';
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
  /** Per-field current values for fields with bindVariable (read-only display).
   *  Pre-read by the runner so we don't need a separate fetch. */
  variableValues?: Record<string, string>;
  onSubmitted: () => void;
}

/** Modal that captures a user-input node's form. Closes only on submit — not
 *  on backdrop click — to prevent accidentally skipping a flow step.  */
export function FlowUserInputDialog({ projectId, open, nodeId, fields, variableValues, onSubmitted }: Props) {
  // Lazy init so values are populated ONCE per dialog mount. We can't put
  // this in a useEffect keyed on [fields, nodeId] — useFlowState polls every
  // 2s and re-renders this dialog with a *new* `fields` array reference each
  // time (JSON.parse round-trip), which would wipe the user's in-progress
  // input. The dialog is conditionally rendered by the parent: unmount +
  // remount handles the "different node" case, so we never need to reset
  // values during a single dialog lifetime.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const blank: Record<string, string> = {};
    for (const f of fields) blank[f.key] = variableValues?.[f.key] ?? '';
    return blank;
  });
  const [submitting, setSubmitting] = useState(false);

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
          {fields.map((f) => {
            const isReadonly = !!f.bindVariable;
            const displayValue = isReadonly
              ? (variableValues?.[f.key] ?? '(未设置)')
              : (values[f.key] ?? '');
            return (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {f.label} <span className="opacity-60 font-mono">({f.key})</span>
                  {f.bindVariable && (
                    <span className="ml-2 text-blue-600 dark:text-blue-400">
                      ← 变量 {f.bindVariable}
                    </span>
                  )}
                  {f.outputToVariable && (
                    <span className="ml-2 text-primary">
                      → 变量 {f.outputToVariable}
                    </span>
                  )}
                </Label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={displayValue}
                    readOnly={isReadonly}
                    onChange={(e) => !isReadonly && setValues({ ...values, [f.key]: e.target.value })}
                    className={`w-full min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30 resize-y ${isReadonly ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}`}
                  />
                ) : (
                  <Input
                    value={displayValue}
                    readOnly={isReadonly}
                    onChange={(e) => !isReadonly && setValues({ ...values, [f.key]: e.target.value })}
                    className={isReadonly ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}
                  />
                )}
              </div>
            );
          })}
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

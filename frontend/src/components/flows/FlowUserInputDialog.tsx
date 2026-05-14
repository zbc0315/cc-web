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
  /** Pre-read context values for fields with bindVariable / bindConstant.
   *  The frontend renders these read-only; the runner re-reads on submit so
   *  the client can't lie about them. */
  contextValues?: {
    variables?: Record<string, unknown>;
    constants?: Record<string, unknown>;
  };
  onSubmitted: () => void;
}

/** Display a JSON value as a single readable line/block. */
function formatDisplay(value: unknown): string {
  if (value === undefined || value === null) return '(未设置)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/** Modal that captures a user-input node's form. Closes only on submit. */
export function FlowUserInputDialog({ projectId, open, nodeId, fields, contextValues, onSubmitted }: Props) {
  // Lazy init: only seed values once per dialog mount. Re-keyed by parent
  // (ProjectPage conditionally renders) so node switches unmount+remount
  // — see flows系统.md §9.4 / v-11-c.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const blank: Record<string, string> = {};
    for (const f of fields) {
      // bindVariable / bindConstant fields show context value; readWriter
      // fields start blank.
      if (f.bindVariable && contextValues?.variables) {
        blank[f.key] = formatDisplay(contextValues.variables[f.bindVariable]);
      } else if (f.bindConstant && contextValues?.constants) {
        blank[f.key] = formatDisplay(contextValues.constants[f.bindConstant]);
      } else {
        blank[f.key] = '';
      }
    }
    return blank;
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
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
    <Dialog open={open} onOpenChange={() => { /* modal — only submit closes */ }}>
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
            const isReadonly = !!f.bindVariable || !!f.bindConstant;
            const sourceLabel = f.bindVariable
              ? `← 变量 ${f.bindVariable}`
              : f.bindConstant
                ? `← 常量 ${f.bindConstant}`
                : f.outputVariable
                  ? `→ 变量 ${f.outputVariable}`
                  : null;
            return (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {f.label} <span className="opacity-60 font-mono">({f.key})</span>
                  {sourceLabel && (
                    <span className={`ml-2 ${f.bindConstant ? 'text-emerald-600 dark:text-emerald-400' : f.bindVariable ? 'text-blue-600 dark:text-blue-400' : 'text-primary'}`}>
                      {sourceLabel}
                    </span>
                  )}
                </Label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={values[f.key] ?? ''}
                    readOnly={isReadonly}
                    onChange={(e) => !isReadonly && setValues({ ...values, [f.key]: e.target.value })}
                    className={`w-full min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30 resize-y ${isReadonly ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}`}
                  />
                ) : (
                  <Input
                    value={values[f.key] ?? ''}
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

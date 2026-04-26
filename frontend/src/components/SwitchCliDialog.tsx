import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CliTool } from '@/types';
import { CLI_TOOLS, cliToolLabel, cliToolSupportsContinue } from '@/lib/cli-tools';
import { cn } from '@/lib/utils';

interface SwitchCliDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCliTool: CliTool;
  loading?: boolean;
  /** Called with the user's choice. The dialog stays open while the parent's
   *  promise is resolving so a network failure can be surfaced inline. */
  onConfirm: (cliTool: CliTool, continueSession: boolean) => Promise<void>;
}

export function SwitchCliDialog({
  open,
  onOpenChange,
  currentCliTool,
  loading,
  onConfirm,
}: SwitchCliDialogProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<CliTool | null>(null);
  const [continueSession, setContinueSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local state every time the dialog re-opens so a previous attempt
  // doesn't ghost in.
  useEffect(() => {
    if (open) {
      setTarget(null);
      setContinueSession(false);
      setError(null);
    }
  }, [open]);

  // Auto-disable continue when the picked target doesn't support it.
  useEffect(() => {
    if (target && !cliToolSupportsContinue(target)) {
      setContinueSession(false);
    }
  }, [target]);

  const targetSupportsContinue = target ? cliToolSupportsContinue(target) : false;

  const handleConfirm = async () => {
    if (!target) return;
    setError(null);
    try {
      await onConfirm(target, continueSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('switch_cli.title')}</DialogTitle>
          <DialogDescription>
            {t('switch_cli.description', { current: cliToolLabel(currentCliTool) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Target CLI picker */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('switch_cli.target_label')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CLI_TOOLS.map((meta) => {
                const isCurrent = meta.tool === currentCliTool;
                const isSelected = meta.tool === target;
                return (
                  <button
                    key={meta.tool}
                    type="button"
                    disabled={isCurrent || loading}
                    onClick={() => setTarget(meta.tool)}
                    className={cn(
                      'text-left px-3 py-2 rounded-md border text-sm transition-colors',
                      isSelected
                        ? 'border-primary bg-accent'
                        : 'border-border hover:bg-accent/50',
                      isCurrent && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <div className="font-medium">{meta.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {isCurrent
                        ? t('switch_cli.tag_current')
                        : meta.supportsContinue
                          ? t('switch_cli.tag_supports_continue')
                          : t('switch_cli.tag_no_continue')}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Launch mode picker */}
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('switch_cli.mode_label')}</div>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => setContinueSession(false)}
                className={cn(
                  'text-left px-3 py-2 rounded-md border text-sm transition-colors',
                  !continueSession
                    ? 'border-primary bg-accent'
                    : 'border-border hover:bg-accent/50',
                )}
              >
                <div className="font-medium">{t('switch_cli.mode_fresh')}</div>
                <div className="text-xs text-muted-foreground">
                  {t('switch_cli.mode_fresh_hint')}
                </div>
              </button>
              <button
                type="button"
                disabled={loading || !target || !targetSupportsContinue}
                onClick={() => setContinueSession(true)}
                title={target && !targetSupportsContinue
                  ? t('switch_cli.mode_continue_unsupported', { tool: cliToolLabel(target) })
                  : undefined}
                className={cn(
                  'text-left px-3 py-2 rounded-md border text-sm transition-colors',
                  continueSession
                    ? 'border-primary bg-accent'
                    : 'border-border hover:bg-accent/50',
                  (!target || !targetSupportsContinue) && 'opacity-50 cursor-not-allowed',
                )}
              >
                <div className="font-medium">{t('switch_cli.mode_continue')}</div>
                <div className="text-xs text-muted-foreground">
                  {target && !targetSupportsContinue
                    ? t('switch_cli.mode_continue_unsupported', { tool: cliToolLabel(target) })
                    : t('switch_cli.mode_continue_hint')}
                </div>
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-500 break-words">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('switch_cli.cancel')}
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={!target || loading}
          >
            {loading ? t('switch_cli.confirming') : t('switch_cli.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

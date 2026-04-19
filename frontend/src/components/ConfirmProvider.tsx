import { createContext, useCallback, useContext, useRef, useState, ReactNode, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Shadcn/Radix-based replacement for the native `window.confirm()` API.
 *
 * Why not window.confirm?
 *   - It synchronously blocks the event loop and forces the browser out of
 *     fullscreen mode, which interrupts the ccweb UX (terminal users often
 *     run fullscreen, monitor dashboards too).
 *   - It can't be styled, localized, or made keyboard/a11y-correct.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (await confirm({ description: '确认删除？', destructive: true })) {
 *     // proceed
 *   }
 *
 * The Provider is mounted once at the React root. A single dialog instance
 * is reused across every call-site; resolve() is captured per open() call.
 */

export interface ConfirmOptions {
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, confirm button is styled red (destructive intent). */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({});
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => { resolverRef.current = resolve; });
  }, []);

  // If the dialog is closed via Escape / click-outside before a button is pressed,
  // resolve as "cancel" so the caller isn't left hanging.
  const settle = useCallback((result: boolean) => {
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(result);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={open} onOpenChange={(o) => { if (!o) settle(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{options.title ?? '确认'}</DialogTitle>
            {options.description !== undefined && (
              <DialogDescription asChild>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {options.description}
                </div>
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {options.cancelLabel ?? '取消'}
            </Button>
            <ConfirmButton
              destructive={options.destructive}
              onClick={() => settle(true)}
            >
              {options.confirmLabel ?? '确定'}
            </ConfirmButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

function ConfirmButton({ destructive, onClick, children }: {
  destructive?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Focus the confirm button when it mounts (dialog just opened) so Enter
  // commits. Matches native confirm ergonomics.
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Button
      ref={ref}
      onClick={onClick}
      className={cn(destructive && 'bg-red-600 hover:bg-red-700 text-white')}
    >
      {children}
    </Button>
  );
}

/**
 * Get the async `confirm(options)` function. Throws if called outside <ConfirmProvider>.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}

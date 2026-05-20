// frontend/src/components/CliInteractivePromptCard.tsx
//
// Interactive choice card shown inside ChatOverlay / MobileChatView when the
// backend's cli-prompt-detector spots that the CLI is rendering an Ink-TUI
// select menu (e.g. claude --continue resume session selector). Buttons mirror
// the *parsed* options from the menu — clicking sends the matching digit to
// the PTY via the backend's cli-prompt-respond API. Claude's Ink select picks
// on digit press without needing Enter.
//
// Why labels-bound-to-digits instead of fixed 1/2/3 buttons:
// CLAUDE.md 历史教训 #10. If upstream reorders the menu we still send the
// *digit that currently belongs to* the chosen label, never a stale index.
//
// Visual language: mirrors ApprovalCard (centered, max-w-[90%], backdrop-blur,
// inset shadow ring, single-color accent) — sky/blue instead of amber.
import { useState } from 'react'
import { Terminal, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CliPromptKind, CliPromptOption } from '@/lib/websocket'

export interface CliPromptCardData {
  kind: CliPromptKind
  label: string
  detectedAt: number
  options: CliPromptOption[]
}

interface Props {
  prompt: CliPromptCardData
  /** Click handler: send the chosen digit to PTY. Returns a promise so the
   *  button can show a spinner; throws on failure (toast surfaces error). */
  onSelect: (digit: number) => Promise<void>
}

export function CliInteractivePromptCard({ prompt, onSelect }: Props) {
  const [pending, setPending] = useState<number | null>(null)

  const handleClick = async (digit: number) => {
    if (pending !== null) return
    setPending(digit)
    try {
      await onSelect(digit)
    } catch (err) {
      toast.error(`选择失败：${err instanceof Error ? err.message : String(err)}`)
      setPending(null)
    }
    // On success, the card will unmount when the detector emits dismissed —
    // no need to clear `pending` here; the component leaves with the spinner
    // still visible, which conveys "we sent it, waiting for CLI to react".
  }

  return (
    <div className="flex justify-center">
      <div
        className="max-w-[90%] w-full rounded-xl px-4 py-3 border border-sky-500/40 bg-sky-500/10 backdrop-blur-md"
        style={{
          boxShadow:
            '0 4px 14px rgba(14,165,233,0.18), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.05)',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Terminal className="h-4 w-4 text-sky-500 shrink-0" />
          <span className="text-sm font-medium text-sky-700 dark:text-sky-300">
            CLI 等待选择 · <span className="font-mono">{prompt.label}</span>
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {prompt.options.map((opt) => {
            const isPending = pending === opt.digit
            const otherPending = pending !== null && pending !== opt.digit
            return (
              <Button
                key={opt.digit}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() => void handleClick(opt.digit)}
                className={cn(
                  'justify-start text-xs h-auto py-2 px-3 text-foreground/90',
                  'border-sky-500/30 hover:bg-sky-500/10 hover:border-sky-500/60',
                  opt.recommended && 'border-sky-500/60 bg-sky-500/5',
                  otherPending && 'opacity-50',
                )}
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 mr-2 shrink-0 animate-spin" />
                ) : (
                  <span className="font-mono text-sky-700 dark:text-sky-300 mr-2 shrink-0">
                    {opt.digit}.
                  </span>
                )}
                <span className="flex-1 text-left whitespace-normal">{opt.label}</span>
                {opt.recommended && !isPending && (
                  <span className="text-[10px] text-sky-700 dark:text-sky-300 ml-2 shrink-0">
                    (推荐)
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

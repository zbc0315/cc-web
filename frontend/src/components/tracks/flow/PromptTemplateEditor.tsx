// frontend/src/components/tracks/flow/PromptTemplateEditor.tsx
// v-m：原生 textarea → shadcn Textarea；变量自动补全下拉色彩用 popover/accent 语义 token；
// 新建变量 window.prompt → 嵌入 shadcn Dialog 弹输入框（dark mode 友好）。
import { useState, useRef, useEffect, type ChangeEvent, type KeyboardEvent } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { VarDecl } from './flow-types-v3'

interface Props {
  value: string
  variables: VarDecl[]
  onChange: (value: string) => void
  /** 用户点 "+ 新建变量" 时回调；父级负责把变量加进 flow.variables */
  onCreateVariable?: (key: string) => void
  rows?: number
  placeholder?: string
}

type TriggerKind = '@' | '$'

interface DropdownState {
  trigger: TriggerKind
  startPos: number       // 触发字符在 textarea value 中的位置
  filter: string         // @ 后已输入的部分（用于过滤）
  selectedIndex: number  // 候选列表中当前 hover
}

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function PromptTemplateEditor({
  value,
  variables,
  onChange,
  onCreateVariable,
  rows = 5,
  placeholder,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [dropdown, setDropdown] = useState<DropdownState | null>(null)
  const [newVarOpen, setNewVarOpen] = useState(false)
  const [newVarName, setNewVarName] = useState('')
  const [newVarError, setNewVarError] = useState<string | null>(null)

  // 候选列表（含 "+ 新建变量"）
  const candidates = dropdown
    ? variables.filter((v) => v.key.toLowerCase().includes(dropdown.filter.toLowerCase()))
    : []
  const hasCreateOption = !!onCreateVariable
  const totalOptionCount = candidates.length + (hasCreateOption ? 1 : 0)

  const closeDropdown = () => setDropdown(null)

  const applyCompletion = (varKey: string) => {
    if (!taRef.current) return
    // 注意：openNewVarDialog 后 dropdown 已 close，applyCompletion 时不能依赖 dropdown
    // state；改用 ref 在 openNewVarDialog 时缓存 startPos。
    const startPos = pendingCompletionRef.current?.startPos ?? dropdown?.startPos
    const trigger = pendingCompletionRef.current?.trigger ?? dropdown?.trigger
    if (startPos === undefined || trigger === undefined) return
    const before = value.slice(0, startPos)
    const after = value.slice(taRef.current.selectionStart)
    const insertion = `${trigger}{${varKey}}`
    const newValue = before + insertion + after
    onChange(newValue)
    // 光标移到 `}` 后
    const newPos = before.length + insertion.length
    setTimeout(() => {
      if (taRef.current) {
        taRef.current.focus()
        taRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
    closeDropdown()
    pendingCompletionRef.current = null
  }

  // 触发"新建变量" Dialog 时缓存 startPos / trigger，dropdown 关闭后还能找回插入点。
  const pendingCompletionRef = useRef<{ startPos: number; trigger: TriggerKind } | null>(null)

  const openNewVarDialog = () => {
    if (!dropdown) return
    pendingCompletionRef.current = { startPos: dropdown.startPos, trigger: dropdown.trigger }
    setNewVarName(dropdown.filter || '')
    setNewVarError(null)
    setNewVarOpen(true)
    closeDropdown()
  }

  const submitNewVar = () => {
    const key = newVarName.trim()
    if (!IDENT_RE.test(key)) {
      setNewVarError('变量名只允许字母/数字/下划线，且不能以数字开头')
      return
    }
    if (variables.some((v) => v.key === key)) {
      setNewVarError(`变量 "${key}" 已存在`)
      return
    }
    if (onCreateVariable) onCreateVariable(key)
    setNewVarOpen(false)
    applyCompletion(key)
  }

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const caret = e.target.selectionStart
    onChange(newValue)

    // 检测是否刚输入了 @ 或 $（最后一个字符）
    const justTyped = newValue[caret - 1]
    if ((justTyped === '@' || justTyped === '$') && !dropdown) {
      setDropdown({
        trigger: justTyped,
        startPos: caret - 1,
        filter: '',
        selectedIndex: 0,
      })
      return
    }

    // 更新 filter（如果在 dropdown 模式中）
    if (dropdown) {
      const slice = newValue.slice(dropdown.startPos + 1, caret)
      // 如果 slice 含非合法 identifier 字符，关闭下拉
      if (!/^[a-zA-Z0-9_]*$/.test(slice)) {
        closeDropdown()
        return
      }
      setDropdown({ ...dropdown, filter: slice, selectedIndex: 0 })
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!dropdown) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeDropdown()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDropdown({ ...dropdown, selectedIndex: Math.min(dropdown.selectedIndex + 1, totalOptionCount - 1) })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDropdown({ ...dropdown, selectedIndex: Math.max(dropdown.selectedIndex - 1, 0) })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (totalOptionCount === 0) return
      e.preventDefault()
      const idx = dropdown.selectedIndex
      if (idx < candidates.length) {
        pendingCompletionRef.current = { startPos: dropdown.startPos, trigger: dropdown.trigger }
        applyCompletion(candidates[idx]!.key)
      } else if (hasCreateOption) {
        openNewVarDialog()
      }
    }
  }

  // 点击 textarea 外关闭下拉
  useEffect(() => {
    if (!dropdown) return
    const onClick = (e: Event) => {
      if (taRef.current && !taRef.current.contains(e.target as globalThis.Node)) {
        closeDropdown()
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [dropdown])

  return (
    <div className="relative">
      <Textarea
        ref={taRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        rows={rows}
        placeholder={placeholder}
        className="font-mono text-sm"
      />
      {dropdown && totalOptionCount > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md z-50"
        >
          {candidates.map((v, i) => (
            <div
              key={v.key}
              className={cn(
                'px-2 py-1 cursor-pointer text-sm',
                i === dropdown.selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                pendingCompletionRef.current = { startPos: dropdown.startPos, trigger: dropdown.trigger }
                applyCompletion(v.key)
              }}
              onMouseEnter={() => setDropdown({ ...dropdown, selectedIndex: i })}
            >
              <span className="font-mono">{dropdown.trigger}{v.key}</span>
              {v.description && (
                <span className="text-xs text-muted-foreground ml-2">{v.description}</span>
              )}
            </div>
          ))}
          {hasCreateOption && (
            <div
              className={cn(
                'px-2 py-1 cursor-pointer text-sm border-t border-border text-primary',
                dropdown.selectedIndex === candidates.length ? 'bg-accent' : 'hover:bg-accent/50',
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                openNewVarDialog()
              }}
              onMouseEnter={() => setDropdown({ ...dropdown, selectedIndex: candidates.length })}
            >
              + 新建变量
            </div>
          )}
        </div>
      )}

      <Dialog
        open={newVarOpen}
        onOpenChange={(o) => {
          if (!o) {
            // codex P2：关闭 Dialog（取消 / Esc / 点外面）时清 pendingCompletionRef，
            // 防止 stale 插入位置被后续 applyCompletion 误用。
            pendingCompletionRef.current = null
            setNewVarOpen(false)
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建变量</DialogTitle>
            <DialogDescription>
              变量名只允许字母/数字/下划线，且不能以数字开头。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-var-name" className="text-xs text-muted-foreground">
              变量名
            </Label>
            <Input
              id="new-var-name"
              autoFocus
              value={newVarName}
              onChange={(e) => { setNewVarName(e.target.value); setNewVarError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNewVar() } }}
              placeholder="例：query_topic"
              className="font-mono"
            />
            {newVarError && (
              <div className="text-xs text-destructive">{newVarError}</div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                pendingCompletionRef.current = null
                setNewVarOpen(false)
              }}
            >
              取消
            </Button>
            <Button size="sm" onClick={submitNewVar}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

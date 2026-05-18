// frontend/src/components/tracks/flow/PromptTemplateEditor.tsx
import { useState, useRef, useEffect, type ChangeEvent, type KeyboardEvent } from 'react'
import type { VarDecl } from './flow-types-v3'

interface Props {
  value: string
  variables: VarDecl[]
  onChange: (value: string) => void
  onCreateVariable?: (key: string) => void   // 用户点 "+ 新建变量" 时回调；父级弹 popover
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

  // 候选列表（含 "+ 新建变量"）
  const candidates = dropdown
    ? variables.filter((v) => v.key.toLowerCase().includes(dropdown.filter.toLowerCase()))
    : []
  const hasCreateOption = !!onCreateVariable
  const totalOptionCount = candidates.length + (hasCreateOption ? 1 : 0)

  const closeDropdown = () => setDropdown(null)

  const applyCompletion = (varKey: string) => {
    if (!dropdown || !taRef.current) return
    const before = value.slice(0, dropdown.startPos)
    const after = value.slice(taRef.current.selectionStart)
    const insertion = `${dropdown.trigger}{${varKey}}`
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
        applyCompletion(candidates[idx]!.key)
      } else if (hasCreateOption && onCreateVariable) {
        // 触发新建变量 popover；父级负责弹界面并最终调 applyCompletion via onCreateVariable
        const newKey = window.prompt('新变量名（key，valid identifier）:', dropdown.filter || '')
        if (newKey && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newKey)) {
          onCreateVariable(newKey)
          applyCompletion(newKey)
        }
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
      <textarea
        ref={taRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-2 py-1 rounded border text-sm font-mono"
      />
      {dropdown && totalOptionCount > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded border bg-white shadow-lg z-50">
          {candidates.map((v, i) => (
            <div
              key={v.key}
              className={[
                'px-2 py-1 cursor-pointer text-sm',
                i === dropdown.selectedIndex ? 'bg-blue-100' : 'hover:bg-gray-50',
              ].join(' ')}
              onMouseDown={(e) => {
                e.preventDefault()
                applyCompletion(v.key)
              }}
              onMouseEnter={() => setDropdown({ ...dropdown, selectedIndex: i })}
            >
              <span className="font-mono">{dropdown.trigger}{v.key}</span>
              {v.description && (
                <span className="text-xs text-gray-400 ml-2">{v.description}</span>
              )}
            </div>
          ))}
          {hasCreateOption && (
            <div
              className={[
                'px-2 py-1 cursor-pointer text-sm border-t text-blue-600',
                dropdown.selectedIndex === candidates.length ? 'bg-blue-100' : 'hover:bg-gray-50',
              ].join(' ')}
              onMouseDown={(e) => {
                e.preventDefault()
                const newKey = window.prompt('新变量名（key，valid identifier）:', dropdown.filter || '')
                if (newKey && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newKey) && onCreateVariable) {
                  onCreateVariable(newKey)
                  applyCompletion(newKey)
                }
              }}
              onMouseEnter={() => setDropdown({ ...dropdown, selectedIndex: candidates.length })}
            >
              + 新建变量
            </div>
          )}
        </div>
      )}
    </div>
  )
}

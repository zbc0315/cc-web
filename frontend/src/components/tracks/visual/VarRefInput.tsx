import { useEffect, useRef, useState } from 'react'
import type { Literal, VarRef } from './graph-types'

interface Props {
  value: VarRef | Literal
  candidates: string[]
  placeholder?: string
  onChange: (v: VarRef | Literal) => void
}

export function VarRefInput({ value, candidates, placeholder, onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [showSuggest, setShowSuggest] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurRef = useRef(false)

  useEffect(() => {
    if (editing) {
      if (value.kind === 'var') setText('@' + value.path.join('.'))
      else setText(value.raw)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [editing, value])

  function commit(newText: string): void {
    skipBlurRef.current = true
    if (newText.startsWith('@')) {
      const path = newText.slice(1).split('.').filter((s) => s.length > 0)
      if (path.length > 0) {
        onChange({ kind: 'var', path })
        setEditing(false)
        return
      }
    }
    onChange({ kind: 'lit', raw: newText })
    setEditing(false)
  }

  const filteredSuggest = candidates.filter((c) =>
    c.toLowerCase().includes(text.slice(1).toLowerCase()),
  )

  if (!editing) {
    if (value.kind === 'var') {
      return (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300 text-sm font-mono"
        >
          @{value.path.join('.')}
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="px-2 py-0.5 rounded border border-gray-300 text-sm font-mono text-gray-700 hover:bg-gray-50"
      >
        {value.raw || <span className="italic text-gray-400">{placeholder ?? '(空)'}</span>}
      </button>
    )
  }

  return (
    <div className="relative inline-block">
      <input
        ref={inputRef}
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          setShowSuggest(e.target.value.startsWith('@'))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(text) }
          if (e.key === 'Escape') { e.preventDefault(); skipBlurRef.current = true; setEditing(false) }
        }}
        onBlur={() => setTimeout(() => {
          if (skipBlurRef.current) { skipBlurRef.current = false; return }
          commit(text)
        }, 100)}
        className="px-2 py-0.5 rounded border border-blue-400 text-sm font-mono outline-none w-48"
      />
      {showSuggest && filteredSuggest.length > 0 && (
        <ul className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded shadow text-sm z-10 max-h-48 overflow-auto">
          {filteredSuggest.slice(0, 10).map((c) => (
            <li
              key={c}
              className="px-2 py-1 hover:bg-blue-50 cursor-pointer font-mono"
              onMouseDown={() => commit('@' + c)}
            >
              @{c}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// frontend/src/components/tracks/graph/IdentifierInput.tsx
import { useState } from 'react'

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export function IdentifierInput({ value, onChange, placeholder }: Props) {
  const [touched, setTouched] = useState(false)
  const valid = IDENT_RE.test(value) || value === ''
  return (
    <div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        className={[
          'w-full px-2 py-1 rounded border text-sm font-mono',
          touched && !valid ? 'border-red-500' : 'border-gray-300',
        ].join(' ')}
      />
      {touched && !valid && (
        <div className="text-xs text-red-600 mt-1">
          仅允许字母/数字/下划线，不能以数字开头
        </div>
      )}
    </div>
  )
}

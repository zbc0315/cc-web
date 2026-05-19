// frontend/src/components/tracks/flow/IdentifierInput.tsx
// v-m：原生 input → shadcn Input；border-red-500 → border-destructive；
// text-red-600 → text-destructive。
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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
      <Input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        className={cn(
          'h-8 text-sm font-mono',
          touched && !valid && 'border-destructive focus-visible:ring-destructive',
        )}
      />
      {touched && !valid && (
        <div className="text-xs text-destructive mt-1">
          仅允许字母/数字/下划线，不能以数字开头
        </div>
      )}
    </div>
  )
}

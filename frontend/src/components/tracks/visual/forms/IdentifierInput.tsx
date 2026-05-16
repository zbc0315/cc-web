import { useState } from 'react'

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

interface Props {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
}

export function IdentifierInput({ value, onChange, className, placeholder }: Props) {
  const [touched, setTouched] = useState(false)
  const ok = IDENT_RE.test(value)
  const showError = touched && !ok && value.length > 0
  return (
    <div className="inline-flex flex-col gap-0.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        className={[
          'px-2 py-0.5 rounded border text-sm font-mono',
          showError ? 'border-red-500' : 'border-gray-300',
          className ?? '',
        ].join(' ')}
      />
      {showError && (
        <span className="text-[10px] text-red-600 leading-none">
          只能用字母/数字/下划线，首字符不能是数字
        </span>
      )}
    </div>
  )
}

export function isValidIdent(s: string): boolean {
  return IDENT_RE.test(s)
}

import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TerminalSearchProps {
  onSearch: (term: string, options: { caseSensitive: boolean; regex: boolean }) => boolean;
  onSearchNext: (term: string, options: { caseSensitive: boolean; regex: boolean }) => boolean;
  onSearchPrev: (term: string, options: { caseSensitive: boolean; regex: boolean }) => boolean;
  onClear: () => void;
  onClose: () => void;
}

export function TerminalSearch({ onSearch, onSearchNext, onSearchPrev, onClear, onClose }: TerminalSearchProps) {
  const [term, setTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const options = useMemo(() => ({ caseSensitive, regex: useRegex }), [caseSensitive, useRegex]);

  const handleChange = (value: string) => {
    setTerm(value);
    if (value) onSearch(value, options);
    else onClear();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (!term) return;
      e.shiftKey ? onSearchPrev(term, options) : onSearchNext(term, options);
    }
    if (e.key === 'Escape') {
      onClear();
      onClose();
    }
  };

  return (
    <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-background border border-border rounded-md shadow-sm px-2 py-1">
      <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <Input
        ref={inputRef}
        value={term}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="搜索..."
        className="h-6 w-44 text-xs border-0 p-0 focus-visible:ring-0 bg-transparent"
      />
      <button
        title="区分大小写"
        onClick={() => {
          const next = !caseSensitive;
          setCaseSensitive(next);
          if (term) onSearch(term, { ...options, caseSensitive: next });
        }}
        className={cn('text-[10px] px-1 rounded font-mono transition-colors', caseSensitive ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}
      >Aa</button>
      <button
        title="正则表达式"
        onClick={() => {
          const next = !useRegex;
          setUseRegex(next);
          if (term) onSearch(term, { ...options, regex: next });
        }}
        className={cn('text-[10px] px-1 rounded font-mono transition-colors', useRegex ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}
      >.*</button>
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { if (term) onSearchPrev(term, options); }} disabled={!term}>
        <ChevronUp className="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { if (term) onSearchNext(term, options); }} disabled={!term}>
        <ChevronDown className="h-3 w-3" />
      </Button>
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { onClear(); onClose(); }}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

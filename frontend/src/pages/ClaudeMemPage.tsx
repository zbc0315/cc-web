import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, RefreshCw, Brain, FileText, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  getClaudeMemStatus, listClaudeMemProjects, listClaudeMemObservations, listClaudeMemSessionSummaries,
  type ClaudeMemStatus, type ClaudeMemObservation, type ClaudeMemProject, type ClaudeMemSessionSummary,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 30;

// Same heuristic as App.tsx / MobileProjectList — coarse pointer + narrow width.
const IS_MOBILE_DEVICE =
  window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;

// Known observation types → badge color. Unknown types fall back to neutral.
const TYPE_COLORS: Record<string, string> = {
  discovery: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30',
  feature: 'bg-green-500/15 text-green-600 dark:text-green-300 border-green-500/30',
  change: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  bugfix: 'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30',
  decision: 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30',
  security_alert: 'bg-red-600/20 text-red-700 dark:text-red-300 border-red-600/40',
  security_note: 'bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/30',
};
const TYPE_DEFAULT = 'bg-muted text-muted-foreground border-border';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function ObservationCard({ obs }: { obs: ClaudeMemObservation }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = !!obs.narrative || obs.facts.length > 0 || obs.filesModified.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
            TYPE_COLORS[obs.type] ?? TYPE_DEFAULT
          )}
        >
          {obs.type}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug">{obs.title ?? '(untitled)'}</div>
          {obs.subtitle && (
            <div className="mt-0.5 text-sm text-muted-foreground">{obs.subtitle}</div>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground" title={new Date(obs.createdAt).toLocaleString()}>
          {relativeTime(obs.createdAt)}
        </span>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {obs.narrative && (
            <p className="whitespace-pre-wrap text-sm text-foreground/80">{obs.narrative}</p>
          )}
          {obs.facts.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/80">
              {obs.facts.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
          {obs.filesModified.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {obs.filesModified.map((f, i) => (
                <span key={i} className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" />{f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5">{obs.project}</span>
        {obs.agentType && <span>· {obs.agentType}</span>}
        {hasMore && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'less' : 'more'}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</div>
      <p className="whitespace-pre-wrap text-sm text-foreground/80">{value}</p>
    </div>
  );
}

function SummaryCard({ sum }: { sum: ClaudeMemSessionSummary }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const hasMore =
    !!(sum.investigated || sum.learned || sum.completed || sum.nextSteps || sum.notes) ||
    sum.filesEdited.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="shrink-0 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300">
          {t('claudemem.summary_badge')}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug line-clamp-2">{sum.request ?? '(no request)'}</div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground" title={new Date(sum.createdAt).toLocaleString()}>
          {relativeTime(sum.createdAt)}
        </span>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <Field label={t('claudemem.sum_investigated')} value={sum.investigated} />
          <Field label={t('claudemem.sum_learned')} value={sum.learned} />
          <Field label={t('claudemem.sum_completed')} value={sum.completed} />
          <Field label={t('claudemem.sum_next_steps')} value={sum.nextSteps} />
          <Field label={t('claudemem.sum_notes')} value={sum.notes} />
          {sum.filesEdited.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sum.filesEdited.map((f, i) => (
                <span key={i} className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" />{f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5">{sum.project}</span>
        {hasMore && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
            {expanded ? 'less' : 'more'}
          </button>
        )}
      </div>
    </div>
  );
}

export function ClaudeMemPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [status, setStatus] = useState<ClaudeMemStatus | null | 'loading'>('loading');
  const [projects, setProjects] = useState<ClaudeMemProject[]>([]);
  const [tab, setTab] = useState<'observations' | 'summaries'>('observations');
  const [project, setProject] = useState<string>('all');
  const [type, setType] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [items, setItems] = useState<ClaudeMemObservation[]>([]);
  const [summaries, setSummaries] = useState<ClaudeMemSessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);

  // Status + projects on mount.
  useEffect(() => {
    void (async () => {
      const s = await getClaudeMemStatus();
      setStatus(s);
      if (s?.available) {
        try { setProjects(await listClaudeMemProjects()); } catch { /* ignore */ }
      }
    })();
  }, []);

  // Debounce search input.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (nextOffset: number, append: boolean) => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      if (tab === 'summaries') {
        // /summaries supports project/limit/offset only (no type or full-text q).
        const r = await listClaudeMemSessionSummaries({
          project: project === 'all' ? undefined : project,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        if (reqId !== reqIdRef.current) return; // a newer request superseded us
        setTotal(r.total);
        setOffset(nextOffset);
        setSummaries((prev) => (append ? [...prev, ...r.items] : r.items));
      } else {
        const r = await listClaudeMemObservations({
          project: project === 'all' ? undefined : project,
          type: type === 'all' ? undefined : type,
          q: debouncedSearch || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        if (reqId !== reqIdRef.current) return; // a newer request superseded us
        setTotal(r.total);
        setOffset(nextOffset);
        setItems((prev) => (append ? [...prev, ...r.items] : r.items));
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [tab, project, type, debouncedSearch]);

  // Reload from the top whenever a filter changes (only once available).
  useEffect(() => {
    if (status === 'loading' || !status?.available) return;
    void load(0, false);
  }, [status, load]);

  const types = ['discovery', 'feature', 'change', 'bugfix', 'decision', 'security_alert', 'security_note'];
  const shownCount = tab === 'observations' ? items.length : summaries.length;

  const Header = (
    <header
      className="border-b sticky top-0 bg-background z-10"
      style={IS_MOBILE_DEVICE ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}
    >
      <div className="w-full px-4 sm:px-6 h-14 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(IS_MOBILE_DEVICE ? '/mobile' : '/')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t('claudemem.back')}
        </Button>
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          <span className="font-semibold text-lg">{t('claudemem.title')}</span>
        </div>
      </div>
    </header>
  );

  if (status === 'loading') {
    return <div className="min-h-screen bg-background">{Header}</div>;
  }

  if (!status || !status.available) {
    return (
      <div className="min-h-screen bg-background">
        {Header}
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">{t('claudemem.unavailable_title')}</h2>
          <p className="text-muted-foreground text-sm">{t('claudemem.unavailable_desc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {Header}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* View tabs: observations vs session summaries */}
        <div className="flex gap-1 mb-4 border-b border-border">
          {(['observations', 'summaries'] as const).map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={cn(
                '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
                tab === tb
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tb === 'observations' ? t('claudemem.tab_observations') : t('claudemem.tab_summaries')}
              {status.counts && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {tb === 'observations' ? status.counts.observations : status.counts.summaries}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t('claudemem.all_projects')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('claudemem.all_projects')}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.project} value={p.project}>
                  {p.project} ({p.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tab === 'observations' && (
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('claudemem.search_placeholder')}
                className="pl-8"
              />
            </div>
          )}
          <Button variant="outline" size="icon" onClick={() => void load(0, false)} title={t('claudemem.refresh')}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>

        {/* Type chips (observations only) */}
        {tab === 'observations' && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setType('all')}
            className={cn(
              'px-2 py-0.5 rounded-full text-xs border transition-colors',
              type === 'all'
                ? 'bg-primary text-primary-foreground border-transparent font-medium'
                : 'bg-muted text-muted-foreground border-border hover:border-muted-foreground/40'
            )}
          >
            {t('claudemem.all_types')}
          </button>
          {types.map((tp) => (
            <button
              key={tp}
              onClick={() => setType(tp)}
              className={cn(
                'px-2 py-0.5 rounded-full text-xs border transition-colors',
                type === tp
                  ? 'bg-primary text-primary-foreground border-transparent font-medium'
                  : 'bg-muted text-muted-foreground border-border hover:border-muted-foreground/40'
              )}
            >
              {tp}
            </button>
          ))}
        </div>
        )}

        <div className="text-xs text-muted-foreground mb-3">
          {t('claudemem.count', { count: total })}
        </div>

        {/* List */}
        <div className="space-y-3">
          {tab === 'observations'
            ? items.map((obs) => <ObservationCard key={obs.id} obs={obs} />)
            : summaries.map((s) => <SummaryCard key={s.id} sum={s} />)}
        </div>

        {shownCount === 0 && !loading && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {t('claudemem.empty')}
          </div>
        )}

        {shownCount < total && (
          <div className="flex justify-center mt-6">
            <Button variant="outline" onClick={() => void load(offset + PAGE_SIZE, true)} disabled={loading}>
              {loading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t('claudemem.load_more')}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { FileText, Download, Lock, Search, BookOpen } from 'lucide-react';
import { Panel, PanelSection, Badge, Input } from '../ui';
import { getLibraryResources } from '../../lib/academyService';
import type { LibraryResource } from '../../lib/supabase';

const CATEGORY_LABEL: Record<LibraryResource['category'], string> = {
  pdf: 'PDF',
  checklist: 'Checklist',
  pop: 'POP',
  template: 'Template',
  ebook: 'E-book',
};

type TabKey = 'all' | 'ebook' | 'checklist' | 'pop' | 'template';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'ebook', label: 'E-books' },
  { key: 'checklist', label: 'Checklists' },
  { key: 'pop', label: 'POPs' },
  { key: 'template', label: 'Templates' },
];

function matchesSearch(r: LibraryResource, term: string): boolean {
  if (!term) return true;
  const haystack = [
    r.title, r.description ?? '', CATEGORY_LABEL[r.category], r.publisher ?? '', ...(r.themes ?? []),
  ].join(' ').toLowerCase();
  return haystack.includes(term);
}

export function BibliotecaPage() {
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [coverFailed, setCoverFailed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    getLibraryResources().then(r => {
      if (cancelled) return;
      setResources(r);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const term = search.trim().toLowerCase();
  const searched = useMemo(() => resources.filter(r => matchesSearch(r, term)), [resources, term]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { all: searched.length, ebook: 0, checklist: 0, pop: 0, template: 0 };
    for (const r of searched) {
      if (r.category === 'ebook' || r.category === 'checklist' || r.category === 'pop' || r.category === 'template') {
        c[r.category] += 1;
      }
    }
    return c;
  }, [searched]);

  const showEbooks = tab === 'all' || tab === 'ebook';
  const ebooks = showEbooks ? searched.filter(r => r.category === 'ebook') : [];
  const otherResources = tab === 'all' || tab === 'ebook'
    ? searched.filter(r => r.category !== 'ebook')
    : searched.filter(r => r.category === tab);

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando biblioteca...</PanelSection></Panel>;
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelSection padding="md" className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-title">Biblioteca</h2>
            <p className="text-sm text-fg-subtle mt-1">Materiais práticos para apoiar sua operação e seu desenvolvimento.</p>
          </div>
          <Input
            icon={<Search />}
            placeholder="Buscar na biblioteca"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-72 flex-shrink-0"
          />
        </PanelSection>

        <PanelSection padding="sm" className="overflow-x-auto">
          <div className="flex items-center gap-5 min-w-max">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 pb-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key ? 'text-accent border-accent' : 'text-fg-muted border-transparent hover:text-fg'
                }`}
              >
                {t.label}
                <span className="text-xs tabular-nums text-fg-subtle">{counts[t.key]}</span>
              </button>
            ))}
          </div>
        </PanelSection>
      </Panel>

      {searched.length === 0 && (
        <Panel><PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
          {term ? 'Nenhum material encontrado para essa busca.' : 'Nenhum material nesta categoria.'}
        </PanelSection></Panel>
      )}

      {showEbooks && ebooks.length > 0 && (
        <div>
          <h3 className="text-title">E-books</h3>
          <p className="text-sm text-fg-subtle mt-0.5 mb-3">{ebooks.length} material{ebooks.length === 1 ? '' : 'is'} disponíve{ebooks.length === 1 ? 'l' : 'is'}</p>
          <div className="space-y-4">
            {ebooks.map(r => <EbookCard key={r.id} resource={r} coverFailed={!!coverFailed[r.id]} onCoverError={() => setCoverFailed(prev => ({ ...prev, [r.id]: true }))} />)}
          </div>
        </div>
      )}

      {otherResources.length > 0 && (
        <div>
          {(tab === 'all' || tab === 'ebook') && <h3 className="text-title mb-3">Continue explorando</h3>}
          <Panel>
            {otherResources.map(r => (
              <PanelSection key={r.id} padding="md" className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent flex-shrink-0">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-fg text-sm">{r.title}</p>
                    <p className="text-xs text-fg-muted">{r.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="neutral">{CATEGORY_LABEL[r.category]}</Badge>
                  {r.external_url ? (
                    <a href={r.external_url} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-strong">
                      <Download size={16} />
                    </a>
                  ) : (
                    <span title="Em breve" className="text-fg-subtle"><Lock size={14} /></span>
                  )}
                </div>
              </PanelSection>
            ))}
          </Panel>
        </div>
      )}
    </div>
  );
}

function EbookCard({ resource: r, coverFailed, onCoverError }: { resource: LibraryResource; coverFailed: boolean; onCoverError: () => void }) {
  const downloadName = r.external_url ? r.external_url.split('/').pop() : undefined;

  return (
    <Panel>
      <PanelSection padding="md" className="flex flex-col gap-5 md:flex-row">
        <div className="w-full md:w-64 flex-shrink-0">
          <div className="aspect-[4/3] w-full rounded-lg overflow-hidden bg-surface-3 border border-edge/60 flex items-center justify-center">
            {r.cover_url && !coverFailed ? (
              <img
                src={r.cover_url}
                alt={`Capa de ${r.title}`}
                className="w-full h-full object-cover"
                onError={onCoverError}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-fg-subtle">
                <BookOpen size={28} />
                <span className="text-xs">Capa indisponível</span>
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">
            E-BOOK{r.subject ? ` · ${r.subject.toUpperCase()}` : ''}
          </p>
          <h4 className="text-lg font-semibold text-fg mt-1">{r.title}</h4>
          {r.publisher && <p className="text-sm text-fg-muted mt-1">{r.publisher}</p>}
          {r.description && <p className="text-sm text-fg-subtle mt-2">{r.description}</p>}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs text-fg-subtle divide-x divide-edge [&>*:not(:first-child)]:pl-3">
            {r.page_count != null && <span>{r.page_count} páginas</span>}
            {r.format && <span>Formato {r.format}</span>}
            <span>Disponível na biblioteca</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4">
            {r.external_url && (
              <a
                href={r.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-control bg-accent hover:bg-accent-strong text-white text-sm font-semibold px-4 py-2 transition-colors"
              >
                <BookOpen size={15} /> Ler e-book
              </a>
            )}
            {r.external_url && (
              <a
                href={r.external_url}
                download={downloadName}
                className="inline-flex items-center gap-2 rounded-control bg-surface-3 hover:bg-edge text-fg border border-edge text-sm font-semibold px-4 py-2 transition-colors"
              >
                <Download size={15} /> Baixar PDF
              </a>
            )}
          </div>
        </div>

        {r.themes && r.themes.length > 0 && (
          <div className="w-full md:w-56 flex-shrink-0 md:border-l md:border-edge md:pl-5">
            <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2">Neste material</p>
            <ul className="space-y-1.5">
              {r.themes.map(theme => (
                <li key={theme} className="flex items-center gap-2 text-sm text-fg-muted">
                  <FileText size={13} className="text-fg-subtle flex-shrink-0" />
                  {theme}
                </li>
              ))}
            </ul>
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}

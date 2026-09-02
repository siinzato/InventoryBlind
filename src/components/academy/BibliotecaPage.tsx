import { useEffect, useMemo, useState } from 'react';
import { FileText, Download, Lock, Search, BookOpen, ExternalLink, Loader2 } from 'lucide-react';
import { Panel, PanelSection, Badge, Input, Select } from '../ui';
import { getLibraryResources, getLibraryResourceReadUrl, downloadLibraryResource } from '../../lib/academyService';
import {
  CATEGORY_LABEL, EMPTY_EBOOK_FILTERS, EXTERNAL_CONTENT_NOTICE,
  applyEbookFilters, authorLine, creditEntries, deriveEbookFilterOptions,
  isExternalContent, matchesLibrarySearch, metaLine, resolveEbookAccess,
  type EbookFilters,
} from '../../lib/academy/libraryEbooks';
import type { LibraryResource } from '../../lib/supabase';

type TabKey = 'all' | 'ebook' | 'checklist' | 'pop' | 'template';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'ebook', label: 'E-books' },
  { key: 'checklist', label: 'Checklists' },
  { key: 'pop', label: 'POPs' },
  { key: 'template', label: 'Templates' },
];

export function BibliotecaPage() {
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<EbookFilters>(EMPTY_EBOOK_FILTERS);
  const [coverFailed, setCoverFailed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    getLibraryResources()
      .then(r => {
        if (cancelled) return;
        setResources(r);
        setLoadError(false);
      })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const term = search.trim().toLowerCase();
  const searched = useMemo(() => resources.filter(r => matchesLibrarySearch(r, term)), [resources, term]);

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
  const searchedEbooks = useMemo(() => searched.filter(r => r.category === 'ebook'), [searched]);
  const filterOptions = useMemo(() => deriveEbookFilterOptions(searchedEbooks), [searchedEbooks]);
  const ebooks = useMemo(
    () => (showEbooks ? applyEbookFilters(searchedEbooks, filters) : []),
    [showEbooks, searchedEbooks, filters]
  );

  const otherResources = tab === 'all' || tab === 'ebook'
    ? searched.filter(r => r.category !== 'ebook')
    : searched.filter(r => r.category === tab);

  const hasEbookFilters =
    filterOptions.subjects.length > 0 || filterOptions.levels.length > 0 || filterOptions.languages.length > 0;
  const filtersActive = filters.subject !== 'all' || filters.level !== 'all' || filters.language !== 'all';

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando biblioteca...</PanelSection></Panel>;
  }

  if (loadError) {
    return (
      <Panel><PanelSection padding="lg" className="text-center text-sm text-fg-muted">
        Não foi possível carregar a biblioteca agora. Atualize a página para tentar novamente.
      </PanelSection></Panel>
    );
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
            placeholder="Buscar por título, autor, instituição ou tema"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-80 flex-shrink-0"
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

        {/* Filtros de e-book — opções derivadas dos registros carregados, então só aparecem
            quando existe pelo menos um valor real para filtrar. */}
        {showEbooks && hasEbookFilters && (
          <PanelSection padding="sm" className="flex flex-wrap items-center gap-2">
            {filterOptions.subjects.length > 0 && (
              <Select
                aria-label="Filtrar por área"
                value={filters.subject}
                onChange={e => setFilters(f => ({ ...f, subject: e.target.value }))}
                className="w-auto"
              >
                <option value="all">Área: todas</option>
                {filterOptions.subjects.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
            {filterOptions.levels.length > 0 && (
              <Select
                aria-label="Filtrar por nível"
                value={filters.level}
                onChange={e => setFilters(f => ({ ...f, level: e.target.value }))}
                className="w-auto"
              >
                <option value="all">Nível: todos</option>
                {filterOptions.levels.map(l => <option key={l} value={l}>{l}</option>)}
              </Select>
            )}
            {filterOptions.languages.length > 0 && (
              <Select
                aria-label="Filtrar por idioma"
                value={filters.language}
                onChange={e => setFilters(f => ({ ...f, language: e.target.value }))}
                className="w-auto"
              >
                <option value="all">Idioma: todos</option>
                {filterOptions.languages.map(l => <option key={l} value={l}>{l}</option>)}
              </Select>
            )}
            {filtersActive && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_EBOOK_FILTERS)}
                className="text-xs font-medium text-accent hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </PanelSection>
        )}
      </Panel>

      {searched.length === 0 && (
        <Panel><PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
          {term ? 'Nenhum material encontrado para essa busca.' : 'Nenhum material nesta categoria.'}
        </PanelSection></Panel>
      )}

      {showEbooks && searchedEbooks.length > 0 && ebooks.length === 0 && (
        <Panel><PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
          Nenhum e-book corresponde aos filtros selecionados.
        </PanelSection></Panel>
      )}

      {showEbooks && ebooks.length > 0 && (
        <div>
          <h3 className="text-title">E-books</h3>
          <p className="text-sm text-fg-subtle mt-0.5 mb-3">{ebooks.length} material{ebooks.length === 1 ? '' : 'is'} disponíve{ebooks.length === 1 ? 'l' : 'is'}</p>
          <div className="space-y-4">
            {ebooks.map(r => (
              <EbookCard
                key={r.id}
                resource={r}
                coverFailed={!!coverFailed[r.id]}
                onCoverError={() => setCoverFailed(prev => ({ ...prev, [r.id]: true }))}
              />
            ))}
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

/** Tintas da capa genérica — classes literais completas para o Tailwind conseguir
 *  encontrá-las no build. A escolha é determinística pelo título, então a mesma obra sempre
 *  tem a mesma capa e a estante não fica monocromática. */
const COVER_TINTS = [
  'from-accent/15 to-accent/[0.04]',
  'from-emerald-500/15 to-emerald-500/[0.04]',
  'from-amber-500/15 to-amber-500/[0.04]',
  'from-violet-500/15 to-violet-500/[0.04]',
  'from-sky-500/15 to-sky-500/[0.04]',
  'from-rose-500/15 to-rose-500/[0.04]',
];

const COVER_RULES = [
  'bg-accent/50', 'bg-emerald-500/50', 'bg-amber-500/50',
  'bg-violet-500/50', 'bg-sky-500/50', 'bg-rose-500/50',
];

function tintIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  return hash % COVER_TINTS.length;
}

/** Capa padrão para material sem `cover_url`: só a área e o título da obra, no tom do próprio
 *  design system. Não é imagem gerada nem arquivo — é o card desenhando a capa, então vale
 *  automaticamente para qualquer e-book novo, e um `cover_url` real sempre tem prioridade. */
function GenericCover({ title, subject }: { title: string; subject: string | null }) {
  const i = tintIndex(title);

  return (
    <div className={`relative flex h-full w-full flex-col justify-between bg-gradient-to-br ${COVER_TINTS[i]} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-subtle truncate">
          {subject ?? 'E-book'}
        </span>
        <BookOpen size={13} className="flex-shrink-0 text-fg-subtle" />
      </div>

      <p className="font-display text-[15px] font-semibold leading-snug text-fg line-clamp-4 [text-wrap:balance]" title={title}>
        {title}
      </p>

      <span className={`h-0.5 w-10 flex-shrink-0 rounded-full ${COVER_RULES[i]}`} />
    </div>
  );
}

function EbookCard({ resource: r, coverFailed, onCoverError }: { resource: LibraryResource; coverFailed: boolean; onCoverError: () => void }) {
  const [busy, setBusy] = useState<'read' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const access = resolveEbookAccess(r);
  const authors = authorLine(r);
  const credits = creditEntries(r);
  const meta = metaLine(r);
  const external = isExternalContent(r);

  async function openReader() {
    if (busy) return;
    setBusy('read');
    setError(null);
    // A guia é aberta antes do await: navegadores bloqueiam window.open disparado depois de
    // uma operação assíncrona, porque deixa de contar como gesto do usuário.
    const tab = window.open('', '_blank', 'noopener,noreferrer');
    try {
      const url = await getLibraryResourceReadUrl(r);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (thrown) {
      tab?.close();
      setError(thrown instanceof Error ? thrown.message : 'Não foi possível abrir o material.');
    } finally {
      setBusy(null);
    }
  }

  async function startDownload() {
    if (busy) return;
    setBusy('download');
    setError(null);
    try {
      await downloadLibraryResource(r);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Não foi possível baixar o material.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      <PanelSection padding="md" className="flex flex-col gap-5 md:flex-row">
        <div className="w-full md:w-56 flex-shrink-0">
          <div className="aspect-[4/3] w-full rounded-lg overflow-hidden bg-surface-3 border border-edge/60 flex items-center justify-center">
            {r.cover_url && !coverFailed ? (
              <img src={r.cover_url} alt={`Capa de ${r.title}`} className="w-full h-full object-cover" onError={onCoverError} />
            ) : (
              <GenericCover title={r.title} subject={r.subject} />
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">
            {external ? 'Conteúdo externo' : 'E-book'}{r.subject ? ` · ${r.subject}` : ''}
          </p>
          <h4 className="text-lg font-semibold text-fg mt-1">{r.title}</h4>

          {authors && <p className="text-sm text-fg-muted mt-1">{authors.label}: {authors.value}</p>}
          {r.publisher && <p className="text-sm text-fg-subtle mt-0.5">{r.publisher}</p>}
          {r.description && <p className="text-sm text-fg-subtle mt-2">{r.description}</p>}

          {meta.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs text-fg-subtle divide-x divide-edge [&>*:not(:first-child)]:pl-3">
              {meta.map(part => <span key={part}>{part}</span>)}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-4">
            {access.file ? (
              <>
                <button
                  type="button"
                  onClick={() => void openReader()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-control bg-accent hover:bg-accent-strong text-white text-sm font-semibold px-4 py-2 transition-colors disabled:opacity-60 disabled:pointer-events-none"
                >
                  {busy === 'read' ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />}
                  Ler e-book
                </button>
                <button
                  type="button"
                  onClick={() => void startDownload()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-control bg-surface-3 hover:bg-edge text-fg border border-edge text-sm font-semibold px-4 py-2 transition-colors disabled:opacity-60 disabled:pointer-events-none"
                >
                  {busy === 'download' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {busy === 'download' ? 'Baixando...' : 'Baixar PDF'}
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-2 text-xs text-fg-subtle"><Lock size={13} /> Arquivo em breve</span>
            )}

            {access.sourceUrl && (
              <a
                href={access.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
              >
                Fonte original <ExternalLink size={13} />
              </a>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        {(credits.length > 0 || external || (r.themes && r.themes.length > 0)) && (
          <div className="w-full md:w-64 flex-shrink-0 md:border-l md:border-edge md:pl-5 space-y-4">
            {credits.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2">Créditos da obra</p>
                <dl className="space-y-1 text-xs">
                  {credits.map(c => (
                    <div key={c.label} className="flex gap-1.5">
                      <dt className="text-fg-subtle flex-shrink-0">{c.label}:</dt>
                      <dd className="text-fg-muted min-w-0">
                        {c.href ? (
                          <a href={c.href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{c.value}</a>
                        ) : c.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {external && (
              <div>
                <Badge variant="neutral">Curadoria I.B Academy</Badge>
                <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">{EXTERNAL_CONTENT_NOTICE}</p>
              </div>
            )}

            {r.themes && r.themes.length > 0 && (
              <div>
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
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}

import { useMemo, useState } from 'react';
import {
  Rocket, ClipboardList, ShieldCheck, BrainCircuit, Plug, GraduationCap, HelpCircle, Building2,
  Search, ChevronDown, ArrowRight, LayoutGrid, MapPin, ListChecks, ClipboardCheck, EyeOff, X,
} from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { KB_CATEGORIES, PRODUCT_FAQ, ABOUT_CONTENT, type KbArticle } from '../../lib/knowledgeBaseContent';
import { PILARES, KNOWLEDGE_FAQ, type KnowledgeEntry } from '../../lib/academyContent';

interface KnowledgeCenterPageProps {
  onNavigateToAcademy: () => void;
}

const CATEGORY_ICON: Record<string, typeof Rocket> = {
  Rocket, ClipboardList, ShieldCheck, BrainCircuit, Plug,
};

const PILAR_ICON: Record<string, typeof LayoutGrid> = {
  LayoutGrid, MapPin, ListChecks, ClipboardCheck, EyeOff, ShieldCheck, BrainCircuit,
};

type SpecialTileId = 'academia' | 'faq' | 'sobre';

const SPECIAL_TILES: { id: SpecialTileId; label: string; description: string; icon: typeof GraduationCap }[] = [
  { id: 'academia', label: 'Academy InventoryBlind', description: 'A metodologia completa, em trilhas com certificado.', icon: GraduationCap },
  { id: 'faq', label: 'Perguntas Frequentes', description: 'Respostas diretas para as dúvidas mais comuns.', icon: HelpCircle },
  { id: 'sobre', label: 'Sobre o InventoryBlind', description: 'Nossa visão, a metodologia e o problema que resolvemos.', icon: Building2 },
];

function TileIconSquare({ Icon }: { Icon: typeof Rocket }) {
  return (
    <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
      <Icon size={18} />
    </div>
  );
}

function ArticleRow({ article }: { article: KbArticle }) {
  return (
    <PanelSection padding="md">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-fg text-sm">{article.title}</p>
        {article.comingSoon && <Badge variant="accent">Em breve</Badge>}
      </div>
      <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">{article.body}</p>
    </PanelSection>
  );
}

function FaqRow({ entry, open, onToggle }: { entry: KnowledgeEntry; open: boolean; onToggle: () => void }) {
  return (
    <PanelSection padding="md">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 text-left">
        <p className="font-semibold text-fg text-sm">{entry.title}</p>
        <ChevronDown size={16} className={`flex-shrink-0 text-fg-subtle transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="text-sm text-fg-muted mt-2.5 leading-relaxed">{entry.body}</p>}
    </PanelSection>
  );
}

/** Central de Conhecimento — Minha Conta → Recursos e Conhecimento. Página nova e isolada;
 *  não altera a I.B Academy nem a CentralConhecimentoPage.tsx já existente ali (que continua
 *  servindo o FAQ/glossário específicos do Método I.B.® dentro da própria Academy). Esta
 *  página cobre a documentação de PRODUTO como um todo, e usa a Academy real (via
 *  onNavigateToAcademy) em vez de duplicar seu conteúdo. */
export function KnowledgeCenterPage({ onNavigateToAcademy }: KnowledgeCenterPageProps) {
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openFaqTitle, setOpenFaqTitle] = useState<string | null>(null);

  const allFaq = useMemo<KnowledgeEntry[]>(() => [...PRODUCT_FAQ, ...KNOWLEDGE_FAQ], []);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const articles = KB_CATEGORIES.flatMap(cat =>
      cat.articles
        .filter(a => a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q))
        .map(a => ({ categoryLabel: cat.label, article: a }))
    );
    const faq = allFaq.filter(f => f.title.toLowerCase().includes(q) || f.body.toLowerCase().includes(q));
    return { articles, faq };
  }, [search, allFaq]);

  const activeCategory = KB_CATEGORIES.find(c => c.id === activeId) ?? null;
  const activeIsFaq = activeId === 'faq';
  const activeIsSobre = activeId === 'sobre';

  const handleTileClick = (id: string) => {
    if (id === 'academia') { onNavigateToAcademy(); return; }
    setActiveId(curr => (curr === id ? null : id));
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-fg tracking-tight">Central de Conhecimento InventoryBlind</h1>
        <p className="text-sm text-fg-muted mt-2 leading-relaxed">
          Aprenda a utilizar todos os recursos da plataforma, entenda metodologias de inventário inteligente e maximize a confiabilidade do seu estoque.
        </p>
      </div>

      <div className="relative max-w-xl">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setActiveId(null); }}
          placeholder="Pesquisar dúvidas, tutoriais e recursos..."
          className="w-full pl-10 pr-10 py-3 bg-surface-2 border border-edge rounded-xl text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg">
            <X size={15} />
          </button>
        )}
      </div>

      {searchResults ? (
        <div className="space-y-4">
          <p className="text-xs text-fg-subtle uppercase tracking-wide font-semibold">
            {searchResults.articles.length + searchResults.faq.length} resultado(s) para "{search}"
          </p>
          {searchResults.articles.length === 0 && searchResults.faq.length === 0 && (
            <Panel><PanelSection padding="lg" className="text-center text-fg-subtle text-sm">Nenhum resultado. Tente outra palavra-chave ou navegue pelas categorias abaixo.</PanelSection></Panel>
          )}
          {searchResults.articles.length > 0 && (
            <Panel>
              {searchResults.articles.map(({ categoryLabel, article }) => (
                <PanelSection key={article.id} padding="md">
                  <Badge variant="neutral">{categoryLabel}</Badge>
                  <p className="font-semibold text-fg text-sm mt-2">{article.title}</p>
                  <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">{article.body}</p>
                </PanelSection>
              ))}
            </Panel>
          )}
          {searchResults.faq.length > 0 && (
            <Panel>
              {searchResults.faq.map(entry => (
                <FaqRow key={entry.title} entry={entry} open={openFaqTitle === entry.title} onToggle={() => setOpenFaqTitle(curr => (curr === entry.title ? null : entry.title))} />
              ))}
            </Panel>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {KB_CATEGORIES.map(cat => {
              const Icon = CATEGORY_ICON[cat.icon] ?? Rocket;
              const active = activeId === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => handleTileClick(cat.id)}
                  className={`text-left p-5 rounded-2xl border transition-colors flex flex-col gap-3 ${
                    active ? 'border-accent bg-accent/5' : 'border-edge bg-surface-2 hover:border-accent/40 hover:bg-surface-3'
                  }`}
                >
                  <TileIconSquare Icon={Icon} />
                  <div>
                    <p className="font-semibold text-fg text-sm">{cat.label}</p>
                    <p className="text-xs text-fg-muted mt-1 leading-relaxed">{cat.description}</p>
                  </div>
                  <span className="text-xs text-fg-subtle mt-auto">{cat.articles.length} artigo{cat.articles.length !== 1 ? 's' : ''}</span>
                </button>
              );
            })}

            {SPECIAL_TILES.map(tile => {
              const active = activeId === tile.id;
              const Icon = tile.icon;
              return (
                <button
                  key={tile.id}
                  onClick={() => handleTileClick(tile.id)}
                  className={`text-left p-5 rounded-2xl border transition-colors flex flex-col gap-3 ${
                    active ? 'border-accent bg-accent/5' : 'border-edge bg-surface-2 hover:border-accent/40 hover:bg-surface-3'
                  }`}
                >
                  <TileIconSquare Icon={Icon} />
                  <div>
                    <p className="font-semibold text-fg text-sm">{tile.label}</p>
                    <p className="text-xs text-fg-muted mt-1 leading-relaxed">{tile.description}</p>
                  </div>
                  <span className="text-xs text-fg-subtle mt-auto flex items-center gap-1">
                    {tile.id === 'academia' ? <>Abrir Academy <ArrowRight size={11} /></> : tile.id === 'faq' ? `${allFaq.length} perguntas` : 'Ler mais'}
                  </span>
                </button>
              );
            })}
          </div>

          {activeCategory && (
            <Panel>
              {activeCategory.articles.map(article => <ArticleRow key={article.id} article={article} />)}
            </Panel>
          )}

          {activeIsFaq && (
            <Panel>
              {allFaq.map(entry => (
                <FaqRow key={entry.title} entry={entry} open={openFaqTitle === entry.title} onToggle={() => setOpenFaqTitle(curr => (curr === entry.title ? null : entry.title))} />
              ))}
            </Panel>
          )}

          {activeIsSobre && (
            <Panel>
              {ABOUT_CONTENT.sections.map(section => (
                <PanelSection key={section.heading} padding="md">
                  <p className="font-semibold text-fg text-sm">{section.heading}</p>
                  <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">{section.body}</p>
                </PanelSection>
              ))}
              <PanelSection padding="lg" className="text-center">
                <p className="text-base font-semibold text-fg italic">"{ABOUT_CONTENT.closingMessage}"</p>
              </PanelSection>
            </Panel>
          )}

          {!activeCategory && !activeIsFaq && !activeIsSobre && (
            <Panel>
              <PanelSection padding="md">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-section">Método I.B.® — 7 Pilares</p>
                  <button onClick={onNavigateToAcademy} className="text-xs font-semibold text-accent hover:underline flex items-center gap-1">
                    Ir para a I.B Academy <ArrowRight size={12} />
                  </button>
                </div>
                <p className="text-xs text-fg-subtle mb-3">A metodologia completa de inventário confiável, em trilhas com quiz e certificado.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PILARES.map(pilar => {
                    const Icon = PILAR_ICON[pilar.icon] ?? LayoutGrid;
                    return (
                      <div key={pilar.key} className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-3">
                        <Icon size={14} className="text-accent flex-shrink-0" />
                        <span className="text-xs font-medium text-fg-muted truncate">{pilar.order}. {pilar.title}</span>
                      </div>
                    );
                  })}
                </div>
              </PanelSection>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Download, Search, ShieldAlert } from 'lucide-react';
import { Panel, PanelSection, Table, Thead, Tr, Th, Td, Button, Input } from '../ui';
import { downloadFile } from '../../lib/productImportUtils';
import { getProductOrigins, type ProductOrigin } from '../../lib/productCatalog/catalogHistoryService';
import {
  QUALITY_CATEGORY_LABEL, type QualityCategory, type QualityIssue,
  type CatalogQualitySnapshot,
} from '../../lib/productCatalog/catalogQuality';

const IMPACT_RANK: Record<QualityIssue['impact'], number> = {
  'Bloqueia integração': 0,
  'Bloqueia conferência': 1,
  'Afeta rastreabilidade': 2,
  'Afeta endereçamento': 3,
  'Afeta planejamento': 4,
  'Informação complementar': 5,
};

interface QueueRow {
  productId: string;
  name: string;
  sku: string;
  pendingLabel: string;
  fields: string[];
  impact: QualityIssue['impact'];
  critical: boolean;
  score: number;
  updatedAt: string;
}

function pendingLabelFor(issues: QualityIssue[]): string {
  if (issues.length === 1) return issues[0].label;
  const categories = new Set(issues.map(i => i.category));
  if (categories.size === 1) return `${QUALITY_CATEGORY_LABEL[issues[0].category]} incompleta`;
  return 'Cadastro incompleto';
}

const FIELDS_SUMMARY_LIMIT = 2;

/** Resumo compacto para não empilhar seis campos verticalmente na célula —
 *  a lista completa continua acessível via title (tooltip nativo). */
function summarizeFields(fields: string[]): { summary: string; tooltip: string | undefined } {
  if (fields.length <= FIELDS_SUMMARY_LIMIT) return { summary: fields.join(', '), tooltip: undefined };
  const shown = fields.slice(0, FIELDS_SUMMARY_LIMIT).join(', ');
  return { summary: `${shown} +${fields.length - FIELDS_SUMMARY_LIMIT}`, tooltip: fields.join(', ') };
}

const PAGE_SIZE = 25;

interface ProductQualityQueueProps {
  companyId: string;
  snapshot: CatalogQualitySnapshot | null;
  loading: boolean;
  onOpenProduct: (productId: string) => void;
}

export function ProductQualityQueue({ companyId, snapshot, loading, onOpenProduct }: ProductQualityQueueProps) {
  const [category, setCategory] = useState<'all' | QualityCategory>('all');
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [origins, setOrigins] = useState<Map<string, ProductOrigin>>(new Map());

  const pending = useMemo(() => {
    if (!snapshot) return [];
    const rows: QueueRow[] = [];
    for (const p of snapshot.products) {
      const result = snapshot.results.get(p.id);
      if (!result || result.issues.length === 0) continue;
      const critical = result.issues.some(i => i.critical);
      const topImpact = result.issues.slice().sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact])[0].impact;
      rows.push({
        productId: p.id, name: p.name, sku: p.sku,
        pendingLabel: pendingLabelFor(result.issues),
        fields: Array.from(new Set(result.issues.flatMap(i => i.fields))),
        impact: topImpact, critical, score: result.score, updatedAt: p.updatedAt,
      });
    }
    rows.sort((a, b) => (a.critical === b.critical ? IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] : a.critical ? -1 : 1));
    return rows;
  }, [snapshot]);

  useEffect(() => {
    if (!companyId || pending.length === 0) return;
    getProductOrigins(companyId, pending.map(r => r.productId)).then(setOrigins);
  }, [companyId, pending]);

  const categoryCounts = useMemo(() => {
    const counts: Record<QualityCategory, number> = { identificacao: 0, classificacao: 0, logistica: 0, comercial: 0 };
    if (snapshot) {
      for (const p of snapshot.products) {
        const result = snapshot.results.get(p.id);
        if (!result) continue;
        const seen = new Set<QualityCategory>();
        for (const issue of result.issues) seen.add(issue.category);
        for (const c of seen) counts[c] += 1;
      }
    }
    return counts;
  }, [snapshot]);

  const topIssueTypes = useMemo(() => {
    if (!snapshot) return [];
    const counts = new Map<string, number>();
    for (const p of snapshot.products) {
      const result = snapshot.results.get(p.id);
      if (!result) continue;
      for (const issue of result.issues) counts.set(issue.label, (counts.get(issue.label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [snapshot]);

  const criticalCount = pending.filter(r => r.critical).length;

  const avgScore = useMemo(() => {
    if (!snapshot || snapshot.products.length === 0) return null;
    let sum = 0;
    for (const p of snapshot.products) sum += snapshot.results.get(p.id)?.score ?? 0;
    return Math.round(sum / snapshot.products.length);
  }, [snapshot]);

  const filtered = pending.filter(r => {
    if (onlyCritical && !r.critical) return false;
    if (category !== 'all') {
      const result = snapshot?.results.get(r.productId);
      if (!result?.issues.some(i => i.category === category)) return false;
    }
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      if (!r.name.toLowerCase().includes(term) && !r.sku.toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    const lines = ['Produto;SKU;Pendência;Campos afetados;Impacto;Qualidade cadastral'];
    for (const r of filtered) {
      lines.push([r.name, r.sku, r.pendingLabel, r.fields.join(', '), r.impact, `${r.score}%`].map(v => String(v).includes(';') ? `"${v}"` : v).join(';'));
    }
    downloadFile(lines.join('\n'), `pendencias-cadastrais-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_290px] gap-4 items-start">
      <Panel className="h-fit">
        <PanelSection padding="sm" className="space-y-1">
          {(['all', 'identificacao', 'classificacao', 'logistica', 'comercial'] as const).map(c => (
            <button
              key={c}
              onClick={() => { setCategory(c); setPage(1); }}
              className={`w-full flex items-center justify-between rounded-control px-3 py-2 text-sm transition-colors ${category === c ? 'bg-surface-3 text-fg font-medium' : 'text-fg-muted hover:bg-surface-3'}`}
            >
              <span>{c === 'all' ? 'Todas' : QUALITY_CATEGORY_LABEL[c]}</span>
              <span className="text-xs text-fg-subtle tabular-nums">{c === 'all' ? pending.length : categoryCounts[c]}</span>
            </button>
          ))}
        </PanelSection>
      </Panel>

      <Panel className="min-w-0">
        <PanelSection padding="md" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-fg">Fila de revisão</p>
            <p className="text-xs text-fg-subtle mt-0.5">Produtos ordenados por impacto operacional</p>
          </div>
          <Input
            icon={<Search />}
            placeholder="Buscar produto ou SKU"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full sm:w-72 sm:flex-shrink-0"
          />
        </PanelSection>

        {loading && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Carregando…</PanelSection>}
        {!loading && filtered.length === 0 && (
          <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
            {pending.length === 0 ? 'Nenhuma pendência cadastral encontrada.' : 'Nenhum item para os filtros atuais.'}
          </PanelSection>
        )}

        {!loading && filtered.length > 0 && (
          <div className="overflow-x-auto border-t border-edge">
            <Table className="min-w-[880px]">
              <Thead>
                <Tr>
                  <Th className="w-[26%]">Produto</Th>
                  <Th className="w-[14%]">Pendência</Th>
                  <Th className="w-[18%]">Campos afetados</Th>
                  <Th className="whitespace-nowrap">Origem</Th>
                  <Th className="whitespace-nowrap">Qualidade cadastral</Th>
                  <Th className="whitespace-nowrap">Impacto</Th>
                  <Th className="whitespace-nowrap">Atualização</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <tbody>
                {pageRows.map(r => {
                  const fieldsSummary = summarizeFields(r.fields);
                  return (
                    <Tr key={r.productId} className="align-top">
                      <Td>
                        <p className="text-fg line-clamp-2">{r.name}</p>
                        <p className="text-xs text-fg-subtle font-mono">{r.sku}</p>
                      </Td>
                      <Td>
                        {r.critical ? (
                          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                            <ShieldAlert size={13} className="flex-shrink-0" /> {r.pendingLabel}
                          </span>
                        ) : (
                          <span className="text-fg-muted">{r.pendingLabel}</span>
                        )}
                      </Td>
                      <Td className="text-fg-subtle line-clamp-2" title={fieldsSummary.tooltip}>{fieldsSummary.summary}</Td>
                      <Td className="text-fg-subtle whitespace-nowrap">{origins.get(r.productId)?.imported ? 'Importação' : 'Cadastro manual'}</Td>
                      <Td className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-fg-muted tabular-nums">{r.score}%</span>
                          <span className="h-1 w-14 rounded-full bg-surface-3 overflow-hidden">
                            <span className="block h-full rounded-full bg-accent" style={{ width: `${r.score}%` }} />
                          </span>
                        </div>
                      </Td>
                      <Td className={`whitespace-nowrap ${r.critical ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}`}>{r.impact}</Td>
                      <Td className="text-xs text-fg-subtle whitespace-nowrap">{new Date(r.updatedAt).toLocaleDateString('pt-BR')}</Td>
                      <Td className="whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => onOpenProduct(r.productId)}>Revisar</Button>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <PanelSection padding="sm" className="flex items-center justify-between">
            <p className="text-xs text-fg-subtle">Página {page} de {totalPages}</p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Anterior</Button>
              <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Próxima</Button>
            </div>
          </PanelSection>
        )}
      </Panel>

      <Panel className="h-fit">
        <PanelSection padding="md" className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-3">Resumo da qualidade</p>
            <div className="flex flex-col items-center py-2">
              <p className="text-3xl font-semibold text-fg tabular-nums">{avgScore == null ? '—' : `${avgScore}%`}</p>
              <p className="text-xs text-fg-subtle mt-1">Completude média</p>
              <span className="mt-3 h-1 w-full rounded-full bg-surface-3 overflow-hidden">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${avgScore ?? 0}%` }} />
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-edge">
            {topIssueTypes.length === 0 && <p className="text-sm text-fg-subtle">Sem pendências no momento.</p>}
            <div className="space-y-1.5">
              {topIssueTypes.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">{label}</span>
                  <span className="text-fg tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {criticalCount > 0 && (
            <div className="pt-3 border-t border-edge">
              <p className="text-xs text-fg-subtle mb-2">Corrija primeiro os {criticalCount} produtos que bloqueiam integração ou conferência.</p>
              <Button variant="secondary" size="sm" onClick={() => { setOnlyCritical(true); setCategory('all'); setPage(1); }} className="w-full">
                Revisar críticos
              </Button>
            </div>
          )}
          {onlyCritical && (
            <button onClick={() => setOnlyCritical(false)} className="text-xs text-accent hover:underline">Limpar filtro de críticos</button>
          )}

          <div className="pt-3 border-t border-edge">
            <Button variant="ghost" size="sm" onClick={handleExport} className="w-full">
              <Download size={14} /> Exportar pendências
            </Button>
          </div>
        </PanelSection>
      </Panel>
    </div>
  );
}

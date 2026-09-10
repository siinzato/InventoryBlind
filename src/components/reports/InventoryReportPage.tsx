// Emitir Relatório — folha de contagem física para levar ao estoque.
//
// A tela orquestra quatro passos (seleção, fonte do saldo, pré-visualização,
// impressão) e é a ÚNICA implementação: tanto o item de Ferramentas quanto a
// entrada dentro de Nova Contagem abrem este mesmo componente pela mesma rota.
//
// Nenhuma escrita acontece aqui. Emitir folha é preparatório para impressão:
// não atualiza estoque, produto, contagem, movimentação nem inventário.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import {
  Button,
  Notice,
  Page,
  PageHeader,
  Panel,
  PanelSection,
  SegmentedControl,
} from '../ui';
import type { SegmentedOption } from '../ui';
import { useAuth } from '../../lib/auth';
import {
  applySourceBalancesToRows,
  buildReportRows,
  countLocations,
  distinctLocations,
  selectByBrandsAndLines,
  selectByLocationRange,
} from '../../lib/reports/inventoryReportAlgorithm';
import type { SourceBalanceSummary } from '../../lib/reports/inventoryReportAlgorithm';
import { loadReportProducts, MAX_REPORT_PRODUCTS } from '../../lib/reports/inventoryReportService';
import {
  loadTinyStockSheetBalances,
  loadTinyStockSheetSnapshot,
} from '../../lib/integrations/stockSheet/stockSheetSourceService';
import type {
  SourceBalance,
  StockSheetSnapshot,
} from '../../lib/integrations/stockSheet/stockSheetSourceService';
import { TINY_STOCK_SHEET_SOURCE_NAME } from '../../lib/integrations/stockSheet/tinyStockSheetContract';
import {
  downloadInventoryReportExcel,
  downloadInventoryReportPdf,
  injectReportPrintStyle,
  removeReportPrintStyle,
} from '../../lib/reports/inventoryReportOutput';
import type {
  BalanceSource,
  InventoryReportRow,
  ReportMeta,
  ReportProduct,
  ReportSelectionMode,
} from '../../lib/reports/inventoryReportTypes';
import { listBrands, listLines } from '../../lib/productBrands/productBrandService';
import type { ProductBrand, ProductLine } from '../../lib/productBrands/productBrandService';
import { InventoryReportFilters } from './InventoryReportFilters';
import { InventoryReportPreview } from './InventoryReportPreview';
import { InventoryReportPrint } from './InventoryReportPrint';

const BALANCE_SOURCES: SegmentedOption<BalanceSource>[] = [
  { value: 'blank', label: 'Saldo em branco' },
  { value: 'manual', label: 'Saldo manual' },
  { value: 'tiny', label: TINY_STOCK_SHEET_SOURCE_NAME },
];

const BALANCE_HINT: Record<BalanceSource, string> = {
  blank: 'A coluna sai vazia para o operador escrever à mão. É o modo mais simples para inventário físico.',
  manual: 'Digite o saldo na pré-visualização. O valor é só do relatório — não vira saldo oficial do estoque.',
  tiny: 'Usa o saldo já importado na Fonte de Saldo, sem pedir a planilha de novo. O relatório sempre lê a importação mais recente.',
};

function formatSourceTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

interface InventoryReportPageProps {
  companyId: string;
  onBack: () => void;
}

export function InventoryReportPage({ companyId, onBack }: InventoryReportPageProps) {
  const { company } = useAuth();

  const [products, setProducts] = useState<ReportProduct[]>([]);
  const [brands, setBrands] = useState<ProductBrand[]>([]);
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const [mode, setMode] = useState<ReportSelectionMode>('location');
  const [locationFrom, setLocationFrom] = useState('');
  const [locationTo, setLocationTo] = useState('');
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [manualIds, setManualIds] = useState<Set<string>>(() => new Set());

  const [balanceSource, setBalanceSource] = useState<BalanceSource>('blank');
  // Fonte de Saldo permanente: a ferramenta só CONSOME. Nada de saldo é
  // guardado aqui — a cada abertura/consulta o snapshot vigente é relido, então
  // um arquivo novo importado em Produtos -> Fonte de Saldo passa a valer sozinho.
  const [tinySnapshot, setTinySnapshot] = useState<StockSheetSnapshot | null>(null);
  const [tinySnapshotLoading, setTinySnapshotLoading] = useState(true);
  const [tinyBalances, setTinyBalances] = useState<Map<string, SourceBalance>>(() => new Map());
  const [tinyBalancesLoading, setTinyBalancesLoading] = useState(false);
  const [tinyError, setTinyError] = useState<string | null>(null);
  const [manualBalances, setManualBalances] = useState<Record<string, string>>({});
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());

  const [emittedAt, setEmittedAt] = useState(() => new Date());
  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Catálogo e marcas: uma leitura em lote na entrada da tela, nunca uma query
  // por produto. O workspace ativo é o único escopo (loadReportProducts filtra
  // por company_id além do RLS).
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([loadReportProducts(companyId), listBrands(companyId), listLines(companyId)])
      .then(([productsResult, brandsResult, linesResult]) => {
        if (cancelled) return;
        setProducts(productsResult.products);
        setTruncated(productsResult.truncated);
        setBrands(brandsResult);
        setLines(linesResult);
      })
      .catch(error => {
        if (cancelled) return;
        console.error('[InventoryReport] failed to load catalog:', error);
        setLoadError('Não foi possível carregar os produtos deste workspace.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyId]);

  // Estado da fonte: existe? já recebeu arquivo concluído? quando? Uma leitura
  // leve na entrada da tela (nunca por produto), com falha isolada — a fonte
  // indisponível não pode derrubar a emissão em branco nem a manual.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setTinySnapshotLoading(true);
    loadTinyStockSheetSnapshot()
      .then(snapshot => { if (!cancelled) setTinySnapshot(snapshot); })
      .catch(error => {
        if (cancelled) return;
        console.error('[InventoryReport] failed to load balance source:', error);
        setTinySnapshot(null);
      })
      .finally(() => { if (!cancelled) setTinySnapshotLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  const locations = useMemo(() => distinctLocations(products), [products]);
  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const lineNameById = useMemo(() => new Map(lines.map(l => [l.id, l.name])), [lines]);
  const brandNameById = useMemo(() => new Map(brands.map(b => [b.id, b.name])), [brands]);

  const groupLabelFor = useCallback(
    (product: ReportProduct) =>
      (product.lineId ? lineNameById.get(product.lineId) : null) ??
      (product.brandId ? brandNameById.get(product.brandId) : null) ??
      null,
    [lineNameById, brandNameById]
  );

  const selectedProducts = useMemo(() => {
    if (mode === 'location') return selectByLocationRange(products, locationFrom, locationTo);
    if (mode === 'brand') return selectByBrandsAndLines(products, selectedBrandIds, selectedLineIds);
    return [...manualIds].map(id => productsById.get(id)).filter((p): p is ReportProduct => !!p);
  }, [mode, products, locationFrom, locationTo, selectedBrandIds, selectedLineIds, manualIds, productsById]);

  /** Linhas ordenadas e sem as removidas manualmente da emissão. */
  const baseRows = useMemo(() => {
    const rows = buildReportRows(selectedProducts, { mode, groupLabelFor });
    return removedIds.size === 0 ? rows : rows.filter(row => !removedIds.has(row.productId));
  }, [selectedProducts, mode, groupLabelFor, removedIds]);

  /** Ids da seleção, em chave estável — é o que dispara a consulta em lote sem
   *  refazê-la a cada re-render. */
  const selectedIdsKey = useMemo(
    () => baseRows.map(row => row.productId).sort().join(','),
    [baseRows]
  );

  /** Saldo da Fonte de Saldo, EM LOTE: uma consulta por faixa de 300 produtos,
   *  jamais uma por produto. A associação vem do vínculo já persistido na
   *  importação — nenhum matching acontece aqui. */
  useEffect(() => {
    const sourceId = tinySnapshot?.connection.id;
    if (balanceSource !== 'tiny' || !sourceId || tinySnapshot?.lastImportAt == null) {
      setTinyBalances(new Map());
      return;
    }
    const productIds = selectedIdsKey === '' ? [] : selectedIdsKey.split(',');
    if (productIds.length === 0) {
      setTinyBalances(new Map());
      return;
    }

    let cancelled = false;
    setTinyBalancesLoading(true);
    setTinyError(null);
    loadTinyStockSheetBalances(sourceId, productIds)
      .then(balances => { if (!cancelled) setTinyBalances(balances); })
      .catch(error => {
        if (cancelled) return;
        console.error('[InventoryReport] failed to load source balances:', error);
        setTinyBalances(new Map());
        setTinyError('Não foi possível ler o saldo da Fonte de Saldo. A folha sai com a coluna em branco.');
      })
      .finally(() => { if (!cancelled) setTinyBalancesLoading(false); });
    return () => { cancelled = true; };
  }, [balanceSource, selectedIdsKey, tinySnapshot?.connection.id, tinySnapshot?.lastImportAt]);

  /** Saldo aplicado por cima das linhas — passo separado, para trocar a fonte
   *  do saldo não refazer seleção nem ordenação. */
  const { rows, tinySummary } = useMemo<{ rows: InventoryReportRow[]; tinySummary: SourceBalanceSummary | null }>(() => {
    if (balanceSource === 'manual') {
      return {
        rows: baseRows.map(row => {
          const value = manualBalances[row.productId];
          return value === undefined || value === ''
            ? row
            : { ...row, balance: value, balanceStatus: 'manual' as const };
        }),
        tinySummary: null,
      };
    }
    if (balanceSource === 'tiny' && tinySnapshot?.lastImportAt != null) {
      const applied = applySourceBalancesToRows(baseRows, tinyBalances);
      return { rows: applied.rows, tinySummary: applied.summary };
    }
    return { rows: baseRows, tinySummary: null };
  }, [balanceSource, baseRows, manualBalances, tinyBalances, tinySnapshot?.lastImportAt]);

  const groupNames = useMemo(() => {
    if (mode !== 'brand') return [];
    return [...new Set(rows.map(row => row.groupLabel).filter((g): g is string => !!g))].sort(
      (a, b) => a.localeCompare(b, 'pt-BR')
    );
  }, [mode, rows]);

  const filterDescription = useMemo(() => {
    if (mode === 'location') {
      const from = locationFrom.trim().toUpperCase() || '—';
      const to = locationTo.trim().toUpperCase() || '—';
      return `Local ${from} até ${to}`;
    }
    if (mode === 'brand') {
      return groupNames.length > 0
        ? `Linha/Marca: ${groupNames.join(', ')}`
        : 'Linha/Marca: nenhuma selecionada';
    }
    return `Seleção manual de ${rows.length} produtos`;
  }, [mode, locationFrom, locationTo, groupNames, rows.length]);

  const meta: ReportMeta = useMemo(
    () => ({
      workspaceName: company?.name ?? 'Workspace',
      emittedAt,
      mode,
      filterDescription,
      productCount: rows.length,
      locationCount: countLocations(rows),
      groupNames,
    }),
    [company?.name, emittedAt, mode, filterDescription, rows, groupNames]
  );

  // A área de impressão é um portal em `document.body` (o CSS de impressão
  // esconde `body > *` e mostra só ela) e só é montada durante a impressão —
  // milhares de linhas não ficam no DOM enquanto o usuário trabalha na tela.
  useEffect(() => {
    if (!printing) return;
    injectReportPrintStyle();
    const timer = setTimeout(() => {
      window.print();
      setPrinting(false);
      removeReportPrintStyle();
    }, 200);
    return () => {
      clearTimeout(timer);
      removeReportPrintStyle();
    };
  }, [printing]);

  const handlePrint = () => {
    setEmittedAt(new Date());
    setPrinting(true);
  };

  /** PDF e Excel compartilham o mesmo caminho: mesma emissão, mesmas linhas,
   *  mesma ordem — só o formato do arquivo muda. */
  const emitFile = async (
    kind: 'pdf' | 'xlsx' | 'xls'
  ) => {
    const now = new Date();
    setEmittedAt(now);
    setExporting(true);
    try {
      const emission = { ...meta, emittedAt: now };
      if (kind === 'pdf') await downloadInventoryReportPdf(emission, rows);
      else await downloadInventoryReportExcel(emission, rows, kind);
    } catch (error) {
      console.error('[InventoryReport] failed to export:', error, kind);
      setLoadError('Não foi possível gerar o arquivo. Tente novamente ou use Imprimir.');
    } finally {
      setExporting(false);
    }
  };

  const toggleBrand = (brandId: string) =>
    setSelectedBrandIds(prev =>
      prev.includes(brandId) ? prev.filter(id => id !== brandId) : [...prev, brandId]
    );
  const toggleLine = (lineId: string) =>
    setSelectedLineIds(prev =>
      prev.includes(lineId) ? prev.filter(id => id !== lineId) : [...prev, lineId]
    );
  const toggleManual = (productId: string) =>
    setManualIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  const matchedLocations = useMemo(
    () => new Set(selectedProducts.map(p => p.location).filter(Boolean)).size,
    [selectedProducts]
  );



  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Ferramentas"
        title="Emitir Relatório"
        description="Prepare folhas de contagem para inventários físicos por endereço, linha ou seleção de produtos."
        actions={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      {loadError && <Notice tone="danger">{loadError}</Notice>}
      {truncated && (
        <Notice tone="warning">
          Este workspace tem mais de {MAX_REPORT_PRODUCTS.toLocaleString('pt-BR')} produtos. A
          ferramenta trabalha com os primeiros {MAX_REPORT_PRODUCTS.toLocaleString('pt-BR')} —
          use a seleção por local ou por linha/marca para recortar o que precisa contar.
        </Notice>
      )}

      {loading ? (
        <Panel>
          <PanelSection>
            <p className="text-sm text-fg-muted">Carregando produtos do workspace...</p>
          </PanelSection>
        </Panel>
      ) : (
        <>
          <InventoryReportFilters
            mode={mode}
            onModeChange={setMode}
            products={products}
            locations={locations}
            locationFrom={locationFrom}
            locationTo={locationTo}
            onLocationFromChange={setLocationFrom}
            onLocationToChange={setLocationTo}
            brands={brands}
            lines={lines}
            selectedBrandIds={selectedBrandIds}
            selectedLineIds={selectedLineIds}
            onToggleBrand={toggleBrand}
            onToggleLine={toggleLine}
            manualIds={manualIds}
            onToggleManual={toggleManual}
            onSelectManualMany={ids => setManualIds(prev => new Set([...prev, ...ids]))}
            onClearManual={() => setManualIds(new Set())}
            matchedProducts={selectedProducts.length}
            matchedLocations={matchedLocations}
          />

          <Panel>
            <PanelSection>
              <h2 className="text-base font-semibold text-fg">2. Fonte do saldo</h2>
              <p className="mt-1 text-sm text-fg-muted">{BALANCE_HINT[balanceSource]}</p>
              <div className="mt-4">
                <SegmentedControl
                  label="Fonte do saldo"
                  options={BALANCE_SOURCES}
                  value={balanceSource}
                  onChange={setBalanceSource}
                />
              </div>
            </PanelSection>
            {balanceSource === 'tiny' && (
              <PanelSection>
                {tinySnapshotLoading ? (
                  <p className="text-sm text-fg-muted">Verificando a Fonte de Saldo...</p>
                ) : tinySnapshot == null ? (
                  <Notice tone="warning">
                    <strong>{TINY_STOCK_SHEET_SOURCE_NAME}</strong> ainda não está ativada neste
                    workspace. Ative a fonte e importe um arquivo em Produtos → Fonte de Saldo.
                  </Notice>
                ) : tinySnapshot.lastImportAt == null ? (
                  <Notice tone="warning">
                    <strong>{TINY_STOCK_SHEET_SOURCE_NAME}</strong> — nenhum saldo importado ainda.
                    Importe um arquivo em Produtos → Fonte de Saldo.
                  </Notice>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                      <span className="text-fg-muted">
                        Última atualização:{' '}
                        <span className="font-mono tabular-nums text-fg">
                          {formatSourceTimestamp(tinySnapshot.lastImportAt)}
                        </span>
                      </span>
                      <span className="text-fg-muted">
                        <span className="font-mono tabular-nums text-fg">
                          {tinySnapshot.productsWithBalance.toLocaleString('pt-BR')}
                        </span>{' '}
                        produtos com saldo
                      </span>
                    </div>

                    {/* Só depois de o lote chegar: enquanto carrega, o mapa está
                        vazio e o resumo diria "não encontrado" para tudo. */}
                    {tinySummary && !tinyBalancesLoading && (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-container border border-edge/60 px-4 py-3 text-sm sm:grid-cols-4">
                        <div>
                          <span className="block text-xs text-fg-subtle">Produtos no relatório</span>
                          <span className="font-mono tabular-nums text-fg">{tinySummary.total}</span>
                        </div>
                        <div>
                          <span className="block text-xs text-fg-subtle">Saldos encontrados</span>
                          <span className="font-mono tabular-nums text-fg">{tinySummary.matched}</span>
                        </div>
                        <div>
                          <span className="block text-xs text-fg-subtle">Saldo não encontrado</span>
                          <span className="font-mono tabular-nums text-fg">{tinySummary.notFound}</span>
                        </div>
                        <div>
                          <span className="block text-xs text-fg-subtle">Ambíguos</span>
                          <span className="font-mono tabular-nums text-fg">{tinySummary.ambiguous}</span>
                        </div>
                      </div>
                    )}

                    {tinyBalancesLoading && (
                      <p className="text-xs text-fg-subtle">Lendo o saldo da fonte...</p>
                    )}
                    {tinyError && <Notice tone="danger">{tinyError}</Notice>}

                    <p className="text-xs text-fg-subtle">
                      O saldo vem da última importação concluída da fonte e é apenas referência
                      impressa: não altera o estoque, o produto, a contagem nem cria movimentação.
                      Produto sem registro na fonte sai com a célula em branco — nunca zero.
                    </p>
                  </div>
                )}
              </PanelSection>
            )}
          </Panel>

          <InventoryReportPreview
            meta={meta}
            rows={rows}
            balanceSource={balanceSource}
            onEditBalance={(productId, value) =>
              setManualBalances(prev => ({ ...prev, [productId]: value }))
            }
            onRemoveRow={productId =>
              setRemovedIds(prev => new Set(prev).add(productId))
            }
            onPrint={handlePrint}
            onPdf={() => void emitFile('pdf')}
            onExcel={bookType => void emitFile(bookType)}
            busy={printing || exporting}
            removedCount={removedIds.size}
          />

        </>
      )}

      {printing && createPortal(<InventoryReportPrint meta={meta} rows={rows} />, document.body)}
    </Page>
  );
}

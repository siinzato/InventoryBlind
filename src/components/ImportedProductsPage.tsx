// Catálogo de Produtos — central de consulta, saneamento e edição do catálogo.
// "Produtos Importados" era o nome antigo: a importação é só uma das origens
// possíveis do cadastro, então a tela passou a representar o catálogo oficial.

import { useEffect, useMemo, useState, type FC } from 'react';
import {
  Search, Package, ArrowLeft, Download, Upload, Trash2, Pencil, Tag, SlidersHorizontal,
  Columns3, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { AbcClass, XyzClass } from '../lib/supabase';
import { downloadFile, exportProductsToCSV, formatDateTime, formatPrice } from '../lib/productImportUtils';
import {
  Page, PageHeader, Panel, PanelSection, Button, Table, Thead, Tr, Th, Td, Input, Select,
  SegmentedControl, StatRow, StatCell, Stat,
} from './ui';
import { RecordAdminMenu } from './admin/RecordAdminMenu';
import { useAuth } from '../lib/auth';
import { logAuditEvent } from '../lib/auditLogService';
import { getBrandLineNameMaps, listBrands, listLines, type ProductBrand, type ProductLine } from '../lib/productBrands/productBrandService';
import { AssignBrandLineModal } from './productBrands/AssignBrandLineModal';
import { ProductQuickInspector } from './productCatalog/ProductQuickInspector';
import { ProductQualityQueue } from './productCatalog/ProductQualityQueue';
import { RecentProductChanges } from './productCatalog/RecentProductChanges';
import { BulkEditFieldsModal } from './productCatalog/BulkEditFieldsModal';
import { getProductOrigins, type ProductOrigin } from '../lib/productCatalog/catalogHistoryService';
import {
  validateProductEan, evaluateProductQuality, fetchCatalogQualitySnapshot,
  type CatalogQualitySnapshot,
} from '../lib/productCatalog/catalogQuality';
import { loadCatalogPrefs, saveCatalogPrefs, CATALOG_OPTIONAL_COLUMNS, type CatalogColumnKey } from '../lib/productCatalog/catalogPrefs';

/** Filtro vindo de Linhas e Marcas — quando presente, a listagem é restrita à
 *  marca/linha/pendência escolhida via join no backend (nunca no navegador). */
export interface ProductBrandLineFilter {
  brandId?: string;
  lineId?: string;
  noLine?: boolean;
  needsReview?: boolean;
  contextTitle: string;
}

interface ProductRow {
  id: string; name: string; sku: string; ean: string | null; location: string | null;
  price: number | null; created_at: string; updated_at: string;
}
interface AssociationEmbed { brand_id: string | null; line_id: string | null; match_status: string | null; matched_keyword: string | null }
interface ClassEmbed { abc_class: AbcClass; xyz_class: XyzClass }
type ProductQueryRow = ProductRow & {
  product_brand_associations: AssociationEmbed | AssociationEmbed[] | null;
  product_abc_xyz_classifications: ClassEmbed | ClassEmbed[] | null;
};

function firstOf<T>(v: T | T[] | null): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type TopTab = 'catalog' | 'quality' | 'recent';
type QualityQuickFilter = 'all' | 'complete' | 'incomplete' | 'critical';
type SortOption = 'updated_desc' | 'name_asc' | 'price_desc' | 'price_asc';

function formatLastUpdated(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `hoje às ${time}` : `em ${date.toLocaleDateString('pt-BR')} às ${time}`;
}

interface ImportedProductsPageProps {
  onBack: () => void;
  isAdmin: boolean;
  /** Filtro por marca/linha vindo de Linhas e Marcas. Sem isso, a tela funciona exatamente como antes. */
  brandFilter?: ProductBrandLineFilter;
  /** Quando vindo de Linhas e Marcas: volta preservando o estado da tela anterior (que nunca desmonta). */
  onBackToBrands?: () => void;
  /** Atalho para o fluxo de importação existente — opcional para não exigir mudança em quem ainda não o repassa. */
  onGoToImport?: () => void;
}

export const ImportedProductsPage: FC<ImportedProductsPageProps> = ({
  onBack,
  isAdmin,
  brandFilter,
  onBackToBrands,
  onGoToImport,
}) => {
  const { companyId, profile } = useAuth();
  const isDrillIn = !!brandFilter;

  const [topTab, setTopTab] = useState<TopTab>('catalog');

  const [brandNames, setBrandNames] = useState<Map<string, string>>(new Map());
  const [lineNames, setLineNames] = useState<Map<string, string>>(new Map());
  const [brands, setBrands] = useState<ProductBrand[]>([]);
  const [lines, setLines] = useState<ProductLine[]>([]);

  useEffect(() => {
    if (!companyId) return;
    getBrandLineNameMaps(companyId).then(({ brandNames, lineNames }) => { setBrandNames(brandNames); setLineNames(lineNames); });
    listBrands(companyId).then(setBrands);
    listLines(companyId).then(setLines);
  }, [companyId]);

  // ── Fila/KPIs de empresa inteira — leitura leve (poucas colunas), uma vez ──
  const [qualitySnapshot, setQualitySnapshot] = useState<CatalogQualitySnapshot | null>(null);
  const [qualityLoading, setQualityLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    setQualityLoading(true);
    fetchCatalogQualitySnapshot(companyId).then(snap => { setQualitySnapshot(snap); setQualityLoading(false); });
  }, [companyId]);

  const needsReviewIds = useMemo(() => {
    if (!qualitySnapshot) return [];
    return qualitySnapshot.products.filter(p => (qualitySnapshot.results.get(p.id)?.issues.length ?? 0) > 0).map(p => p.id);
  }, [qualitySnapshot]);
  const criticalIds = useMemo(() => {
    if (!qualitySnapshot) return [];
    return qualitySnapshot.products.filter(p => qualitySnapshot.results.get(p.id)?.issues.some(i => i.critical)).map(p => p.id);
  }, [qualitySnapshot]);
  const completeCount = qualitySnapshot ? qualitySnapshot.products.length - needsReviewIds.length : 0;
  const noEanCount = useMemo(() => {
    if (!qualitySnapshot) return 0;
    return qualitySnapshot.products.filter(p => !p.ean || !p.ean.trim()).length;
  }, [qualitySnapshot]);
  const avgQualityScore = useMemo(() => {
    if (!qualitySnapshot || qualitySnapshot.products.length === 0) return null;
    let sum = 0;
    for (const p of qualitySnapshot.products) sum += qualitySnapshot.results.get(p.id)?.score ?? 0;
    return Math.round(sum / qualitySnapshot.products.length);
  }, [qualitySnapshot]);

  // ── Tabela do Catálogo ──────────────────────────────────────────────────
  const [products, setProducts] = useState<ProductQueryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalProducts, setTotalProducts] = useState(0);
  const [associationByProduct, setAssociationByProduct] = useState<Map<string, AssociationEmbed>>(new Map());
  const [classificationByProduct, setClassificationByProduct] = useState<Map<string, ClassEmbed>>(new Map());
  const [originByProduct, setOriginByProduct] = useState<Map<string, ProductOrigin>>(new Map());

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<SortOption>('updated_desc');
  const [qualityQuickFilter, setQualityQuickFilter] = useState<QualityQuickFilter>('all');

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterBrandId, setFilterBrandId] = useState('');
  const [filterLineId, setFilterLineId] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterAbc, setFilterAbc] = useState<'' | AbcClass>('');
  const [filterXyz, setFilterXyz] = useState<'' | XyzClass>('');
  const activeFilterCount = [filterBrandId, filterLineId, filterLocation, filterAbc, filterXyz].filter(Boolean).length;

  const [columnsOpen, setColumnsOpen] = useState(false);
  const [prefs, setPrefs] = useState(loadCatalogPrefs());
  const toggleColumn = (key: CatalogColumnKey) => {
    const next = prefs.visibleColumns.includes(key) ? prefs.visibleColumns.filter(k => k !== key) : [...prefs.visibleColumns, key];
    const updated = { visibleColumns: next };
    setPrefs(updated);
    saveCatalogPrefs(updated);
  };
  const showCol = (key: CatalogColumnKey) => prefs.visibleColumns.includes(key);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [inspectorProductId, setInspectorProductId] = useState<string | null>(null);

  const loadProducts = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (qualityQuickFilter === 'incomplete' && needsReviewIds.length === 0) {
        setProducts([]); setTotalProducts(0); setLoading(false); return;
      }
      if (qualityQuickFilter === 'critical' && criticalIds.length === 0) {
        setProducts([]); setTotalProducts(0); setLoading(false); return;
      }

      const needsBrandJoin = !!(filterBrandId || filterLineId || brandFilter?.brandId || brandFilter?.lineId || brandFilter?.noLine || brandFilter?.needsReview);
      const needsAbcJoin = !!(filterAbc || filterXyz);
      const brandEmbed = needsBrandJoin
        ? 'product_brand_associations!inner(brand_id,line_id,match_status,matched_keyword)'
        : 'product_brand_associations(brand_id,line_id,match_status,matched_keyword)';
      const abcEmbed = needsAbcJoin
        ? 'product_abc_xyz_classifications!inner(abc_class,xyz_class)'
        : 'product_abc_xyz_classifications(abc_class,xyz_class)';

      let query = supabase.from('products').select(`*, ${brandEmbed}, ${abcEmbed}`, { count: 'exact' });

      if (brandFilter?.lineId) query = query.eq('product_brand_associations.line_id', brandFilter.lineId);
      else if (brandFilter?.noLine) query = query.eq('product_brand_associations.brand_id', brandFilter.brandId ?? '').is('product_brand_associations.line_id', null);
      else if (brandFilter?.brandId) query = query.eq('product_brand_associations.brand_id', brandFilter.brandId);
      if (brandFilter?.needsReview) query = query.eq('product_brand_associations.match_status', 'needs_review');

      if (filterBrandId) query = query.eq('product_brand_associations.brand_id', filterBrandId);
      if (filterLineId) query = query.eq('product_brand_associations.line_id', filterLineId);
      if (filterAbc) query = query.eq('product_abc_xyz_classifications.abc_class', filterAbc);
      if (filterXyz) query = query.eq('product_abc_xyz_classifications.xyz_class', filterXyz);
      if (filterLocation.trim()) query = query.ilike('location', `%${filterLocation.trim()}%`);

      if (search.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(`name.ilike.${term},sku.ilike.${term},ean.ilike.${term}`);
      }

      if (qualityQuickFilter === 'incomplete') query = query.in('id', needsReviewIds);
      else if (qualityQuickFilter === 'critical') query = query.in('id', criticalIds);
      else if (qualityQuickFilter === 'complete' && needsReviewIds.length > 0) query = query.not('id', 'in', `(${needsReviewIds.join(',')})`);

      switch (sortBy) {
        case 'name_asc': query = query.order('name', { ascending: true }); break;
        case 'price_desc': query = query.order('price', { ascending: false, nullsFirst: false }); break;
        case 'price_asc': query = query.order('price', { ascending: true, nullsFirst: true }); break;
        default: query = query.order('updated_at', { ascending: false });
      }

      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      const rows = (data ?? []) as ProductQueryRow[];
      setProducts(rows);
      setTotalProducts(count || 0);
      setSelectedIds(new Set());

      const assocMap = new Map<string, AssociationEmbed>();
      const classMap = new Map<string, ClassEmbed>();
      for (const row of rows) {
        const assoc = firstOf(row.product_brand_associations);
        if (assoc) assocMap.set(row.id, assoc);
        const cls = firstOf(row.product_abc_xyz_classifications);
        if (cls) classMap.set(row.id, cls);
      }
      setAssociationByProduct(assocMap);
      setClassificationByProduct(classMap);

      if (rows.length > 0 && companyId) {
        getProductOrigins(companyId, rows.map(r => r.id)).then(setOriginByProduct);
      } else {
        setOriginByProduct(new Map());
      }
    } catch (err) {
      console.error('Error loading products:', err);
      setLoadError('Não foi possível carregar o catálogo. Tente novamente.');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentPage, pageSize, sortBy, filterBrandId, filterLineId, filterAbc, filterXyz, filterLocation, qualityQuickFilter,
    brandFilter?.brandId, brandFilter?.lineId, brandFilter?.noLine, brandFilter?.needsReview, qualitySnapshot,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => { setCurrentPage(1); loadProducts(); }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm('Tem certeza que deseja excluir este produto?')) return;
    try {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      setProducts(prev => prev.filter(p => p.id !== id));
      setTotalProducts(prev => prev - 1);
      if (companyId && profile) {
        await logAuditEvent({ companyId, userId: profile.id, userEmail: profile.email ?? '', action: 'products.delete', resourceType: 'product', resourceId: id });
      }
    } catch (err) {
      console.error('Error deleting product:', err);
      alert('Erro ao excluir produto');
    }
  };

  const handleExport = (onlySelected: boolean) => {
    const source = onlySelected ? products.filter(p => selectedIds.has(p.id)) : products;
    const csv = source.map(p => ({
      name: p.name, sku: p.sku, ean: p.ean || '', location: p.location || '', price: p.price, status: 'update' as const,
    }));
    const content = exportProductsToCSV(csv);
    downloadFile(content, `catalogo-produtos-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const totalPages = Math.ceil(totalProducts / pageSize);

  const headerDescription = `${totalProducts.toLocaleString('pt-BR')} produtos cadastrados`
    + (qualitySnapshot?.lastUpdatedAt ? ` · Atualizado ${formatLastUpdated(qualitySnapshot.lastUpdatedAt)}` : '');

  return (
    <Page>
      <PageHeader
        title={brandFilter?.contextTitle ?? 'Catálogo de Produtos'}
        description={isDrillIn ? undefined : headerDescription}
        actions={
          <>
            <Button variant="ghost" onClick={onBackToBrands ?? onBack}>
              <ArrowLeft size={16} />
              {onBackToBrands ? 'Voltar para Linhas e Marcas' : 'Voltar'}
            </Button>
            <Button variant="secondary" onClick={() => handleExport(false)}>
              <Download size={16} /> Exportar CSV
            </Button>
            {!isDrillIn && onGoToImport && (
              <Button onClick={onGoToImport}>
                <Upload size={16} /> Importar produtos
              </Button>
            )}
          </>
        }
      />

      {!isDrillIn && (
        <div className="mb-6">
          <SegmentedControl
            label="Visualização do catálogo"
            value={topTab}
            onChange={setTopTab}
            options={[
              { value: 'catalog', label: 'Catálogo' },
              { value: 'quality', label: 'Qualidade cadastral' },
              { value: 'recent', label: 'Alterações recentes' },
            ]}
          />
        </div>
      )}

      {!isDrillIn && topTab === 'quality' && companyId && (
        <>
          <Panel className="mb-6">
            <PanelSection padding="md">
              <StatRow>
                <StatCell><Stat label="Completude média" value={qualityLoading || avgQualityScore == null ? '—' : `${avgQualityScore}%`} icon={<CheckCircle2 />} /></StatCell>
                <StatCell><Stat label="Precisam de revisão" value={qualityLoading ? '—' : needsReviewIds.length.toLocaleString('pt-BR')} icon={<AlertTriangle />} /></StatCell>
                <StatCell><Stat label="Sem EAN" value={qualityLoading ? '—' : noEanCount.toLocaleString('pt-BR')} icon={<AlertCircle />} /></StatCell>
                <StatCell>
                  <Stat
                    label="Pendências críticas"
                    value={qualityLoading ? '—' : criticalIds.length.toLocaleString('pt-BR')}
                    icon={<ShieldAlert />}
                    valueTone={!qualityLoading && criticalIds.length > 0 ? 'critical' : 'default'}
                  />
                </StatCell>
              </StatRow>
            </PanelSection>
          </Panel>
          <ProductQualityQueue companyId={companyId} snapshot={qualitySnapshot} loading={qualityLoading} onOpenProduct={setInspectorProductId} />
        </>
      )}

      {!isDrillIn && topTab === 'recent' && companyId && (
        <RecentProductChanges companyId={companyId} onOpenProduct={setInspectorProductId} />
      )}

      {(isDrillIn || topTab === 'catalog') && (
        <>
          {!isDrillIn && (
            <Panel className="mb-6">
              <PanelSection padding="md">
                <StatRow>
                  <StatCell><Stat label="Total de produtos" value={totalProducts.toLocaleString('pt-BR')} icon={<Package />} /></StatCell>
                  <StatCell><Stat label="Cadastro completo" value={qualityLoading ? '—' : completeCount.toLocaleString('pt-BR')} icon={<CheckCircle2 />} /></StatCell>
                  <StatCell><Stat label="Precisam de revisão" value={qualityLoading ? '—' : needsReviewIds.length.toLocaleString('pt-BR')} icon={<AlertTriangle />} /></StatCell>
                  <StatCell>
                    <Stat
                      label="Pendências críticas"
                      value={qualityLoading ? '—' : criticalIds.length.toLocaleString('pt-BR')}
                      icon={<ShieldAlert />}
                      valueTone={!qualityLoading && criticalIds.length > 0 ? 'critical' : 'default'}
                    />
                  </StatCell>
                </StatRow>
              </PanelSection>
            </Panel>
          )}

          <Panel>
            <PanelSection padding="md" className="flex flex-wrap items-center gap-3">
              <Input
                icon={<Search size={18} />}
                placeholder="Buscar por nome, SKU ou EAN"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 min-w-[220px]"
              />
              {!isDrillIn && (
                <Select value={qualityQuickFilter} onChange={e => { setQualityQuickFilter(e.target.value as QualityQuickFilter); setCurrentPage(1); }}>
                  <option value="all">Todos os produtos</option>
                  <option value="complete">Cadastro completo</option>
                  <option value="incomplete">Precisam de revisão</option>
                  <option value="critical">Com pendência crítica</option>
                </Select>
              )}
              <Select value={sortBy} onChange={e => { setSortBy(e.target.value as SortOption); setCurrentPage(1); }}>
                <option value="updated_desc">Atualização mais recente</option>
                <option value="name_asc">Nome (A-Z)</option>
                <option value="price_desc">Maior preço</option>
                <option value="price_asc">Menor preço</option>
              </Select>
              <Button variant="secondary" onClick={() => setFiltersOpen(o => !o)}>
                <SlidersHorizontal size={16} /> Filtros {activeFilterCount > 0 && `(${activeFilterCount})`}
              </Button>
              <Button variant="secondary" onClick={() => setColumnsOpen(o => !o)}>
                <Columns3 size={16} /> Colunas
              </Button>
            </PanelSection>

            {filtersOpen && (
              <PanelSection padding="md" className="flex flex-wrap items-center gap-3 bg-surface-3/40">
                <Select value={filterBrandId} onChange={e => { setFilterBrandId(e.target.value); setFilterLineId(''); setCurrentPage(1); }}>
                  <option value="">Marca</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
                <Select value={filterLineId} onChange={e => { setFilterLineId(e.target.value); setCurrentPage(1); }} disabled={!filterBrandId}>
                  <option value="">Linha</option>
                  {lines.filter(l => l.brandId === filterBrandId).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
                <Input placeholder="Local" value={filterLocation} onChange={e => { setFilterLocation(e.target.value); setCurrentPage(1); }} className="max-w-[160px]" />
                <Select value={filterAbc} onChange={e => { setFilterAbc(e.target.value as '' | AbcClass); setCurrentPage(1); }}>
                  <option value="">ABC</option>
                  <option value="A">A</option><option value="B">B</option><option value="C">C</option>
                </Select>
                <Select value={filterXyz} onChange={e => { setFilterXyz(e.target.value as '' | XyzClass); setCurrentPage(1); }}>
                  <option value="">XYZ</option>
                  <option value="X">X</option><option value="Y">Y</option><option value="Z">Z</option>
                </Select>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => { setFilterBrandId(''); setFilterLineId(''); setFilterLocation(''); setFilterAbc(''); setFilterXyz(''); setCurrentPage(1); }}
                    className="text-xs text-accent hover:underline"
                  >
                    Limpar filtros
                  </button>
                )}
              </PanelSection>
            )}

            {columnsOpen && (
              <PanelSection padding="md" className="flex flex-wrap items-center gap-4 bg-surface-3/40">
                {CATALOG_OPTIONAL_COLUMNS.map(col => (
                  <label key={col.key} className="flex items-center gap-2 text-sm text-fg-muted">
                    <input type="checkbox" checked={showCol(col.key)} onChange={() => toggleColumn(col.key)} />
                    {col.label}
                  </label>
                ))}
              </PanelSection>
            )}

            {selectedIds.size > 0 && isAdmin && (
              <PanelSection padding="sm" className="flex flex-wrap items-center gap-3 bg-accent/5">
                <p className="text-sm text-fg">{selectedIds.size} produto{selectedIds.size === 1 ? '' : 's'} selecionado{selectedIds.size === 1 ? '' : 's'}</p>
                <Button variant="ghost" size="sm" onClick={() => setShowBulkEditModal(true)}><Pencil size={14} /> Editar em massa</Button>
                <Button variant="ghost" size="sm" onClick={() => setShowAssignModal(true)}><Tag size={14} /> Associar marca/linha</Button>
                <Button variant="ghost" size="sm" onClick={() => handleExport(true)}><Download size={14} /> Exportar seleção</Button>
              </PanelSection>
            )}

            {loading && (
              <PanelSection padding="lg" className="flex items-center justify-center text-fg-subtle text-sm gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full" /> Carregando produtos...
              </PanelSection>
            )}

            {!loading && loadError && (
              <PanelSection padding="lg" className="text-center text-sm text-red-600 dark:text-red-400">{loadError}</PanelSection>
            )}

            {!loading && !loadError && products.length === 0 && (
              <PanelSection padding="lg">
                <div className="py-8 text-center">
                  <Package size={48} className="mx-auto text-fg-subtle mb-4" />
                  <h3 className="text-body font-semibold mb-2">Nenhum produto encontrado</h3>
                  <p className="text-fg-muted">{search ? 'Tente ajustar a busca ou os filtros.' : 'Importe produtos para começar.'}</p>
                </div>
              </PanelSection>
            )}

            {!loading && !loadError && products.length > 0 && (
              <>
                <div className="overflow-x-auto border-t border-edge">
                  <Table>
                    <Thead>
                      <Tr>
                        {isAdmin && (
                          <Th className="w-8">
                            <input
                              type="checkbox"
                              checked={products.length > 0 && selectedIds.size === products.length}
                              onChange={e => setSelectedIds(e.target.checked ? new Set(products.map(p => p.id)) : new Set())}
                            />
                          </Th>
                        )}
                        <Th>Produto</Th>
                        {showCol('ean') && <Th>EAN</Th>}
                        {showCol('brandLine') && <Th>Marca / Linha</Th>}
                        {showCol('location') && <Th>Local</Th>}
                        {showCol('price') && <Th className="text-right">Preço</Th>}
                        {showCol('quality') && <Th className="text-right">Qualidade cadastral</Th>}
                        {showCol('abcXyz') && <Th>ABC / XYZ</Th>}
                        {showCol('updatedAt') && <Th>Atualização</Th>}
                        <Th></Th>
                      </Tr>
                    </Thead>
                    <tbody>
                      {products.map(product => {
                        const association = associationByProduct.get(product.id);
                        const classification = classificationByProduct.get(product.id);
                        const eanCheck = validateProductEan(product.ean);
                        const quality = evaluateProductQuality({
                          ean: product.ean, price: product.price, location: product.location,
                          brandId: association?.brand_id ?? null, lineId: association?.line_id ?? null, hasAbcXyz: !!classification,
                        });
                        const origin = originByProduct.get(product.id);
                        return (
                          <Tr key={product.id} className="cursor-pointer" onClick={() => setInspectorProductId(product.id)}>
                            {isAdmin && (
                              <Td onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(product.id)}
                                  onChange={e => setSelectedIds(prev => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(product.id); else next.delete(product.id);
                                    return next;
                                  })}
                                />
                              </Td>
                            )}
                            <Td>
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control bg-surface-3 text-fg-subtle">
                                  <Package size={18} />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-fg line-clamp-2">{product.name}</p>
                                  <p className="text-xs text-fg-subtle font-mono">{product.sku}</p>
                                </div>
                              </div>
                            </Td>
                            {showCol('ean') && (
                              <Td>
                                {!eanCheck.present && (
                                  <span className="inline-flex items-center gap-2">
                                    <span className="text-fg-subtle">Não informado</span>
                                    {isAdmin && (
                                      <button onClick={e => { e.stopPropagation(); setInspectorProductId(product.id); }} className="text-xs text-accent hover:underline">
                                        Completar
                                      </button>
                                    )}
                                  </span>
                                )}
                                {eanCheck.present && !eanCheck.ok && (
                                  <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400" title={eanCheck.error ?? undefined}>
                                    <AlertCircle size={13} /> Inválido
                                  </span>
                                )}
                                {eanCheck.present && eanCheck.ok && <span className="font-mono text-fg-muted">{product.ean}</span>}
                              </Td>
                            )}
                            {showCol('brandLine') && (
                              <Td>
                                <span className="text-fg-muted">{association?.brand_id ? (brandNames.get(association.brand_id) ?? '—') : '—'}</span>
                                {association?.line_id && <p className="text-xs text-fg-subtle">{lineNames.get(association.line_id) ?? '—'}</p>}
                              </Td>
                            )}
                            {showCol('location') && (
                              <Td>
                                {product.location
                                  ? <span className="text-fg-muted">{product.location}</span>
                                  : (
                                    <span className="inline-flex items-center gap-2">
                                      <span className="text-fg-subtle">Não informado</span>
                                      {isAdmin && (
                                        <button onClick={e => { e.stopPropagation(); setInspectorProductId(product.id); }} className="text-xs text-accent hover:underline">
                                          Completar
                                        </button>
                                      )}
                                    </span>
                                  )}
                              </Td>
                            )}
                            {showCol('price') && <Td numeric>{formatPrice(product.price)}</Td>}
                            {showCol('quality') && (
                              <Td numeric title="Percentual de campos essenciais preenchidos: EAN válido, marca, linha, local, preço e classificação ABC/XYZ.">
                                <div className="flex flex-col items-end gap-1">
                                  <span className="text-fg-muted tabular-nums">{quality.score}%</span>
                                  <div className="h-1 w-16 rounded-full bg-surface-3 overflow-hidden">
                                    <div className="h-full bg-fg-subtle" style={{ width: `${quality.score}%` }} />
                                  </div>
                                </div>
                              </Td>
                            )}
                            {showCol('abcXyz') && (
                              <Td className="text-fg-muted">{classification ? `${classification.abc_class} / ${classification.xyz_class}` : '—'}</Td>
                            )}
                            {showCol('updatedAt') && (
                              <Td className="text-xs text-fg-subtle" title={origin ? (origin.imported ? 'Origem: importação' : 'Origem: cadastro manual') : undefined}>
                                {formatDateTime(product.updated_at)}
                              </Td>
                            )}
                            <Td onClick={e => e.stopPropagation()}>
                              <RecordAdminMenu
                                label={`Ações para ${product.name}`}
                                actions={[
                                  { key: 'edit', label: 'Ver / editar', icon: <Pencil size={15} />, onSelect: () => setInspectorProductId(product.id) },
                                  ...(isAdmin ? [{ key: 'delete', label: 'Excluir', tone: 'danger' as const, icon: <Trash2 size={15} />, onSelect: () => handleDelete(product.id) }] : []),
                                ]}
                              />
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>

                <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-fg-subtle">
                    Mostrando {(currentPage - 1) * pageSize + 1} a {Math.min(currentPage * pageSize, totalProducts)} de {totalProducts.toLocaleString('pt-BR')} produtos
                  </p>
                  <div className="flex items-center gap-3">
                    <Select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                      <option value={20}>20 por página</option>
                      <option value={50}>50 por página</option>
                      <option value={100}>100 por página</option>
                    </Select>
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-2 rounded-lg text-fg-muted hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="text-sm text-fg-muted">Página {currentPage} de {Math.max(1, totalPages)}</span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-lg text-fg-muted hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </PanelSection>
              </>
            )}
          </Panel>
        </>
      )}

      <ProductQuickInspector
        open={!!inspectorProductId}
        productId={inspectorProductId}
        isAdmin={isAdmin}
        brands={brands}
        lines={lines}
        onClose={() => setInspectorProductId(null)}
        onSaved={updated => {
          setProducts(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
          setInspectorProductId(null);
        }}
      />

      {showAssignModal && companyId && (
        <AssignBrandLineModal
          companyId={companyId}
          productIds={Array.from(selectedIds)}
          brands={brands}
          lines={lines}
          onClose={() => setShowAssignModal(false)}
          onSaved={() => { setShowAssignModal(false); loadProducts(); }}
        />
      )}

      {showBulkEditModal && (
        <BulkEditFieldsModal
          productIds={Array.from(selectedIds)}
          onClose={() => setShowBulkEditModal(false)}
          onSaved={() => { setShowBulkEditModal(false); loadProducts(); }}
        />
      )}
    </Page>
  );
};

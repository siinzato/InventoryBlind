// Imported Products Page Component

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Package,
  ArrowLeft,
  Download,
  Trash2,
  Edit,
  Save,
  X,
  Filter,
  ChevronLeft,
  ChevronRight,
  Tag,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ProductFromDB } from '../lib/productImportTypes';
import type { ProductConfidenceScore, ProductRiskScore, ProductAbcXyzClassification } from '../lib/supabase';
import { formatPrice, formatDateTime, downloadFile, exportProductsToCSV } from '../lib/productImportUtils';
import { Page, PageHeader, Panel, PanelSection, Button, Table, Thead, Tr, Th, Td } from './ui';
import { useAuth } from '../lib/auth';
import { getConfidenceForProducts } from '../lib/cbcService';
import { getRiskForProducts } from '../lib/riskService';
import { getClassificationsForProducts } from '../lib/abcXyzService';
import { ConfidenceBadge } from './cbc/ConfidenceBadge';
import { ProductConfidenceModal } from './cbc/ProductConfidenceModal';
import { RiskBadge } from './risk/RiskBadge';
import { ClassificationBadge } from './abcxyz/ClassificationBadge';
import { getBrandLineNameMaps, listBrands, listLines, type ProductBrand, type ProductLine } from '../lib/productBrands/productBrandService';
import { AssignBrandLineModal } from './productBrands/AssignBrandLineModal';

/** Filtro vindo de Linhas e Marcas — quando presente, a listagem é restrita à
 *  marca/linha/pendência escolhida via join no backend (nunca no navegador). */
export interface ProductBrandLineFilter {
  brandId?: string;
  lineId?: string;
  noLine?: boolean;
  needsReview?: boolean;
  contextTitle: string;
}

interface AssociationEmbed { brand_id: string | null; line_id: string | null; match_status: string | null; matched_keyword: string | null }

interface ImportedProductsPageProps {
  onBack: () => void;
  isAdmin: boolean;
  /** Filtro por marca/linha vindo de Linhas e Marcas. Sem isso, a tela funciona exatamente como antes. */
  brandFilter?: ProductBrandLineFilter;
  /** Quando vindo de Linhas e Marcas: volta preservando o estado da tela anterior (que nunca desmonta). */
  onBackToBrands?: () => void;
}

export const ImportedProductsPage: React.FC<ImportedProductsPageProps> = ({
  onBack,
  isAdmin,
  brandFilter,
  onBackToBrands,
}) => {
  const [products, setProducts] = useState<ProductFromDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'name' | 'sku' | 'ean' | 'location'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ProductFromDB>>({});
  const [totalProducts, setTotalProducts] = useState(0);
  const [confidenceByProduct, setConfidenceByProduct] = useState<Map<string, ProductConfidenceScore>>(new Map());
  const [riskByProduct, setRiskByProduct] = useState<Map<string, ProductRiskScore>>(new Map());
  const [classificationByProduct, setClassificationByProduct] = useState<Map<string, ProductAbcXyzClassification>>(new Map());
  const [selectedProduct, setSelectedProduct] = useState<ProductFromDB | null>(null);
  const [associationByProduct, setAssociationByProduct] = useState<Map<string, AssociationEmbed>>(new Map());
  const [brandNames, setBrandNames] = useState<Map<string, string>>(new Map());
  const [lineNames, setLineNames] = useState<Map<string, string>>(new Map());
  const [brands, setBrands] = useState<ProductBrand[]>([]);
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAssignModal, setShowAssignModal] = useState(false);
  const pageSize = 20;
  const { companyId, profile } = useAuth();

  useEffect(() => {
    if (!companyId) return;
    getBrandLineNameMaps(companyId).then(({ brandNames, lineNames }) => { setBrandNames(brandNames); setLineNames(lineNames); });
    listBrands(companyId).then(setBrands);
    listLines(companyId).then(setLines);
  }, [companyId]);

  // Load products
  const loadProducts = async () => {
    setLoading(true);
    try {
      const needsJoinFilter = !!(brandFilter?.brandId || brandFilter?.lineId || brandFilter?.noLine || brandFilter?.needsReview);
      const embed = needsJoinFilter
        ? 'product_brand_associations!inner(brand_id,line_id,match_status,matched_keyword)'
        : 'product_brand_associations(brand_id,line_id,match_status,matched_keyword)';

      let query = supabase
        .from('products')
        .select(`*, ${embed}`, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (brandFilter?.lineId) {
        query = query.eq('product_brand_associations.line_id', brandFilter.lineId);
      } else if (brandFilter?.noLine) {
        query = query.eq('product_brand_associations.brand_id', brandFilter.brandId ?? '').is('product_brand_associations.line_id', null);
      } else if (brandFilter?.brandId) {
        query = query.eq('product_brand_associations.brand_id', brandFilter.brandId);
      }
      if (brandFilter?.needsReview) {
        query = query.eq('product_brand_associations.match_status', 'needs_review');
      }

      // Apply search filter
      if (searchTerm) {
        const term = `%${searchTerm}%`;
        if (searchField === 'all') {
          query = query.or(`name.ilike.${term},sku.ilike.${term},ean.ilike.${term},location.ilike.${term}`);
        } else {
          query = query.ilike(searchField, term);
        }
      }

      // Apply pagination
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      const rows = (data ?? []) as (ProductFromDB & { product_brand_associations: AssociationEmbed | AssociationEmbed[] | null })[];
      setProducts(rows);
      setTotalProducts(count || 0);
      setSelectedIds(new Set());

      const assocMap = new Map<string, AssociationEmbed>();
      for (const row of rows) {
        const raw = row.product_brand_associations;
        const assoc = Array.isArray(raw) ? raw[0] : raw;
        if (assoc) assocMap.set(row.id, assoc);
      }
      setAssociationByProduct(assocMap);

      if (rows.length > 0 && companyId) {
        const ids = rows.map((p) => p.id);
        getConfidenceForProducts(ids, companyId).then(setConfidenceByProduct);
        getRiskForProducts(ids, companyId).then(setRiskByProduct);
        getClassificationsForProducts(ids, companyId).then(setClassificationByProduct);
      } else {
        setConfidenceByProduct(new Map());
        setRiskByProduct(new Map());
        setClassificationByProduct(new Map());
      }
    } catch (err) {
      console.error('Error loading products:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchField, brandFilter?.brandId, brandFilter?.lineId, brandFilter?.noLine, brandFilter?.needsReview]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
      loadProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Handle search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    loadProducts();
  };

  // Start editing
  const handleEdit = (product: ProductFromDB) => {
    if (!isAdmin) return;
    setEditingId(product.id);
    setEditData({
      name: product.name,
      sku: product.sku,
      ean: product.ean,
      location: product.location,
      price: product.price,
    });
  };

  // Save edit
  const handleSave = async () => {
    if (!editingId || !editData) return;

    try {
      const { error } = await supabase
        .from('products')
        .update({
          ...editData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingId);

      if (error) throw error;

      setProducts(prev => prev.map(p =>
        p.id === editingId ? { ...p, ...editData } : p
      ));
      setEditingId(null);
      setEditData({});
    } catch (err) {
      console.error('Error saving product:', err);
      alert('Erro ao salvar produto');
    }
  };

  // Cancel edit
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  // Delete product
  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm('Tem certeza que deseja excluir este produto?')) return;

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setProducts(prev => prev.filter(p => p.id !== id));
      setTotalProducts(prev => prev - 1);
    } catch (err) {
      console.error('Error deleting product:', err);
      alert('Erro ao excluir produto');
    }
  };

  // Export products
  const handleExport = () => {
    const csv = products.map(p => ({
      name: p.name,
      sku: p.sku,
      ean: p.ean || '',
      location: p.location || '',
      price: p.price,
      status: 'update' as const,
    }));
    const content = exportProductsToCSV(csv);
    downloadFile(content, `produtos-importados-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const totalPages = Math.ceil(totalProducts / pageSize);

  return (
    <Page>
      <PageHeader
        title={brandFilter?.contextTitle ?? 'Produtos Importados'}
        description={`${totalProducts} produtos cadastrados`}
        actions={
          <>
            <Button variant="ghost" onClick={onBackToBrands ?? onBack}>
              <ArrowLeft size={16} />
              {onBackToBrands ? 'Voltar para Linhas e Marcas' : 'Voltar'}
            </Button>
            {isAdmin && selectedIds.size > 0 && (
              <Button variant="secondary" onClick={() => setShowAssignModal(true)}>
                <Tag size={16} /> Alterar marca/linha ({selectedIds.size})
              </Button>
            )}
            <Button variant="secondary" onClick={handleExport}>
              <Download size={16} />
              Exportar CSV
            </Button>
          </>
        }
      />

      {/* Search + Products */}
      <Panel>
        <PanelSection>
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                type="text"
                placeholder="Buscar produtos..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-surface-3 border border-edge rounded-lg text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <select
              value={searchField}
              onChange={(e) => setSearchField(e.target.value as typeof searchField)}
              className="px-4 py-2.5 bg-surface-3 border border-edge rounded-lg text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="all">Todos os campos</option>
              <option value="name">Nome</option>
              <option value="sku">SKU</option>
              <option value="ean">EAN</option>
              <option value="location">Local</option>
            </select>
          </form>
        </PanelSection>

        {loading ? (
          <PanelSection>
            <div className="py-8 text-center">
              <div className="animate-spin w-8 h-8 border-4 border-accent border-t-transparent rounded-full mx-auto" />
              <p className="text-fg-subtle mt-4">Carregando produtos...</p>
            </div>
          </PanelSection>
        ) : products.length === 0 ? (
          <PanelSection>
            <div className="py-8 text-center">
              <Package size={48} className="mx-auto text-fg-subtle mb-4" />
              <h3 className="text-body font-semibold mb-2">Nenhum produto encontrado</h3>
              <p className="text-fg-muted">
                {searchTerm ? 'Tente ajustar a busca.' : 'Importe produtos para comecar.'}
              </p>
            </div>
          </PanelSection>
        ) : (
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
                          onChange={(e) => setSelectedIds(e.target.checked ? new Set(products.map(p => p.id)) : new Set())}
                        />
                      </Th>
                    )}
                    <Th>Nome</Th>
                    <Th className="text-right">SKU</Th>
                    <Th>EAN</Th>
                    <Th>Marca</Th>
                    <Th>Linha</Th>
                    <Th>Local</Th>
                    <Th className="text-right">Preço</Th>
                    <Th>Confiança</Th>
                    <Th>Risco</Th>
                    <Th>ABC/XYZ</Th>
                    <Th>Atualizado</Th>
                    <Th>Ações</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {products.map((product) => {
                    const association = associationByProduct.get(product.id);
                    return (
                    <Tr key={product.id}>
                      {isAdmin && (
                        <Td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(product.id)}
                            onChange={(e) => setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(product.id); else next.delete(product.id);
                              return next;
                            })}
                          />
                        </Td>
                      )}
                      <Td>
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.name || ''}
                            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                            className="w-full px-2 py-1 bg-surface-3 border border-edge rounded text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        ) : (
                          <span className="text-fg">{product.name}</span>
                        )}
                      </Td>
                      <Td numeric>
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.sku || ''}
                            onChange={(e) => setEditData({ ...editData, sku: e.target.value })}
                            className="w-full px-2 py-1 bg-surface-3 border border-edge rounded text-sm font-mono text-fg text-right focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        ) : (
                          product.sku
                        )}
                      </Td>
                      <Td>
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.ean || ''}
                            onChange={(e) => setEditData({ ...editData, ean: e.target.value })}
                            className="w-full px-2 py-1 bg-surface-3 border border-edge rounded text-sm font-mono text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        ) : (
                          <span className="font-mono text-fg-muted">{product.ean || '-'}</span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-fg-muted">{association?.brand_id ? (brandNames.get(association.brand_id) ?? '—') : '—'}</span>
                      </Td>
                      <Td>
                        <span className="text-fg-muted">{association?.line_id ? (lineNames.get(association.line_id) ?? '—') : '—'}</span>
                        {association?.matched_keyword && <p className="text-xs text-fg-subtle">via "{association.matched_keyword}"</p>}
                      </Td>
                      <Td>
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.location || ''}
                            onChange={(e) => setEditData({ ...editData, location: e.target.value })}
                            className="w-full px-2 py-1 bg-surface-3 border border-edge rounded text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        ) : (
                          <span className="text-fg-muted">{product.location || '-'}</span>
                        )}
                      </Td>
                      <Td numeric>
                        {editingId === product.id ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editData.price || ''}
                            onChange={(e) => setEditData({ ...editData, price: e.target.value ? parseFloat(e.target.value) : null })}
                            className="w-20 px-2 py-1 bg-surface-3 border border-edge rounded text-sm text-fg text-right focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        ) : (
                          formatPrice(product.price)
                        )}
                      </Td>
                      <Td>
                        {confidenceByProduct.has(product.id) ? (
                          <button onClick={() => setSelectedProduct(product)} className="cursor-pointer">
                            <ConfidenceBadge
                              riskLevel={confidenceByProduct.get(product.id)!.risk_level}
                              score={confidenceByProduct.get(product.id)!.confidence_score}
                            />
                          </button>
                        ) : (
                          <span className="text-xs text-fg-subtle">—</span>
                        )}
                      </Td>
                      <Td>
                        {riskByProduct.has(product.id) ? (
                          <button onClick={() => setSelectedProduct(product)} className="cursor-pointer">
                            <RiskBadge
                              riskLevel={riskByProduct.get(product.id)!.risk_level}
                              score={riskByProduct.get(product.id)!.risk_score}
                            />
                          </button>
                        ) : (
                          <span className="text-xs text-fg-subtle">—</span>
                        )}
                      </Td>
                      <Td>
                        {classificationByProduct.has(product.id) ? (
                          <button onClick={() => setSelectedProduct(product)} className="cursor-pointer">
                            <ClassificationBadge combo={classificationByProduct.get(product.id)!.abc_xyz_class} />
                          </button>
                        ) : (
                          <span className="text-xs text-fg-subtle">—</span>
                        )}
                      </Td>
                      <Td className="text-xs text-fg-subtle">
                        {formatDateTime(product.updatedAt)}
                      </Td>
                      <Td>
                        {isAdmin && (
                          <div className="flex items-center gap-2">
                            {editingId === product.id ? (
                              <>
                                <button
                                  onClick={handleSave}
                                  className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded transition"
                                >
                                  <Save size={16} />
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  className="p-1.5 text-fg-muted hover:bg-surface-3 rounded transition"
                                >
                                  <X size={16} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleEdit(product)}
                                  className="p-1.5 text-accent hover:bg-accent/10 rounded transition"
                                >
                                  <Edit size={16} />
                                </button>
                                <button
                                  onClick={() => handleDelete(product.id)}
                                  className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded transition"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </Td>
                    </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <PanelSection padding="sm" className="flex items-center justify-between">
                <p className="text-sm text-fg-subtle">
                  Mostrando {(currentPage - 1) * pageSize + 1} a{' '}
                  {Math.min(currentPage * pageSize, totalProducts)} de {totalProducts} produtos
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg text-fg-muted hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className="text-sm text-fg-muted">
                    Pagina {currentPage} de {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg text-fg-muted hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </PanelSection>
            )}
          </>
        )}
      </Panel>

      {selectedProduct && companyId && (
        <ProductConfidenceModal
          open={!!selectedProduct}
          onClose={() => setSelectedProduct(null)}
          productId={selectedProduct.id}
          productName={selectedProduct.name}
          companyId={companyId}
          role={profile?.role}
          userId={profile?.id}
          userEmail={profile?.email ?? undefined}
        />
      )}

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
    </Page>
  );
};

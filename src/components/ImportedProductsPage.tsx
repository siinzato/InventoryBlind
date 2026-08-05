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
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ProductFromDB } from '../lib/productImportTypes';
import { formatPrice, formatDateTime, downloadFile, exportProductsToCSV } from '../lib/productImportUtils';
import { Panel, PanelSection, Button, Table, Tr, Td } from './ui';

interface ImportedProductsPageProps {
  onBack: () => void;
  isAdmin: boolean;
}

export const ImportedProductsPage: React.FC<ImportedProductsPageProps> = ({
  onBack,
  isAdmin,
}) => {
  const [products, setProducts] = useState<ProductFromDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'name' | 'sku' | 'ean' | 'location'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ProductFromDB>>({});
  const [totalProducts, setTotalProducts] = useState(0);
  const pageSize = 20;

  // Load products
  const loadProducts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

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

      setProducts(data || []);
      setTotalProducts(count || 0);
    } catch (err) {
      console.error('Error loading products:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProducts();
  }, [currentPage, searchField]);

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
    <div className="min-h-screen bg-surface p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-fg-muted hover:text-fg transition mb-4"
          >
            <ArrowLeft size={20} />
            Voltar
          </button>

          <div className="flex items-center gap-3">
            <div className="p-3 bg-accent rounded-xl">
              <Package size={28} className="text-white" />
            </div>
            <div>
              <h1 className="text-title">Produtos Importados</h1>
              <p className="text-fg-muted">{totalProducts} produtos cadastrados</p>
            </div>
          </div>
        </div>

        <Button variant="secondary" onClick={handleExport}>
          <Download size={16} />
          Exportar CSV
        </Button>
      </div>

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
                <thead>
                  <tr className="border-b border-edge">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide">Nome</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide">SKU</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide">EAN</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide">Local</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide">Preco</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide">Atualizado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase tracking-wide">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <Tr key={product.id}>
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
                      <Td>
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.sku || ''}
                            onChange={(e) => setEditData({ ...editData, sku: e.target.value })}
                            className="w-full px-2 py-1 bg-surface-3 border border-edge rounded text-sm font-mono text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        ) : (
                          <span className="font-mono text-fg">{product.sku}</span>
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
                      <Td>
                        {editingId === product.id ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editData.price || ''}
                            onChange={(e) => setEditData({ ...editData, price: e.target.value ? parseFloat(e.target.value) : null })}
                            className="w-20 px-2 py-1 bg-surface-3 border border-edge rounded text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        ) : (
                          <span className="text-fg">{formatPrice(product.price)}</span>
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
                  ))}
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
    </div>
  );
};

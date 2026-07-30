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
    <div className="min-h-screen bg-zinc-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-zinc-600 hover:text-zinc-800 transition mb-4"
        >
          <ArrowLeft size={20} />
          Voltar
        </button>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600 rounded-xl">
              <Package size={28} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-800">Produtos Importados</h1>
              <p className="text-zinc-500">{totalProducts} produtos cadastrados</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition text-sm font-medium text-zinc-700"
            >
              <Download size={16} />
              Exportar CSV
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-4 mb-6">
        <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar produtos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as typeof searchField)}
            className="px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todos os campos</option>
            <option value="name">Nome</option>
            <option value="sku">SKU</option>
            <option value="ean">EAN</option>
            <option value="location">Local</option>
          </select>
        </form>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-zinc-500 mt-4">Carregando produtos...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={48} className="mx-auto text-zinc-300 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-700 mb-2">Nenhum produto encontrado</h3>
            <p className="text-zinc-500">
              {searchTerm ? 'Tente ajustar a busca.' : 'Importe produtos para comecar.'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-700">Nome</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-700">SKU</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-700">EAN</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-700">Local</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-700">Preco</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-700">Atualizado</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-700">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {products.map((product) => (
                    <tr key={product.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.name || ''}
                            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                            className="w-full px-2 py-1 border border-zinc-200 rounded text-sm"
                          />
                        ) : (
                          <span className="text-zinc-800">{product.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.sku || ''}
                            onChange={(e) => setEditData({ ...editData, sku: e.target.value })}
                            className="w-full px-2 py-1 border border-zinc-200 rounded text-sm font-mono"
                          />
                        ) : (
                          <span className="font-mono text-zinc-800">{product.sku}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.ean || ''}
                            onChange={(e) => setEditData({ ...editData, ean: e.target.value })}
                            className="w-full px-2 py-1 border border-zinc-200 rounded text-sm font-mono"
                          />
                        ) : (
                          <span className="font-mono text-zinc-600">{product.ean || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === product.id ? (
                          <input
                            type="text"
                            value={editData.location || ''}
                            onChange={(e) => setEditData({ ...editData, location: e.target.value })}
                            className="w-full px-2 py-1 border border-zinc-200 rounded text-sm"
                          />
                        ) : (
                          <span className="text-zinc-600">{product.location || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === product.id ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editData.price || ''}
                            onChange={(e) => setEditData({ ...editData, price: e.target.value ? parseFloat(e.target.value) : null })}
                            className="w-20 px-2 py-1 border border-zinc-200 rounded text-sm"
                          />
                        ) : (
                          <span className="text-zinc-800">{formatPrice(product.price)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {formatDateTime(product.updatedAt)}
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin && (
                          <div className="flex items-center gap-2">
                            {editingId === product.id ? (
                              <>
                                <button
                                  onClick={handleSave}
                                  className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition"
                                >
                                  <Save size={16} />
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  className="p-1.5 text-zinc-600 hover:bg-zinc-100 rounded transition"
                                >
                                  <X size={16} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleEdit(product)}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"
                                >
                                  <Edit size={16} />
                                </button>
                                <button
                                  onClick={() => handleDelete(product.id)}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded transition"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200">
                <p className="text-sm text-zinc-500">
                  Mostrando {(currentPage - 1) * pageSize + 1} a{' '}
                  {Math.min(currentPage * pageSize, totalProducts)} de {totalProducts} produtos
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className="text-sm text-zinc-700">
                    Pagina {currentPage} de {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

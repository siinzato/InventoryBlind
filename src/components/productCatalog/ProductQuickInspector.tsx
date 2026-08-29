import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Package, ExternalLink } from 'lucide-react';
import { Button, Input, Select } from '../ui';
import { supabase } from '../../lib/supabase';
import type { ProductAbcXyzClassification } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logAuditEvent } from '../../lib/auditLogService';
import { formatDateTime } from '../../lib/productImportUtils';
import { validateProductEan, evaluateProductQuality } from '../../lib/productCatalog/catalogQuality';
import { listProductHistory, getProductOrigins, type CatalogEvent } from '../../lib/productCatalog/catalogHistoryService';
import type { ProductBrand, ProductLine } from '../../lib/productBrands/productBrandService';
import { bulkAssignProductAssociation } from '../../lib/productBrands/productBrandService';

interface ProductRow {
  id: string; name: string; sku: string; ean: string | null; location: string | null;
  price: number | null; stock_quantity: number; created_at: string; updated_at: string;
}

interface AssociationRow { brand_id: string | null; line_id: string | null }

type Tab = 'cadastro' | 'estoque' | 'historico';

interface ProductQuickInspectorProps {
  open: boolean;
  productId: string | null;
  isAdmin: boolean;
  brands: ProductBrand[];
  lines: ProductLine[];
  onClose: () => void;
  /** Notificado com o produto salvo, para o chamador atualizar só a linha alterada. */
  onSaved: (product: ProductRow) => void;
}

interface EditState {
  name: string;
  sku: string;
  ean: string;
  price: string;
  brandId: string;
  lineId: string;
}

function toEditState(p: ProductRow, assoc: AssociationRow | null): EditState {
  return {
    name: p.name, sku: p.sku, ean: p.ean ?? '', price: p.price != null ? String(p.price) : '',
    brandId: assoc?.brand_id ?? '', lineId: assoc?.line_id ?? '',
  };
}

/** Painel lateral do Catálogo de Produtos — mesmo padrão de slide-over já usado
 *  em WarehousePositionDrawer.tsx (motion + tokens de Modal), agora com abas e
 *  rodapé fixo porque este painel tem formulário editável. */
export function ProductQuickInspector({ open, productId, isAdmin, brands, lines, onClose, onSaved }: ProductQuickInspectorProps) {
  const { profile, companyId } = useAuth();
  const [tab, setTab] = useState<Tab>('cadastro');
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [association, setAssociation] = useState<AssociationRow | null>(null);
  const [classification, setClassification] = useState<ProductAbcXyzClassification | null>(null);
  const [origin, setOrigin] = useState<{ imported: boolean; importedAt: string | null; fileName: string | null } | null>(null);
  const [history, setHistory] = useState<CatalogEvent[] | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !productId) return;
    setTab('cadastro');
    setLoading(true);
    setError(null);
    let cancelled = false;

    (async () => {
      const [{ data: productData, error: productError }, { data: assocData }, { data: classData }] = await Promise.all([
        supabase.from('products').select('id, name, sku, ean, location, price, stock_quantity, created_at, updated_at').eq('id', productId).maybeSingle(),
        supabase.from('product_brand_associations').select('brand_id, line_id').eq('product_id', productId).maybeSingle(),
        supabase.from('product_abc_xyz_classifications').select('*').eq('product_id', productId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (productError || !productData) {
        setError('Não foi possível carregar este produto.');
        setLoading(false);
        return;
      }
      setProduct(productData);
      setAssociation(assocData ?? null);
      setClassification(classData ?? null);
      setEdit(toEditState(productData, assocData ?? null));
      setLoading(false);

      if (companyId) {
        getProductOrigins(companyId, [productId]).then(m => { if (!cancelled) setOrigin(m.get(productId) ?? { imported: false, importedAt: null, fileName: null }); });
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  useEffect(() => {
    if (tab !== 'historico' || !productId || !companyId || history) return;
    listProductHistory(companyId, productId).then(setHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, productId]);

  useEffect(() => {
    if (!open) { setProduct(null); setAssociation(null); setClassification(null); setOrigin(null); setHistory(null); setEdit(null); setError(null); }
  }, [open]);

  const eanCheck = useMemo(() => validateProductEan(edit?.ean ?? null), [edit?.ean]);
  const quality = useMemo(() => {
    if (!product) return null;
    return evaluateProductQuality({
      ean: edit?.ean ?? product.ean, price: product.price, location: product.location,
      brandId: edit?.brandId || null, lineId: edit?.lineId || null, hasAbcXyz: !!classification,
    });
  }, [product, edit?.ean, edit?.brandId, edit?.lineId, classification]);

  const linesForBrand = lines.filter(l => l.brandId === edit?.brandId);

  const dirty = useMemo(() => {
    if (!product || !edit) return false;
    const base = toEditState(product, association);
    return base.name !== edit.name || base.sku !== edit.sku || base.ean !== edit.ean || base.price !== edit.price
      || base.brandId !== edit.brandId || base.lineId !== edit.lineId;
  }, [product, association, edit]);

  const handleClose = () => {
    if (dirty && !window.confirm('Existem alterações não salvas. Deseja descartá-las?')) return;
    onClose();
  };

  const handleSave = async () => {
    if (!product || !edit || saving) return;
    if (!edit.name.trim() || !edit.sku.trim()) { setError('Nome e SKU são obrigatórios.'); return; }
    if (!eanCheck.ok) { setError(eanCheck.error); return; }

    setSaving(true);
    setError(null);
    try {
      const priceValue = edit.price.trim() ? Number(edit.price.replace(',', '.')) : null;
      const base = toEditState(product, association);
      const patch: Record<string, string | number | null> = {};
      if (edit.name !== base.name) patch.name = edit.name.trim();
      if (edit.sku !== base.sku) patch.sku = edit.sku.trim();
      if (edit.ean !== base.ean) patch.ean = edit.ean.trim() || null;
      if (edit.price !== base.price) patch.price = priceValue;

      let updated = product;
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        const { data, error: updateError } = await supabase.from('products').update(patch).eq('id', product.id).select().single();
        if (updateError) {
          if (updateError.code === '23505') { setError('Já existe um produto com este SKU.'); setSaving(false); return; }
          throw updateError;
        }
        updated = data;
        setProduct(data);
        if (companyId && profile) {
          await logAuditEvent({ companyId, userId: profile.id, userEmail: profile.email ?? '', action: 'products.updated', resourceType: 'product', resourceId: product.id, metadata: { fields: Object.keys(patch).filter(k => k !== 'updated_at') } });
        }
      }

      if ((edit.brandId || '') !== (base.brandId || '') || (edit.lineId || '') !== (base.lineId || '')) {
        if (companyId && profile) {
          await bulkAssignProductAssociation(companyId, [product.id], edit.brandId || null, edit.lineId || null, profile.id, profile.email ?? '');
          setAssociation({ brand_id: edit.brandId || null, line_id: edit.lineId || null });
        }
      }

      onSaved(updated);
      setHistory(null);
    } catch (err) {
      console.error('[ProductQuickInspector] save', err);
      setError('Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'cadastro', label: 'Cadastro' },
    { key: 'estoque', label: 'Estoque e localização' },
    { key: 'historico', label: 'Histórico' },
  ];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0" style={{ zIndex: 'var(--z-modal)' }}>
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            style={{ zIndex: 'var(--z-modal-backdrop)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            style={{ zIndex: 'var(--z-modal)' }}
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-surface border-l border-edge shadow-overlay"
          >
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-edge flex-shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control bg-surface-3 text-fg-subtle">
                  <Package size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-fg line-clamp-2">{product?.name ?? (loading ? 'Carregando…' : 'Produto')}</h2>
                  <p className="text-xs text-fg-subtle font-mono">{product?.sku ?? '—'}</p>
                  {quality && quality.issues.length > 0 && (
                    <p className="text-xs text-fg-subtle mt-0.5">{quality.issues[0].label}{quality.issues.length > 1 ? ` (+${quality.issues.length - 1})` : ''}</p>
                  )}
                </div>
              </div>
              <button onClick={handleClose} className="flex-shrink-0 text-fg-subtle hover:text-fg transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex border-b border-edge flex-shrink-0 px-2">
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${tab === t.key ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && <p className="p-6 text-sm text-fg-subtle">Carregando…</p>}
              {!loading && !product && <p className="p-6 text-sm text-red-600 dark:text-red-400">{error ?? 'Produto não encontrado.'}</p>}

              {!loading && product && edit && tab === 'cadastro' && (
                <div className="p-6 space-y-6">
                  <section className="space-y-3">
                    <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Identificação</p>
                    <Field label="Nome">
                      <Input value={edit.name} disabled={!isAdmin} onChange={e => setEdit({ ...edit, name: e.target.value })} />
                    </Field>
                    <Field label="SKU">
                      <Input value={edit.sku} disabled={!isAdmin} onChange={e => setEdit({ ...edit, sku: e.target.value })} className="font-mono" />
                    </Field>
                    <Field label="EAN">
                      <Input value={edit.ean} disabled={!isAdmin} onChange={e => setEdit({ ...edit, ean: e.target.value })} className="font-mono" />
                      {!eanCheck.ok && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{eanCheck.error}</p>}
                    </Field>
                    <Field label="Origem do dado">
                      <p className="text-sm text-fg-muted">
                        {origin === null ? '—' : origin.imported ? `Planilha importada em ${formatDateTime(origin.importedAt ?? '')}${origin.fileName ? ` (${origin.fileName})` : ''}` : 'Cadastro manual'}
                      </p>
                    </Field>
                  </section>

                  <section className="space-y-3 pt-4 border-t border-edge">
                    <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Organização</p>
                    <Field label="Marca">
                      <Select value={edit.brandId} disabled={!isAdmin} onChange={e => setEdit({ ...edit, brandId: e.target.value, lineId: '' })}>
                        <option value="">Sem marca</option>
                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Linha">
                      <Select value={edit.lineId} disabled={!isAdmin || !edit.brandId} onChange={e => setEdit({ ...edit, lineId: e.target.value })}>
                        <option value="">Sem linha</option>
                        {linesForBrand.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="ABC / XYZ">
                      <p className="text-sm text-fg-muted">{classification ? `${classification.abc_class} / ${classification.xyz_class}` : '— (sem classificação ainda)'}</p>
                    </Field>
                  </section>

                  <section className="space-y-3 pt-4 border-t border-edge">
                    <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Dados comerciais</p>
                    <Field label="Preço">
                      <Input type="number" step="0.01" value={edit.price} disabled={!isAdmin} onChange={e => setEdit({ ...edit, price: e.target.value })} />
                    </Field>
                  </section>

                  <section className="space-y-2 pt-4 border-t border-edge">
                    <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Rastreabilidade</p>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-fg-subtle">Última alteração</span>
                      <span className="text-fg-muted">{formatDateTime(product.updated_at)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-fg-subtle">Qualidade cadastral</span>
                      <span className="text-fg-muted" title="Percentual de campos essenciais preenchidos: EAN válido, marca, linha, local, preço e classificação ABC/XYZ.">{quality?.score ?? 0}%</span>
                    </div>
                    <button onClick={() => setTab('historico')} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
                      Ver histórico de alterações <ExternalLink size={12} />
                    </button>
                  </section>

                  {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                </div>
              )}

              {!loading && product && tab === 'estoque' && (
                <div className="p-6 space-y-3">
                  <Row label="Estoque total" value={product.stock_quantity.toLocaleString('pt-BR')} />
                  <Row label="Localização" value={product.location || '—'} />
                  <Row label="Última atualização" value={formatDateTime(product.updated_at)} />
                  <p className="text-xs text-fg-subtle pt-2">Estoque por origem/canal e última contagem física aparecem aqui quando a integração ou a contagem correspondente estiver disponível para este produto.</p>
                </div>
              )}

              {!loading && product && tab === 'historico' && (
                <div className="p-6">
                  {history === null && <p className="text-sm text-fg-subtle">Carregando…</p>}
                  {history !== null && history.length === 0 && <p className="text-sm text-fg-subtle">Nenhum evento registrado para este produto ainda.</p>}
                  {history !== null && history.length > 0 && (
                    <div className="divide-y divide-edge">
                      {history.map(ev => (
                        <div key={ev.id} className="py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-fg">{ev.label}</p>
                            <p className="text-xs text-fg-subtle flex-shrink-0">{formatDateTime(ev.createdAt)}</p>
                          </div>
                          {(ev.detail || ev.userEmail) && (
                            <p className="text-xs text-fg-subtle mt-0.5">{[ev.userEmail, ev.detail].filter(Boolean).join(' · ')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {isAdmin && product && tab !== 'historico' && (
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-edge flex-shrink-0">
                <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saving || !dirty}>{saving ? 'Salvando…' : 'Salvar alterações'}</Button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-fg-subtle mb-1">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-fg-subtle">{label}</span>
      <span className="text-fg-muted">{value}</span>
    </div>
  );
}

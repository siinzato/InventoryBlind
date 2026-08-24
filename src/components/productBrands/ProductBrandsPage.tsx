import { useEffect, useState } from 'react';
import { Plus, ChevronDown, ChevronRight, RefreshCw, PlayCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Button, Select } from '../ui';
import { useAuth } from '../../lib/auth';
import { hasPermission } from '../../lib/permissionService';
import { listTeamMembers } from '../../lib/tasks/taskService';
import type { TeamMember } from '../../lib/tasks/types';
import {
  listBrands, listLines, setBrandActive, setLineActive, countProductsForBrand, countProductsForLine,
  listReviewQueue, confirmProductAssociation, classifyCompanyProducts,
  type ProductBrand, type ProductLine, type ProductBrandAssociation,
} from '../../lib/productBrands/productBrandService';
import { BrandLineFormModal } from './BrandLineFormModal';

interface ProductBrandsPageProps {
  companyId: string;
}

export function ProductBrandsPage({ companyId }: ProductBrandsPageProps) {
  const { profile } = useAuth();
  const [brands, setBrands] = useState<ProductBrand[]>([]);
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [counts, setCounts] = useState<{ brand: Map<string, number>; line: Map<string, number> }>({ brand: new Map(), line: new Map() });
  const [reviewQueue, setReviewQueue] = useState<ProductBrandAssociation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [formModal, setFormModal] = useState<{ mode: 'brand' | 'line'; brand?: ProductBrand; line?: ProductLine; defaultBrandId?: string } | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<string | null>(null);

  const canWrite = hasPermission(profile?.role, 'products.write');

  const load = async () => {
    setLoading(true);
    try {
      const [brandsData, linesData, membersData, queue] = await Promise.all([
        listBrands(companyId), listLines(companyId), listTeamMembers(companyId), listReviewQueue(companyId),
      ]);
      setBrands(brandsData);
      setLines(linesData);
      setMembers(membersData);
      setReviewQueue(queue);

      const brandCounts = new Map<string, number>();
      const lineCounts = new Map<string, number>();
      await Promise.all([
        ...brandsData.map(async b => brandCounts.set(b.id, await countProductsForBrand(b.id))),
        ...linesData.map(async l => lineCounts.set(l.id, await countProductsForLine(l.id))),
      ]);
      setCounts({ brand: brandCounts, line: lineCounts });
    } catch (err) {
      console.error('Error loading brands/lines:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const toggleExpanded = (brandId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(brandId)) next.delete(brandId); else next.add(brandId);
      return next;
    });
  };

  const visibleBrands = brands.filter(b => statusFilter === 'all' || (statusFilter === 'active' ? b.active : !b.active));

  const handleClassify = async () => {
    if (classifying) return;
    setClassifying(true);
    setClassifyResult(null);
    try {
      const result = await classifyCompanyProducts(companyId, profile?.id ?? '', profile?.email ?? '');
      setClassifyResult(`${result.classified} classificados automaticamente, ${result.needsReview} para revisão, ${result.unmatched} não identificados.`);
      load();
    } catch (err) {
      console.error('Error classifying products:', err);
      setClassifyResult('Erro ao classificar. Tente novamente.');
    } finally {
      setClassifying(false);
    }
  };

  const handleReviewDecision = async (association: ProductBrandAssociation, brandId: string | null, lineId: string | null) => {
    await confirmProductAssociation(companyId, { productId: association.productId, brandId, lineId }, profile?.id ?? '', profile?.email ?? '');
    setReviewQueue(prev => prev.filter(a => a.id !== association.id));
  };

  if (loading) {
    return <Page><PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Carregando...</PanelSection></Page>;
  }

  return (
    <Page>
      <PageHeader
        title="Linhas e Marcas"
        description="Cadastre marcas e linhas do seu catálogo e associe produtos automaticamente pelo título."
        actions={canWrite ? (
          <>
            {brands.length > 0 && (
              <Button variant="secondary" onClick={handleClassify} disabled={classifying}>
                {classifying ? <RefreshCw size={16} className="animate-spin" /> : <PlayCircle size={16} />} Classificar catálogo
              </Button>
            )}
            <Button onClick={() => setFormModal({ mode: 'brand' })}><Plus size={16} /> Nova marca</Button>
          </>
        ) : undefined}
      />

      {classifyResult && (
        <Panel><PanelSection padding="md" className="text-sm text-fg-muted">{classifyResult}</PanelSection></Panel>
      )}

      {brands.length === 0 && (
        <Panel>
          <PanelSection padding="lg" className="text-center space-y-3">
            <p className="text-sm text-fg-subtle">Nenhuma marca cadastrada ainda.</p>
            {canWrite && <Button onClick={() => setFormModal({ mode: 'brand' })}><Plus size={16} /> Cadastrar primeira marca</Button>}
          </PanelSection>
        </Panel>
      )}

      {brands.length > 0 && (
        <Panel>
          <PanelSection padding="md" className="flex items-center gap-3">
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="w-40">
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
              <option value="all">Todas</option>
            </Select>
          </PanelSection>

          {visibleBrands.map(brand => {
            const brandLines = lines.filter(l => l.brandId === brand.id);
            const isOpen = expanded.has(brand.id);
            return (
              <div key={brand.id} className="border-t border-edge">
                <PanelSection padding="md" className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => toggleExpanded(brand.id)} className="flex items-center gap-2 min-w-0 text-left">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="font-medium text-fg">{brand.name}</span>
                    {brand.code && <Badge variant="neutral">{brand.code}</Badge>}
                    {!brand.active && <Badge variant="warning">Inativa</Badge>}
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-fg-subtle">{counts.brand.get(brand.id) ?? 0} produtos</span>
                    {canWrite && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setFormModal({ mode: 'line', defaultBrandId: brand.id })}>+ Linha</Button>
                        <Button variant="ghost" size="sm" onClick={() => setFormModal({ mode: 'brand', brand })}>Editar</Button>
                        <Button variant="ghost" size="sm" onClick={() => setBrandActive(companyId, brand.id, !brand.active, profile?.id ?? '', profile?.email ?? '').then(load)}>
                          {brand.active ? 'Desativar' : 'Ativar'}
                        </Button>
                      </>
                    )}
                  </div>
                </PanelSection>

                {isOpen && brandLines.map(line => (
                  <PanelSection key={line.id} padding="sm" className="pl-8 flex items-center justify-between gap-3">
                    <span className="text-sm text-fg">{line.name} {!line.active && <Badge variant="warning">Inativa</Badge>}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-fg-subtle">{counts.line.get(line.id) ?? 0} produtos</span>
                      {canWrite && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setFormModal({ mode: 'line', line })}>Editar</Button>
                          <Button variant="ghost" size="sm" onClick={() => setLineActive(companyId, line.id, !line.active, profile?.id ?? '', profile?.email ?? '').then(load)}>
                            {line.active ? 'Desativar' : 'Ativar'}
                          </Button>
                        </>
                      )}
                    </div>
                  </PanelSection>
                ))}
                {isOpen && brandLines.length === 0 && (
                  <PanelSection padding="sm" className="pl-8 text-xs text-fg-subtle">Nenhuma linha cadastrada.</PanelSection>
                )}
              </div>
            );
          })}
        </Panel>
      )}

      <Panel>
        <PanelSection padding="md"><p className="text-title">Revisar sugestões ({reviewQueue.length})</p></PanelSection>
        {reviewQueue.length === 0 && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhum item aguardando revisão.</PanelSection>}
        {reviewQueue.map(association => (
          <PanelSection key={association.id} padding="md" className="space-y-2">
            <p className="text-sm text-fg-subtle">Candidatos:</p>
            <div className="flex flex-wrap gap-2">
              {association.candidateMatches.map(candidate => (
                <Button
                  key={`${candidate.type}-${candidate.id}`}
                  variant="secondary" size="sm"
                  onClick={() => handleReviewDecision(
                    association,
                    candidate.type === 'brand' ? candidate.id : brands.find(b => lines.some(l => l.id === candidate.id && l.brandId === b.id))?.id ?? null,
                    candidate.type === 'line' ? candidate.id : null
                  )}
                >
                  <CheckCircle2 size={14} /> {candidate.name}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => handleReviewDecision(association, null, null)}><XCircle size={14} /> Nenhum</Button>
            </div>
          </PanelSection>
        ))}
      </Panel>

      {formModal && (
        <BrandLineFormModal
          companyId={companyId}
          mode={formModal.mode}
          brands={brands}
          members={members}
          editingBrand={formModal.brand}
          editingLine={formModal.line}
          defaultBrandId={formModal.defaultBrandId}
          onClose={() => setFormModal(null)}
          onSaved={() => { setFormModal(null); load(); }}
        />
      )}
    </Page>
  );
}

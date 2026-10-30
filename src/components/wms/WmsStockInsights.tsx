// Pulmão -> Consultar SKU. Onde está, quanto tem, há quanto tempo está parado.
//
// Uma superfície só: sem termo de busca a tela mostra TODO o saldo ordenado do mais
// parado para o mais novo — que é a visão de permanência. Digitando, filtra. Os
// mesmos filtros de faixa valem nos dois casos, então não há duas telas para aprender.
//
// A ressalva da antiguidade atravessa tudo: o modelo não tem camadas de lote, então
// depois de certas combinações de movimento a permanência é um TETO, não um valor
// exato. Quando é teto, o número aparece com "≤". Ver `lib/wms/stockInsights.ts`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, ChevronDown, ChevronRight, Lock, PackageSearch, Search } from 'lucide-react';
import { Badge, Button, Input, Notice, Panel, PanelSection, Table, Td, Th, Thead, Tr } from '../ui';
import { listPulmaoStock, searchPulmaoStock, type PulmaoStock } from '../../lib/wms/wmsService';
import {
  AGE_BUCKETS, countByBucket, summarize,
  type AgeBucket, type SkuSummary,
} from '../../lib/wms/stockInsights';

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR');

/** `≤` quando a data é teto. É a diferença entre informar e inventar, e cabe num
 *  caractere — sem balão, sem asterisco, sem nota de rodapé por linha. */
const ageLabel = (days: number, certainty: 'exata' | 'limite'): string =>
  `${certainty === 'limite' ? '≤ ' : ''}${days}d`;

const BUCKET_TONE: Record<AgeBucket, 'neutral' | 'warning'> = {
  '0-7': 'neutral',
  '8-15': 'neutral',
  '16-30': 'neutral',
  '30+': 'warning',
};

export function WmsStockInsights({ onOpenBin }: { onOpenBin: (code: string) => void }) {
  const [term, setTerm] = useState('');
  const [bucket, setBucket] = useState<AgeBucket | null>(null);
  const [data, setData] = useState<PulmaoStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async (needle: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(needle.trim().length >= 2 ? await searchPulmaoStock(needle) : await listPulmaoStock());
    } catch (err) {
      console.error('[wms] falha na consulta de saldo:', err);
      setError('Não foi possível consultar o pulmão.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Busca enquanto digita, mas sem uma consulta por tecla.
  useEffect(() => {
    const timer = setTimeout(() => { load(term); }, 300);
    return () => clearTimeout(timer);
  }, [term, load]);

  // `Date.now()` fica aqui, fora do cálculo: `summarize` recebe o instante e continua
  // testável sem relógio.
  const resumos = useMemo(
    () => (data ? summarize(data.placements, data.movements, Date.now()) : []),
    [data],
  );

  const contagem = useMemo(() => countByBucket(resumos), [resumos]);
  const visiveis = bucket ? resumos.filter(r => r.bucket === bucket) : resumos;

  const toggle = (id: string) =>
    setOpen(atual => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  const totalCaixas = visiveis.reduce((acc, r) => acc + r.totalBoxes, 0);

  return (
    <>
      <Panel>
        <PanelSection padding="sm">
          <Input
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="SKU, nome do produto ou EAN"
            icon={<Search />}
          />
          <p className="text-caption mt-2">
            Sem busca, a lista mostra tudo que está no pulmão — do mais parado para o mais novo.
          </p>

          {/* Faixas de permanência: filtro e panorama na mesma linha. Faixa vazia
              continua visível, porque zero é informação. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setBucket(null)}
              aria-pressed={bucket === null}
              className={`min-h-[44px] [@media(pointer:fine)]:min-h-[32px] rounded-control border px-3 text-sm transition-colors ${
                bucket === null
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-edge bg-surface-3 text-fg-muted hover:text-fg'
              }`}
            >
              Todas ({resumos.length})
            </button>
            {AGE_BUCKETS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setBucket(bucket === f.id ? null : f.id)}
                aria-pressed={bucket === f.id}
                className={`min-h-[44px] [@media(pointer:fine)]:min-h-[32px] rounded-control border px-3 text-sm transition-colors ${
                  bucket === f.id
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-edge bg-surface-3 text-fg-muted hover:text-fg'
                }`}
              >
                {f.short} ({contagem[f.id]})
              </button>
            ))}
          </div>
        </PanelSection>

        {data?.truncated && (
          <PanelSection padding="sm">
            <Notice tone="warning">
              O histórico é grande demais para ser lido inteiro nesta consulta, então
              nenhuma data de permanência pode ser confirmada como exata aqui. Busque um
              SKU específico para obter o número preciso.
            </Notice>
          </PanelSection>
        )}

        {error && <PanelSection padding="sm"><Notice tone="danger">{error}</Notice></PanelSection>}

        {loading ? (
          <PanelSection padding="sm"><p className="text-caption">Consultando...</p></PanelSection>
        ) : visiveis.length === 0 ? (
          <PanelSection padding="sm">
            <p className="text-caption">
              {term.trim().length >= 2
                ? 'Nada encontrado no pulmão para esse termo.'
                : bucket
                  ? 'Nenhum produto nesta faixa de permanência.'
                  : 'O pulmão está vazio — nenhuma caixa guardada ainda.'}
            </p>
          </PanelSection>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th className="w-8" />
                    <Th>SKU</Th>
                    <Th>Produto</Th>
                    <Th className="text-center">Caixas</Th>
                    <Th className="text-center">Unidades</Th>
                    <Th className="text-center">Endereços</Th>
                    <Th className="text-center">Parado há</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {visiveis.map(r => (
                    <SkuRows
                      key={r.productId}
                      resumo={r}
                      aberto={open.has(r.productId)}
                      onToggle={() => toggle(r.productId)}
                      onOpenBin={onOpenBin}
                    />
                  ))}
                </tbody>
              </Table>
            </div>

            <PanelSection padding="sm">
              <p className="text-caption">
                {visiveis.length} produto(s) · {totalCaixas} caixa(s).
                {' '}<strong>≤</strong> antes do tempo significa que a mercadoria entrou em mais de
                uma data e já houve retirada parcial: a permanência real pode ser menor que a
                indicada, nunca maior.
              </p>
            </PanelSection>
          </>
        )}
      </Panel>
    </>
  );
}

function SkuRows({
  resumo, aberto, onToggle, onOpenBin,
}: {
  resumo: SkuSummary;
  aberto: boolean;
  onToggle: () => void;
  onOpenBin: (code: string) => void;
}) {
  const packVariado = resumo.packSizes.length > 1;

  return (
    <>
      <Tr>
        <Td>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={aberto}
            aria-label={`${aberto ? 'Fechar' : 'Abrir'} a distribuição de ${resumo.sku}`}
            className="text-fg-subtle hover:text-fg transition-colors"
          >
            {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </Td>
        <Td className="text-numeric">{resumo.sku}</Td>
        <Td>
          {resumo.productName}
          {resumo.ean && <span className="block text-caption text-numeric">{resumo.ean}</span>}
        </Td>
        <Td className="text-center text-numeric">
          {resumo.totalBoxes}
          {/* Packs diferentes entre endereços: a soma de caixas deixa de ser uma
              medida única, e quem lê precisa saber antes de usar o número. */}
          {packVariado && (
            <span className="block text-caption text-amber-700 dark:text-amber-400">
              packs {resumo.packSizes.join(' e ')}
            </span>
          )}
        </Td>
        <Td className="text-center text-numeric">{resumo.totalUnits}</Td>
        <Td className="text-center text-numeric">{resumo.binCount}</Td>
        <Td className="text-center">
          <Badge variant={BUCKET_TONE[resumo.bucket]}>
            {ageLabel(resumo.oldestDays, resumo.oldestCertainty)}
          </Badge>
        </Td>
      </Tr>

      {aberto && (
        <Tr>
          <Td colSpan={7}>
            <div className="py-2 space-y-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-caption">
                <span>
                  Primeira entrada ainda no estoque:{' '}
                  <strong>{formatDate(resumo.oldestFirstStoredAt)}</strong>
                  {resumo.oldestCertainty === 'limite' && ' (no máximo)'}
                </span>
                <span>
                  Última movimentação:{' '}
                  <strong>{resumo.lastMovementAt ? formatDate(resumo.lastMovementAt) : '—'}</strong>
                </span>
                {resumo.topConcentration && resumo.binCount > 1 && (
                  <span>
                    Maior concentração:{' '}
                    <strong>{resumo.topConcentration.binCode}</strong>
                    {' '}({Math.round(resumo.topConcentration.share * 100)}% das caixas)
                  </span>
                )}
                {resumo.capacityUse && (
                  <span>
                    Ocupa <strong>{Math.round(resumo.capacityUse.ratio * 100)}%</strong> da capacidade
                    declarada {resumo.capacityUse.bins < resumo.binCount && '(das vagas que têm capacidade)'}
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Endereço</Th>
                      <Th className="text-center">Caixas</Th>
                      <Th className="text-center">Un/cx</Th>
                      <Th className="text-center">Unidades</Th>
                      <Th className="text-center">Guardado em</Th>
                      <Th className="text-center">Parado há</Th>
                      <Th />
                    </Tr>
                  </Thead>
                  <tbody>
                    {resumo.placements.map(p => (
                      <Tr key={p.binId}>
                        <Td className="font-medium text-fg">
                          {p.binCode}
                          {p.binBlocked && (
                            <Lock size={12} className="inline ml-1.5 text-amber-600 dark:text-amber-400" />
                          )}
                        </Td>
                        <Td className="text-center text-numeric">
                          {p.boxes}
                          {p.binCapacityBoxes != null && (
                            <span className="text-fg-subtle">/{p.binCapacityBoxes}</span>
                          )}
                        </Td>
                        <Td className="text-center text-numeric">{p.unitsPerBox}</Td>
                        <Td className="text-center text-numeric">{p.units}</Td>
                        <Td className="text-center text-caption">{formatDate(p.firstStoredAt)}</Td>
                        <Td className="text-center text-caption">
                          {ageLabel(p.days, p.certainty)}
                        </Td>
                        <Td className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => onOpenBin(p.binCode)}>
                            <Boxes size={14} />
                            Abrir
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          </Td>
        </Tr>
      )}
    </>
  );
}

/** Ícone exportado para a aba, mantendo o vocabulário visual do módulo. */
export const StockInsightsIcon = PackageSearch;

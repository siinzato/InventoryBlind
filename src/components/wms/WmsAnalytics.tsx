// Pulmão -> Gestão. Ocupação, movimentação, permanência e auditoria.
//
// Uma carga por período: endereços, saldo e histórico. Todo indicador é conta em
// memória sobre esses três — nenhuma consulta por cartão, nenhum saldo paralelo.
//
// A distinção que a tela mantém à força: ocupação por ENDEREÇO (quantas vagas têm
// alguma coisa) e ocupação por CAPACIDADE (quanto do volume declarado foi consumido)
// são números diferentes. O segundo só existe onde alguém declarou capacidade, e
// enquanto ninguém declarar a tela diz isso em vez de mostrar 0%.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Badge, Button, Input, Notice, Panel, PanelSection, Select, Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr } from '../ui';
import { downloadCsvText } from '../../lib/palletCalc/palletExportCsv';
import {
  agingRows, boxesByBucket, byBin, byDay, byOperator, capacitySummary,
  csvMovements, csvOccupancy, csvPlacements, csvSkuFootprint,
  movementSummary, occupancySummary, skuFootprint,
  type AnalyticsMovement, type Tally,
} from '../../lib/wms/pulmaoAnalytics';
import { AGE_BUCKETS } from '../../lib/wms/stockInsights';
import type { StockPlacement } from '../../lib/wms/stockInsights';
import {
  listMovementsForAnalytics, listPulmaoStock, searchProducts, type StorageBin,
} from '../../lib/wms/wmsService';

const MOVEMENT_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  saida: 'Retirada',
  transferencia: 'Transferência',
};

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const dateTime = (iso: string): string => new Date(iso).toLocaleString('pt-BR');

/** Barra proporcional ao maior valor da lista. Sem biblioteca: é uma div com largura. */
function RankBars({ rows, empty }: { rows: Tally[]; empty: string }) {
  if (rows.length === 0) return <p className="text-caption">{empty}</p>;
  const maior = Math.max(...rows.map(r => r.count));
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-sm text-fg">{r.label}</span>
          <span className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
            <span
              className="block h-full rounded-full bg-accent/60"
              style={{ width: `${maior > 0 ? (r.count / maior) * 100 : 0}%` }}
            />
          </span>
          <span className="w-24 shrink-0 text-right text-caption text-numeric">
            {r.count} mov · {r.boxes} cx
          </span>
        </div>
      ))}
    </div>
  );
}

export function WmsAnalytics({ bins }: { bins: StorageBin[] }) {
  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 29 * 86_400_000);

  const [from, setFrom] = useState(isoDay(trintaDias));
  const [to, setTo] = useState(isoDay(hoje));
  const [binCode, setBinCode] = useState('');
  const [skuTerm, setSkuTerm] = useState('');
  const [movType, setMovType] = useState('');
  const [operatorId, setOperatorId] = useState('');

  const [placements, setPlacements] = useState<StockPlacement[]>([]);
  const [movements, setMovements] = useState<AnalyticsMovement[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fromISO = `${from}T00:00:00.000Z`;
  const toISO = `${to}T23:59:59.999Z`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const alvo = bins.find(b => b.code === binCode.trim().toUpperCase());
      // Termo de SKU vira lista de produtos antes da consulta de movimentos: o filtro
      // roda no banco, não em memória depois de trazer tudo.
      const productIds = skuTerm.trim().length >= 2
        ? (await searchProducts(skuTerm)).map(p => p.id)
        : undefined;

      const [saldo, hist] = await Promise.all([
        listPulmaoStock(),
        listMovementsForAnalytics({
          fromISO,
          toISO,
          binId: alvo?.id,
          productIds,
          operatorId: operatorId || undefined,
          movementType: (movType || undefined) as 'entrada' | 'saida' | 'transferencia' | undefined,
        }),
      ]);

      setPlacements(saldo.placements);
      setMovements(hist.movements);
      setTruncated(hist.truncated);
    } catch (err) {
      console.error('[wms] falha ao carregar os indicadores:', err);
      setError('Não foi possível carregar os indicadores.');
    } finally {
      setLoading(false);
    }
  }, [bins, binCode, skuTerm, movType, operatorId, fromISO, toISO]);

  useEffect(() => { load(); }, [load]);

  const agora = Date.now();
  const ocupacao = useMemo(() => occupancySummary(bins, placements), [bins, placements]);
  const capacidade = useMemo(() => capacitySummary(bins, placements), [bins, placements]);
  const movs = useMemo(() => movementSummary(movements), [movements]);
  const porOperador = useMemo(() => byOperator(movements), [movements]);
  const porEndereco = useMemo(() => byBin(movements), [movements]);
  const serie = useMemo(() => byDay(movements, fromISO, toISO), [movements, fromISO, toISO]);
  const caixasPorFaixa = useMemo(() => boxesByBucket(placements, agora), [placements, agora]);
  const antigos = useMemo(() => agingRows(placements, agora, 15), [placements, agora]);
  const maiores = useMemo(() => skuFootprint(placements, agora, 10), [placements, agora]);

  /** Operadores do período, para o filtro. Sai do próprio histórico carregado — nenhuma
   *  consulta extra, e só aparece quem realmente movimentou. */
  const operadores = useMemo(() => {
    const m = new Map<string, string>();
    for (const mv of movements) if (mv.createdBy) m.set(mv.createdBy, mv.operatorName ?? '—');
    return [...m.entries()];
  }, [movements]);

  const baixar = (conteudo: string, nome: string) =>
    downloadCsvText(conteudo, `pulmao-${nome}-${isoDay(new Date())}.csv`);

  const totalCaixas = placements.reduce((acc, p) => acc + p.boxes, 0);
  const maxDia = Math.max(1, ...serie.map(d => d.count));

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}

      {/* ── Ocupação ─────────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Ocupação dos endereços</h3>
          <p className="text-caption mt-1">
            Quantas vagas têm mercadoria. Não é o mesmo que ocupação de capacidade.
          </p>
        </PanelSection>
        <StatRow>
          <StatCell><Stat label="Endereços" value={ocupacao.total} /></StatCell>
          <StatCell><Stat label="Ocupados" value={ocupacao.occupied} context={pct(ocupacao.occupiedRatio)} /></StatCell>
          <StatCell><Stat label="Livres" value={ocupacao.free} /></StatCell>
          <StatCell><Stat label="Bloqueados" value={ocupacao.blocked} context="não recebem" /></StatCell>
        </StatRow>
      </Panel>

      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Ocupação da capacidade</h3>
          {capacidade ? (
            <p className="text-caption mt-1">
              Sobre as {capacidade.declaredBins} vaga(s) que declararam capacidade. As demais
              não entram na conta — não têm denominador.
            </p>
          ) : (
            <div className="mt-3">
              {/* Mostrar 0% ou 100% aqui seriam duas leituras erradas do mesmo vazio. */}
              <Notice tone="neutral">
                Nenhum endereço tem capacidade declarada, então não há base para calcular
                percentual de ocupação por volume. Defina a capacidade das vagas no Mapa
                para habilitar estes indicadores. Hoje há <strong>{totalCaixas} caixa(s)</strong> guardadas
                no pulmão.
              </Notice>
            </div>
          )}
        </PanelSection>
        {capacidade && (
          <StatRow>
            <StatCell><Stat label="Capacidade total" value={`${capacidade.totalBoxes} cx`} /></StatCell>
            <StatCell><Stat label="Utilizada" value={`${capacidade.usedBoxes} cx`} context={pct(capacidade.usedRatio)} /></StatCell>
            <StatCell><Stat label="Disponível" value={`${capacidade.freeBoxes} cx`} /></StatCell>
          </StatRow>
        )}
      </Panel>

      {/* ── Filtros, que valem para movimentação e auditoria ─────────────────────── */}
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Período e filtros</h3>
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-6 gap-3">
            <label className="block">
              <span className="text-caption">De</span>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-caption">Até</span>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-caption">Endereço</span>
              <Input value={binCode} onChange={e => setBinCode(e.target.value)} placeholder="PP-A01-N1" list="wms-bin-codes" />
            </label>
            <label className="block">
              <span className="text-caption">SKU ou produto</span>
              <Input value={skuTerm} onChange={e => setSkuTerm(e.target.value)} placeholder="SKU..." />
            </label>
            <label className="block">
              <span className="text-caption">Tipo</span>
              <Select value={movType} onChange={e => setMovType(e.target.value)} className="w-full">
                <option value="">Todos</option>
                <option value="entrada">Entrada</option>
                <option value="saida">Retirada</option>
                <option value="transferencia">Transferência</option>
              </Select>
            </label>
            <label className="block">
              <span className="text-caption">Operador</span>
              <Select value={operatorId} onChange={e => setOperatorId(e.target.value)} className="w-full">
                <option value="">Todos</option>
                {operadores.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
              </Select>
            </label>
          </div>
          {truncated && (
            <div className="mt-3">
              <Notice tone="warning">
                O período tem mais movimentos do que cabe numa consulta. Os números abaixo
                cobrem apenas os mais recentes — estreite o período ou use os filtros.
              </Notice>
            </div>
          )}
        </PanelSection>
      </Panel>

      {/* ── Movimentação ─────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Movimentação no período</h3>
          <p className="text-caption mt-1">
            Documentos e caixas são medidas diferentes: um movimento pode levar uma caixa ou quarenta.
          </p>
        </PanelSection>
        <StatRow>
          <StatCell><Stat label="Entradas" value={movs.entradas} context={`${movs.boxesIn} cx`} /></StatCell>
          <StatCell><Stat label="Retiradas" value={movs.saidas} context={`${movs.boxesOut} cx`} /></StatCell>
          <StatCell><Stat label="Transferências" value={movs.transferencias} context={`${movs.boxesMoved} cx`} /></StatCell>
          <StatCell><Stat label="Total" value={movs.total} /></StatCell>
        </StatRow>

        {/* Série só agrega quando há mais de um dia com movimento. */}
        {movs.total > 0 && serie.length > 1 && (
          <PanelSection padding="sm">
            <span className="text-caption">Movimentos por dia</span>
            <div className="mt-2 flex items-end gap-0.5 h-20">
              {serie.map(d => (
                <span
                  key={d.day}
                  title={`${new Date(d.day + 'T12:00:00Z').toLocaleDateString('pt-BR')}: ${d.count}`}
                  className="flex-1 bg-accent/50 rounded-t-sm min-h-[2px]"
                  style={{ height: `${(d.count / maxDia) * 100}%` }}
                />
              ))}
            </div>
          </PanelSection>
        )}

        <PanelSection padding="sm">
          <span className="text-caption">Endereços com mais movimento</span>
          <div className="mt-2">
            <RankBars rows={porEndereco} empty="Nenhum movimento no período." />
          </div>
        </PanelSection>

        <PanelSection padding="sm">
          <span className="text-caption">Movimentações por operador</span>
          <div className="mt-2">
            <RankBars rows={porOperador} empty="Nenhum movimento no período." />
          </div>
        </PanelSection>
      </Panel>

      {/* ── Permanência ──────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Permanência</h3>
          <p className="text-caption mt-1">
            Caixas por faixa de dias. A data é a da entrada que ainda está representada no
            saldo — depois de retirada parcial de lotes de datas diferentes, é um teto.
          </p>
          <div className="mt-3 space-y-1.5">
            {AGE_BUCKETS.map(f => {
              const total = Object.values(caixasPorFaixa).reduce((a, b) => a + b, 0);
              const v = caixasPorFaixa[f.id];
              return (
                <div key={f.id} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-sm text-fg">{f.label}</span>
                  <span className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                    <span
                      className={`block h-full rounded-full ${f.id === '30+' ? 'bg-amber-500/60' : 'bg-accent/60'}`}
                      style={{ width: `${total > 0 ? (v / total) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-caption text-numeric">{v} cx</span>
                </div>
              );
            })}
          </div>
        </PanelSection>

        {maiores.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>SKU</Th><Th>Produto</Th>
                  <Th className="text-center">Caixas</Th>
                  <Th className="text-center">Endereços</Th>
                  <Th className="text-center">Parado há</Th>
                </Tr>
              </Thead>
              <tbody>
                {maiores.map(s => (
                  <Tr key={s.productId}>
                    <Td className="text-numeric">{s.sku}</Td>
                    <Td>{s.productName}</Td>
                    <Td className="text-center text-numeric">{s.boxes}</Td>
                    <Td className="text-center text-numeric">{s.bins}</Td>
                    <Td className="text-center text-caption">{s.oldestDays}d</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {antigos.length > 0 && (
          <PanelSection padding="sm">
            <span className="text-caption">Posições guardadas há mais tempo</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {antigos.slice(0, 10).map(r => (
                <Badge key={`${r.binCode}-${r.sku}`} variant={r.bucket === '30+' ? 'warning' : 'neutral'}>
                  {r.binCode} · {r.sku} · {r.days}d
                </Badge>
              ))}
            </div>
          </PanelSection>
        )}
      </Panel>

      {/* ── Auditoria ────────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-title">Auditoria do histórico</h3>
            <p className="text-caption mt-1">
              Este histórico não se edita nem se apaga — o banco só permite leitura. Correção
              se faz com um movimento novo, que fica registrado como tal.
            </p>
          </div>
          <Button variant="secondary" onClick={() => baixar(csvMovements(movements), 'movimentos')} disabled={movements.length === 0}>
            <Download size={16} />
            Exportar
          </Button>
        </PanelSection>

        {loading ? (
          <PanelSection padding="sm"><p className="text-caption">Carregando...</p></PanelSection>
        ) : movements.length === 0 ? (
          <PanelSection padding="sm"><p className="text-caption">Nenhum movimento com esses filtros.</p></PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Quando</Th><Th>Tipo</Th><Th>SKU</Th>
                  <Th>Origem</Th><Th>Destino</Th>
                  <Th className="text-center">Caixas</Th><Th>Operador</Th>
                </Tr>
              </Thead>
              <tbody>
                {movements.slice(0, 200).map(m => (
                  <Tr key={m.id}>
                    <Td className="text-caption whitespace-nowrap">{dateTime(m.createdAt)}</Td>
                    <Td>{MOVEMENT_LABEL[m.movementType] ?? m.movementType}</Td>
                    <Td className="text-numeric">{m.sku ?? '—'}</Td>
                    <Td className="text-fg">{m.fromCode ?? '—'}</Td>
                    <Td className="text-fg">{m.toCode ?? '—'}</Td>
                    <Td className="text-center text-numeric">{m.boxes}</Td>
                    <Td className="text-caption">{m.operatorName ?? '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      {/* ── Relatórios ───────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Relatórios</h3>
          <p className="text-caption mt-1">
            CSV com ponto e vírgula e acentuação preservada — abre direto no Excel em português.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => baixar(csvOccupancy(bins, placements), 'ocupacao')}>
              <Download size={16} /> Ocupação dos endereços
            </Button>
            <Button variant="secondary" onClick={() => baixar(csvPlacements(placements, agora), 'produtos-por-endereco')} disabled={placements.length === 0}>
              <Download size={16} /> Produtos por endereço
            </Button>
            <Button variant="secondary" onClick={() => baixar(csvSkuFootprint(placements, agora), 'distribuicao-sku')} disabled={placements.length === 0}>
              <Download size={16} /> Distribuição de SKUs
            </Button>
          </div>
        </PanelSection>
      </Panel>
    </>
  );
}

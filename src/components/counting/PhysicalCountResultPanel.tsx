import { useEffect, useState } from 'react';
import { Card, Table, Thead, Tr, Th, Td, Badge, Button } from '../ui';
import { describeLocation } from '../../lib/physicalCount/locationAddressing';
import { computeSessionSummary, computeTotalFound, shouldRecommendRecount } from '../../lib/physicalCount/physicalCountAlgorithm';
import { getRecountEventForSession, getSessionItems } from '../../lib/physicalCount/physicalCountService';
import { formatMeasured, type RecountThresholdType } from '../../lib/physicalCount/recountPolicy';
import type { PhysicalCountItem, RecountEvent } from '../../lib/physicalCount/physicalCountTypes';

interface PhysicalCountResultPanelProps {
  sessionId: string;
  countNumber: 1 | 2 | 3;
  onCreateRecount?: () => void;
  onItemsLoaded?: (items: PhysicalCountItem[]) => void;
}

export function PhysicalCountResultPanel({ sessionId, countNumber, onCreateRecount, onItemsLoaded }: PhysicalCountResultPanelProps) {
  const [items, setItems] = useState<PhysicalCountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [recountEvent, setRecountEvent] = useState<RecountEvent | null>(null);

  useEffect(() => {
    setLoading(true);
    getSessionItems(sessionId)
      .then(rows => {
        setItems(rows);
        onItemsLoaded?.(rows);
      })
      .finally(() => setLoading(false));

    // Independente do carregamento dos itens: se a leitura falhar, o resultado
    // continua aparecendo, só sem a nota da automação.
    getRecountEventForSession(sessionId)
      .then(setRecountEvent)
      .catch(() => setRecountEvent(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (loading) return <p className="text-sm text-fg-muted">Carregando resultado…</p>;

  const summary = computeSessionSummary(
    items.map(i => ({
      erpQuantitySnapshot: i.erpQuantitySnapshot ?? 0,
      physicalQuantity: i.physicalQuantity,
      foundElsewhereQuantity: i.foundElsewhereQuantity,
    }))
  );
  const divergentCount = items.filter(i => i.resultStatus && i.resultStatus !== 'ok').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Contados</p>
          <p className="text-xl font-semibold text-fg tabular-nums">{summary.countedItems}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">OK</p>
          <p className="text-xl font-semibold text-emerald-500 tabular-nums">{summary.okItems}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Divergentes</p>
          <p className="text-xl font-semibold text-amber-500 tabular-nums">{summary.divergentItems}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Precisão</p>
          <p className="text-xl font-semibold text-fg tabular-nums">{summary.accuracyPct}%</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Unidades faltando</p>
          <p className="text-xl font-semibold text-red-500 tabular-nums">{summary.missingUnits}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Unidades excedentes</p>
          <p className="text-xl font-semibold text-blue-500 tabular-nums">+{summary.surplusUnits}</p>
        </Card>
        <Card padding="sm" className="col-span-2 sm:col-span-2">
          <p className="text-xs text-fg-muted">Ajuste líquido</p>
          <p className="text-xl font-semibold text-fg tabular-nums">{summary.netAdjustment}</p>
        </Card>
      </div>

      <Card padding="none" className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Produto</Th>
              <Th>Local</Th>
              <Th>ERP</Th>
              <Th>No local</Th>
              <Th>Excedente</Th>
              <Th>Diferença</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <tbody>
            {items.map(item => {
              const total = computeTotalFound({
                erpQuantitySnapshot: item.erpQuantitySnapshot ?? 0,
                physicalQuantity: item.physicalQuantity,
                foundElsewhereQuantity: item.foundElsewhereQuantity,
              });
              const diff = (total ?? 0) - (item.erpQuantitySnapshot ?? 0);
              return (
                <Tr key={item.id}>
                  <Td>
                    <span className="block text-fg">{item.snapshotProductName ?? '—'}</span>
                    <span className="block text-xs text-fg-subtle">{item.snapshotSku ?? item.sku}</span>
                  </Td>
                  <Td>
                    {describeLocation(item.location)}
                    {item.foundLocation && (
                      <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                        (excedente em {item.foundLocation})
                      </span>
                    )}
                  </Td>
                  <Td className="tabular-nums">{item.erpQuantitySnapshot ?? '—'}</Td>
                  <Td className="tabular-nums">{item.physicalQuantity ?? '—'}</Td>
                  <Td className="tabular-nums">
                    {item.foundElsewhereQuantity > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">{item.foundElsewhereQuantity}</span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="tabular-nums">{item.resultStatus ? (diff > 0 ? `+${diff}` : diff) : '—'}</Td>
                  <Td>
                    {item.resultStatus === 'ok' && <Badge variant="success">OK</Badge>}
                    {item.resultStatus === 'missing' && <Badge variant="danger">Falta</Badge>}
                    {item.resultStatus === 'surplus' && <Badge variant="warning">Excedente</Badge>}
                    {!item.resultStatus && <Badge variant="neutral">Pendente</Badge>}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {/* O que a automação decidiu quando esta contagem foi fechada. Aparece antes
          do botão manual porque, se uma recontagem já foi gerada, criar outra à mão
          é justamente o que não se quer fazer. */}
      {recountEvent && <AutoRecountNotice event={recountEvent} />}

      {shouldRecommendRecount(summary) && countNumber < 3 && onCreateRecount && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-fg">
            {divergentCount} SKU(s) divergente(s) —{' '}
            {recountEvent?.status === 'created'
              ? 'a recontagem automática já foi gerada.'
              : 'recomenda-se reconferência.'}
          </p>
          {/* Escondido quando a automação já criou a rodada: dois cliques aqui
              gerariam duas recontagens da mesma contagem. */}
          {recountEvent?.status !== 'created' && (
            <Button variant="secondary" onClick={onCreateRecount}>
              Criar Recontagem
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** A nota da automação: o que foi medido, contra qual limite, e o que ela fez.
 *
 *  Mostra `measuredValue` e `thresholdValue` como gravados pela avaliação, nunca
 *  recalculados — os dois vêm da mesma linha, então a frase não pode discordar da
 *  decisão que ela descreve. E porque a regra fica congelada no evento, a nota
 *  continua correta mesmo depois de alguém mudar o limite da empresa. */
function AutoRecountNotice({ event }: { event: RecountEvent }) {
  const type = event.thresholdType as RecountThresholdType;
  const measured = formatMeasured(type, event.measuredValue);
  const limit = formatMeasured(type, event.thresholdValue);

  if (event.status === 'created') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
        <p className="text-sm font-medium text-fg">Recontagem gerada automaticamente</p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">
          {measured} de divergência, acima do limite de {limit}. A rodada seguinte foi criada com{' '}
          {event.divergentItems} {event.divergentItems === 1 ? 'item divergente' : 'itens divergentes'} de{' '}
          {event.countedItems} contados.
        </p>
      </div>
    );
  }

  if (event.status === 'failed') {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
        <p className="text-sm font-medium text-fg">A recontagem automática falhou</p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">
          {measured} de divergência passou do limite de {limit}, mas a rodada não pôde ser criada. O
          fechamento desta contagem não foi afetado — a recontagem pode ser criada manualmente
          abaixo.
        </p>
        {event.reason && <p className="mt-1 text-xs text-fg-subtle">{event.reason}</p>}
      </div>
    );
  }

  // skipped. Nota discreta e sem cor: é informação de que a automação olhou e
  // decidiu não agir, não uma condição que peça atenção.
  return (
    <div className="rounded-lg border border-edge bg-surface-3 px-4 py-3">
      <p className="text-sm leading-relaxed text-fg-muted">
        Recontagem automática avaliada: {measured} de divergência
        {event.reason === 'below_threshold'
          ? `, abaixo do limite de ${limit} — nenhuma rodada foi gerada.`
          : event.reason === 'max_rounds_reached'
            ? `, acima do limite de ${limit}, mas esta faixa já chegou à 3ª contagem.`
            : '.'}
      </p>
    </div>
  );
}

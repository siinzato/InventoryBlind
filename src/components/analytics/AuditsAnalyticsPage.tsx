import { useEffect, useState } from 'react';
import { Page, PageHeader, Panel, PanelSection, Badge, Table, Thead, Tr, Th, Td, SegmentedControl, ListRow } from '../ui';
import type { SegmentedOption } from '../ui';
import { getAuditsAnalyticsData, type AuditsAnalyticsData } from '../../lib/analytics/auditsAnalyticsService';
import { AccuracyTrendChart } from './AnalyticsCharts';

interface AuditsAnalyticsPageProps {
  companyId: string;
}

type Section = 'historico' | 'performance' | 'reincidencia';

const SECTIONS: SegmentedOption<Section>[] = [
  { value: 'historico', label: 'Histórico' },
  { value: 'performance', label: 'Performance' },
  { value: 'reincidencia', label: 'Reincidência' },
];

/** Analytics > Auditorias — histórico e performance das auditorias JÁ realizadas. Diferente
 *  de Operações > Auditoria de Estoque, que executa a auditoria cruzada em si; aqui só se
 *  analisa o que já aconteceu (mesmos dados, camada de leitura separada). */
export function AuditsAnalyticsPage({ companyId }: AuditsAnalyticsPageProps) {
  const [data, setData] = useState<AuditsAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('historico');

  useEffect(() => {
    setLoading(true);
    getAuditsAnalyticsData(companyId).then(d => {
      setData(d);
      setLoading(false);
    });
  }, [companyId]);

  const accuracySeries = (data?.sessions ?? [])
    .filter((s): s is typeof s & { accuracy: number } => s.accuracy !== null)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(s => ({ period: s.createdAt, value: s.accuracy }));

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics"
        title="Auditorias"
        description="Histórico, performance e reincidência das auditorias já realizadas neste workspace — não executa uma nova auditoria (isso fica em Operações → Auditoria de Estoque)."
      />

      <Panel>
        <PanelSection padding="md">
          <SegmentedControl label="Seção" options={SECTIONS} value={section} onChange={setSection} />
        </PanelSection>
      </Panel>

      {loading || !data ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando auditorias...</PanelSection></Panel>
      ) : section === 'historico' ? (
        <Panel>
          <PanelSection padding="sm"><p className="text-section">Sessões de contagem ({data.sessions.length})</p></PanelSection>
          {data.sessions.length === 0 ? (
            <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma sessão de contagem registrada ainda neste workspace.</PanelSection>
          ) : (
            <div className="overflow-x-auto max-h-[32rem]">
              <Table>
                <Thead>
                  <Tr><Th>Data</Th><Th>Tipo</Th><Th>SKUs Contados</Th><Th>Divergências</Th><Th>Acurácia</Th><Th>Operador</Th><Th>Aprovada</Th></Tr>
                </Thead>
                <tbody>
                  {data.sessions.map(s => (
                    <Tr key={s.id}>
                      <Td>{new Date(s.createdAt).toLocaleDateString('pt-BR')}</Td>
                      <Td>{s.countNumber === 1 ? '1ª contagem' : s.countNumber === 2 ? 'Recontagem' : '3ª contagem'}</Td>
                      <Td numeric>{s.skusContados} / {s.totalSku}</Td>
                      <Td numeric className={s.divergenciasReais > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}>{s.divergenciasReais}</Td>
                      <Td numeric>{s.accuracy !== null ? `${s.accuracy.toFixed(1)}%` : '—'}</Td>
                      <Td>{s.operator ?? '—'}</Td>
                      <Td>{s.approved ? <Badge variant="success">Sim</Badge> : <Badge variant="neutral">Não</Badge>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Panel>
      ) : section === 'performance' ? (
        <>
          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-2">Evolução da acurácia</p>
              <AccuracyTrendChart points={accuracySeries} />
            </PanelSection>
          </Panel>
          <Panel>
            <PanelSection padding="sm"><p className="text-section">Auditorias com maior divergência</p></PanelSection>
            {data.worstSessions.length === 0 ? (
              <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma sessão com SKUs contados ainda.</PanelSection>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Thead><Tr><Th>Data</Th><Th>Divergências</Th><Th>SKUs Contados</Th><Th>Taxa</Th></Tr></Thead>
                  <tbody>
                    {data.worstSessions.map(s => (
                      <Tr key={s.id}>
                        <Td>{new Date(s.createdAt).toLocaleDateString('pt-BR')}</Td>
                        <Td numeric>{s.divergenciasReais}</Td>
                        <Td numeric>{s.skusContados}</Td>
                        <Td numeric className="text-amber-600 dark:text-amber-400">{((s.divergenciasReais / s.skusContados) * 100).toFixed(1)}%</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Panel>
          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-2">Localizações mais problemáticas</p>
              {data.problemLocations.length === 0 ? (
                <p className="text-xs text-fg-subtle">Sem divergências classificadas com localização nos últimos 180 dias.</p>
              ) : (
                data.problemLocations.map(l => (
                  <ListRow key={l.location} value={l.count}>
                    <p className="truncate text-sm text-fg font-mono">{l.location}</p>
                  </ListRow>
                ))
              )}
            </PanelSection>
          </Panel>
        </>
      ) : (
        <Panel>
          <PanelSection padding="sm">
            <p className="text-section">SKUs reincidentes</p>
            <p className="text-xs text-fg-subtle mt-1">
              Limiar configurado em Root Cause Analysis: {data.rcaSettings.recurrence_threshold_count}+ divergências em {data.rcaSettings.recurrence_window_days} dias.
            </p>
          </PanelSection>
          {data.recurringSkus.length === 0 ? (
            <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhum SKU atingiu o limiar de reincidência no período.</PanelSection>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <Thead><Tr><Th>SKU</Th><Th>Ocorrências no período</Th></Tr></Thead>
                <tbody>
                  {data.recurringSkus.map(r => (
                    <Tr key={r.sku}>
                      <Td className="font-mono text-xs">{r.sku}</Td>
                      <Td>{r.occurrenceCount} de {r.windowDays} dias (limite: {r.thresholdCount})</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Panel>
      )}
    </Page>
  );
}

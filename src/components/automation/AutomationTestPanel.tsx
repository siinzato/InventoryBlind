import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Badge, Button, Panel, PanelSection, Select } from '../ui';
import { listNodeExecutions, listRecentEvents, runAutomationManually } from '../../lib/automation/automationService';
import { fieldsForTrigger } from '../../lib/automation/registry';
import { readPath } from '../../lib/automation/conditions';
import { EXECUTION_STATUS_LABEL, type Automation, type AutomationEvent, type ExecutionStatus, type NodeExecution } from '../../lib/automation/types';
import { ExecutionTrace } from './flow/ExecutionTrace';

interface Props {
  automations: Automation[];
  canManage: boolean;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  success: 'success',
  partial: 'warning',
  failed: 'danger',
  running: 'neutral',
  cancelled: 'neutral',
};

/** Resumo de um evento real usando só os campos que o gatilho já declara
 *  (registry.ts `fieldsForTrigger`) — nunca um campo inventado, e reaproveita
 *  o mesmo `readPath` que as condições usam para ler o contexto (§7). */
function eventSummaryFields(triggerType: string, payload: Record<string, unknown>): { label: string; value: string }[] {
  return fieldsForTrigger(triggerType)
    .map(field => {
      const value = readPath({ trigger: payload, actions: {} }, field.path);
      if (value == null || value === '') return null;
      return { label: field.label, value: String(value) };
    })
    .filter((v): v is { label: string; value: string } => v != null)
    .slice(0, 6);
}

/** "Testar automação" — reaproveita o dry-run já existente (`runAutomationManually`
 *  com `dryRun:true`, o mesmo usado por "Testar sem aplicar" no editor) e o mesmo
 *  trace de leitura (`ExecutionTrace`). Nenhum executor novo, nenhuma ação real é
 *  aplicada. A novidade é só permitir escolher um evento REAL recente como
 *  contexto, em vez de rodar sempre com contexto vazio (§6/§7/§8). */
export function AutomationTestPanel({ automations, canManage }: Props) {
  const testable = useMemo(() => automations.filter(a => a.workflow.nodes.length > 0), [automations]);
  const [automationId, setAutomationId] = useState(testable[0]?.id ?? '');
  const [events, setEvents] = useState<AutomationEvent[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string; executionId?: string } | null>(null);
  const [resultNodeExecutions, setResultNodeExecutions] = useState<NodeExecution[]>([]);

  const automation = testable.find(a => a.id === automationId) ?? null;

  useEffect(() => {
    if (automation == null) { setEvents([]); setEventId(''); return; }
    setLoadingEvents(true);
    listRecentEvents(automation.triggerType)
      .then(rows => { setEvents(rows); setEventId(rows[0]?.id ?? ''); })
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));
    // Só id/triggerType importam para decidir se busca de novo — `automation` é
    // reconstruído (mesma referência de `testable`, mas o lint não sabe disso).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automation?.id, automation?.triggerType]);

  const selectedEvent = events.find(e => e.id === eventId) ?? null;
  const summaryFields = automation && selectedEvent ? eventSummaryFields(automation.triggerType, selectedEvent.payload) : [];

  async function run() {
    if (automation == null) return;
    setRunning(true);
    setResult(null);
    setResultNodeExecutions([]);
    try {
      const outcome = await runAutomationManually(automation.id, { dryRun: true, context: selectedEvent?.payload ?? {} });
      setResult({ status: outcome.status ?? (outcome.ok ? 'success' : 'failed'), message: outcome.message, executionId: outcome.executionId });
      if (outcome.executionId) {
        const rows = await listNodeExecutions(outcome.executionId).catch(() => []);
        setResultNodeExecutions(rows);
      }
    } finally {
      setRunning(false);
    }
  }

  if (!canManage) return null;

  return (
    <Panel>
      <PanelSection>
        <div className="flex items-center gap-2">
          <FlaskConical size={15} className="text-fg-subtle" />
          <h3 className="text-section">Teste de automação</h3>
          <Badge variant="accent">Novo</Badge>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">
          Simula esta automação com um evento real, sem aplicar nenhuma ação — mesmo mecanismo de
          "Testar sem aplicar" do editor.
        </p>
      </PanelSection>

      {testable.length === 0 ? (
        <PanelSection className="text-sm text-fg-muted">Nenhuma automação com blocos configurados para testar.</PanelSection>
      ) : (
        <>
          <PanelSection className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-overline">Automação</span>
              <Select className="mt-2 w-full" value={automationId} onChange={e => setAutomationId(e.target.value)}>
                {testable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </label>
            <label className="block">
              <span className="text-overline">Evento selecionado</span>
              <Select className="mt-2 w-full" value={eventId} onChange={e => setEventId(e.target.value)} disabled={loadingEvents || events.length === 0}>
                {events.length === 0 ? (
                  <option value="">{loadingEvents ? 'Carregando eventos…' : 'Sem eventos recentes — roda com contexto vazio'}</option>
                ) : (
                  events.map(ev => (
                    <option key={ev.id} value={ev.id}>{new Date(ev.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</option>
                  ))
                )}
              </Select>
            </label>

            {summaryFields.length > 0 && (
              <div className="sm:col-span-2 flex flex-wrap gap-x-4 gap-y-1 rounded-container border border-edge bg-surface-3 px-3 py-2 text-xs text-fg-muted">
                {summaryFields.map(f => (
                  <span key={f.label}><span className="text-fg-subtle">{f.label}:</span> {f.value}</span>
                ))}
              </div>
            )}
          </PanelSection>

          <PanelSection className="flex items-center gap-3">
            <Button size="sm" disabled={running || automation == null} onClick={() => void run()}>
              {running ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
              Executar teste
            </Button>
            {result && (
              <span className="flex items-center gap-2 text-sm">
                <Badge variant={STATUS_VARIANT[result.status] ?? 'neutral'}>
                  {isKnownStatus(result.status) ? EXECUTION_STATUS_LABEL[result.status] : result.status}
                </Badge>
                <span className="text-fg-muted">{result.message}</span>
              </span>
            )}
          </PanelSection>

          {result?.executionId && automation && (
            <PanelSection>
              <p className="text-label mb-2">Resultado da simulação</p>
              <ExecutionTrace
                workflow={automation.workflow}
                triggerType={automation.triggerType}
                nodeExecutions={resultNodeExecutions}
                selectedNodeId={null}
                onSelectNode={() => {}}
                height={280}
              />
            </PanelSection>
          )}
        </>
      )}
    </Panel>
  );
}

function isKnownStatus(status: string): status is ExecutionStatus {
  return status in EXECUTION_STATUS_LABEL;
}

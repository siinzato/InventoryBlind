import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Info, Loader2 } from 'lucide-react';
import { Badge, Button, Card, Input, Select, Table, Td, Th, Thead, Tr } from '../ui';
import {
  acknowledgeRecountEvent,
  getRecountSettings,
  listPendingRecountEvents,
  saveRecountSettings,
} from '../../lib/physicalCount/physicalCountService';
import {
  DEFAULT_RECOUNT_SETTINGS,
  THRESHOLD_HELP,
  THRESHOLD_LABEL,
  formatMeasured,
  isPercentThreshold,
  type RecountSettings,
  type RecountThresholdType,
} from '../../lib/physicalCount/recountPolicy';
import type { RecountEvent } from '../../lib/physicalCount/physicalCountTypes';

interface Props {
  /** Gravar a configuração: owner/admin/manager. A policy da 049 recusa os outros
   *  de qualquer forma; isto evita oferecer um controle que voltaria erro. */
  canManage: boolean;
  /** Dar ciência num aviso. A policy é deliberadamente mais permissiva que a de
   *  gravação e inclui lead — reconhecer um aviso não muda configuração nenhuma. */
  canAcknowledge: boolean;
}

const THRESHOLD_TYPES: RecountThresholdType[] = [
  'divergent_item_percent',
  'unit_deviation_percent',
  'absolute_unit_deviation',
];

/** Configuração e histórico da recontagem automática.
 *
 *  Aba própria dentro do Centro de Gestão da Contagem: quem não usa a função não
 *  encontra nada diferente nas outras abas, e `enabled` nasce false, então ligar é
 *  um ato explícito. */
export function AutoRecountSettingsTab({ canManage, canAcknowledge }: Props) {
  const [settings, setSettings] = useState<RecountSettings>(DEFAULT_RECOUNT_SETTINGS);
  const [events, setEvents] = useState<RecountEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedSettings, loadedEvents] = await Promise.all([
        getRecountSettings(),
        listPendingRecountEvents(),
      ]);
      setSettings(loadedSettings);
      setEvents(loadedEvents);
      setFeedback(null);
    } catch (thrown) {
      setFeedback({
        tone: 'error',
        text: thrown instanceof Error ? thrown.message : 'Não foi possível carregar a configuração.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: RecountSettings) {
    setSaving(true);
    setFeedback(null);
    try {
      await saveRecountSettings(next);
      setSettings(next);
      setFeedback({ tone: 'ok', text: 'Configuração salva.' });
    } catch (thrown) {
      setFeedback({
        tone: 'error',
        text: thrown instanceof Error ? thrown.message : 'Não foi possível salvar.',
      });
      // Recarrega para a tela não ficar mostrando um valor que não foi gravado.
      await load();
    } finally {
      setSaving(false);
    }
  }

  const percent = isPercentThreshold(settings.thresholdType);

  if (loading) {
    return (
      <Card>
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 size={15} className="animate-spin" />
          Carregando configuração…
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.tone === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-title">Recontagem automática</h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">
              Quando uma contagem é fechada com divergência acima do limite, o sistema cria sozinho
              a rodada seguinte, já com apenas os itens divergentes, e avisa o responsável. A
              avaliação roda no servidor no momento do fechamento — não depende desta tela estar
              aberta.
            </p>
          </div>
          <Badge variant={settings.enabled ? 'success' : 'neutral'}>
            {settings.enabled ? 'Ativa' : 'Desligada'}
          </Badge>
        </div>

        <div className="mt-6 space-y-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={!canManage || saving}
              onChange={e => void save({ ...settings, enabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-edge text-accent focus:ring-accent/40"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">
                Gerar recontagem automaticamente
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-fg-subtle">
                Desligado, o fluxo continua como hoje: a recomendação de recontagem aparece no
                resultado e alguém decide criar.
              </span>
            </span>
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Como medir a divergência
              </span>
              <Select
                className="mt-2"
                value={settings.thresholdType}
                disabled={!canManage || saving}
                onChange={e =>
                  void save({ ...settings, thresholdType: e.target.value as RecountThresholdType })
                }
              >
                {THRESHOLD_TYPES.map(type => (
                  <option key={type} value={type}>
                    {THRESHOLD_LABEL[type]}
                  </option>
                ))}
              </Select>
              {/* A ajuda é o que impede escolher o modo errado: os três dão números
                  bem diferentes sobre a mesma contagem. */}
              <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">
                {THRESHOLD_HELP[settings.thresholdType]}
              </p>

              {/* O aviso amarelo que existia aqui descrevia um ponto cego deste modo
                  (saldo zero no ERP media 0% e nunca disparava). A migration 050
                  corrigiu o cálculo, então o aviso saiu — deixá-lo seria alertar
                  sobre um defeito que não existe mais. O comportamento novo está
                  descrito no texto de ajuda acima. */}
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Limite {percent ? '(%)' : '(unidades)'}
              </span>
              <Input
                className="mt-2"
                type="number"
                min={percent ? 0.1 : 1}
                max={percent ? 100 : undefined}
                step={percent ? 0.1 : 1}
                defaultValue={settings.thresholdValue}
                disabled={!canManage || saving}
                onBlur={e => {
                  const value = Number(e.target.value);
                  // Validação espelhando o CHECK do banco (> 0). Sem isto, um campo
                  // vazio viraria 0 e a gravação voltaria erro de constraint.
                  if (!Number.isFinite(value) || value <= 0) {
                    e.target.value = String(settings.thresholdValue);
                    return;
                  }
                  if (value === settings.thresholdValue) return;
                  void save({ ...settings, thresholdValue: value });
                }}
              />
              <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">
                A recontagem é gerada quando a divergência atinge ou passa deste valor.
              </p>
            </label>
          </div>

          {!canManage && (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-fg-subtle">
              <Info size={13} className="mt-0.5 flex-shrink-0" />
              Somente owner, admin ou manager podem alterar esta configuração.
            </p>
          )}
        </div>
      </Card>

      <RecountEventsCard events={events} onChanged={load} canAcknowledge={canAcknowledge} />
    </div>
  );
}

// ── Avisos ──────────────────────────────────────────────────────────────────

const SKIP_REASON_TEXT: Record<string, string> = {
  below_threshold: 'Abaixo do limite',
  max_rounds_reached: 'Limite de 3 rodadas atingido',
  no_divergent_items: 'Sem item divergente',
};

function RecountEventsCard({
  events,
  onChanged,
  canAcknowledge,
}: {
  events: RecountEvent[];
  onChanged: () => void;
  canAcknowledge: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const created = useMemo(() => events.filter(e => e.status === 'created'), [events]);
  const failed = useMemo(() => events.filter(e => e.status === 'failed'), [events]);

  return (
    <Card padding="none">
      <div className="px-6 py-5">
        <h3 className="text-title">Avisos de recontagem</h3>
        <p className="mt-1 text-sm text-fg-muted">
          {events.length === 0
            ? 'Nenhum aviso pendente.'
            : `${created.length} recontagem(ns) gerada(s)${failed.length > 0 ? ` e ${failed.length} falha(s)` : ''} aguardando ciência.`}
        </p>
      </div>

      {events.length > 0 && (
        <div className="overflow-x-auto border-t border-edge">
          <Table>
            <Thead>
              <Tr>
                <Th>Quando</Th>
                <Th>Resultado</Th>
                <Th>Divergência medida</Th>
                <Th>Itens</Th>
                <Th />
              </Tr>
            </Thead>
            <tbody>
              {events.map(event => (
                <Tr key={event.id}>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {new Date(event.createdAt).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </Td>
                  <Td>
                    {event.status === 'created' && <Badge variant="success">Recontagem criada</Badge>}
                    {event.status === 'failed' && <Badge variant="danger">Falhou</Badge>}
                    {event.status === 'skipped' && (
                      <Badge variant="neutral">
                        {SKIP_REASON_TEXT[event.reason ?? ''] ?? 'Ignorado'}
                      </Badge>
                    )}
                    {event.status === 'failed' && event.reason && (
                      <p className="mt-1 max-w-xs text-xs leading-relaxed text-fg-subtle">
                        {event.reason}
                      </p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {/* O valor que o SQL calculou, não um recálculo — evita dois
                        números para o mesmo fato. */}
                    {formatMeasured(event.thresholdType as RecountThresholdType, event.measuredValue)}
                    <span className="ml-1 text-xs text-fg-subtle">
                      (limite{' '}
                      {formatMeasured(
                        event.thresholdType as RecountThresholdType,
                        event.thresholdValue
                      )}
                      )
                    </span>
                  </Td>
                  <Td className="tabular-nums text-fg-muted">
                    {event.divergentItems} de {event.countedItems}
                  </Td>
                  <Td>
                    {canAcknowledge && (
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          setBusy(event.id);
                          try {
                            await acknowledgeRecountEvent(event.id);
                          } finally {
                            setBusy(null);
                            onChanged();
                          }
                        }}
                        disabled={busy != null}
                      >
                        {busy === event.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Check size={13} />
                        )}
                        Ciente
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {failed.length > 0 && (
        <div className="flex items-start gap-2 border-t border-edge bg-red-500/5 px-6 py-4">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-red-500" />
          <p className="text-sm leading-relaxed text-red-600 dark:text-red-400">
            {failed.length === 1 ? 'Uma recontagem' : `${failed.length} recontagens`} deveria(m) ter
            sido criada(s) e falhou(aram). A contagem original foi fechada normalmente — só a rodada
            seguinte não foi gerada, e pode ser criada manualmente pelo resultado da contagem.
          </p>
        </div>
      )}
    </Card>
  );
}

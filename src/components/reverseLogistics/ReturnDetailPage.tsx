import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Camera, RefreshCw, XCircle, Check, X, Package } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Button, Input, Select, Textarea } from '../ui';
import { RecordAdminMenu } from '../admin/RecordAdminMenu';
import { AdminReasonModal, AdminRecordSummary } from '../admin/AdminReasonModal';
import { useAuth } from '../../lib/auth';
import {
  hasPermission, canApproveReturnDestination, canApproveReturnRequest,
  canManageServiceOrders, canReleaseQuarantine, canSyncIntegrations,
} from '../../lib/permissionService';
import { runStockWrite } from '../../lib/integrations/integrationOperations';
import {
  getReturn, getReturnItems, listAuditEventsForReturn, updateReturnItemConference,
  transitionReturnStatus, setItemInspection, decideItemDestination,
  listReturnAttachments, uploadReturnAttachments, getReturnAttachmentSignedUrl, fetchReturnUserNames,
  fetchProductPrices, getReturnErpContext, getErpSyncStatus,
  listConditionGrades, listDestinationRules, getApprovalSettings, recordSuggestedDestination,
  listApprovalRequestsForItem, requestItemApproval, decideItemApproval,
  listServiceOrdersForItem, createServiceOrder, transitionServiceOrderStatus,
  listQuarantineHoldsForItem, createQuarantineHold, releaseQuarantineHold,
  type InspectionChecklistInput, type ReturnErpContext, type ErpSyncStatus,
} from '../../lib/reverseLogistics/reverseLogisticsService';
import {
  allowedNextStatuses, canFinalizeReturn, isDestinationReasonRequired, computeQuantityDivergence,
  suggestDestination, requiredApprovalTypes, hasChecklistException,
} from '../../lib/reverseLogistics/reverseLogisticsRules';
import {
  RETURN_STATUS_LABEL, RETURN_CLASSIFICATION_LABEL, RETURN_DESTINATION_LABEL,
  APPROVAL_TYPE_LABEL, SERVICE_ORDER_STATUS_LABEL,
  type ReturnRecord, type ReturnItem, type ReturnStatus, type ReturnClassification, type ReturnDestination,
  type ReturnAttachment, type ReturnAuditEvent, type ConditionGrade,
  type ApprovalSettings, type ApprovalRequest, type ServiceOrder, type ServiceOrderType,
  type ServiceOrderStatus, type QuarantineHold,
} from '../../lib/reverseLogistics/reverseLogisticsTypes';

interface ReturnDetailPageProps {
  companyId: string;
  returnId: string;
  onBack: () => void;
}

const NEXT_STATUS_LABEL: Partial<Record<ReturnStatus, string>> = {
  in_conference: 'Avançar para Conferência',
  in_inspection: 'Avançar para Inspeção',
  awaiting_destination: 'Avançar para Destinação',
  finalized: 'Finalizar Devolução',
};

const CHECKLIST_FIELDS: { key: keyof InspectionChecklistInput; label: string }[] = [
  { key: 'correctProduct', label: 'Produto correto' },
  { key: 'packagingIntact', label: 'Embalagem íntegra' },
  { key: 'noVisibleDamage', label: 'Produto sem avaria visível' },
  { key: 'apparentlyFunctional', label: 'Produto aparentemente funcional' },
  { key: 'accessoriesComplete', label: 'Acessórios completos' },
  { key: 'signsOfUse', label: 'Sinais de uso' },
  { key: 'serialMatches', label: 'Número de série correspondente' },
];

/** Texto + ponto — nunca badge colorido para um status comum. Vermelho é
 *  reservado para cancelamento (o único estado real de bloqueio/falha aqui). */
function ReturnStatusText({ status }: { status: ReturnStatus }) {
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-600 dark:bg-red-400" />
        {RETURN_STATUS_LABEL[status]}
      </span>
    );
  }
  const active = status === 'in_conference' || status === 'in_inspection' || status === 'awaiting_destination';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${active ? 'font-medium text-accent' : 'text-fg-muted'}`}>
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-fg-subtle'}`} />
      {RETURN_STATUS_LABEL[status]}
    </span>
  );
}

/** Evita mostrar `00:00:00` quando o horário não carrega informação real —
 *  mostra só a data nesse caso; caso contrário, data e hora completas. */
function formatReceivedAt(iso: string): string {
  const date = new Date(iso);
  const isMidnight = date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  return isMidnight ? date.toLocaleDateString('pt-BR') : date.toLocaleString('pt-BR');
}

// ── Timeline operacional — 4 estágios visuais mapeados a partir do status real,
//    sem criar nenhum estado novo (received e in_conference compartilham "Recebida"). ──
const TIMELINE_STAGES = ['Recebida', 'Em inspeção', 'Destinação', 'Concluída'] as const;

function timelineStageIndex(status: ReturnStatus): number {
  switch (status) {
    case 'received':
    case 'in_conference': return 0;
    case 'in_inspection': return 1;
    case 'awaiting_destination': return 2;
    case 'finalized': return 3;
    default: return 0;
  }
}

function ReturnTimeline({ status }: { status: ReturnStatus }) {
  const current = timelineStageIndex(status);
  return (
    <div className="flex items-center">
      {TIMELINE_STAGES.map((label, i) => (
        <div key={label} className={`flex items-center ${i < TIMELINE_STAGES.length - 1 ? 'flex-1' : ''}`}>
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className={`flex h-4 w-4 items-center justify-center rounded-full ${
              i < current ? 'bg-fg-subtle' : i === current ? 'bg-accent' : 'border border-edge bg-surface'
            }`}>
              {i < current && <Check size={10} className="text-surface" strokeWidth={3} />}
            </div>
            <span className={`text-xs whitespace-nowrap ${i === current ? 'font-medium text-fg' : 'text-fg-subtle'}`}>{label}</span>
          </div>
          {i < TIMELINE_STAGES.length - 1 && (
            <div className={`h-px flex-1 mx-2 ${i < current ? 'bg-fg-subtle' : 'bg-edge'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function itemSituationLabel(item: ReturnItem): string {
  if (item.destinationStatus === 'moved') return 'Concluído';
  if (item.destinationStatus === 'in_treatment') return 'Em tratamento';
  if (item.destination) return 'Aguardando decisão';
  if (item.classification) return 'Aguardando destinação';
  return 'Aguardando inspeção';
}

function nextActionMessage(record: ReturnRecord, items: ReturnItem[], canFinalize: boolean): string {
  if (record.status === 'cancelled') return 'Devolução cancelada.';
  if (record.status === 'finalized') return 'Devolução concluída.';
  const openQuarantine = items.filter(i => i.destination === 'quarantine' && i.destinationStatus !== 'moved').length;
  if (record.status === 'awaiting_destination') {
    const pending = items.filter(i => i.destinationStatus === 'pending' && !i.destination).length;
    if (pending > 0) return `Defina a destinação de ${pending} ${pending === 1 ? 'item' : 'itens'}.`;
    if (openQuarantine > 0) return 'Resolva o(s) bloqueio(s) de quarentena.';
    if (canFinalize) return 'Todos os itens estão prontos para conclusão.';
  }
  if (record.status === 'received' || record.status === 'in_conference') return 'Confira os itens recebidos.';
  if (record.status === 'in_inspection') return 'Inspecione os itens recebidos.';
  return 'Acompanhe o andamento da devolução.';
}

const AUDIT_ACTION_LABEL: Record<string, string> = {
  'reverse_logistics.received': 'Devolução recebida',
  'reverse_logistics.item_registered': 'Item registrado',
  'reverse_logistics.status_changed': 'Status alterado',
  'reverse_logistics.item_inspected': 'Item inspecionado',
  'reverse_logistics.destination_decided': 'Destinação decidida',
  'reverse_logistics.cancelled': 'Devolução cancelada',
  'reverse_logistics.approval_requested': 'Aprovação solicitada',
  'reverse_logistics.approval_approved': 'Aprovação concedida',
  'reverse_logistics.approval_rejected': 'Aprovação rejeitada',
  'reverse_logistics.service_order_created': 'Ordem de serviço aberta',
  'reverse_logistics.service_order_status_changed': 'Ordem de serviço atualizada',
  'reverse_logistics.quarantine_hold_created': 'Bloqueio de quarentena registrado',
  'reverse_logistics.quarantine_released': 'Quarentena liberada',
  'reverse_logistics.batch_action_applied': 'Ação em lote aplicada',
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

function eventNote(metadata: Record<string, unknown>): string {
  const raw = metadata?.['reason'] ?? metadata?.['note'] ?? metadata?.['notes'];
  return typeof raw === 'string' && raw.trim() ? raw : 'Não informada';
}

export function ReturnDetailPage({ companyId, returnId, onBack }: ReturnDetailPageProps) {
  const { profile } = useAuth();
  const [record, setRecord] = useState<ReturnRecord | null>(null);
  const [items, setItems] = useState<ReturnItem[]>([]);
  const [attachments, setAttachments] = useState<ReturnAttachment[]>([]);
  const [history, setHistory] = useState<ReturnAuditEvent[]>([]);
  const [userNames, setUserNames] = useState<Map<string, { name: string | null; email: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [conditionGrades, setConditionGrades] = useState<ConditionGrade[]>([]);
  const [approvalSettings, setApprovalSettings] = useState<ApprovalSettings | null>(null);
  const [productPrices, setProductPrices] = useState<Map<string, number>>(new Map());
  const [inspectingItemId, setInspectingItemId] = useState<string | null>(null);
  const [showFullHistory, setShowFullHistory] = useState(false);

  const canWrite = hasPermission(profile?.role, 'inventory.write');
  const canApprove = canApproveReturnDestination(profile?.role);
  const canDecideApproval = canApproveReturnRequest(profile?.role);
  const canManageService = canManageServiceOrders(profile?.role);
  const canRelease = canReleaseQuarantine(profile?.role);
  const canSyncErp = canSyncIntegrations(profile?.role);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rec, itemsData, historyData, attachmentsData, gradesData, rulesData, settingsData] = await Promise.all([
        getReturn(returnId), getReturnItems(returnId), listAuditEventsForReturn(companyId, returnId), listReturnAttachments(returnId),
        listConditionGrades(companyId), listDestinationRules(companyId), getApprovalSettings(companyId),
      ]);
      setConditionGrades(gradesData);
      setApprovalSettings(settingsData);

      // Sugestão de destinação: calculada no cliente, gravada como rastro (não decisão) só para
      // itens ainda aguardando decisão e sem sugestão registrada ainda.
      if (rec?.status === 'awaiting_destination') {
        for (const item of itemsData) {
          if (item.destination || item.suggestedDestinationRuleId) continue;
          const suggestion = suggestDestination({ conditionGradeId: item.conditionGradeId, reason: rec.reason }, null, rulesData);
          if (suggestion) {
            try { await recordSuggestedDestination(item.id, suggestion.destination, suggestion.ruleId); } catch { /* não bloqueia a tela */ }
            item.suggestedDestination = suggestion.destination;
            item.suggestedDestinationRuleId = suggestion.ruleId;
          }
        }
      }

      setRecord(rec);
      setItems(itemsData);
      setHistory(historyData);
      setAttachments(attachmentsData);
      const ids = [rec?.receivedBy ?? null, ...itemsData.flatMap(i => [i.inspectedBy, i.destinationDecidedBy])];
      setUserNames(await fetchReturnUserNames(ids));
      setProductPrices(await fetchProductPrices(itemsData.map(i => i.productId)));
    } catch (err) {
      console.error('Error loading return:', err);
      setLoadError('Não foi possível carregar esta devolução. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnId]);

  const handleAdvance = async (toStatus: ReturnStatus) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await transitionReturnStatus(returnId, toStatus, null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível avançar o status.');
    } finally {
      setBusy(false);
    }
  };

  const userLabel = (id: string | null) => (id ? (userNames.get(id)?.name ?? userNames.get(id)?.email ?? '—') : '—');

  if (loading) {
    return (
      <Page>
        <PageHeader title="Devolução" actions={<Button variant="ghost" onClick={onBack}><ArrowLeft size={16} /> Voltar</Button>} />
        <Panel><PanelSection padding="lg" className="flex items-center justify-center text-fg-subtle text-sm gap-2"><RefreshCw size={14} className="animate-spin" /> Carregando...</PanelSection></Panel>
      </Page>
    );
  }

  if (loadError || !record) {
    return (
      <Page>
        <PageHeader title="Devolução" actions={<Button variant="ghost" onClick={onBack}><ArrowLeft size={16} /> Voltar</Button>} />
        <Panel><PanelSection padding="lg" className="text-center text-sm text-red-600 dark:text-red-400">{loadError ?? 'Devolução não encontrada.'}</PanelSection></Panel>
      </Page>
    );
  }

  const nextStatuses = allowedNextStatuses(record.status).filter(s => s !== 'cancelled');
  const forwardStatus = nextStatuses[0];
  const canCancel = !['finalized', 'cancelled'].includes(record.status) && canApprove;
  const canFinalize = forwardStatus === 'finalized' && canFinalizeReturn(items);

  const infoItems: { label: string; value: string }[] = [
    { label: 'Origem', value: record.origin ?? '—' },
    { label: 'Referência', value: record.referenceValue ?? '—' },
    { label: 'Motivo declarado', value: record.reason ?? '—' },
    { label: 'Recebida em', value: formatReceivedAt(record.receivedAt) },
    { label: 'Responsável', value: userLabel(record.receivedBy) },
    { label: 'Total de itens', value: String(items.length) },
  ];

  const inspectedCount = items.filter(i => i.inspectedAt).length;
  const destinationDefinedCount = items.filter(i => i.destination).length;
  const pendingCount = items.length - destinationDefinedCount;
  const quarantineOpenCount = items.filter(i => i.destination === 'quarantine' && i.destinationStatus !== 'moved').length;

  const inspectingItem = items.find(i => i.id === inspectingItemId) ?? null;

  return (
    <Page>
      <p className="mb-2 text-xs text-fg-subtle">Logística Reversa <span className="mx-1">/</span> Devoluções</p>
      <PageHeader
        title={`Devolução ${record.code}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={16} /> Voltar</Button>
            {canWrite && forwardStatus && forwardStatus !== 'finalized' && (
              <Button onClick={() => handleAdvance(forwardStatus)} disabled={busy}>{NEXT_STATUS_LABEL[forwardStatus]}</Button>
            )}
            {canWrite && forwardStatus === 'finalized' && (
              <Button onClick={() => handleAdvance('finalized')} disabled={busy || !canFinalize} title={!canFinalize ? 'Todos os itens precisam ter a destinação processada.' : undefined}>
                {NEXT_STATUS_LABEL.finalized}
              </Button>
            )}
            {canCancel && (
              <RecordAdminMenu
                label="Mais ações desta devolução"
                actions={[{ key: 'cancel', label: 'Cancelar devolução', tone: 'danger', icon: <XCircle size={15} />, onSelect: () => setShowCancel(true) }]}
              />
            )}
          </div>
        }
      />

      {actionError && (
        <Panel><PanelSection padding="md" className="text-sm text-red-600 dark:text-red-400">{actionError}</PanelSection></Panel>
      )}

      <Panel>
        <PanelSection padding="sm" className="flex flex-wrap items-center gap-3">
          <ReturnStatusText status={record.status} />
          {record.unresolved && <span className="text-xs text-fg-subtle">· Não identificado</span>}
        </PanelSection>
        <PanelSection padding="md">
          <div className="flex flex-wrap">
            {infoItems.map((it, idx) => (
              <div key={it.label} className={`px-4 py-1 first:pl-0 ${idx > 0 ? 'border-l border-edge' : ''}`}>
                <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">{it.label}</p>
                <p className="mt-0.5 text-sm text-fg">{it.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-edge pt-3">
            <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Observações</p>
            <p className="mt-0.5 text-sm text-fg">{record.notes ?? 'Não informada'}</p>
          </div>
          {record.status === 'cancelled' && (
            <div className="mt-3 border-t border-edge pt-3">
              <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Justificativa do cancelamento</p>
              <p className="mt-0.5 text-sm text-fg">{record.cancellationReason ?? 'Não informada'}</p>
            </div>
          )}
        </PanelSection>
      </Panel>

      {record.status !== 'cancelled' && (
        <Panel>
          <PanelSection padding="md">
            <ReturnTimeline status={record.status} />
          </PanelSection>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
        <Panel>
          <PanelSection padding="md"><p className="text-title">Itens ({items.length})</p></PanelSection>
          {items.length === 0 && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhum item registrado.</PanelSection>}
          {items.length > 0 && (
            <div className="overflow-x-auto border-t border-edge">
              <table className="w-full text-sm border-collapse">
                <thead className="border-b border-edge">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-subtle">Produto</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-fg-subtle">Esperado</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-fg-subtle">Recebido</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-subtle">Local atual</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-subtle">Condição</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-subtle">Destinação</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-fg-subtle">Situação</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const divergence = computeQuantityDivergence(item);
                    const hasDivergence = divergence !== null && divergence !== 0;
                    return (
                      <tr key={item.id} className="border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control bg-surface-3 text-fg-subtle">
                              <Package size={16} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-fg line-clamp-2">{item.description}</p>
                              <p className="text-xs text-fg-subtle font-mono">{item.sku ?? '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-fg">{item.expectedQuantity ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-fg">
                          {item.receivedQuantity}
                          {hasDivergence && <span className="ml-1 text-xs text-red-600 dark:text-red-400">({divergence! > 0 ? '+' : ''}{divergence})</span>}
                        </td>
                        <td className="px-4 py-3 text-fg-muted">{item.currentLocation}</td>
                        <td className="px-4 py-3 text-fg-muted">{item.classification ? RETURN_CLASSIFICATION_LABEL[item.classification] : '—'}</td>
                        <td className="px-4 py-3 text-fg-muted">{item.destination ? RETURN_DESTINATION_LABEL[item.destination] : 'Destinação pendente'}</td>
                        <td className="px-4 py-3 text-fg-muted">{itemSituationLabel(item)}</td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="sm" onClick={() => setInspectingItemId(item.id)}>Inspecionar</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelSection padding="md" className="space-y-3">
              <p className="text-sm font-semibold text-fg">Resumo da devolução</p>
              <SummaryRow label="Itens recebidos" value={items.length} />
              <SummaryRow label="Itens inspecionados" value={inspectedCount} />
              <SummaryRow label="Destinação definida" value={destinationDefinedCount} />
              <SummaryRow label="Pendências" value={pendingCount} tone={pendingCount > 0 ? 'critical' : 'default'} />
              <SummaryRow label="Bloqueios de quarentena" value={quarantineOpenCount} tone={quarantineOpenCount > 0 ? 'critical' : 'default'} />
              <div className="border-t border-edge pt-3">
                <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Próxima ação</p>
                <p className="text-sm text-fg">{nextActionMessage(record, items, canFinalize)}</p>
              </div>
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md" className="flex items-center justify-between">
              <p className="text-sm font-semibold text-fg">Atividade recente</p>
            </PanelSection>
            {history.length === 0 && <PanelSection padding="md" className="text-sm text-fg-subtle">Nenhum evento registrado ainda.</PanelSection>}
            {history.length > 0 && (
              <div className="divide-y divide-edge">
                {(showFullHistory ? history : history.slice(0, 4)).map(event => (
                  <div key={event.id} className="px-6 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-fg">{auditActionLabel(event.action)}</p>
                      <p className="text-xs text-fg-subtle flex-shrink-0">{new Date(event.createdAt).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <p className="text-xs text-fg-subtle">{event.userEmail ?? '—'}</p>
                  </div>
                ))}
              </div>
            )}
            {history.length > 4 && (
              <PanelSection padding="sm">
                <button onClick={() => setShowFullHistory(v => !v)} className="text-xs text-accent hover:underline">
                  {showFullHistory ? 'Ver menos' : 'Ver histórico completo'}
                </button>
              </PanelSection>
            )}
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelSection padding="md" className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Camera size={16} className="text-fg-subtle" /><p className="text-title">Anexos</p></div>
          {canWrite && (
            <label className="text-sm text-accent cursor-pointer">
              {uploading ? 'Enviando...' : 'Adicionar foto/anexo'}
              <input
                type="file" accept="image/png,image/jpeg,application/pdf" multiple className="hidden" disabled={uploading}
                onChange={async e => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length === 0) return;
                  setUploading(true);
                  try { await uploadReturnAttachments(returnId, null, companyId, files, profile?.id ?? ''); await load(); }
                  finally { setUploading(false); e.target.value = ''; }
                }}
              />
            </label>
          )}
        </PanelSection>
        {attachments.length === 0 && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhum anexo enviado ainda.</PanelSection>}
        {attachments.map(att => (
          <PanelSection key={att.id} padding="sm" className="flex items-center justify-between text-sm">
            <span className="text-fg">{att.fileName}</span>
            <button
              type="button" className="text-xs text-accent underline"
              onClick={async () => { const url = await getReturnAttachmentSignedUrl(att.filePath); if (url) window.open(url, '_blank', 'noopener'); }}
            >
              Abrir
            </button>
          </PanelSection>
        ))}
      </Panel>

      <ItemInspectorDrawer
        open={!!inspectingItem}
        item={inspectingItem}
        returnStatus={record.status}
        attachments={attachments}
        history={history}
        canWrite={canWrite}
        canApprove={canApprove}
        canDecideApproval={canDecideApproval}
        canManageService={canManageService}
        canRelease={canRelease}
        canSyncErp={canSyncErp}
        approvalSettings={approvalSettings}
        conditionGrades={conditionGrades}
        productPrices={productPrices}
        userLabel={userLabel}
        userId={profile?.id ?? ''}
        userEmail={profile?.email ?? ''}
        companyId={companyId}
        onClose={() => setInspectingItemId(null)}
        onChanged={load}
      />

      <AdminReasonModal
        open={showCancel}
        title="Cancelar devolução"
        summary={<AdminRecordSummary fields={[{ label: 'Código', value: record.code }, { label: 'Status atual', value: RETURN_STATUS_LABEL[record.status] }]} />}
        consequence="A devolução será marcada como cancelada e não aceitará mais nenhuma alteração de status."
        confirmLabel="Cancelar devolução"
        acknowledgeLabel="Confirmo o cancelamento desta devolução."
        variant="danger"
        onClose={() => setShowCancel(false)}
        onConfirm={async reason => {
          await transitionReturnStatus(returnId, 'cancelled', reason);
          setShowCancel(false);
          await load();
        }}
      />
    </Page>
  );
}

function SummaryRow({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'critical' }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-fg-subtle">{label}</span>
      <span className={`font-medium tabular-nums ${tone === 'critical' && value > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>{value}</span>
    </div>
  );
}

// ── Inspetor do item: painel lateral com abas Inspeção / Evidências / Histórico —
//    mesmo padrão de slide-over já usado em WarehousePositionDrawer/ProductQuickInspector. ──

type InspectorTab = 'inspecao' | 'evidencias' | 'historico';

interface ItemInspectorDrawerProps {
  open: boolean;
  item: ReturnItem | null;
  returnStatus: ReturnStatus;
  attachments: ReturnAttachment[];
  history: ReturnAuditEvent[];
  canWrite: boolean;
  canApprove: boolean;
  canDecideApproval: boolean;
  canManageService: boolean;
  canRelease: boolean;
  canSyncErp: boolean;
  approvalSettings: ApprovalSettings | null;
  conditionGrades: ConditionGrade[];
  productPrices: Map<string, number>;
  userLabel: (id: string | null) => string;
  userId: string;
  userEmail: string;
  companyId: string;
  onClose: () => void;
  onChanged: () => void;
}

function ItemInspectorDrawer({ open, item, returnStatus, attachments, history, onClose, onChanged, ...rowProps }: ItemInspectorDrawerProps) {
  const [tab, setTab] = useState<InspectorTab>('inspecao');

  useEffect(() => { if (open) setTab('inspecao'); }, [open, item?.id]);

  const TABS: { key: InspectorTab; label: string }[] = [
    { key: 'inspecao', label: 'Inspeção' },
    { key: 'evidencias', label: 'Evidências' },
    { key: 'historico', label: 'Histórico' },
  ];

  return (
    <AnimatePresence>
      {open && item && (
        <div className="fixed inset-0" style={{ zIndex: 'var(--z-modal)' }}>
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            style={{ zIndex: 'var(--z-modal-backdrop)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            style={{ zIndex: 'var(--z-modal)' }}
            className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col bg-surface border-l border-edge shadow-overlay"
          >
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-edge flex-shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control bg-surface-3 text-fg-subtle">
                  <Package size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-fg line-clamp-2">{item.description}</h2>
                  <p className="text-xs text-fg-subtle font-mono">{item.sku ?? '—'}</p>
                  <p className="text-xs text-fg-subtle">{item.receivedQuantity} unidade{item.receivedQuantity === 1 ? '' : 's'} recebida{item.receivedQuantity === 1 ? '' : 's'} · {item.currentLocation}</p>
                </div>
              </div>
              <button onClick={onClose} className="flex-shrink-0 text-fg-subtle hover:text-fg transition-colors"><X size={18} /></button>
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
              {tab === 'inspecao' && (
                <ReturnItemRow key={item.id} item={item} returnStatus={returnStatus} onChanged={onChanged} {...rowProps} />
              )}

              {tab === 'evidencias' && (
                <div className="p-6 space-y-3">
                  <p className="text-xs text-fg-subtle">Anexos são compartilhados por toda a devolução — envie ou abra pela seção "Anexos" da devolução.</p>
                  {attachments.length === 0 && <p className="text-sm text-fg-subtle">Nenhum anexo enviado ainda.</p>}
                  {attachments.length > 0 && (
                    <div className="divide-y divide-edge">
                      {attachments.map(att => (
                        <div key={att.id} className="flex items-center justify-between py-2 text-sm">
                          <span className="text-fg">{att.fileName}</span>
                          <button
                            type="button" className="text-xs text-accent underline"
                            onClick={async () => { const url = await getReturnAttachmentSignedUrl(att.filePath); if (url) window.open(url, '_blank', 'noopener'); }}
                          >
                            Abrir
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'historico' && (
                <div className="p-6">
                  <p className="text-xs text-fg-subtle mb-3">Histórico completo da devolução — ainda não há um rastro separado por item.</p>
                  {history.length === 0 && <p className="text-sm text-fg-subtle">Nenhum evento registrado ainda.</p>}
                  {history.length > 0 && (
                    <div className="divide-y divide-edge">
                      {history.map(event => (
                        <div key={event.id} className="py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-fg">{auditActionLabel(event.action)}</p>
                            <p className="text-xs text-fg-subtle flex-shrink-0">{new Date(event.createdAt).toLocaleString('pt-BR')}</p>
                          </div>
                          <p className="text-xs text-fg-subtle mt-0.5">{event.userEmail ?? '—'} · {eventNote(event.metadata)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-edge flex-shrink-0">
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ── Linha de item: conferência / inspeção / destinação, conforme o status atual ──

interface ReturnItemRowProps {
  item: ReturnItem;
  returnStatus: ReturnStatus;
  canWrite: boolean;
  canApprove: boolean;
  canDecideApproval: boolean;
  canManageService: boolean;
  canRelease: boolean;
  canSyncErp: boolean;
  approvalSettings: ApprovalSettings | null;
  conditionGrades: ConditionGrade[];
  productPrices: Map<string, number>;
  userLabel: (id: string | null) => string;
  userId: string;
  userEmail: string;
  companyId: string;
  onChanged: () => void;
}

function ReturnItemRow({
  item, returnStatus, canWrite, canApprove, canDecideApproval, canManageService, canRelease, canSyncErp,
  approvalSettings, conditionGrades, productPrices, userLabel, userId, userEmail, companyId, onChanged,
}: ReturnItemRowProps) {
  const [receivedQuantity, setReceivedQuantity] = useState(String(item.receivedQuantity));
  const [lotNumber, setLotNumber] = useState(item.lotNumber ?? '');
  const [serialNumber, setSerialNumber] = useState(item.serialNumber ?? '');
  const [checklist, setChecklist] = useState<InspectionChecklistInput>({
    correctProduct: item.checklistCorrectProduct ?? false, packagingIntact: item.checklistPackagingIntact ?? false,
    noVisibleDamage: item.checklistNoVisibleDamage ?? false, apparentlyFunctional: item.checklistApparentlyFunctional ?? false,
    accessoriesComplete: item.checklistAccessoriesComplete ?? false, signsOfUse: item.checklistSignsOfUse ?? false,
    serialMatches: item.checklistSerialMatches ?? false,
  });
  const [classification, setClassification] = useState<ReturnClassification | ''>(item.classification ?? '');
  const [destination, setDestination] = useState<ReturnDestination | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [serviceOrders, setServiceOrders] = useState<ServiceOrder[]>([]);
  const [quarantineHolds, setQuarantineHolds] = useState<QuarantineHold[]>([]);
  const [showServiceOrderForm, setShowServiceOrderForm] = useState(false);
  const [showQuarantineForm, setShowQuarantineForm] = useState(false);
  const [erpContext, setErpContext] = useState<ReturnErpContext | null>(null);
  const [syncToErp, setSyncToErp] = useState(false);
  const [erpSyncStatus, setErpSyncStatus] = useState<ErpSyncStatus | null>(null);
  const [erpBusy, setErpBusy] = useState(false);

  const loadPhase2 = async () => {
    const [approvals, orders, holds] = await Promise.all([
      listApprovalRequestsForItem(item.id), listServiceOrdersForItem(item.id), listQuarantineHoldsForItem(item.id),
    ]);
    setApprovalRequests(approvals);
    setServiceOrders(orders);
    setQuarantineHolds(holds);
    setErpSyncStatus(item.erpSyncAdjustmentId ? await getErpSyncStatus(item.erpSyncAdjustmentId) : null);
  };

  useEffect(() => {
    loadPhase2();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.erpSyncAdjustmentId]);

  // Contexto de vínculo com o Tiny: só busca quando o usuário está de fato
  // considerando "Retornar ao estoque vendável" — não em toda renderização.
  useEffect(() => {
    if (destination !== 'restock' || item.destinationStatus !== 'pending') { setErpContext(null); return; }
    let cancelled = false;
    getReturnErpContext(companyId, item.productId).then(ctx => { if (!cancelled) setErpContext(ctx); });
    return () => { cancelled = true; };
  }, [destination, item.destinationStatus, item.productId, companyId]);

  const divergence = computeQuantityDivergence(item);
  const openServiceOrder = serviceOrders.find(o => !['completed', 'no_repair', 'cancelled'].includes(o.status));
  const openHold = quarantineHolds.find(h => !h.releasedAt);
  const itemValue = item.productId && productPrices.has(item.productId)
    ? productPrices.get(item.productId)! * item.receivedQuantity
    : null;
  const missingApprovalTypes = destination
    ? requiredApprovalTypes(
        { destination, serialMismatch: item.checklistSerialMatches === false, hasChecklistException: hasChecklistException(item), suggestedDestination: item.suggestedDestination },
        itemValue, approvalSettings
      ).filter(type => !approvalRequests.some(a => a.approvalType === type && a.status === 'approved'))
    : [];

  const saveConference = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateReturnItemConference(item.id, {
        receivedQuantity: Number(receivedQuantity.replace(',', '.')) || 0,
        lotNumber: lotNumber.trim() || null, serialNumber: serialNumber.trim() || null,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a conferência.');
    } finally {
      setSaving(false);
    }
  };

  const saveInspection = async (reason: string | null) => {
    if (!classification) { setError('Selecione uma classificação.'); return; }
    setSaving(true);
    setError(null);
    try {
      await setItemInspection(item.id, checklist, classification, reason);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a inspeção.');
    } finally {
      setSaving(false);
    }
  };

  const decideDestination = async (reason: string | null) => {
    if (!destination) return;
    setSaving(true);
    setError(null);
    try {
      const shouldSync = destination === 'restock' && syncToErp && !!erpContext;
      await decideItemDestination(item.id, destination, reason, shouldSync ? { connectionId: erpContext!.connectionId } : null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a destinação.');
    } finally {
      setSaving(false);
    }
  };

  const retryErpSync = async () => {
    if (!erpSyncStatus || !item.erpSyncAdjustmentId) return;
    setErpBusy(true);
    try {
      await runStockWrite(erpSyncStatus.connectionId, { adjustmentIds: [item.erpSyncAdjustmentId] });
      await loadPhase2();
    } finally {
      setErpBusy(false);
    }
  };

  const alreadyInspected = item.inspectedAt != null;
  const canEditConference = canWrite && ['received', 'in_conference'].includes(returnStatus);
  const canEditInspection = canWrite && returnStatus === 'in_inspection';
  const canDecideDestination = returnStatus === 'awaiting_destination' && item.destinationStatus === 'pending'
    && (destination && (destination === 'restock' || destination === 'discard') ? canApprove : canWrite)
    && missingApprovalTypes.length === 0
    && !(destination === 'restock' && !!openHold);

  return (
    <div className="p-6 space-y-4">
      {divergence !== null && divergence !== 0 && (
        <p className="text-xs text-red-600 dark:text-red-400">Divergência: {divergence > 0 ? '+' : ''}{divergence} em relação ao esperado.</p>
      )}

      {/* Recebimento */}
      <section className="space-y-3">
        <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Recebimento</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Qtd. esperada</label>
            <p className="text-sm text-fg font-mono">{item.expectedQuantity ?? '—'}</p>
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Qtd. recebida</label>
            {canEditConference ? (
              <Input value={receivedQuantity} onChange={e => setReceivedQuantity(e.target.value)} className="font-mono" />
            ) : <p className="text-sm text-fg font-mono">{item.receivedQuantity}</p>}
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Lote</label>
            {canEditConference ? <Input value={lotNumber} onChange={e => setLotNumber(e.target.value)} /> : <p className="text-sm text-fg">{item.lotNumber ?? '—'}</p>}
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Série</label>
            {canEditConference ? <Input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} /> : <p className="text-sm text-fg">{item.serialNumber ?? '—'}</p>}
          </div>
        </div>
        {canEditConference && (
          <Button size="sm" variant="secondary" onClick={saveConference} disabled={saving}>Salvar conferência</Button>
        )}
      </section>

      {/* Avaliação */}
      {(canEditInspection || item.classification) && (
        <section className="border-t border-edge pt-4 space-y-2">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Avaliação</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {CHECKLIST_FIELDS.map(field => (
              <label key={field.key} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox" checked={checklist[field.key]} disabled={!canEditInspection}
                  onChange={e => setChecklist(prev => ({ ...prev, [field.key]: e.target.checked }))}
                  className="h-4 w-4 rounded border-edge"
                />
                {field.label}
              </label>
            ))}
          </div>
          <Select value={classification} onChange={e => setClassification(e.target.value as ReturnClassification)} disabled={!canEditInspection} className="w-full sm:w-64">
            <option value="">Classificação...</option>
            {(Object.keys(RETURN_CLASSIFICATION_LABEL) as ReturnClassification[]).map(c => <option key={c} value={c}>{RETURN_CLASSIFICATION_LABEL[c]}</option>)}
          </Select>
          {canEditInspection && (
            alreadyInspected ? (
              <InlineReasonAction label="Registrar correção da avaliação" onConfirm={saveInspection} disabled={saving} />
            ) : (
              <Button size="sm" variant="secondary" onClick={() => saveInspection(null)} disabled={saving}>Salvar avaliação</Button>
            )
          )}
          {item.inspectedAt && <p className="text-xs text-fg-subtle">Avaliado por {userLabel(item.inspectedBy)} em {new Date(item.inspectedAt).toLocaleString('pt-BR')}</p>}
        </section>
      )}

      {/* Destinação */}
      {(returnStatus === 'awaiting_destination' || item.destination) && (
        <section className="border-t border-edge pt-4 space-y-2">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Destinação</p>
          {item.suggestedDestination && item.destinationStatus === 'pending' && (
            <p className="text-xs text-fg-subtle">
              Sugestão da regra: <span className="font-medium text-fg">{RETURN_DESTINATION_LABEL[item.suggestedDestination]}</span>
              {destination && destination !== item.suggestedDestination && <span className="text-red-600 dark:text-red-400"> — decisão diverge da sugestão.</span>}
            </p>
          )}
          {item.destinationStatus !== 'pending' ? (
            <div className="space-y-1.5">
              <p className="text-sm text-fg">
                {item.destination && RETURN_DESTINATION_LABEL[item.destination]}
                {item.destinationStatus === 'in_treatment' && <span className="text-fg-subtle"> — em tratamento, aguardando conclusão da ordem de serviço.</span>}
                {item.destinationStatus === 'moved' && <> — decidido por {userLabel(item.destinationDecidedBy)} em {item.destinationDecidedAt ? new Date(item.destinationDecidedAt).toLocaleString('pt-BR') : '—'}</>}
              </p>
              {item.destinationReason && (
                <div className="rounded border border-edge p-2 text-xs space-y-0.5">
                  <p className="text-fg-subtle">Decisão: <span className="text-fg">{item.destination ? RETURN_DESTINATION_LABEL[item.destination] : '—'}</span></p>
                  <p className="text-fg-subtle">Responsável: <span className="text-fg">{userLabel(item.destinationDecidedBy)}</span></p>
                  <p className="text-fg-subtle">Data: <span className="text-fg">{item.destinationDecidedAt ? new Date(item.destinationDecidedAt).toLocaleString('pt-BR') : '—'}</span></p>
                  <p className="text-fg-subtle">Justificativa: <span className="text-fg">{item.destinationReason}</span></p>
                </div>
              )}
              {item.erpSyncAdjustmentId && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-fg-subtle">Sincronização com o Tiny:</span>
                  <Badge variant={
                    erpSyncStatus?.syncStatus === 'sent' || erpSyncStatus?.syncStatus === 'confirmed' ? 'accent'
                    : erpSyncStatus?.syncStatus === 'failed' ? 'danger' : 'neutral'
                  }>
                    {erpSyncStatus?.syncStatus === 'sent' ? 'Enviado'
                      : erpSyncStatus?.syncStatus === 'confirmed' ? 'Confirmado'
                      : erpSyncStatus?.syncStatus === 'failed' ? 'Requer atenção'
                      : erpSyncStatus?.syncStatus === 'skipped' ? 'Ignorado' : 'Pendente'}
                  </Badge>
                  {erpSyncStatus?.errorMessage && <span className="text-red-600 dark:text-red-400">{erpSyncStatus.errorMessage}</span>}
                  {erpSyncStatus?.syncStatus === 'failed' && canSyncErp && (
                    <button type="button" className="underline text-accent" onClick={retryErpSync} disabled={erpBusy}>Tentar novamente</button>
                  )}
                </div>
              )}
            </div>
          ) : returnStatus === 'awaiting_destination' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={destination} onChange={e => setDestination(e.target.value as ReturnDestination)} className="w-full sm:w-64">
                  <option value="">Selecione a destinação...</option>
                  {(Object.keys(RETURN_DESTINATION_LABEL) as ReturnDestination[]).map(d => <option key={d} value={d}>{RETURN_DESTINATION_LABEL[d]}</option>)}
                </Select>
                {destination === 'restock' && openHold && (
                  <span className="text-xs text-red-600 dark:text-red-400">Item em quarentena aberta — libere antes de retornar ao estoque.</span>
                )}
                {destination && missingApprovalTypes.length > 0 && (
                  <span className="text-xs text-fg-subtle">
                    Exige aprovação: {missingApprovalTypes.map(t => APPROVAL_TYPE_LABEL[t]).join(', ')}.
                    {canWrite && (
                      <button
                        type="button" className="ml-1 underline"
                        onClick={async () => { for (const t of missingApprovalTypes) await requestItemApproval(item.id, t, null); await loadPhase2(); }}
                      >
                        Solicitar
                      </button>
                    )}
                  </span>
                )}
                {destination && !canDecideDestination && missingApprovalTypes.length === 0 && !(destination === 'restock' && openHold) && (
                  <span className="text-xs text-fg-subtle">Requer aprovação de owner/admin/manager.</span>
                )}
              </div>
              {destination === 'restock' && erpContext && (
                <div className="rounded border border-edge p-2 space-y-1 text-xs">
                  <label className="flex items-center gap-2 text-sm text-fg">
                    <input type="checkbox" checked={syncToErp} onChange={e => setSyncToErp(e.target.checked)} className="h-4 w-4 rounded border-edge" />
                    Sincronizar entrada com ERP
                  </label>
                  {syncToErp && (
                    <div className="text-fg-subtle space-y-0.5 pl-6">
                      <p>Quantidade a retornar ao estoque: <span className="font-mono text-fg">{item.receivedQuantity}</span></p>
                      <p>ERP conectado: {erpContext.connectionDisplayName}</p>
                      <p>SKU interno: {item.sku ?? '—'}</p>
                      <p>Produto no Tiny: {erpContext.productLinked ? (erpContext.externalProductName ?? erpContext.externalSku ?? '—') : (
                        <span className="text-fg-subtle">sem vínculo</span>
                      )}</p>
                      <p>Depósito no Tiny: {erpContext.warehouseLinked ? (erpContext.externalWarehouseName ?? '—') : (
                        <span className="text-fg-subtle">sem vínculo</span>
                      )}</p>
                      {(!erpContext.productLinked || !erpContext.warehouseLinked) && (
                        <p className="text-fg-subtle">
                          Sem vínculo completo, a destinação interna será concluída normalmente, mas a sincronização ficará "Requer atenção".
                        </p>
                      )}
                      <p>O envio ao Tiny é processado de forma assíncrona, em segundo plano.</p>
                    </div>
                  )}
                </div>
              )}
              {destination && canDecideDestination && (
                isDestinationReasonRequired(destination)
                  ? <InlineReasonAction label="Confirmar destinação" onConfirm={decideDestination} disabled={saving} />
                  : <Button size="sm" onClick={() => decideDestination(null)} disabled={saving}>Confirmar destinação</Button>
              )}
            </div>
          ) : null}
        </section>
      )}

      {/* Aprovações */}
      {approvalRequests.length > 0 && (
        <section className="border-t border-edge pt-4 space-y-1.5">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Aprovações</p>
          {approvalRequests.map(req => (
            <div key={req.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={req.status === 'pending' ? 'neutral' : req.status === 'approved' ? 'accent' : 'danger'}>{APPROVAL_TYPE_LABEL[req.approvalType]}</Badge>
              <span className="text-xs text-fg-subtle">
                {req.status === 'pending' ? 'Pendente' : req.status === 'approved' ? `Aprovado por ${userLabel(req.decidedBy)}` : `Rejeitado por ${userLabel(req.decidedBy)}`}
                {req.decisionReason && ` — ${req.decisionReason}`}
              </span>
              {req.status === 'pending' && canDecideApproval && (
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={async () => { await decideItemApproval(req.id, true, null); await loadPhase2(); }}>Aprovar</Button>
                  <InlineReasonAction label="Rejeitar" onConfirm={async reason => { await decideItemApproval(req.id, false, reason); await loadPhase2(); }} />
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Assistência técnica / recondicionamento */}
      {(item.destinationStatus === 'in_treatment' || openServiceOrder) && (
        <section className="border-t border-edge pt-4 space-y-2">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Assistência / recondicionamento</p>
          {openServiceOrder ? (
            <ServiceOrderPanel order={openServiceOrder} canManage={canManageService} onChanged={async () => { await loadPhase2(); onChanged(); }} />
          ) : canManageService ? (
            showServiceOrderForm ? (
              <ServiceOrderForm
                companyId={companyId} returnItemId={item.id} serviceType={item.destination === 'refurbishment' ? 'refurbishment' : 'technical_assistance'}
                userId={userId} userEmail={userEmail}
                onCreated={async () => { setShowServiceOrderForm(false); await loadPhase2(); }}
                onCancel={() => setShowServiceOrderForm(false)}
              />
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setShowServiceOrderForm(true)}>Abrir ordem de serviço</Button>
            )
          ) : null}
          {serviceOrders.filter(o => o.id !== openServiceOrder?.id).map(o => (
            <p key={o.id} className="text-xs text-fg-subtle">Ordem anterior: {SERVICE_ORDER_STATUS_LABEL[o.status]}{o.resultNotes ? ` — ${o.resultNotes}` : ''}</p>
          ))}
        </section>
      )}

      {/* Quarentena */}
      {(openHold || item.destination === 'quarantine' || item.currentLocation.toLowerCase().includes('quarentena')) && (
        <section className="border-t border-edge pt-4 space-y-2">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Quarentena</p>
          {openHold ? (
            <div className="text-sm text-fg space-y-1">
              <p className="text-red-600 dark:text-red-400">
                Bloqueado desde {new Date(openHold.createdAt).toLocaleDateString('pt-BR')} — {openHold.blockReason}
              </p>
              <p className="text-xs text-fg-subtle">{openHold.responsible ? `Responsável: ${openHold.responsible}` : ''}{openHold.reviewDeadline ? ` · Prazo: ${new Date(openHold.reviewDeadline).toLocaleDateString('pt-BR')}` : ''}</p>
              {canRelease && <InlineReasonAction label="Liberar quarentena" onConfirm={async reason => { await releaseQuarantineHold(openHold.id, reason); await loadPhase2(); onChanged(); }} />}
            </div>
          ) : (
            <>
              <p className="text-sm text-fg-subtle">Sem bloqueio ativo.</p>
              {canWrite && (
                showQuarantineForm ? (
                  <QuarantineHoldForm
                    companyId={companyId} returnItemId={item.id} userId={userId} userEmail={userEmail}
                    onCreated={async () => { setShowQuarantineForm(false); await loadPhase2(); }}
                    onCancel={() => setShowQuarantineForm(false)}
                  />
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setShowQuarantineForm(true)}>Registrar bloqueio</Button>
                )
              )}
            </>
          )}
        </section>
      )}

      {/* Responsabilidade */}
      <section className="border-t border-edge pt-4 space-y-1">
        <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Responsabilidade</p>
        {item.inspectedAt ? (
          <p className="text-sm text-fg">Avaliação realizada por {userLabel(item.inspectedBy)} em {new Date(item.inspectedAt).toLocaleString('pt-BR')}</p>
        ) : (
          <p className="text-sm text-fg-subtle">Ainda não avaliado.</p>
        )}
        {conditionGrades.length > 0 && item.conditionGradeId && (
          <p className="text-xs text-fg-subtle">Grade de condição: {conditionGrades.find(g => g.id === item.conditionGradeId)?.label ?? '—'}</p>
        )}
      </section>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ── Assistência técnica / recondicionamento: painel de acompanhamento + formulário de criação ──

const SERVICE_ORDER_TRANSITIONS: Partial<Record<ServiceOrderStatus, ServiceOrderStatus[]>> = {
  awaiting_analysis: ['in_service', 'no_repair', 'cancelled'],
  in_service: ['awaiting_part', 'completed', 'no_repair', 'cancelled'],
  awaiting_part: ['in_service', 'completed', 'no_repair', 'cancelled'],
};

function ServiceOrderPanel({ order, canManage, onChanged }: { order: ServiceOrder; canManage: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const nextOptions = SERVICE_ORDER_TRANSITIONS[order.status] ?? [];
  const needsReason = (s: ServiceOrderStatus) => s === 'no_repair' || s === 'cancelled';

  const advance = async (to: ServiceOrderStatus, reason: string | null) => {
    setBusy(true);
    try { await transitionServiceOrderStatus(order.id, to, reason); onChanged(); } finally { setBusy(false); }
  };

  return (
    <div className="text-sm text-fg space-y-1.5">
      <p>
        <Badge variant="accent">{SERVICE_ORDER_STATUS_LABEL[order.status]}</Badge>{' '}
        {order.responsible && <>Responsável: {order.responsible} · </>}
        {order.defectIdentified && <>Defeito: {order.defectIdentified} · </>}
        {order.deadline && <>Prazo: {new Date(order.deadline).toLocaleDateString('pt-BR')}</>}
      </p>
      {canManage && nextOptions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nextOptions.map(to =>
            needsReason(to) ? (
              <InlineReasonAction key={to} label={SERVICE_ORDER_STATUS_LABEL[to]} onConfirm={reason => advance(to, reason)} disabled={busy} />
            ) : (
              <Button key={to} size="sm" variant="secondary" onClick={() => advance(to, null)} disabled={busy}>{SERVICE_ORDER_STATUS_LABEL[to]}</Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ServiceOrderForm({ companyId, returnItemId, serviceType, userId, userEmail, onCreated, onCancel }: {
  companyId: string; returnItemId: string; serviceType: ServiceOrderType; userId: string; userEmail: string;
  onCreated: () => void; onCancel: () => void;
}) {
  const [responsible, setResponsible] = useState('');
  const [defect, setDefect] = useState('');
  const [deadline, setDeadline] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await createServiceOrder({
        companyId, returnItemId, serviceType, responsible: responsible.trim() || null, locationInternal: null,
        externalProvider: null, defectIdentified: defect.trim() || null, partsServicesExpected: null,
        estimatedCost: null, deadline: deadline || null,
      }, userId, userEmail);
      onCreated();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 text-sm">
      <Input value={responsible} onChange={e => setResponsible(e.target.value)} placeholder="Responsável" />
      <Input value={defect} onChange={e => setDefect(e.target.value)} placeholder="Defeito identificado" />
      <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving}>Criar ordem</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

// ── Quarentena: formulário de bloqueio ──────────────────────────────────────

function QuarantineHoldForm({ companyId, returnItemId, userId, userEmail, onCreated, onCancel }: {
  companyId: string; returnItemId: string; userId: string; userEmail: string; onCreated: () => void; onCancel: () => void;
}) {
  const [blockReason, setBlockReason] = useState('');
  const [responsible, setResponsible] = useState('');
  const [reviewDeadline, setReviewDeadline] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = blockReason.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await createQuarantineHold({
        companyId, returnItemId, location: null, blockReason: blockReason.trim(),
        responsible: responsible.trim() || null, reviewDeadline: reviewDeadline || null, pendingNotes: null,
      }, userId, userEmail);
      onCreated();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 text-sm">
      <Input value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="Motivo do bloqueio" />
      <Input value={responsible} onChange={e => setResponsible(e.target.value)} placeholder="Responsável" />
      <Input type="date" value={reviewDeadline} onChange={e => setReviewDeadline(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving || !valid}>Registrar bloqueio</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

/** Campo de justificativa inline + botão — mesma exigência de `AdminReasonModal`,
 *  em linha (sem abrir modal) para não interromper a conferência item a item. */
function InlineReasonAction({ label, onConfirm, disabled }: { label: string; onConfirm: (reason: string) => void; disabled?: boolean }) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 5;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Textarea rows={1} value={reason} onChange={e => setReason(e.target.value)} placeholder="Justificativa (mínimo 5 caracteres)" className="min-w-[220px] flex-1" />
      <Button size="sm" onClick={() => onConfirm(reason.trim())} disabled={disabled || !valid}>{label}</Button>
    </div>
  );
}

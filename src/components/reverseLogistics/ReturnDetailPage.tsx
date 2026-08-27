import { useEffect, useState } from 'react';
import { ArrowLeft, History, Camera, RefreshCw, XCircle } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Button, Input, Select, Textarea } from '../ui';
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

const STATUS_BADGE: Record<ReturnStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  received: 'neutral', in_conference: 'accent', in_inspection: 'accent',
  awaiting_destination: 'warning', finalized: 'success', cancelled: 'danger',
};

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

  return (
    <Page>
      <PageHeader
        title={`Devolução ${record.code}`}
        description={record.customerName ? `Cliente: ${record.customerName}` : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onBack}><ArrowLeft size={16} /> Voltar</Button>
            {canWrite && forwardStatus && forwardStatus !== 'finalized' && (
              <Button onClick={() => handleAdvance(forwardStatus)} disabled={busy}>{NEXT_STATUS_LABEL[forwardStatus]}</Button>
            )}
            {canWrite && forwardStatus === 'finalized' && (
              <Button onClick={() => handleAdvance('finalized')} disabled={busy || !canFinalize} title={!canFinalize ? 'Todos os itens precisam ter a destinação processada.' : undefined}>
                {NEXT_STATUS_LABEL.finalized}
              </Button>
            )}
            {canCancel && (
              <Button variant="danger" onClick={() => setShowCancel(true)}><XCircle size={16} /> Cancelar</Button>
            )}
          </div>
        }
      />

      {actionError && (
        <Panel><PanelSection padding="md" className="text-sm text-red-600 dark:text-red-400">{actionError}</PanelSection></Panel>
      )}

      <Panel>
        <PanelSection padding="md" className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_BADGE[record.status]}>{RETURN_STATUS_LABEL[record.status]}</Badge>
          {record.unresolved && <Badge variant="warning">Não identificado</Badge>}
          <span className="text-xs text-fg-subtle">Recebida em {new Date(record.receivedAt).toLocaleString('pt-BR')} por {userLabel(record.receivedBy)}</span>
        </PanelSection>
        <PanelSection padding="md" className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Origem</p><p className="text-fg">{record.origin ?? '—'}</p></div>
          <div><p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Referência</p><p className="text-fg">{record.referenceValue ?? '—'}</p></div>
          <div><p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Motivo declarado</p><p className="text-fg">{record.reason ?? '—'}</p></div>
          <div><p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Observações</p><p className="text-fg">{record.notes ?? '—'}</p></div>
          {record.status === 'cancelled' && (
            <div className="sm:col-span-2"><p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Justificativa do cancelamento</p><p className="text-fg">{record.cancellationReason ?? '—'}</p></div>
          )}
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md"><p className="text-title">Itens ({items.length})</p></PanelSection>
        {items.length === 0 && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhum item registrado.</PanelSection>}
        {items.map(item => (
          <ReturnItemRow
            key={item.id}
            item={item}
            returnStatus={record.status}
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
            onChanged={load}
          />
        ))}
      </Panel>

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

      <Panel>
        <PanelSection padding="md" className="flex items-center gap-2"><History size={16} className="text-fg-subtle" /><p className="text-title">Histórico</p></PanelSection>
        {history.length === 0 && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhum evento registrado ainda.</PanelSection>}
        {history.map(event => (
          <PanelSection key={event.id} padding="sm" className="flex items-center justify-between text-sm">
            <span className="text-fg">{event.action}</span>
            <span className="text-xs text-fg-subtle">{event.userEmail ?? '—'} · {new Date(event.createdAt).toLocaleString('pt-BR')}</span>
          </PanelSection>
        ))}
      </Panel>

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
    <PanelSection padding="md" className="space-y-3 border-t border-edge first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-fg">{item.description}</p>
          <p className="text-xs text-fg-subtle">SKU: {item.sku ?? '—'} · Local atual: {item.currentLocation}</p>
        </div>
        <div className="flex items-center gap-2">
          {item.classification && <Badge variant="neutral">{RETURN_CLASSIFICATION_LABEL[item.classification]}</Badge>}
          {item.destination && <Badge variant={item.destinationStatus === 'moved' ? 'success' : 'warning'}>{RETURN_DESTINATION_LABEL[item.destination]}</Badge>}
        </div>
      </div>

      {/* Conferência */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Qtd. esperada</label>
          <p className="text-sm text-fg font-mono">{item.expectedQuantity ?? '—'}</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Qtd. recebida</label>
          {canEditConference ? (
            <Input value={receivedQuantity} onChange={e => setReceivedQuantity(e.target.value)} className="font-mono" />
          ) : <p className="text-sm text-fg font-mono">{item.receivedQuantity}</p>}
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Lote</label>
          {canEditConference ? <Input value={lotNumber} onChange={e => setLotNumber(e.target.value)} /> : <p className="text-sm text-fg">{item.lotNumber ?? '—'}</p>}
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Série</label>
          {canEditConference ? <Input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} /> : <p className="text-sm text-fg">{item.serialNumber ?? '—'}</p>}
        </div>
      </div>
      {divergence !== null && divergence !== 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Divergência: {divergence > 0 ? '+' : ''}{divergence} em relação ao esperado.</p>
      )}
      {canEditConference && (
        <Button size="sm" variant="secondary" onClick={saveConference} disabled={saving}>Salvar conferência</Button>
      )}

      {/* Inspeção */}
      {(canEditInspection || item.classification) && (
        <div className="border-t border-edge pt-3 space-y-2">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Inspeção</p>
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
          <Select value={classification} onChange={e => setClassification(e.target.value as ReturnClassification)} disabled={!canEditInspection} className="w-64">
            <option value="">Classificação...</option>
            {(Object.keys(RETURN_CLASSIFICATION_LABEL) as ReturnClassification[]).map(c => <option key={c} value={c}>{RETURN_CLASSIFICATION_LABEL[c]}</option>)}
          </Select>
          {canEditInspection && (
            alreadyInspected ? (
              <InlineReasonAction label="Registrar correção da inspeção" onConfirm={saveInspection} disabled={saving} />
            ) : (
              <Button size="sm" variant="secondary" onClick={() => saveInspection(null)} disabled={saving}>Salvar inspeção</Button>
            )
          )}
          {item.inspectedAt && <p className="text-xs text-fg-subtle">Inspecionado por {userLabel(item.inspectedBy)} em {new Date(item.inspectedAt).toLocaleString('pt-BR')}</p>}
        </div>
      )}

      {/* Destinação */}
      {(returnStatus === 'awaiting_destination' || item.destination) && (
        <div className="border-t border-edge pt-3 space-y-2">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Destinação</p>
          {item.suggestedDestination && item.destinationStatus === 'pending' && (
            <p className="text-xs text-fg-subtle">
              Sugestão da regra: <span className="font-medium text-fg">{RETURN_DESTINATION_LABEL[item.suggestedDestination]}</span>
              {destination && destination !== item.suggestedDestination && <span className="text-amber-600 dark:text-amber-400"> — decisão diverge da sugestão.</span>}
            </p>
          )}
          {item.destinationStatus !== 'pending' ? (
            <div className="space-y-1.5">
              <p className="text-sm text-fg">
                {item.destination && RETURN_DESTINATION_LABEL[item.destination]}
                {item.destinationStatus === 'in_treatment' && <span className="text-fg-subtle"> — em tratamento, aguardando conclusão da ordem de serviço.</span>}
                {item.destinationStatus === 'moved' && <> — decidido por {userLabel(item.destinationDecidedBy)} em {item.destinationDecidedAt ? new Date(item.destinationDecidedAt).toLocaleString('pt-BR') : '—'}</>}
                {item.destinationReason && <span className="block text-fg-subtle">Justificativa: {item.destinationReason}</span>}
              </p>
              {item.erpSyncAdjustmentId && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-fg-subtle">Sincronização com o Tiny:</span>
                  <Badge variant={
                    erpSyncStatus?.syncStatus === 'sent' || erpSyncStatus?.syncStatus === 'confirmed' ? 'success'
                    : erpSyncStatus?.syncStatus === 'failed' ? 'danger' : 'warning'
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
                <Select value={destination} onChange={e => setDestination(e.target.value as ReturnDestination)} className="w-64">
                  <option value="">Selecione a destinação...</option>
                  {(Object.keys(RETURN_DESTINATION_LABEL) as ReturnDestination[]).map(d => <option key={d} value={d}>{RETURN_DESTINATION_LABEL[d]}</option>)}
                </Select>
                {destination === 'restock' && openHold && (
                  <span className="text-xs text-red-600 dark:text-red-400">Item em quarentena aberta — libere antes de retornar ao estoque.</span>
                )}
                {destination && missingApprovalTypes.length > 0 && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
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
                        <span className="text-amber-600 dark:text-amber-400">sem vínculo</span>
                      )}</p>
                      <p>Depósito no Tiny: {erpContext.warehouseLinked ? (erpContext.externalWarehouseName ?? '—') : (
                        <span className="text-amber-600 dark:text-amber-400">sem vínculo</span>
                      )}</p>
                      {(!erpContext.productLinked || !erpContext.warehouseLinked) && (
                        <p className="text-amber-600 dark:text-amber-400">
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
        </div>
      )}

      {/* Aprovações */}
      {approvalRequests.length > 0 && (
        <div className="border-t border-edge pt-3 space-y-1.5">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Aprovações</p>
          {approvalRequests.map(req => (
            <div key={req.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={req.status === 'pending' ? 'warning' : req.status === 'approved' ? 'success' : 'danger'}>{APPROVAL_TYPE_LABEL[req.approvalType]}</Badge>
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
        </div>
      )}
      {/* Assistência técnica / recondicionamento */}
      {(item.destinationStatus === 'in_treatment' || openServiceOrder) && (
        <div className="border-t border-edge pt-3 space-y-2">
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
        </div>
      )}

      {/* Quarentena */}
      {(openHold || item.destination === 'quarantine' || item.currentLocation.toLowerCase().includes('quarentena')) && (
        <div className="border-t border-edge pt-3 space-y-2">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Quarentena</p>
          {openHold ? (
            <div className="text-sm text-fg space-y-1">
              <p>Bloqueado desde {new Date(openHold.createdAt).toLocaleDateString('pt-BR')} — {openHold.blockReason}{openHold.responsible ? ` · Responsável: ${openHold.responsible}` : ''}{openHold.reviewDeadline ? ` · Prazo: ${new Date(openHold.reviewDeadline).toLocaleDateString('pt-BR')}` : ''}</p>
              {canRelease && <InlineReasonAction label="Liberar quarentena" onConfirm={async reason => { await releaseQuarantineHold(openHold.id, reason); await loadPhase2(); onChanged(); }} />}
            </div>
          ) : canWrite ? (
            showQuarantineForm ? (
              <QuarantineHoldForm
                companyId={companyId} returnItemId={item.id} userId={userId} userEmail={userEmail}
                onCreated={async () => { setShowQuarantineForm(false); await loadPhase2(); }}
                onCancel={() => setShowQuarantineForm(false)}
              />
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setShowQuarantineForm(true)}>Registrar bloqueio de quarentena</Button>
            )
          ) : null}
        </div>
      )}

      {conditionGrades.length > 0 && item.conditionGradeId && (
        <p className="text-xs text-fg-subtle">Grade de condição: {conditionGrades.find(g => g.id === item.conditionGradeId)?.label ?? '—'}</p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </PanelSection>
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

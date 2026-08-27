import { useState } from 'react';
import { Search, Save, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { Modal, Button, Input, Select, Textarea, Badge } from '../ui';
import { useAuth } from '../../lib/auth';
import {
  createReturn, addReturnItem, createReturnFromNfeXml,
  searchSalesByReference, searchNfeByReference, searchProductByReference,
  type SaleMatch, type NfeMatch, type PoMatch, type ProductMatch,
} from '../../lib/reverseLogistics/reverseLogisticsService';
import { RETURN_SOURCE_TYPE_LABEL, type ReturnSourceType } from '../../lib/reverseLogistics/reverseLogisticsTypes';
import { parseNfeXml, NfeParseError } from '../../lib/nfe/nfeXmlParser';
import { fetchCandidateProducts, fetchLearned, findInvoiceByKey } from '../../lib/nfe/nfeService';
import { fetchNfeXmlByKey, isValidNfeAccessKey } from '../../lib/nfe/nfeProviderFetch';
import { buildProductLookups, collectItemCodes, resolveAssociation } from '../../lib/nfe/nfeAssociation';
import { resolveNfeCounterparty } from '../../lib/nfe/nfeCounterparty';
import type { NfeCounterparty } from '../../lib/nfe/nfeCounterparty';
import type { ParsedNfeItem, NfeInvoice, LinkMethod } from '../../lib/nfe/nfeTypes';
import { listFiscalEntities } from '../../lib/fiscalEntities/fiscalEntityService';
import { normalizeCnpj, formatCnpj } from '../../lib/fiscalEntities/cnpjUtils';
import type { FiscalEntity } from '../../lib/fiscalEntities/fiscalEntityTypes';
import { listConnections, listProviders, updateConnection } from '../../lib/integrations/integrationService';
import type { IntegrationConnection, IntegrationProvider } from '../../lib/integrations/types';
import {
  resolveOriginChannel, describeOriginChannel,
  type OriginChannelResult,
} from '../../lib/reverseLogistics/originChannelResolver';
import { logAuditEvent } from '../../lib/auditLogService';
import { canManageUsers } from '../../lib/permissionService';

/** Mensagens objetivas para a consulta por chave — nunca expõe erro bruto do
 *  provedor/backend. `pollProviderForXml`/`fetchNfeXmlByKey` (nfeProviderFetch.ts)
 *  já traduzem a maioria dos casos; aqui só resta mapear para o texto pedido. */
function mapLookupError(err: unknown): string {
  if (err instanceof NfeParseError) return 'A chave informada é inválida.';
  if (err instanceof Error) {
    const msg = err.message;
    if (/não encontrada/i.test(msg) || /not_found/i.test(msg)) return 'NF-e não localizada.';
    if (/inválida/i.test(msg)) return 'A chave informada é inválida.';
  }
  return 'Não foi possível consultar a NF-e. Tente novamente.';
}

async function hashXmlContent(xml: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(xml));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const LINK_METHOD_LABEL: Record<LinkMethod, string> = {
  sku: 'Vínculo por SKU', ean: 'Vínculo por EAN', learned: 'Vínculo aprendido',
  none: 'Sem vínculo — selecione manualmente', manual: 'Vínculo manual',
};

interface XmlItemState {
  parsed: ParsedNfeItem;
  productId: string | null;
  matchMethod: LinkMethod;
  selected: boolean;
  receivedQuantity: string;
  /** SKU/nome do produto interno vinculado — só preenchido quando o vínculo
   *  veio de código externo, EAN exato ou SKU exato (nunca por descrição). */
  productSku: string | null;
  productName: string | null;
}

interface XmlSummary {
  invoiceKey: string;
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  issueDate: string | null;
  counterparty: NfeCounterparty;
  additionalInfo: string | null;
  /** Empresa fiscal do workspace identificada nesta NF-e (o lado — emitente ou
   *  destinatário — oposto à contraparte). Sempre presente: sem correspondência
   *  de CNPJ com uma empresa fiscal ativa do workspace, a consulta é bloqueada
   *  antes de chegar a preencher o resumo. */
  fiscalEntity: FiscalEntity;
  /** det/prod/xPed do primeiro item que declarar — só exibição/auditoria,
   *  nunca usado para decidir o canal de origem nem para criar pedido interno. */
  externalReference: string | null;
}

interface NewReturnModalProps {
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}

type Match = { kind: 'sale'; value: SaleMatch } | { kind: 'nfe'; value: NfeMatch } | { kind: 'po'; value: PoMatch } | { kind: 'product'; value: ProductMatch };

const SEARCHABLE_SOURCE_TYPES: ReturnSourceType[] = ['order', 'nfe', 'sku', 'barcode'];

export function NewReturnModal({ companyId, onClose, onSaved }: NewReturnModalProps) {
  const { profile } = useAuth();
  const [sourceType, setSourceType] = useState<ReturnSourceType>('order');
  const [referenceValue, setReferenceValue] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selected, setSelected] = useState<Match | null>(null);
  const [markUnresolved, setMarkUnresolved] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [origin, setOrigin] = useState('');
  const [reason, setReason] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const [itemDescription, setItemDescription] = useState('');
  const [itemSku, setItemSku] = useState('');
  const [expectedQuantity, setExpectedQuantity] = useState('');
  const [receivedQuantity, setReceivedQuantity] = useState('1');
  const [lotNumber, setLotNumber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');

  // ── Modo "Chave de acesso da NF-e de devolução" ──────────────────────────
  const [nfeAccessKey, setNfeAccessKey] = useState('');
  const [xmlLookupBusy, setXmlLookupBusy] = useState(false);
  const [xmlLookupStatus, setXmlLookupStatus] = useState<string | null>(null);
  const [xmlError, setXmlError] = useState<string | null>(null);
  const [xmlSummary, setXmlSummary] = useState<XmlSummary | null>(null);
  const [xmlHash, setXmlHash] = useState<string | null>(null);
  const [xmlRawForSubmit, setXmlRawForSubmit] = useState<string | null>(null);
  const [originalNfe, setOriginalNfe] = useState<NfeInvoice | null>(null);
  const [xmlItems, setXmlItems] = useState<XmlItemState[]>([]);
  const [customerFilledByXml, setCustomerFilledByXml] = useState(false);

  // Canal de origem — resolvido por evidência da própria NF-e (idCadIntTran do
  // intermediador × external_account_id das contas de canal já cadastradas em
  // Integrações), nunca por nome/produto/texto livre. channelConnections são as
  // contas de canal (integration_connections) da mesma empresa fiscal já
  // identificada acima.
  const [channelConnections, setChannelConnections] = useState<IntegrationConnection[]>([]);
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [originChannelResult, setOriginChannelResult] = useState<OriginChannelResult | null>(null);
  const [selectedChannelConnectionId, setSelectedChannelConnectionId] = useState<string | null>(null);
  const [rememberChannelMapping, setRememberChannelMapping] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchable = SEARCHABLE_SOURCE_TYPES.includes(sourceType);

  const handleSearch = async () => {
    if (!referenceValue.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      if (sourceType === 'order') {
        const results = await searchSalesByReference(companyId, referenceValue);
        setMatches(results.map(value => ({ kind: 'sale' as const, value })));
      } else if (sourceType === 'nfe') {
        const results = await searchNfeByReference(companyId, referenceValue);
        setMatches(results.map(value => ({ kind: 'nfe' as const, value })));
      } else if (sourceType === 'sku' || sourceType === 'barcode') {
        const results = await searchProductByReference(companyId, referenceValue, sourceType);
        setMatches(results.map(value => ({ kind: 'product' as const, value })));
      }
    } catch (err) {
      console.error('Error searching for return reference:', err);
      setError('Não foi possível buscar. Tente novamente.');
    } finally {
      setSearching(false);
    }
  };

  const pickMatch = (match: Match) => {
    setSelected(match);
    setMarkUnresolved(false);
    if (match.kind === 'sale') {
      setItemSku(match.value.sku);
      setItemDescription(match.value.productName);
      setExpectedQuantity(String(match.value.quantity));
    } else if (match.kind === 'product') {
      setItemSku(match.value.sku);
      setItemDescription(match.value.name);
    }
  };

  const handleLookupXml = async () => {
    if (xmlLookupBusy) return;
    const key = nfeAccessKey.trim();
    if (!isValidNfeAccessKey(key)) {
      setXmlError('Informe uma chave de acesso válida com 44 dígitos.');
      return;
    }
    setXmlError(null);
    setXmlLookupBusy(true);
    setXmlLookupStatus('Consultando a NF-e no provedor...');
    try {
      const xml = await fetchNfeXmlByKey(key, (attempt, max) => {
        if (attempt > 1) setXmlLookupStatus(`Aguardando o provedor... (tentativa ${attempt} de ${max})`);
      });
      const parsed = parseNfeXml(xml);
      const hash = await hashXmlContent(xml);
      const { skus, eans } = collectItemCodes(parsed.items);
      const [candidates, learned, original, fiscalEntities, connections, providerList] = await Promise.all([
        fetchCandidateProducts(skus, eans),
        fetchLearned(skus, eans),
        parsed.referencedInvoiceKey ? findInvoiceByKey(parsed.referencedInvoiceKey) : Promise.resolve(null),
        listFiscalEntities(companyId).catch(() => []),
        listConnections().catch(() => []),
        listProviders().catch(() => []),
      ]);
      const { bySku, byEan } = buildProductLookups(candidates);
      const productsById = new Map(candidates.map(p => [p.id, p]));
      const rows: XmlItemState[] = parsed.items.map(it => {
        const link = resolveAssociation({ nfeCode: it.nfeCode, eanNormalized: it.eanNormalized }, bySku, byEan, learned);
        const product = link.productId ? productsById.get(link.productId) ?? null : null;
        return {
          parsed: it, productId: link.productId, matchMethod: link.method, selected: true,
          receivedQuantity: String(it.expectedQuantity),
          productSku: product?.sku ?? null, productName: product?.name ?? null,
        };
      });

      // Empresa fiscal do workspace = a empresa fiscal ativa cujo CNPJ bate com o
      // emitente OU o destinatário da nota. resolveNfeCounterparty já faz essa
      // mesma comparação para achar a contraparte (o lado oposto); aqui achamos
      // o próprio registro para exibir e para decidir o bloqueio abaixo — nunca
      // por razão social/nome fantasia, só por CNPJ normalizado.
      const activeEntities = fiscalEntities.filter(e => e.status === 'active');
      const normEmit = normalizeCnpj(parsed.supplierCnpj ?? '');
      const normDest = normalizeCnpj(parsed.destCnpj ?? '');
      const fiscalEntity = activeEntities.find(e => {
        const norm = normalizeCnpj(e.cnpj);
        return norm === normEmit || norm === normDest;
      }) ?? null;
      const counterparty = resolveNfeCounterparty(parsed, activeEntities.map(e => e.cnpj));

      if (!fiscalEntity || counterparty.role === 'unknown') {
        setXmlError('Esta NF-e não pertence às empresas do workspace.');
        return;
      }

      // Contas de canal da mesma empresa fiscal — nunca todas as conexões do
      // workspace, senão uma NF-e da empresa A poderia sugerir um canal da B.
      const entityConnections = connections.filter(c => c.fiscalEntityId === fiscalEntity.id);
      const channelResult = resolveOriginChannel(
        { intermediaryCnpj: parsed.intermediaryCnpj, intermediaryIdCadIntTran: parsed.intermediaryIdCadIntTran },
        entityConnections,
      );
      const externalReference = parsed.items.map(i => i.externalOrderRef).find((v): v is string => !!v) ?? null;

      setXmlSummary({
        invoiceKey: parsed.invoiceKey, invoiceNumber: parsed.invoiceNumber, invoiceSeries: parsed.invoiceSeries,
        issueDate: parsed.issueDate, counterparty, additionalInfo: parsed.additionalInfo, fiscalEntity,
        externalReference,
      });
      setXmlHash(hash);
      setXmlRawForSubmit(xml);
      setOriginalNfe(original);
      setXmlItems(rows);
      setChannelConnections(entityConnections);
      setProviders(providerList);
      setOriginChannelResult(channelResult);
      setSelectedChannelConnectionId(null);
      setRememberChannelMapping(false);

      if (!customerName.trim() && counterparty.name) {
        setCustomerName(counterparty.name);
        setCustomerFilledByXml(true);
      }
      setNfeAccessKey('');
    } catch (err) {
      setXmlError(mapLookupError(err));
    } finally {
      setXmlLookupBusy(false);
      setXmlLookupStatus(null);
    }
  };

  const clearXml = () => {
    setXmlSummary(null); setXmlHash(null); setXmlRawForSubmit(null); setOriginalNfe(null);
    setXmlItems([]); setNfeAccessKey(''); setXmlError(null);
    setCustomerFilledByXml(false);
    setChannelConnections([]); setOriginChannelResult(null);
    setSelectedChannelConnectionId(null); setRememberChannelMapping(false);
  };

  const updateXmlItem = (index: number, patch: Partial<XmlItemState>) => {
    setXmlItems(prev => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const providerName = (providerKey: string): string =>
    providers.find(p => p.key === providerKey)?.name ?? providerKey;

  // Canal efetivo: a escolha manual do usuário (feita via <select>, sempre
  // editável) tem prioridade sobre a sugestão do resolvedor; sem escolha manual,
  // usa a sugestão automática (mapeada/ambígua/não identificada) tal como veio.
  const effectiveOriginChannel = (): OriginChannelResult => {
    if (selectedChannelConnectionId) {
      const connection = channelConnections.find(c => c.id === selectedChannelConnectionId) ?? null;
      return {
        connection, source: 'manual',
        externalIdentifierUsed: originChannelResult?.externalIdentifierUsed ?? null,
        intermediaryCnpj: originChannelResult?.intermediaryCnpj ?? null,
        candidates: [],
      };
    }
    return originChannelResult ?? {
      connection: null, source: 'nao_identificada',
      externalIdentifierUsed: null, intermediaryCnpj: null, candidates: [],
    };
  };

  const handleSaveXml = async () => {
    if (saving || !xmlSummary || !xmlRawForSubmit || !xmlHash) return;
    setError(null);
    const selectedItems = xmlItems.filter(i => i.selected);
    if (selectedItems.length === 0) { setError('Selecione ao menos um item recebido.'); return; }
    for (const it of selectedItems) {
      const qty = Number(it.receivedQuantity.replace(',', '.'));
      if (!qty || qty <= 0) { setError(`Informe uma quantidade recebida válida para "${it.parsed.description}".`); return; }
      if (qty > it.parsed.expectedQuantity) { setError(`A quantidade recebida ultrapassa a quantidade declarada para "${it.parsed.description}".`); return; }
    }

    setSaving(true);
    try {
      const channel = effectiveOriginChannel();
      const originDisplay = describeOriginChannel(channel, providerName);

      await createReturnFromNfeXml({
        invoiceKey: xmlSummary.invoiceKey, xmlHash, rawXml: xmlRawForSubmit,
        originalNfeInvoiceId: originalNfe?.id ?? null,
        customerName: customerName.trim() || null,
        origin: channel.connection ? originDisplay : null,
        originChannelConnectionId: channel.connection?.id ?? null,
        originSource: channel.connection ? channel.source : null,
        reason: reason.trim() || null,
        items: selectedItems.map(it => ({
          productId: it.productId, sku: it.parsed.nfeCode || null, ean: it.parsed.ean, description: it.parsed.description,
          declaredQuantity: it.parsed.expectedQuantity, receivedQuantity: Number(it.receivedQuantity.replace(',', '.')),
          lotNumber: it.parsed.lotNumber, serialNumber: null,
        })),
      });

      // Memorização confirmada: só grava external_account_id quando o usuário
      // marcou o checkbox e a conexão ainda não tinha esse identificador — nunca
      // sobrescreve um mapeamento já existente sem confirmação nova. A
      // devolução já foi registrada acima; uma falha aqui (ex.: usuário sem
      // permissão para editar integrações) não deve derrubar o registro feito.
      if (
        rememberChannelMapping && channel.connection && originChannelResult?.externalIdentifierUsed
        && !channel.connection.externalAccountId
      ) {
        try {
          await updateConnection(channel.connection.id, {
            externalAccountId: originChannelResult.externalIdentifierUsed,
          });
          await logAuditEvent({
            companyId, userId: profile?.id ?? '', userEmail: profile?.email ?? '',
            action: 'fiscal_entity.channel_mapping_confirmed',
            resourceType: 'integration_connections', resourceId: channel.connection.id,
            metadata: { externalAccountId: originChannelResult.externalIdentifierUsed },
          });
        } catch (mappingError) {
          console.error('Error remembering origin channel mapping:', mappingError);
        }
      }

      onSaved();
    } catch (err) {
      console.error('Error creating return from NF-e XML:', err);
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a devolução.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setError(null);
    if (sourceType === 'nfe_xml') { await handleSaveXml(); return; }

    if (!itemDescription.trim()) { setError('Descreva o produto devolvido.'); return; }
    const receivedQty = Number(receivedQuantity.replace(',', '.'));
    if (!receivedQty || receivedQty <= 0) { setError('Informe a quantidade recebida.'); return; }
    if (searchable && !selected && !markUnresolved) {
      setError('Selecione um resultado da busca ou marque como recebimento avulso.');
      return;
    }

    setSaving(true);
    try {
      const record = await createReturn(
        {
          companyId, sourceType, referenceValue: referenceValue.trim() || null,
          linkedSaleId: selected?.kind === 'sale' ? selected.value.id : null,
          linkedNfeInvoiceId: selected?.kind === 'nfe' ? selected.value.id : null,
          linkedPurchaseOrderId: selected?.kind === 'po' ? selected.value.id : null,
          unresolved: !selected,
          customerName: customerName.trim() || null,
          origin: origin.trim() || null,
          reason: reason.trim() || null,
          expectedQuantity: expectedQuantity.trim() ? Number(expectedQuantity.replace(',', '.')) : null,
          receivedAt: new Date(`${receivedAt}T00:00:00`).toISOString(),
          notes: notes.trim() || null,
        },
        profile?.id ?? '', profile?.email ?? ''
      );

      await addReturnItem(
        {
          returnId: record.id, companyId, lineNumber: 1,
          productId: selected?.kind === 'sale' ? selected.value.productId : selected?.kind === 'product' ? selected.value.id : null,
          sku: itemSku.trim() || null, ean: selected?.kind === 'product' ? selected.value.ean : null,
          description: itemDescription.trim(),
          expectedQuantity: expectedQuantity.trim() ? Number(expectedQuantity.replace(',', '.')) : null,
          receivedQuantity: receivedQty,
          lotNumber: lotNumber.trim() || null, serialNumber: serialNumber.trim() || null,
          originalPackaging: null, accessoriesReceived: null, itemNotes: null,
        },
        profile?.id ?? '', profile?.email ?? ''
      );

      onSaved();
    } catch (err) {
      console.error('Error creating return:', err);
      setError('Não foi possível registrar a devolução. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const effectiveChannel = effectiveOriginChannel();
  const originChannelResultLabel = describeOriginChannel(effectiveChannel, providerName);
  // Só oferece memorizar quando a NF-e trouxe idCadIntTran e a conta escolhida
  // ainda não tem external_account_id — nunca sobrescreve um mapeamento já
  // confirmado antes, e só quem pode editar integrações pode gravar (RLS).
  const canRememberMapping = Boolean(
    originChannelResult?.externalIdentifierUsed
    && effectiveChannel.connection
    && !effectiveChannel.connection.externalAccountId
    && canManageUsers(profile?.role)
  );

  return (
    <Modal open onClose={onClose} title="Nova Devolução" maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Localizar por</label>
          <div className="flex gap-2">
            <Select
              value={sourceType}
              onChange={e => { setSourceType(e.target.value as ReturnSourceType); setMatches([]); setSelected(null); setMarkUnresolved(false); clearXml(); }}
              className="w-56"
            >
              {(Object.keys(RETURN_SOURCE_TYPE_LABEL) as ReturnSourceType[]).filter(t => t !== 'manual').map(t => (
                <option key={t} value={t}>{RETURN_SOURCE_TYPE_LABEL[t]}</option>
              ))}
            </Select>
            <Input value={referenceValue} onChange={e => setReferenceValue(e.target.value)} placeholder="Digite o valor..." className="flex-1" />
            {searchable && (
              <Button variant="secondary" onClick={handleSearch} disabled={searching}><Search size={16} /> Buscar</Button>
            )}
          </div>
        </div>

        {sourceType !== 'nfe_xml' && searchable && matches.length > 0 && !selected && (
          <div className="border border-edge rounded-sheet divide-y divide-edge max-h-48 overflow-y-auto">
            {matches.map((m, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickMatch(m)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-3 flex items-center justify-between"
              >
                {m.kind === 'sale' && <span>{m.value.sku} — {m.value.productName} (qtd. {m.value.quantity})</span>}
                {m.kind === 'nfe' && <span>NF-e {m.value.invoiceNumber ?? m.value.invoiceKey} — {m.value.supplierName ?? '—'}</span>}
                {m.kind === 'product' && <span>{m.value.sku} — {m.value.name}</span>}
                {m.kind === 'po' && <span>{m.value.poNumber} — {m.value.supplierName}</span>}
              </button>
            ))}
          </div>
        )}

        {sourceType !== 'nfe_xml' && selected && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2">
            <CheckCircle2 size={16} /> Referência localizada e vinculada.
            <button type="button" className="ml-auto underline" onClick={() => setSelected(null)}>Trocar</button>
          </div>
        )}

        {sourceType !== 'nfe_xml' && !selected && (
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={markUnresolved} onChange={e => setMarkUnresolved(e.target.checked)} className="h-4 w-4 rounded border-edge" />
            Recebimento avulso — não foi possível localizar, o item fica bloqueado até identificação.
          </label>
        )}

        {sourceType === 'nfe_xml' && !xmlSummary && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-fg">
              <KeyRound size={16} className="text-fg-subtle" /> Chave de acesso da NF-e de devolução
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={nfeAccessKey}
                onChange={e => setNfeAccessKey(e.target.value.replace(/\D/g, '').slice(0, 44))}
                placeholder="Chave de acesso (44 dígitos)"
                inputMode="numeric"
                disabled={xmlLookupBusy}
                className="flex-1 font-mono"
              />
              <Button variant="secondary" onClick={handleLookupXml} disabled={xmlLookupBusy || !isValidNfeAccessKey(nfeAccessKey)}>
                {xmlLookupBusy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                {xmlLookupBusy ? 'Consultando...' : 'Consultar e preencher'}
              </Button>
            </div>
            {nfeAccessKey.length > 0 && nfeAccessKey.length !== 44 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {nfeAccessKey.length}/44 dígitos — a chave de acesso precisa ter exatamente 44 dígitos.
              </p>
            )}
            {xmlLookupBusy && xmlLookupStatus && (
              <p className="text-xs text-fg-subtle flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> {xmlLookupStatus}</p>
            )}
            {xmlError && <p className="text-sm text-red-600 dark:text-red-400">{xmlError}</p>}
          </div>
        )}

        {sourceType === 'nfe_xml' && xmlSummary && (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2 text-sm bg-surface-3 rounded-lg px-3 py-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-fg font-medium">
                    NF-e {xmlSummary.invoiceNumber ?? '—'}{xmlSummary.invoiceSeries ? ` · série ${xmlSummary.invoiceSeries}` : ''}
                  </p>
                  <Badge variant="accent">Extraído do XML</Badge>
                </div>
                <p className="text-xs text-fg-subtle font-mono break-all">{xmlSummary.invoiceKey}</p>
                <p className="text-xs text-fg-subtle">
                  Empresa fiscal: {xmlSummary.fiscalEntity.legalName}
                  {xmlSummary.fiscalEntity.tradeName ? ` (${xmlSummary.fiscalEntity.tradeName})` : ''}
                  {' · '}CNPJ {formatCnpj(xmlSummary.fiscalEntity.cnpj)}
                </p>
                <p className="text-xs text-fg-subtle">
                  {xmlSummary.counterparty.role === 'dest' ? 'Destinatário' : 'Emitente'}: {xmlSummary.counterparty.name ?? '—'}
                  {xmlSummary.counterparty.cnpj && <> · CNPJ {formatCnpj(xmlSummary.counterparty.cnpj)}</>}
                  {xmlSummary.counterparty.cpf && <> · CPF {xmlSummary.counterparty.cpf}</>}
                  {' · '}{xmlSummary.issueDate ? new Date(xmlSummary.issueDate).toLocaleDateString('pt-BR') : 'data não informada'}
                </p>
                <p className="text-xs text-fg-subtle">
                  {originalNfe ? <>Nota original localizada: {originalNfe.invoice_number ?? originalNfe.invoice_key}</> : 'Nota original não localizada — a devolução ficará marcada como não identificada.'}
                </p>
                {xmlSummary.externalReference && (
                  <p className="text-xs text-fg-subtle">Referência externa: {xmlSummary.externalReference}</p>
                )}
                {xmlItems.some(i => i.matchMethod === 'none') && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Alguns produtos precisam ser vinculados.</p>
                )}
              </div>
              <button type="button" className="text-xs underline text-accent shrink-0" onClick={clearXml}>Limpar</button>
            </div>

            <div className="border border-edge rounded-sheet divide-y divide-edge">
              {xmlItems.map((it, i) => {
                const qty = Number(it.receivedQuantity.replace(',', '.'));
                const exceedsDeclared = Number.isFinite(qty) && qty > it.parsed.expectedQuantity;
                return (
                  <div key={i} className="px-3 py-2 space-y-1">
                    <label className="flex items-center gap-2 text-sm text-fg flex-wrap">
                      <input
                        type="checkbox" checked={it.selected}
                        onChange={e => updateXmlItem(i, { selected: e.target.checked })}
                        className="h-4 w-4 rounded border-edge"
                      />
                      <span className="font-medium">{it.parsed.description}</span>
                      <span className="text-xs text-fg-subtle">
                        cód. {it.parsed.nfeCode || '—'} · EAN {it.parsed.ean ?? '—'} · un. {it.parsed.unit || '—'} · declarado: {it.parsed.expectedQuantity}
                        {it.parsed.lotNumber && <> · lote {it.parsed.lotNumber}</>}
                      </span>
                    </label>
                    {it.selected && (
                      <div className="pl-6 flex flex-wrap items-center gap-2">
                        <Badge variant={it.matchMethod === 'none' ? 'warning' : 'success'}>{LINK_METHOD_LABEL[it.matchMethod]}</Badge>
                        {it.productSku && (
                          <span className="text-xs text-fg-subtle">
                            SKU interno: {it.productSku}{it.productName ? ` — ${it.productName}` : ''}
                          </span>
                        )}
                        <Input
                          value={it.receivedQuantity} onChange={e => updateXmlItem(i, { receivedQuantity: e.target.value })}
                          className="w-28 font-mono" placeholder="Qtd. recebida"
                        />
                        {exceedsDeclared && (
                          <span className="text-xs text-red-600 dark:text-red-400">Não pode ultrapassar a quantidade declarada ({it.parsed.expectedQuantity}).</span>
                        )}
                        {it.matchMethod === 'none' && (
                          <span className="text-xs text-amber-600 dark:text-amber-400">Produto não identificado — poderá ser vinculado manualmente na tela da devolução.</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border border-edge rounded-sheet px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <label className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Canal de origem</label>
                {originChannelResultLabel && (
                  <Badge variant={effectiveChannel.connection ? 'success' : 'neutral'}>{originChannelResultLabel}</Badge>
                )}
              </div>

              {effectiveChannel.source === 'ambigua' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Mais de uma conta de canal corresponde a este identificador — selecione manualmente.
                </p>
              )}

              {channelConnections.length === 0 ? (
                <p className="text-xs text-fg-subtle">
                  Nenhuma conta de canal cadastrada para esta empresa fiscal. Cadastre em Integrações.
                </p>
              ) : (
                <Select
                  value={selectedChannelConnectionId ?? effectiveChannel.connection?.id ?? ''}
                  onChange={e => setSelectedChannelConnectionId(e.target.value || null)}
                  className="w-full sm:w-auto"
                >
                  <option value="">Canal não identificado</option>
                  {channelConnections.map(c => (
                    <option key={c.id} value={c.id}>{providerName(c.providerKey)} — {c.displayName}</option>
                  ))}
                </Select>
              )}

              {canRememberMapping && (
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input
                    type="checkbox" checked={rememberChannelMapping}
                    onChange={e => setRememberChannelMapping(e.target.checked)}
                    className="h-4 w-4 rounded border-edge"
                  />
                  Usar esta origem para futuras devoluções deste intermediador.
                </label>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Cliente</label>
              {customerFilledByXml && <Badge variant="accent" className="normal-case text-[10px] px-1.5 py-0.5">Preenchido pelo XML</Badge>}
            </div>
            <Input value={customerName} onChange={e => { setCustomerName(e.target.value); setCustomerFilledByXml(false); }} />
          </div>
          {sourceType !== 'nfe_xml' && (
            <div>
              <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Canal de origem</label>
              <Input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="Ex.: loja, marketplace" />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Data de recebimento</label>
            <Input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Motivo declarado</label>
            <Input value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>

        {sourceType !== 'nfe_xml' && (
        <div className="border-t border-edge pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Produto *</label>
            <Input value={itemDescription} onChange={e => setItemDescription(e.target.value)} placeholder="Descrição do produto" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">SKU</label>
            <Input value={itemSku} onChange={e => setItemSku(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Quantidade esperada</label>
            <Input value={expectedQuantity} onChange={e => setExpectedQuantity(e.target.value)} className="font-mono" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Quantidade recebida *</label>
            <Input value={receivedQuantity} onChange={e => setReceivedQuantity(e.target.value)} className="font-mono" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Lote</label>
            <Input value={lotNumber} onChange={e => setLotNumber(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Número de série</label>
            <Input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} />
          </div>
        </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Observações</label>
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={handleSave}
            disabled={saving || (sourceType === 'nfe_xml' && (!xmlSummary || xmlItems.every(i => !i.selected)))}
          >
            <Save size={16} /> {saving ? 'Salvando...' : 'Registrar Devolução'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

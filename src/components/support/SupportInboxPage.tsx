import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button, Notice, Page, PageHeader, SegmentedControl, Stat, StatRow } from '../ui';
import {
  CHANNEL_LABEL, countNeedingAttention, isOpen, sortForInbox, type SupportChannel,
} from '../../lib/support/supportDomain';
import {
  fetchCompanyNames, fetchUserNames, listInboxTickets, type SupportTicket,
} from '../../lib/support/supportService';
import { SupportThread } from './SupportThread';
import { TicketList } from './SupportPage';

interface SupportInboxPageProps {
  userId: string;
  userName: string;
  companyId: string;
  /** Staff do InventoryBlind — atende o canal `produto`, de todas as empresas. */
  isStaff: boolean;
  /** Owner/admin — atende o canal `interno` da própria empresa. */
  canAnswerInternal: boolean;
  /** Chamado a abrir direto, vindo do clique numa notificação. */
  initialTicketId?: string | null;
  onInitialTicketConsumed?: () => void;
}

/** Caixa de entrada de quem responde. Os dois canais aparecem lado a lado para
 *  quem atende os dois, mas continuam sendo listas separadas: misturá-las
 *  perderia justamente a distinção que a migration 119 existe para garantir. */
export function SupportInboxPage({ userId, userName, companyId, isStaff, canAnswerInternal, initialTicketId, onInitialTicketConsumed }: SupportInboxPageProps) {
  const channels = useMemo<SupportChannel[]>(() => {
    const list: SupportChannel[] = [];
    if (isStaff) list.push('produto');
    if (canAnswerInternal) list.push('interno');
    return list;
  }, [isStaff, canAnswerInternal]);

  const [channel, setChannel] = useState<SupportChannel>(channels[0] ?? 'interno');
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [companyNames, setCompanyNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listInboxTickets(channel);
      setTickets(rows);
      const ids = new Set<string>([userId]);
      rows.forEach(r => { ids.add(r.createdBy); if (r.resolvedBy) ids.add(r.resolvedBy); });
      setNames(await fetchUserNames([...ids]));
      if (channel === 'produto') {
        setCompanyNames(await fetchCompanyNames(rows.map(r => r.companyId)));
      }
    } catch (err) {
      console.error('[SupportInbox] load', err);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [channel, userId]);

  useEffect(() => { setSelected(null); load(); }, [load]);

  // Chegou pelo sino. A notificação não guarda o canal do chamado, então a
  // busca é pela lista já carregada; não achou, tenta o outro canal UMA vez
  // (`tried`), senão as duas abas ficariam alternando para sempre quando o
  // chamado tiver sido apagado.
  const pendingRef = useRef<string | null>(null);
  const triedRef = useRef<Set<SupportChannel>>(new Set());
  useEffect(() => {
    if (initialTicketId) { pendingRef.current = initialTicketId; triedRef.current = new Set(); }
  }, [initialTicketId]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || tickets === null) return;

    if (tickets.some(t => t.id === pending)) {
      setSelected(pending);
      pendingRef.current = null;
      onInitialTicketConsumed?.();
      return;
    }

    triedRef.current.add(channel);
    const outro = channels.find(c => !triedRef.current.has(c));
    if (outro) { setChannel(outro); return; }

    pendingRef.current = null;
    onInitialTicketConsumed?.();
  }, [tickets, channel, channels, onInitialTicketConsumed]);

  const ordered = useMemo(() => sortForInbox(tickets ?? []), [tickets]);
  const current = ordered.find(t => t.id === selected) ?? null;
  const abertos = (tickets ?? []).filter(t => isOpen(t.status)).length;
  const esperando = countNeedingAttention(tickets ?? [], 'answerer');

  const onChanged = useCallback((updated: SupportTicket) => {
    setTickets(prev => (prev ?? []).map(t => (t.id === updated.id ? updated : t)));
  }, []);

  if (channels.length === 0) {
    return (
      <Page>
        <PageHeader eyebrow="Suporte" title="Caixa de entrada" />
        <Notice tone="neutral">Você não responde chamados nesta empresa.</Notice>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Suporte"
        title="Caixa de entrada"
        description={
          channel === 'produto'
            ? 'Chamados que as empresas abriram para o InventoryBlind.'
            : 'Chamados que a sua equipe abriu para a gestão da empresa.'
        }
        actions={
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> {loading ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {channels.length > 1 && (
        <SegmentedControl
          label="Canal"
          value={channel}
          onChange={setChannel}
          options={channels.map(c => ({ value: c, label: CHANNEL_LABEL[c] }))}
        />
      )}

      <StatRow>
        <Stat label="Em aberto" value={String(abertos)} />
        <Stat
          label="Esperando você"
          value={String(esperando)}
          context={esperando > 0 ? 'Ninguém respondeu ainda' : 'Nada parado com você'}
        />
        <Stat label="Resolvidos" value={String((tickets ?? []).length - abertos)} />
      </StatRow>

      {tickets === null && <Notice tone="neutral">Carregando chamados…</Notice>}

      {tickets !== null && !current && (
        <TicketList
          tickets={ordered}
          names={names}
          companyNames={channel === 'produto' ? companyNames : undefined}
          emptyText={
            channel === 'produto'
              ? 'Nenhum chamado ao InventoryBlind até agora.'
              : 'Nenhum chamado da sua equipe até agora.'
          }
          onSelect={setSelected}
          viewing="answerer"
        />
      )}

      {current && (
        <div className="space-y-4">
          <button
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1.5 text-sm text-fg-subtle transition-colors hover:text-fg"
          >
            <ArrowLeft size={15} /> Voltar à caixa de entrada
          </button>
          <SupportThread
            ticket={current}
            viewing="answerer"
            currentUserId={userId}
            companyId={companyId}
            names={new Map(names).set(userId, userName)}
            onChanged={onChanged}
          />
        </div>
      )}
    </Page>
  );
}

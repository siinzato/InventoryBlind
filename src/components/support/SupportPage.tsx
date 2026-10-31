import { useCallback, useEffect, useMemo, useState } from 'react';
import { LifeBuoy, Plus, ArrowLeft } from 'lucide-react';
import {
  Badge, Button, Input, Notice, Page, PageHeader, Panel, PanelSection,
  Select, SegmentedControl, Textarea, ToastStack, useToasts,
} from '../ui';
import { formatDateTime } from '../../lib/productImportUtils';
import {
  CATEGORIES, CATEGORY_LABEL, CHANNEL_HINT, CHANNEL_LABEL, PRIORITIES, PRIORITY_LABEL,
  STATUS_LABEL, STATUS_VARIANT, buildContext, channelsFor, countNeedingAttention, needsAttention,
  sortForMine, validateBody, validateSubject,
  type SupportCategory, type SupportChannel, type SupportPriority,
} from '../../lib/support/supportDomain';
import {
  fetchUserNames, listMyTickets, openTicket, uploadAttachments, type SupportTicket,
} from '../../lib/support/supportService';
import { AttachmentPicker, SupportThread } from './SupportThread';

interface SupportPageProps {
  userId: string;
  userName: string;
  companyId: string;
  companyName: string | null;
  role: string | null;
  /** A tela em que a pessoa estava antes de vir pedir ajuda. É o campo mais útil
   *  do chamado e o único que ela não teria paciência de digitar. */
  originLabel: string | null;
  /** Chamado a abrir direto, vindo do clique numa notificação. */
  initialTicketId?: string | null;
  onInitialTicketConsumed?: () => void;
}

type View = 'novo' | 'meus';

export function SupportPage({ userId, userName, companyId, companyName, role, originLabel, initialTicketId, onInitialTicketConsumed }: SupportPageProps) {
  const [view, setView] = useState<View>('novo');
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const { toasts, toast } = useToasts();

  const load = useCallback(async () => {
    try {
      const rows = await listMyTickets(userId);
      setTickets(rows);
      const ids = new Set<string>([userId]);
      rows.forEach(r => { ids.add(r.createdBy); if (r.resolvedBy) ids.add(r.resolvedBy); });
      setNames(await fetchUserNames([...ids]));
    } catch (err) {
      console.error('[SupportPage] load', err);
      setTickets([]);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Chegou pelo sino: vai direto para a conversa daquele chamado, em vez de
  // largar a pessoa no formulário de abrir outro.
  useEffect(() => {
    if (!initialTicketId) return;
    setView('meus');
    setSelected(initialTicketId);
    onInitialTicketConsumed?.();
  }, [initialTicketId, onInitialTicketConsumed]);

  const mine = useMemo(() => sortForMine(tickets ?? []), [tickets]);
  const waitingOnMe = countNeedingAttention(tickets ?? [], 'author');
  const current = mine.find(t => t.id === selected) ?? null;

  const onChanged = useCallback((updated: SupportTicket) => {
    setTickets(prev => (prev ?? []).map(t => (t.id === updated.id ? updated : t)));
  }, []);

  return (
    <Page>
      <PageHeader
        eyebrow="Suporte"
        title="Abrir chamado"
        description="Peça ajuda sem sair do sistema. O chamado fica registrado no seu acesso, com todo o histórico da conversa."
        actions={
          view === 'meus' && !current ? (
            <Button onClick={() => setView('novo')}><Plus size={16} /> Novo chamado</Button>
          ) : undefined
        }
      />

      <SegmentedControl
        label="Seção do suporte"
        value={view}
        onChange={v => { setView(v); setSelected(null); }}
        options={[
          { value: 'novo', label: 'Abrir chamado' },
          { value: 'meus', label: waitingOnMe > 0 ? `Meus chamados (${waitingOnMe})` : 'Meus chamados' },
        ]}
      />

      {view === 'novo' && (
        <NewTicketForm
          companyId={companyId}
          companyName={companyName}
          role={role}
          originLabel={originLabel}
          onOpened={async () => {
            toast('Chamado aberto. A resposta aparece aqui mesmo.', 'success');
            await load();
            setView('meus');
          }}
        />
      )}

      {view === 'meus' && !current && (
        <TicketList
          tickets={mine}
          names={names}
          emptyText="Você ainda não abriu nenhum chamado."
          onSelect={setSelected}
          viewing="author"
        />
      )}

      {view === 'meus' && current && (
        <div className="space-y-4">
          <button
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1.5 text-sm text-fg-subtle transition-colors hover:text-fg"
          >
            <ArrowLeft size={15} /> Voltar aos meus chamados
          </button>
          <SupportThread
            ticket={current}
            viewing="author"
            currentUserId={userId}
            companyId={companyId}
            names={new Map(names).set(userId, userName)}
            onChanged={onChanged}
          />
        </div>
      )}

      <ToastStack toasts={toasts} />
    </Page>
  );
}

function NewTicketForm({
  companyId, companyName, role, originLabel, onOpened,
}: {
  companyId: string; companyName: string | null; role: string | null;
  originLabel: string | null; onOpened: () => void;
}) {
  const channels = useMemo(() => channelsFor(role), [role]);
  const [channel, setChannel] = useState<SupportChannel>(channels[0]);
  const [category, setCategory] = useState<SupportCategory>('erro');
  const [priority, setPriority] = useState<SupportPriority>('normal');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const invalid = validateSubject(subject) ?? validateBody(body);
    if (invalid) { setError(invalid); return; }

    setSaving(true);
    setError(null);
    try {
      let paths: string[] = [];
      if (files.length > 0) {
        const result = await uploadAttachments(companyId, files, Date.now());
        paths = result.paths;
        if (result.rejected.length > 0) {
          setError(result.rejected.map(r => `${r.name}: ${r.reason}`).join(' · '));
        }
      }

      await openTicket({
        channel, category, priority, subject, body, attachments: paths,
        context: buildContext({
          tela: originLabel,
          papel: role,
          empresa: companyName,
          navegador: navigator.userAgent,
          largura: window.innerWidth,
          altura: window.innerHeight,
        }),
      });

      setSubject(''); setBody(''); setFiles([]);
      onOpened();
    } catch (err) {
      console.error('[SupportPage] open', err);
      setError('Não foi possível abrir o chamado. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <PanelSection>
        <p className="text-overline mb-3">Para quem vai</p>
        {channels.length > 1 ? (
          <SegmentedControl
            label="Destino do chamado"
            value={channel}
            onChange={setChannel}
            options={channels.map(c => ({ value: c, label: CHANNEL_LABEL[c] }))}
            width="full"
          />
        ) : (
          <p className="text-sm font-medium text-fg">{CHANNEL_LABEL[channel]}</p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-fg-subtle">{CHANNEL_HINT[channel]}</p>
      </PanelSection>

      <PanelSection>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs text-fg-subtle">Assunto</span>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Em uma linha, o que está acontecendo"
              maxLength={160}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-fg-subtle">Tipo</span>
              <Select className="w-full" value={category} onChange={e => setCategory(e.target.value as SupportCategory)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-fg-subtle">Urgência</span>
              <Select className="w-full" value={priority} onChange={e => setPriority(e.target.value as SupportPriority)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </Select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-fg-subtle">O que aconteceu</span>
            <Textarea
              rows={6}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="O que você fez, o que esperava e o que apareceu."
            />
          </label>

          <AttachmentPicker files={files} onChange={setFiles} />
        </div>
      </PanelSection>

      <PanelSection padding="sm">
        {/* Dizer o que vai junto é o oposto de coletar escondido — e evita a
            pergunta "em que tela foi?" na primeira resposta. */}
        <p className="text-xs leading-relaxed text-fg-subtle">
          Vai junto automaticamente: {originLabel ? <>a tela <span className="text-fg-muted">{originLabel}</span></> : 'a tela de origem'}, seu papel,
          a empresa e o navegador. Nenhum dado de estoque é enviado.
        </p>
      </PanelSection>

      <PanelSection>
        {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={saving || !subject.trim() || !body.trim()}>
            <LifeBuoy size={16} /> {saving ? 'Abrindo…' : 'Abrir chamado'}
          </Button>
        </div>
      </PanelSection>
    </Panel>
  );
}

export function TicketList({
  tickets, names, emptyText, onSelect, viewing, companyNames,
}: {
  tickets: SupportTicket[];
  names: Map<string, string>;
  emptyText: string;
  onSelect: (id: string) => void;
  viewing: 'author' | 'answerer';
  companyNames?: Map<string, string>;
}) {
  if (tickets.length === 0) {
    return <Notice tone="neutral">{emptyText}</Notice>;
  }

  return (
    <Panel>
      {tickets.map(ticket => {
        const attention = needsAttention(ticket.status, viewing);
        return (
          <button
            key={ticket.id}
            onClick={() => onSelect(ticket.id)}
            className="block w-full border-t border-edge px-6 py-4 text-left transition-colors first:border-t-0 hover:bg-surface-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{ticket.subject}</p>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {companyNames ? `${companyNames.get(ticket.companyId) ?? '—'} · ` : ''}
                  {names.get(ticket.createdBy) ?? '—'} · {CATEGORY_LABEL[ticket.category]} · {formatDateTime(ticket.updatedAt)}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {attention && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Aguardando você" />}
                <Badge variant={STATUS_VARIANT[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
              </div>
            </div>
          </button>
        );
      })}
    </Panel>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Paperclip, Send, CheckCircle2, RotateCcw } from 'lucide-react';
import { Badge, Button, Notice, Panel, PanelSection, Textarea } from '../ui';
import { formatDateTime } from '../../lib/productImportUtils';
import {
  CATEGORY_LABEL, CHANNEL_LABEL, CONTEXT_LABEL, MAX_ATTACHMENTS, PRIORITY_LABEL,
  STATUS_LABEL, STATUS_VARIANT, resolutionLabel, validateBody, type TicketContext,
} from '../../lib/support/supportDomain';
import {
  attachmentUrl, listMessages, replyToTicket, setTicketStatus, uploadAttachments,
  type SupportMessage, type SupportTicket,
} from '../../lib/support/supportService';

interface SupportThreadProps {
  ticket: SupportTicket;
  /** Lado de quem está lendo — muda quem pode responder o quê e o texto dos botões. */
  viewing: 'author' | 'answerer';
  currentUserId: string;
  companyId: string;
  /** Nome por id, já resolvido pela tela que listou os chamados. */
  names: Map<string, string>;
  onChanged: (ticket: SupportTicket) => void;
}

/** A conversa de um chamado — cabeçalho, contexto capturado, mensagens e a
 *  caixa de resposta. Uma implementação só para os dois canais: o que muda
 *  entre eles é quem enxerga, e isso o banco já resolveu. */
export function SupportThread({ ticket, viewing, currentUserId, companyId, names, onChanged }: SupportThreadProps) {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    listMessages(ticket.id)
      .then(m => { if (!cancelled) setMessages(m); })
      .catch(() => { if (!cancelled) { setMessages([]); setError('Não foi possível carregar a conversa.'); } });
    return () => { cancelled = true; };
  }, [ticket.id]);

  const send = useCallback(async () => {
    const invalid = validateBody(body);
    if (invalid) { setError(invalid); return; }

    setSending(true);
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
      const message = await replyToTicket(ticket.id, body, paths);
      setMessages(prev => [...(prev ?? []), message]);
      setBody('');
      setFiles([]);
      onChanged({
        ...ticket,
        status: viewing === 'answerer' ? 'respondido' : 'em_analise',
        firstResponseAt: viewing === 'answerer' ? (ticket.firstResponseAt ?? message.createdAt) : ticket.firstResponseAt,
        updatedAt: message.createdAt,
      });
    } catch (err) {
      console.error('[SupportThread] reply', err);
      setError('Não foi possível enviar. Tente de novo.');
    } finally {
      setSending(false);
    }
  }, [body, files, companyId, ticket, viewing, onChanged]);

  const changeStatus = useCallback(async (status: 'resolvido' | 'em_analise') => {
    setSending(true);
    setError(null);
    try {
      onChanged(await setTicketStatus(ticket.id, status));
    } catch (err) {
      console.error('[SupportThread] status', err);
      setError('Não foi possível mudar o estado do chamado.');
    } finally {
      setSending(false);
    }
  }, [ticket.id, onChanged]);

  const resolved = ticket.status === 'resolvido';
  const closing = resolutionLabel(ticket, currentUserId, ticket.createdBy);
  const context = ticket.context as Partial<TicketContext>;
  const contextKeys = (Object.keys(CONTEXT_LABEL) as (keyof TicketContext)[]).filter(k => context[k]);

  return (
    <Panel>
      <PanelSection>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-fg">{ticket.subject}</h3>
            <p className="mt-1 text-xs text-fg-subtle">
              {CHANNEL_LABEL[ticket.channel]} · {CATEGORY_LABEL[ticket.category]} · Prioridade {PRIORITY_LABEL[ticket.priority].toLowerCase()}
            </p>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Aberto por {names.get(ticket.createdBy) ?? '—'} em {formatDateTime(ticket.createdAt)}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
        </div>

        {closing && <p className="mt-3 text-xs text-fg-muted">{closing} em {formatDateTime(ticket.resolvedAt ?? '')}.</p>}
      </PanelSection>

      {contextKeys.length > 0 && (
        <PanelSection padding="sm">
          <p className="text-overline mb-2">Contexto capturado</p>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {contextKeys.map(key => (
              <div key={key} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="text-fg-subtle">{CONTEXT_LABEL[key]}</dt>
                <dd className="truncate text-fg-muted" title={context[key]}>{context[key]}</dd>
              </div>
            ))}
          </dl>
        </PanelSection>
      )}

      <PanelSection>
        {messages === null && <p className="text-sm text-fg-subtle">Carregando conversa…</p>}
        {messages !== null && (
          <div className="space-y-5">
            {messages.map(message => (
              <MessageBlock
                key={message.id}
                message={message}
                author={names.get(message.authorId) ?? '—'}
                mine={message.authorId === currentUserId}
              />
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection>
        {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}

        {resolved ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              Chamado resolvido. Se o problema voltar, reabra — o histórico continua aqui.
            </p>
            <Button variant="secondary" onClick={() => changeStatus('em_analise')} disabled={sending}>
              <RotateCcw size={16} /> Reabrir
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              rows={3}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={viewing === 'answerer' ? 'Escreva a resposta…' : 'Responder ou acrescentar informação…'}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AttachmentPicker files={files} onChange={setFiles} />
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => changeStatus('resolvido')} disabled={sending}>
                  <CheckCircle2 size={16} /> {viewing === 'author' ? 'Resolveu, pode fechar' : 'Encerrar'}
                </Button>
                <Button onClick={send} disabled={sending || !body.trim()}>
                  <Send size={16} /> {sending ? 'Enviando…' : 'Enviar'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}

function MessageBlock({ message, author, mine }: { message: SupportMessage; author: string; mine: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-fg">{mine ? 'Você' : author}</p>
        <p className="text-xs text-fg-subtle">{formatDateTime(message.createdAt)}</p>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{message.body}</p>
      {message.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {message.attachments.map(path => <AttachmentLink key={path} path={path} />)}
        </div>
      )}
    </div>
  );
}

/** A URL assinada vale uma hora e só é pedida quando a mensagem aparece na
 *  tela — anexo de chamado não precisa de link permanente circulando. */
function AttachmentLink({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    attachmentUrl(path).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [path]);

  if (!url) {
    return <span className="inline-flex items-center gap-1.5 rounded-control border border-edge px-2.5 py-1.5 text-xs text-fg-subtle"><Paperclip size={13} /> Carregando anexo…</span>;
  }
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-control border border-edge px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
    >
      <Paperclip size={13} /> Ver imagem
    </a>
  );
}

export function AttachmentPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-control border border-edge px-3 py-2 text-xs text-fg-muted transition-colors hover:text-fg">
        <Paperclip size={14} />
        {files.length > 0 ? `${files.length} de ${MAX_ATTACHMENTS}` : 'Anexar print'}
        <input
          type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
          onChange={e => onChange(Array.from(e.target.files ?? []).slice(0, MAX_ATTACHMENTS))}
        />
      </label>
      {files.map(file => (
        <span key={file.name} className="max-w-[12rem] truncate text-xs text-fg-subtle" title={file.name}>{file.name}</span>
      ))}
      {files.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="text-xs text-fg-subtle underline hover:text-fg">
          limpar
        </button>
      )}
    </div>
  );
}

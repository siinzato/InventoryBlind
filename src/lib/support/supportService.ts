// Acesso ao suporte. Leitura por SELECT (a RLS da migration 119 decide o que
// aparece — a tela não filtra por empresa nem por canal, e não deve mesmo:
// filtro de tela é conveniência, policy é garantia). Escrita só por RPC.

import { supabase } from '../supabase';
import type {
  SupportCategory, SupportChannel, SupportPriority, SupportStatus, TicketContext,
} from './supportDomain';
import { attachmentPath, rejectionForFile } from './supportDomain';

const BUCKET = 'support-attachments';

export interface SupportTicket {
  id: string;
  companyId: string;
  channel: SupportChannel;
  createdBy: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  context: Partial<TicketContext>;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  attachments: string[];
  createdAt: string;
}

interface TicketRow {
  id: string; company_id: string; channel: string; created_by: string; subject: string;
  category: string; priority: string; status: string; context: unknown;
  created_at: string; updated_at: string; first_response_at: string | null;
  resolved_at: string | null; resolved_by: string | null;
}

interface MessageRow {
  id: string; ticket_id: string; author_id: string; body: string;
  attachments: string[] | null; created_at: string;
}

function ticketFromRow(r: TicketRow): SupportTicket {
  return {
    id: r.id, companyId: r.company_id, channel: r.channel as SupportChannel,
    createdBy: r.created_by, subject: r.subject, category: r.category as SupportCategory,
    priority: r.priority as SupportPriority, status: r.status as SupportStatus,
    context: (r.context ?? {}) as Partial<TicketContext>,
    createdAt: r.created_at, updatedAt: r.updated_at, firstResponseAt: r.first_response_at,
    resolvedAt: r.resolved_at, resolvedBy: r.resolved_by,
  };
}

function messageFromRow(r: MessageRow): SupportMessage {
  return {
    id: r.id, ticketId: r.ticket_id, authorId: r.author_id, body: r.body,
    attachments: r.attachments ?? [], createdAt: r.created_at,
  };
}

const TICKET_COLUMNS =
  'id, company_id, channel, created_by, subject, category, priority, status, context, created_at, updated_at, first_response_at, resolved_at, resolved_by';

/** Os chamados que ESTE usuário abriu. */
export async function listMyTickets(userId: string): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets').select(TICKET_COLUMNS)
    .eq('created_by', userId).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(ticketFromRow);
}

/** Tudo que este usuário pode responder. Sem filtro de empresa de propósito: a
 *  policy já recortou, e repetir o recorte aqui esconderia um furo em vez de
 *  denunciá-lo. */
export async function listInboxTickets(channel: SupportChannel): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from('support_tickets').select(TICKET_COLUMNS)
    .eq('channel', channel).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(ticketFromRow);
}

export async function listMessages(ticketId: string): Promise<SupportMessage[]> {
  const { data, error } = await supabase
    .from('support_ticket_messages')
    .select('id, ticket_id, author_id, body, attachments, created_at')
    .eq('ticket_id', ticketId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(messageFromRow);
}

/** `true` quando o usuário está na lista de staff do InventoryBlind. A tabela
 *  só devolve a própria linha, então isto responde por ele e por mais ninguém. */
export async function amISupportStaff(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('support_staff').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) { console.error('[Support] amISupportStaff', error.message); return false; }
  return !!data;
}

export async function fetchUserNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('profiles').select('id, name, email').in('id', unique);
  if (error) { console.error('[Support] fetchUserNames', error.message); return new Map(); }
  return new Map((data ?? []).map(p => [p.id, p.name || p.email || '—']));
}

export async function fetchCompanyNames(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('companies').select('id, name').in('id', unique);
  if (error) { console.error('[Support] fetchCompanyNames', error.message); return new Map(); }
  return new Map((data ?? []).map(c => [c.id, c.name]));
}

/** Sobe os anexos e devolve os caminhos aceitos. Arquivo recusado não derruba o
 *  chamado — devolve o motivo para a tela dizer qual caiu e por quê, em vez de
 *  sumir em silêncio. */
export async function uploadAttachments(
  companyId: string, files: File[], nowMs: number,
): Promise<{ paths: string[]; rejected: { name: string; reason: string }[] }> {
  const paths: string[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const [index, file] of files.entries()) {
    const reason = rejectionForFile(file);
    if (reason) { rejected.push({ name: file.name, reason }); continue; }

    const path = attachmentPath(companyId, file.name, nowMs, index);
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (error) {
      console.error('[Support] uploadAttachments', error.message);
      rejected.push({ name: file.name, reason: 'Falha ao enviar.' });
      continue;
    }
    paths.push(path);
  }

  return { paths, rejected };
}

export async function attachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) { console.error('[Support] attachmentUrl', error.message); return null; }
  return data.signedUrl;
}

export async function openTicket(params: {
  channel: SupportChannel;
  category: SupportCategory;
  subject: string;
  body: string;
  priority: SupportPriority;
  context: TicketContext;
  attachments: string[];
}): Promise<SupportTicket> {
  const { data, error } = await supabase.rpc('support_ticket_open', {
    p_channel: params.channel,
    p_category: params.category,
    p_subject: params.subject,
    p_body: params.body,
    p_priority: params.priority,
    p_context: params.context,
    p_attachments: params.attachments,
  });
  if (error) throw error;
  return ticketFromRow(data as TicketRow);
}

export async function replyToTicket(
  ticketId: string, body: string, attachments: string[] = [],
): Promise<SupportMessage> {
  const { data, error } = await supabase.rpc('support_ticket_reply', {
    p_ticket_id: ticketId, p_body: body, p_attachments: attachments,
  });
  if (error) throw error;
  return messageFromRow(data as MessageRow);
}

/** Só 'resolvido' e 'em_analise' — 'aberto' e 'respondido' são consequência de
 *  uma ação, e o banco recusa defini-los direto. */
export async function setTicketStatus(
  ticketId: string, status: 'resolvido' | 'em_analise',
): Promise<SupportTicket> {
  const { data, error } = await supabase.rpc('support_ticket_set_status', {
    p_ticket_id: ticketId, p_status: status,
  });
  if (error) throw error;
  return ticketFromRow(data as TicketRow);
}

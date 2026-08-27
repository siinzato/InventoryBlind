import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Monitor, Smartphone, Tablet, ShieldAlert, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { getRoleLabel } from '../../lib/permissionService';
import type { Role } from '../../lib/permissionService';
import {
  listCompanySessions, revokeSession, revokeUserSessions, revokeCompanySessions,
  resolveSessionLocations, COMPANY_REVOKE_CONFIRMATION,
  type CompanySessionRow, type SessionRoleFilter, type SessionStatusFilter, type SessionLocation,
} from '../../lib/security/sessionManagementService';
import { parseUserAgent } from '../../lib/security/userAgentParser';
import { evaluateSuspiciousSessions } from '../../lib/security/suspiciousSessionHeuristic';
import {
  Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Modal, Input, Select, Textarea, Notice,
  Stat, StatRow, StatCell, useToasts, ToastStack,
} from '../ui';

const PAGE_SIZE = 20;
const ROLE_OPTIONS: Role[] = ['owner', 'admin', 'manager', 'lead', 'counter', 'viewer'];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function DeviceIcon({ deviceType }: { deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown' }) {
  if (deviceType === 'mobile') return <Smartphone size={14} className="text-fg-subtle flex-shrink-0" />;
  if (deviceType === 'tablet') return <Tablet size={14} className="text-fg-subtle flex-shrink-0" />;
  return <Monitor size={14} className="text-fg-subtle flex-shrink-0" />;
}

type RevokeTarget =
  | { kind: 'session'; sessionId: string; label: string }
  | { kind: 'user'; userId: string; label: string }
  | { kind: 'company' };

/** Painel administrativo completo de sessões (Central de Segurança → Sessões),
 *  restrito a owner/admin. Toda a validação de permissão, isolamento por
 *  empresa e a regra de usuário multiempresa vive nas RPCs (migration 093) —
 *  este componente só reflete o que elas permitem; esconder um botão aqui é
 *  conveniência de UI, nunca a garantia de segurança. Não recebe companyId
 *  por prop: as RPCs resolvem a empresa ativa a partir do JWT do operador,
 *  então passar um valor do client seria só decoração sem efeito real. */
export function AdminSessionsPanel() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';
  const { toasts, toast } = useToasts();

  const [sessions, setSessions] = useState<CompanySessionRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<SessionRoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<SessionStatusFilter>('all');
  const [page, setPage] = useState(0);

  const [geo, setGeo] = useState<Record<string, SessionLocation>>({});

  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [companyConfirmText, setCompanyConfirmText] = useState('');
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listCompanySessions({
        search, role: roleFilter, status: statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
      });
      setSessions(result.sessions);
      setTotalCount(result.totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as sessões.');
      setSessions([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  // Geolocalização resolvida depois da lista, sempre em segundo plano — uma
  // falha aqui (rede, provedor fora do ar) nunca deve impedir a listagem, que
  // já terminou de carregar antes desta chamada começar.
  useEffect(() => {
    if (sessions.length === 0) { setGeo({}); return; }
    let cancelled = false;
    resolveSessionLocations(sessions.map(s => s.sessionId)).then(result => {
      if (!cancelled) setGeo(result);
    });
    return () => { cancelled = true; };
  }, [sessions]);

  const suspicion = useMemo(() => {
    const now = Date.now();
    const inputs = sessions.map(s => ({
      sessionId: s.sessionId,
      userId: s.userId,
      lastActivityMs: new Date(s.refreshedAt ?? s.createdAt).getTime(),
      countryCode: geo[s.sessionId]?.countryCode ?? null,
    }));
    return new Map(evaluateSuspiciousSessions(inputs, now).map(r => [r.sessionId, r]));
  }, [sessions, geo]);

  const connectedUsers = useMemo(() => new Set(sessions.map(s => s.userId)).size, [sessions]);
  const attentionCount = useMemo(() => [...suspicion.values()].filter(r => r.suspicious).length, [suspicion]);

  function runSearch() {
    setPage(0);
    setSearch(searchInput.trim());
  }

  function openRevokeModal(target: RevokeTarget) {
    setRevokeReason('');
    setCompanyConfirmText('');
    setRevokeTarget(target);
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    if (revokeTarget.kind === 'company' && companyConfirmText !== COMPANY_REVOKE_CONFIRMATION) return;

    setRevoking(true);
    try {
      if (revokeTarget.kind === 'session') {
        await revokeSession(revokeTarget.sessionId, revokeReason);
        toast('Sessão encerrada.', 'success');
      } else if (revokeTarget.kind === 'user') {
        const n = await revokeUserSessions(revokeTarget.userId, revokeReason);
        toast(n > 0 ? `${n} sessão(ões) de ${revokeTarget.label} encerrada(s).` : 'Nenhuma outra sessão para encerrar.', 'success');
      } else {
        const result = await revokeCompanySessions(companyConfirmText, revokeReason);
        toast(
          result.skippedCount > 0
            ? `${result.revokedCount} sessão(ões) encerrada(s). ${result.skippedCount} usuário(s) multiempresa ignorado(s).`
            : `${result.revokedCount} sessão(ões) encerrada(s).`,
          'success',
        );
      }
      setRevokeTarget(null);
      setRevokeReason('');
      setCompanyConfirmText('');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível concluir esta ação.', 'error');
    } finally {
      setRevoking(false);
    }
  }

  const hasNextPage = (page + 1) * PAGE_SIZE < totalCount;

  return (
    <div className="space-y-4">
      <ToastStack toasts={toasts} />

      <Panel>
        <PanelSection padding="md">
          <StatRow>
            <StatCell><Stat label="Sessões" value={totalCount} context="Nesta empresa" /></StatCell>
            <StatCell><Stat label="Usuários conectados" value={connectedUsers} context="Na página atual" /></StatCell>
            <StatCell>
              <Stat
                label="Exigem atenção"
                value={attentionCount}
                valueTone={attentionCount > 0 ? 'warning' : 'default'}
                context="Na página atual"
              />
            </StatCell>
          </StatRow>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md" className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <Input
              icon={<Search size={15} />}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
              placeholder="Nome, e-mail, IP, dispositivo ou navegador..."
            />
          </div>
          <Select value={roleFilter} onChange={e => { setPage(0); setRoleFilter(e.target.value as SessionRoleFilter); }}>
            <option value="all">Todas as funções</option>
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
          </Select>
          <Select value={statusFilter} onChange={e => { setPage(0); setStatusFilter(e.target.value as SessionStatusFilter); }}>
            <option value="all">Todas as situações</option>
            <option value="current">Sessão atual</option>
            <option value="active">Ativa</option>
            <option value="expired">Expirada</option>
          </Select>
          <Button variant="secondary" size="sm" onClick={runSearch}>Buscar</Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
          </Button>
          {isOwner && (
            <Button variant="danger" size="sm" onClick={() => openRevokeModal({ kind: 'company' })}>
              Encerrar todas as sessões da empresa
            </Button>
          )}
        </PanelSection>

        {error && (
          <PanelSection padding="sm">
            <Notice tone="danger">{error}</Notice>
          </PanelSection>
        )}

        <div className="border-t border-edge overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Usuário</Th>
                <Th>Dispositivo</Th>
                <Th>IP / Localização</Th>
                <Th>Início</Th>
                <Th>Última atividade</Th>
                <Th>Expiração</Th>
                <Th>Situação</Th>
                <Th>Ações</Th>
              </Tr>
            </Thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <Td key={j}><div className="h-3 bg-surface-3 rounded animate-pulse" /></Td>
                    ))}
                  </Tr>
                ))
              ) : sessions.length === 0 ? (
                <Tr><Td colSpan={8} className="text-center py-10 text-fg-subtle text-sm">
                  {search || roleFilter !== 'all' || statusFilter !== 'all'
                    ? 'Nenhuma sessão encontrada para este filtro.'
                    : 'Nenhuma sessão ativa no momento.'}
                </Td></Tr>
              ) : (
                sessions.map(s => {
                  const ua = parseUserAgent(s.userAgent);
                  const location = geo[s.sessionId];
                  const suspect = suspicion.get(s.sessionId);
                  const disableIndividualActions = s.isCurrent || s.isMultiCompany;
                  const disabledReason = s.isCurrent
                    ? 'Esta é a sessão atual — não pode ser encerrada por aqui.'
                    : s.isMultiCompany
                    ? 'Usuário vinculado a mais de uma empresa — revogação administrativa desabilitada.'
                    : undefined;

                  return (
                    <Tr key={s.sessionId}>
                      <Td>
                        <p className="text-sm font-medium text-fg">{s.userName ?? '—'}</p>
                        <p className="text-xs text-fg-subtle">{s.userEmail ?? '—'}</p>
                        {s.userRole && <p className="text-xs text-fg-subtle">{getRoleLabel(s.userRole as Role)}</p>}
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                          <DeviceIcon deviceType={ua.deviceType} />
                          {ua.browser} · {ua.os}
                        </span>
                      </Td>
                      <Td>
                        <p className="text-xs font-mono text-fg-muted">{s.ipAddress ?? '—'}</p>
                        <p className="text-xs text-fg-subtle">
                          {location?.available
                            ? `${[location.city, location.region, location.country].filter(Boolean).join(', ')} (aproximado)`
                            : location
                            ? 'Localização indisponível'
                            : 'Resolvendo localização...'}
                        </p>
                      </Td>
                      <Td className="text-xs text-fg-subtle whitespace-nowrap">{formatDateTime(s.createdAt)}</Td>
                      <Td className="text-xs text-fg-subtle whitespace-nowrap">{formatDateTime(s.refreshedAt)}</Td>
                      <Td className="text-xs text-fg-subtle whitespace-nowrap">{formatDateTime(s.notAfter)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          {s.isCurrent && <Badge variant="neutral">Atual</Badge>}
                          {suspect?.suspicious && (
                            <span title={suspect.reason ?? undefined}>
                              <Badge variant="warning"><ShieldAlert size={12} /> Possivelmente suspeita</Badge>
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1.5" title={disabledReason}>
                          <Button
                            variant="danger" size="sm"
                            disabled={disableIndividualActions}
                            onClick={() => openRevokeModal({ kind: 'session', sessionId: s.sessionId, label: s.userEmail ?? s.userName ?? 'sessão' })}
                          >
                            Encerrar sessão
                          </Button>
                          <Button
                            variant="secondary" size="sm"
                            disabled={s.isMultiCompany}
                            onClick={() => openRevokeModal({ kind: 'user', userId: s.userId, label: s.userName ?? s.userEmail ?? 'usuário' })}
                          >
                            Encerrar todas de {s.userName ?? 'usuário'}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </div>

        <PanelSection padding="sm" className="flex items-center justify-between">
          <span className="text-fg-subtle text-xs">
            {totalCount > 0 ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount)} de ${totalCount}` : 'Página 1'}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <Button variant="secondary" size="sm" disabled={!hasNextPage} onClick={() => setPage(p => p + 1)}>Próxima</Button>
          </div>
        </PanelSection>
      </Panel>

      <Modal
        open={!!revokeTarget}
        onClose={() => (revoking ? null : setRevokeTarget(null))}
        title={
          revokeTarget?.kind === 'company'
            ? 'Encerrar todas as sessões da empresa'
            : revokeTarget?.kind === 'user'
            ? `Encerrar todas as sessões de ${revokeTarget.label}`
            : 'Encerrar sessão'
        }
      >
        {revokeTarget && (
          <div className="space-y-4">
            {revokeTarget.kind === 'company' && (
              <Notice tone="danger">
                Esta ação encerra as sessões de todos os usuários desta empresa vinculados a uma única
                empresa, exceto a sua sessão atual. Usuários vinculados a mais de uma empresa são
                automaticamente ignorados.
              </Notice>
            )}

            <Notice tone="neutral">
              Encerrar aqui impede a renovação de tokens dessa sessão, mas um acesso já emitido pode
              continuar válido até expirar por conta própria.
            </Notice>

            <div>
              <label className="text-label block mb-1.5">Motivo (opcional)</label>
              <Textarea rows={2} value={revokeReason} onChange={e => setRevokeReason(e.target.value)} placeholder="Ex.: dispositivo perdido, saída da empresa..." />
            </div>

            {revokeTarget.kind === 'company' && (
              <div>
                <label className="text-label block mb-1.5">
                  Digite <span className="font-semibold text-fg">{COMPANY_REVOKE_CONFIRMATION}</span> para confirmar
                </label>
                <Input value={companyConfirmText} onChange={e => setCompanyConfirmText(e.target.value)} />
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setRevokeTarget(null)} disabled={revoking}>
                Cancelar
              </Button>
              <Button
                variant="danger" className="flex-1"
                disabled={revoking || (revokeTarget.kind === 'company' && companyConfirmText !== COMPANY_REVOKE_CONFIRMATION)}
                onClick={confirmRevoke}
              >
                {revoking ? 'Encerrando...' : <><AlertTriangle size={14} /> Confirmar</>}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default AdminSessionsPanel;

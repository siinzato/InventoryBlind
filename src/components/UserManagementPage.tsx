/**
 * UserManagementPage — Gestão de usuários da empresa
 * Disponível para roles: owner, admin
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Users, Plus, Trash2, Edit2, RefreshCw,
  X, Check, AlertCircle, Shield, ShieldCheck, Eye, ClipboardCheck,
  User, Mail, Search, Copy, Ticket,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Profile } from '../lib/auth';
import { Modal, Panel, PanelSection, Badge, Button, Table, Thead, Tr, Th, Td } from './ui';

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = 'owner' | 'admin' | 'manager' | 'counter' | 'viewer';
type RoleBadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

// badgeVariant segue a mesma regra de permissionService.getRoleBadgeColor:
// papel é metadado neutro, não uma condição que precisa de atenção — só os
// dois papéis privilegiados (owner/admin) ganham o tom de destaque (accent),
// nunca uma cor por variedade (§5/§18). "warning" (âmbar) já foi usado aqui
// para "Proprietário", o que sinalizava atenção sem motivo real — corrigido.
const ROLE_CONFIG: Record<Role, { label: string; badgeVariant: RoleBadgeVariant; icon: React.ReactNode; desc: string }> = {
  owner:   { label: 'Proprietário',  badgeVariant: 'accent',  icon: <Shield size={12} />,      desc: 'Acesso total, gerencia empresa e usuários.' },
  admin:   { label: 'Administrador', badgeVariant: 'accent',  icon: <ShieldCheck size={12} />, desc: 'Acesso total, exceto configurações críticas da empresa.' },
  manager: { label: 'Gerente',       badgeVariant: 'neutral', icon: <User size={12} />,         desc: 'Visualiza e opera todos os módulos.' },
  counter: { label: 'Conferente',    badgeVariant: 'neutral', icon: <ClipboardCheck size={12} />, desc: 'Realiza contagens e operações de picking.' },
  viewer:  { label: 'Visualizador',  badgeVariant: 'neutral', icon: <Eye size={12} />,          desc: 'Somente leitura — não pode criar ou editar dados.' },
};

// ── Invite Modal ──────────────────────────────────────────────────────────────

const InviteModal: React.FC<{ onClose: () => void; onInvited: () => void }> = ({ onClose, onInvited }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('counter');
  const [tempPw, setTempPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleInvite = async () => {
    if (!email.trim() || !name.trim() || !tempPw) { setError('Preencha todos os campos.'); return; }
    if (tempPw.length < 6) { setError('Senha temporária deve ter ao menos 6 caracteres.'); return; }
    setError(''); setLoading(true);

    try {
      // Cria o convite pendente ANTES de criar a conta — assim ele existe mesmo que o signUp
      // falhe ou demore, e é a própria RPC accept_pending_invitations() (chamada automaticamente
      // no próximo login, ver auth.tsx) que vincula a empresa. company_id/role não vão mais no
      // metadata do signUp: desde a migration 015 (fix_privilege_escalation) esses metadados são
      // ignorados por design pelo handle_new_user() — confiar neles era exatamente a causa do
      // funcionário convidado cair no onboarding de criar empresa nova.
      const { error: inviteErr } = await supabase.rpc('create_company_invitation', {
        p_email: email.trim(),
        p_role: role,
        p_name: name.trim(),
      });
      if (inviteErr) throw inviteErr;

      const { data, error: signupErr } = await supabase.auth.signUp({
        email: email.trim(),
        password: tempPw,
        options: {
          data: { name: name.trim() },
        },
      });

      if (signupErr) throw signupErr;
      if (!data.user) throw new Error('Usuário não criado.');

      setSuccess(`Usuário ${name.trim()} convidado com sucesso! Senha temporária: ${tempPw}`);
      setTimeout(() => { onInvited(); onClose(); }, 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao convidar usuário.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Convidar Usuário" maxWidth="max-w-md">
      {success ? (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-600 dark:text-emerald-400 flex items-start gap-2">
          <Check size={15} className="flex-shrink-0 mt-0.5" />{success}
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />{error}
            </div>
          )}
          {[
            { label: 'Nome', value: name, onChange: setName, placeholder: 'Nome do colaborador' },
            { label: 'E-mail', value: email, onChange: setEmail, placeholder: 'email@empresa.com', type: 'email' },
            { label: 'Senha Temporária', value: tempPw, onChange: setTempPw, placeholder: 'Mínimo 6 caracteres', type: 'password' },
          ].map(f => (
            <div key={f.label}>
              <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">{f.label}</label>
              <input type={f.type || 'text'} value={f.value} onChange={e => f.onChange(e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-4 py-2.5 bg-surface-3 border border-edge rounded-xl text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-fg-subtle" />
            </div>
          ))}
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Perfil</label>
            <select value={role} onChange={e => setRole(e.target.value as Role)}
              className="w-full px-4 py-2.5 bg-surface-3 border border-edge rounded-xl text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40">
              {(Object.entries(ROLE_CONFIG) as [Role, typeof ROLE_CONFIG[Role]][])
                .filter(([k]) => k !== 'owner')
                .map(([k, v]) => (
                  <option key={k} value={k}>{v.label} — {v.desc}</option>
                ))}
            </select>
          </div>
        </div>
      )}

      {!success && (
        <div className="flex gap-2 mt-5 justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleInvite} disabled={loading}>
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
            Convidar
          </Button>
        </div>
      )}
    </Modal>
  );
};

// ── Invite Code Modal ────────────────────────────────────────────────────────

/** Código de convite da empresa (migration 082) — alternativa ao convite por e-mail: qualquer
 *  pessoa com o código se cadastra sozinha em InventoryBlind e já entra vinculada a esta empresa.
 *  Muda todo dia (get_or_create_daily_invite_code reaproveita o de hoje se já existir), então um
 *  vazamento só vale por algumas horas. */
const InviteCodeModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_or_create_daily_invite_code');
      if (cancelled) return;
      if (rpcErr) {
        setError(rpcErr.message || 'Erro ao gerar código de convite.');
      } else {
        setCode(data?.code ?? null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível (ex.: contexto não seguro) — o código já está visível na tela para
      // copiar manualmente, então não há necessidade de mostrar erro aqui.
    }
  };

  return (
    <Modal open onClose={onClose} title="Código de Convite da Empresa" maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Peça para a pessoa criar uma conta em InventoryBlind e escolher "Tenho um código de convite"
          na tela de cadastro, informando o código abaixo. Ela entra automaticamente nesta empresa,
          com perfil de Visualizador — você pode alterar o perfil dela depois aqui na lista.
        </p>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />{error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-fg-subtle">
            <RefreshCw size={16} className="animate-spin" /> Gerando código...
          </div>
        ) : code ? (
          <>
            <div className="bg-surface-3 border border-edge rounded-xl p-5 text-center">
              <p className="font-mono text-2xl font-bold tracking-[0.3em] text-fg">{code}</p>
            </div>
            <Button variant="secondary" onClick={copy} className="w-full">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copiado!' : 'Copiar código'}
            </Button>
            <p className="text-xs text-fg-subtle text-center">
              Válido só hoje — um novo código é gerado automaticamente amanhã.
            </p>
          </>
        ) : null}
      </div>
    </Modal>
  );
};

// ── Role badge ────────────────────────────────────────────────────────────────

const RoleBadge: React.FC<{ role: Role }> = ({ role }) => {
  const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.viewer;
  return (
    <Badge variant={cfg.badgeVariant} className="font-semibold">
      {cfg.icon}{cfg.label}
    </Badge>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

interface UserManagementPageProps {
  onBack: () => void;
}

const UserManagementPage: React.FC<UserManagementPageProps> = ({ onBack }) => {
  const { profile, company } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [showInviteCode, setShowInviteCode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>('counter');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, name, email, company_id, role, must_change_password, created_at, updated_at')
      .eq('company_id', company.id)
      .order('created_at');
    setUsers((data as Profile[]) || []);
    setLoading(false);
  }, [company?.id]);

  useEffect(() => { load(); }, [load]);

  const saveRole = async (userId: string) => {
    setSaving(true);
    const { error } = await supabase.rpc('update_member_role', {
      target_user_id: userId,
      new_role: editRole,
    });
    if (error) {
      setSaving(false);
      showToast(error.message || 'Erro ao atualizar perfil.');
      return;
    }
    setUsers(p => p.map(u => u.id === userId ? { ...u, role: editRole } : u));
    setEditingId(null);
    setSaving(false);
    showToast('Perfil atualizado.');
  };

  const removeUser = async (u: Profile) => {
    if (u.id === profile?.id) { showToast('Você não pode se remover.'); return; }
    if (u.role === 'owner') { showToast('Não é possível remover o proprietário.'); return; }
    if (!window.confirm(`Remover ${u.name || u.email} da empresa?`)) return;
    const { error } = await supabase.from('profiles').delete().eq('id', u.id);
    if (error) { showToast(error.message || 'Erro ao remover usuário.'); return; }
    setUsers(p => p.filter(x => x.id !== u.id));
    showToast('Usuário removido.');
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
  });

  const canManage = profile?.role === 'owner' || profile?.role === 'admin';

  return (
    <div className="min-h-screen bg-surface">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[9999] bg-surface-2 border border-edge text-fg px-4 py-3 rounded-container text-sm font-semibold shadow-panel">
          {toast}
        </div>
      )}

      {showInvite && company && (
        <InviteModal onClose={() => setShowInvite(false)} onInvited={load} />
      )}

      {showInviteCode && company && (
        <InviteCodeModal onClose={() => setShowInviteCode(false)} />
      )}

      {/* Header */}
      <div className="sticky top-0 z-50 bg-surface/95 backdrop-blur border-b border-edge">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft size={15} />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <Users size={18} className="text-emerald-600 dark:text-emerald-400" />
                <h1 className="font-bold text-fg text-base">Usuários</h1>
              </div>
              <p className="text-xs text-fg-subtle">{company?.name} · {users.length} membro(s)</p>
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setShowInviteCode(true)}>
                <Ticket size={15} /> Código de Convite
              </Button>
              <Button onClick={() => setShowInvite(true)}>
                <Plus size={15} /> Convidar
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Role legend */}
        <Panel>
          <PanelSection padding="md">
            <h3 className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-3">Perfis de Acesso</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {(Object.entries(ROLE_CONFIG) as [Role, typeof ROLE_CONFIG[Role]][]).map(([k, v]) => (
                <div key={k}>
                  <Badge variant={v.badgeVariant} className="mb-1.5 font-semibold">{v.icon}{v.label}</Badge>
                  <p className="text-xs text-fg-subtle leading-snug">{v.desc}</p>
                </div>
              ))}
            </div>
          </PanelSection>
        </Panel>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou e-mail..."
            className="w-full pl-9 pr-4 py-2.5 bg-surface-2 border border-edge rounded-xl text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-fg-subtle" />
        </div>

        {/* Users list */}
        <Panel>
          {loading ? (
            <PanelSection padding="lg" className="flex items-center justify-center gap-2 text-fg-subtle">
              <RefreshCw size={18} className="animate-spin" /> Carregando...
            </PanelSection>
          ) : filtered.length === 0 ? (
            <PanelSection padding="lg" className="flex flex-col items-center justify-center text-fg-subtle">
              <Users size={36} className="mb-2 opacity-30" />
              <p className="text-sm">Nenhum usuário encontrado.</p>
            </PanelSection>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Usuário</Th>
                    <Th>Perfil</Th>
                    <Th>Status</Th>
                    {canManage && <Th>Ações</Th>}
                  </Tr>
                </Thead>
                <tbody>
                  {filtered.map(u => (
                    <Tr key={u.id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-surface-3 border border-edge flex items-center justify-center flex-shrink-0 font-bold text-fg-muted text-sm">
                            {(u.name || u.email || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-fg text-sm">{u.name || '—'}</p>
                            <p className="text-xs text-fg-subtle flex items-center gap-1"><Mail size={10} />{u.email || '—'}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {editingId === u.id ? (
                          <select value={editRole} onChange={e => setEditRole(e.target.value as Role)}
                            className="text-xs bg-surface-3 border border-edge rounded-lg px-2 py-1.5 text-fg focus:outline-none">
                            {(Object.keys(ROLE_CONFIG) as Role[]).filter(k => k !== 'owner' || u.role === 'owner').map(k => (
                              <option key={k} value={k}>{ROLE_CONFIG[k].label}</option>
                            ))}
                          </select>
                        ) : (
                          <RoleBadge role={u.role as Role} />
                        )}
                      </Td>
                      <Td>
                        {u.must_change_password ? (
                          <Badge variant="warning">Deve alterar senha</Badge>
                        ) : u.id === profile?.id ? (
                          <Badge variant="accent">Você</Badge>
                        ) : (
                          <Badge variant="neutral">Ativo</Badge>
                        )}
                      </Td>
                      {canManage && (
                        <Td>
                          <div className="flex items-center gap-1">
                            {editingId === u.id ? (
                              <>
                                <button onClick={() => saveRole(u.id)} disabled={saving}
                                  className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition">
                                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                                </button>
                                <button onClick={() => setEditingId(null)}
                                  className="p-1.5 text-fg-subtle hover:bg-surface-3 rounded-lg transition">
                                  <X size={14} />
                                </button>
                              </>
                            ) : (
                              <>
                                {u.role !== 'owner' && u.id !== profile?.id && (
                                  <button onClick={() => { setEditingId(u.id); setEditRole(u.role as Role); }}
                                    className="p-1.5 text-fg-subtle hover:text-accent hover:bg-accent/10 rounded-lg transition" title="Alterar perfil">
                                    <Edit2 size={14} />
                                  </button>
                                )}
                                {u.role !== 'owner' && u.id !== profile?.id && (
                                  <button onClick={() => removeUser(u)}
                                    className="p-1.5 text-fg-subtle hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 rounded-lg transition" title="Remover da empresa">
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

export default UserManagementPage;

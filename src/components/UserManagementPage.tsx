/**
 * UserManagementPage — Gestão de usuários da empresa
 * Disponível para roles: owner, admin
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Users, Plus, Trash2, Edit2, RefreshCw,
  X, Check, AlertCircle, Shield, Eye, ClipboardCheck,
  Package, User, Mail, ChevronDown, Search,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Profile } from '../lib/auth';

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = 'owner' | 'admin' | 'manager' | 'counter' | 'viewer';

const ROLE_CONFIG: Record<Role, { label: string; color: string; icon: React.ReactNode; desc: string }> = {
  owner:   { label: 'Proprietário',  color: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20', icon: <Shield size={12} />,        desc: 'Acesso total, gerencia empresa e usuários.' },
  admin:   { label: 'Administrador', color: 'bg-accent/10 text-accent border-accent/20',       icon: <ShieldCheckIcon size={12} />, desc: 'Acesso total, exceto configurações críticas da empresa.' },
  manager: { label: 'Gerente',       color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20', icon: <User size={12} />,       desc: 'Visualiza e opera todos os módulos.' },
  counter: { label: 'Conferente',    color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',     icon: <ClipboardCheck size={12} />, desc: 'Realiza contagens e operações de picking.' },
  viewer:  { label: 'Visualizador',  color: 'bg-surface-3 text-fg-muted border-edge',         icon: <Eye size={12} />,            desc: 'Somente leitura — não pode criar ou editar dados.' },
};

// Inline icon helper (lucide doesn't export ShieldCheck as a name we can use as value)
function ShieldCheckIcon({ size }: { size: number }) {
  return <Check size={size} />;
}

// ── Invite Modal ──────────────────────────────────────────────────────────────

const InviteModal: React.FC<{ companyId: string; onClose: () => void; onInvited: () => void }> = ({ companyId, onClose, onInvited }) => {
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
      // Sign up the new user with company_id in metadata
      const { data, error: signupErr } = await supabase.auth.signUp({
        email: email.trim(),
        password: tempPw,
        options: {
          data: {
            name: name.trim(),
            company_id: companyId,
            role,
          },
        },
      });

      if (signupErr) throw signupErr;
      if (!data.user) throw new Error('Usuário não criado.');

      // Mark profile as must_change_password
      await supabase.from('profiles').update({ must_change_password: true }).eq('id', data.user.id);

      setSuccess(`Usuário ${name.trim()} convidado com sucesso! Senha temporária: ${tempPw}`);
      setTimeout(() => { onInvited(); onClose(); }, 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao convidar usuário.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-surface-2 border border-edge rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-fg text-lg">Convidar Usuário</h3>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg-muted transition"><X size={18} /></button>
        </div>

        {success ? (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-600 dark:text-emerald-400 flex items-start gap-2">
            <Check size={15} className="flex-shrink-0 mt-0.5" />{success}
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-start gap-2">
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
            <button onClick={onClose} className="px-4 py-2 bg-surface-3 hover:bg-edge text-fg-muted rounded-xl text-sm font-semibold transition">
              Cancelar
            </button>
            <button onClick={handleInvite} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-sm font-bold transition disabled:opacity-60">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              Convidar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Role badge ────────────────────────────────────────────────────────────────

const RoleBadge: React.FC<{ role: Role }> = ({ role }) => {
  const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.viewer;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
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
        <div className="fixed bottom-6 right-6 z-[9999] bg-surface-3 border border-edge text-fg px-4 py-3 rounded-xl text-sm font-semibold shadow-xl">
          {toast}
        </div>
      )}

      {showInvite && company && (
        <InviteModal companyId={company.id} onClose={() => setShowInvite(false)} onInvited={load} />
      )}

      {/* Header */}
      <div className="sticky top-0 z-50 bg-surface/95 backdrop-blur border-b border-edge">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-edge text-fg-subtle hover:text-fg rounded-xl text-sm transition">
              <ArrowLeft size={15} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <Users size={18} className="text-emerald-600 dark:text-emerald-400" />
                <h1 className="font-bold text-fg text-base">Usuários</h1>
              </div>
              <p className="text-xs text-fg-subtle">{company?.name} · {users.length} membro(s)</p>
            </div>
          </div>
          {canManage && (
            <button onClick={() => setShowInvite(true)}
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-sm font-bold transition">
              <Plus size={15} /> Convidar
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Role legend */}
        <div className="bg-surface-2 border border-edge rounded-2xl p-5">
          <h3 className="text-xs font-bold text-fg-subtle uppercase mb-3">Perfis de Acesso</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {(Object.entries(ROLE_CONFIG) as [Role, typeof ROLE_CONFIG[Role]][]).map(([k, v]) => (
              <div key={k} className={`px-2.5 py-2 rounded-xl border text-xs ${v.color}`}>
                <div className="font-bold mb-0.5 flex items-center gap-1">{v.icon}{v.label}</div>
                <div className="opacity-75 text-[11px] leading-tight">{v.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou e-mail..."
            className="w-full pl-9 pr-4 py-2.5 bg-surface-2 border border-edge rounded-xl text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-fg-subtle" />
        </div>

        {/* Users list */}
        <div className="bg-surface-2 border border-edge rounded-2xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-fg-subtle">
              <RefreshCw size={18} className="animate-spin" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-fg-subtle">
              <Users size={36} className="mb-2 opacity-30" />
              <p className="text-sm">Nenhum usuário encontrado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-3 border-b border-edge">
                <tr>
                  {['Usuário', 'Perfil', 'Status', canManage ? 'Ações' : ''].filter(Boolean).map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-bold text-fg-subtle uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60">
                {filtered.map(u => (
                  <tr key={u.id} className="hover:bg-surface-3/60 transition">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-surface-3 border border-edge flex items-center justify-center flex-shrink-0 font-bold text-fg-muted text-sm">
                          {(u.name || u.email || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-fg text-sm">{u.name || '—'}</p>
                          <p className="text-xs text-fg-subtle flex items-center gap-1"><Mail size={10} />{u.email || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
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
                    </td>
                    <td className="px-5 py-4">
                      {u.must_change_password ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">Deve alterar senha</span>
                      ) : u.id === profile?.id ? (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Você</span>
                      ) : (
                        <span className="text-xs text-fg-subtle">Ativo</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-5 py-4">
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserManagementPage;

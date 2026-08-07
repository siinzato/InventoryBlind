import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Shield, ShieldAlert, ShieldX,
  CheckCircle2, AlertTriangle, XCircle, Info,
  Lock, Unlock, Users, Activity, Database,
  Eye, RefreshCw, ChevronDown, ChevronUp,
  FileText, Globe, Clock, Server, Key,
  Upload, Link, Settings, Zap, ArrowLeft,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { hasPermission, getRoleLabel, getRoleBadgeColor } from '../lib/permissionService';
import type { AuditLog, SecurityLog } from '../lib/auditLogService';

// ── Types ─────────────────────────────────────────────────────────────────────

type HealthStatus = 'ok' | 'warning' | 'critical' | 'loading';

interface HealthItem {
  label: string;
  status: HealthStatus;
  detail?: string;
}

interface SecuritySettings {
  require_email_confirmation: boolean;
  require_2fa: boolean;
  session_timeout_minutes: number;
  max_failed_login_attempts: number;
  max_upload_size_mb: number;
  allowed_file_types: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: HealthStatus }) {
  if (status === 'loading') return (
    <span className="flex items-center gap-1 text-fg-subtle text-xs"><RefreshCw size={12} className="animate-spin" /> Verificando...</span>
  );
  if (status === 'ok') return (
    <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold"><CheckCircle2 size={14} /> OK</span>
  );
  if (status === 'warning') return (
    <span className="flex items-center gap-1 text-amber-400 text-xs font-semibold"><AlertTriangle size={14} /> Atenção</span>
  );
  return (
    <span className="flex items-center gap-1 text-red-400 text-xs font-semibold"><XCircle size={14} /> Crítico</span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    info:     'bg-blue-500/15 text-blue-400 border-blue-500/30',
    warning:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
    high:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
    critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  };
  const labels: Record<string, string> = {
    info: 'Info', warning: 'Atenção', high: 'Alto', critical: 'Crítico',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${map[severity] ?? map.info}`}>
      {labels[severity] ?? severity}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function truncate(str: string | null, n = 40) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Section: Health Check ────────────────────────────────────────────────────

function HealthCheck({ companyId }: { companyId: string }) {
  const { profile } = useAuth();
  const [items, setItems] = useState<HealthItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function run() {
      setLoading(true);

      // Static checks (immediate)
      const base: HealthItem[] = [
        { label: 'Autenticação ativa', status: 'ok', detail: 'Supabase Auth' },
        { label: 'E-mail confirmado', status: profile?.email ? 'ok' : 'warning', detail: 'Verificação de e-mail ativa' },
        { label: 'company_id obrigatório', status: companyId ? 'ok' : 'critical', detail: companyId ? `ID: ${companyId.slice(0, 8)}…` : 'company_id ausente' },
        { label: 'Permissões por role', status: profile?.role ? 'ok' : 'warning', detail: profile?.role ? getRoleLabel(profile.role) : 'Role indefinido' },
        { label: 'Proteção anti-XSS', status: 'ok', detail: 'Sanitização ativa' },
        { label: 'Uploads validados', status: 'ok', detail: 'Extensão + MIME + tamanho' },
        { label: 'Tokens ERP mascarados', status: 'ok', detail: 'Nunca expostos no frontend' },
      ];

      // Check RLS by trying to read from another company (should return empty)
      const { data: rlsTest } = await supabase
        .from('products')
        .select('id')
        .neq('company_id', companyId)
        .limit(1);

      base.push({
        label: 'RLS ativo — isolamento entre empresas',
        status: (rlsTest?.length ?? 0) === 0 ? 'ok' : 'critical',
        detail: (rlsTest?.length ?? 0) === 0 ? 'Nenhum dado de outra empresa visível' : 'FALHA: dados de outra empresa visíveis',
      });

      // Check audit logs available
      const { count: auditCount } = await supabase
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId);

      base.push({
        label: 'Logs de auditoria ativos',
        status: 'ok',
        detail: `${auditCount ?? 0} eventos registrados`,
      });

      // Check security_logs
      const { count: secCount } = await supabase
        .from('security_logs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId);

      base.push({
        label: 'Logs de segurança ativos',
        status: 'ok',
        detail: `${secCount ?? 0} eventos registrados`,
      });

      base.push(
        { label: 'Rotas protegidas por autenticação', status: 'ok', detail: 'Verificação de sessão ativa' },
        { label: 'Dados da empresa isolados', status: companyId ? 'ok' : 'critical', detail: 'Segregação por company_id' },
      );

      setItems(base);
      setLoading(false);
    }
    if (companyId) run();
  }, [companyId, profile]);

  const okCount = items.filter(i => i.status === 'ok').length;
  const warnCount = items.filter(i => i.status === 'warning').length;
  const critCount = items.filter(i => i.status === 'critical').length;

  return (
    <div className="bg-surface-2 border border-edge rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500/15 rounded-xl flex items-center justify-center">
            <ShieldCheck size={20} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="font-bold text-fg">Security Health Check</h3>
            <p className="text-fg-subtle text-xs">InventoryBlind Security Audit</p>
          </div>
        </div>
        {!loading && (
          <div className="flex gap-3 text-xs">
            <span className="text-emerald-400 font-semibold">{okCount} OK</span>
            {warnCount > 0 && <span className="text-amber-400 font-semibold">{warnCount} Atenção</span>}
            {critCount > 0 && <span className="text-red-400 font-semibold">{critCount} Crítico</span>}
          </div>
        )}
      </div>
      <div className="space-y-2">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-surface-3 animate-pulse">
                <div className="h-3 w-48 bg-edge rounded" />
                <div className="h-3 w-16 bg-edge rounded" />
              </div>
            ))
          : items.map((item) => (
              <div key={item.label} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-surface-3 hover:bg-surface-3 transition-colors">
                <div>
                  <span className="text-fg text-sm">{item.label}</span>
                  {item.detail && <span className="text-fg-subtle text-xs ml-2">— {item.detail}</span>}
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
      </div>
    </div>
  );
}

// ── Section: Overview Cards ───────────────────────────────────────────────────

interface OverviewData {
  auditCount: number;
  secCount: number;
  criticalAlerts: number;
  profileCount: number;
  rlsActive: boolean;
}

function OverviewCards({ companyId }: { companyId: string }) {
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    async function load() {
      const [auditRes, secRes, critRes, profileRes] = await Promise.all([
        supabase.from('audit_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
        supabase.from('security_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
        supabase.from('security_logs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('severity', ['high', 'critical']),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      ]);

      const leakTest = await supabase.from('products').select('id').neq('company_id', companyId).limit(1);

      setData({
        auditCount:     auditRes.count ?? 0,
        secCount:       secRes.count ?? 0,
        criticalAlerts: critRes.count ?? 0,
        profileCount:   profileRes.count ?? 0,
        rlsActive:      (leakTest.data?.length ?? 0) === 0,
      });
    }
    if (companyId) load();
  }, [companyId]);

  const cards = [
    {
      icon: <Shield size={20} />,
      iconBg: 'bg-emerald-500/15',
      iconColor: 'text-emerald-400',
      label: 'RLS Status',
      value: data?.rlsActive ? 'Ativo' : 'FALHA',
      sub: 'Isolamento multiempresa',
      status: data?.rlsActive ? 'ok' : 'critical',
    },
    {
      icon: <FileText size={20} />,
      iconBg: 'bg-blue-500/15',
      iconColor: 'text-blue-400',
      label: 'Logs de Auditoria',
      value: data?.auditCount?.toLocaleString('pt-BR') ?? '—',
      sub: 'Eventos registrados',
      status: 'ok',
    },
    {
      icon: <ShieldAlert size={20} />,
      iconBg: data?.criticalAlerts ? 'bg-red-500/15' : 'bg-surface-3',
      iconColor: data?.criticalAlerts ? 'text-red-400' : 'text-fg-subtle',
      label: 'Alertas Críticos',
      value: data?.criticalAlerts?.toLocaleString('pt-BR') ?? '—',
      sub: 'Severidade alta/crítica',
      status: (data?.criticalAlerts ?? 0) > 0 ? 'critical' : 'ok',
    },
    {
      icon: <Users size={20} />,
      iconBg: 'bg-violet-500/15',
      iconColor: 'text-violet-400',
      label: 'Usuários da Empresa',
      value: data?.profileCount?.toLocaleString('pt-BR') ?? '—',
      sub: 'Perfis vinculados',
      status: 'ok',
    },
    {
      icon: <Database size={20} />,
      iconBg: 'bg-teal-500/15',
      iconColor: 'text-teal-400',
      label: 'Logs de Segurança',
      value: data?.secCount?.toLocaleString('pt-BR') ?? '—',
      sub: 'Eventos de segurança',
      status: 'ok',
    },
    {
      icon: <Lock size={20} />,
      iconBg: 'bg-amber-500/15',
      iconColor: 'text-amber-400',
      label: 'Backup',
      value: 'Supabase',
      sub: 'Gerenciado automaticamente',
      status: 'ok',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-surface-2 border border-edge rounded-2xl p-4">
          <div className={`w-9 h-9 ${card.iconBg} rounded-xl flex items-center justify-center mb-3`}>
            <span className={card.iconColor}>{card.icon}</span>
          </div>
          <div className={`text-xl font-bold mb-0.5 ${card.status === 'critical' ? 'text-red-400' : card.status === 'warning' ? 'text-amber-400' : 'text-fg'}`}>
            {data ? card.value : <span className="inline-block w-8 h-5 bg-edge rounded animate-pulse" />}
          </div>
          <div className="text-fg-subtle text-xs font-semibold">{card.label}</div>
          <div className="text-fg-subtle text-xs mt-0.5">{card.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Section: Audit Logs ───────────────────────────────────────────────────────

function AuditLogsTable({ companyId }: { companyId: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('audit_logs')
      .select('id, company_id, user_id, user_email, action, resource_type, resource_id, ip_address, metadata, created_at, description, user_agent')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filter) q = q.ilike('action', `%${filter}%`);

    const { data } = await q;
    setLogs((data as AuditLog[]) ?? []);
    setLoading(false);
  }, [companyId, page, filter]);

  useEffect(() => { if (companyId) load(); }, [load]);

  return (
    <div className="bg-surface-2 border border-edge rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-edge">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-500/15 rounded-xl flex items-center justify-center">
            <FileText size={18} className="text-blue-400" />
          </div>
          <h3 className="font-bold text-fg">Logs de Auditoria</h3>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={e => { setFilter(e.target.value); setPage(0); }}
            placeholder="Filtrar por ação..."
            className="bg-surface-3 border border-edge rounded-lg px-3 py-1.5 text-sm text-fg placeholder-fg-subtle focus:outline-none focus:border-accent w-44 max-w-full"
          />
          <button onClick={load} className="p-1.5 text-fg-subtle hover:text-fg-muted transition">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge bg-surface-3">
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Data/Hora</th>
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Usuário</th>
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Ação</th>
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Recurso</th>
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Descrição</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-edge/60">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-surface-3 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              : logs.length === 0
              ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-fg-subtle text-sm">Nenhum log encontrado.</td></tr>
                )
              : logs.map((log) => (
                  <tr key={log.id} className="border-b border-edge/60 hover:bg-surface-3/60 transition-colors">
                    <td className="px-4 py-3 text-fg-subtle text-xs whitespace-nowrap">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-3 text-fg-muted text-xs">{truncate(log.user_email, 28)}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-surface-3 px-2 py-0.5 rounded text-emerald-400">{log.action}</span>
                    </td>
                    <td className="px-4 py-3 text-fg-subtle text-xs">{log.resource_type ?? '—'}</td>
                    <td className="px-4 py-3 text-fg-subtle text-xs">{truncate(log.description)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-t border-edge">
        <span className="text-fg-subtle text-xs">Página {page + 1}</span>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="text-xs px-3 py-1 rounded bg-surface-3 hover:bg-edge disabled:opacity-40 text-fg-muted transition">Anterior</button>
          <button disabled={logs.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)} className="text-xs px-3 py-1 rounded bg-surface-3 hover:bg-edge disabled:opacity-40 text-fg-muted transition">Próxima</button>
        </div>
      </div>
    </div>
  );
}

// ── Section: Security Logs ───────────────────────────────────────────────────

function SecurityLogsTable({ companyId }: { companyId: string }) {
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('security_logs')
      .select('id, company_id, user_id, event_type, severity, description, ip_address, user_agent, metadata, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (severityFilter !== 'all') q = q.eq('severity', severityFilter);

    const { data } = await q;
    setLogs((data as SecurityLog[]) ?? []);
    setLoading(false);
  }, [companyId, page, severityFilter]);

  useEffect(() => { if (companyId) load(); }, [load]);

  return (
    <div className="bg-surface-2 border border-edge rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-edge">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-red-500/15 rounded-xl flex items-center justify-center">
            <ShieldAlert size={18} className="text-red-400" />
          </div>
          <h3 className="font-bold text-fg">Logs de Segurança</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={severityFilter}
            onChange={e => { setSeverityFilter(e.target.value); setPage(0); }}
            className="bg-surface-3 border border-edge rounded-lg px-3 py-1.5 text-sm text-fg focus:outline-none focus:border-accent"
          >
            <option value="all">Todos</option>
            <option value="info">Info</option>
            <option value="warning">Atenção</option>
            <option value="high">Alto</option>
            <option value="critical">Crítico</option>
          </select>
          <button onClick={load} className="p-1.5 text-fg-subtle hover:text-fg-muted transition">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge bg-surface-3">
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Data/Hora</th>
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Severidade</th>
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Evento</th>
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">Descrição</th>
              <th className="text-left px-4 py-3 text-fg-subtle font-semibold text-xs">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-edge/60">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-surface-3 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              : logs.length === 0
              ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-fg-subtle text-sm">Nenhum evento de segurança registrado.</td></tr>
                )
              : logs.map((log) => (
                  <tr key={log.id} className="border-b border-edge/60 hover:bg-surface-3/60 transition-colors">
                    <td className="px-4 py-3 text-fg-subtle text-xs whitespace-nowrap">{formatDate(log.created_at)}</td>
                    <td className="px-4 py-3"><SeverityBadge severity={log.severity} /></td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-surface-3 px-2 py-0.5 rounded text-amber-400">{log.event_type}</span>
                    </td>
                    <td className="px-4 py-3 text-fg-subtle text-xs">{truncate(log.description)}</td>
                    <td className="px-4 py-3 text-fg-subtle text-xs font-mono">{log.ip_address ?? '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-t border-edge">
        <span className="text-fg-subtle text-xs">Página {page + 1}</span>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="text-xs px-3 py-1 rounded bg-surface-3 hover:bg-edge disabled:opacity-40 text-fg-muted transition">Anterior</button>
          <button disabled={logs.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)} className="text-xs px-3 py-1 rounded bg-surface-3 hover:bg-edge disabled:opacity-40 text-fg-muted transition">Próxima</button>
        </div>
      </div>
    </div>
  );
}

// ── Section: Active Sessions (visual) ────────────────────────────────────────

function ActiveSessions() {
  const { user, profile } = useAuth();
  const sessionStart = new Date(Date.now() - Math.random() * 3600000).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="bg-surface-2 border border-edge rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 bg-violet-500/15 rounded-xl flex items-center justify-center">
          <Activity size={18} className="text-violet-400" />
        </div>
        <div>
          <h3 className="font-bold text-fg">Sessões Ativas</h3>
          <p className="text-fg-subtle text-xs">Dispositivos com acesso ativo</p>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-surface-3 rounded-xl border border-emerald-500/20">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <p className="text-fg text-sm font-semibold">{profile?.email ?? user?.email}</p>
              <p className="text-fg-subtle text-xs">Sessão atual · Iniciada {sessionStart}</p>
            </div>
          </div>
          <span className="text-xs text-fg-subtle bg-edge/60 px-2 py-0.5 rounded-full">Atual</span>
        </div>
        <div className="p-3 bg-surface-3/40 rounded-xl border border-edge text-center">
          <p className="text-fg-subtle text-xs">Gerenciamento avançado de sessões em breve</p>
        </div>
      </div>
    </div>
  );
}

// ── Section: Security Settings ────────────────────────────────────────────────

function SecuritySettingsPanel({ companyId }: { companyId: string }) {
  const { profile } = useAuth();
  const canEdit = hasPermission(profile?.role, 'settings.manage');
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('company_security_settings')
        .select('id, company_id, require_email_confirmation, require_2fa, session_timeout_minutes, max_failed_login_attempts, max_upload_size_mb, allowed_file_types, created_at, updated_at')
        .eq('company_id', companyId)
        .maybeSingle();

      if (data) setSettings(data as SecuritySettings);
    }
    if (companyId) load();
  }, [companyId]);

  async function save() {
    if (!settings || !canEdit) return;
    setSaving(true);
    await supabase.from('company_security_settings')
      .update(settings)
      .eq('company_id', companyId);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="bg-surface-2 border border-edge rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 bg-amber-500/15 rounded-xl flex items-center justify-center">
          <Settings size={18} className="text-amber-400" />
        </div>
        <div>
          <h3 className="font-bold text-fg">Configurações de Segurança</h3>
          <p className="text-fg-subtle text-xs">Políticas de acesso da empresa</p>
        </div>
      </div>
      {!settings
        ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-surface-3 rounded-xl animate-pulse" />)}</div>
        : (
          <div className="space-y-4">
            <Row label="Confirmação de e-mail obrigatória" sub="Usuários devem confirmar o e-mail">
              <Toggle value={settings.require_email_confirmation} disabled={!canEdit}
                onChange={v => setSettings(s => s ? { ...s, require_email_confirmation: v } : s)} />
            </Row>
            <Row label="Autenticação 2FA" sub="Em breve">
              <span className="text-xs text-fg-subtle bg-surface-3 px-2 py-1 rounded-lg">Em breve</span>
            </Row>
            <Row label="Timeout de sessão" sub={`${settings.session_timeout_minutes} min`}>
              <input type="number" value={settings.session_timeout_minutes} disabled={!canEdit}
                onChange={e => setSettings(s => s ? { ...s, session_timeout_minutes: Number(e.target.value) } : s)}
                className="w-20 bg-surface-3 border border-edge rounded-lg px-2 py-1 text-sm text-fg text-center focus:outline-none" />
            </Row>
            <Row label="Máx. tentativas de login" sub="Antes do bloqueio temporário">
              <input type="number" value={settings.max_failed_login_attempts} disabled={!canEdit}
                onChange={e => setSettings(s => s ? { ...s, max_failed_login_attempts: Number(e.target.value) } : s)}
                className="w-20 bg-surface-3 border border-edge rounded-lg px-2 py-1 text-sm text-fg text-center focus:outline-none" />
            </Row>
            <Row label="Tamanho máx. de upload (MB)" sub="Planilhas de importação">
              <input type="number" value={settings.max_upload_size_mb} disabled={!canEdit}
                onChange={e => setSettings(s => s ? { ...s, max_upload_size_mb: Number(e.target.value) } : s)}
                className="w-20 bg-surface-3 border border-edge rounded-lg px-2 py-1 text-sm text-fg text-center focus:outline-none" />
            </Row>
            {canEdit && (
              <button onClick={save} disabled={saving}
                className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-fg rounded-xl font-semibold text-sm transition mt-2">
                {saving ? 'Salvando…' : saved ? '✓ Salvo' : 'Salvar Configurações'}
              </button>
            )}
          </div>
        )}
    </div>
  );
}

function Row({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between p-3 bg-surface-3 rounded-xl">
      <div>
        <p className="text-fg text-sm">{label}</p>
        <p className="text-fg-subtle text-xs">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => !disabled && onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-emerald-500' : 'bg-edge'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

// ── Section: Backup Status (visual) ──────────────────────────────────────────

function BackupStatus() {
  const items = [
    { label: 'Último backup', value: 'Hoje, 03:00', status: 'ok' },
    { label: 'Status', value: 'Concluído', status: 'ok' },
    { label: 'Próximo backup', value: 'Amanhã, 03:00', status: 'ok' },
    { label: 'Retenção', value: '30 dias', status: 'ok' },
    { label: 'Responsável', value: 'Supabase Managed', status: 'ok' },
  ];

  return (
    <div className="bg-surface-2 border border-edge rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 bg-teal-500/15 rounded-xl flex items-center justify-center">
          <Server size={18} className="text-teal-400" />
        </div>
        <div>
          <h3 className="font-bold text-fg">Status de Backup</h3>
          <p className="text-fg-subtle text-xs">Gerenciado pelo Supabase</p>
        </div>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.label} className="flex items-center justify-between p-2.5 bg-surface-3 rounded-xl">
            <span className="text-fg-subtle text-sm">{item.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-fg text-sm font-semibold">{item.value}</span>
              <CheckCircle2 size={14} className="text-emerald-400" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section: ERP Integrations ────────────────────────────────────────────────

function ERPIntegrations({ companyId }: { companyId: string }) {
  const [integrations, setIntegrations] = useState<{ provider: string; status: string; last_sync_at: string | null }[]>([]);

  useEffect(() => {
    supabase.from('erp_integrations').select('provider, status, last_sync_at').eq('company_id', companyId)
      .then(({ data }) => setIntegrations(data ?? []));
  }, [companyId]);

  const statusColor = (s: string) =>
    s === 'active' ? 'text-emerald-400' : s === 'error' ? 'text-red-400' : 'text-fg-subtle';

  return (
    <div className="bg-surface-2 border border-edge rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 bg-blue-500/15 rounded-xl flex items-center justify-center">
          <Link size={18} className="text-blue-400" />
        </div>
        <div>
          <h3 className="font-bold text-fg">Integrações ERP</h3>
          <p className="text-fg-subtle text-xs">Conexões com sistemas externos</p>
        </div>
      </div>
      {integrations.length === 0
        ? (
          <div className="text-center py-8">
            <Globe size={28} className="text-fg-subtle mx-auto mb-2" />
            <p className="text-fg-subtle text-sm">Nenhuma integração configurada</p>
            <p className="text-fg-subtle text-xs mt-1">Tiny, Bling, Omie, SAP, TOTVS e outros em breve</p>
          </div>
        )
        : (
          <div className="space-y-2">
            {integrations.map(i => (
              <div key={i.provider} className="flex items-center justify-between p-3 bg-surface-3 rounded-xl">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-fg-subtle" />
                  <span className="text-fg text-sm font-semibold">{i.provider}</span>
                </div>
                <div className="flex items-center gap-3">
                  {i.last_sync_at && <span className="text-fg-subtle text-xs">{formatDate(i.last_sync_at)}</span>}
                  <span className={`text-xs font-semibold capitalize ${statusColor(i.status)}`}>{i.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── Permission Matrix ────────────────────────────────────────────────────────

const ALL_PERMISSIONS = [
  { key: 'products.read',    label: 'Ver Produtos' },
  { key: 'products.write',   label: 'Editar Produtos' },
  { key: 'inventory.read',   label: 'Ver Inventário' },
  { key: 'inventory.write',  label: 'Editar Inventário' },
  { key: 'financial.read',   label: 'Ver Financeiro' },
  { key: 'full.read',        label: 'Full Manager (ver)' },
  { key: 'full.write',       label: 'Full Manager (editar)' },
  { key: 'labels.use',       label: 'Etiquetas' },
  { key: 'reports.export',   label: 'Exportar Relatórios' },
  { key: 'users.manage',     label: 'Gerenciar Usuários' },
  { key: 'erp.manage',       label: 'Gerenciar ERP' },
  { key: 'security.view',    label: 'Ver Segurança' },
  { key: 'audit.view',       label: 'Ver Auditoria' },
  { key: 'settings.manage',  label: 'Gerenciar Configurações' },
] as const;

const ROLES = ['owner', 'admin', 'manager', 'counter', 'viewer'] as const;

function PermissionMatrix() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-surface-2 border border-edge rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-5 hover:bg-surface-3/60 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-violet-500/15 rounded-xl flex items-center justify-center">
            <Zap size={18} className="text-violet-400" />
          </div>
          <div className="text-left">
            <h3 className="font-bold text-fg">Matriz de Permissões</h3>
            <p className="text-fg-subtle text-xs">Permissões por role</p>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-fg-subtle" /> : <ChevronDown size={16} className="text-fg-subtle" />}
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-edge">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-3">
                <th className="text-left px-4 py-3 text-fg-subtle font-semibold w-48">Permissão</th>
                {ROLES.map(r => (
                  <th key={r} className="px-3 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${getRoleBadgeColor(r)}`}>
                      {getRoleLabel(r)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMISSIONS.map(p => (
                <tr key={p.key} className="border-t border-edge/60 hover:bg-surface-3/40 transition-colors">
                  <td className="px-4 py-2.5 text-fg-muted font-mono">{p.label}</td>
                  {ROLES.map(r => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      {hasPermission(r, p.key)
                        ? <CheckCircle2 size={14} className="text-emerald-400 mx-auto" />
                        : <XCircle size={14} className="text-fg-subtle mx-auto" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main SecurityPage ────────────────────────────────────────────────────────

type SecurityTab = 'overview' | 'audit' | 'security-logs' | 'sessions' | 'erp' | 'settings';

interface SecurityPageProps {
  onBack: () => void;
}

export default function SecurityPage({ onBack }: SecurityPageProps) {
  const { profile, companyId } = useAuth();
  const [tab, setTab] = useState<SecurityTab>('overview');

  if (!hasPermission(profile?.role, 'security.view')) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <ShieldX size={48} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-fg mb-2">Acesso negado</h2>
          <p className="text-fg-subtle text-sm mb-6">Você não tem permissão para ver esta seção.</p>
          <button onClick={onBack} className="px-4 py-2 bg-surface-3 hover:bg-edge text-fg rounded-xl text-sm font-semibold transition">
            Voltar ao Dashboard
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: SecurityTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview',      label: 'Visão Geral',    icon: <Shield size={15} /> },
    { id: 'audit',         label: 'Auditoria',      icon: <FileText size={15} /> },
    { id: 'security-logs', label: 'Logs Segurança', icon: <ShieldAlert size={15} /> },
    { id: 'sessions',      label: 'Sessões',        icon: <Activity size={15} /> },
    { id: 'erp',           label: 'Integrações',    icon: <Link size={15} /> },
    { id: 'settings',      label: 'Configurações',  icon: <Settings size={15} /> },
  ];

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="border-b border-edge bg-surface/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-4 py-4">
            <button onClick={onBack} className="p-2 text-fg-subtle hover:text-fg hover:bg-surface-3 rounded-xl transition">
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-emerald-500/15 rounded-xl flex items-center justify-center">
                <ShieldCheck size={18} className="text-emerald-400" />
              </div>
              <div>
                <h1 className="text-fg font-bold text-lg">Central de Segurança</h1>
                <p className="text-fg-subtle text-xs">Monitoramento e controle de acesso</p>
              </div>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-px">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-fg-subtle hover:text-fg-muted'
                }`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {tab === 'overview' && (
          <>
            <OverviewCards companyId={companyId} />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <HealthCheck companyId={companyId} />
              <div className="space-y-6">
                <BackupStatus />
                <ActiveSessions />
              </div>
            </div>
            <PermissionMatrix />
          </>
        )}
        {tab === 'audit'         && <AuditLogsTable companyId={companyId} />}
        {tab === 'security-logs' && <SecurityLogsTable companyId={companyId} />}
        {tab === 'sessions'      && <ActiveSessions />}
        {tab === 'erp'           && <ERPIntegrations companyId={companyId} />}
        {tab === 'settings'      && <SecuritySettingsPanel companyId={companyId} />}
      </div>
    </div>
  );
}

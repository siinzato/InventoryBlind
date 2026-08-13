import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package,
  AlertTriangle,
  Clock,
  Activity,
  Award,
  X,
  User,
  ShieldCheck,
  MinusCircle,
  Lock,
  LogOut,
  Edit,
  Target,
  Zap,
  Users,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  BarChart2,
  Plus,
  Trash2,
  Loader2,
  Archive,
  RotateCcw,
  History,
  Eye,
  Bot,
  MessageCircle,
  Send,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Map,
  FileSpreadsheet,
  Tag,
  UserCog,
  Building2,
  Download,
  Smartphone,
  ScanLine,
  LayoutDashboard,
  DollarSign,
  Receipt,
  PieChart,
  Gauge,
  ClipboardCheck,
  BarChart3,
  ShieldAlert,
  Plug,
  Boxes,
  Warehouse,
  Server,
  Database,
  Code2,
  Webhook,
  Workflow,
  FileText,
  Settings,
  Sun,
  Moon,
  GraduationCap,
  LayoutGrid,
  GitBranch,
  SearchCheck,
  BookOpen,
  ArrowRight
} from 'lucide-react';
import { supabase, type BrandData, type TopVenda, type CustomKPI, type InventorySnapshot, type InventoryBrandHistory, type BlindAISituation } from './lib/supabase';
import { getBlindAISituations } from './lib/blindAIInsightsEngine';
import { tryFastPath, askBlindAIAgent, getContextualSuggestions, type ChatMessage } from './lib/blindAIAgent';
import { computeGlobalStats } from './lib/blindAIAgentAlgorithm';
import { SafeDropdown } from './components/SafeDropdown';
import { DashboardRankingPreview } from './components/DashboardRankingPreview';
import { CountManagementCenter } from './components/counting/CountManagementCenter';
import WorkspaceSelectorScreen from './components/WorkspaceSelectorScreen';
import AuthPage from './components/AuthPage';
import { useAuth, canManageUsers } from './lib/auth';
import { hasPermission, getRoleLabel } from './lib/permissionService';
import { usePWAInstall } from './lib/usePWAInstall';
import { useTheme } from './lib/useTheme';
import { LogoMark } from './components/landing/landingUi';
import {
  ThemeToggle, Sidebar, AppHeader, Panel, PanelSection, Modal, Badge,
  Stat, StatRow, StatCell, resolveInsightIcon, INSIGHT_ICON_TONE, type StatProps,
} from './components/ui';
import type { SidebarNavGroup } from './components/ui';

// Code-split large page components for smaller initial bundle
const LandingPage = React.lazy(() => import('./components/LandingPage'));
const HeatmapEstoque = React.lazy(() => import('./components/HeatmapEstoque').then(m => ({ default: m.HeatmapEstoque })));
const ProductImportPage = React.lazy(() => import('./components/ProductImportPage').then(m => ({ default: m.ProductImportPage })));
const ImportedProductsPage = React.lazy(() => import('./components/ImportedProductsPage').then(m => ({ default: m.ImportedProductsPage })));
const ImportHistoryPage = React.lazy(() => import('./components/ImportHistoryPage').then(m => ({ default: m.ImportHistoryPage })));
const RankingsPage = React.lazy(() => import('./components/RankingsPage').then(m => ({ default: m.RankingsPage })));
const LabelGeneratorPage = React.lazy(() => import('./components/LabelGeneratorPage').then(m => ({ default: m.LabelGeneratorPage })));
const FullManagerPage = React.lazy(() => import('./components/FullManagerPage'));
const UserManagementPage = React.lazy(() => import('./components/UserManagementPage'));
const SecurityPage = React.lazy(() => import('./components/SecurityPage'));
const NFeConferencePage = React.lazy(() => import('./components/nfe/NFeConferencePage'));
const ProductivityTab = React.lazy(() => import('./components/productivity/ProductivityTab').then(m => ({ default: m.ProductivityTab })));
const AcademyRouter = React.lazy(() => import('./components/academy/AcademyRouter').then(m => ({ default: m.AcademyRouter })));
const CBCDashboardPage = React.lazy(() => import('./components/cbc/CBCDashboardPage').then(m => ({ default: m.CBCDashboardPage })));
const RiskDashboardPage = React.lazy(() => import('./components/risk/RiskDashboardPage').then(m => ({ default: m.RiskDashboardPage })));
const AbcXyzDashboardPage = React.lazy(() => import('./components/abcxyz/AbcXyzDashboardPage').then(m => ({ default: m.AbcXyzDashboardPage })));
const WarehouseDigitalTwinPage = React.lazy(() => import('./components/slotting/WarehouseDigitalTwinPage').then(m => ({ default: m.WarehouseDigitalTwinPage })));
const RcaDashboardPage = React.lazy(() => import('./components/rca/RcaDashboardPage').then(m => ({ default: m.RcaDashboardPage })));
const AuditDashboardPage = React.lazy(() => import('./components/audit/AuditDashboardPage').then(m => ({ default: m.AuditDashboardPage })));
const KnowledgeCenterPage = React.lazy(() => import('./components/account/KnowledgeCenterPage').then(m => ({ default: m.KnowledgeCenterPage })));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <Loader2 size={32} className="animate-spin text-accent" />
  </div>
);

// Suspense fallback for the lazy-loaded LandingPage — color-matched to its
// own bg-ink-950 root, no spinner/logo, to avoid a flash-of-white before
// the chunk (which also carries Motion/GSAP) finishes loading.
const LandingFallback = () => <div className="min-h-screen w-full bg-ink-950" />;

// Severity reaches the UI through the icon tint (INSIGHT_ICON_TONE) and this
// badge variant only — the title stays text-fg so the same signal isn't
// repeated three times in one row.
const SITUATION_SEVERITY_BADGE: Record<BlindAISituation['severity'], 'neutral' | 'warning' | 'danger'> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
};

interface OpCapa {
  nome: string;
  valor: string;
  resp: string;
}

const initialOpCapas: OpCapa[] = [
  { nome: 'ESR', valor: '94,1%', resp: 'Davi' },
  { nome: 'Dexnor', valor: '79,2%', resp: 'Jackson' },
  { nome: 'X-Level', valor: '66,6%', resp: 'Jackson' },
  { nome: 'Nillkin', valor: '64,1%', resp: 'Willian' },
  { nome: 'GoCase Capas', valor: '51,8%', resp: 'Geovanna' },
  { nome: 'Ringke', valor: '29,2%', resp: 'Leo' },
  { nome: 'AZ Capas', valor: 'Andamento', resp: 'Giovani' },
  { nome: 'DUX', valor: 'Andamento', resp: 'Davi' },
];

function AppContent() {
  const { profile, company, companyId, companies, switchCompany, switchingCompany, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('dashboard');

  const [brandsData, setBrandsData] = useState<BrandData[]>([]);
  const [topVendas, setTopVendas] = useState<TopVenda[]>([]);
  const [customKPIs, setCustomKPIs] = useState<CustomKPI[]>([]);
  const [opCapas] = useState<OpCapa[]>(initialOpCapas);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddBrandModal, setShowAddBrandModal] = useState(false);
  const [showAddKPIModal, setShowAddKPIModal] = useState(false);

  const isLoggedIn = canManageUsers(profile?.role);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { canInstall, hasPrompt, promptInstall } = usePWAInstall();
  const [showInstallModal, setShowInstallModal] = useState(false);

  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandTotalSku, setNewBrandTotalSku] = useState('');

  const [newKPI, setNewKPI] = useState<Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>>({
    titulo: '',
    valor: '',
    unidade: '',
    variacao: '',
    tipo_variacao: 'up',
    cor_icone: 'blue'
  });

  // History states
  const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<InventorySnapshot | null>(null);
  const [snapshotBrands, setSnapshotBrands] = useState<InventoryBrandHistory[]>([]);
  const [resetProgress, setResetProgress] = useState(false);
  const [inventoryStartDate, setInventoryStartDate] = useState<string | null>(null);

  // Load data from Supabase
  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    async function loadData() {
      try {
        setLoading(true);

        const [brandsRes, vendasRes, kpisRes] = await Promise.all([
          supabase.from('inventory_brands').select('id, brand, total_sku, done_sku, divergences, order_index, created_at, updated_at, company_id').eq('company_id', companyId).order('order_index'),
          supabase.from('top_vendas').select('id, produto, sku, vendas, order_index, created_at, updated_at, company_id').eq('company_id', companyId).order('order_index'),
          supabase.from('custom_kpis').select('id, titulo, valor, unidade, variacao, tipo_variacao, cor_icone, order_index, created_at, updated_at, company_id').eq('company_id', companyId).order('order_index')
        ]);

        if (brandsRes.error) throw brandsRes.error;
        if (vendasRes.error) throw vendasRes.error;
        if (kpisRes.error) throw kpisRes.error;

        setBrandsData(brandsRes.data || []);
        setTopVendas(vendasRes.data || []);
        setCustomKPIs(kpisRes.data || []);

        // Set inventory start date from oldest brand creation
        if (brandsRes.data && brandsRes.data.length > 0) {
          const oldestDate = brandsRes.data.reduce((min, b) => {
            const created = new Date(b.created_at);
            return created < min ? created : min;
          }, new Date());
          setInventoryStartDate(oldestDate.toISOString());
        }

        setError(null);
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Falha ao carregar dados. Tente recarregar a página.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [companyId]);

  // Load snapshots (history)
  const loadSnapshots = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from('inventory_snapshots')
      .select('id, name, start_date, end_date, total_sku, total_done, total_divergences, progress, accuracy, status, notes, created_at, updated_at, company_id');

    if (!error && data) {
      setSnapshots(data);
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) {
      loadSnapshots();
    }
  }, [companyId, loadSnapshots]);

  // Archive current inventory and reset
  const handleResetInventory = async (inventoryName: string, notes: string) => {
    setResetProgress(true);

    try {
      // Calculate current stats
      const totalSku = brandsData.reduce((sum, b) => sum + b.total_sku, 0);
      const totalDone = brandsData.reduce((sum, b) => sum + b.done_sku, 0);
      const totalDivergences = brandsData.reduce((sum, b) => sum + b.divergences, 0);
      const progress = totalSku > 0 ? (totalDone / totalSku) * 100 : 0;
      const accuracy = totalDone > 0 ? ((totalDone - totalDivergences) / totalDone) * 100 : 0;

      // Create snapshot
      const { data: snapshotData, error: snapshotError } = await supabase
        .from('inventory_snapshots')
        .insert({
          company_id: companyId,
          name: inventoryName,
          start_date: inventoryStartDate || new Date().toISOString(),
          end_date: new Date().toISOString(),
          total_sku: totalSku,
          total_done: totalDone,
          total_divergences: totalDivergences,
          progress,
          accuracy,
          status: 'completed',
          notes
        })
        .select()
        .single();

      if (snapshotError || !snapshotData) throw snapshotError || new Error('Failed to create snapshot');

      const snapshotId = snapshotData.id;

      // Archive brands
      const brandHistoryData = brandsData.map(b => {
        const bProgress = b.total_sku > 0 ? (b.done_sku / b.total_sku) * 100 : 0;
        const bAccuracy = b.done_sku > 0 ? ((b.done_sku - b.divergences) / b.done_sku) * 100 : null;
        return {
          snapshot_id: snapshotId,
          brand: b.brand,
          total_sku: b.total_sku,
          done_sku: b.done_sku,
          divergences: b.divergences,
          progress: bProgress,
          accuracy: bAccuracy,
          status: bProgress >= 100 ? 'CONCLUÍDO' : 'ANDAMENTO'
        };
      });

      await supabase.from('inventory_brand_history').insert(brandHistoryData);

      // Archive KPIs
      const kpiHistoryData = customKPIs.map(k => ({
        snapshot_id: snapshotId,
        titulo: k.titulo,
        valor: k.valor,
        unidade: k.unidade,
        variacao: k.variacao,
        tipo_variacao: k.tipo_variacao,
        cor_icone: k.cor_icone
      }));

      if (kpiHistoryData.length > 0) {
        await supabase.from('inventory_kpi_history').insert(kpiHistoryData);
      }

      // Archive Top Vendas
      const topVendasHistoryData = topVendas.map(v => ({
        snapshot_id: snapshotId,
        produto: v.produto,
        sku: v.sku,
        vendas: v.vendas,
        order_index: v.order_index
      }));

      if (topVendasHistoryData.length > 0) {
        await supabase.from('inventory_top_vendas_history').insert(topVendasHistoryData);
      }

      // Reset brands data (keep brands but reset counts)
      const resetData = brandsData.map(b => ({
        id: b.id,
        done_sku: 0,
        divergences: 0,
        updated_at: new Date().toISOString()
      }));

      for (const brand of resetData) {
        await supabase
          .from('inventory_brands')
          .update({ done_sku: 0, divergences: 0, updated_at: new Date().toISOString() })
          .eq('id', brand.id);
      }

      // Update local state
      setBrandsData(prev => prev.map(b => ({ ...b, done_sku: 0, divergences: 0 })));
      setInventoryStartDate(new Date().toISOString());

      // Reload snapshots
      await loadSnapshots();

      setShowResetModal(false);
      alert('Inventário arquivado e resetado com sucesso!');
    } catch (err) {
      console.error('Error resetting inventory:', err);
      alert('Erro ao arquivar o inventário. Tente novamente.');
    } finally {
      setResetProgress(false);
    }
  };

  // View snapshot details
  const handleViewSnapshot = async (snapshot: InventorySnapshot) => {
    setSelectedSnapshot(snapshot);

    const { data } = await supabase
      .from('inventory_brand_history')
      .select('id, snapshot_id, brand, total_sku, done_sku, divergences, progress, accuracy, status, created_at, company_id');

    setSnapshotBrands(data || []);
  };

  const globais = useMemo(() => computeGlobalStats(brandsData), [brandsData]);

  const healthStatus = useMemo(() => {
    const acc = globais.acuracidade;
    if (acc >= 80) {
      return { label: 'ÓTIMA', color: 'text-emerald-600', border: 'border-l-emerald-500', iconColor: 'text-emerald-500', icon: ShieldCheck };
    } else if (acc >= 50) {
      return { label: 'MEDIANA', color: 'text-amber-500', border: 'border-l-amber-500', iconColor: 'text-amber-500', icon: MinusCircle };
    } else {
      return { label: 'CRÍTICA', color: 'text-red-600', border: 'border-l-red-500', iconColor: 'text-red-500', icon: AlertTriangle };
    }
  }, [globais.acuracidade]);

  // BlindAI states
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiMessages, setAiMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [situations, setSituations] = useState<BlindAISituation[]>([]);
  const [situationsLoading, setSituationsLoading] = useState(false);

  const loadSituations = useCallback(() => {
    if (!companyId) return;
    setSituationsLoading(true);
    getBlindAISituations(companyId)
      .then(setSituations)
      .finally(() => setSituationsLoading(false));
  }, [companyId]);

  useEffect(() => {
    loadSituations();
  }, [loadSituations]);

  // Sugestões contextuais: só oferece uma pergunta se o dado por trás dela existir de
  // verdade (ver generateContextualSuggestions em blindAIAgentAlgorithm.ts).
  const aiSuggestions = useMemo(
    () => getContextualSuggestions({ situations, globais }),
    [situations, globais]
  );

  // Leituras puras (progresso/acuracidade/melhores linhas/produtos mais vendidos) respondem
  // na hora, sem custo de LLM. Qualquer outra pergunta — priorização, causa raiz, estratégia,
  // follow-ups, perguntas gerais de logística/e-commerce ou sobre o próprio SaaS — vai para o
  // agente real (Claude + tool-calling), rodando na Edge Function blindai-agent. O histórico
  // enviado é o próprio transcript da conversa: essa é a memória do agente, não um objeto à parte.
  const handleSendAIMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim() || aiLoading || !companyId) return;

    const userMessage = aiInput.trim();
    setAiInput('');
    const nextMessages: ChatMessage[] = [...aiMessages, { role: 'user', content: userMessage }];
    setAiMessages(nextMessages);

    const fastAnswer = tryFastPath(userMessage, { globais, topVendas });
    if (fastAnswer !== null) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: fastAnswer }]);
      return;
    }

    setAiLoading(true);
    askBlindAIAgent(nextMessages, companyId)
      .then(reply => {
        setAiMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      })
      .catch(err => {
        console.error('[BlindAI] Error answering question:', err);
        setAiMessages(prev => [...prev, { role: 'assistant', content: err instanceof Error ? err.message : 'Não consegui consultar o agente agora. Tente novamente em instantes.' }]);
      })
      .finally(() => setAiLoading(false));
  };

  const handleAddBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName || !newBrandTotalSku) return;

    const maxOrder = Math.max(0, ...brandsData.map(b => b.order_index));

    const { data, error } = await supabase
      .from('inventory_brands')
      .insert({
        company_id: companyId,
        brand: newBrandName,
        total_sku: parseInt(newBrandTotalSku),
        done_sku: 0,
        divergences: 0,
        order_index: maxOrder + 1
      })
      .select();

    if (error) {
      console.error('Error adding brand:', error);
      return;
    }

    if (data) {
      setBrandsData([...brandsData, data[0]]);
    }

    setNewBrandName('');
    setNewBrandTotalSku('');
    setShowAddBrandModal(false);
  };

  const handleUpdateTopVenda = useCallback(async (index: number, field: keyof TopVenda, value: string) => {
    const item = topVendas[index];
    if (!item) return;

    const { error } = await supabase
      .from('top_vendas')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', item.id);

    if (error) {
      console.error('Error updating venda:', error);
      return;
    }

    setTopVendas(prev => {
      const newVendas = [...prev];
      newVendas[index] = { ...newVendas[index], [field]: value };
      return newVendas;
    });
  }, [topVendas]);

  const handleAddKPI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKPI.titulo || !newKPI.valor) return;

    const maxOrder = Math.max(0, ...customKPIs.map(k => k.order_index));

    const { data, error } = await supabase
      .from('custom_kpis')
      .insert({
        ...newKPI,
        company_id: companyId,
        order_index: maxOrder + 1
      })
      .select();

    if (error) {
      console.error('Error adding KPI:', error);
      return;
    }

    if (data) {
      setCustomKPIs([...customKPIs, data[0]]);
    }

    setNewKPI({
      titulo: '',
      valor: '',
      unidade: '',
      variacao: '',
      tipo_variacao: 'up',
      cor_icone: 'blue'
    });
    setShowAddKPIModal(false);
  };

  const handleDeleteKPI = async (id: string) => {
    const { error } = await supabase
      .from('custom_kpis')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting KPI:', error);
      return;
    }

    setCustomKPIs(customKPIs.filter(kpi => kpi.id !== id));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto animate-spin text-fg-subtle" size={40} />
          <p className="mt-4 text-fg-muted font-medium">Carregando dados...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-surface-2 rounded-sheet border border-edge p-8 max-w-md text-center">
          <AlertTriangle className="mx-auto text-red-500" size={40} />
          <h2 className="mt-4 text-lg font-semibold text-fg">Erro ao carregar</h2>
          <p className="mt-2 text-fg-muted">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-2 bg-accent text-white rounded-lg hover:bg-accent-strong transition"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const navGroups: SidebarNavGroup[] = [
    {
      id: 'dashboard-group',
      label: 'Dashboard',
      items: [
        { id: 'dashboard', label: 'Dashboard',           icon: <LayoutDashboard />, onClick: () => { setActiveTab('dashboard'); setMobileOpen(false); }, active: activeTab === 'dashboard' },
        { id: 'heatmap',   label: 'Heatmap',              icon: <Map />,             onClick: () => { setActiveTab('heatmap'); setMobileOpen(false); },   active: activeTab === 'heatmap' },
        { id: 'kpis',      label: 'KPIs e Indicadores',   icon: <Target />,          onClick: () => { setActiveTab('kpis'); setMobileOpen(false); },      active: activeTab === 'kpis' },
        { id: 'rankings',  label: 'Rankings',             icon: <Award />,           onClick: () => { setActiveTab('rankings'); setMobileOpen(false); },  active: activeTab === 'rankings' },
      ],
    },
    {
      id: 'account-group',
      label: 'Minha Conta',
      items: [
        { id: 'conta', label: 'Produtividade', icon: <User />, onClick: () => { setActiveTab('conta'); setMobileOpen(false); }, active: activeTab === 'conta' },
        { id: 'knowledge', label: 'Recursos e Conhecimento', icon: <BookOpen />, onClick: () => { setActiveTab('knowledge'); setMobileOpen(false); }, active: activeTab === 'knowledge' },
      ],
    },
    {
      id: 'academy-group',
      label: 'I.B Academy',
      items: [
        { id: 'academy', label: 'I.B Academy', icon: <GraduationCap />, onClick: () => { setActiveTab('academy'); setMobileOpen(false); }, active: activeTab === 'academy' },
      ],
    },
    {
      id: 'counting-group',
      label: 'Operações',
      items: [
        { id: 'input',          label: 'Nova Contagem',        icon: <Plus />,        onClick: () => { setActiveTab('input'); setMobileOpen(false); },          active: activeTab === 'input' },
        { id: 'nfe-conference', label: 'Conferência por NF-e', icon: <ScanLine />,    onClick: () => { setActiveTab('nfe-conference'); setMobileOpen(false); }, active: activeTab === 'nfe-conference' },
        { id: 'cbc',            label: 'Confidence Score',     icon: <Gauge />,       onClick: () => { setActiveTab('cbc'); setMobileOpen(false); },            active: activeTab === 'cbc' },
        { id: 'risk',           label: 'Inventário por Risco', icon: <AlertTriangle />, onClick: () => { setActiveTab('risk'); setMobileOpen(false); },         active: activeTab === 'risk' },
        { id: 'abcxyz',         label: 'Classificação ABC/XYZ', icon: <LayoutGrid />, onClick: () => { setActiveTab('abcxyz'); setMobileOpen(false); },   active: activeTab === 'abcxyz' },
        { id: 'slotting',       label: 'Warehouse Digital Twin', icon: <Warehouse />, onClick: () => { setActiveTab('slotting'); setMobileOpen(false); },     active: activeTab === 'slotting' },
        { id: 'rca',            label: 'Root Cause Analysis',  icon: <GitBranch />, onClick: () => { setActiveTab('rca'); setMobileOpen(false); },        active: activeTab === 'rca' },
        { id: 'audit',          label: 'Auditoria de Estoque', icon: <SearchCheck />, onClick: () => { setActiveTab('audit'); setMobileOpen(false); },   active: activeTab === 'audit' },
      ],
    },
    {
      id: 'products-group',
      label: 'Produtos',
      items: [
        { id: 'import',          label: 'Importar Produtos',        icon: <FileSpreadsheet />, onClick: () => { setActiveTab('import'); setMobileOpen(false); },          active: activeTab === 'import' },
        { id: 'import-history',  label: 'Histórico de Importações', icon: <History />,         onClick: () => { setActiveTab('import-history'); setMobileOpen(false); }, active: activeTab === 'import-history' },
        { id: 'products',        label: 'Produtos Importados',      icon: <Package />,         onClick: () => { setActiveTab('products'); setMobileOpen(false); },        active: activeTab === 'products' },
      ],
    },
    {
      id: 'tools-group',
      label: 'Ferramentas',
      items: [
        { id: 'label-generator', label: 'Gerador de Etiquetas', icon: <Tag />, onClick: () => { setActiveTab('label-generator'); setMobileOpen(false); }, active: activeTab === 'label-generator' },
        { id: 'full-manager',    label: 'Full Manager',         icon: <ClipboardCheck />, onClick: () => { setActiveTab('full-manager'); setMobileOpen(false); },    active: activeTab === 'full-manager' },
      ],
    },
    {
      id: 'admin-group',
      label: 'Administração',
      items: [
        { id: 'admin', label: 'Acesso Administrativo', icon: <Lock />, onClick: () => { setActiveTab('admin'); setMobileOpen(false); }, active: activeTab === 'admin' },
        ...(canManageUsers(profile?.role) ? [{ id: 'users', label: 'Usuários', icon: <UserCog />, onClick: () => { setActiveTab('users'); setMobileOpen(false); }, active: activeTab === 'users' }] : []),
        ...(hasPermission(profile?.role, 'security.view') ? [{ id: 'security', label: 'Segurança', icon: <ShieldCheck />, onClick: () => { setActiveTab('security'); setMobileOpen(false); }, active: activeTab === 'security' }] : []),
      ],
    },
    {
      id: 'financeiro-group',
      label: 'Financeiro',
      sectionLabel: 'Em breve',
      locked: true,
      items: [
        { id: 'financeiro-contas',      label: 'Contas a Pagar',         icon: <Receipt />,    onClick: () => {}, active: false, locked: true },
        { id: 'financeiro-relatorios',  label: 'Relatórios Financeiros', icon: <PieChart />,   onClick: () => {}, active: false, locked: true },
        { id: 'financeiro-custos',      label: 'Centro de Custos',       icon: <DollarSign />, onClick: () => {}, active: false, locked: true },
      ],
    },
    {
      id: 'analytics-group',
      label: 'Analytics',
      locked: true,
      items: [
        { id: 'analytics-blindscore', label: 'BlindScore',              icon: <Gauge />,       onClick: () => {}, active: false, locked: true },
        { id: 'analytics-health',     label: 'Inventory Health Score',  icon: <Activity />,    onClick: () => {}, active: false, locked: true },
        { id: 'analytics-ia',         label: 'IA Insights',              icon: <BarChart3 />,    onClick: () => {}, active: false, locked: true },
        { id: 'analytics-audit',      label: 'Auditorias',               icon: <ShieldAlert />, onClick: () => {}, active: false, locked: true },
      ],
    },
    {
      id: 'integracoes-group',
      label: 'Integrações',
      locked: true,
      items: [
        { id: 'integracoes-tiny',  label: 'Tiny ERP', icon: <Boxes />,    onClick: () => {}, active: false, locked: true },
        { id: 'integracoes-bling', label: 'Bling',     icon: <Plug />,    onClick: () => {}, active: false, locked: true },
        { id: 'integracoes-sap',   label: 'SAP',       icon: <Server />,  onClick: () => {}, active: false, locked: true },
        { id: 'integracoes-totvs', label: 'TOTVS',     icon: <Database />, onClick: () => {}, active: false, locked: true },
      ],
    },
    {
      id: 'config-avancada-group',
      label: 'Configurações Avançadas',
      locked: true,
      items: [
        { id: 'config-api',         label: 'API',         icon: <Code2 />,    onClick: () => {}, active: false, locked: true },
        { id: 'config-webhooks',    label: 'Webhooks',    icon: <Webhook />,  onClick: () => {}, active: false, locked: true },
        { id: 'config-automacoes',  label: 'Automações',  icon: <Workflow />, onClick: () => {}, active: false, locked: true },
        { id: 'config-logs',        label: 'Logs',        icon: <FileText />, onClick: () => {}, active: false, locked: true },
      ],
    },
  ];

  const sidebarHeader = (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <div className="w-7 h-7 bg-accent/10 rounded-lg flex items-center justify-center flex-shrink-0">
          <LogoMark size={15} className="text-accent" />
        </div>
        <span className="text-sm font-bold text-fg tracking-tight whitespace-nowrap select-none">
          Inventory<span className="text-fg-subtle font-normal">Blind</span>
        </span>
      </div>
      {company && (
        <SafeDropdown
          className="w-full"
          trigger={
            <button
              disabled={switchingCompany}
              className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-xl bg-surface-2/70 hover:bg-surface-3 border border-edge/70 transition-colors duration-200 disabled:opacity-60"
            >
              <span className="w-6 h-6 rounded-md bg-accent flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
                {company.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 text-left leading-tight">
                <span className="block truncate text-xs font-semibold text-fg">
                  {switchingCompany ? 'Trocando...' : company.name}
                </span>
                <span className="block text-caption">Workspace</span>
              </span>
              {companies.length > 1 && (
                <ChevronDown size={12} className="text-fg-subtle flex-shrink-0 ml-auto transition-transform duration-200 group-hover:translate-y-0.5" />
              )}
            </button>
          }
          items={[
            ...companies.map(c => ({
              id: c.id,
              label: c.name,
              icon: (
                <span className="w-5 h-5 rounded-md bg-accent flex items-center justify-center text-white text-[9px] font-semibold">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
              ),
              active: c.id === company.id,
              onClick: () => switchCompany(c.id),
            })),
            {
              id: 'add-company',
              label: (
                <span className="flex items-center gap-1.5">
                  Adicionar empresa
                  <span className="text-overline bg-surface-3 rounded px-1 py-0.5">Em breve</span>
                </span>
              ),
              icon: <Plus size={14} />,
              disabled: true,
              divider: true,
              onClick: () => {},
            },
          ]}
        />
      )}
      <button
        onClick={() => { setActiveTab('input'); setMobileOpen(false); }}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent-strong text-white text-sm font-semibold rounded-lg transition-colors"
      >
        <Plus size={14} /> Nova Contagem
      </button>
    </div>
  );

  const userMenu = (
    <SafeDropdown
      trigger={
        <button className="group flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl hover:bg-surface-3/70 transition-colors duration-200">
          <span
            title={profile?.email ?? undefined}
            className="relative w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-semibold text-white flex-shrink-0 uppercase"
          >
            {(profile?.email ?? '?').slice(0, 1)}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-surface" />
          </span>
          <div className="hidden xl:block text-left leading-tight">
            <p className="text-xs font-semibold text-fg">{profile?.email?.split('@')[0]}</p>
            <p className="text-caption mt-0.5">{getRoleLabel(profile?.role ?? '')}</p>
          </div>
          <ChevronDown size={12} className="text-fg-subtle hidden xl:block transition-transform duration-200 group-hover:translate-y-0.5" />
        </button>
      }
      items={[
        { id: 'conta', label: 'Minha Conta', icon: <User size={14} />, onClick: () => setActiveTab('conta') },
        ...(hasPermission(profile?.role, 'security.view')
          ? [{ id: 'config', label: 'Configurações', icon: <Settings size={14} />, onClick: () => setActiveTab('security') }]
          : []),
        {
          id: 'theme',
          label: theme === 'dark' ? 'Tema claro' : 'Tema escuro',
          icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
          onClick: toggleTheme,
          divider: true,
        },
        { id: 'empresa', label: company?.name ?? 'Empresa', icon: <Building2 size={14} />, disabled: true, onClick: () => {} },
        ...(canInstall ? [{ id: 'install', label: 'Instalar InventoryBlind', icon: <Download size={14} />, onClick: () => { if (hasPrompt) { promptInstall(); } else { setShowInstallModal(true); } } }] : []),
        { id: 'signout', label: 'Sair', icon: <LogOut size={14} />, onClick: signOut, divider: true },
      ]}
    />
  );

  return (
    // data-app-shell scopes the authenticated app's reduced-motion rules in
    // index.css — the Landing zone resolves motion itself and is excluded.
    <div data-app-shell className="h-screen bg-surface font-sans text-fg flex overflow-hidden">

      {/* ── SIDEBAR (desktop) ─────────────────────────────────────────────── */}
      <Sidebar groups={navGroups} header={sidebarHeader} className="hidden md:flex" />

      {/* ── SIDEBAR (mobile drawer) ──────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[1000] flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 flex h-full">
            <Sidebar
              groups={navGroups}
              header={sidebarHeader}
              footer={
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span className="text-xs text-fg-muted">Tema</span>
                    <ThemeToggle />
                  </div>
                  {canInstall && (
                    <button
                      onClick={() => { if (hasPrompt) { promptInstall(); } else { setShowInstallModal(true); } setMobileOpen(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors text-sm"
                    >
                      <Download size={15} /> Instalar InventoryBlind
                    </button>
                  )}
                  <button onClick={signOut} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors text-sm">
                    <LogOut size={15} /> Sair
                  </button>
                </div>
              }
            />
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 left-full ml-2 p-2 rounded-lg bg-surface-2 border border-edge text-fg-muted"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ── CONTENT COLUMN ────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <AppHeader
          onOpenMobileNav={() => setMobileOpen(true)}
          right={
            <>
              <ThemeToggle className="hidden md:flex" />
              {userMenu}
            </>
          }
        />

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">

        {activeTab !== 'rankings' && activeTab !== 'label-generator' && activeTab !== 'full-manager' && activeTab !== 'users' && (
          <>

        {/* ABA HEATMAP */}
        {activeTab === 'heatmap' && (
          <React.Suspense fallback={<PageLoader />}>
          <HeatmapEstoque
            brandsData={brandsData}
            onRequestAdminAccess={() => {
              if (!isLoggedIn) {
                setActiveTab('admin');
              }
            }}
            isAdmin={isLoggedIn}
            onLogout={() => {}}
          />
          </React.Suspense>
        )}

        {/* ABA PRODUTOS IMPORTADOS */}
        {activeTab === 'products' && (
          <React.Suspense fallback={<PageLoader />}>
          <ImportedProductsPage
            onBack={() => setActiveTab('dashboard')}
            isAdmin={isLoggedIn}
          />
          </React.Suspense>
        )}

        {/* ABA IMPORTAR PRODUTOS */}
        {activeTab === 'import' && (
          <React.Suspense fallback={<PageLoader />}>
          <ProductImportPage
            onBack={() => setActiveTab('dashboard')}
            isAdmin={isLoggedIn}
            onRequestAdmin={() => setActiveTab('admin')}
          />
          </React.Suspense>
        )}

        {/* ABA HISTORICO DE IMPORTACOES */}
        {activeTab === 'import-history' && (
          <React.Suspense fallback={<PageLoader />}>
          <ImportHistoryPage
            onBack={() => setActiveTab('dashboard')}
            isAdmin={isLoggedIn}
            onUndoImport={async (importId: string) => {
              // Undo import logic
              try {
                // Get audit records for this import
                const { data: auditRecords, error: auditError } = await supabase
                  .from('import_products_audit')
                  .select('id, import_id, product_id, sku, action, old_data, new_data, created_at, company_id')
                  .eq('import_id', importId);

                if (auditError) throw auditError;

                // Process each audit record
                for (const record of auditRecords || []) {
                  if (record.action === 'insert') {
                    // Delete the inserted product
                    await supabase.from('products').delete().eq('id', record.product_id);
                  } else if (record.action === 'update') {
                    // Restore the old data
                    await supabase.from('products').update({
                      name: record.old_data.name,
                      sku: record.old_data.sku,
                      ean: record.old_data.ean,
                      location: record.old_data.location,
                      price: record.old_data.price,
                    }).eq('id', record.product_id);
                  }
                }

                // Mark import as undone
                await supabase
                  .from('import_history')
                  .update({
                    status: 'undone',
                    undone_at: new Date().toISOString(),
                  })
                  .eq('id', importId);

                // Delete audit records
                await supabase.from('import_products_audit').delete().eq('import_id', importId);
              } catch (err) {
                console.error('Error undoing import:', err);
                throw err;
              }
            }}
          />
          </React.Suspense>
        )}

      {/* ABA RANKINGS COMPLETOS - rendered outside overflow container */}

        {/* ABA DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">

            {/* VISÃO GERAL: indicadores + BlindAI em um único painel */}
            <Panel>
              <PanelSection padding="lg">
                <StatRow>
                  {([
                    {
                      label: 'Progresso Geral',
                      value: `${globais.progresso.toFixed(1)}%`,
                      context: `${globais.totalDone} de ${globais.totalSku} SKUs`,
                    },
                    {
                      label: 'Acuracidade (IRA)',
                      value: `${globais.acuracidade.toFixed(1)}%`,
                      context: 'Via divergências',
                      // The only figure here whose level is a condition, so the
                      // only one allowed to carry colour.
                      valueTone:
                        globais.acuracidade >= 80 ? 'positive' : globais.acuracidade >= 50 ? 'warning' : 'critical',
                    },
                    { label: 'Tempo de Inventário', value: '44 dias', context: 'Projeção: 27 dias' },
                    { label: 'Divergências', value: globais.totalDiv, context: 'Unidades p/ recontagem' },
                  ] satisfies StatProps[]).map(kpi => (
                    <StatCell key={kpi.label}>
                      <Stat {...kpi} />
                    </StatCell>
                  ))}
                </StatRow>
              </PanelSection>

              <PanelSection padding="lg">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-title flex items-center gap-2">
                      <Bot size={18} className="text-accent" />
                      BlindAI
                    </h3>
                    <p className="text-caption mt-0.5">Situações identificadas na operação</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={loadSituations}
                      disabled={situationsLoading}
                      className="p-2 rounded-control text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors disabled:opacity-50"
                      title="Atualizar análise"
                    >
                      <RefreshCw size={16} className={situationsLoading ? 'animate-spin' : ''} />
                    </button>
                    <button
                      onClick={() => setShowAIChat(!showAIChat)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-control text-accent hover:bg-accent/10 transition-colors font-medium text-sm"
                    >
                      <MessageCircle size={15} />
                      Conversar
                      {showAIChat ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {/* Situações detectadas */}
                <div className="mt-4">
                  {situationsLoading && situations.length === 0 ? (
                    <p className="text-sm text-fg-subtle">Analisando a operação...</p>
                  ) : situations.length === 0 ? (
                    <p className="text-sm text-fg-subtle">Nenhuma situação crítica identificada no momento.</p>
                  ) : (
                    <div className="divide-y divide-edge">
                      {situations.map(s => {
                        const SituationIcon = resolveInsightIcon(s.icon, s.severity);
                        return (
                          <button
                            key={s.id}
                            onClick={() => setActiveTab(s.module)}
                            className="w-full flex items-start gap-3 py-3 first:pt-0 last:pb-0 text-left -mx-1 px-1 rounded-control hover:bg-surface-3/60 transition-colors"
                          >
                            <SituationIcon size={15} className={`flex-shrink-0 mt-0.5 ${INSIGHT_ICON_TONE[s.severity]}`} />
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-fg">{s.title}</p>
                                <Badge variant={SITUATION_SEVERITY_BADGE[s.severity]}>{s.actionLabel}</Badge>
                              </div>
                              <p className="text-sm text-fg-muted">{s.evidence}</p>
                              <ul className="text-xs text-fg-subtle space-y-0.5">
                                {s.reasons.map((reason, idx) => <li key={idx}>• {reason}</li>)}
                              </ul>
                              <p className="flex items-start gap-1 text-xs text-fg-subtle">
                                <ArrowRight size={12} className="mt-0.5 flex-shrink-0" />
                                {s.recommendation}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Chat: apoio secundário, não o produto principal */}
                {showAIChat && (
                  <div className="mt-4 bg-surface rounded-container border border-edge overflow-hidden">
                    {/* Chat Messages */}
                    <div className="overflow-y-auto p-4 space-y-3" style={{ maxHeight: '300px' }}>
                      {aiMessages.length === 0 && (
                        <div className="text-center py-4">
                          <Bot size={28} className="mx-auto text-fg-subtle mb-2" />
                          <p className="text-fg-subtle text-sm">
                            Pergunte sobre prioridades, risco, divergências ou estratégia de contagem.
                          </p>
                          <div className="flex flex-wrap gap-2 justify-center mt-3">
                            {aiSuggestions.map((q) => (
                              <button
                                key={q}
                                onClick={() => {
                                  setAiInput(q);
                                }}
                                className="px-3 py-1.5 bg-surface-2 hover:bg-edge rounded-full text-xs text-fg-muted transition"
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {aiMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-control px-4 py-2 text-sm whitespace-pre-wrap ${
                              msg.role === 'user'
                                ? 'bg-accent text-white'
                                : 'bg-surface-2 text-fg'
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {aiLoading && (
                        <div className="flex justify-start">
                          <div className="bg-surface-2 rounded-control px-4 py-2 flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin text-fg-subtle" />
                            <span className="text-fg-subtle text-sm">Analisando...</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Chat Input */}
                    <form onSubmit={handleSendAIMessage} className="border-t border-edge p-3 flex gap-2">
                      <input
                        type="text"
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        placeholder="Pergunte sobre o inventário..."
                        className="flex-1 bg-surface-2 text-fg placeholder-fg-subtle rounded-control px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                        disabled={aiLoading}
                      />
                      <button
                        type="submit"
                        disabled={aiLoading || !aiInput.trim()}
                        className="bg-accent hover:bg-accent-strong text-white px-4 py-2 rounded-control transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send size={18} />
                      </button>
                    </form>
                  </div>
                )}
              </PanelSection>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

              {/* COLUNA ESQUERDA: Saúde + Rankings, painel único */}
              <Panel className="lg:col-span-1">
                <PanelSection>
                  <p className="text-section">Índice de Saúde do Estoque</p>
                  <div className="flex items-center gap-2 mt-2">
                    <healthStatus.icon size={20} className={healthStatus.iconColor} />
                    <span className={`text-title ${healthStatus.color}`}>
                      {healthStatus.label}
                    </span>
                  </div>
                </PanelSection>

                <DashboardRankingPreview
                  melhores={globais.melhores}
                  piores={globais.piores}
                  inProgress={globais.tabela.filter(b => b.status === 'ANDAMENTO')}
                  onViewAll={() => setActiveTab('rankings')}
                />
              </Panel>

              {/* COLUNA DIREITA: Tabela de Controle — protagonista */}
              <Panel className="lg:col-span-2 flex flex-col">
                <PanelSection padding="sm" className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <h3 className="text-title">Controle e Desempenho por Linha</h3>
                  <span className="text-caption">Total: {globais.totalSku.toLocaleString('pt-BR')} SKUs</span>
                </PanelSection>

                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-sm text-left whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-edge">
                        <th className="px-6 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide">Linha / Marca</th>
                        <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Total</th>
                        <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Concluídos</th>
                        <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Progresso</th>
                        <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Acuracidade</th>
                        <th className="px-6 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {globais.tabela.map((row) => (
                        <tr key={row.id} className="border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors">
                          <td className="px-6 py-3.5 font-medium text-fg">{row.brand}</td>
                          <td className="px-3 py-3.5 text-center text-fg-muted text-numeric">{row.totalSku}</td>
                          <td className="px-3 py-3.5 text-center font-semibold text-fg text-numeric">{row.doneSku}</td>
                          <td className="px-3 py-3.5 text-center text-fg-muted text-numeric text-xs">{row.progress.toFixed(1)}%</td>
                          <td className="px-3 py-3.5 text-center font-semibold text-fg text-numeric">
                            {row.accuracy !== null ? `${row.accuracy.toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <span className={`text-xs font-medium ${
                              row.status === 'CONCLUÍDO' ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-subtle'
                            }`}>
                              {row.status === 'CONCLUÍDO' ? 'Concluído' : 'Em andamento'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

            </div>
          </div>
        )}

        {/* ABA ADMIN */}
        {activeTab === 'admin' && (
          <div className="max-w-4xl mx-auto p-4 md:p-6 lg:p-8">
            {!isLoggedIn ? (
              <Panel className="max-w-md mx-auto mt-6">
                <PanelSection padding="lg" className="text-center">
                  <Lock size={32} className="mx-auto mb-3 text-fg-subtle" />
                  <h2 className="text-title">Acesso Restrito</h2>
                  <p className="text-fg-muted text-sm mt-2">Esta área é restrita a administradores e proprietários.</p>
                  <p className="text-caption mt-3">Perfil atual: {profile?.role ?? '—'}</p>
                </PanelSection>
              </Panel>
            ) : (
              // PAINEL ADMINISTRATIVO
              <div className="space-y-8">
                <div>
                  <h2 className="text-title flex items-center gap-2">
                    <Edit size={18} className="text-fg-subtle" /> Painel Administrativo
                  </h2>
                  <p className="text-caption mt-1">Altere parâmetros do sistema e dados gerenciais.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Edição Top Vendas */}
                  <Panel>
                    <PanelSection padding="sm">
                      <h3 className="text-title">Editar Top 10 Vendas</h3>
                    </PanelSection>
                    <PanelSection className="overflow-x-auto">
                       <table className="w-full text-xs text-left">
                         <thead>
                           <tr className="border-b border-edge">
                             <th className="pb-2 font-medium text-fg-subtle uppercase tracking-wide">Produto</th>
                             <th className="pb-2 font-medium text-fg-subtle uppercase tracking-wide">SKU</th>
                             <th className="pb-2 text-right font-medium text-fg-subtle uppercase tracking-wide">Vendas</th>
                           </tr>
                         </thead>
                         <tbody>
                           {topVendas.map((item, idx) => (
                             <tr key={item.id} className="border-b border-edge/60 last:border-0">
                               <td className="py-2 pr-2"><input type="text" className="w-full border border-edge rounded px-2 py-1 text-xs bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" value={item.produto} onChange={(e) => handleUpdateTopVenda(idx, 'produto', e.target.value)} /></td>
                               <td className="py-2 pr-2"><input type="text" className="w-full border border-edge rounded px-2 py-1 text-xs font-mono bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" value={item.sku} onChange={(e) => handleUpdateTopVenda(idx, 'sku', e.target.value)} /></td>
                               <td className="py-2"><input type="text" className="w-full border border-edge rounded px-2 py-1 text-xs text-right font-semibold bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" value={item.vendas} onChange={(e) => handleUpdateTopVenda(idx, 'vendas', e.target.value)} /></td>
                             </tr>
                           ))}
                         </tbody>
                       </table>
                    </PanelSection>
                  </Panel>

                  {/* Edição Linhas */}
                  <Panel className="flex flex-col">
                     <PanelSection padding="sm">
                       <h3 className="text-title">Gerenciamento de Marcas / Linhas</h3>
                     </PanelSection>
                     <PanelSection className="flex-1 flex flex-col justify-center items-center text-center">
                        <Package size={32} className="text-fg-subtle mb-3"/>
                        <p className="text-sm text-fg-muted mb-4">Para adicionar uma nova linha ao controle do inventário principal, clique no botão abaixo.</p>
                        <button
                          onClick={() => setShowAddBrandModal(true)}
                          className="bg-accent hover:bg-accent-strong text-white font-semibold py-3 px-6 rounded-lg transition w-full"
                        >
                          + Cadastrar Nova Linha no Estoque
                        </button>
                     </PanelSection>
                  </Panel>
                </div>

                {/* Gerenciamento de KPIs */}
                <Panel>
                  <PanelSection padding="sm">
                    <h3 className="text-title flex items-center gap-2">
                      <Target size={16} className="text-fg-subtle" />
                      Gerenciamento de KPIs e Indicadores
                    </h3>
                  </PanelSection>
                  <PanelSection>
                    <div className="divide-y divide-edge mb-4">
                      {customKPIs.map((kpi) => (
                        <div key={kpi.id} className="flex items-center justify-between gap-3 py-3 group">
                          <div className="min-w-0">
                            <p className="text-caption uppercase">{kpi.titulo}</p>
                            <p className="text-lg font-semibold text-fg mt-1">{kpi.valor} <span className="text-sm font-normal text-fg-muted">{kpi.unidade}</span></p>
                            <p className="text-caption mt-1 truncate">{kpi.variacao}</p>
                          </div>
                          <button
                            onClick={() => handleDeleteKPI(kpi.id)}
                            className="text-fg-subtle hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setShowAddKPIModal(true)}
                      className="w-full bg-accent hover:bg-accent-strong text-white font-semibold py-3 px-4 rounded-lg transition flex items-center justify-center gap-2"
                    >
                      <Plus size={18} />
                      Adicionar Novo KPI
                    </button>
                  </PanelSection>
                </Panel>

                {/* Reset e Histórico de Inventários */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Reset de Inventário */}
                  <Panel>
                    <PanelSection padding="sm">
                      <h3 className="text-title flex items-center gap-2">
                        <RotateCcw size={16} className="text-fg-subtle" />
                        Reset de Inventário
                      </h3>
                    </PanelSection>
                    <PanelSection>
                      <p className="text-sm text-fg-muted mb-4">
                        Ao resetar, o inventário atual será arquivado com todos os dados de progresso, acuracidade e divergências.
                        As contagens serão zeradas para iniciar um novo ciclo.
                      </p>
                      <div className="bg-amber-500/10 rounded-lg p-3 mb-4">
                        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                          Os dados serão salvos permanentemente no histórico e poderão ser consultados a qualquer momento.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowResetModal(true)}
                        disabled={resetProgress}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {resetProgress ? (
                          <>
                            <Loader2 size={18} className="animate-spin" />
                            Arquivando...
                          </>
                        ) : (
                          <>
                            <Archive size={18} />
                            Arquivar e Resetar Inventário
                          </>
                        )}
                      </button>
                    </PanelSection>
                  </Panel>

                  {/* Histórico de Inventários */}
                  <Panel>
                    <PanelSection padding="sm">
                      <h3 className="text-title flex items-center gap-2">
                        <History size={16} className="text-fg-subtle" />
                        Histórico de Inventários
                      </h3>
                    </PanelSection>
                    <PanelSection className="overflow-y-auto" style={{ maxHeight: '400px' }}>
                      {snapshots.length === 0 ? (
                        <p className="text-sm text-fg-subtle text-center py-4">
                          Nenhum inventário arquivado ainda.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {snapshots.map((snapshot) => (
                            <div
                              key={snapshot.id}
                              className="bg-surface-3 rounded-lg p-3 hover:bg-edge/60 transition cursor-pointer"
                              onClick={() => handleViewSnapshot(snapshot)}
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-semibold text-fg text-sm">{snapshot.name}</p>
                                  <p className="text-caption mt-1">
                                    {new Date(snapshot.end_date).toLocaleDateString('pt-BR', {
                                      day: '2-digit',
                                      month: 'long',
                                      year: 'numeric'
                                    })}
                                  </p>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleViewSnapshot(snapshot);
                                    setShowHistoryModal(true);
                                  }}
                                  className="text-accent hover:text-accent-strong text-xs font-medium flex items-center gap-1"
                                >
                                  <Eye size={14} />
                                  Ver
                                </button>
                              </div>
                              <div className="flex gap-4 mt-2 text-xs text-fg-muted">
                                <span>
                                  Progresso: <span className="font-semibold text-fg">{snapshot.progress.toFixed(1)}%</span>
                                </span>
                                <span>
                                  Acuracidade: <span className="font-semibold text-fg">{snapshot.accuracy.toFixed(1)}%</span>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </PanelSection>
                  </Panel>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ABA KPIs E INDICADORES */}
        {activeTab === 'kpis' && (
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">
            {/* KPI Cards - Dinâmicos, uma única faixa */}
            {customKPIs.length > 0 && (
              <Panel>
                <PanelSection padding="lg">
                  {/* The per-KPI icon used to sit in a coloured badge driven by a
                      `cor_icone` column — colour chosen for variety, not meaning.
                      The glyph stays as a quiet leading mark; the variation keeps
                      its existing up/down semantics through the trend slot. */}
                  <StatRow className="md:grid-cols-2">
                    {customKPIs.map(kpi => (
                      <StatCell key={kpi.id}>
                        <Stat
                          label={kpi.titulo}
                          icon={
                            kpi.cor_icone === 'red' ? <AlertTriangle /> :
                            kpi.cor_icone === 'amber' ? <Clock /> :
                            kpi.cor_icone === 'emerald' ? <Users /> :
                            <Zap />
                          }
                          value={
                            <>
                              {kpi.valor}
                              {kpi.unidade && (
                                <span className="ml-1 text-base font-normal text-fg-muted">{kpi.unidade}</span>
                              )}
                            </>
                          }
                          trend={
                            kpi.variacao
                              ? {
                                  value: kpi.variacao,
                                  direction:
                                    kpi.tipo_variacao === 'up' ? 'up' : kpi.tipo_variacao === 'down' ? 'down' : 'flat',
                                  intent:
                                    kpi.tipo_variacao === 'up' ? 'positive' : kpi.tipo_variacao === 'down' ? 'negative' : 'neutral',
                                }
                              : undefined
                          }
                        />
                      </StatCell>
                    ))}
                  </StatRow>
                </PanelSection>
              </Panel>
            )}

            {/* Desempenho por Operador + Indicadores de Processo */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <Panel>
                <PanelSection padding="sm">
                  <h3 className="text-title flex items-center gap-2">
                    <Users size={16} className="text-fg-subtle" />
                    Desempenho por Operador
                  </h3>
                </PanelSection>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-edge">
                        <th className="p-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">Operador</th>
                        <th className="p-3 text-center font-medium text-fg-subtle text-xs uppercase tracking-wide">SKUs Dia</th>
                        <th className="p-3 text-center font-medium text-fg-subtle text-xs uppercase tracking-wide">Acuracidade</th>
                        <th className="p-3 text-center font-medium text-fg-subtle text-xs uppercase tracking-wide">Tendência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { nome: 'Davi', skus: 65, acuracidade: 94.1, tendencia: 'up' },
                        { nome: 'Jackson', skus: 52, acuracidade: 79.2, tendencia: 'up' },
                        { nome: 'Willian', skus: 48, acuracidade: 64.1, tendencia: 'down' },
                        { nome: 'Geovanna', skus: 45, acuracidade: 51.8, tendencia: 'up' },
                        { nome: 'Leo', skus: 42, acuracidade: 29.2, tendencia: 'down' },
                        { nome: 'Giovani', skus: 38, acuracidade: null, tendencia: 'up' },
                      ].map((op, idx) => (
                        <tr key={idx} className="border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors">
                          <td className="p-3 font-medium text-fg">{op.nome}</td>
                          <td className="p-3 text-center font-semibold text-fg">{op.skus}</td>
                          <td className="p-3 text-center">
                            <span className={`font-semibold ${op.acuracidade !== null ? (op.acuracidade >= 80 ? 'text-emerald-600 dark:text-emerald-400' : op.acuracidade >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400') : 'text-fg-subtle'}`}>
                              {op.acuracidade !== null ? `${op.acuracidade.toFixed(1)}%` : 'Em andamento'}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            {op.tendencia === 'up' ? (
                              <ArrowUpRight size={16} className="mx-auto text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <ArrowDownRight size={16} className="mx-auto text-red-600 dark:text-red-400" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              {/* Indicadores de Processo */}
              <Panel>
                <PanelSection padding="sm">
                  <h3 className="text-title flex items-center gap-2">
                    <BarChart2 size={16} className="text-fg-subtle" />
                    Indicadores de Processo
                  </h3>
                </PanelSection>
                <PanelSection className="space-y-5">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-fg-muted">Taxa de Conclusão Diária</span>
                      <span className="text-sm font-semibold text-fg">85.4%</span>
                    </div>
                    <div className="h-1.5 bg-edge rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: '85.4%' }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-fg-muted">Meta de Acuracidade</span>
                      <span className="text-sm font-semibold text-fg">{globais.acuracidade.toFixed(1)}% / 95%</span>
                    </div>
                    <div className="h-1.5 bg-edge rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${globais.acuracidade >= 95 ? 'bg-emerald-500' : globais.acuracidade >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, (globais.acuracidade / 95) * 100)}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-fg-muted">Cobertura de Estoque</span>
                      <span className="text-sm font-semibold text-fg">{globais.progresso.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-edge rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: `${globais.progresso}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-fg-muted">Divergências Recontadas</span>
                      <span className="text-sm font-semibold text-fg">72.3%</span>
                    </div>
                    <div className="h-1.5 bg-edge rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: '72.3%' }}></div>
                    </div>
                  </div>
                </PanelSection>
              </Panel>
            </div>

            {/* Resumo Executivo */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <Panel className="lg:col-span-2">
                <PanelSection padding="sm">
                  <h3 className="text-title flex items-center gap-2">
                    <Target size={16} className="text-fg-subtle" />
                    Resumo Executivo
                  </h3>
                </PanelSection>
                <PanelSection>
                  <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-edge">
                    <div className="text-center px-2">
                      <p className="text-display">{globais.totalSku.toLocaleString('pt-BR')}</p>
                      <p className="text-caption mt-1">Total SKUs</p>
                    </div>
                    <div className="text-center px-2">
                      <p className="text-display text-emerald-600 dark:text-emerald-400">{globais.totalDone.toLocaleString('pt-BR')}</p>
                      <p className="text-caption mt-1">Contabilizados</p>
                    </div>
                    <div className="text-center px-2">
                      <p className="text-display text-fg">{(globais.totalSku - globais.totalDone).toLocaleString('pt-BR')}</p>
                      <p className="text-caption mt-1">Pendentes</p>
                    </div>
                    <div className="text-center px-2">
                      <p className="text-display text-red-600 dark:text-red-400">{globais.totalDiv}</p>
                      <p className="text-caption mt-1">Divergências</p>
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-accent/10 rounded-lg">
                    <h4 className="font-semibold text-accent text-sm mb-1.5">Projeção de Conclusão</h4>
                    <p className="text-sm text-fg-muted">
                      Com base na produtividade média de <strong className="text-fg">48 SKUs/dia</strong>, o inventário será concluído em aproximadamente <strong className="text-fg">{Math.ceil((globais.totalSku - globais.totalDone) / 48)} dias úteis</strong>.
                    </p>
                  </div>
                </PanelSection>
              </Panel>

              <Panel>
                <PanelSection padding="sm">
                  <h3 className="text-title flex items-center gap-2">
                    <Activity size={16} className="text-fg-subtle" />
                    Status Atual
                  </h3>
                </PanelSection>
                <PanelSection className="space-y-1">
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-fg-muted">Linhas Concluídas</span>
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{globais.tabela.filter(b => b.status === 'CONCLUÍDO').length}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-fg-muted">Em Andamento</span>
                    <span className="text-sm font-semibold text-fg-subtle">{globais.tabela.filter(b => b.status === 'ANDAMENTO').length}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-fg-muted">Próx. Meta</span>
                    <span className="text-sm font-semibold text-fg">95% Acuracidade</span>
                  </div>
                </PanelSection>
              </Panel>
            </div>
          </div>
        )}

        {/* ABA NOVA CONTAGEM */}
        {activeTab === 'input' && (
          <CountManagementCenter
            brandsData={brandsData}
            companyId={companyId}
            onBrandsUpdated={setBrandsData}
          />
        )}

        {/* ABA PRODUTIVIDADE */}
        {activeTab === 'conta' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <ProductivityTab
              userId={profile.id}
              userEmail={profile.email ?? ''}
              companyId={companyId}
              role={profile.role}
            />
          </React.Suspense>
        )}

        {/* ABA RECURSOS E CONHECIMENTO */}
        {activeTab === 'knowledge' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <KnowledgeCenterPage onNavigateToAcademy={() => setActiveTab('academy')} />
          </React.Suspense>
        )}

        {/* ABA CBC — CONFIDENCE BASED COUNTING */}
        {activeTab === 'cbc' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <CBCDashboardPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} />
          </React.Suspense>
        )}

        {/* ABA INVENTÁRIO POR RISCO */}
        {activeTab === 'risk' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <RiskDashboardPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} />
          </React.Suspense>
        )}

        {/* ABA CLASSIFICAÇÃO ABC/XYZ */}
        {activeTab === 'abcxyz' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <AbcXyzDashboardPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} />
          </React.Suspense>
        )}

        {/* ABA WAREHOUSE DIGITAL TWIN */}
        {activeTab === 'slotting' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <WarehouseDigitalTwinPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} role={profile.role} />
          </React.Suspense>
        )}

        {/* ABA ROOT CAUSE ANALYSIS */}
        {activeTab === 'rca' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <RcaDashboardPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} role={profile.role} />
          </React.Suspense>
        )}

        {/* ABA AUDITORIA DE ESTOQUE */}
        {activeTab === 'audit' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <AuditDashboardPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} role={profile.role} />
          </React.Suspense>
        )}

        {/* ABA I.B ACADEMY */}
        {activeTab === 'academy' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <AcademyRouter
              userId={profile.id}
              userEmail={profile.email ?? ''}
              userName={profile.name ?? profile.email?.split('@')[0] ?? 'Colaborador'}
              companyId={companyId}
              role={profile.role}
            />
          </React.Suspense>
        )}

          </> /* end activeTab !== 'rankings' && activeTab !== 'label-generator' && activeTab !== 'full-manager' */
        )}

      </main>

      {/* ABA RANKINGS COMPLETOS - rendered as full page, outside overflow container */}
      {activeTab === 'rankings' && (
        <div className="fixed inset-0 md:left-56 z-[900] bg-surface overflow-y-auto">
          <React.Suspense fallback={<PageLoader />}>
          <RankingsPage
            onBack={() => setActiveTab('dashboard')}
            brandsData={globais.tabela}
            topVendas={topVendas}
            opCapas={opCapas}
            melhores={globais.melhores}
            piores={globais.piores}
            inProgress={globais.tabela.filter(b => b.status === 'ANDAMENTO')}
          />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: GERADOR DE ETIQUETAS */}
      {activeTab === 'label-generator' && (
        <div className="fixed inset-0 md:left-56 z-[900] bg-surface overflow-y-auto">
          <React.Suspense fallback={<PageLoader />}>
          <LabelGeneratorPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: FULL MANAGER */}
      {activeTab === 'full-manager' && (
        <div className="fixed inset-0 md:left-56 z-[900] bg-surface overflow-y-auto">
          <React.Suspense fallback={<PageLoader />}>
          <FullManagerPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* CONFERÊNCIA CEGA POR NF-E */}
      {activeTab === 'nfe-conference' && (
        <div className="fixed inset-0 md:left-56 z-[900] bg-surface overflow-y-auto">
          <React.Suspense fallback={<PageLoader />}>
          <NFeConferencePage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* GERENCIAMENTO DE USUÁRIOS */}
      {activeTab === 'users' && (
        <div className="fixed inset-0 md:left-56 z-[900] bg-surface overflow-y-auto">
          <React.Suspense fallback={<PageLoader />}>
          <UserManagementPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* CENTRAL DE SEGURANÇA */}
      {activeTab === 'security' && (
        <div className="fixed inset-0 md:left-56 z-[900] bg-surface overflow-y-auto">
          <React.Suspense fallback={<PageLoader />}>
          <SecurityPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* MODAL ADICIONAR MARCA/LINHA */}
      <Modal open={showAddBrandModal} onClose={() => setShowAddBrandModal(false)} title="Nova Linha/Marca" maxWidth="max-w-md">
        <form onSubmit={handleAddBrand} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Nome da Linha / Marca</label>
            <input
              type="text" required value={newBrandName} onChange={e => setNewBrandName(e.target.value)}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              placeholder="Ex: Linha Premium AZ"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Total de SKUs Esperados</label>
            <input
              type="number" required min="1" value={newBrandTotalSku} onChange={e => setNewBrandTotalSku(e.target.value)}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              placeholder="Ex: 150"
            />
          </div>
          <button type="submit" className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent-strong transition mt-2">
            Cadastrar Linha
          </button>
        </form>
      </Modal>

      {/* MODAL ADICIONAR KPI */}
      <Modal open={showAddKPIModal} onClose={() => setShowAddKPIModal(false)} title="Novo KPI / Indicador" maxWidth="max-w-md">
        <form onSubmit={handleAddKPI} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Título do KPI</label>
            <input
              type="text" required value={newKPI.titulo} onChange={e => setNewKPI({...newKPI, titulo: e.target.value})}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              placeholder="Ex: Taxa de Aprovação"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Valor</label>
              <input
                type="text" required value={newKPI.valor} onChange={e => setNewKPI({...newKPI, valor: e.target.value})}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
                placeholder="Ex: 95.5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Unidade</label>
              <input
                type="text" value={newKPI.unidade} onChange={e => setNewKPI({...newKPI, unidade: e.target.value})}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
                placeholder="Ex: %"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Variação / Descrição</label>
            <input
              type="text" value={newKPI.variacao} onChange={e => setNewKPI({...newKPI, variacao: e.target.value})}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              placeholder="Ex: +5% vs mês anterior"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Tipo de Variação</label>
              <select
                value={newKPI.tipo_variacao}
                onChange={e => setNewKPI({...newKPI, tipo_variacao: e.target.value as 'up' | 'down' | 'neutral'})}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              >
                <option value="up">Subiu (↑)</option>
                <option value="down">Caiu (↓)</option>
                <option value="neutral">Neutro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Cor do Ícone</label>
              <select
                value={newKPI.cor_icone}
                onChange={e => setNewKPI({...newKPI, cor_icone: e.target.value as 'blue' | 'red' | 'amber' | 'emerald'})}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              >
                <option value="blue">Azul</option>
                <option value="red">Vermelho</option>
                <option value="amber">Âmbar</option>
                <option value="emerald">Verde</option>
              </select>
            </div>
          </div>
          <button type="submit" className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent-strong transition mt-2 flex items-center justify-center gap-2">
            <Plus size={18} />
            Cadastrar KPI
          </button>
        </form>
      </Modal>

      {/* MODAL RESET DE INVENTÁRIO */}
      <Modal open={showResetModal} onClose={() => setShowResetModal(false)} title="Arquivar e Resetar Inventário" maxWidth="max-w-md">
        <form onSubmit={(e) => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const formData = new FormData(form);
          handleResetInventory(
            formData.get('name') as string,
            formData.get('notes') as string
          );
        }} className="space-y-4">
          <div className="bg-red-500/10 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-400">
              Esta ação irá arquivar o inventário atual com todos os dados e iniciar um novo ciclo.
              <strong> Os dados das marcas serão mantidos, mas as contagens serão zeradas.</strong>
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Nome do Inventário Arquivado</label>
            <input
              type="text"
              name="name"
              required
              defaultValue={`Inventário ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/40 bg-surface text-fg"
              placeholder="Ex: Inventário Junho 2026"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Observações (opcional)</label>
            <textarea
              name="notes"
              rows={3}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/40 bg-surface text-fg resize-none"
              placeholder="Ex: Inventário finalizado com sucesso..."
            />
          </div>
          <div className="bg-surface-3 rounded-lg p-3">
            <p className="text-xs text-fg-muted mb-2 font-medium">Resumo do Inventário Atual:</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-fg-muted">
              <span>Total SKUs: <strong className="text-fg">{globais.totalSku}</strong></span>
              <span>Contabilizados: <strong className="text-fg">{globais.totalDone}</strong></span>
              <span>Divergências: <strong className="text-fg">{globais.totalDiv}</strong></span>
              <span>Acuracidade: <strong className="text-fg">{globais.acuracidade.toFixed(1)}%</strong></span>
            </div>
          </div>
          <button
            type="submit"
            disabled={resetProgress}
            className="w-full bg-red-600 text-white font-semibold py-3 rounded-lg hover:bg-red-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {resetProgress ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Archive size={18} />
                Confirmar Arquivamento e Reset
              </>
            )}
          </button>
        </form>
      </Modal>

      {/* MODAL HISTÓRICO DE INVENTÁRIO */}
      <Modal
        open={showHistoryModal && !!selectedSnapshot}
        onClose={() => {
          setShowHistoryModal(false);
          setSelectedSnapshot(null);
          setSnapshotBrands([]);
        }}
        title={selectedSnapshot?.name}
        maxWidth="max-w-5xl"
      >
        {selectedSnapshot && (
          <div className="space-y-6">
            {/* Resumo do Inventório Arquivado */}
            <Panel>
              <PanelSection padding="sm">
                <h4 className="text-title flex items-center gap-2">
                  <Calendar size={16} className="text-fg-subtle" />
                  Informações do Inventário
                </h4>
              </PanelSection>
              <PanelSection>
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-edge">
                  <div className="text-center px-2">
                    <p className="text-caption">Início</p>
                    <p className="text-sm font-semibold text-fg mt-1">
                      {new Date(selectedSnapshot.start_date).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="text-center px-2">
                    <p className="text-caption">Término</p>
                    <p className="text-sm font-semibold text-fg mt-1">
                      {new Date(selectedSnapshot.end_date).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="text-center px-2">
                    <p className="text-caption">Progresso</p>
                    <p className="text-title text-emerald-600 dark:text-emerald-400 mt-1">{selectedSnapshot.progress.toFixed(1)}%</p>
                  </div>
                  <div className="text-center px-2">
                    <p className="text-caption">Acuracidade</p>
                    <p className="text-title text-accent mt-1">{selectedSnapshot.accuracy.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 divide-x divide-edge mt-4 pt-4 border-t border-edge">
                  <div className="text-center px-2">
                    <p className="text-caption">Total SKUs</p>
                    <p className="text-sm font-semibold text-fg mt-1">{selectedSnapshot.total_sku}</p>
                  </div>
                  <div className="text-center px-2">
                    <p className="text-caption">Contabilizados</p>
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-1">{selectedSnapshot.total_done}</p>
                  </div>
                  <div className="text-center px-2">
                    <p className="text-caption">Divergências</p>
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400 mt-1">{selectedSnapshot.total_divergences}</p>
                  </div>
                </div>
                {selectedSnapshot.notes && (
                  <div className="mt-4 bg-amber-500/10 rounded-lg p-3">
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Observações:</p>
                    <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">{selectedSnapshot.notes}</p>
                  </div>
                )}
              </PanelSection>
            </Panel>

            {/* Tabela de Marcas do Histórico */}
            <Panel>
              <PanelSection padding="sm">
                <h4 className="text-title">Desempenho por Linha/Marca</h4>
              </PanelSection>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-edge">
                      <th className="px-4 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide">Linha / Marca</th>
                      <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Total SKU</th>
                      <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Concluídos</th>
                      <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Divergências</th>
                      <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Progresso</th>
                      <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Acuracidade</th>
                      <th className="px-4 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshotBrands.map((brand, idx) => (
                      <tr key={idx} className="border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-fg">{brand.brand}</td>
                        <td className="px-3 py-2.5 text-center text-fg-muted">{brand.total_sku}</td>
                        <td className="px-3 py-2.5 text-center font-semibold text-fg">{brand.done_sku}</td>
                        <td className="px-3 py-2.5 text-center text-red-600 dark:text-red-400 font-semibold">{brand.divergences}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-xs text-fg-muted font-mono">{brand.progress.toFixed(1)}%</span>
                        </td>
                        <td className="px-3 py-2.5 text-center font-semibold">
                          {brand.accuracy !== null ? (
                            <span className={brand.accuracy >= 80 ? 'text-emerald-600 dark:text-emerald-400' : brand.accuracy >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}>
                              {brand.accuracy.toFixed(1)}%
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-xs font-medium ${
                            brand.status === 'CONCLUÍDO' ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-subtle'
                          }`}>
                            {brand.status === 'CONCLUÍDO' ? 'Concluído' : 'Em andamento'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}
      </Modal>

      {/* PWA Install Instructions Modal (iOS) */}
      {showInstallModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowInstallModal(false)}>
          <div className="bg-surface-2 border border-edge rounded-sheet p-6 max-w-sm mx-4 shadow-overlay" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center">
                <Smartphone size={20} className="text-accent" />
              </div>
              <h3 className="text-lg font-bold text-fg">Instalar InventoryBlind</h3>
            </div>
            <p className="text-fg-muted text-sm mb-4">Para instalar no iPhone ou iPad:</p>
            <ol className="space-y-3 text-sm text-fg-muted">
              <li className="flex gap-2"><span className="font-bold text-accent">1.</span> Abra esta página no Safari</li>
              <li className="flex gap-2"><span className="font-bold text-accent">2.</span> Toque no botão <strong>Compartilhar</strong></li>
              <li className="flex gap-2"><span className="font-bold text-accent">3.</span> Selecione <strong>"Adicionar à Tela de Início"</strong></li>
            </ol>
            <button onClick={() => setShowInstallModal(false)} className="w-full mt-5 py-3 bg-surface-3 hover:bg-edge text-fg rounded-xl font-semibold text-sm transition">
              Entendi
            </button>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}

// ── Link Company screen ───────────────────────────────────────────────────────

function LinkCompanyScreen() {
  const { linkToAZ, createCompany, signOut, user } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [linkingAZ, setLinkingAZ] = useState(false);
  const [error, setError] = useState('');

  // This screen is a recovery path — the golden signup flow creates the
  // company via create_company_onboarding() right after signUp() and never
  // lands here. A user only reaches this if that RPC call failed (network
  // blip) or their profile predates onboarding. "Vincular à empresa AZ" is a
  // legacy dev/demo shortcut, not a real option for a genuine new tenant —
  // keep it visible only for the one account it was ever meant for.
  const isDevOwner = user?.email === 'victor@azbuy.com.br';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) { setError('Informe o nome da empresa.'); return; }
    setCreating(true);
    setError('');
    try {
      await createCompany(companyName.trim());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[LinkCompanyScreen] createCompany error:', msg);
      setError('Não foi possível concluir a configuração da empresa. Tente novamente.');
      setCreating(false);
    }
  };

  const handleLinkAZ = async () => {
    setLinkingAZ(true);
    setError('');
    try {
      await linkToAZ();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[LinkCompanyScreen] linkToAZ error:', msg);
      setError(msg);
      setLinkingAZ(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface-2 border border-edge rounded-sheet p-8 text-center shadow-overlay">
        <div className="w-14 h-14 bg-accent/10 rounded-container flex items-center justify-center mx-auto mb-5">
          <LogoMark size={28} className="text-accent" />
        </div>
        <h2 className="text-xl font-bold text-fg mb-2">Configurar Empresa</h2>
        <p className="text-fg-subtle text-sm mb-1">Logado como</p>
        <p className="text-fg text-sm font-semibold mb-6">{user?.email}</p>
        <p className="text-fg-muted text-sm mb-6">
          Sua conta está ativa mas ainda não está vinculada a uma empresa. Crie a sua para continuar.
        </p>
        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 text-left">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-red-400" />
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}
        <form onSubmit={handleCreate} className="text-left mb-3">
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1.5">
            Nome da Empresa
          </label>
          <input
            type="text"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="Minha Empresa Ltda"
            className="w-full px-4 py-3 mb-3 bg-surface border border-edge rounded-xl text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition"
          />
          <button
            type="submit"
            disabled={creating}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-accent hover:bg-accent-strong disabled:opacity-60 text-white rounded-xl font-bold text-sm transition"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : 'Criar minha empresa'}
          </button>
        </form>
        {isDevOwner && (
          <button
            onClick={handleLinkAZ}
            disabled={linkingAZ}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-fg-subtle hover:text-fg-muted disabled:opacity-60 text-xs transition mb-3"
          >
            {linkingAZ ? <Loader2 size={14} className="animate-spin" /> : 'Vincular à empresa AZ (conta de teste)'}
          </button>
        )}
        <button onClick={signOut} className="text-xs text-fg-subtle hover:text-fg-muted transition">
          Sair
        </button>
      </div>
    </div>
  );
}

// ── Auth error screen ─────────────────────────────────────────────────────────

function AuthErrorScreen() {
  const { authError, retryAuth, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-surface-2 border border-red-500/20 rounded-sheet p-8 text-center shadow-overlay">
        <div className="w-14 h-14 bg-red-500/15 rounded-container flex items-center justify-center mx-auto mb-5">
          <AlertTriangle size={28} className="text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-fg mb-2">Erro ao carregar</h2>
        <p className="text-fg-muted text-sm mb-6">{authError ?? 'Ocorreu um erro inesperado.'}</p>
        <button
          onClick={retryAuth}
          className="w-full py-3 bg-accent hover:bg-accent-strong text-white rounded-xl font-bold text-sm transition mb-3"
        >
          Tentar novamente
        </button>
        <button
          onClick={signOut}
          className="w-full py-3 bg-surface-3 hover:bg-edge text-fg rounded-xl font-bold text-sm transition mb-3"
        >
          Sair da conta
        </button>
        <button
          onClick={() => window.location.href = '/'}
          className="text-xs text-fg-subtle hover:text-fg-muted transition"
        >
          Voltar para homepage
        </button>
      </div>
    </div>
  );
}

// ── Profile loading overlay (non-blocking — only for authenticated users) ─────

function ProfileLoadingOverlay() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-center">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 bg-accent rounded-xl flex items-center justify-center">
            <LogoMark size={20} className="text-white" />
          </div>
          <span className="text-xl font-bold text-fg tracking-wide">
            Inventory<span className="text-accent font-light">Blind</span>
          </span>
        </div>
        <Loader2 className="mx-auto animate-spin text-accent" size={32} />
        <p className="text-fg-subtle text-sm mt-3">Carregando seu perfil...</p>
      </div>
    </div>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────

// Supabase persists the session under a `sb-<ref>-auth-token` localStorage key.
// Checking for it synchronously (before the async onAuthStateChange/getSession
// resolves) lets us hold off rendering the public Homepage for a returning
// authenticated user — eliminating the Homepage→Dashboard flash on tab refocus —
// while leaving genuinely anonymous visitors (no key present) on the instant,
// non-blocked landing path described in auth.tsx's rule #2.
function hasPersistedSession(): boolean {
  try {
    return Object.keys(localStorage).some(k => k.includes('-auth-token'));
  } catch {
    return false;
  }
}

export default function App() {
  const { view, authLoading, profileLoading } = useAuth();
  const [hadStoredSession] = useState(hasPersistedSession);

  // Auth error
  if (view === 'auth-error') return <AuthErrorScreen />;

  // A session was persisted — validate it before ever showing the public Homepage.
  if (hadStoredSession && authLoading) return <ProfileLoadingOverlay />;

  // Public routes — never block on auth
  if (view === 'landing') {
    return (
      <React.Suspense fallback={<LandingFallback />}>
        <LandingPage />
      </React.Suspense>
    );
  }
  if (view === 'login' || view === 'signup' || view === 'forgot' || view === 'confirm-email') return <AuthPage />;

  // Auth still initializing (session check in progress)
  if (authLoading) return <ProfileLoadingOverlay />;

  // Authenticated-only screens
  if (view === 'link-company' || view === 'complete-profile') return <LinkCompanyScreen />;
  if (view === 'select-workspace') return <WorkspaceSelectorScreen />;

  // Profile loading after login
  if (profileLoading && view !== 'app') return <ProfileLoadingOverlay />;

  // Main app
  if (view === 'app') return <AppContent />;

  // Absolute fallback
  return (
    <React.Suspense fallback={<LandingFallback />}>
      <LandingPage />
    </React.Suspense>
  );
}

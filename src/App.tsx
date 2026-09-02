import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package,
  AlertTriangle,
  Activity,
  Award,
  X,
  User,
  ShieldCheck,
  Lock,
  LogOut,
  Target,
  Calendar,
  Clock,
  Plus,
  Loader2,
  History,
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
  Gauge,
  ClipboardCheck,
  ClipboardList,
  Monitor,
  BarChart3,
  ShieldAlert,
  Plug,
  Warehouse,
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
  ArrowRight,
  HelpCircle,
  FileSearch,
  Barcode,
  GitCompareArrows,
  ListTodo,
  FileStack,
  Grid3x3,
  ShoppingCart,
  PackageX,
  Layers,
  FileBarChart2
} from 'lucide-react';
import { supabase, type BrandData, type TopVenda, type CustomKPI, type InventorySnapshot, type InventoryBrandHistory, type BlindAISituation, type UserProductivityStats } from './lib/supabase';
import { getTeamProductivity } from './lib/productivityService';
import { getBlindAISituations } from './lib/blindAIInsightsEngine';
import { tryFastPath, askBlindAIAgent, getContextualSuggestions, type ChatMessage } from './lib/blindAIAgent';
import { computeGlobalStats } from './lib/blindAIAgentAlgorithm';
import { KpisIndicadoresPage } from './components/KpisIndicadoresPage';
import { SafeDropdown } from './components/SafeDropdown';
import { CountManagementCenter } from './components/counting/CountManagementCenter';
import WorkspaceSelectorScreen from './components/WorkspaceSelectorScreen';
import AuthPage from './components/AuthPage';
import { useAuth, canManageUsers } from './lib/auth';
import { getWorkspaceLogoSignedUrl } from './lib/workspace/workspaceService';
import { LegalAcceptanceGate } from './components/legal/LegalAcceptanceGate';
import { hasPermission, getRoleLabel, canSyncIntegrations, canManageAutomations } from './lib/permissionService';
import type { DrillTarget } from './lib/intelligence/contracts';
import { usePWAInstall } from './lib/usePWAInstall';
import { useTheme } from './lib/useTheme';
import { LogoMark } from './components/landing/landingUi';
import { WhatsNewButton } from './components/WhatsNewPanel';
import { TaskNotificationBell } from './components/tasks/TaskNotificationBell';
import { useTaskNotifications } from './lib/tasks/hooks';
import {
  ThemeToggle, Sidebar, AppHeader, Panel, PanelSection, Modal, Badge, Button,
  Stat, StatRow, StatCell, resolveInsightIcon, INSIGHT_ICON_TONE, type StatProps,
  SidebarFolderIcon,
} from './components/ui';
import type { SidebarNavGroup } from './components/ui';
import { readCompleted as readCompletedDiagnostic } from './lib/operationDiagnosticStorage';
import { evaluateDiagnosticEligibility } from './lib/dashboardDiagnosticRule';
import { readBlockedFeatureInterest } from './lib/blockedFeatureInterest';
import { MyShortcutsCard } from './components/dashboard/MyShortcutsCard';
import { DashboardPriorities } from './components/dashboard/DashboardPriorities';
import { DashboardInventoryProgress } from './components/dashboard/DashboardInventoryProgress';
import { DashboardIntegrationsHealth } from './components/dashboard/DashboardIntegrationsHealth';
import { listConnections } from './lib/integrations/integrationService';
import type { IntegrationConnection } from './lib/integrations/types';

// Code-split large page components for smaller initial bundle
const LandingPage = React.lazy(() => import('./components/LandingPage'));
const HeatmapEstoque = React.lazy(() => import('./components/HeatmapEstoque').then(m => ({ default: m.HeatmapEstoque })));
const ProductImportPage = React.lazy(() => import('./components/ProductImportPage').then(m => ({ default: m.ProductImportPage })));
const ImportedProductsPage = React.lazy(() => import('./components/ImportedProductsPage').then(m => ({ default: m.ImportedProductsPage })));
const ImportHistoryPage = React.lazy(() => import('./components/ImportHistoryPage').then(m => ({ default: m.ImportHistoryPage })));
const RankingsPage = React.lazy(() => import('./components/RankingsPage').then(m => ({ default: m.RankingsPage })));
const LabelGeneratorPage = React.lazy(() => import('./components/LabelGeneratorPage').then(m => ({ default: m.LabelGeneratorPage })));
const BarcodeLabPage = React.lazy(() => import('./components/BarcodeLabPage').then(m => ({ default: m.BarcodeLabPage })));
const PdfCenterPage = React.lazy(() => import('./components/pdfCenter/PdfCenterPage').then(m => ({ default: m.PdfCenterPage })));
const PalletCalcPage = React.lazy(() => import('./components/palletCalc/PalletCalcPage').then(m => ({ default: m.PalletCalcPage })));
const SpreadsheetComparatorPage = React.lazy(() => import('./components/SpreadsheetComparatorPage').then(m => ({ default: m.SpreadsheetComparatorPage })));
const TasksPage = React.lazy(() => import('./components/TasksPage').then(m => ({ default: m.TasksPage })));
const FullManagerPage = React.lazy(() => import('./components/FullManagerPage'));
const InventoryFullPage = React.lazy(() => import('./components/InventoryFullPage').then(m => ({ default: m.InventoryFullPage })));
const AdminDashboardPage = React.lazy(() => import('./components/admin/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })));
const UserManagementPage = React.lazy(() => import('./components/UserManagementPage'));
const SecurityPage = React.lazy(() => import('./components/SecurityPage'));
// Integrations is lazy for the same reason every other module screen is: it pulls
// the whole integration service and is opened by a minority of sessions.
const IntegrationsPage = React.lazy(() => import('./components/integrations/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const IntegrationsHubPage = React.lazy(() => import('./components/integrations/IntegrationsHubPage').then(m => ({ default: m.IntegrationsHubPage })));
const AccessDeniedPage = React.lazy(() => import('./components/AccessDeniedPage'));
const AutomationsPage = React.lazy(() => import('./components/automation/AutomationsPage').then(m => ({ default: m.AutomationsPage })));
// Diagnóstico da operação — opcional, nunca no caminho crítico da autenticação.
const OperationDiagnostic = React.lazy(() => import('./components/onboarding/OperationDiagnostic').then(m => ({ default: m.OperationDiagnostic })));
const PrivacyLegalPage = React.lazy(() => import('./components/legal/PrivacyLegalPage').then(m => ({ default: m.PrivacyLegalPage })));
const DiagnosticInvite = React.lazy(() => import('./components/onboarding/OperationDiagnostic').then(m => ({ default: m.DiagnosticInvite })));
// Lazy: pulls the intelligence engines and only renders on the dashboard tab.
const ErpIntelligenceSection = React.lazy(() => import('./components/intelligence/ErpIntelligenceSection').then(m => ({ default: m.ErpIntelligenceSection })));
const NFeConferencePage = React.lazy(() => import('./components/nfe/NFeConferencePage'));
const NFeXmlLookupPage = React.lazy(() => import('./components/nfe/NFeXmlLookupPage'));
const ProductivityTab = React.lazy(() => import('./components/productivity/ProductivityTab').then(m => ({ default: m.ProductivityTab })));
const AcademyRouter = React.lazy(() => import('./components/academy/AcademyRouter').then(m => ({ default: m.AcademyRouter })));
const CBCDashboardPage = React.lazy(() => import('./components/cbc/CBCDashboardPage').then(m => ({ default: m.CBCDashboardPage })));
const RiskDashboardPage = React.lazy(() => import('./components/risk/RiskDashboardPage').then(m => ({ default: m.RiskDashboardPage })));
const AbcXyzDashboardPage = React.lazy(() => import('./components/abcxyz/AbcXyzDashboardPage').then(m => ({ default: m.AbcXyzDashboardPage })));
const WarehouseDigitalTwinPage = React.lazy(() => import('./components/slotting/WarehouseDigitalTwinPage').then(m => ({ default: m.WarehouseDigitalTwinPage })));
const RcaDashboardPage = React.lazy(() => import('./components/rca/RcaDashboardPage').then(m => ({ default: m.RcaDashboardPage })));
const AuditDashboardPage = React.lazy(() => import('./components/audit/AuditDashboardPage').then(m => ({ default: m.AuditDashboardPage })));
const PurchaseOrdersPage = React.lazy(() => import('./components/purchaseOrders/PurchaseOrdersPage').then(m => ({ default: m.PurchaseOrdersPage })));
const ReverseLogisticsPage = React.lazy(() => import('./components/reverseLogistics/ReverseLogisticsPage').then(m => ({ default: m.ReverseLogisticsPage })));
const ProductBrandsPage = React.lazy(() => import('./components/productBrands/ProductBrandsPage').then(m => ({ default: m.ProductBrandsPage })));
const AbcCurvePage = React.lazy(() => import('./components/abcCurve/AbcCurvePage').then(m => ({ default: m.AbcCurvePage })));
const KnowledgeCenterPage = React.lazy(() => import('./components/account/KnowledgeCenterPage').then(m => ({ default: m.KnowledgeCenterPage })));
const BlindScorePage = React.lazy(() => import('./components/analytics/BlindScorePage').then(m => ({ default: m.BlindScorePage })));
const InventoryHealthPage = React.lazy(() => import('./components/analytics/InventoryHealthPage').then(m => ({ default: m.InventoryHealthPage })));
const IaInsightsPage = React.lazy(() => import('./components/analytics/IaInsightsPage').then(m => ({ default: m.IaInsightsPage })));
const AuditsAnalyticsPage = React.lazy(() => import('./components/analytics/AuditsAnalyticsPage').then(m => ({ default: m.AuditsAnalyticsPage })));
const ApiKeysPage = React.lazy(() => import('./components/settings/ApiKeysPage').then(m => ({ default: m.ApiKeysPage })));
const WebhooksPage = React.lazy(() => import('./components/settings/WebhooksPage').then(m => ({ default: m.WebhooksPage })));
const LogsPage = React.lazy(() => import('./components/settings/LogsPage').then(m => ({ default: m.LogsPage })));
const FiscalEntitiesPage = React.lazy(() => import('./components/settings/FiscalEntitiesPage').then(m => ({ default: m.FiscalEntitiesPage })));
const WorkspacesSettingsPage = React.lazy(() => import('./components/settings/WorkspacesSettingsPage').then(m => ({ default: m.WorkspacesSettingsPage })));
const ClosingResultsPage = React.lazy(() => import('./components/counting/ClosingResultsPage').then(m => ({ default: m.ClosingResultsPage })));

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

function greetingPrefix(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Texto de saudação do cabeçalho do Dashboard ("Boa tarde, Victor"). */
function greetingText(name: string | null): string {
  const firstName = name?.trim().split(/\s+/)[0] ?? null;
  const prefix = greetingPrefix(new Date().getHours());
  return firstName ? `${prefix}, ${firstName}` : prefix;
}

/** "Atualizado hoje às 14:32" / "Atualizado em 27/08 às 14:32" — a partir do
 *  carimbo real da última leitura bem-sucedida (nunca um valor fixo). */
function formatLastLoaded(atMs: number | null): string | null {
  if (atMs == null) return null;
  const at = new Date(atMs);
  const now = new Date();
  const time = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return `Atualizado hoje às ${time}`;
  const date = at.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `Atualizado em ${date} às ${time}`;
}

function AppContent() {
  const { user, profile, company, companyId, companies, switchCompany, switchingCompany, createWorkspace, refreshProfile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('dashboard');
  // Logo do workspace (Configurações Avançadas → Workspaces) — bucket privado, então a URL
  // de exibição é assinada e resolvida aqui para os 2 lugares que mostram o ícone do
  // workspace fora daquela página: o avatar do seletor no topo do Sidebar e o dropdown
  // de troca de workspace logo abaixo. Sem foto cadastrada, cai na inicial do nome (como já era).
  const [workspaceLogoUrls, setWorkspaceLogoUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const withLogo = [company, ...companies].filter((c): c is typeof companies[number] => !!c && !!c.logoPath);
    Promise.all(withLogo.map(async c => [c.id, await getWorkspaceLogoSignedUrl(c.logoPath as string)] as const))
      .then(entries => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const [id, url] of entries) if (url) next[id] = url;
        setWorkspaceLogoUrls(next);
      });
    return () => { cancelled = true; };
  }, [company, companies]);
  // Transferência da ferramenta "Consulta e Download de XML/NFe" pra Conferência
  // por NF-e: guarda o id da nota recém-encontrada só até a página consumir.
  const [nfePendingInvoiceId, setNfePendingInvoiceId] = useState<string | null>(null);
  // Mesmo padrão: o sino de notificações de tarefas (cabeçalho global) manda
  // abrir uma tarefa específica dentro de Meu Trabalho — guarda o id só até a
  // página consumir.
  const [tasksPendingOpenId, setTasksPendingOpenId] = useState<string | null>(null);
  const taskNotifications = useTaskNotifications(profile?.id);

  // ── Diagnóstico da operação ───────────────────────────────────────────────
  // Lido do metadata do próprio usuário, que o AuthProvider já carregou — nenhuma
  // consulta extra só para decidir se o convite aparece. Quem já respondeu não
  // vê mais o convite; "Agora não" só vale para a sessão atual (nunca persiste),
  // então um novo motivo (ex.: nova tentativa de função bloqueada) pode reabrir o
  // aviso mesmo depois de dispensado. O espaço fixo do topo do dashboard nunca é
  // do diagnóstico — é sempre "Meus Atalhos"; o diagnóstico, quando elegível,
  // aparece como um aviso à parte (ver evaluateDiagnosticEligibility).
  const diagnosticRecord = useMemo(
    () => readCompletedDiagnostic(user?.user_metadata as Record<string, unknown> | undefined),
    [user?.user_metadata]
  );
  const [diagnosticDone, setDiagnosticDone] = useState(false);
  const [diagnosticDismissed, setDiagnosticDismissed] = useState(false);
  const [dashboardProductCount, setDashboardProductCount] = useState<number | null>(null);
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    supabase.from('products').select('id', { count: 'exact', head: true }).then(({ count }) => {
      if (!cancelled) setDashboardProductCount(count ?? null);
    });
    return () => { cancelled = true; };
  }, [companyId]);
  const diagnosticEligibility = evaluateDiagnosticEligibility({
    diagnosticCompleted: diagnosticRecord != null || diagnosticDone,
    companyCreatedAt: company?.createdAt ?? null,
    productCount: dashboardProductCount,
    hasBlockedFeatureInterest: readBlockedFeatureInterest() != null,
  });
  const showDiagnosticInvite = diagnosticEligibility.eligible && !diagnosticDismissed;

  const [brandsData, setBrandsData] = useState<BrandData[]>([]);
  const [topVendas, setTopVendas] = useState<TopVenda[]>([]);
  const [customKPIs, setCustomKPIs] = useState<CustomKPI[]>([]);
  const [operatorStats, setOperatorStats] = useState<UserProductivityStats[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddBrandModal, setShowAddBrandModal] = useState(false);

  const isLoggedIn = canManageUsers(profile?.role);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Per-device only — same rationale as workspacePrefs.ts (remembered workspace):
  // whether the sidebar is collapsed is a device convenience, not an account setting.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('ib-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('ib-sidebar-collapsed', String(next)); } catch { /* private browsing, etc. */ }
      return next;
    });
  };
  // Escape closes the mobile nav drawer, matching its button/overlay close paths.
  useEffect(() => {
    if (!mobileOpen) return;
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileOpen]);
  const { canInstall, hasPrompt, promptInstall } = usePWAInstall();
  const [showInstallModal, setShowInstallModal] = useState(false);

  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandTotalSku, setNewBrandTotalSku] = useState('');

  // History states
  const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<InventorySnapshot | null>(null);
  const [snapshotBrands, setSnapshotBrands] = useState<InventoryBrandHistory[]>([]);

  // Load data from Supabase
  // lastLoadedAt: só para o metadado "Atualizado às ..." do cabeçalho do
  // Dashboard — carimbo do momento real da última leitura bem-sucedida, nunca
  // um valor fixo. Extraído para useCallback (mesma query de sempre, sem
  // mudança de lógica) só para que o botão de atualizar do Dashboard possa
  // chamar a mesma função do efeito inicial.
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const loadData = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);

      const [brandsRes, vendasRes, kpisRes, operatorStatsRes] = await Promise.all([
        supabase.from('inventory_brands').select('id, brand, total_sku, done_sku, divergences, order_index, created_at, updated_at, company_id').eq('company_id', companyId).order('order_index'),
        supabase.from('top_vendas').select('id, produto, sku, vendas, order_index, created_at, updated_at, company_id').eq('company_id', companyId).order('order_index'),
        supabase.from('custom_kpis').select('id, titulo, valor, unidade, variacao, tipo_variacao, cor_icone, order_index, created_at, updated_at, company_id').eq('company_id', companyId).order('order_index'),
        getTeamProductivity(companyId)
      ]);

      if (brandsRes.error) throw brandsRes.error;
      if (vendasRes.error) throw vendasRes.error;
      if (kpisRes.error) throw kpisRes.error;

      setBrandsData(brandsRes.data || []);
      setTopVendas(vendasRes.data || []);
      setCustomKPIs(kpisRes.data || []);
      setOperatorStats(operatorStatsRes);

      setError(null);
      setLastLoadedAt(Date.now());
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Falha ao carregar dados. Tente recarregar a página.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Conexões de integração — carregado uma vez para o Dashboard (item
  // "Conectar o estoque do ERP" em Prioridades agora + card condensado de
  // Saúde e integrações). Mesma consulta que IntegrationsPage já usa
  // (listConnections, escopada por RLS); null = ainda carregando ou usuário
  // sem permissão de sincronizar integrações, e nesse caso nenhum dos dois
  // cartões afirma nada sobre conexão.
  const [erpConnections, setErpConnections] = useState<IntegrationConnection[] | null>(null);
  useEffect(() => {
    if (!companyId || !canSyncIntegrations(profile?.role)) { setErpConnections(null); return; }
    let cancelled = false;
    listConnections()
      .then(list => { if (!cancelled) setErpConnections(list); })
      .catch(() => { if (!cancelled) setErpConnections([]); });
    return () => { cancelled = true; };
  }, [companyId, profile?.role]);

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

  // View snapshot details
  const handleViewSnapshot = async (snapshot: InventorySnapshot) => {
    setSelectedSnapshot(snapshot);

    const { data } = await supabase
      .from('inventory_brand_history')
      .select('id, snapshot_id, brand, total_sku, done_sku, divergences, progress, accuracy, status, created_at, company_id');

    setSnapshotBrands(data || []);
  };

  const globais = useMemo(() => computeGlobalStats(brandsData), [brandsData]);

  /** Where an ERP-intelligence drill-down lands.
   *
   *  The section emits a typed target and knows nothing about tabs; this maps each
   *  one to a destination. Targets without a dedicated screen yet go to the
   *  integrations page, which is where the underlying data and its configuration
   *  live — better than a dead click, and honest about where the work happens. */
  const handleIntelligenceDrill = useCallback((target: DrillTarget) => {
    switch (target) {
      case 'missing_ean':
      case 'missing_warehouse':
        // The imported-products screen is where a catalogue gap gets fixed.
        setActiveTab('products');
        break;
      case 'negative_stock':
      case 'discrepancies':
      case 'sync_log':
      case 'adjustment_queue':
      case 'integration_settings':
      case 'minimum_stock_settings':
        setActiveTab('integracoes');
        break;
    }
  }, []);

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

  const handleAddKPI = async (kpi: Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>) => {
    const maxOrder = Math.max(0, ...customKPIs.map(k => k.order_index));

    const { data, error } = await supabase
      .from('custom_kpis')
      .insert({
        ...kpi,
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

  // As 3 seções abaixo (sectionLabel em cada primeiro grupo) são só uma camada visual —
  // igual ao "Em breve" que já existia acima de financeiro-group. Nenhum id, onClick,
  // rota ou permissão de item muda: só a posição do grupo no array e a legenda acima dele.
  const navGroups: SidebarNavGroup[] = [
    {
      id: 'dashboard-group',
      label: 'Dashboard',
      sectionLabel: 'Visão Geral',
      railSection: true,
      icon: <LayoutDashboard />,
      items: [
        { id: 'dashboard', label: 'Dashboard',           icon: <LayoutDashboard />, onClick: () => { setActiveTab('dashboard'); setMobileOpen(false); }, active: activeTab === 'dashboard' },
        { id: 'heatmap',   label: 'Heatmap',              icon: <Map />,             onClick: () => { setActiveTab('heatmap'); setMobileOpen(false); },   active: activeTab === 'heatmap' },
        { id: 'kpis',      label: 'KPIs e Indicadores',   icon: <Target />,          onClick: () => { setActiveTab('kpis'); setMobileOpen(false); },      active: activeTab === 'kpis' },
        { id: 'rankings',  label: 'Rankings',             icon: <Award />,           onClick: () => { setActiveTab('rankings'); setMobileOpen(false); },  active: activeTab === 'rankings' },
        { id: 'closing-results', label: 'Resultados por Linha', icon: <FileBarChart2 />, onClick: () => { setActiveTab('closing-results'); setMobileOpen(false); }, active: activeTab === 'closing-results' },
      ],
    },
    {
      // Reposicionado de volta para "Visão Geral" (era o 3º grupo, sem sectionLabel
      // próprio, visualmente dentro de "Operação Inteligente") — pedido explícito do
      // usuário nesta conversa, revertendo a posição que uma sessão anterior tinha
      // escolhido. Nenhum id/onClick/rota/permissão de item muda, só a posição.
      id: 'analytics-group',
      label: 'Analytics',
      icon: <Gauge />,
      items: [
        { id: 'analytics-blindscore', label: 'BlindScore',             icon: <Gauge />,     onClick: () => { setActiveTab('analytics-blindscore'); setMobileOpen(false); }, active: activeTab === 'analytics-blindscore' },
        { id: 'analytics-health',     label: 'Inventory Health Score', icon: <Activity />,  onClick: () => { setActiveTab('analytics-health'); setMobileOpen(false); },     active: activeTab === 'analytics-health' },
        { id: 'analytics-ia',         label: 'IA Insights',            icon: <BarChart3 />, onClick: () => { setActiveTab('analytics-ia'); setMobileOpen(false); },         active: activeTab === 'analytics-ia' },
        { id: 'analytics-audit',      label: 'Auditorias',             icon: <ShieldAlert />, onClick: () => { setActiveTab('analytics-audit'); setMobileOpen(false); },     active: activeTab === 'analytics-audit' },
      ],
    },
    {
      id: 'counting-group',
      label: 'Operações',
      sectionLabel: 'Operação Inteligente',
      railSection: true,
      icon: <SidebarFolderIcon />,
      items: [
        { id: 'input',          label: 'Nova Contagem',        icon: <Plus />,        onClick: () => { setActiveTab('input'); setMobileOpen(false); },          active: activeTab === 'input' },
        { id: 'nfe-conference', label: 'Conferência por NF-e', icon: <ScanLine />,    onClick: () => { setActiveTab('nfe-conference'); setMobileOpen(false); }, active: activeTab === 'nfe-conference' },
        { id: 'purchase-orders', label: 'Ordens de Compra',    icon: <ShoppingCart />, onClick: () => { setActiveTab('purchase-orders'); setMobileOpen(false); }, active: activeTab === 'purchase-orders' },
        { id: 'reverse-logistics', label: 'Logística Reversa', icon: <PackageX />,    onClick: () => { setActiveTab('reverse-logistics'); setMobileOpen(false); }, active: activeTab === 'reverse-logistics' },
        { id: 'cbc',            label: 'Confidence Score',     icon: <Gauge />,       onClick: () => { setActiveTab('cbc'); setMobileOpen(false); },            active: activeTab === 'cbc' },
        { id: 'risk',           label: 'Inventário por Risco', icon: <AlertTriangle />, onClick: () => { setActiveTab('risk'); setMobileOpen(false); },         active: activeTab === 'risk' },
        { id: 'abcxyz',         label: 'Classificação ABC/XYZ', icon: <LayoutGrid />, onClick: () => { setActiveTab('abcxyz'); setMobileOpen(false); },   active: activeTab === 'abcxyz' },
        { id: 'slotting',       label: 'Warehouse Digital Twin', icon: <Warehouse />, onClick: () => { setActiveTab('slotting'); setMobileOpen(false); },     active: activeTab === 'slotting' },
        { id: 'rca',            label: 'Root Cause Analysis',  icon: <GitBranch />, onClick: () => { setActiveTab('rca'); setMobileOpen(false); },        active: activeTab === 'rca' },
        { id: 'audit',          label: 'Auditoria de Estoque', icon: <SearchCheck />, onClick: () => { setActiveTab('audit'); setMobileOpen(false); },   active: activeTab === 'audit' },
      ],
    },
    {
      // Grupo próprio e destravado. Não reaproveitei o item 'config-automacoes' que
      // existia em Configurações Avançadas porque aquele grupo tem lock de grupo — que
      // torna todo item interno não-interativo.
      id: 'automacoes-group',
      label: 'Automações',
      icon: <SidebarFolderIcon />,
      items: [
        { id: 'automacoes', label: 'Agentes e Automações', icon: <Workflow />, onClick: () => { setActiveTab('automacoes'); setMobileOpen(false); }, active: activeTab === 'automacoes' },
      ],
    },
    {
      id: 'products-group',
      label: 'Produtos',
      icon: <SidebarFolderIcon />,
      items: [
        { id: 'import',          label: 'Importar Produtos',        icon: <FileSpreadsheet />, onClick: () => { setActiveTab('import'); setMobileOpen(false); },          active: activeTab === 'import' },
        { id: 'import-history',  label: 'Histórico de Importações', icon: <History />,         onClick: () => { setActiveTab('import-history'); setMobileOpen(false); }, active: activeTab === 'import-history' },
        { id: 'products',        label: 'Catálogo de Produtos',     icon: <Package />,         onClick: () => { setActiveTab('products'); setMobileOpen(false); },        active: activeTab === 'products' },
        { id: 'product-brands',  label: 'Linhas e Marcas',          icon: <Tag />,             onClick: () => { setActiveTab('product-brands'); setMobileOpen(false); },  active: activeTab === 'product-brands' },
        { id: 'abc-curve',       label: 'Curva ABC',                icon: <BarChart3 />,       onClick: () => { setActiveTab('abc-curve'); setMobileOpen(false); },       active: activeTab === 'abc-curve' },
      ],
    },
    {
      id: 'tools-group',
      label: 'Ferramentas',
      icon: <SidebarFolderIcon />,
      items: [
        { id: 'tasks',           label: 'Meu Trabalho',         icon: <ListTodo />, onClick: () => { setActiveTab('tasks'); setMobileOpen(false); },         active: activeTab === 'tasks' },
        { id: 'nfe-xml-lookup',  label: 'Consulta e Download de XML/NFe', icon: <FileSearch />, onClick: () => { setActiveTab('nfe-xml-lookup'); setMobileOpen(false); }, active: activeTab === 'nfe-xml-lookup' },
        { id: 'label-generator', label: 'Gerador de Etiquetas', icon: <Tag />, onClick: () => { setActiveTab('label-generator'); setMobileOpen(false); }, active: activeTab === 'label-generator' },
        ...(hasPermission(profile?.role, 'labels.use') ? [{ id: 'barcode-lab', label: 'Códigos de Barras', icon: <Barcode />, onClick: () => { setActiveTab('barcode-lab'); setMobileOpen(false); }, active: activeTab === 'barcode-lab' }] : []),
        { id: 'spreadsheet-comparator', label: 'Comparador de Planilhas', icon: <GitCompareArrows />, onClick: () => { setActiveTab('spreadsheet-comparator'); setMobileOpen(false); }, active: activeTab === 'spreadsheet-comparator' },
        { id: 'pdf-center',      label: 'Central de PDFs',       icon: <FileStack />, onClick: () => { setActiveTab('pdf-center'); setMobileOpen(false); },    active: activeTab === 'pdf-center' },
        { id: 'pallet-calc',     label: 'Calculadora de Paletização', icon: <Grid3x3 />, onClick: () => { setActiveTab('pallet-calc'); setMobileOpen(false); }, active: activeTab === 'pallet-calc' },
        { id: 'full-manager',    label: 'Full Manager',         icon: <ClipboardCheck />, onClick: () => { setActiveTab('full-manager'); setMobileOpen(false); },    active: activeTab === 'full-manager' },
        { id: 'inventoryfull',   label: 'InventoryFull',        icon: <Monitor />, onClick: () => { setActiveTab('inventoryfull'); setMobileOpen(false); },     active: activeTab === 'inventoryfull' },
      ],
    },
    {
      id: 'academy-group',
      label: 'I.B Academy',
      sectionLabel: 'Aprendizado e Gestão',
      railSection: true,
      icon: <GraduationCap />,
      items: [
        { id: 'academy', label: 'I.B Academy', icon: <GraduationCap />, onClick: () => { setActiveTab('academy'); setMobileOpen(false); }, active: activeTab === 'academy' },
      ],
    },
    {
      id: 'account-group',
      label: 'Minha Conta',
      icon: <User />,
      items: [
        { id: 'conta', label: 'Produtividade', icon: <User />, onClick: () => { setActiveTab('conta'); setMobileOpen(false); }, active: activeTab === 'conta' },
        { id: 'knowledge', label: 'Recursos e Conhecimento', icon: <BookOpen />, onClick: () => { setActiveTab('knowledge'); setMobileOpen(false); }, active: activeTab === 'knowledge' },
        // Entrada permanente: quem já usava o sistema antes do diagnóstico existir
        // acha por aqui, e quem já respondeu pode refazer quando a operação mudar.
        { id: 'diagnostico', label: 'Diagnóstico da operação', icon: <ClipboardList />, onClick: () => { setActiveTab('diagnostico'); setMobileOpen(false); }, active: activeTab === 'diagnostico' },
        // Visível para todo papel: são os documentos e os direitos do próprio
        // usuário, não uma função administrativa.
        { id: 'legal', label: 'Privacidade e Legal', icon: <ShieldCheck />, onClick: () => { setActiveTab('legal'); setMobileOpen(false); }, active: activeTab === 'legal' },
      ],
    },
    {
      id: 'admin-group',
      label: 'Administração',
      icon: <Lock />,
      items: [
        { id: 'admin', label: 'Acesso Administrativo', icon: <Lock />, onClick: () => { setActiveTab('admin'); setMobileOpen(false); }, active: activeTab === 'admin' },
        ...(canManageUsers(profile?.role) ? [{ id: 'users', label: 'Usuários', icon: <UserCog />, onClick: () => { setActiveTab('users'); setMobileOpen(false); }, active: activeTab === 'users' }] : []),
        ...(hasPermission(profile?.role, 'security.view') ? [{ id: 'security', label: 'Segurança', icon: <ShieldCheck />, onClick: () => { setActiveTab('security'); setMobileOpen(false); }, active: activeTab === 'security' }] : []),
      ],
    },
    {
      // Um item só, abrindo o Hub de Integrações (catálogo + "Minhas
      // integrações"). O fluxo de gestão do Tiny propriamente dito continua na
      // tab 'integracoes' de sempre — o Hub só leva até ela — então nenhum
      // destino existente (inclusive os drill-throughs do Dashboard que apontam
      // para 'integracoes') muda de lugar.
      id: 'integracoes-group',
      label: 'Integrações',
      icon: <Plug />,
      items: [
        { id: 'integracoes-hub', label: 'Integrações', icon: <Plug />, onClick: () => { setActiveTab('integracoes-hub'); setMobileOpen(false); }, active: activeTab === 'integracoes-hub' || activeTab === 'integracoes' },
      ],
    },
    {
      // Destravado por papel (mesmo mecanismo de group.locked já usado em
      // Integrações/Financeiro) em vez de travado fixo: quem administra a
      // conta (owner/admin) vê os 3 itens funcionais; os demais veem o grupo
      // com cadeado, igual a qualquer outro grupo bloqueado.
      id: 'config-avancada-group',
      label: 'Configurações Avançadas',
      locked: !canManageUsers(profile?.role),
      icon: <Code2 />,
      items: [
        { id: 'config-api',      label: 'API',      icon: <Code2 />,    onClick: () => { setActiveTab('config-api'); setMobileOpen(false); },      active: activeTab === 'config-api' },
        { id: 'config-webhooks', label: 'Webhooks', icon: <Webhook />,  onClick: () => { setActiveTab('config-webhooks'); setMobileOpen(false); }, active: activeTab === 'config-webhooks' },
        { id: 'config-logs',     label: 'Logs',      icon: <FileText />, onClick: () => { setActiveTab('config-logs'); setMobileOpen(false); },     active: activeTab === 'config-logs' },
        { id: 'config-empresas-fiscais', label: 'Empresas e Dados Fiscais', icon: <Building2 />, onClick: () => { setActiveTab('config-empresas-fiscais'); setMobileOpen(false); }, active: activeTab === 'config-empresas-fiscais' },
        { id: 'config-workspaces', label: 'Workspaces', icon: <Layers />, onClick: () => { setActiveTab('config-workspaces'); setMobileOpen(false); }, active: activeTab === 'config-workspaces' },
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
              {workspaceLogoUrls[company.id] ? (
                <img src={workspaceLogoUrls[company.id]} alt="" className="w-6 h-6 rounded-md object-cover flex-shrink-0" />
              ) : (
                <span className="w-6 h-6 rounded-md bg-accent flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
                  {company.name.slice(0, 1).toUpperCase()}
                </span>
              )}
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
              icon: workspaceLogoUrls[c.id] ? (
                <img src={workspaceLogoUrls[c.id]} alt="" className="w-5 h-5 rounded-md object-cover" />
              ) : (
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
    </div>
  );

  // Compartilhado pelo trigger do header (userMenu) e pelo avatar do rodapé do
  // Sidebar — mesmo menu, dois pontos de entrada, sem duplicar a lógica de permissão.
  const userMenuItems = [
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
  ];

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
      items={userMenuItems}
    />
  );

  const railAvatar = (
    <SafeDropdown
      trigger={
        <button
          title={profile?.email ?? undefined}
          className="relative w-9 h-9 flex-shrink-0 rounded-full bg-accent flex items-center justify-center text-xs font-semibold text-white uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {(profile?.email ?? '?').slice(0, 1)}
          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-surface-2" />
        </button>
      }
      items={userMenuItems}
    />
  );

  return (
    // data-app-shell scopes the authenticated app's reduced-motion rules in
    // index.css — the Landing zone resolves motion itself and is excluded.
    // pl/pr com os insets laterais: em landscape com notch a lateral esquerda do shell
    // (a sidebar) ficava embaixo do recorte. Em portrait e no desktop os insets são 0.
    <div
      data-app-shell
      className="h-screen bg-surface font-sans text-fg flex overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >

      {/* ── SIDEBAR (desktop) ─────────────────────────────────────────────── */}
      {/* O toggle de visibilidade por breakpoint fica no wrapper, não na
          className do Sidebar — passar "hidden md:flex" direto no elemento
          colidiria com o `display: grid` que .ib-sidebar já define (mesma
          especificidade, a última classe declarada no bundle vencia). */}
      <div className="hidden md:block">
      <Sidebar
        groups={navGroups}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        railHelp={{ icon: <HelpCircle size={17} />, label: 'Recursos e Conhecimento', onClick: () => setActiveTab('knowledge') }}
        railAvatar={railAvatar}
        workspace={company ? {
          name: company.name,
          label: 'Workspace',
          logoUrl: workspaceLogoUrls[company.id],
          menuItems: [
            ...companies.map(c => ({
              id: c.id,
              label: c.name,
              icon: workspaceLogoUrls[c.id] ? (
                <img src={workspaceLogoUrls[c.id]} alt="" className="w-5 h-5 rounded-md object-cover" />
              ) : (
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
          ],
        } : undefined}
        workspaceAvatar={company && (
          workspaceLogoUrls[company.id] ? (
            <img src={workspaceLogoUrls[company.id]} alt="" className="w-9 h-9 rounded-lg object-cover" />
          ) : (
            <span className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center text-white text-sm font-semibold uppercase">
              {company.name.slice(0, 1)}
            </span>
          )
        )}
      />
      </div>

      {/* ── SIDEBAR (mobile drawer) ──────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[1000] flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 flex h-full">
            <Sidebar
              groups={navGroups}
              header={sidebarHeader}
              hideRail
              // O drawer é `fixed inset-0`: cobre a barra de status em cima e a barra de
              // gesto embaixo. Sem os insets, o topo do menu ficava sob o relógio e o
              // "Sair" do rodapé sob o home indicator. `box-border` já é global, então o
              // padding cabe dentro do `h-full` e a `nav` interna encolhe sozinha.
              className="pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
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
              className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-full ml-2 p-2 rounded-lg bg-surface-2 border border-edge text-fg-muted"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ── CONTENT COLUMN ────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <AppHeader
          onOpenMobileNav={() => setMobileOpen(true)}
          right={
            <>
              <WhatsNewButton />
              <TaskNotificationBell
                notifications={taskNotifications.notifications}
                unreadCount={taskNotifications.unreadCount}
                onMarkRead={taskNotifications.markRead}
                onMarkAllRead={taskNotifications.markAllRead}
                onOpenTask={(taskId) => { setTasksPendingOpenId(taskId); setActiveTab('tasks'); }}
              />
              <ThemeToggle className="hidden md:flex" />
              {userMenu}
            </>
          }
        />

      {/* MAIN CONTENT */}
      {/* pb com o inset inferior: o `main` termina na borda da viewport, então o último
          elemento da página ficava embaixo da barra de gesto e fora de alcance do toque.
          O padding entra no conteúdo rolável, garantindo que dê para rolar o fim da
          página acima do home indicator. */}
      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden [overflow-anchor:none] pb-[env(safe-area-inset-bottom)]">

        {activeTab !== 'rankings' && activeTab !== 'label-generator' && activeTab !== 'barcode-lab' && activeTab !== 'full-manager' && activeTab !== 'users' && activeTab !== 'pdf-center' && activeTab !== 'pallet-calc' && (
          <>

        {/* ABA HEATMAP */}
        {activeTab === 'heatmap' && (
          <React.Suspense fallback={<PageLoader />}>
          <HeatmapEstoque
            brandsData={brandsData}
            companyId={companyId}
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
            onGoToImport={() => setActiveTab('import')}
          />
          </React.Suspense>
        )}

        {/* ABA LINHAS E MARCAS */}
        {activeTab === 'product-brands' && companyId && (
          <React.Suspense fallback={<PageLoader />}>
            <ProductBrandsPage companyId={companyId} />
          </React.Suspense>
        )}

        {/* ABA CURVA ABC */}
        {activeTab === 'abc-curve' && companyId && (
          <React.Suspense fallback={<PageLoader />}>
            <AbcCurvePage companyId={companyId} />
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

        {/* FERRAMENTAS: COMPARADOR DE PLANILHAS */}
        {activeTab === 'spreadsheet-comparator' && (
          <React.Suspense fallback={<PageLoader />}>
          <SpreadsheetComparatorPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        )}

        {/* FERRAMENTAS: MEU TRABALHO (TAREFAS) */}
        {activeTab === 'tasks' && (
          <React.Suspense fallback={<PageLoader />}>
          <TasksPage
            onBack={() => setActiveTab('dashboard')}
            initialTaskId={tasksPendingOpenId ?? undefined}
            onConsumedInitialTask={() => setTasksPendingOpenId(null)}
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
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">

            {/* CABEÇALHO — título + saudação + seletor de inventário + atualizar + nova contagem */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b border-edge/70 pb-6">
              <div className="min-w-0">
                <h1 className="text-display">Visão operacional</h1>
                <p className="mt-2 text-sm text-fg-muted truncate">
                  {greetingText(profile?.name ?? null)}
                  {company?.name ? ` · Inventário ${company.name}` : ''}
                </p>
                {formatLastLoaded(lastLoadedAt) && (
                  <p className="mt-1 flex items-center gap-1 text-caption">
                    <Clock size={11} />
                    {formatLastLoaded(lastLoadedAt)}
                  </p>
                )}
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                <SafeDropdown
                  trigger={
                    <button className="flex items-center gap-2 rounded-control border border-edge px-3 py-2 text-sm text-fg hover:bg-surface-3/60 transition-colors">
                      Inventário atual
                      <ChevronDown size={13} className="text-fg-subtle" />
                    </button>
                  }
                  items={[
                    { id: 'current', label: 'Inventário atual', active: true, onClick: () => {} },
                    ...(snapshots.length > 0
                      ? snapshots.map(s => ({
                          id: s.id,
                          label: s.name,
                          divider: s === snapshots[0],
                          onClick: () => { handleViewSnapshot(s); setShowHistoryModal(true); },
                        }))
                      : [{ id: 'none', label: 'Nenhum histórico salvo ainda', disabled: true, divider: true, onClick: () => {} }]),
                  ]}
                />
                <button
                  onClick={() => loadData()}
                  disabled={loading}
                  title="Atualizar"
                  className="p-2.5 rounded-control border border-edge text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
                <Button onClick={() => setActiveTab('input')}>
                  <Plus size={14} /> Nova contagem
                </Button>
              </div>
            </div>

            {/* Acesso rápido — espaço fixo do topo do dashboard, sempre, para todo
                usuário e plano. Nunca é substituído pelo diagnóstico. */}
            {profile?.id && (
              <MyShortcutsCard companyId={companyId} userId={profile.id} navGroups={navGroups} />
            )}

            {/* Aviso de diagnóstico — separado de Acesso rápido, só quando elegível
                (workspace novo, poucos SKUs ou interesse em função bloqueada — ver
                evaluateDiagnosticEligibility). "Agora não" vale só para esta sessão. */}
            {showDiagnosticInvite && (
              <React.Suspense fallback={null}>
                <DiagnosticInvite
                  onStart={() => setActiveTab('diagnostico')}
                  onDismiss={() => setDiagnosticDismissed(true)}
                />
              </React.Suspense>
            )}

            {/* RESUMO EXECUTIVO */}
            <Panel>
              <PanelSection padding="lg">
                <StatRow>
                  {(() => {
                    const inProgressRows = globais.tabela.filter(b => b.status === 'ANDAMENTO');
                    const topInProgress = [...inProgressRows].sort((a, b) => b.progress - a.progress)[0] ?? null;
                    const ACCURACY_TARGET = 95;
                    return ([
                      {
                        label: 'Progresso Geral',
                        value: `${globais.progresso.toFixed(1)}%`,
                        context: `${globais.totalDone} de ${globais.totalSku} SKUs`,
                      },
                      {
                        label: 'Acuracidade (IRA)',
                        value: `${globais.acuracidade.toFixed(1)}%`,
                        context: `Meta ${ACCURACY_TARGET}% · ${globais.acuracidade >= ACCURACY_TARGET ? 'dentro da meta' : 'abaixo da meta'}`,
                        // The only figure here whose level is a condition, so the
                        // only one allowed to carry colour.
                        valueTone:
                          globais.acuracidade >= 80 ? 'positive' : globais.acuracidade >= 50 ? 'warning' : 'critical',
                      },
                      { label: 'Divergências', value: globais.totalDiv, context: 'Aguardando recontagem' },
                      {
                        label: 'Linhas em andamento',
                        value: `${inProgressRows.length} de ${globais.tabela.length}`,
                        context: topInProgress
                          ? `${topInProgress.brand} · ${topInProgress.progress.toFixed(1)}%`
                          : 'Nenhuma linha em andamento',
                      },
                    ] satisfies StatProps[]);
                  })().map(kpi => (
                    <StatCell key={kpi.label}>
                      <Stat {...kpi} />
                    </StatCell>
                  ))}
                </StatRow>
              </PanelSection>
            </Panel>

            {/* GRID PRINCIPAL — esquerda: prioridades + controle por linha; direita: progresso + BlindAI + integrações */}
            <div className="grid grid-cols-1 lg:grid-cols-[62%_1fr] gap-6 items-start">

              {/* COLUNA ESQUERDA */}
              <div className="space-y-6 min-w-0">
                <DashboardPriorities
                  globais={globais}
                  erpDisconnected={erpConnections == null ? null : erpConnections.length === 0}
                  onRecount={() => setActiveTab('input')}
                  onContinueCounting={() => setActiveTab('input')}
                  onConnectErp={() => setActiveTab('integracoes')}
                  onViewAll={() => setActiveTab('tasks')}
                />

                <Panel className="flex flex-col">
                  <PanelSection padding="sm" className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <h3 className="text-title">Controle por linha</h3>
                    <span className="text-caption">Total: {globais.totalSku.toLocaleString('pt-BR')} SKUs</span>
                  </PanelSection>

                  <div className="overflow-x-auto flex-1">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-edge">
                          <th className="px-6 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide">Linha / Marca</th>
                          <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Progresso</th>
                          <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Concluídos</th>
                          <th className="px-3 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Acuracidade</th>
                          <th className="px-6 py-3 font-medium text-fg-subtle text-xs uppercase tracking-wide text-center">Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {globais.tabela.slice(0, 5).map((row) => (
                          <tr key={row.id} className="border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors">
                            <td className="px-6 py-3.5 font-medium text-fg">{row.brand}</td>
                            <td className="px-3 py-3.5 text-center text-fg-muted text-numeric text-xs">{row.progress.toFixed(1)}%</td>
                            <td className="px-3 py-3.5 text-center font-semibold text-fg text-numeric">{row.doneSku}</td>
                            <td className="px-3 py-3.5 text-center font-semibold text-fg text-numeric">
                              {row.accuracy !== null ? `${row.accuracy.toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className="text-xs font-medium text-fg-subtle">
                                {row.status === 'CONCLUÍDO' ? 'Concluído' : 'Em andamento'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <PanelSection padding="sm">
                    <button
                      onClick={() => setActiveTab('rankings')}
                      className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong transition-colors py-1"
                    >
                      Ver desempenho completo <ArrowRight size={14} />
                    </button>
                  </PanelSection>
                </Panel>
              </div>

              {/* COLUNA DIREITA */}
              <div className="space-y-6 min-w-0">
                <DashboardInventoryProgress
                  companyId={companyId}
                  globais={globais}
                  onOpenKpis={() => setActiveTab('kpis')}
                />

                <Panel>
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

                {canSyncIntegrations(profile?.role) && (
                  <DashboardIntegrationsHealth
                    connections={erpConnections}
                    onConnect={() => setActiveTab('integracoes')}
                    onViewIntegrations={() => setActiveTab('integracoes')}
                  />
                )}
              </div>
            </div>

            {/* ESTOQUE NO ERP — detalhamento completo, só quando há ao menos uma
                conexão. O card condensado de Saúde e integrações (coluna direita
                acima) já cobre o estado desconectado; este continua existindo
                para não perder o detalhamento que ele oferece quando conectado. */}
            {canSyncIntegrations(profile?.role) && erpConnections != null && erpConnections.length > 0 && (
              <React.Suspense fallback={null}>
                <ErpIntelligenceSection onDrill={handleIntelligenceDrill} />
              </React.Suspense>
            )}

          </div>
        )}

        {/* ABA ADMIN */}
        {activeTab === 'admin' && (
          <div>
            {!isLoggedIn ? (
              <div className="max-w-4xl mx-auto p-4 md:p-6 lg:p-8">
                <Panel className="max-w-md mx-auto mt-6">
                  <PanelSection padding="lg" className="text-center">
                    <Lock size={32} className="mx-auto mb-3 text-fg-subtle" />
                    <h2 className="text-title">Acesso Restrito</h2>
                    <p className="text-fg-muted text-sm mt-2">Esta área é restrita a administradores e proprietários.</p>
                    <p className="text-caption mt-3">Perfil atual: {profile?.role ?? '—'}</p>
                  </PanelSection>
                </Panel>
              </div>
            ) : (
              <React.Suspense fallback={<PageLoader />}>
                <AdminDashboardPage
                  role={profile?.role}
                  companyId={companyId ?? ''}
                  companyName={company?.name ?? null}
                  companyCreatedAt={company?.createdAt ?? null}
                  userId={profile?.id ?? ''}
                  userEmail={profile?.email ?? ''}
                  globais={globais}
                  customKPIs={customKPIs}
                  onAddKPI={handleAddKPI}
                  onDeleteKPI={handleDeleteKPI}
                  snapshots={snapshots}
                  onViewSnapshot={(snapshot) => { handleViewSnapshot(snapshot); setShowHistoryModal(true); }}
                  onResetComplete={() => { loadSnapshots(); setBrandsData(prev => prev.map(b => ({ ...b, done_sku: 0, divergences: 0 }))); }}
                  onAddInventoryLine={() => setShowAddBrandModal(true)}
                />
              </React.Suspense>
            )}
          </div>
        )}

        {/* ABA KPIs E INDICADORES */}
        {activeTab === 'kpis' && companyId && (
          <KpisIndicadoresPage companyId={companyId} globais={globais} operatorStats={operatorStats} />
        )}

        {/* ABA RESULTADOS POR LINHA */}
        {activeTab === 'closing-results' && companyId && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <ClosingResultsPage companyId={companyId} brandsData={brandsData} userId={profile.id} userEmail={profile.email ?? null} />
          </React.Suspense>
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
            <CBCDashboardPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} onNavigateToCount={() => setActiveTab('input')} />
          </React.Suspense>
        )}

        {/* ABA INVENTÁRIO POR RISCO */}
        {activeTab === 'risk' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <RiskDashboardPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} onNavigateToCount={() => setActiveTab('input')} />
          </React.Suspense>
        )}

        {/* ABA CLASSIFICAÇÃO ABC/XYZ */}
        {activeTab === 'abcxyz' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <AbcXyzDashboardPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} onOpenProduct={() => setActiveTab('products')} />
          </React.Suspense>
        )}

        {/* ABA WAREHOUSE DIGITAL TWIN */}
        {activeTab === 'slotting' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <WarehouseDigitalTwinPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} role={profile.role} onNavigateToCount={() => setActiveTab('input')} />
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

        {/* ABA ORDENS DE COMPRA */}
        {activeTab === 'purchase-orders' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <PurchaseOrdersPage companyId={companyId} />
          </React.Suspense>
        )}

        {/* ABA LOGÍSTICA REVERSA */}
        {activeTab === 'reverse-logistics' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <ReverseLogisticsPage companyId={companyId} />
          </React.Suspense>
        )}

        {/* ANALYTICS: BLINDSCORE */}
        {activeTab === 'analytics-blindscore' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <BlindScorePage companyId={companyId} onNavigate={(tab) => setActiveTab(tab)} />
          </React.Suspense>
        )}

        {/* ANALYTICS: INVENTORY HEALTH */}
        {activeTab === 'analytics-health' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <InventoryHealthPage companyId={companyId} />
          </React.Suspense>
        )}

        {/* ANALYTICS: IA INSIGHTS */}
        {activeTab === 'analytics-ia' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <IaInsightsPage companyId={companyId} onNavigate={(tab) => setActiveTab(tab)} />
          </React.Suspense>
        )}

        {/* ANALYTICS: AUDITORIAS */}
        {activeTab === 'analytics-audit' && profile && (
          <React.Suspense fallback={<PageLoader />}>
            <AuditsAnalyticsPage companyId={companyId} />
          </React.Suspense>
        )}

        {/* CONFIGURAÇÕES AVANÇADAS: API / WEBHOOKS / LOGS — restrito a owner/admin (ver group.locked em navGroups) */}
        {activeTab === 'config-api' && profile && canManageUsers(profile.role) && (
          <React.Suspense fallback={<PageLoader />}>
            <ApiKeysPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} />
          </React.Suspense>
        )}
        {activeTab === 'config-webhooks' && profile && canManageUsers(profile.role) && (
          <React.Suspense fallback={<PageLoader />}>
            <WebhooksPage companyId={companyId} userId={profile.id} userEmail={profile.email ?? ''} />
          </React.Suspense>
        )}
        {activeTab === 'config-logs' && profile && canManageUsers(profile.role) && (
          <React.Suspense fallback={<PageLoader />}>
            <LogsPage companyId={companyId} />
          </React.Suspense>
        )}
        {activeTab === 'config-empresas-fiscais' && profile && canManageUsers(profile.role) && (
          <React.Suspense fallback={<PageLoader />}>
            <FiscalEntitiesPage companyId={companyId} />
          </React.Suspense>
        )}
        {activeTab === 'config-workspaces' && profile && company && canManageUsers(profile.role) && (
          <React.Suspense fallback={<PageLoader />}>
            <WorkspacesSettingsPage
              company={company}
              companies={companies}
              userId={profile.id}
              userEmail={profile.email}
              switchingCompany={switchingCompany}
              onSwitchCompany={switchCompany}
              onCreateWorkspace={createWorkspace}
              onRefresh={refreshProfile}
            />
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
      {activeTab === 'rankings' && companyId && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <RankingsPage
            onBack={() => setActiveTab('dashboard')}
            companyId={companyId}
            brandsData={globais.tabela}
            topVendas={topVendas}
            operatorStats={operatorStats}
          />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: GERADOR DE ETIQUETAS */}
      {activeTab === 'label-generator' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <LabelGeneratorPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: LABORATÓRIO DE CÓDIGOS DE BARRAS */}
      {activeTab === 'barcode-lab' && hasPermission(profile?.role, 'labels.use') && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <BarcodeLabPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: CENTRAL DE PDFS */}
      {activeTab === 'pdf-center' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <PdfCenterPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: CALCULADORA DE PALETIZAÇÃO */}
      {activeTab === 'pallet-calc' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <PalletCalcPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: FULL MANAGER */}
      {activeTab === 'full-manager' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <FullManagerPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: INVENTORYFULL (app desktop — apresentação e download) */}
      {activeTab === 'inventoryfull' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <InventoryFullPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* CONFERÊNCIA CEGA POR NF-E */}
      {activeTab === 'nfe-conference' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <NFeConferencePage
            onBack={() => setActiveTab('dashboard')}
            initialInvoiceId={nfePendingInvoiceId ?? undefined}
            onConsumedInitialInvoice={() => setNfePendingInvoiceId(null)}
          />
          </React.Suspense>
        </div>
      )}

      {/* FERRAMENTAS: CONSULTA E DOWNLOAD DE XML/NFE */}
      {activeTab === 'nfe-xml-lookup' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <NFeXmlLookupPage
            onBack={() => setActiveTab('dashboard')}
            onTransferToConference={(invoiceId) => {
              setNfePendingInvoiceId(invoiceId);
              setActiveTab('nfe-conference');
            }}
          />
          </React.Suspense>
        </div>
      )}

      {/* GERENCIAMENTO DE USUÁRIOS */}
      {activeTab === 'users' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <UserManagementPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* DIAGNÓSTICO DA OPERAÇÃO.
          Mesma moldura em overlay das demais telas de tela cheia. Opcional por
          definição: sair a qualquer momento devolve ao dashboard, e o rascunho local
          guarda o que já foi respondido. */}
      {activeTab === 'diagnostico' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <OperationDiagnostic
            initial={diagnosticRecord}
            onClose={() => setActiveTab('dashboard')}
            onCompleted={() => setDiagnosticDone(true)}
          />
          </React.Suspense>
        </div>
      )}

      {/* PRIVACIDADE E LEGAL. Mesma moldura em overlay das demais telas cheias. */}
      {activeTab === 'legal' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
            <PrivacyLegalPage />
          </React.Suspense>
        </div>
      )}

      {/* AGENTES E AUTOMAÇÕES.
          A tela é legível para qualquer papel; criar, editar e ativar é restrito, e o
          gate espelha a policy da 051 para não oferecer controle que o banco recusa. */}
      {activeTab === 'automacoes' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <AutomationsPage
            canManage={canManageAutomations(profile?.role)}
            onBack={() => setActiveTab('dashboard')}
          />
          </React.Suspense>
        </div>
      )}

      {/* HUB DE INTEGRAÇÕES — catálogo (ERPs/marketplaces) + status real do Tiny.
          Mesmo gate de papel da tela de gestão abaixo: navegar até o hub sem
          poder gerenciar nada nele não ajudaria ninguém. */}
      {activeTab === 'integracoes-hub' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          {canSyncIntegrations(profile?.role) ? (
            <IntegrationsHubPage
              onBack={() => setActiveTab('dashboard')}
              onManageTiny={() => setActiveTab('integracoes')}
            />
          ) : (
            <AccessDeniedPage onBack={() => setActiveTab('dashboard')} />
          )}
          </React.Suspense>
        </div>
      )}

      {/* INTEGRAÇÕES — ERP e marketplaces.
          Gated on the same roles the sync Edge Function accepts (owner/admin/
          manager). The function refuses anyone else regardless, so this only keeps
          the screen from offering buttons that would come back 403. */}
      {activeTab === 'integracoes' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          {canSyncIntegrations(profile?.role) ? (
            <IntegrationsPage onBack={() => setActiveTab('dashboard')} />
          ) : (
            <AccessDeniedPage onBack={() => setActiveTab('dashboard')} />
          )}
          </React.Suspense>
        </div>
      )}

      {/* CENTRAL DE SEGURANÇA */}
      {activeTab === 'security' && (
        <div className="fixed inset-0 md:left-[calc(17.5rem+env(safe-area-inset-left))] z-[900] bg-surface overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:pl-0 pr-[env(safe-area-inset-right)]">
          <React.Suspense fallback={<PageLoader />}>
          <SecurityPage onBack={() => setActiveTab('dashboard')} />
          </React.Suspense>
        </div>
      )}

      {/* MODAL NOVA LINHA DE CONTAGEM (controle de progresso do inventário — não é
          marca/linha de catálogo; essa vive em Produtos → Linhas e Marcas) */}
      <Modal open={showAddBrandModal} onClose={() => setShowAddBrandModal(false)} title="Nova Linha de Contagem" maxWidth="max-w-md">
        <form onSubmit={handleAddBrand} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Nome da Linha (controle de inventário)</label>
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
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          style={{ zIndex: 'var(--z-modal)' }}
          onClick={() => setShowInstallModal(false)}
        >
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
  const { linkToAZ, createCompany, joinByInviteCode, inviteCodeError, clearInviteCodeError, signOut, user } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [linkingAZ, setLinkingAZ] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);
  const [error, setError] = useState('');

  // Um código de convite informado no cadastro (SignupView, modo "Tenho um código de convite")
  // já foi tentado automaticamente em runAuthSequence antes desta tela aparecer. Se falhou, o
  // motivo chega aqui em vez de a pessoa cair silenciosamente em "criar empresa" sem explicação —
  // consumido uma vez e limpo, para não reaparecer se ela tentar de novo manualmente abaixo.
  useEffect(() => {
    if (inviteCodeError) {
      setError(inviteCodeError);
      clearInviteCodeError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) { setError('Informe o código de convite.'); return; }
    setJoiningByCode(true);
    setError('');
    try {
      await joinByInviteCode(inviteCode.trim());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Código de convite inválido.';
      setError(msg);
      setJoiningByCode(false);
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

        <div className="flex items-center gap-3 my-4" aria-hidden="true">
          <div className="h-px flex-1 bg-edge" />
          <span className="text-[11px] uppercase tracking-wider text-fg-subtle/70">ou</span>
          <div className="h-px flex-1 bg-edge" />
        </div>

        <form onSubmit={handleJoinByCode} className="text-left mb-3">
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1.5">
            Código de Convite da Empresa
          </label>
          <input
            type="text"
            value={inviteCode}
            onChange={e => setInviteCode(e.target.value.toUpperCase())}
            placeholder="Ex.: AB3DFGHJ"
            className="w-full px-4 py-3 mb-3 bg-surface border border-edge rounded-xl text-fg text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition"
          />
          <button
            type="submit"
            disabled={joiningByCode}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-surface-3 hover:bg-edge disabled:opacity-60 text-fg rounded-xl font-bold text-sm transition"
          >
            {joiningByCode ? <Loader2 size={16} className="animate-spin" /> : 'Entrar com código de convite'}
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
  const { view, authLoading, profileLoading, companyId } = useAuth();
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
  if (view === 'login' || view === 'signup' || view === 'forgot' || view === 'update-password' || view === 'confirm-email') return <AuthPage />;

  // Auth still initializing (session check in progress)
  if (authLoading) return <ProfileLoadingOverlay />;

  // Authenticated-only screens
  if (view === 'link-company' || view === 'complete-profile') return <LinkCompanyScreen />;
  if (view === 'select-workspace') return <WorkspaceSelectorScreen />;

  // Profile loading after login
  if (profileLoading && view !== 'app') return <ProfileLoadingOverlay />;

  // Main app.
  //
  // `key={companyId}`: trocar de workspace muda profiles.company_id, e o RLS passa a
  // responder pela empresa nova na hora — mas a árvore React continuava montada, então
  // toda tela que busca dados no mount (sem companyId nas deps) seguia exibindo o que
  // já tinha carregado da empresa anterior. Não é vazamento de banco (uma leitura nova
  // seria barrada), mas na tela é indistinguível de um. Remontar é a única correção que
  // vale para as telas de hoje e para as que ainda vão existir; corrigir dependência a
  // dependência deixaria a próxima tela nova com o mesmo bug.
  //
  // Só dispara na troca: quando `view` vira 'app' o companyId já está resolvido, então
  // não há remontagem extra na entrada. O activeTab volta para o dashboard, que é o
  // correto — a aba aberta descrevia o contexto da empresa anterior.
  // O aceite é exigido depois de a sessão existir e antes do sistema aparecer.
  // Fica AQUI, e não dentro de AppContent, para valer para qualquer empresa
  // selecionada — e porque o `key={companyId}` remontaria o gate a cada troca de
  // workspace, repetindo a verificação sem necessidade.
  if (view === 'app') {
    return (
      <LegalAcceptanceGate>
        <AppContent key={companyId} />
      </LegalAcceptanceGate>
    );
  }

  // Absolute fallback
  return (
    <React.Suspense fallback={<LandingFallback />}>
      <LandingPage />
    </React.Suspense>
  );
}

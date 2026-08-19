/**
 * InventoryFullPage — apresentação e download do aplicativo desktop InventoryFull.
 *
 * InventoryFull é um executável Windows independente (não roda no navegador,
 * não é embarcado por iframe, não é reimplementado como tela do SaaS). Esta
 * página só apresenta o produto e entrega o ZIP oficial como anexo — o
 * cruzamento de planilhas acontece inteiramente no computador do operador.
 *
 * Distribuição: build 1.0.0, sem assinatura Authenticode (ver bloco de
 * segurança abaixo) — nada na página pode sugerir o contrário.
 */

import React, { useState } from 'react';
import {
  ArrowLeft, Download, Loader2, AlertTriangle, ShieldAlert, CheckCircle2,
  Clock, RefreshCcw, HardDrive, FileSpreadsheet, MonitorCheck, ExternalLink,
} from 'lucide-react';
import { Panel, PanelSection, Badge } from './ui';
import { useAuth } from '../lib/auth';
import { logAuditEvent } from '../lib/auditLogService';
import { WHATSAPP_PLANS_URL } from './landing/landingUi';

interface InventoryFullPageProps {
  onBack: () => void;
}

const DOWNLOAD_URL = '/downloads/InventoryFull-win-x64.zip';
const FILE_NAME = 'InventoryFull-win-x64.zip';
const FILE_SIZE_LABEL = '≈ 74 MB (73,8 MB)';
const FILE_SHA256 = 'f14e35a3098c3d7099496644eacf3c11a8634ee8cf85aae1b59bfb8d2bc41858';

const HOW_IT_WORKS = [
  {
    title: 'Exporte as duas planilhas',
    description: 'Obtenha a planilha do depósito Full no Tiny e a planilha do depósito Full do Mercado Livre.',
  },
  {
    title: 'Processe no seu computador',
    description: 'Abra o InventoryFull e selecione os dois arquivos corretos. O cruzamento acontece localmente.',
  },
  {
    title: 'Revise o resultado',
    description: 'Confira produtos, depósitos, diferenças e saldos antes de qualquer alteração em massa.',
  },
  {
    title: 'Importe no Tiny',
    description: 'Use a planilha gerada para realizar a atualização em massa somente após a conferência.',
  },
];

const BENEFITS = [
  {
    icon: Clock,
    title: 'Economia de tempo',
    description: 'Reduza um trabalho operacional de semanas para minutos.',
  },
  {
    icon: RefreshCcw,
    title: 'Cruzamento automatizado',
    description: 'Compare as bases do Full Tiny e do Full Mercado Livre com menos trabalho manual.',
  },
  {
    icon: HardDrive,
    title: 'Processamento local',
    description: 'Os arquivos são tratados no computador do operador, mantendo o controle do processo com quem executa o inventário.',
  },
];

type DownloadState = 'idle' | 'loading' | 'started' | 'error';

export const InventoryFullPage: React.FC<InventoryFullPageProps> = ({ onBack }) => {
  const { company, companyId, profile } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [state, setState] = useState<DownloadState>('idle');

  const handleDownload = async () => {
    if (!agreed || state === 'loading') return;
    setState('loading');
    try {
      // HEAD-only reachability check — the actual 73MB transfer is handled
      // natively by the browser via the anchor below, never buffered in JS.
      const res = await fetch(DOWNLOAD_URL, { method: 'HEAD' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const a = document.createElement('a');
      a.href = DOWNLOAD_URL;
      a.download = FILE_NAME;
      document.body.appendChild(a);
      a.click();
      a.remove();

      if (companyId && profile) {
        // No PII / spreadsheet content — just marks that a download started.
        logAuditEvent({
          companyId,
          userId: profile.id,
          userEmail: profile.email ?? '',
          action: 'tools.inventoryfull_download_started',
          resourceType: 'inventoryfull',
          description: 'Download do InventoryFull iniciado',
        });
      }
      setState('started');
      setTimeout(() => setState('idle'), 4000);
    } catch {
      setState('error');
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-50 bg-surface border-b border-edge">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-fg hover:bg-surface-3 rounded-lg transition text-sm font-medium">
            <ArrowLeft size={16} /><span className="hidden sm:inline">Voltar</span>
          </button>
          <span className="text-sm font-semibold text-fg">InventoryFull</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* HERO */}
        <Panel>
          <PanelSection padding="lg">
            <p className="text-overline text-accent mb-3">Inventário Full automatizado</p>
            <h1 className="text-display max-w-2xl">
              Transforme semanas de conferência em cerca de 20 minutos
            </h1>
            <p className="text-body text-fg-muted mt-4 max-w-2xl">
              O InventoryFull cruza as planilhas do depósito Full do Tiny e do Mercado Livre,
              identifica as diferenças e entrega uma planilha atualizada para você revisar e
              importar em massa no Tiny.
            </p>
            <p className="text-caption mt-3 max-w-2xl">
              Um processo que pode levar de 2 a 4 semanas pode ser concluído em cerca de 20
              minutos, conforme o volume e a qualidade dos dados.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <a
                href="#baixar-inventoryfull"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-control bg-accent hover:bg-accent-strong text-white font-semibold text-sm transition-colors"
              >
                <Download size={16} />
                Baixar InventoryFull para Windows
              </a>
              <Badge variant="neutral">Aplicativo para Windows</Badge>
            </div>
            <p className="text-caption mt-3">
              Versão 1.0.0 · Windows 64 bits · Download em ZIP · {FILE_SIZE_LABEL}
            </p>
          </PanelSection>
        </Panel>

        {/* COMO FUNCIONA */}
        <Panel>
          <PanelSection padding="lg">
            <p className="text-section mb-4">Como funciona</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {HOW_IT_WORKS.map((step, i) => (
                <div key={step.title} className="p-4 rounded-container border border-edge bg-surface-2">
                  <span className="text-caption font-semibold text-accent">Passo {i + 1}</span>
                  <p className="text-sm font-semibold text-fg mt-1">{step.title}</p>
                  <p className="text-sm text-fg-muted mt-1">{step.description}</p>
                </div>
              ))}
            </div>
          </PanelSection>
        </Panel>

        {/* BENEFÍCIOS */}
        <Panel>
          <PanelSection padding="lg">
            <p className="text-section mb-4">Benefícios</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {BENEFITS.map(b => (
                <div key={b.title} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-9 h-9 rounded-control bg-accent/10 text-accent flex items-center justify-center">
                    <b.icon size={17} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-fg">{b.title}</p>
                    <p className="text-sm text-fg-muted mt-0.5">{b.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </PanelSection>
        </Panel>

        {/* PRIVACIDADE */}
        <Panel>
          <PanelSection padding="lg">
            <p className="text-section mb-2">Seus arquivos permanecem no seu computador</p>
            <p className="text-sm text-fg-muted">
              O InventoryFull é executado localmente no Windows. As planilhas usadas no
              inventário não precisam ser enviadas ao InventoryBlind para que o aplicativo
              faça o cruzamento. O resultado é salvo no próprio computador para conferência
              do operador.
            </p>
          </PanelSection>
        </Panel>

        {/* REQUISITOS */}
        <Panel>
          <PanelSection padding="lg">
            <p className="text-section mb-3">Requisitos e instruções</p>
            <ul className="space-y-2 text-sm text-fg-muted">
              <li className="flex items-start gap-2"><MonitorCheck size={15} className="flex-shrink-0 mt-0.5 text-fg-subtle" />Windows 64 bits.</li>
              <li className="flex items-start gap-2"><FileSpreadsheet size={15} className="flex-shrink-0 mt-0.5 text-fg-subtle" />Baixe o arquivo ZIP.</li>
              <li className="flex items-start gap-2"><FileSpreadsheet size={15} className="flex-shrink-0 mt-0.5 text-fg-subtle" />Extraia todos os arquivos para uma pasta antes de abrir o aplicativo.</li>
              <li className="flex items-start gap-2"><FileSpreadsheet size={15} className="flex-shrink-0 mt-0.5 text-fg-subtle" />Execute <code className="text-numeric bg-surface-3 px-1 py-0.5 rounded">InventoryFull.exe</code> mantendo as DLLs distribuídas na mesma pasta.</li>
            </ul>
            <p className="text-caption mt-4">
              Precisa de ajuda?{' '}
              <a
                href={WHATSAPP_PLANS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-accent-strong font-medium inline-flex items-center gap-1"
              >
                Falar com o suporte <ExternalLink size={11} />
              </a>
            </p>
          </PanelSection>
        </Panel>

        {/* SEGURANÇA DA DISTRIBUIÇÃO */}
        <Panel>
          <PanelSection padding="lg">
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-fg">Esta versão ainda não possui assinatura digital</p>
                <p className="text-sm text-fg-muted mt-1">
                  O Windows pode exibir um alerta de reputação (SmartScreen) ao abrir o
                  instalador, pois o executável desta versão 1.0.0 ainda não foi assinado com
                  um certificado de editor. Se isso acontecer, confirme a autenticidade do
                  download com o suporte do InventoryBlind antes de prosseguir.
                </p>
              </div>
            </div>
          </PanelSection>
        </Panel>

        {/* ATENÇÃO + CONFIRMAÇÃO + DOWNLOAD */}
        <Panel id="baixar-inventoryfull">
          <PanelSection padding="lg">
            <div className="flex items-start gap-3 p-4 rounded-container bg-amber-500/10 border border-amber-500/25">
              <AlertTriangle size={18} className="flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-fg">Atenção antes de atualizar o estoque</p>
                <p className="text-sm text-fg-muted mt-1">
                  Alterações em massa exigem conferência e responsabilidade do operador.
                  Verifique se as duas planilhas pertencem aos depósitos corretos, revise o
                  arquivo gerado e mantenha um backup/exportação do estoque atual antes de
                  importar qualquer saldo no Tiny. A seleção de um depósito incorreto pode
                  alterar todo o estoque correspondente.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 mt-5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-edge text-accent focus:ring-2 focus:ring-accent/40"
              />
              <span className="text-sm text-fg-muted">
                Li as orientações e entendo que devo revisar os depósitos e a planilha gerada
                antes da importação em massa.
              </span>
            </label>

            {state === 'error' && (
              <div className="flex items-start gap-2 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-control text-sm text-red-600 dark:text-red-400">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <div>
                  Não foi possível iniciar o download agora.{' '}
                  <button onClick={handleDownload} className="underline font-medium">Tentar novamente</button>
                  {' '}ou{' '}
                  <a href={WHATSAPP_PLANS_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                    falar com o suporte
                  </a>.
                </div>
              </div>
            )}

            {state === 'started' && (
              <div className="flex items-center gap-2 mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-control text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={15} className="flex-shrink-0" />
                Download iniciado — verifique a pasta de downloads do seu navegador.
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={!agreed || state === 'loading'}
              className="w-full sm:w-auto mt-5 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-control bg-accent hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
            >
              {state === 'loading' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Baixar InventoryFull para Windows
            </button>
            <p className="text-caption mt-3">
              Versão 1.0.0 · Windows 64 bits · {FILE_NAME} · {FILE_SIZE_LABEL}
            </p>
            <p className="text-caption mt-1 font-mono text-[10px] break-all text-fg-subtle">
              SHA-256: {FILE_SHA256}
            </p>
          </PanelSection>
        </Panel>
      </div>
    </div>
  );
};

export default InventoryFullPage;

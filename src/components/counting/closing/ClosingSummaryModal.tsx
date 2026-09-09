// Fechamento da linha — visualização READ-ONLY de um fechamento já gravado. Nada aqui
// gera, reprocessa ou reclassifica: os 6 indicadores e as categorias vêm do que o
// relatório persistiu (ver closingReportService.ts), e exportar/gerar feedback são
// leituras do mesmo modelo canônico (closingDocumentModel.ts).

import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Copy, Download, FileText } from 'lucide-react';
import { Modal, Button, Badge, Panel, PanelSection, Input, Textarea } from '../../ui';
import type { ClosingReport, ClosingReportObservation } from '../../../lib/closingReports/closingReportTypes';
import {
  buildClosingReportDocument,
  formatClosingDateTime,
  CLOSING_METRIC_ROWS,
} from '../../../lib/closingReports/closingDocumentModel';
import { downloadClosingReportPdf, downloadClosingReportWord } from '../../../lib/closingReports/closingReportExport';
import { renderClosingFeedback } from '../../../lib/closingReports/closingFeedbackTemplate';
import { BrandMark } from '../../brandLogos/BrandMark';

interface ClosingSummaryModalProps {
  open: boolean;
  onClose: () => void;
  brandName: string;
  /** Logo da marca desta linha no workspace atual. Ausente = só o título. */
  brandLogoUrl?: string | null;
  report: ClosingReport | null;
  observations: ClosingReportObservation[];
  /** Ações extras do rodapé. O fluxo de contagem injeta as dele por aqui (ver
   *  CountClosingSummaryModal.tsx); a visualização histórica não passa nada, porque
   *  abrir um fechamento gravado é só leitura. */
  footerActions?: ReactNode;
}

export function ClosingSummaryModal({
  open, onClose, brandName, brandLogoUrl, report, observations, footerActions,
}: ClosingSummaryModalProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [showUnclassified, setShowUnclassified] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'doc' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [employeeName, setEmployeeName] = useState('');
  const [employeeRole, setEmployeeRole] = useState('');
  const [managerNote, setManagerNote] = useState('');
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Modelo canônico: única fonte do PDF, do Word e do feedback.
  const doc = useMemo(
    () => (report ? buildClosingReportDocument({ brandName, report, observations, brandLogo: brandLogoUrl ?? null }) : null),
    [brandName, report, observations, brandLogoUrl]
  );

  if (!report || !doc) return null;

  const unclassified = observations.filter(o => o.isUnclassified);
  const observationsByCategory = (categoryId: string) => observations.filter(o => o.matchedCategoryIds.includes(categoryId));

  async function handleExport(kind: 'pdf' | 'doc') {
    if (!doc) return;
    setExportOpen(false);
    setExporting(kind);
    setExportError(null);
    try {
      if (kind === 'pdf') await downloadClosingReportPdf(doc);
      else await downloadClosingReportWord(doc);
    } catch (err) {
      console.error('Error exporting closing report:', err);
      setExportError('Não foi possível gerar o arquivo.');
    } finally {
      setExporting(null);
    }
  }

  function handlePrepareFeedback() {
    if (!doc || !employeeName.trim()) return;
    setFeedbackText(renderClosingFeedback(doc, {
      employeeName,
      role: employeeRole,
      managerNote,
    }));
    setCopied(false);
  }

  async function handleCopyFeedback() {
    if (!feedbackText) return;
    try {
      await navigator.clipboard.writeText(feedbackText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-3 min-w-0">
          {brandLogoUrl && <BrandMark name={brandName} url={brandLogoUrl} size="md" />}
          <span className="min-w-0">
            <span className="block truncate">Fechamento da linha — {brandName}</span>
            <span className="block text-xs font-normal text-fg-subtle">{formatClosingDateTime(report.generatedAt)}</span>
          </span>
        </span>
      }
      maxWidth="max-w-2xl"
    >
      <div className="space-y-5">
        <div className="p-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg flex items-start gap-2 text-sm">
          <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" />
          <span>Linha concluída — pendentes chegaram a zero.</span>
        </div>

        <Panel>
          <PanelSection padding="md" className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {CLOSING_METRIC_ROWS.map(row => (
              <Stat key={row.label} label={row.label} value={row.value(doc.metrics)} />
            ))}
          </PanelSection>
        </Panel>

        <div>
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2">Categorias identificadas</p>
          {report.categoryCounts.length === 0 && unclassified.length === 0 && (
            <p className="text-sm text-fg-subtle">Nenhuma observação registrada nas contagens deste fechamento.</p>
          )}
          <div className="space-y-1.5">
            {report.categoryCounts.map(c => {
              const isOpen = expandedCategory === c.categoryId;
              const items = observationsByCategory(c.categoryId);
              return (
                <div key={c.categoryId} className="rounded-lg border border-edge">
                  <button
                    type="button"
                    onClick={() => setExpandedCategory(isOpen ? null : c.categoryId)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <span className="text-sm text-fg">{c.name}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="accent">{c.count} registro{c.count === 1 ? '' : 's'}</Badge>
                      {isOpen ? <ChevronDown size={14} className="text-fg-subtle" /> : <ChevronRight size={14} className="text-fg-subtle" />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-2.5 space-y-1.5 border-t border-edge/60 pt-2">
                      {items.map(o => (
                        <p key={o.id} className="text-xs text-fg-muted italic">"{o.observationText}"</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {unclassified.length > 0 && (
          <div className="rounded-lg border border-edge">
            <button
              type="button"
              onClick={() => setShowUnclassified(s => !s)}
              className="w-full flex items-center justify-between px-3 py-2 text-left"
            >
              <span className="text-sm text-fg">Observações não classificadas</span>
              <span className="flex items-center gap-2">
                <Badge variant="neutral">{unclassified.length}</Badge>
                {showUnclassified ? <ChevronDown size={14} className="text-fg-subtle" /> : <ChevronRight size={14} className="text-fg-subtle" />}
              </span>
            </button>
            {showUnclassified && (
              <div className="px-3 pb-2.5 space-y-1.5 border-t border-edge/60 pt-2">
                {unclassified.map(o => (
                  <p key={o.id} className="text-xs text-fg-muted italic">"{o.observationText}"</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="border-t border-edge pt-4">
          <p className="text-sm font-semibold text-fg">Preparar feedback ao responsável</p>
          <p className="text-caption mt-0.5">
            Gere um feedback formal com base neste fechamento para envio ao responsável pela linha.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Nome do funcionário *</label>
              <Input value={employeeName} onChange={e => setEmployeeName(e.target.value)} placeholder="Digite o nome do funcionário" />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Cargo ou função (opcional)</label>
              <Input value={employeeRole} onChange={e => setEmployeeRole(e.target.value)} placeholder="Digite o cargo ou função" />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-medium text-fg-muted mb-1">Observação complementar (opcional)</label>
            <Textarea rows={2} value={managerNote} onChange={e => setManagerNote(e.target.value)} placeholder="Digite uma observação complementar" />
          </div>
          <div className="mt-3">
            <Button size="sm" onClick={handlePrepareFeedback} disabled={!employeeName.trim()}>
              <ClipboardCheck size={14} /> Preparar feedback
            </Button>
          </div>

          {feedbackText && (
            <div className="mt-3 space-y-2">
              <Textarea rows={10} value={feedbackText} readOnly className="font-mono text-xs" />
              <Button size="sm" variant="secondary" onClick={handleCopyFeedback}>
                <Copy size={14} /> {copied ? 'Copiado' : 'Copiar texto'}
              </Button>
            </div>
          )}
        </div>

        {exportError && <p className="text-xs text-red-600 dark:text-red-400">{exportError}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setExportOpen(o => !o)} disabled={exporting !== null}>
              <Download size={14} /> {exporting ? 'Gerando...' : 'Exportar relatório'}
              <ChevronDown size={14} />
            </Button>
            {exportOpen && (
              <div className="absolute left-0 bottom-full mb-1 w-48 rounded-lg border border-edge bg-surface shadow-overlay py-1 z-10">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-surface-3 text-left"
                  onClick={() => handleExport('pdf')}
                >
                  <FileText size={14} className="text-fg-subtle" /> Exportar em PDF
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-surface-3 text-left"
                  onClick={() => handleExport('doc')}
                >
                  <FileText size={14} className="text-fg-subtle" /> Exportar em Word
                </button>
              </div>
            )}
          </div>
          {footerActions}
          <Button size="sm" onClick={onClose} className="ml-auto">Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="text-base font-semibold text-fg">{value}</p>
    </div>
  );
}

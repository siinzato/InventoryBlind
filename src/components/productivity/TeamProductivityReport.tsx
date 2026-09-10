import { useState } from 'react';
import { jsPDF } from 'jspdf';
import { FileText, FileSpreadsheet } from 'lucide-react';
import { PanelSection, Button } from '../ui';
import { UserProductivityStats } from '../../lib/supabase';
import { logAuditEvent } from '../../lib/auditLogService';

interface TeamProductivityReportProps {
  companyId: string;
  team: UserProductivityStats[];
  userId: string;
  userEmail: string;
}

export function TeamProductivityReport({ companyId, team, userId, userEmail }: TeamProductivityReportProps) {
  const [exporting, setExporting] = useState(false);

  const destaques = team.filter(t => (t.acuracidade_media ?? 0) >= 95 && t.skus_contados >= 500);
  const emAtencao = team.filter(t => t.contagens > 0 && ((t.acuracidade_media ?? 100) < 85 || t.skus_contados < 300));
  const recomendacoes = emAtencao.map(t => `${t.name ?? 'Colaborador'}: recomenda-se acompanhamento próximo (acuracidade ${(t.acuracidade_media ?? 0).toFixed(1)}%, ${t.skus_contados} SKUs).`);
  const resumo = `Equipe com ${team.length} colaboradores, ${destaques.length} em destaque e ${emAtencao.length} precisando de atenção.`;

  const buildRows = (): string[][] => {
    const header = ['Nome', 'Cargo', 'SKUs', 'Acuracidade', 'Divergências', 'Fulls', 'Etiquetas'];
    const rows = team.map(t => [
      t.name ?? '—', t.role, String(t.skus_contados),
      t.acuracidade_media !== null ? `${t.acuracidade_media.toFixed(1)}%` : '—',
      String(t.divergencias_reais), String(t.fulls_realizados), String(t.etiquetas_geradas),
    ]);
    return [header, ...rows];
  };

  const logExport = async (format: string) => {
    await logAuditEvent({ companyId, userId, userEmail, action: 'productivity.report_export', resourceType: 'team_productivity_report', metadata: { format } });
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet(buildRows());
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Equipe');
      XLSX.writeFile(wb, 'relatorio_equipe_produtividade.xlsx');
      await logExport('excel');
    } finally { setExporting(false); }
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text('Relatório da Equipe — Produtividade', 14, 18);
      doc.setFontSize(10);
      let y = 30;
      const write = (text: string) => {
        const lines = doc.splitTextToSize(text, 180);
        doc.text(lines, 14, y);
        y += 7 * lines.length;
      };
      write(`Resumo Executivo: ${resumo}`);
      write(`Destaques: ${destaques.map(d => d.name).join(', ') || 'nenhum'}`);
      write(`Colaboradores em Atenção: ${emAtencao.map(d => d.name).join(', ') || 'nenhum'}`);
      recomendacoes.forEach(r => write(`Recomendação: ${r}`));
      doc.save('relatorio_equipe_produtividade.pdf');
      await logExport('pdf');
    } finally { setExporting(false); }
  };

  return (
    <PanelSection padding="md" className="space-y-2">
      <p className="text-section">Relatório da Equipe</p>
      <p className="text-sm text-fg-muted">{resumo}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={exporting} onClick={handleExportPDF}><FileText size={14} /> Gerar Relatório (PDF)</Button>
        <Button variant="secondary" size="sm" disabled={exporting} onClick={handleExportExcel}><FileSpreadsheet size={14} /> Excel</Button>
      </div>
    </PanelSection>
  );
}

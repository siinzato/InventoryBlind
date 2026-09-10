import { useState } from 'react';
import { jsPDF } from 'jspdf';
import { FileText, FileSpreadsheet, FileDown } from 'lucide-react';
import { PanelSection, Button, SegmentedControl } from '../ui';
import { downloadFile } from '../../lib/productImportUtils';
import { UserProductivityStats } from '../../lib/supabase';
import { ReportPeriod, resolvePeriodRange, getProductivityForPeriod, generateExecutiveSummary } from '../../lib/productivityService';
import { logAuditEvent } from '../../lib/auditLogService';

interface ProductivityReportExportProps {
  employeeName: string;
  userId: string;
  companyId: string;
  userEmail: string;
  stats: UserProductivityStats;
  rank?: number;
}

const PERIOD_LABEL: Record<ReportPeriod, string> = {
  today: 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias',
  this_month: 'Este mês', last_month: 'Mês anterior', custom: 'Personalizado',
};

export function ProductivityReportExport({ employeeName, userId, companyId, userEmail, stats, rank }: ProductivityReportExportProps) {
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [exporting, setExporting] = useState(false);

  const buildReportRows = async () => {
    const { from, to } = resolvePeriodRange(period);
    const periodStats = await getProductivityForPeriod(userId, from, to);
    return [
      ['Colaborador', employeeName],
      ['Período', PERIOD_LABEL[period]],
      ['SKUs Contados', String(periodStats.skus_contados)],
      ['Contagens', String(periodStats.contagens)],
      ['Recontagens', String(periodStats.recontagens)],
      ['Divergências Encontradas', String(periodStats.divergencias_encontradas)],
      ['Divergências Reais', String(periodStats.divergencias_reais)],
      ['Acuracidade Média', periodStats.acuracidade_media !== null ? `${periodStats.acuracidade_media.toFixed(1)}%` : '—'],
      ['Ranking Interno', rank ? `#${rank}` : '—'],
      ['Resumo', generateExecutiveSummary(stats)],
    ];
  };

  const logExport = async (format: string) => {
    await logAuditEvent({
      companyId, userId, userEmail,
      action: 'productivity.report_export',
      resourceType: 'productivity_report',
      metadata: { format, period },
    });
  };

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const rows = await buildReportRows();
      const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(';')).join('\n');
      downloadFile(csv, `produtividade_${employeeName.replace(/\s+/g, '_')}.csv`, 'text/csv;charset=utf-8');
      await logExport('csv');
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const rows = await buildReportRows();
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Produtividade');
      XLSX.writeFile(wb, `produtividade_${employeeName.replace(/\s+/g, '_')}.xlsx`);
      await logExport('excel');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const rows = await buildReportRows();
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text('Relatório de Produtividade', 14, 18);
      doc.setFontSize(10);
      let y = 30;
      rows.forEach(([label, value]) => {
        const lines = doc.splitTextToSize(`${label}: ${value}`, 180);
        doc.text(lines, 14, y);
        y += 7 * lines.length;
      });
      doc.save(`produtividade_${employeeName.replace(/\s+/g, '_')}.pdf`);
      await logExport('pdf');
    } finally {
      setExporting(false);
    }
  };

  return (
    <PanelSection padding="md" className="space-y-3">
      <p className="text-section">Relatório de Produtividade</p>
      <SegmentedControl
        label="Período do relatório"
        options={(Object.keys(PERIOD_LABEL) as ReportPeriod[]).map(p => ({ value: p, label: PERIOD_LABEL[p] }))}
        value={period}
        onChange={setPeriod}
      />
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={exporting} onClick={handleExportPDF}><FileText size={14} /> PDF</Button>
        <Button variant="secondary" size="sm" disabled={exporting} onClick={handleExportExcel}><FileSpreadsheet size={14} /> Excel</Button>
        <Button variant="secondary" size="sm" disabled={exporting} onClick={handleExportCSV}><FileDown size={14} /> CSV</Button>
      </div>
    </PanelSection>
  );
}

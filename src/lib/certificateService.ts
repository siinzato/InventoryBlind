// I.B Academy — certificados. Metadados vivem em academy_certificates (nunca um blob);
// o PDF é sempre regenerado sob demanda a partir desses dados, mesmo padrão jsPDF +
// html2canvas + createRoot off-screen já usado em LabelGeneratorPage.tsx.

import React from 'react';
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { supabase, AcademyCertificate, AcademyTrackProgressRow } from './supabase';
import { logAuditEvent } from './auditLogService';
import { CertificateRenderTemplate } from '../components/academy/CertificateRenderTemplate';

export function hasEarnedCertificate(trackProgress: AcademyTrackProgressRow): boolean {
  return trackProgress.courses_total > 0 && trackProgress.courses_completed === trackProgress.courses_total;
}

export async function issueCertificateIfEligible(
  userId: string,
  userEmail: string,
  companyId: string,
  trackId: string,
  learnerName: string,
  totalHours: number
): Promise<AcademyCertificate | null> {
  const { data: existing } = await supabase
    .from('academy_certificates').select('*').eq('user_id', userId).eq('track_id', trackId).maybeSingle();
  if (existing) return existing as AcademyCertificate;

  const { data, error } = await supabase
    .from('academy_certificates')
    .insert({ user_id: userId, company_id: companyId, track_id: trackId, learner_name: learnerName, total_workload_hours: totalHours })
    .select()
    .maybeSingle();

  if (error) { console.error('Error issuing academy certificate:', error); return null; }
  if (data) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'academy.certificate_generated', resourceType: 'academy_certificate', resourceId: data.id });
  }
  return (data ?? null) as AcademyCertificate | null;
}

export async function getMyCertificates(userId: string, companyId: string): Promise<AcademyCertificate[]> {
  const { data, error } = await supabase
    .from('academy_certificates').select('*').eq('user_id', userId).eq('company_id', companyId);
  if (error) { console.error('Error loading academy certificates:', error); return []; }
  return (data ?? []) as AcademyCertificate[];
}

async function captureEl(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, { scale: 4, useCORS: true, backgroundColor: '#ffffff', allowTaint: false });
}

export interface CertificateData {
  learnerName: string;
  trackTitle: string;
  totalHours: number;
  issuedAt: string;
}

/** Off-screen render + capture, mirrors LabelGeneratorPage.tsx's captureProductLabel:
 *  createRoot into a position:fixed;left:-9999px container, 150ms settle, html2canvas at
 *  scale 4, embed into an A4-landscape jsPDF, save. Visual QR box is a placeholder only —
 *  no scan-to-verify backend exists (structure prepared, not a real verification system). */
export async function generateCertificatePDF(cert: CertificateData): Promise<void> {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;background:white;';
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
      root.render(React.createElement(CertificateRenderTemplate, cert));
      setTimeout(async () => {
        const el = container.firstElementChild as HTMLElement | null;
        if (!el) { reject(new Error('certificate element not rendered')); return; }
        try { resolve(await captureEl(el)); } catch (e) { reject(e); }
      }, 150);
    });

    const imgData = canvas.toDataURL('image/png');
    const wMM = 297;
    const hMM = 210;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [wMM, hMM] });
    pdf.addImage(imgData, 'PNG', 0, 0, wMM, hMM);
    pdf.save(`certificado-${cert.trackTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  } catch (err) {
    console.error('[Certificate] PDF generation error:', err);
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

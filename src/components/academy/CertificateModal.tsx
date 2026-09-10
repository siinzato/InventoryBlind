import { Download } from 'lucide-react';
import { Modal, Button } from '../ui';
import { generateCertificatePDF } from '../../lib/certificateService';

interface CertificateModalProps {
  open: boolean;
  onClose: () => void;
  learnerName: string;
  trackTitle: string;
  totalHours: number;
}

export function CertificateModal({ open, onClose, learnerName, trackTitle, totalHours }: CertificateModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Certificado — I.B Academy" maxWidth="max-w-md">
      <div className="space-y-4 text-center">
        <p className="text-sm text-fg-muted">Parabéns, {learnerName}! Você concluiu a trilha</p>
        <p className="text-lg font-bold text-fg">{trackTitle}</p>
        <p className="text-xs text-fg-subtle">Carga horária: {totalHours}h</p>
        <Button onClick={() => generateCertificatePDF({ learnerName, trackTitle, totalHours, issuedAt: new Date().toISOString() })}>
          <Download size={16} /> Baixar Certificado (PDF)
        </Button>
      </div>
    </Modal>
  );
}

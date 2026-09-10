import type { CertificateData } from '../../lib/certificateService';

/** Off-screen capture target for certificateService.generateCertificatePDF — inline styles
 *  (not Tailwind/theme tokens) on purpose, same reasoning as the printed label components in
 *  LabelGeneratorPage.tsx: this is captured as an image and must render identically regardless
 *  of the app's current light/dark theme. */
export function CertificateRenderTemplate({ learnerName, trackTitle, totalHours, issuedAt }: CertificateData) {
  return (
    <div
      style={{
        width: '1122px', height: '793px', background: '#ffffff', color: '#0f172a',
        padding: '64px', boxSizing: 'border-box', fontFamily: 'sans-serif',
        border: '2px solid #1d4ed8', position: 'relative',
      }}
    >
      <p style={{ fontSize: 14, letterSpacing: 2, textTransform: 'uppercase', color: '#1d4ed8', fontWeight: 700, margin: 0 }}>
        InventoryBlind Academy
      </p>
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Método I.B.® — Metodologia Oficial InventoryBlind</p>

      <p style={{ fontSize: 20, marginTop: 64 }}>Certifica que</p>
      <p style={{ fontSize: 40, fontWeight: 800, marginTop: 8 }}>{learnerName}</p>
      <p style={{ fontSize: 20, marginTop: 24 }}>Concluiu com sucesso a Trilha</p>
      <p style={{ fontSize: 28, fontWeight: 700, color: '#1d4ed8', marginTop: 8 }}>{trackTitle}</p>
      <p style={{ fontSize: 16, marginTop: 8 }}>seguindo o Método I.B.®</p>

      <div style={{ position: 'absolute', bottom: 64, left: 64, display: 'flex', gap: 48 }}>
        <div>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Carga Horária</p>
          <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{totalHours}h</p>
        </div>
        <div>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Data</p>
          <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{new Date(issuedAt).toLocaleDateString('pt-BR')}</p>
        </div>
      </div>

      <div
        style={{
          position: 'absolute', bottom: 64, right: 64, width: 90, height: 90,
          border: '2px solid #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: '#64748b', textAlign: 'center',
        }}
      >
        QR Code de Validação (estrutura preparada)
      </div>
    </div>
  );
}

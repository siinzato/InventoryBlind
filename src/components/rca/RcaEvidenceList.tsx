import { useState } from 'react';
import { Paperclip, Link2 } from 'lucide-react';
import { Panel, PanelSection, Button, Badge, Select, Textarea } from '../ui';
import { uploadEvidence, linkEvidenceToRecord, getEvidenceSignedUrl } from '../../lib/rcaService';
import type { RcaEvidence, RcaEvidenceType, RcaRecord } from '../../lib/supabase';

const TYPE_LABEL: Record<RcaEvidenceType, string> = {
  divergencia: 'Divergência', contagem: 'Contagem', movimentacao: 'Movimentação', picking: 'Picking',
  sistema: 'Sistema', produto: 'Produto', endereco: 'Endereço', fornecedor: 'Fornecedor',
  observacao: 'Observação', anexo: 'Anexo',
};

interface RcaEvidenceListProps {
  caseId: string;
  companyId: string;
  userId: string;
  evidence: RcaEvidence[];
  divergences: RcaRecord[];
  onChanged: () => void;
}

/** Evidência estruturada: sempre com tipo/origem/data/usuário e, quando possível,
 *  referência ao registro original (nunca texto solto quando o vínculo existir) — por
 *  isso "Divergência" aponta para uma das ocorrências já vinculadas ao caso em vez de
 *  copiar o dado, e "Observação" (sem registro de origem correspondente) aceita texto. */
export function RcaEvidenceList({ caseId, companyId, userId, evidence, divergences, onChanged }: RcaEvidenceListProps) {
  const [note, setNote] = useState('');
  const [selectedDivergenceId, setSelectedDivergenceId] = useState('');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSaving(true);
    await uploadEvidence(null, caseId, companyId, Array.from(files), userId, 'anexo');
    setSaving(false);
    onChanged();
  };

  const handleLinkDivergence = async () => {
    if (!selectedDivergenceId) return;
    setSaving(true);
    await linkEvidenceToRecord(caseId, companyId, { evidenceType: 'divergencia', sourceTable: 'rca_records', sourceRecordId: selectedDivergenceId }, userId);
    setSelectedDivergenceId('');
    setSaving(false);
    onChanged();
  };

  const handleAddObservation = async () => {
    if (!note.trim()) return;
    setSaving(true);
    await linkEvidenceToRecord(caseId, companyId, { evidenceType: 'observacao', sourceTable: 'observacao', sourceRecordId: caseId, note: note.trim() }, userId);
    setNote('');
    setSaving(false);
    onChanged();
  };

  const openFile = async (path: string) => {
    const url = await getEvidenceSignedUrl(path);
    if (url) setUrls(prev => ({ ...prev, [path]: url }));
  };

  return (
    <Panel>
      <PanelSection padding="sm"><p className="text-section">Evidências</p></PanelSection>
      <PanelSection padding="md" className="space-y-3">
        {evidence.length === 0 ? (
          <p className="text-xs text-fg-subtle">Nenhuma evidência vinculada ainda.</p>
        ) : (
          <div className="space-y-2">
            {evidence.map(e => {
              const divergence = e.source_table === 'rca_records' ? divergences.find(d => d.id === e.source_record_id) : null;
              return (
                <div key={e.id} className="p-2.5 border border-edge rounded-container space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{TYPE_LABEL[e.evidence_type]}</Badge>
                    <span className="text-[10px] text-fg-subtle">{new Date(e.created_at).toLocaleString('pt-BR')}</span>
                  </div>
                  {divergence && <p className="text-xs text-fg-muted">{divergence.sku ?? divergence.product_name ?? divergence.location ?? divergence.id} · {divergence.divergence_qty > 0 ? '+' : ''}{divergence.divergence_qty}</p>}
                  {e.note && <p className="text-xs text-fg-muted">{e.note}</p>}
                  {e.file_path && (
                    urls[e.file_path]
                      ? <a href={urls[e.file_path]} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">{e.file_name ?? 'Ver arquivo'}</a>
                      : <button type="button" onClick={() => openFile(e.file_path!)} className="text-xs text-accent hover:underline">{e.file_name ?? 'Ver arquivo'}</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2 pt-2 border-t border-edge">
          <label className="flex items-center gap-1.5 text-xs font-medium text-accent cursor-pointer w-fit">
            <Paperclip size={12} /> Anexar arquivo
            <input type="file" accept="image/png,image/jpeg,.pdf" multiple className="hidden" onChange={e => handleUpload(e.target.files)} />
          </label>

          {divergences.length > 0 && (
            <div className="flex gap-2">
              <Select value={selectedDivergenceId} onChange={e => setSelectedDivergenceId(e.target.value)} aria-label="Vincular divergência" className="flex-1">
                <option value="">Vincular divergência do caso...</option>
                {divergences.map(d => <option key={d.id} value={d.id}>{d.sku ?? d.product_name ?? d.location ?? d.id}</option>)}
              </Select>
              <Button variant="secondary" size="sm" onClick={handleLinkDivergence} disabled={saving || !selectedDivergenceId}><Link2 size={12} /></Button>
            </div>
          )}

          <div className="flex gap-2">
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Observação livre..." rows={1} className="flex-1" />
            <Button variant="secondary" size="sm" onClick={handleAddObservation} disabled={saving || !note.trim()}>Adicionar</Button>
          </div>
        </div>
      </PanelSection>
    </Panel>
  );
}

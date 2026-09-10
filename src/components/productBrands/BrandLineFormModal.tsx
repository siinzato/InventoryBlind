import { useEffect, useRef, useState } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { Modal, Button, Input, Textarea, Select } from '../ui';
import { useAuth } from '../../lib/auth';
import { createBrand, updateBrand, createLine, updateLine, type ProductBrand, type ProductLine } from '../../lib/productBrands/productBrandService';
import { removeBrandLogo, signSingleBrandLogo, uploadBrandLogo } from '../../lib/brandLogos/brandLogoService';
import { BRAND_LOGO_ALLOWED_TYPES, validateBrandLogoFile } from '../../lib/brandLogos/brandLogoAlgorithm';
import { BrandMark } from '../brandLogos/BrandMark';
import type { TeamMember } from '../../lib/tasks/types';

interface BrandLineFormModalProps {
  companyId: string;
  mode: 'brand' | 'line';
  brands: ProductBrand[];
  members: TeamMember[];
  editingBrand?: ProductBrand;
  editingLine?: ProductLine;
  defaultBrandId?: string;
  onClose: () => void;
  onSaved: () => void;
  /** Recarrega a listagem sem fechar o formulário — usado quando a marca foi salva mas
   *  o logo falhou, para o aviso continuar visível. */
  onRefresh?: () => void;
}

function parseKeywords(text: string): string[] {
  return text.split(',').map(k => k.trim()).filter(Boolean);
}

export function BrandLineFormModal({ companyId, mode, brands, members, editingBrand, editingLine, defaultBrandId, onClose, onSaved, onRefresh }: BrandLineFormModalProps) {
  const { profile } = useAuth();
  const [name, setName] = useState(editingBrand?.name ?? editingLine?.name ?? '');
  const [code, setCode] = useState(editingBrand?.code ?? '');
  const [keywordsText, setKeywordsText] = useState((editingBrand?.keywords ?? editingLine?.keywords ?? []).join(', '));
  const [brandId, setBrandId] = useState(editingLine?.brandId ?? defaultBrandId ?? brands[0]?.id ?? '');
  const [primaryResponsibleId, setPrimaryResponsibleId] = useState(editingBrand?.primaryResponsibleId ?? editingLine?.primaryResponsibleId ?? '');
  const [additionalIds, setAdditionalIds] = useState<string[]>(editingBrand?.additionalResponsibleIds ?? editingLine?.additionalResponsibleIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Logo da marca (mode === 'brand'). O arquivo escolhido fica em espera e só é enviado
  // no Salvar: numa marca nova o id ainda não existe na hora da escolha, e assim criar e
  // editar seguem o mesmo caminho — um único ponto de gravação.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [removeExistingLogo, setRemoveExistingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const existingLogoPath = editingBrand?.logoPath ?? null;

  // Bucket privado: a URL do logo atual é assinada sob demanda, nunca guardada no banco.
  useEffect(() => {
    if (mode !== 'brand' || !existingLogoPath) return;
    let cancelled = false;
    signSingleBrandLogo(existingLogoPath).then(url => { if (!cancelled) setLogoUrl(url); });
    return () => { cancelled = true; };
  }, [mode, existingLogoPath]);

  // Preview local do arquivo em espera — revogado ao trocar/desmontar.
  useEffect(() => {
    if (!pendingFile) { setPendingPreview(null); return; }
    const url = URL.createObjectURL(pendingFile);
    setPendingPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const shownLogoUrl = pendingPreview ?? (removeExistingLogo ? null : logoUrl);

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const invalid = validateBrandLogoFile(file);
    if (invalid) { setLogoError(invalid); return; }
    setLogoError(null);
    setRemoveExistingLogo(false);
    setPendingFile(file);
  }

  function handleLogoRemove() {
    setLogoError(null);
    setPendingFile(null);
    if (existingLogoPath) setRemoveExistingLogo(true);
  }

  const toggleAdditional = (id: string) => {
    setAdditionalIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) { setError('Informe o nome.'); return; }
    if (mode === 'line' && !brandId) { setError('Selecione a marca.'); return; }

    setSaving(true);
    setError(null);
    const userId = profile?.id ?? '';
    const userEmail = profile?.email ?? '';
    try {
      if (mode === 'brand') {
        const input = { name: name.trim(), code: code.trim() || null, keywords: parseKeywords(keywordsText), primaryResponsibleId: primaryResponsibleId || null, additionalResponsibleIds: additionalIds };
        let brandIdForLogo = editingBrand?.id ?? null;
        if (editingBrand) await updateBrand(companyId, editingBrand.id, input, userId, userEmail);
        else brandIdForLogo = (await createBrand(companyId, input, userId, userEmail)).id;

        // Logo depois dos campos e em try próprio: a marca já está gravada, então uma
        // falha aqui NÃO desfaz o cadastro nem apaga a marca recém-criada — ela avisa e
        // deixa o logo para uma próxima tentativa pelo "Editar".
        if (brandIdForLogo) {
          try {
            if (pendingFile) {
              await uploadBrandLogo({ companyId, brandId: brandIdForLogo, file: pendingFile, userId, userEmail });
            } else if (removeExistingLogo && existingLogoPath) {
              await removeBrandLogo({ companyId, brandId: brandIdForLogo, logoPath: existingLogoPath, userId, userEmail });
            }
          } catch (logoErr) {
            console.error('Error saving brand logo:', logoErr);
            setLogoError(
              pendingFile
                ? 'A marca foi salva, mas o logo não pôde ser enviado. Tente enviar novamente pelo "Editar".'
                : 'A marca foi salva, mas o logo não pôde ser removido. Tente novamente pelo "Editar".'
            );
            setSaving(false);
            // Atualiza a listagem por trás (a marca existe) sem fechar o formulário,
            // para o aviso do logo continuar visível.
            onRefresh?.();
            return;
          }
        }
      } else {
        const input = { brandId, name: name.trim(), keywords: parseKeywords(keywordsText), primaryResponsibleId: primaryResponsibleId || null, additionalResponsibleIds: additionalIds };
        if (editingLine) await updateLine(companyId, editingLine.id, input, userId, userEmail);
        else await createLine(companyId, input, userId, userEmail);
      }
      onSaved();
    } catch (err) {
      console.error('Error saving brand/line:', err);
      setError('Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'brand' ? (editingBrand ? 'Editar marca' : 'Nova marca') : (editingLine ? 'Editar linha' : 'Nova linha')} maxWidth="max-w-lg">
      <div className="space-y-4">
        {mode === 'line' && (
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Marca *</label>
            <Select value={brandId} onChange={e => setBrandId(e.target.value)} disabled={!!editingLine}>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Nome *</label>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </div>

        {mode === 'brand' && (
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Código (opcional)</label>
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="Ex: GC" />
          </div>
        )}

        {mode === 'brand' && (
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Logo da marca</label>
            <div className="flex items-center gap-3">
              <BrandMark name={name || '—'} url={shownLogoUrl} size="lg" />
              <div className="min-w-0">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept={BRAND_LOGO_ALLOWED_TYPES.join(',')}
                  className="hidden"
                  aria-label="Logo da marca"
                  onChange={handleLogoFile}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => logoInputRef.current?.click()}>
                    <ImageUp size={14} /> {shownLogoUrl ? 'Substituir logo' : 'Selecionar imagem'}
                  </Button>
                  {shownLogoUrl && (
                    <Button size="sm" variant="ghost" onClick={handleLogoRemove} aria-label="Remover logo">
                      <Trash2 size={14} /> Remover
                    </Button>
                  )}
                </div>
                <p className="text-xs text-fg-subtle mt-1">
                  PNG, JPEG ou WEBP, até 5 MB. Usado nesta marca e nas linhas dela, somente neste workspace.
                </p>
                {logoError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{logoError}</p>}
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Aliases/palavras-chave adicionais (separados por vírgula)</label>
          <Textarea rows={2} value={keywordsText} onChange={e => setKeywordsText(e.target.value)} placeholder="O nome já funciona como palavra-chave automaticamente" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Responsável principal</label>
          <Select value={primaryResponsibleId} onChange={e => setPrimaryResponsibleId(e.target.value)}>
            <option value="">Nenhum</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email ?? m.id}</option>)}
          </Select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Responsáveis adicionais</label>
          <div className="max-h-32 overflow-auto space-y-1 border border-edge rounded-lg p-2">
            {members.map(m => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={additionalIds.includes(m.id)} onChange={() => toggleAdditional(m.id)} />
                {m.name ?? m.email ?? m.id}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </div>
      </div>
    </Modal>
  );
}
